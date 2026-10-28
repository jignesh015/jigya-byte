import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store.ts';
import { readConfig } from '../src/config.ts';
import { avoidanceBatch, snapshot } from '../src/contracts/index.ts';
import { prepare, prompt } from '../src/preparation/cards.ts';
import { Worker } from '../src/jobs/worker.ts';
import { createBackend } from '../src/server.ts';

const config = readConfig({ BACKEND_DEVICE_TOKEN: 'fixture-only-token-'.repeat(3), BACKEND_DATABASE: ':memory:',
  GENERATION_PROVIDER: 'gemini', GEMINI_API_KEY: 'fixture', GEMINI_MODEL: 'fixture', GEMINI_FREE_TIER_CONFIRMED: 'true',
  LIVE_SOURCES_ENABLED: 'false', GENERATION_BATCH_SIZE: '1' });
const inventory = () => snapshot({ protocolVersion: 1, deviceId: 'phone', inventoryVersion: 1, snapshotComplete: true,
  counts: { unread: 0, favorites: 0, readNonFavorite: 0 }, retainedCards: [], interestTopicIds: [], historyEvents: [], pendingDeliveryIds: [] });
const blocked = { subject: 'octopus arms taste with suckers', topicIds: ['biology', 'science'] };
const card = (title: string, subject: string, topic = 'biology') => prepare({ cards: [{ subject, title,
  summary: `${subject}.`, explanation: 'A fixture explanation.', primaryTopicId: topic, topicIds: [topic] }] }, config, 1)[0];

test('Never stores one compact subject across retries/restarts; same-topic alternatives remain eligible', () => {
  const folder = mkdtempSync(join(tmpdir(), 'jigyabyte-never-')), path = join(folder, 'test.db');
  let store = new Store(path);
  try {
    const denied = card('An unexpected tasting tool', blocked.subject);
    const reworded = { ...card('Each arm samples dinner', blocked.subject, 'science'), summary: 'Chemicals are sensed using receptors in the suckers.' };
    const allowed = card('A second set of eyelids', 'camel eyes have three eyelids');
    store.addCards([denied, reworded, allowed], 5000);
    store.addAvoidedSubjects('phone', [blocked]); store.addAvoidedSubjects('phone', [blocked]);
    assert.equal(store.avoidedSubjects('phone').length, 1);
    assert.deepEqual(store.candidates(inventory()).map(c => c.id), [allowed.id]);
    assert.equal(store.candidates({ ...inventory(), deviceId: 'other' }).length, 3);
    const usage = store.usage(); store.close(); store = new Store(path);
    assert.equal(store.avoidedSubjects('phone').length, 1);
    assert.deepEqual(store.usage(), usage);
    assert.equal(store.addCards([card('Yet another title', blocked.subject)], 5000, 'phone'), 0);
    assert.equal((store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 9);
  } finally { store.close(); rmSync(folder, { recursive: true }); }
});

test('canonical subject metadata is bounded; legacy cards remain readable and exclusions are data', () => {
  assert.throws(() => card('Invalid label', 'biology'), /invalid_subject/);
  assert.throws(() => card('Long label', 'x'.repeat(97)), /invalid_string/);
  assert.equal(card('New card', blocked.subject).subject, blocked.subject);
  assert.throws(() => avoidanceBatch({ protocolVersion: 1, deviceId: 'phone', subjects: Array(101).fill(blocked) }), /invalid_array/);
  assert.throws(() => avoidanceBatch({ protocolVersion: 1, deviceId: 'phone', subjects: [{ ...blocked, topicIds: ['unknown'] }] }), /invalid_topic/);
  const uniqueSubject = 'camel eyes have three eyelids';
  const text = prompt(['biology'], [], new Date(), [], [uniqueSubject, uniqueSubject]);
  assert.match(text, /different wording, titles, examples or topic tags/);
  assert.equal(text.split(uniqueSubject).length - 1, 1);
});

test('worker supplies compact exclusions and rejects a blocked result even if Never arrived during generation', async () => {
  const store = new Store(':memory:');
  try {
    store.sync(inventory(), config);
    store.addAvoidedSubjects('phone', [{ subject: 'specific excluded fact', topicIds: ['space'] }]);
    let calls = 0;
    const worker = new Worker(config, store, async text => {
      calls++;
      // At dispatch every relevant exclusion is sent, without card explanations.
      if (text.includes('"space"')) assert.ok(text.includes('specific excluded fact'));
      store.addAvoidedSubjects('phone', [blocked]);
      return { cards: [{ subject: blocked.subject, title: 'Reworded again', summary: 'An arm tastes food.',
        explanation: 'Fixture explanation.', primaryTopicId: 'biology', topicIds: ['biology'] }] };
    });
    await worker.tick();
    assert.equal(calls, 1); assert.equal(store.cards().length, 0); assert.equal(store.usage().requests, 1);
  } finally { store.close(); }
});

test('authenticated preference API is idempotent and never queues generation or reserves usage', async () => {
  const store = new Store(':memory:'), backend = createBackend(config, store);
  backend.worker.stopped = true;
  await new Promise<void>(resolve => backend.server.listen(0, '127.0.0.1', resolve));
  try {
    const address = backend.server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/v1/avoidance/batches`;
    const payload = { protocolVersion: 1, deviceId: 'phone', subjects: [blocked] };
    const options = { method: 'POST', body: JSON.stringify(payload), headers: { Authorization: `Bearer ${config.token}` } };
    assert.equal((await fetch(url, { ...options, headers: {} })).status, 401);
    for (let i = 0; i < 2; i++) {
      const response = await fetch(url, options); assert.equal(response.status, 200);
      assert.deepEqual((await response.json() as { acknowledgedSubjects: string[] }).acknowledgedSubjects, [blocked.subject]);
    }
    assert.equal(store.avoidedSubjects('phone').length, 1); assert.equal(store.jobs().length, 0);
    assert.equal(store.usage().requests, 0);
  } finally { await backend.close(); }
});
