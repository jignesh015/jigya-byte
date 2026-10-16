import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, providerRoutes } from '../src/config.ts';
import { Store } from '../src/storage/store.ts';
import { snapshot, Failure } from '../src/contracts/index.ts';
import type { Card, Snapshot } from '../src/contracts/index.ts';
import { prepare, nearDuplicate } from '../src/preparation/cards.ts';
import { cloudGenerator } from '../src/providers/cloud.ts';
import type { ProviderDiagnostic } from '../src/providers/cloud.ts';
import { Worker } from '../src/jobs/worker.ts';
import { createBackend } from '../src/server.ts';
import { availableRoute, MODEL_COOLDOWN_MS } from '../src/providers/routing.ts';

const token = randomBytes(32).toString('hex');
const config = (extra: NodeJS.ProcessEnv = {}) => readConfig({ BACKEND_DEVICE_TOKEN: token, BACKEND_DATABASE: ':memory:', LIVE_SOURCES_ENABLED: 'false', ...extra });
const liveConfig = (extra: NodeJS.ProcessEnv = {}) => config({ GENERATION_PROVIDER: 'gemini', GEMINI_API_KEY: randomBytes(24).toString('hex'), GEMINI_MODEL: 'mock-model', GEMINI_FREE_TIER_CONFIRMED: 'true', CONTENT_MODE: 'ai-only', ...extra });
function inventory(unread = 0, version = 1): Snapshot {
  return snapshot({ protocolVersion: 1, deviceId: 'test-installation', inventoryVersion: version, snapshotComplete: true,
    counts: { unread, readNonFavorite: 0, favorites: 0 }, retainedCards: Array.from({ length: unread }, (_, i) => ({ id: `local-${i}`, contentHash: `local-hash-${i}`, read: false, favorite: false })),
    interestTopicIds: ['space'], historyEvents: [], pendingDeliveryIds: [] });
}
function fixture(index: number): Card {
  // Unique lexical ideas; fixtures are never added to the production database.
  const word = index.toString(36).padStart(4, 'x');
  return prepare({ cards: [{ title: `Fixture ${word}`, summary: `Sample ${word}`, explanation: `Mock explanation ${word}.`, primaryTopicId: 'space', topicIds: ['space'] }] }, liveConfig(), 1)[0];
}
function seed(store: Store, count = 60) { store.addCards(Array.from({ length: count }, (_, i) => fixture(i)), 500); }

