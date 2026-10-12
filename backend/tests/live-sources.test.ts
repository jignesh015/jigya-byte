import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store.ts';
import { readConfig, generationBatchSize } from '../src/config.ts';
import { TOPICS, snapshot } from '../src/contracts/index.ts';
import { LiveSources, parsePib, parsePibPage, parseUn, parseGdelt, parseSteam, parseReleases, publicUrl } from '../src/sources/live.ts';
import type { Evidence } from '../src/sources/live.ts';
import { prepare, prepareBatch } from '../src/preparation/cards.ts';
import { distributedTopics } from '../src/preparation/topics.ts';
import { Worker } from '../src/jobs/worker.ts';

const config = () => readConfig({ BACKEND_DEVICE_TOKEN: randomBytes(32).toString('hex'), GENERATION_PROVIDER: 'gemini',
  GEMINI_API_KEY: 'fixture-only', GEMINI_MODEL: 'fixture', GEMINI_FREE_TIER_CONFIRMED: 'true', MAX_INPUT_TOKENS: '16000', MAX_OUTPUT_TOKENS: '8192', DAILY_TOKEN_LIMIT: '362880' });
const date = new Date().toISOString();
const excerpt = 'A specific fixture update describes a new feature and explains its practical behavior with enough context to prepare a short card.';
const source = (topic = 'ai-updates', id = 'source-one'): Evidence => ({ id, name: 'Fixture', title: 'Fixture announcement',
  url: `https://example.org/${id}`, publishedAt: date, retrievedAt: date, dateKind: 'published', topicIds: [topic], excerpt });
const raw = (topic = 'ai-updates', sourceIds = ['source-one']) => ({ title: 'Fixture learning idea', summary: 'Fixture takeaway', explanation: 'Fixture explanation.', primaryTopicId: topic, topicIds: [topic], sourceIds });
const inventory = () => snapshot({ protocolVersion: 1, deviceId: 'fixture', inventoryVersion: 1, snapshotComplete: true,
  counts: { unread: 55, readNonFavorite: 0, favorites: 0 }, retainedCards: Array.from({ length: 55 }, (_, i) => ({ id: `phone-${i}`, contentHash: `phone-hash-${i}`, read: false, favorite: false })), interestTopicIds: ['space'], historyEvents: [] });

test('RSS, news index, GitHub and Steam parsers require fresh dated substantial evidence', () => {
  const xml = `<rss><channel><item><title>Policy announcement</title><link>https://www.pib.gov.in/PressReleasePage.aspx?PRID=1</link><pubDate>${date}</pubDate><description><![CDATA[${excerpt}]]></description></item></channel></rss>`;
  assert.equal(parsePib(xml).length, 1);
  assert.throws(() => parsePib('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]><rss/>'));
  assert.equal(parsePib(xml.replace(date, '2000-01-01')).length, 0);
  assert.equal(parsePib(xml.replace('https://www.pib.gov.in/', 'https://127.0.0.1/')).length, 0);
  const news = parseGdelt({ articles: [{ title: 'News', url: 'https://example.org/news', seendate: date, context: excerpt, domain: 'example.org' }] }, 'current-affairs');
  assert.equal(news[0].dateKind, 'observed');
  assert.equal(parseGdelt({ articles: [{ title: 'Headline only', url: 'https://example.org/news', seendate: date }] }, 'current-affairs').length, 0);
  assert.equal(parseReleases([{ html_url: 'https://github.com/owner/repo/releases/v1', published_at: date, body: excerpt, name: 'Release' }], 'owner/repo').length, 1);
  const announcement = { title: 'Update', url: 'https://store.steampowered.com/news/app/1/view/2', date: Math.floor(Date.now() / 1000), contents: excerpt, feedname: 'steam_community_announcements' };
  assert.equal(parseSteam({ appnews: { newsitems: [announcement] } }).length, 1);
  assert.equal(parseSteam({ appnews: { newsitems: [{ ...announcement, feedname: 'third-party' }] } }).length, 0);
});

