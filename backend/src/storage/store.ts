import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Card, History, Snapshot } from '../contracts/index.ts';
import { Failure } from '../contracts/index.ts';
import type { Config } from '../config.ts';
import { nearDuplicate } from '../preparation/cards.ts';

export type Job = { id: string; device_id: string; count: number; state: string; attempts: number; provider_index: number; diagnostics: string | null; next_at: number; error: string | null };
export type Delivery = { id: string; device_id: string; version: number; cards: string; state: string; result: string | null };
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version > 4) throw new Error('Unsupported backend database version');
    if (!version) this.db.exec(`BEGIN;
      CREATE TABLE cards(id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, fingerprint TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
      CREATE TABLE devices(id TEXT PRIMARY KEY, version INTEGER NOT NULL, snapshot TEXT NOT NULL);
      CREATE TABLE history(device_id TEXT NOT NULL, event_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(device_id,event_id));
      CREATE TABLE deliveries(id TEXT PRIMARY KEY, device_id TEXT NOT NULL, version INTEGER NOT NULL, cards TEXT NOT NULL, state TEXT NOT NULL, result TEXT);
      CREATE UNIQUE INDEX one_pending_delivery ON deliveries(device_id) WHERE state='pending';
      CREATE TABLE jobs(id TEXT PRIMARY KEY, device_id TEXT NOT NULL, count INTEGER NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, error TEXT);
      CREATE UNIQUE INDEX one_active_job ON jobs(device_id) WHERE state IN ('queued','running','uncertain');
      CREATE TABLE usage(day TEXT PRIMARY KEY, requests INTEGER NOT NULL, tokens INTEGER NOT NULL, cost REAL NOT NULL);
      CREATE TABLE sources(id TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at INTEGER NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
    if (version < 2) this.db.exec(`BEGIN;
      ALTER TABLE devices ADD COLUMN refilling INTEGER NOT NULL DEFAULT 0;
      PRAGMA user_version=2; COMMIT;`);
    if (version < 3) this.db.exec(`BEGIN; ALTER TABLE jobs ADD COLUMN diagnostics TEXT; PRAGMA user_version=3; COMMIT;`);
    if (version < 4) this.db.exec(`BEGIN; ALTER TABLE jobs ADD COLUMN provider_index INTEGER NOT NULL DEFAULT 0; ALTER TABLE jobs ADD COLUMN attempt_log TEXT NOT NULL DEFAULT '[]'; PRAGMA user_version=4; COMMIT;`);
    // A crash after dispatch is ambiguous. Do not repeat a potentially charged request.
    this.db.prepare("UPDATE jobs SET state='uncertain', error='interrupted_request_requires_reconciliation' WHERE state='running'").run();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
  cards(): Card[] { return (this.db.prepare('SELECT body FROM cards ORDER BY rowid').all() as { body: string }[]).map(r => JSON.parse(r.body)); }
  addCards(cards: Card[], limit: number) {
    let added = 0;
    this.transaction(() => {
      const existing = this.cards();
      for (const card of cards) {
        if (existing.length >= limit) break;
        if (existing.some(c => nearDuplicate(c, card))) continue;
        this.db.prepare('INSERT INTO cards VALUES (?,?,?,?)').run(card.id, card.contentHash, card.ideaFingerprint, JSON.stringify(card));
        existing.push(card); added++;
      }
    });
    return added;
  }
  getSnapshot(device: string): Snapshot | null {
    const row = this.db.prepare('SELECT snapshot FROM devices WHERE id=?').get(device) as { snapshot: string } | undefined;
    return row ? JSON.parse(row.snapshot) : null;
  }
  saveSnapshot(s: Snapshot) {
    const prior = this.getSnapshot(s.deviceId);
    if (prior && s.inventoryVersion < prior.inventoryVersion) throw new Failure('stale_inventory', 409);
    if (prior && s.inventoryVersion === prior.inventoryVersion) {
      const inventory = (v: Snapshot) => JSON.stringify({ counts: v.counts, retained: [...v.retainedCards].sort((a,b) => a.id.localeCompare(b.id)), interests: [...v.interestTopicIds].sort() });
      if (inventory(prior) !== inventory(s)) throw new Failure('inventory_version_conflict', 409);
    }
    this.db.prepare('INSERT INTO devices(id,version,snapshot) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,snapshot=excluded.snapshot').run(s.deviceId, s.inventoryVersion, JSON.stringify(s));
    this.addHistory(s.deviceId, s.historyEvents);
  }
  addHistory(device: string, events: History[]) {
    for (const event of events) {
      const prior = this.db.prepare('SELECT body FROM history WHERE device_id=? AND event_id=?').get(device, event.eventId) as { body: string } | undefined;
      if (prior && prior.body !== JSON.stringify(event)) throw new Failure('history_event_conflict', 409);
      this.db.prepare('INSERT OR IGNORE INTO history VALUES (?,?,?)').run(device, event.eventId, JSON.stringify(event));
    }
  }
  histories(device: string): History[] {
    return (this.db.prepare('SELECT body FROM history WHERE device_id=?').all(device) as { body: string }[]).map(r => JSON.parse(r.body));
  }
  delivery(id: string): Delivery | null { return this.db.prepare('SELECT * FROM deliveries WHERE id=?').get(id) as Delivery ?? null; }
  pending(device: string): Delivery | null { return this.db.prepare("SELECT * FROM deliveries WHERE device_id=? AND state='pending'").get(device) as Delivery ?? null; }
  activeJob(device: string): Job | null { return this.db.prepare("SELECT * FROM jobs WHERE device_id=? AND state IN ('queued','running','uncertain')").get(device) as Job ?? null; }
  job(id: string): Job | null { return this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as Job ?? null; }
  jobs(): Job[] { return this.db.prepare('SELECT * FROM jobs ORDER BY rowid DESC LIMIT 100').all() as Job[]; }
  isRefilling(device: string): boolean {
    return (this.db.prepare('SELECT refilling FROM devices WHERE id=?').get(device) as { refilling: number } | undefined)?.refilling === 1;
  }
  queue(device: string, amount: number) {
    const id = randomUUID();
    this.db.prepare("INSERT INTO jobs(id,device_id,count,state) VALUES (?,?,?,'queued')").run(id, device, amount);
    return id;
  }
  markJob(id: string, state: string, error: string | null = null, next = 0) {
    this.db.prepare('UPDATE jobs SET state=?,error=?,next_at=? WHERE id=?').run(state, error, next, id);
  }
  candidates(s: Snapshot): Card[] {
    const refs = [...s.retainedCards, ...this.histories(s.deviceId)];
    return this.cards().filter(c => !refs.some(r => r.id === c.id || r.contentHash === c.contentHash || r.ideaFingerprint === c.ideaFingerprint));
  }
  sync(s: Snapshot, config: Config) {
    return this.transaction(() => {
      this.saveSnapshot(s);
      let pending = this.pending(s.deviceId);
      if (s.counts.unread <= config.refillAt) this.db.prepare('UPDATE devices SET refilling=1 WHERE id=?').run(s.deviceId);
      if (s.counts.unread >= config.target) this.db.prepare('UPDATE devices SET refilling=0 WHERE id=?').run(s.deviceId);
      const deficit = this.isRefilling(s.deviceId) ? Math.max(0, config.target - s.counts.unread) : 0;
      const candidates = this.candidates(s);
      if (!pending && deficit) {
        const cards = candidates.slice(0, Math.min(10, deficit));
        if (cards.length) {
          const id = randomUUID();
          this.db.prepare("INSERT INTO deliveries VALUES (?,?,?,?,'pending',NULL)").run(id, s.deviceId, s.inventoryVersion, JSON.stringify(cards));
          pending = this.delivery(id);
        }
      }
      const reserved = pending ? (JSON.parse(pending.cards) as Card[]).length : 0;
      const remaining = Math.max(0, deficit - reserved);
      let job = this.activeJob(s.deviceId);
      // Unacknowledged delivery is a barrier: no unlimited generation while a device disappears.
      if (!pending && remaining && !job && candidates.length === 0 && config.provider !== 'disabled' && this.cards().length < config.cacheLimit) {
        const recent = this.db.prepare('SELECT error FROM jobs WHERE device_id=? ORDER BY rowid DESC LIMIT 1').get(s.deviceId) as { error: string | null } | undefined;
        if (!recent?.error) job = this.job(this.queue(s.deviceId, Math.min(config.batch, remaining)));
      }
      const last = this.jobs().find(j => j.device_id === s.deviceId);
      return { protocolVersion: 1, deliveryId: pending?.id ?? null, forInventoryVersion: pending?.version ?? s.inventoryVersion,
        cards: pending ? JSON.parse(pending.cards) as Card[] : [], acknowledgedEventIds: s.historyEvents.map(e => e.eventId),
        reportedUnread: s.counts.unread, refillJobId: job?.id ?? null,
        refillReason: job?.error ?? last?.error ?? null,
        refillState: pending || !deficit ? 'ready' : job ? (job.state === 'uncertain' ? 'degraded' : 'pending') :
          last?.error === 'budget_exhausted' ? 'budget_exhausted' : last?.error === 'quota_exhausted' ? 'quota_exhausted' : config.provider === 'disabled' ? 'disabled' : 'degraded' };
    });
  }
  acknowledge(id: string, s: Snapshot, accepted: string[], rejected: string[]) {
    return this.transaction(() => {
      const d = this.delivery(id);
      if (!d || d.device_id !== s.deviceId) throw new Failure('delivery_not_found', 404);
      const result = JSON.stringify({ accepted: [...accepted].sort(), rejected: [...rejected].sort() });
      if (d.state === 'acked') {
        if (d.result !== result) throw new Failure('ack_conflict', 409);
        return { acknowledged: true, deliveryId: id }; // Safe lost-response retry, even with an older snapshot.
      }
      const cards = JSON.parse(d.cards) as Card[];
      const all = [...accepted, ...rejected];
      if (new Set(all).size !== all.length || all.length !== cards.length || all.some(v => !cards.some(c => c.id === v))) throw new Failure('invalid_ack');
      if (s.inventoryVersion <= d.version) throw new Failure('ack_requires_new_inventory_version', 409);
      if (accepted.some(v => {
        const card = cards.find(c => c.id === v)!;
        return !s.retainedCards.some(r => r.id === v && r.contentHash === card.contentHash) &&
          !s.historyEvents.some(e => e.id === v && e.contentHash === card.contentHash && e.seen) &&
          !this.histories(s.deviceId).some(e => e.id === v && e.contentHash === card.contentHash && e.seen);
      })) throw new Failure('accepted_card_missing');
      this.saveSnapshot(s);
      // Every offered identity is excluded afterward, including rejected duplicates/invalid cards.
      this.addHistory(s.deviceId, cards.map(c => ({ eventId: `delivery:${id}:${c.id}`, id: c.id, contentHash: c.contentHash,
        primaryTopicId: c.primaryTopicId, seen: false, expanded: false, ideaFingerprint: c.ideaFingerprint })));
      this.db.prepare("UPDATE deliveries SET state='acked',result=? WHERE id=?").run(result, id);
      return { acknowledged: true, deliveryId: id };
    });
  }
  usage() {
    const day = new Date().toISOString().slice(0, 10);
    return this.db.prepare('SELECT requests,tokens,cost FROM usage WHERE day=?').get(day) as { requests: number; tokens: number; cost: number } ?? { requests: 0, tokens: 0, cost: 0 };
  }
  reserveBudget(job: Job, config: Config) {
    this.transaction(() => {
      const use = this.usage(), tokens = config.maxInput + config.maxOutput, cost = config.paid ? config.requestCost : 0;
      if (use.requests + 1 > config.requestLimit || use.tokens + tokens > config.tokenLimit || use.cost + cost > config.costLimit) throw new Failure('budget_exhausted');
      const day = new Date().toISOString().slice(0,10);
      this.db.prepare('INSERT INTO usage VALUES (?,?,?,?) ON CONFLICT(day) DO UPDATE SET requests=requests+excluded.requests,tokens=tokens+excluded.tokens,cost=cost+excluded.cost').run(day, 1, tokens, cost);
      this.db.prepare("UPDATE jobs SET state='running', attempts=attempts+1 WHERE id=?").run(job.id);
    });
  }
}