test('configuration rejects missing token, invalid ordering, and unapproved paid activation', () => {
  assert.throws(() => readConfig({}), /TOKEN/);
  assert.throws(() => config({ UNREAD_TARGET: '50' }), /ordering/);
  assert.throws(() => config({ GENERATION_BATCH_SIZE: '61' }), /GENERATION_BATCH_SIZE/);
  assert.throws(() => liveConfig({ GEMINI_FREE_TIER_CONFIRMED: 'false' }), /activation/);
  assert.throws(() => liveConfig({ GENERATION_PROVIDER: 'other' }), /Only Gemini/);
  assert.throws(() => config({ ALLOW_PAID_CALLS: 'yes' }), /Invalid/);
  assert.equal(config().provider, 'disabled');
});
test('complete inventory validates counts and overlapping favorites', () => {
  const s = inventory(1); s.retainedCards[0].favorite = true; s.counts.favorites = 1;
  assert.equal(snapshot(s).counts.unread, 1);
  assert.throws(() => snapshot({ ...s, snapshotComplete: false }), /complete_snapshot/);
  assert.throws(() => snapshot({ ...s, counts: { ...s.counts, unread: 2 } }), /count_mismatch/);
  assert.throws(() => snapshot({ ...s, retainedCards: [...s.retainedCards, ...s.retainedCards] }), /duplicate/);
});
test('cached bootstrap refills 10 to 60 with acknowledged local snapshots, never projected counts', () => {
  const store = new Store(':memory:'); seed(store);
  let s = inventory(10), received = 0;
  for (let round = 0; round < 5; round++) {
    const delivery = store.sync(s, config());
    assert.equal(delivery.reportedUnread, s.counts.unread);
    assert.equal(delivery.cards.length, 10);
    const repeated = store.sync(s, config());
    assert.equal(repeated.deliveryId, delivery.deliveryId);
    s = { ...s, inventoryVersion: s.inventoryVersion + 1, retainedCards: [...s.retainedCards, ...delivery.cards.map(c => ({ id: c.id, contentHash: c.contentHash, read: false, favorite: false }))], counts: { ...s.counts, unread: s.counts.unread + 10 } };
    assert.equal(store.acknowledge(delivery.deliveryId!, s, delivery.cards.map(c => c.id), []).acknowledged, true);
    // Lost-ack response retry is harmless.
    assert.equal(store.acknowledge(delivery.deliveryId!, s, delivery.cards.map(c => c.id), []).acknowledged, true);
    received += delivery.cards.length;
  }
  assert.equal(s.counts.unread, 60); assert.equal(received, 50);
  assert.equal(store.sync(s, config()).cards.length, 0); assert.equal(store.jobs().length, 0); store.close();
});
test('55 triggers cached refill; 56 does not; repeated sync reserves one job', () => {
  const store = new Store(':memory:'); seed(store, 5);
  assert.equal(store.sync(inventory(56), config()).cards.length, 0);
  assert.equal(store.sync(inventory(55, 2), config()).cards.length, 5); store.close();
  const empty = new Store(':memory:'); const s = inventory();
  const first = empty.sync(s, liveConfig()), second = empty.sync(s, liveConfig());
  assert.equal(first.refillJobId, second.refillJobId); assert.equal(empty.jobs().length, 1); empty.close();
});
test('a persisted refill cycle continues from 47 through 57 to 60', () => {
  const store = new Store(':memory:'); seed(store, 20); let s = inventory(47);
  const first = store.sync(s, config()); assert.equal(first.cards.length, 10);
  s = { ...s, inventoryVersion: 2, counts: { ...s.counts, unread: 57 }, retainedCards: [...s.retainedCards, ...first.cards.map(c => ({ id: c.id, contentHash: c.contentHash, read: false, favorite: false }))] };
  store.acknowledge(first.deliveryId!, s, first.cards.map(c => c.id), []);
  const second = store.sync(s, config()); assert.equal(second.cards.length, 3);
  s = { ...s, inventoryVersion: 3, counts: { ...s.counts, unread: 60 }, retainedCards: [...s.retainedCards, ...second.cards.map(c => ({ id: c.id, contentHash: c.contentHash, read: false, favorite: false }))] };
  store.acknowledge(second.deliveryId!, s, second.cards.map(c => c.id), []);
  assert.equal(store.sync(s, config()).cards.length, 0); assert.equal(store.isRefilling(s.deviceId), false); store.close();
});
test('single-model quota failure cools the model; early explicit retry makes no second call', async () => {
  const cfg = liveConfig(), store = new Store(':memory:'); store.sync(inventory(), cfg); let calls = 0;
  const worker = new Worker(cfg, store, async () => { calls++; throw new Failure('quota_exhausted', 502, 5000); });
  await worker.tick();
  assert.equal(store.sync(inventory(), cfg).refillState, 'quota_exhausted');
  const failedAt=store.cooldowns()[0].failed_at;
  store.markJob(store.jobs()[0].id,'queued');
  await worker.tick(); await worker.tick();
  assert.equal(calls, 1); assert.equal(store.usage().requests, 1);
  assert.equal(store.jobs()[0].error, 'model_cooldown');
  assert.equal(store.jobs()[0].next_at,failedAt+MODEL_COOLDOWN_MS);
  assert.equal(store.cooldowns()[0].failed_at,failedAt); store.close();
});
test('paid reservations stop before exceeding configured maximum request cost', () => {
  const cfg = liveConfig({ ALLOW_PAID_CALLS: 'true', DAILY_COST_LIMIT: '0.1', MAX_REQUEST_COST: '0.08' });
  const store = new Store(':memory:'); const id = store.queue('device', 5), job = store.job(id)!;
  store.reserveBudget(job, cfg); assert.equal(store.usage().cost, 0.08);
  assert.throws(() => store.reserveBudget(job, cfg), /budget_exhausted/); assert.equal(store.usage().requests, 1); store.close();
});
test('ambiguous model timeout remains uncertain and is never automatically repeated', async () => {
  const cfg = liveConfig(), store = new Store(':memory:'); store.sync(inventory(), cfg); let calls = 0;
  const worker = new Worker(cfg, store, async () => { calls++; throw new Failure('upstream_timeout_or_network'); });
  await worker.tick(); await worker.tick(); assert.equal(calls, 1);
  assert.equal(store.jobs()[0].state, 'uncertain'); assert.equal(store.sync(inventory(), cfg).refillState, 'degraded'); store.close();
});

