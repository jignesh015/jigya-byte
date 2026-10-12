import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readConfig } from '../src/config.ts';
import { TOPICS, snapshot } from '../src/contracts/index.ts';
import { prepare, prompt, outputSchema, topicGuidance } from '../src/preparation/cards.ts';
import { Store } from '../src/storage/store.ts';
import { Worker } from '../src/jobs/worker.ts';

const additions = ['literature', 'tech-tips', 'game-industry-stories', 'ai-updates', 'agentic-coding',
  'game-industry-news', 'indie-games', 'current-affairs', 'general-knowledge', 'cinema'];
const config = () => readConfig({ BACKEND_DEVICE_TOKEN: randomBytes(32).toString('hex'),
  GENERATION_PROVIDER: 'gemini', GEMINI_API_KEY: 'fixture-only', GEMINI_MODEL: 'mock-model', GEMINI_FREE_TIER_CONFIRMED: 'true' });
const rawCard = (topic: string) => ({ title: `Distinct ${topic}`, summary: `Takeaway for ${topic}`,
  explanation: `A fixture explanation for ${topic}.`, primaryTopicId: topic, topicIds: [topic] });
const inventory = () => snapshot({ protocolVersion: 1, deviceId: 'topics-fixture', inventoryVersion: 1,
  snapshotComplete: true, counts: { unread: 0, readNonFavorite: 0, favorites: 0 }, retainedCards: [],
  interestTopicIds: additions, historyEvents: [], pendingDeliveryIds: [] });

test('new topics accept interests, history and prepared cards while rejecting unknown topics', () => {
  assert.deepEqual(TOPICS.slice(10), additions);
  const cards = prepare({ cards: additions.map(rawCard) }, config(), 10);
  const s = inventory();
  s.historyEvents = cards.map(c => ({ eventId: `seen:${c.id}`, id: c.id, contentHash: c.contentHash,
    primaryTopicId: c.primaryTopicId, seen: true, expanded: false }));
  assert.equal(snapshot(s).historyEvents.length, 10);
  assert.ok(cards.every(c => c.promptVersion === '5'));
  assert.throws(() => snapshot({ ...s, interestTopicIds: ['unknown-topic'] }), /invalid_topic/);
  assert.throws(() => prepare({ cards: [rawCard('unknown-topic')] }, config(), 1), /invalid_topic/);
});

test('topic guidance and dated-news guard fit the default request budget', () => {
  const text = prompt(additions, Array.from({ length: 15 }, () => 'x'.repeat(100)), new Date('2026-10-12T00:00:00Z'));
  for (const topic of additions) assert.ok(text.includes(topicGuidance[topic]));
  assert.match(text, /2026-10-12 UTC/);
  assert.match(text, /Never describe remembered events as latest/);
  assert.match(text, /Bollywood or Hollywood/);
  assert.ok(Buffer.byteLength(text + JSON.stringify(outputSchema)) <= config().maxInput);
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
