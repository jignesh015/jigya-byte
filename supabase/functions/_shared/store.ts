import { randomUUID, randomInt } from 'node:crypto';
import type { Card, History, Snapshot } from '../../../backend/src/contracts/index.ts';
import { Failure } from '../../../backend/src/contracts/index.ts';
import type { Config } from '../../../backend/src/config.ts';
import { avoidsCard, normalizeSubject, type AvoidedSubject } from '../../../src/data/subjectAvoidance.ts';
import { nearDuplicate } from '../../../backend/src/preparation/cards.ts';
import { generationBatchSize, providerRoutes } from '../../../backend/src/config.ts';
import { NEWS_TOPICS } from '../../../backend/src/sources/live.ts';
import postgres from 'postgres';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Job, Delivery } from '../../../backend/src/storage/store.ts';
import type { ProviderDiagnostic } from '../../../backend/src/providers/cloud.ts';
import type { ModelCooldown } from '../../../backend/src/providers/routing.ts';
import { requestFeedback } from '../../../backend/src/jobs/feedback.ts';

type Query = (query: string, args?: any[]) => Promise<any[]>;
type ClaimedJob = Job & { claim_token: string };
const tables = 'cards|devices|history|deliveries|jobs|usage|source_cache|topic_generation|source_usage|settings|model_cooldowns|avoided_subjects';
function dialect(query: string): string {
  const ignore = query.includes('INSERT OR IGNORE');
  query = query.replace('INSERT OR IGNORE', 'INSERT').replaceAll('rowid', 'seq');
  query = query.replace(new RegExp(`\\b(FROM|INTO|UPDATE|JOIN)\\s+(${tables})\\b`, 'gi'), '$1 jigyabyte.$2');
  let parameter = 0;
  query = query.replace(/\?/g, () => `$${++parameter}`);
  return query + (ignore ? ' ON CONFLICT DO NOTHING' : '');
}