test('Gemini fallback configuration is explicit and validated', () => {
  const cfg = liveConfig({ GEMINI_FALLBACK_MODEL: 'alternate' });
  assert.deepEqual(providerRoutes(cfg).map(c => c.model), ['mock-model', 'alternate']);
  assert.throws(() => liveConfig({ GEMINI_FALLBACK_MODEL: 'mock-model' }), /FALLBACK_MODEL/);
  assert.deepEqual(providerRoutes(liveConfig({ GEMINI_FALLBACK_MODEL: 'alternate', GEMINI_FALLBACK_MODELS: ' lite-one, lite-two ' })).map(c => c.model), ['mock-model', 'alternate', 'lite-one', 'lite-two']);
  assert.deepEqual(providerRoutes(liveConfig({ GEMINI_FALLBACK_MODELS: 'lite-one,lite-two' })).map(c => c.model), ['mock-model', 'lite-one', 'lite-two']);
  for (const models of ['mock-model', 'alternate,alternate', 'bad/model', Array.from({ length: 8 }, (_, i) => `model-${i}`).join(',')]) {
    assert.throws(() => liveConfig({ GEMINI_FALLBACK_MODELS: models }), /FALLBACK_MODELS/);
  }
  assert.throws(() => liveConfig({ GEMINI_FALLBACK_MODEL: 'alternate', GEMINI_FALLBACK_MODELS: 'alternate' }), /FALLBACK_MODELS/);
});