test('public links reject credentials, local hosts, IPs and unsafe protocols', () => {
  for (const url of ['http://example.org/a', 'file:///secret', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://localhost/a', 'https://a.internal/a', 'https://example.org:3000/a']) assert.equal(publicUrl(url), false);
  const authenticated = new URL('https://example.org/a'); authenticated.username = 'fixture'; authenticated.password = 'fixture';
  assert.equal(publicUrl(authenticated.href), false);
  assert.equal(publicUrl('https://example.org/news'), true);
});

test('title-only PIB feeds use the dated release body; UN summaries retain publisher dates', () => {
  const now = new Date('2026-10-12T12:00:00Z').getTime();
  const page = `<div id="PrDateTime">Posted On: 12 OCT 2026 3:25PM by PIB Delhi</div><p>${excerpt}</p>`;
  const result = parsePibPage(page, 'Policy announcement', 'https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=1', now);
  assert.equal(result.length, 1); assert.equal(result[0].publishedAt, '2026-10-12T09:55:00.000Z');
  assert.equal(parsePibPage('<p>No date</p>', 'Title', 'https://www.pib.gov.in/news', now).length, 0);
  const xml = `<rss><channel><item><title>Global update</title><link>https://news.un.org/story/update</link><pubDate>2026-10-12T09:00:00Z</pubDate><description>${excerpt}</description></item></channel></rss>`;
  assert.equal(parseUn(xml, now)[0].dateKind, 'published');
});

test('feed redirects may only stay on the same public host and never fetch a private target', async () => {
  const store = new Store(':memory:'); const visited: string[] = [];
  try {
    const live = new LiveSources(store, async url => { visited.push(String(url)); return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/secret' } }); });
    assert.deepEqual(await live.load('unsafe', 'https://example.org/feed', () => [source()]), []);
    assert.equal(visited.length, 1); assert.equal(live.status[0].reason, 'unsafe_redirect');
    const redirected = new LiveSources(store, async url => String(url).includes('www.')
      ? Response.json({}) : new Response(null, { status: 301, headers: { location: 'https://www.example.org/feed' } }));
    assert.equal((await redirected.load('safe', 'https://example.org/feed', () => [source()])).length, 1);
  } finally { store.close(); }
});

test('source fetches are bounded, coalesced and persistently cached; failures do not repeat', async () => {
  const store = new Store(':memory:'); let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json({ fixture: true }); };
  try {
    const live = new LiveSources(store, fetcher);
    const results = await Promise.all([live.load('fixture', 'https://example.org/api', () => [source()]), live.load('fixture', 'https://example.org/api', () => [source()])]);
    assert.equal(calls, 1); assert.equal(results[0].length, 1);
    await new LiveSources(store, fetcher).load('fixture', 'https://example.org/api', () => []); assert.equal(calls, 1);
    const broken = new LiveSources(store, async () => { calls++; throw new Error('Offline'); });
    assert.deepEqual(await broken.load('broken', 'https://example.org/api', () => []), []);
    await broken.load('broken', 'https://example.org/api', () => []); assert.equal(calls, 2);
    const tooLarge = new LiveSources(store, async () => new Response('x'.repeat(512 * 1024 + 1)));
    assert.deepEqual(await tooLarge.load('large', 'https://example.org/api', () => [source()]), []);
  } finally { store.close(); }
});

test('model references resolve only to supplied matching evidence, never model-supplied URLs', () => {
  const cfg = config(); const card = prepare({ cards: [raw()] }, cfg, 1, [source()], ['ai-updates'])[0];
  assert.equal(card.sources[0].url, source().url);
  assert.throws(() => prepare({ cards: [raw('ai-updates', ['invented'])] }, cfg, 1, [source()], ['ai-updates']), /invalid_source/);
  assert.throws(() => prepare({ cards: [raw('ai-updates', [])] }, cfg, 1, [source()], ['ai-updates']), /live_source_required/);
  assert.throws(() => prepare({ cards: [raw('space')] }, cfg, 1, [source()], ['space']), /invalid_source/);
  assert.throws(() => prepare({ cards: [raw(), raw()] }, cfg, 2, [source()], ['ai-updates', 'ai-updates']), /repeated_source/);
});

test('randomized least-generated selection covers every topic evenly and catches up missing topics', () => {
  const picked = distributedTopics(TOPICS, 120, {}, () => 0);
  for (const topic of TOPICS) assert.equal(picked.filter(t => t === topic).length, 6);
  const counts = Object.fromEntries(TOPICS.map(t => [t, 10])); counts.cinema = 0;
  assert.deepEqual(distributedTopics(TOPICS, 10, counts), Array(10).fill('cinema'));
  assert.notDeepEqual(distributedTopics(TOPICS, 20, {}, () => 0), distributedTopics(TOPICS, 20, {}, max => max - 1));
});

test('partially invalid output keeps valid cards without a repair call', () => {
  const result = prepareBatch({ cards: [raw(), raw('current-affairs', ['made-up']), raw('space', [])] }, config(), ['ai-updates', 'current-affairs', 'space'], [source()]);
  assert.equal(result.cards.length, 2); assert.equal(result.rejected, 1);
  assert.equal(result.cards[0].primaryTopicId, 'ai-updates'); assert.equal(result.cards[1].primaryTopicId, 'space');
  assert.throws(() => prepareBatch({ cards: [] }, config(), ['space'], []), /invalid_provider_output/);
});

test('one output-sized request covers a five-card deficit and stores surplus for later', async () => {
  const store = new Store(':memory:'); const cfg = config(); const s = inventory();
  try {
    store.sync(s, cfg); let requested = 0;
    const live = new LiveSources(store); live.collect = async () => [source('ai-updates'), source('current-affairs', 'affairs'), source('game-industry-news', 'games')];
    const worker = new Worker(cfg, store, async text => {
      const topics: string[] = JSON.parse(text.match(/in this order: (\[[^\n]+\])/u)![1]); requested = topics.length;
      const evidence: Evidence[] = JSON.parse(text.match(/Live evidence .*?: (\[[^\n]+\])/u)![1]);
      return { cards: topics.map((topic, i) => ({ ...raw(topic, evidence.filter(e => e.topicIds.includes(topic)).slice(0, 1).map(e => e.id)), title: `Unique word${i}`, summary: `Takeaway word${i}` })) };
    }, undefined, live);
    await worker.tick();
    assert.equal(store.jobs()[0].state, 'completed');
    assert.equal(requested, generationBatchSize(cfg)); assert.equal(requested, 21);
    assert.equal(store.cards().length, 21); assert.equal(store.sync(s, cfg).cards.length, 5);
    assert.equal(store.usage().requests, 1); assert.ok(store.usage().tokens < cfg.maxInput + cfg.maxOutput);
    assert.ok(store.cards().some(card => card.sources.length));
  } finally { store.close(); }
});

test('source outages skip news instead of inventing current events; exhausted budget makes no calls', async () => {
  for (const exhausted of [false, true]) {
    const store = new Store(':memory:'); const cfg = { ...config(), requestLimit: exhausted ? 0 : 10 }; let sourceCalls = 0, modelCalls = 0;
    try {
      store.sync(inventory(), cfg); const live = new LiveSources(store); live.collect = async () => { sourceCalls++; return []; };
      const worker = new Worker(cfg, store, async text => {
        modelCalls++; const topics: string[] = JSON.parse(text.match(/in this order: (\[[^\n]+\])/u)![1]);
        assert.ok(topics.every(topic => !['ai-updates', 'current-affairs', 'game-industry-news'].includes(topic)));
        return { cards: topics.map((topic, i) => ({ ...raw(topic, []), title: `Idea unique${i}`, summary: `Summary unique${i}` })) };
      }, undefined, live);
      await worker.tick(); assert.equal(modelCalls, exhausted ? 0 : 1); assert.equal(sourceCalls, exhausted ? 0 : 1);
    } finally { store.close(); }
  }
});

test('expired news cannot be delivered while reference history and topic counts survive', () => {
  const store = new Store(':memory:'); const cfg = config();
  try {
    const old = { ...source(), publishedAt: '2000-01-01T00:00:00Z' };
    const card = prepare({ cards: [raw()] }, cfg, 1, [old])[0]; store.addCards([card], 500);
    assert.equal(store.candidates(inventory()).length, 0); store.expireNews();
    assert.equal(store.cards().length, 0); assert.equal(store.topicCounts()['ai-updates'], 1); assert.ok(store.usedSourceIds().has(old.id));
  } finally { store.close(); }
});

test('a small remaining token allowance shrinks both batch and provider output limit', async () => {
  const store = new Store(':memory:'); const cfg = { ...config(), tokenLimit: 9000 }; let outputLimit = 0, count = 0;
  try {
    store.sync(inventory(), cfg); const live = new LiveSources(store); live.collect = async () => [];
    const worker = new Worker(cfg, store, async (text, _, limits) => {
      outputLimit = limits!.maxOutputTokens;
      const topics: string[] = JSON.parse(text.match(/in this order: (\[[^\n]+\])/u)![1]); count = topics.length;
      return { cards: topics.map((topic, i) => ({ ...raw(topic, []), title: `Budget word${i}`, summary: `Summary word${i}` })) };
    }, undefined, live);
    await worker.tick(); assert.equal(store.jobs()[0].state, 'completed');
    assert.ok(count > 0 && count < generationBatchSize(cfg)); assert.ok(outputLimit < cfg.maxOutput);
    assert.equal(store.usage().tokens, 9000); assert.equal(store.usage().requests, 1);
  } finally { store.close(); }
});

test('version-six upgrade preserves cards, pending deliveries and budget reservations', () => {
  const folder = mkdtempSync(join(tmpdir(), 'jigyabyte-source-migration-')); const path = join(folder, 'backend.sqlite');
  const cfg = { ...config(), liveSources: false }; let store = new Store(path);
  try {
    const card = prepare({ cards: [raw('space', [])] }, cfg, 1)[0]; store.addCards([card], 500);
    const delivery = store.sync(inventory(), cfg);
    const id = store.queue('migration-budget-fixture', 1); store.reserveBudget(store.job(id)!, cfg); store.markJob(id, 'completed');
    const before = store.usage();
    store.db.exec('DROP TABLE source_cache; DROP TABLE topic_generation; DROP TABLE source_usage; PRAGMA user_version=6;'); store.close();
    store = new Store(path);
    assert.equal(store.cards()[0].id, card.id); assert.equal(store.pending('fixture')!.id, delivery.deliveryId);
    assert.deepEqual(store.usage(), before); assert.equal(store.topicCounts().space, 1);
    store.cacheSource('fixture', [source()]); assert.equal((store.cachedSource('fixture')!.body as Evidence[]).length, 1);
    store.close(); store = new Store(path);
    assert.equal(store.topicCounts().space, 1); assert.deepEqual(store.usage(), before);
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});