export class PostgresStore {
  private pool;
  private context = new AsyncLocalStorage<Query>();
  constructor(url: string, local = false) {
    this.pool = postgres(url, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5,
      ssl: local ? false : 'require', types: { bigint: postgres.BigInt } });
  }
  // Integers in the protocol fit in JS's safe range. postgres.BigInt is normalized here.
  private async query(query: string, args: any[] = []): Promise<any[]> {
    const run = this.context.getStore() ?? ((q: string, a: any[]) => this.pool.unsafe(q, a));
    const rows = await run(dialect(query), args);
    return rows.map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
  }
  db = { prepare: (query: string) => ({
    all: (...args: any[]) => this.query(query, args),
    get: async (...args: any[]) => (await this.query(query, args))[0],
    run: (...args: any[]) => this.query(query, args),
  }) };
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return await fn();
    return await this.pool.begin(async sql => {
      // Personal backend: serialize mutations, including delivery creation and daily reservations.
      await sql`select pg_advisory_xact_lock(431913)`;
      return await this.context.run((q, a = []) => sql.unsafe(q, a), fn);
    }) as T;
  }
  async close() { await this.pool.end({ timeout: 5 }); }
  async avoidedSubjects(device: string): Promise<AvoidedSubject[]> {
    return (await this.db.prepare('SELECT subject,topic_ids FROM avoided_subjects WHERE device_id=? ORDER BY subject').all(device))
      .map(r => ({ subject: r.subject, topicIds: JSON.parse(r.topic_ids) }));
  }
  async addAvoidedSubjects(device: string, entries: AvoidedSubject[]) {
    await this.transaction(async () => {
      for (const entry of entries) {
        const subject = normalizeSubject(entry.subject);
        const prior = await this.db.prepare('SELECT topic_ids FROM avoided_subjects WHERE device_id=? AND subject=?').get(device, subject);
        const topicIds = [...new Set([...(prior ? JSON.parse(prior.topic_ids) : []), ...entry.topicIds])].sort();
        await this.db.prepare('INSERT INTO avoided_subjects VALUES (?,?,?) ON CONFLICT(device_id,subject) DO UPDATE SET topic_ids=excluded.topic_ids').run(device,subject,JSON.stringify(topicIds));
      }
    });
  }
  async cooldowns(): Promise<ModelCooldown[]> { return await this.db.prepare('SELECT * FROM model_cooldowns').all(); }
  async coolModel(config: Config, reason: string, now = Date.now()) {
    await this.db.prepare('INSERT INTO model_cooldowns VALUES (?,?,?,?) ON CONFLICT(provider,model) DO UPDATE SET failed_at=excluded.failed_at,reason=excluded.reason')
      .run(config.provider, config.model!, now, reason);
  }
  async ready() { return (await this.db.prepare("SELECT value FROM settings WHERE key='migration_ready'").get())?.value === 'true'; }
  async claim(): Promise<ClaimedJob | null> {
    return await this.transaction(async () => {
      // An expired invocation may have dispatched Gemini: require explicit retry, retain its budget.
      await this.db.prepare("UPDATE jobs SET state='uncertain',error='interrupted_request_requires_reconciliation',claim_token=NULL WHERE state='running' AND lease_until<?").run(Date.now());
      if (await this.db.prepare("SELECT id FROM jobs WHERE state='running' LIMIT 1").get()) return null;
      const job = await this.db.prepare("SELECT * FROM jobs WHERE state='queued' AND next_at<=? ORDER BY seq LIMIT 1").get(Date.now());
      if (!job) return null;
      const token = randomUUID();
      await this.db.prepare("UPDATE jobs SET state='running',lease_until=?,claim_token=? WHERE id=?").run(Date.now()+180000, token, job.id);
      return { ...job, state: 'running', claim_token: token };
    });
  }
  async owned<T>(job: ClaimedJob, fn: () => Promise<T>): Promise<T> {
    return await this.transaction(async () => {
      const current = await this.job(job.id) as ClaimedJob | null;
      if (!current || current.state !== 'running' || current.claim_token !== job.claim_token) throw new Failure('job_lease_lost',409);
      return await fn();
    });
  }
  async diagnostic(job: ClaimedJob, diagnostic: ProviderDiagnostic) {
    await this.owned(job, async () => {
      await this.db.prepare("UPDATE jobs SET diagnostics=?,attempt_log=((attempt_log::jsonb)||(?::text::jsonb))::text WHERE id=?")
        .run(JSON.stringify(diagnostic), JSON.stringify([diagnostic]), job.id);
    });
  }
  async finish(job: ClaimedJob, state: string, error: string | null = null, next = 0, advance = false) {
    await this.owned(job, async () => {
      await this.db.prepare('UPDATE jobs SET state=?,error=?,next_at=?,provider_index=provider_index+?,claim_token=NULL,lease_until=0 WHERE id=?')
        .run(state,error,Math.ceil(next),advance ? 1 : 0,job.id);
    });
  }
  async retry(id: string, config: Config) {
    return await this.transaction(async () => {
      const result = await this.job(id);
      if (!result) throw new Failure('job_not_found',404);
      const routes = providerRoutes(config), selected = routes[result.provider_index];
      const previous = result.diagnostics ? JSON.parse(result.diagnostics).provider : config.provider;
      if (result.state !== 'failed' && !(result.state === 'uncertain' && selected?.provider === 'gemini' && selected.freeConfirmed && !selected.paid && previous === 'gemini')) throw new Failure('job_cannot_retry',409);
      const active = await this.activeJob(result.device_id);
      if (active && active.id !== id) throw new Failure('refill_already_active',409);
      await this.db.prepare("UPDATE jobs SET state='queued',error=NULL,next_at=0,attempts=0,provider_index=0,diagnostics=NULL,attempt_log='[]',claim_token=NULL,lease_until=0 WHERE id=?").run(id);
      return { jobId:id,state:'queued' };
    });
  }