test('four-model HTTP fallback reaches the last route, attributes cards and reserves every attempt', async () => {
  for (const lastSucceeds of [true, false]) {
    const cfg = liveConfig({ GEMINI_FALLBACK_MODEL: 'alternate', GEMINI_FALLBACK_MODELS: 'lite-one,lite-two',
      GENERATION_BATCH_SIZE: '1', DAILY_REQUEST_LIMIT: '30', DAILY_TOKEN_LIMIT: '725760' });
    const store = new Store(':memory:'); store.sync(inventory(), cfg); const calls: string[] = [];
    const generateFor = (route: typeof cfg) => cloudGenerator(route, async (url, options) => {
      assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${route.model}:generateContent`);
      const body = JSON.parse(options!.body as string);
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      assert.ok(body.generationConfig.responseJsonSchema);
      calls.push(route.model!);
      if (route.model !== 'lite-two' || !lastSucceeds) return Response.json({ error: { status: 'UNAVAILABLE', message: 'High demand' } }, { status: 503 });
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ cards: [{ title: 'Orbital resonance', summary: 'Repeated gravitational tugs', explanation: 'Orbital periods can form simple ratios.', primaryTopicId: 'space', topicIds: ['space'] }] }) }] } }] });
    });
    const worker = new Worker(cfg, store, generateFor(cfg), generateFor);
    try {
      for (let index = 0; index < 4; index++) {
        await worker.tick();
        assert.equal(store.usage().requests, index + 1);
        if (index < 3) {
          assert.equal(store.jobs()[0].provider_index, index + 1);
          assert.equal(store.jobs()[0].state, 'queued');
          assert.ok(store.jobs()[0].next_at > Date.now());
          store.db.prepare('UPDATE jobs SET next_at=0').run();
        }
      }
      await worker.tick();
      assert.deepEqual(calls, ['mock-model', 'alternate', 'lite-one', 'lite-two']);
      assert.equal(store.jobs()[0].attempts, 4);
      assert.equal(store.jobs()[0].state, lastSucceeds ? 'completed' : 'failed');
      assert.equal(JSON.parse((store.db.prepare('SELECT attempt_log FROM jobs').get() as { attempt_log: string }).attempt_log).length, 4);
      if (lastSucceeds) assert.equal(store.cards()[0].modelId, 'lite-two');
      else assert.equal(store.jobs()[0].error, 'upstream_unavailable');
    } finally { store.close(); }
  }
});

test('extended chain stops at a shared budget or terminal error, with final timeout uncertain', async () => {
  for (const [requestLimit, lastError, expected] of [
    ['3', 'upstream_unavailable', 'budget_exhausted'],
    ['30', 'upstream_timeout_or_network', 'upstream_timeout_or_network'],
    ['30', 'provider_credentials_or_access', 'provider_credentials_or_access'],
  ]) {
    const cfg = liveConfig({ GEMINI_FALLBACK_MODEL: 'alternate', GEMINI_FALLBACK_MODELS: 'lite-one,lite-two',
      GENERATION_BATCH_SIZE: '1', DAILY_REQUEST_LIMIT: requestLimit, DAILY_TOKEN_LIMIT: '725760' });
    const store = new Store(':memory:'); store.sync(inventory(), cfg); const calls: string[] = [];
    const generateFor = (route: typeof cfg) => async () => {
      calls.push(route.model!);
      throw new Failure(route.model === 'lite-two' ? lastError : 'upstream_unavailable');
    };
    const worker = new Worker(cfg, store, generateFor(cfg), generateFor);
    try {
      for (let i = 0; i < 5; i++) { await worker.tick(); store.db.prepare('UPDATE jobs SET next_at=0').run(); }
      assert.equal(calls.length, requestLimit === '3' ? 3 : 4);
      assert.equal(store.usage().requests, calls.length);
      assert.equal(store.jobs()[0].error, expected);
      assert.equal(store.jobs()[0].state, lastError === 'upstream_timeout_or_network' ? 'uncertain' : 'failed');
    } finally { store.close(); }
  }
});

test('third fallback route survives restart and does not repeat earlier models', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jigyabyte-chain-')), path = join(dir, 'test.sqlite');
  const cfg = liveConfig({ GEMINI_FALLBACK_MODEL: 'alternate', GEMINI_FALLBACK_MODELS: 'lite-one,lite-two',
    GENERATION_BATCH_SIZE: '1', DAILY_TOKEN_LIMIT: '725760' });
  let store = new Store(path); const calls: string[] = [];
  const generateFor = (route: typeof cfg) => async () => { calls.push(route.model!); throw new Failure('upstream_unavailable'); };
  try {
    store.sync(inventory(), cfg);
    let worker = new Worker(cfg, store, generateFor(cfg), generateFor);
    for (let i = 0; i < 2; i++) { await worker.tick(); store.db.prepare('UPDATE jobs SET next_at=0').run(); }
    store.close(); store = new Store(path); assert.equal(store.jobs()[0].provider_index, 2);
    worker = new Worker(cfg, store, generateFor(cfg), generateFor);
    for (let i = 0; i < 2; i++) { await worker.tick(); store.db.prepare('UPDATE jobs SET next_at=0').run(); }
    assert.deepEqual(calls, ['mock-model', 'alternate', 'lite-one', 'lite-two']);
    assert.equal(store.jobs()[0].state, 'failed'); assert.equal(store.usage().requests, 4);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('overload falls back once and successful cards identify the actual model', async () => {
  const cfg = liveConfig({ GEMINI_FALLBACK_MODEL: 'alternate', GENERATION_BATCH_SIZE: '1' });
  const store = new Store(':memory:'); store.sync(inventory(), cfg); const calls: string[] = [];
  const worker = new Worker(cfg, store, async (_, report) => {
    calls.push(cfg.model!); report?.({ provider: 'gemini', model: cfg.model, httpStatus: 503 }); throw new Failure('upstream_unavailable');
  }, route => async (_, report) => {
    calls.push(route.model!); report?.({ provider: route.provider, model: route.model, httpStatus: 200 });
    return { cards: [{ title: 'Orbital resonance', summary: 'Repeated gravitational tugs', explanation: 'Orbital periods can form simple ratios.', primaryTopicId: 'space', topicIds: ['space'] }] };
  });
  await worker.tick(); assert.equal(store.jobs()[0].provider_index, 1);
  assert.equal(store.usage().requests, 1); assert.equal(store.jobs()[0].state, 'queued');
  store.db.prepare('UPDATE jobs SET next_at=0').run(); await worker.tick();
  assert.deepEqual(calls, ['mock-model', 'alternate']); assert.equal(store.usage().requests, 2);
  assert.equal(store.cards()[0].modelId, 'alternate'); assert.equal(store.jobs()[0].state, 'completed');
  const log = store.db.prepare('SELECT attempt_log FROM jobs').get() as { attempt_log: string };
  assert.equal(JSON.parse(log.attempt_log).length, 2); store.close();
});

test('fallbacks respect shared budgets; shared credential failure remains terminal', async () => {
  for (const code of ['upstream_unavailable', 'provider_credentials_or_access', 'provider_refused_or_incomplete', 'upstream_timeout_or_network',
    'invalid_provider_output', 'invalid_upstream_json', 'empty_upstream_response', 'upstream_response_too_large']) {
    const cfg = liveConfig({ GEMINI_FALLBACK_MODEL: 'alternate', DAILY_REQUEST_LIMIT: '1' });
    const store = new Store(':memory:'); store.sync(inventory(), cfg); let fallbackCalls = 0;
    const worker = new Worker(cfg, store, async () => { throw new Failure(code); }, () => async () => { fallbackCalls++; return {}; });
    await worker.tick(); store.db.prepare('UPDATE jobs SET next_at=0').run(); await worker.tick();
    assert.equal(fallbackCalls, 0); assert.equal(store.usage().requests, 1);
    assert.equal(store.jobs()[0].error, code === 'provider_credentials_or_access' ? code : 'budget_exhausted'); store.close();
  }
});

test('queued fallback selection survives a backend restart without repeating primary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jigyabyte-fallback-')), path = join(dir, 'test.sqlite');
  const cfg = liveConfig({ GEMINI_FALLBACK_MODEL: 'alternate' }); let store = new Store(path);
  try {
    store.sync(inventory(), cfg);
    await new Worker(cfg, store, async () => { throw new Failure('upstream_unavailable'); }).tick();
    store.close(); store = new Store(path); assert.equal(store.jobs()[0].provider_index, 1);
    store.db.prepare('UPDATE jobs SET next_at=0').run(); let primary = 0, fallback = 0;
    await new Worker(cfg, store, async () => { primary++; return {}; }, () => async () => { fallback++; throw new Failure('upstream_unavailable'); }).tick();
    assert.equal(primary, 0); assert.equal(fallback, 1); assert.equal(store.jobs()[0].state, 'failed'); assert.equal(store.usage().requests, 2);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('stale/conflicting snapshots roll back and history excludes evicted identities', () => {
  const store = new Store(':memory:'); seed(store, 2); const c = fixture(0);
  const s = inventory(0, 2); s.historyEvents = [{ eventId: 'seen:1', id: c.id, contentHash: c.contentHash, primaryTopicId: 'space', seen: true, expanded: false }];
  const result = store.sync(s, config()); assert.equal(result.cards.length, 1); assert.notEqual(result.cards[0].id, c.id);
  assert.throws(() => store.sync(inventory(0, 1), config()), /stale_inventory/);
  assert.throws(() => store.sync(inventory(1, 2), config()), /version_conflict/);
  assert.equal(store.getSnapshot(s.deviceId)!.counts.unread, 0); store.close();
});
test('ack partitions must cover the delivery and accepted cards must be committed', () => {
  const store = new Store(':memory:'); seed(store, 2); const s = inventory(), delivery = store.sync(s, config());
  assert.throws(() => store.acknowledge(delivery.deliveryId!, inventory(0,2), [], []), /invalid_ack/);
  assert.throws(() => store.acknowledge(delivery.deliveryId!, inventory(0,2), delivery.cards.map(c => c.id), []), /missing/);
  store.acknowledge(delivery.deliveryId!, inventory(0,2), [], delivery.cards.map(c => c.id));
  assert.equal(store.sync(inventory(0,2), config()).cards.length, 0); store.close();
});
test('restart preserves pending delivery and usage; ambiguous jobs never redispatch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jigyabyte-backend-')); const path = join(dir, 'db.sqlite');
  try {
    let store = new Store(path); seed(store, 1); const d = store.sync(inventory(), config());
    const id = store.queue('another-device', 5); store.reserveBudget(store.job(id)!, liveConfig()); store.close();
    store = new Store(path);
    assert.equal(store.sync(inventory(), config()).deliveryId, d.deliveryId);
    assert.equal(store.job(id)!.state, 'uncertain'); assert.equal(store.usage().requests, 1); store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('worker generates ten cards in one call and reserves one request', async () => {
  const store = new Store(':memory:'); const cfg = liveConfig(); const s = inventory();
  store.sync(s, cfg); let calls = 0;
  const worker = new Worker(cfg, store, async () => { calls++; return { cards: Array.from({ length: 10 }, (_, i) => ({ title: `Idea word${i}`, summary: `Summary word${i}`, explanation: `Explanation word${i}`, primaryTopicId: 'space', topicIds: ['space'] })) }; });
  await Promise.all([worker.tick(), worker.tick()]);
  assert.equal(calls, 1); assert.equal(store.cards().length, 10); assert.equal(store.usage().requests, 1);
  assert.equal(store.sync(s, cfg).cards.length, 10);
  await worker.tick(); assert.equal(calls, 1); store.close();
});

test('a small phone deficit fills a complete output-sized batch and caches the surplus', async () => {
  const store = new Store(':memory:'); const cfg = liveConfig();
  store.sync(inventory(55), cfg);
  store.sync(inventory(57, 2), cfg);
  let calls = 0;
  const worker = new Worker(cfg, store, async text => {
    calls++; assert.match(text, /Prepare exactly 10 distinct English cards/);
    return { cards: Array.from({ length: 10 }, (_, i) => ({ title: `Remaining word${i}`, summary: `Summary word${i}`, explanation: `Detail word${i}`, primaryTopicId: 'space', topicIds: ['space'] })) };
  });
  await worker.tick();
  assert.equal(calls, 1); assert.equal(store.cards().length, 10); assert.equal(store.usage().requests, 1);
  assert.equal(store.sync(inventory(57, 2), cfg).cards.length, 3);
  store.close();
});
test('cancelled demand and exhausted budgets make zero provider calls', async () => {
  for (const exhausted of [false, true]) {
    const store = new Store(':memory:'); const cfg = liveConfig(exhausted ? { DAILY_REQUEST_LIMIT: '0' } : {});
    store.sync(inventory(), cfg);
    if (!exhausted) store.sync(inventory(60,2), cfg);
    let calls = 0; const worker = new Worker(cfg, store, async () => { calls++; return {}; });
    await worker.tick(); assert.equal(calls, 0);
    assert.equal(store.jobs()[0].state, exhausted ? 'failed' : 'cancelled'); store.close();
  }
});
test('AI-only configuration rejects retrieved-source mode and card text overflow', () => {
  assert.throws(() => liveConfig({ CONTENT_MODE: 'external' }), /Only Gemini/);
  const c = fixture(0); assert.equal(nearDuplicate(c, { ...c, providerId: 'different' }), true);
  const raw = { title: 'One idea', summary: 'A summary', explanation: 'A detail', primaryTopicId: 'space', topicIds: ['space'] };
  assert.equal(prepare({ cards: [raw] }, liveConfig(), 1)[0].sources.length, 0);
  assert.throws(() => prepare({ cards: [{ ...raw, title: 'a'.repeat(101) }] }, liveConfig(), 1), /invalid_string/);
});
test('Gemini uses a header secret, structured output and refusal handling', async () => {
  const cfg = liveConfig(); let captured: RequestInit | undefined;
  const mock: typeof fetch = async (url, init) => {
    assert.ok(!String(url).includes(cfg.key!)); captured = init;
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"cards":[]}' }] } }] });
  };
  assert.deepEqual(await cloudGenerator(cfg, mock)('test'), { cards: [] });
  const headers = captured!.headers as Record<string,string>;
  assert.equal(headers['x-goog-api-key'], cfg.key);
  assert.ok(!captured!.body!.toString().includes(cfg.key!));
  await assert.rejects(cloudGenerator(cfg, async () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS' }] }))('test'), /refused_or_incomplete/);
  await assert.rejects(cloudGenerator(cfg, async () => new Response('', { status: 403 }))('test'), /credentials_or_access/);
});
test('HTTP authentication, validation and status never expose provider secrets', async () => {
  const cfg = liveConfig(); const backend = createBackend(cfg, new Store(':memory:'));
  // Stop timer: this test only exercises HTTP, all model calls above are mocks.
  backend.worker.stopped = true;
  await new Promise<void>(resolve => backend.server.listen(0, '127.0.0.1', resolve));
  const address = backend.server.address() as import('node:net').AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${url}/health`)).status, 200);
    assert.equal((await fetch(`${url}/v1/status`)).status, 401);
    const status = await fetch(`${url}/v1/status`, { headers: { Authorization: `Bearer ${token}` } });
    const text = await status.text(); assert.ok(!text.includes(cfg.key!)); assert.ok(!text.includes(token));
    const invalid = await fetch(`${url}/v1/sync`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}' });
    assert.equal(invalid.status, 400);
    const valid = await fetch(`${url}/v1/sync`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(inventory()) });
    assert.equal(valid.status, 200);
  } finally { await backend.close(); }
});

