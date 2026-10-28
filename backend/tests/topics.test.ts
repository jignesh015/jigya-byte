import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readConfig } from '../src/config.ts';
import { TOPICS, snapshot } from '../src/contracts/index.ts';
import { prepare, prompt, outputSchema, topicGuidance } from '../src/preparation/cards.ts';
import { Store } from '../src/storage/store.ts';
import { Worker } from '../src/jobs/worker.ts';

const additions = ['literature', 'tech-tips', 'game-industry-stories', 'ai-updates', 'agentic-coding',
  'game-industry-news', 'indie-games', 'current-affairs', 'general-knowledge', 'cinema',
  'ancient-history', 'indian-history', 'ancient-india', 'indian-myths-and-epics', 'art', 'product-design', 'ux'];
const config = () => readConfig({ BACKEND_DEVICE_TOKEN: randomBytes(32).toString('hex'),
  GENERATION_PROVIDER: 'gemini', GEMINI_API_KEY: 'fixture-only', GEMINI_MODEL: 'mock-model', GEMINI_FREE_TIER_CONFIRMED: 'true' });
const rawCard = (topic: string) => ({ title: `Distinct ${topic}`, summary: `Takeaway for ${topic}`,
  explanation: `A fixture explanation for ${topic}.`, primaryTopicId: topic, topicIds: [topic] });
const inventory = () => snapshot({ protocolVersion: 1, deviceId: 'topics-fixture', inventoryVersion: 1,
  snapshotComplete: true, counts: { unread: 0, readNonFavorite: 0, favorites: 0 }, retainedCards: [],
  interestTopicIds: additions, historyEvents: [], pendingDeliveryIds: [] });

test('new topics accept interests, history and prepared cards while rejecting unknown topics', () => {
  assert.deepEqual(TOPICS.slice(10), additions);
  assert.equal(TOPICS.filter(topic => topic === 'philosophy').length, 1);
  const cards = prepare({ cards: additions.map(rawCard) }, config(), additions.length);
  const s = inventory();
  s.historyEvents = cards.map(c => ({ eventId: `seen:${c.id}`, id: c.id, contentHash: c.contentHash,
    primaryTopicId: c.primaryTopicId, seen: true, expanded: false }));
  assert.equal(snapshot(s).historyEvents.length, additions.length);
  assert.ok(cards.every(c => c.promptVersion === '7'));
  assert.throws(() => snapshot({ ...s, interestTopicIds: ['unknown-topic'] }), /invalid_topic/);
  assert.throws(() => prepare({ cards: [rawCard('unknown-topic')] }, config(), 1), /invalid_topic/);
});

test('topic guidance covers the expanded catalog and retains the dated-news guard', () => {
  const guidedTopics = [...additions, 'philosophy'];
  const text = prompt(guidedTopics, Array.from({ length: 15 }, () => 'x'.repeat(100)), new Date('2026-10-12T00:00:00Z'));
  for (const topic of guidedTopics) assert.ok(topicGuidance[topic] && text.includes(topicGuidance[topic]));
  assert.match(text, /2026-10-12 UTC/);
  assert.match(text, /Never describe remembered events as latest/);
  assert.match(text, /Bollywood or Hollywood/);
  assert.match(text, /not verified historical events/);
  assert.match(text, /distinguish a position from a settled fact/);
});

test('default generation budget supports new evergreen topics without raising limits', async () => {
  const store = new Store(':memory:');
  try {
    const cfg = { ...config(), liveSources: false }; const s = inventory();
    const requestedTopics = [...TOPICS.slice(20), 'philosophy'];
    // Existing subjects have already received cards; the new subjects start at zero.
    for (const topic of TOPICS.filter(topic => !requestedTopics.includes(topic))) {
      store.db.prepare('INSERT INTO topic_generation VALUES (?,?)').run(topic, 10);
    }
    store.sync(s, cfg);
    let requested: string[] = [];
    const worker = new Worker(cfg, store, async text => {
      assert.ok(Buffer.byteLength(text + JSON.stringify(outputSchema)) <= cfg.maxInput);
      requested = JSON.parse(text.match(/in this order: (\[[^\n]+\])/u)![1]);
      return { cards: requested.map((topic, i) => ({ ...rawCard(topic), title: `New subject word${i}` })) };
    });
    await worker.tick();
    assert.ok(requestedTopics.every(topic => requested.includes(topic)));
    assert.equal(store.jobs()[0].state, 'completed');
    assert.equal(store.usage().requests, 1);
    for (const topic of requestedTopics) assert.ok(store.topicCounts()[topic] >= 1);
  } finally { store.close(); }
});

test('worker uses a broad random topic pool without interest weighting', async () => {
  const store = new Store(':memory:');
  try {
    const cfg = { ...config(), liveSources: false, batch: 30, maxOutput: 16000, maxInput: 16000 }; const s = inventory(); s.interestTopicIds = ['agentic-coding', 'cinema'];
    store.sync(s, cfg);
    let requested: string[] = [];
    const worker = new Worker(cfg, store, async text => {
      requested = JSON.parse(text.match(/in this order: (\[[^\n]+\])/u)![1]);
      return { cards: requested.map((topic, i) => ({ ...rawCard(topic), title: `Unique word${i}`, summary: `Takeaway word${i}` })) };
    });
    await worker.tick();
    assert.ok(TOPICS.every(topic => requested.includes(topic)));
    assert.equal(store.jobs()[0].state, 'completed');
    const delivered = store.sync(s, cfg).cards;
    assert.equal(delivered.length, 10);
    assert.equal(store.cards().length, 30);
    assert.equal(store.usage().requests, 1);
  } finally { store.close(); }
});