async cards(): Promise<Card[]> { return (await this.db.prepare('SELECT body FROM cards ORDER BY rowid').all() as {
    body: string;
}[]).map(r => JSON.parse(r.body)); }
async addCards(cards: Card[], limit: number, device?: string) {
    let added = 0;
    await this.transaction(async () => {
        const existing = await this.cards();
        const avoided = device ? await this.avoidedSubjects(device) : [];
        for (const card of cards) {
            if (avoidsCard(card, avoided) || existing.some(c => nearDuplicate(c, card)))
                continue;
            while (existing.length >= limit) {
                const oldest = existing.shift();
                if (!oldest)
                    break;
                await this.db.prepare('DELETE FROM cards WHERE id=?').run(oldest.id);
            }
            await this.db.prepare('INSERT INTO cards(id,hash,fingerprint,body) VALUES (?,?,?,?)').run(card.id, card.contentHash, card.ideaFingerprint, JSON.stringify(card));
            await this.db.prepare('INSERT INTO topic_generation VALUES (?,1) ON CONFLICT(topic) DO UPDATE SET count=topic_generation.count+1').run(card.primaryTopicId);
            for (const source of card.sources)
                await this.db.prepare('INSERT OR IGNORE INTO source_usage VALUES (?)').run(source.id);
            existing.push(card);
            added++;
        }
    });
    return added;
}
async getSnapshot(device: string): Promise<Snapshot | null> {
    const row = await this.db.prepare('SELECT snapshot FROM devices WHERE id=?').get(device) as {
        snapshot: string;
    } | undefined;
    return row ? JSON.parse(row.snapshot) : null;
}
async saveSnapshot(s: Snapshot) {
    const prior = await this.getSnapshot(s.deviceId);
    if (prior && s.inventoryVersion < prior.inventoryVersion)
        throw new Failure('stale_inventory', 409);
    if (prior && s.inventoryVersion === prior.inventoryVersion) {
        const inventory = (v: Snapshot) => JSON.stringify({ counts: v.counts, retained: [...v.retainedCards].sort((a, b) => a.id.localeCompare(b.id)), interests: [...v.interestTopicIds].sort() });
        if (inventory(prior) !== inventory(s))
            throw new Failure('inventory_version_conflict', 409);
    }
    await this.db.prepare('INSERT INTO devices(id,version,snapshot) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,snapshot=excluded.snapshot').run(s.deviceId, s.inventoryVersion, JSON.stringify(s));
    await this.addHistory(s.deviceId, s.historyEvents);
}
async addHistory(device: string, events: History[]) {
    for (const event of events) {
        const prior = await this.db.prepare('SELECT body FROM history WHERE device_id=? AND event_id=?').get(device, event.eventId) as {
            body: string;
        } | undefined;
        if (prior && prior.body !== JSON.stringify(event))
            throw new Failure('history_event_conflict', 409);
        await this.db.prepare('INSERT OR IGNORE INTO history VALUES (?,?,?)').run(device, event.eventId, JSON.stringify(event));
    }
}
async histories(device: string): Promise<History[]> {
    return (await this.db.prepare('SELECT body FROM history WHERE device_id=?').all(device) as {
        body: string;
    }[]).map(r => JSON.parse(r.body));
}
async delivery(id: string) { return await this.db.prepare('SELECT * FROM deliveries WHERE id=?').get(id) as Delivery ?? null; }
async pending(device: string) { return await this.db.prepare("SELECT * FROM deliveries WHERE device_id=? AND state='pending'").get(device) as Delivery ?? null; }
async activeJob(device: string) { return await this.db.prepare("SELECT * FROM jobs WHERE device_id=? AND state IN ('queued','running','uncertain')").get(device) as Job ?? null; }
async job(id: string) { return await this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as Job ?? null; }
async jobs() { return await this.db.prepare('SELECT * FROM jobs ORDER BY rowid DESC LIMIT 100').all() as Job[]; }
async isRefilling(device: string) {
    return (await this.db.prepare('SELECT refilling FROM devices WHERE id=?').get(device) as {
        refilling: number;
    } | undefined)?.refilling === 1;
}
async queue(device: string, amount: number) {
    const id = randomUUID();
    await this.db.prepare("INSERT INTO jobs(id,device_id,count,state) VALUES (?,?,?,'queued')").run(id, device, amount);
    return id;
}
async markJob(id: string, state: string, error: string | null = null, next = 0) {
    await this.db.prepare('UPDATE jobs SET state=?,error=?,next_at=? WHERE id=?').run(state, error, next, id);
}
async candidates(s: Snapshot, requireNewsSources = false) {
    const refs = [...s.retainedCards, ...await this.histories(s.deviceId)];
    const now = Date.now();
    const avoided = await this.avoidedSubjects(s.deviceId);
    return (await this.cards()).filter(c => (!requireNewsSources || !NEWS_TOPICS.includes(c.primaryTopicId) || c.sources.length > 0)
        && !avoidsCard(c, avoided)
      && !refs.some(r => r.id === c.id || r.contentHash === c.contentHash || r.ideaFingerprint === c.ideaFingerprint)
        && (!c.sources.length || c.sources.every(source => now - Date.parse(source.publishedAt) <= 7 * 86400000)));
}
async topicCounts() {
    return Object.fromEntries((await this.db.prepare('SELECT topic,count FROM topic_generation').all() as {
        topic: string;
        count: number;
    }[]).map(r => [r.topic, r.count]));
}
async usedSourceIds() {
    return new Set((await this.db.prepare('SELECT id FROM source_usage').all() as {
        id: string;
    }[]).map(row => row.id));
}
async expireNews(requireSources = false) {
    // Delivery payloads are self-contained. Phone cards and history are untouched.
    for (const card of await this.cards())
        if (card.sources.some(source => Date.now() - Date.parse(source.publishedAt) > 7 * 86400000)
            || (requireSources && NEWS_TOPICS.includes(card.primaryTopicId) && !card.sources.length)) {
            await this.db.prepare('DELETE FROM cards WHERE id=?').run(card.id);
        }
}
async cachedSource(key: string) {
    const row = await this.db.prepare('SELECT fetched_at,body FROM source_cache WHERE key=?').get(key) as {
        fetched_at: number;
        body: string;
    } | undefined;
    return row ? { fetchedAt: row.fetched_at, body: JSON.parse(row.body) } : null;
}
async cacheSource(key: string, body: unknown) {
    await this.db.prepare('DELETE FROM source_cache WHERE fetched_at<?').run(Date.now() - 14 * 86400000);
    await this.db.prepare('INSERT INTO source_cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET fetched_at=excluded.fetched_at,body=excluded.body').run(key, Date.now(), JSON.stringify(body));
}
async sync(s: Snapshot, config: Config) {
    return await this.transaction(async () => {
        await this.saveSnapshot(s);
        await this.expireNews(config.liveSources);
        let pending = await this.pending(s.deviceId);
        if (s.counts.unread <= config.refillAt)
            await this.db.prepare('UPDATE devices SET refilling=1 WHERE id=?').run(s.deviceId);
        if (s.counts.unread >= config.target)
            await this.db.prepare('UPDATE devices SET refilling=0 WHERE id=?').run(s.deviceId);
        const deficit = await this.isRefilling(s.deviceId) ? Math.max(0, config.target - s.counts.unread) : 0;
        const candidates = await this.candidates(s, config.liveSources);
        if (!pending && deficit) {
            // Shuffle once, then persist the delivery so a lost response repeats identical cards.
            for (let i = candidates.length - 1; i > 0; i--) {
                const j = randomInt(i + 1);
                [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
            }
            const cards = candidates.slice(0, Math.min(10, deficit));
            if (cards.length) {
                const id = randomUUID();
                await this.db.prepare("INSERT INTO deliveries VALUES (?,?,?,?,'pending',NULL)").run(id, s.deviceId, s.inventoryVersion, JSON.stringify(cards));
                pending = await this.delivery(id);
            }
        }
        const reserved = pending ? (JSON.parse(pending.cards) as Card[]).length : 0;
        const remaining = Math.max(0, deficit - reserved);
        let job = await this.activeJob(s.deviceId);
        // Unacknowledged delivery is a barrier: no unlimited generation while a device disappears.
        if (!pending && remaining && !job && candidates.length === 0 && config.provider !== 'disabled') {
            const recent = await this.db.prepare('SELECT error FROM jobs WHERE device_id=? ORDER BY rowid DESC LIMIT 1').get(s.deviceId) as {
                error: string | null;
            } | undefined;
            if (!recent?.error)
                job = await this.job(await this.queue(s.deviceId, generationBatchSize(config)));
        }
        const last = (await this.jobs()).find(j => j.device_id === s.deviceId);
        return { protocolVersion: 1, deliveryId: pending?.id ?? null, forInventoryVersion: pending?.version ?? s.inventoryVersion,
            cards: pending ? JSON.parse(pending.cards) as Card[] : [], acknowledgedEventIds: s.historyEvents.map(e => e.eventId),
            reportedUnread: s.counts.unread, refillJobId: job?.id ?? null,
            refillReason: job?.error ?? last?.error ?? null,
            usage: await this.usage(), limits: { requests: config.requestLimit },
            retryJobId: !job && last?.state === 'failed' ? last.id : job?.state === 'uncertain' ? job.id : null,
            notification: requestFeedback(config, !!pending || !deficit, job, job?.error ?? last?.error),
            refillState: pending || !deficit ? 'ready' : job ? (job.state === 'uncertain' ? 'degraded' : 'pending') :
                last?.error === 'budget_exhausted' ? 'budget_exhausted' : last?.error === 'quota_exhausted' ? 'quota_exhausted' : config.provider === 'disabled' ? 'disabled' : 'degraded' };
    });
}
async acknowledge(id: string, s: Snapshot, accepted: string[], rejected: string[]) {
    return await this.transaction(async () => {
        const d = await this.delivery(id);
        if (!d || d.device_id !== s.deviceId)
            throw new Failure('delivery_not_found', 404);
        const result = JSON.stringify({ accepted: [...accepted].sort(), rejected: [...rejected].sort() });
        if (d.state === 'acked') {
            if (d.result !== result)
                throw new Failure('ack_conflict', 409);
            return { acknowledged: true, deliveryId: id }; // Safe lost-response retry, even with an older snapshot.
        }
        const cards = JSON.parse(d.cards) as Card[];
        const all = [...accepted, ...rejected];
        if (new Set(all).size !== all.length || all.length !== cards.length || all.some(v => !cards.some(c => c.id === v)))
            throw new Failure('invalid_ack');
        if (s.inventoryVersion <= d.version)
            throw new Failure('ack_requires_new_inventory_version', 409);
        const recordedHistory = await this.histories(s.deviceId);
        if (accepted.some(v => {
            const card = cards.find(c => c.id === v)!;
            return !s.retainedCards.some(r => r.id === v && r.contentHash === card.contentHash) &&
                !s.historyEvents.some(e => e.id === v && e.contentHash === card.contentHash && e.seen) &&
                !recordedHistory.some(e => e.id === v && e.contentHash === card.contentHash && e.seen);
        }))
            throw new Failure('accepted_card_missing');
        await this.saveSnapshot(s);
        // Every offered identity is excluded afterward, including rejected duplicates/invalid cards.
        await this.addHistory(s.deviceId, cards.map(c => ({ eventId: `delivery:${id}:${c.id}`, id: c.id, contentHash: c.contentHash,
            primaryTopicId: c.primaryTopicId, seen: false, expanded: false, ideaFingerprint: c.ideaFingerprint })));
        await this.db.prepare("UPDATE deliveries SET state='acked',result=? WHERE id=?").run(result, id);
        return { acknowledged: true, deliveryId: id };
    });
}
async usage() {
    const day = new Date().toISOString().slice(0, 10);
    return await this.db.prepare('SELECT requests,tokens,cost FROM usage WHERE day=?').get(day) as {
        requests: number;
        tokens: number;
        cost: number;
    } ?? { requests: 0, tokens: 0, cost: 0 };
}
async reserveBudget(job: Job, config: Config, inputBytes = config.maxInput) {
    await this.transaction(async () => {
        if (!Number.isSafeInteger(inputBytes) || inputBytes < 1 || inputBytes > config.maxInput)
            throw new Failure('input_budget_exceeded');
        const use = await this.usage(), tokens = inputBytes + config.maxOutput, cost = config.paid ? config.requestCost : 0;
        if (use.requests + 1 > config.requestLimit || use.tokens + tokens > config.tokenLimit || use.cost + cost > config.costLimit)
            throw new Failure('budget_exhausted');
        const day = new Date().toISOString().slice(0, 10);
        await this.db.prepare('INSERT INTO usage VALUES (?,?,?,?) ON CONFLICT(day) DO UPDATE SET requests=usage.requests+excluded.requests,tokens=usage.tokens+excluded.tokens,cost=usage.cost+excluded.cost').run(day, 1, tokens, cost);
        await this.db.prepare("UPDATE jobs SET state='running', attempts=attempts+1 WHERE id=?").run(job.id);
    });
}
}