test('explicit uncertain retry requires confirmed free Gemini and preserves reservations', async () => {
  for (const paid of [false, true]) {
    const cfg = liveConfig(paid ? { ALLOW_PAID_CALLS: 'true', DAILY_COST_LIMIT: '1', MAX_REQUEST_COST: '0.1' } : {});
    const store = new Store(':memory:'); const backend = createBackend(cfg, store); backend.worker.stopped = true;
    await new Promise<void>(resolve => backend.server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(backend.server.address() as import('node:net').AddressInfo).port}`;
    try {
      const s = inventory(); store.sync(s, cfg); const job = store.activeJob(s.deviceId)!;
      store.reserveBudget(job, cfg); store.markJob(job.id, 'uncertain', 'upstream_timeout_or_network');
      assert.equal(store.sync(s, cfg).refillState, 'degraded');
      assert.equal(store.sync(s, cfg).refillReason, 'upstream_timeout_or_network');
      assert.equal(store.job(job.id)!.state, 'uncertain'); // sync alone never redispatches.
      const retry = () => fetch(`${url}/v1/jobs/${job.id}/retry`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      assert.equal((await retry()).status, paid ? 409 : 200);
      assert.equal(store.usage().requests, 1); // Previous attempt is never refunded.
      assert.equal(store.job(job.id)!.state, paid ? 'uncertain' : 'queued');
      assert.equal((await retry()).status, 409); // Repeated click cannot queue a second job.
      if (!paid) { store.reserveBudget(store.job(job.id)!, cfg); assert.equal(store.usage().requests, 2); }
    } finally { await backend.close(); }
  }
});

test('Gemini diagnostics retain exact overload and finish metadata without secrets or content', async () => {
  const cfg = liveConfig({ GEMINI_THINKING_LEVEL: 'low' }); let diagnostic: ProviderDiagnostic | undefined;
  await assert.rejects(cloudGenerator(cfg, async (_url, init) => {
    assert.equal(JSON.parse(String(init!.body)).generationConfig.thinkingConfig.thinkingLevel, 'low');
    return Response.json({ error: { code: 503, status: 'UNAVAILABLE', message: `High demand ${cfg.key} ${cfg.token} ?key=another-secret`, details: [{ secret: cfg.key }] } }, { status: 503 });
  })('public source prompt', value => diagnostic = value), /upstream_unavailable/);
  assert.equal(diagnostic!.httpStatus,503); assert.equal(diagnostic!.providerStatus,'UNAVAILABLE');
  assert.ok(!JSON.stringify(diagnostic).includes(cfg.key!)); assert.ok(!JSON.stringify(diagnostic).includes(cfg.token)); assert.ok(!JSON.stringify(diagnostic).includes('another-secret'));
  await assert.rejects(cloudGenerator(cfg, async () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ thought: true, text: 'private reasoning' }, { text: 'truncated' }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 2, thoughtsTokenCount: 8190, totalTokenCount: 8292 } }))('public source prompt', value => diagnostic = value), /refused_or_incomplete/);
  assert.equal(diagnostic!.finishReason,'MAX_TOKENS'); assert.equal(diagnostic!.thinkingTokens,8190); assert.equal(diagnostic!.outputTokens,2); assert.equal(diagnostic!.outputCharacters,9);
  assert.ok(!JSON.stringify(diagnostic).includes('private reasoning')); assert.ok(!JSON.stringify(diagnostic).includes('truncated'));
  const store = new Store(':memory:'); const s = inventory(); store.sync(s,cfg);
  const worker = new Worker(cfg,store,cloudGenerator(cfg,async()=>Response.json({error:{status:'UNAVAILABLE',message:'High demand'}},{status:503})));
  const started=Date.now(); await worker.tick();
  const row=store.db.prepare('SELECT diagnostics,next_at,state FROM jobs').get() as {diagnostics:string;next_at:number;state:string};
  assert.equal(JSON.parse(row.diagnostics).httpStatus,503); assert.equal(row.state,'failed');
  assert.ok(store.cooldowns()[0].failed_at>=started); assert.equal(store.usage().requests,1); store.close();
});

test('429 and 503 cooldowns survive restart, skip failed layers for new jobs, and expire exactly one hour after failure', async () => {
  for (const httpStatus of [429,503]) {
    const dir=mkdtempSync(join(tmpdir(),'jigyabyte-cooldown-')),path=join(dir,'backend.sqlite');
    const cfg=liveConfig({GEMINI_FALLBACK_MODELS:'second,third',DAILY_TOKEN_LIMIT:'725760'});
    let store=new Store(path);const calls:string[]=[];
    const generator=(route:typeof cfg)=>cloudGenerator(route,async()=>{
      calls.push(route.model!);return Response.json({error:{status:httpStatus===429?'RESOURCE_EXHAUSTED':'UNAVAILABLE'}},{status:httpStatus});
    });
    try {
      store.sync(inventory(),cfg);await new Worker(cfg,store,generator(cfg),generator).tick();
      const failedAt=store.cooldowns()[0].failed_at;
      store.markJob(store.jobs()[0].id,'failed','fixture-finished');store.close();store=new Store(path);
      const next={...inventory(),deviceId:'second-device'};store.sync(next,cfg);
      const worker=new Worker(cfg,store,generator(cfg),generator);await worker.tick();
      assert.deepEqual(calls,['mock-model','second']);
      assert.equal(store.usage().requests,2);
      const routes=providerRoutes(cfg);
      assert.equal(availableRoute(routes,store.cooldowns(),0,failedAt+MODEL_COOLDOWN_MS-1),2);
      assert.equal(availableRoute(routes,store.cooldowns(),0,failedAt+MODEL_COOLDOWN_MS),0);
      // A later failure restarts that model's hour; skipped requests never change its timestamp.
      store.coolModel(cfg,'quota_exhausted',failedAt+1000);
      assert.notEqual(availableRoute(routes,store.cooldowns(),0,failedAt+MODEL_COOLDOWN_MS),0);
      assert.equal(availableRoute(routes,store.cooldowns(),0,failedAt+1000+MODEL_COOLDOWN_MS),0);
      assert.equal(store.usage().requests,2);
    } finally {store.close();rmSync(dir,{recursive:true,force:true});}
  }
});
