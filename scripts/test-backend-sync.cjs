const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const inventory = { deviceId: 'fixture', counts: { unread: 60 }, historyEvents: [] };
const repository = { getAvoidanceOutbox: async () => ({ deviceId: 'fixture', subjects: [] }), acknowledgeAvoidance: async () => {}, getInventory: async () => inventory, getDeliveryOutbox: async () => [],
  acknowledgeHistory: async () => {}, clearDeliveryOutbox: async () => {}, importBackendDelivery: async () => {} };
const intervals = new Map(); let nextTimer = 0;
const exported = {};
const code = ts.transpileModule(fs.readFileSync('src/data/backendSync.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, { exports: exported, require: () => repository, fetch, AbortController, setTimeout, clearTimeout,
  setInterval: (callback, duration) => { const id = ++nextTimer; intervals.set(id, { callback, duration }); return id; },
  clearInterval: id => intervals.delete(id), console });
const { BackendSync } = exported;
const settings = { enabled: true, serviceUrl: 'https://example.org', pairingToken: 'fixture-only-token-'.repeat(3) };
(async () => {
  let latest, deferred, fail = false, delay = false;
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.endsWith('/v1/connection')) {
      if (delay) await new Promise(resolve => { deferred = resolve; });
      if (fail) throw new Error('raw upstream secret diagnostic must never appear');
      return Response.json({ protocolVersion: 1, provider: 'gemini', contentMode: 'ai-only',
        usage: { requests: 7 }, limits: { requests: 30 } });
    }
    return Response.json({ protocolVersion: 1, cards: [], acknowledgedEventIds: [], refillState: 'ready',
      usage: { requests: 8 }, limits: { requests: 30 },
      notification: { code: 'ready', kind: 'success', message: 'Your saved library is up to date.' } });
  };
  const sync = new BackendSync(status => { latest = status; }, async () => {}, { ...repository, fetch: fetcher });
  try {
    sync.configure(settings); await sync.handshake();
    assert.equal(intervals.size, 1); assert.equal([...intervals.values()][0].duration, 300000);
    assert.equal(calls.filter(url => url.endsWith('/v1/connection')).length, 1);
    assert.equal(latest.connection, 'connected');
    assert.equal(latest.dailyRequests.used, 7); assert.equal(latest.dailyRequests.total, 30);
    const openingNotice = latest.notification.id;
    await sync.run(); await sync.run();
    assert.equal(latest.notification.id, openingNotice, 'automatic ready syncs must not create a toast');
    assert.equal(calls.filter(url => url.endsWith('/v1/connection')).length, 1, 'ordinary sync must reuse the last handshake');
    assert.equal(latest.dailyRequests.used, 8);
    delay = true;
    const first = sync.refresh(), duplicate = sync.refresh();
    assert.equal(first, duplicate); assert.equal(latest.refreshing, true); assert.equal(latest.connection, 'connected');
    deferred(); await first; assert.equal(latest.refreshing, false); delay = false;
    assert.equal(latest.notification.message, 'Your saved library is up to date.', 'manual refresh retains ready confirmation');
    const manualNotice = latest.notification.id;
    await sync.run();
    assert.equal(latest.notification.id, manualNotice, 'reading after manual refresh must not repost its toast');
    assert.equal(calls.filter(url => url.endsWith('/v1/connection')).length, 2);
    fail = true;
    await sync.refresh();
    assert.equal(latest.connection, 'offline'); assert.equal(latest.refreshing, false);
    assert.equal(latest.notification.kind, 'error'); assert.ok(!latest.notification.message.includes('raw upstream'));
    const lastSuccess = latest.lastHandshakeAt;
    fail = false; delay = true;
    const recovering = sync.refresh(); assert.equal(latest.connection, 'offline');
    assert.equal(latest.lastHandshakeAt, lastSuccess); deferred(); await recovering; delay = false;
    assert.equal(latest.connection, 'connected');
    sync.foreground(false); assert.equal(intervals.size, 0);
    const beforeResume = calls.length; sync.foreground(true); await sync.handshake();
    assert.equal(calls[beforeResume], settings.serviceUrl + '/v1/connection'); assert.equal(intervals.size, 1);
    const heartbeats = calls.filter(url => url.endsWith('/v1/connection')).length;
    [...intervals.values()][0].callback(); await sync.handshake();
    assert.equal(calls.filter(url => url.endsWith('/v1/connection')).length, heartbeats + 1);
    console.log('PASS: compact handshake on open/resume, five-minute timer, no handshake per sync, guarded refresh, usage updates, friendly errors and last-handshake connection color.');
  } finally { sync.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
