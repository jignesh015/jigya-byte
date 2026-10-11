import * as SQLite from 'expo-sqlite';
import { contentHash, topics, type ContentCard } from './cardContent';
import { defaultGeneratorSettings, validateServiceUrl, type GeneratorSettings } from './cardGenerator';
import { buildFeedSchedule, type FeedAssignment } from './feed';
import { validateBackendCard, type BackendCard, type Inventory, type DeliveryAck } from './backendContracts';

const DATABASE_NAME = 'jigyabyte.db';
const CURRENT_SCHEMA_VERSION = 5;
let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;
let writeTail: Promise<unknown> = Promise.resolve();
let protectedIds = new Set<string>();
async function transaction<T>(db: SQLite.SQLiteDatabase, work: () => Promise<T>): Promise<T> {
  const run = writeTail.then(async () => {
    let result!: T;
    await db.withTransactionAsync(async () => { result = await work(); });
    return result;
  });
  writeTail = run.catch(() => {});
  return run;
}

export type Card = ContentCard & {
  contentHash: string;
  isFavorite: boolean;
  nextReviewAt: string | null;
  isRead: boolean;
  firstReadAt: string | null;
  savedAt: string | null;
  references: BackendCard['sources'];
  provenance: { contentMode: string; providerId: string; modelId: string } | null;
};

export type FeedLane = 'discovery' | 'interest' | 'review';

export type AnalyticsMetric = 'seen' | 'expanded' | 'favorites';
export type AnalyticsSnapshot = {
  totals: Record<AnalyticsMetric, number>;
  byTopic: Record<AnalyticsMetric, Record<string, number>>;
};

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;

  if (version < 1) {
    await db.execAsync(`
      BEGIN;
      CREATE TABLE topics (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE sources (
        id TEXT PRIMARY KEY NOT NULL,
        provider_id TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT,
        attribution TEXT NOT NULL,
        license TEXT NOT NULL,
        retrieved_at TEXT
      );
      CREATE TABLE cards (
        id TEXT PRIMARY KEY NOT NULL,
        provider_id TEXT NOT NULL,
        source_id TEXT NOT NULL REFERENCES sources(id),
        content_hash TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        explanation TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(provider_id, content_hash)
      );
      CREATE TABLE card_topics (
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        topic_id TEXT NOT NULL REFERENCES topics(id),
        is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
        PRIMARY KEY (card_id, topic_id)
      );
      CREATE UNIQUE INDEX one_primary_topic_per_card ON card_topics(card_id) WHERE is_primary = 1;
      CREATE TABLE interaction_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL CHECK (event_type IN ('seen', 'expanded', 'reviewed')),
        happened_at TEXT NOT NULL,
        detail TEXT
      );
      CREATE UNIQUE INDEX one_seen_event_per_card ON interaction_events(card_id) WHERE event_type = 'seen';
      CREATE UNIQUE INDEX one_expanded_event_per_card ON interaction_events(card_id) WHERE event_type = 'expanded';
      CREATE TABLE favorites (
        card_id TEXT PRIMARY KEY NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        saved_at TEXT NOT NULL
      );
      CREATE TABLE review_state (
        card_id TEXT PRIMARY KEY NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        next_review_at TEXT NOT NULL,
        last_action TEXT NOT NULL CHECK (last_action IN ('again', 'got_it', 'easy')),
        updated_at TEXT NOT NULL
      );
      CREATE TABLE user_preferences (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 1;
      COMMIT;
    `);
    version = 1;
  }

  if (version < 2) {
    await db.execAsync(`
      BEGIN;
      CREATE TABLE feed_impressions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        source_lane TEXT NOT NULL CHECK (source_lane IN ('discovery', 'interest', 'review')),
        shown_at TEXT NOT NULL,
        UNIQUE(session_id, card_id)
      );
      CREATE INDEX feed_impressions_by_shown_at ON feed_impressions(shown_at DESC);
      PRAGMA user_version = 2;
      COMMIT;
    `);
    version = 2;
  }

  if (version < 3) {
    await db.execAsync(`
      BEGIN;
      ALTER TABLE sources ADD COLUMN license_url TEXT;
      PRAGMA user_version = 3;
      COMMIT;
    `);
    version = 3;
  }

  if (version < 4) {
    await db.execAsync(`BEGIN;
      ALTER TABLE cards ADD COLUMN body_retained INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE cards ADD COLUMN first_read_at TEXT;
      ALTER TABLE cards ADD COLUMN idea_fingerprint TEXT;
      ALTER TABLE cards ADD COLUMN references_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE cards ADD COLUMN provenance_json TEXT;
      UPDATE cards SET first_read_at=(SELECT MIN(happened_at) FROM interaction_events e WHERE e.card_id=cards.id AND e.event_type='seen');
      CREATE TABLE sync_state(id INTEGER PRIMARY KEY CHECK(id=1), device_id TEXT NOT NULL, inventory_version INTEGER NOT NULL DEFAULT 1, active_rank INTEGER NOT NULL DEFAULT 0);
      INSERT INTO sync_state(id,device_id) VALUES (1,lower(hex(randomblob(16))));
      CREATE TABLE feed_queue(rank INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL REFERENCES cards(id), lane TEXT NOT NULL, requested_lane TEXT NOT NULL);
      CREATE TABLE review_queue_marks(card_id TEXT PRIMARY KEY REFERENCES cards(id), due_at TEXT NOT NULL);
      CREATE TABLE delivery_outbox(delivery_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE delivery_receipts(delivery_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE history_ack(event_id TEXT PRIMARY KEY);
      CREATE INDEX cards_by_read ON cards(body_retained,first_read_at,id);
      CREATE INDEX identities_by_hash ON cards(content_hash);
      CREATE TRIGGER card_insert_version AFTER INSERT ON cards BEGIN UPDATE sync_state SET inventory_version=inventory_version+1; END;
      CREATE TRIGGER card_retention_version AFTER UPDATE OF body_retained ON cards BEGIN UPDATE sync_state SET inventory_version=inventory_version+1; END;
      CREATE TRIGGER favorite_add_version AFTER INSERT ON favorites BEGIN UPDATE sync_state SET inventory_version=inventory_version+1; END;
      CREATE TRIGGER favorite_remove_version AFTER DELETE ON favorites BEGIN UPDATE sync_state SET inventory_version=inventory_version+1; END;
      CREATE TRIGGER interaction_version AFTER INSERT ON interaction_events BEGIN
        UPDATE cards SET first_read_at=COALESCE(first_read_at,NEW.happened_at) WHERE id=NEW.card_id AND NEW.event_type='seen';
        UPDATE sync_state SET inventory_version=inventory_version+1;
      END;
      PRAGMA user_version=4; COMMIT;`);
    version = 4;
  }
  if (version < 5) {
    await db.execAsync(`BEGIN;
      DELETE FROM feed_queue WHERE card_id IN (SELECT id FROM cards WHERE provider_id='jigyabyte-sample');
      DELETE FROM review_queue_marks WHERE card_id IN (SELECT id FROM cards WHERE provider_id='jigyabyte-sample');
      DELETE FROM cards WHERE provider_id='jigyabyte-sample';
      DELETE FROM sources WHERE provider_id='jigyabyte-sample' AND NOT EXISTS (SELECT 1 FROM cards WHERE source_id=sources.id);
      DELETE FROM user_preferences WHERE key='sample_content_seeded';
      UPDATE sync_state SET inventory_version=inventory_version+1;
      PRAGMA user_version=5; COMMIT;`);
    version = 5;
  }
  if (version !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported JigyaByte database version ${version}.`);
  }
}

async function ensureTopics(db: SQLite.SQLiteDatabase): Promise<void> {
  await transaction(db, async () => {
    for (const topic of topics) {
      await db.runAsync(
        'INSERT OR IGNORE INTO topics (id, name, sort_order) VALUES (?, ?, ?)',
        topic.id, topic.name, topic.sortOrder,
      );
    }


  });
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  await migrate(db);
  await ensureTopics(db);
  return db;
}

function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) databasePromise = openDatabase().catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}

export async function initializeDatabase(): Promise<void> {
  await getDatabase();
  await cleanupReadBodies();
}

export async function getCards(): Promise<Card[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
        id: string; provider_id: string; content_hash: string; title: string; summary: string; explanation: string;
    primary_topic_id: string; topic_ids: string; source_name: string; source_url: string | null;
    attribution: string; license: string; license_url: string | null; retrieved_at: string | null;
    is_favorite: number; next_review_at: string | null; first_read_at: string | null; saved_at: string | null; references_json: string; provenance_json: string | null;
  }>(`
    SELECT c.id, c.provider_id, c.content_hash, c.title, c.summary, c.explanation,
      primary_topic.topic_id AS primary_topic_id,
      GROUP_CONCAT(all_topics.topic_id, ',') AS topic_ids,
      s.name AS source_name, s.url AS source_url, s.attribution, s.license, s.license_url, s.retrieved_at,
      CASE WHEN f.card_id IS NULL THEN 0 ELSE 1 END AS is_favorite,
      r.next_review_at,c.first_read_at,f.saved_at,c.references_json,c.provenance_json
    FROM cards c
    JOIN sources s ON s.id = c.source_id
    JOIN card_topics primary_topic ON primary_topic.card_id = c.id AND primary_topic.is_primary = 1
    JOIN card_topics all_topics ON all_topics.card_id = c.id
    LEFT JOIN favorites f ON f.card_id = c.id
    LEFT JOIN review_state r ON r.card_id = c.id
    WHERE c.body_retained=1
    GROUP BY c.id
    ORDER BY c.created_at, c.id
  `);

  return rows.map((row) => ({
    id: row.id,
    providerId: row.provider_id,
    contentHash: row.content_hash,
    title: row.title,
    summary: row.summary,
    explanation: row.explanation,
    primaryTopicId: row.primary_topic_id,
    topicIds: row.topic_ids.split(','),
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    attribution: row.attribution,
    license: row.license,
    licenseUrl: row.license_url,
    retrievedAt: row.retrieved_at,
    isFavorite: row.is_favorite === 1,
    nextReviewAt: row.next_review_at,
    isRead: row.first_read_at !== null,
    firstReadAt: row.first_read_at,
    savedAt: row.saved_at,
    references: JSON.parse(row.references_json),
    provenance: row.provenance_json ? JSON.parse(row.provenance_json) : null,
  }));
}

export async function recordInteraction(cardId: string, eventType: 'seen' | 'expanded'): Promise<void> {
  const db = await getDatabase();
  await transaction(db, async () => { await db.runAsync(
    'INSERT OR IGNORE INTO interaction_events (card_id, event_type, happened_at) VALUES (?, ?, ?)',
    cardId, eventType, new Date().toISOString(),
  ); });
}

export async function recordCardImpression(
  cardId: string,
  sourceLane: FeedLane,
  sessionId: string,
): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await transaction(db, async () => {
    const queued = await db.getFirstAsync<{ rank: number }>('SELECT rank FROM feed_queue WHERE card_id=? AND rank >= (SELECT active_rank FROM sync_state) ORDER BY rank LIMIT 1', cardId);
    if (queued) await db.runAsync('UPDATE sync_state SET active_rank=? WHERE id=1', queued.rank);
    await db.runAsync(
      `INSERT OR IGNORE INTO feed_impressions (session_id, card_id, source_lane, shown_at)
       VALUES (?, ?, ?, ?)`,
      sessionId, cardId, sourceLane, now,
    );
    await db.runAsync(
      `INSERT OR IGNORE INTO interaction_events (card_id, event_type, happened_at, detail)
       VALUES (?, 'seen', ?, ?)`,
      cardId, now, sourceLane,
    );
  });
}

export async function getRecentlyShownCardIds(limit = 20): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ card_id: string }>(
    `SELECT card_id FROM feed_impressions
     GROUP BY card_id ORDER BY MAX(shown_at) DESC LIMIT ?`,
    Math.max(1, Math.floor(limit)),
  );
  return rows.map((row) => row.card_id);
}

export async function getInterests(): Promise<string[] | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_preferences WHERE key = 'interest_topic_ids'",
  );
  if (!row) return null;

  try {
    const stored = JSON.parse(row.value);
    if (!Array.isArray(stored)) return [];
    const topicIds = new Set(topics.map((topic) => topic.id));
    return [...new Set(stored.filter((id): id is string => typeof id === 'string' && topicIds.has(id)))];
  } catch {
    return [];
  }
}

export async function saveInterests(topicIds: string[]): Promise<void> {
  const db = await getDatabase();
  const allowedIds = new Set(topics.map((topic) => topic.id));
  const normalized = [...new Set(topicIds.filter((id) => allowedIds.has(id)))];
  await transaction(db, async () => { await db.runAsync(
    `INSERT INTO user_preferences (key, value, updated_at) VALUES ('interest_topic_ids', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    JSON.stringify(normalized), new Date().toISOString(),
  ); await db.runAsync('UPDATE sync_state SET inventory_version=inventory_version+1 WHERE id=1'); });
}

export async function getGeneratorSettings(): Promise<GeneratorSettings> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM user_preferences WHERE key = 'generator_settings'");
  try {
    const value = JSON.parse(row?.value ?? 'null');
    if (!value) return defaultGeneratorSettings;
    return { enabled: value.enabled === true, serviceUrl: validateServiceUrl(value.serviceUrl) };
  } catch { return defaultGeneratorSettings; }
}

export async function saveGeneratorSettings(settings: GeneratorSettings): Promise<void> {
  const db = await getDatabase();
  const normalized = { enabled: settings.enabled, serviceUrl: validateServiceUrl(settings.serviceUrl) };
  await db.runAsync(
    `INSERT INTO user_preferences (key, value, updated_at) VALUES ('generator_settings', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    JSON.stringify(normalized), new Date().toISOString(),
  );
}

export async function importCards(cardsToImport: ContentCard[]): Promise<number> {
  if (cardsToImport.length === 0) return 0;
  const db = await getDatabase();
  let importedCount = 0;

  await transaction(db, async () => {
    for (const card of cardsToImport) {
      if (card.providerId === 'jigyabyte-sample') continue;
      const hash = await contentHash(`${card.title}\n${card.summary}\n${card.explanation}`);
      const prior = await db.getFirstAsync('SELECT id FROM cards WHERE id=? OR content_hash=?', card.id, hash);
      if (prior) continue;
      const sourceId = `source-${card.providerId}-${hash}`;
      await db.runAsync(
        `INSERT OR IGNORE INTO sources (id, provider_id, name, url, attribution, license, retrieved_at, license_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        sourceId, card.providerId, card.sourceName, card.sourceUrl, card.attribution, card.license,
        card.retrievedAt, card.licenseUrl,
      );
      const result = await db.runAsync(
        `INSERT OR IGNORE INTO cards (id, provider_id, source_id, content_hash, title, summary, explanation, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        card.id, card.providerId, sourceId, hash, card.title, card.summary, card.explanation, new Date().toISOString(),
      );
      const stored = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM cards WHERE provider_id = ? AND content_hash = ?', card.providerId, hash,
      );
      if (!stored) continue;
      if (result.changes > 0) importedCount += 1;
      for (const topicId of card.topicIds) {
        await db.runAsync(
          `INSERT OR IGNORE INTO card_topics (card_id, topic_id, is_primary) VALUES (?, ?, ?)`,
          stored.id, topicId, topicId === card.primaryTopicId ? 1 : 0,
        );
      }
    }
  });

  return importedCount;
}

export async function setFavorite(cardId: string, favorite: boolean): Promise<void> {
  const db = await getDatabase();
  await transaction(db, async () => {
  if (favorite) {
    await db.runAsync('INSERT OR IGNORE INTO favorites (card_id, saved_at) VALUES (?, ?)', cardId, new Date().toISOString());
  } else {
    await db.runAsync('DELETE FROM favorites WHERE card_id = ?', cardId);
  }
  });
}

const reviewDelayMs = { again: 10 * 60 * 1000, got_it: 24 * 60 * 60 * 1000, easy: 7 * 24 * 60 * 60 * 1000 } as const;

export async function scheduleReview(cardId: string, action: keyof typeof reviewDelayMs): Promise<void> {
  const db = await getDatabase();
  const now = new Date();
  const dueAt = new Date(now.getTime() + reviewDelayMs[action]).toISOString();
  await transaction(db, async () => {
    await db.runAsync(
      `INSERT INTO review_state (card_id, next_review_at, last_action, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(card_id) DO UPDATE SET next_review_at = excluded.next_review_at,
         last_action = excluded.last_action, updated_at = excluded.updated_at`,
      cardId, dueAt, action, now.toISOString(),
    );
    await db.runAsync(
      'INSERT INTO interaction_events (card_id, event_type, happened_at, detail) VALUES (?, ?, ?, ?)',
      cardId, 'reviewed', now.toISOString(), action,
    );
  });
}

export async function getAnalytics(): Promise<AnalyticsSnapshot> {
  const db = await getDatabase();
  const metrics: AnalyticsMetric[] = ['seen', 'expanded', 'favorites'];
  const byTopic = Object.fromEntries(metrics.map((metric) => [metric, {}])) as AnalyticsSnapshot['byTopic'];
  const totals: AnalyticsSnapshot['totals'] = { seen: 0, expanded: 0, favorites: 0 };

  for (const metric of metrics) {
    const table = metric === 'favorites' ? 'favorites' : 'interaction_events';
    const typeFilter = metric === 'favorites' ? '' : 'AND e.event_type = ?';
    const cardAlias = metric === 'favorites' ? 'f.card_id' : 'e.card_id';
    const rows = await db.getAllAsync<{ topic_id: string; amount: number }>(
      `SELECT ct.topic_id, COUNT(DISTINCT ${cardAlias}) AS amount
       FROM card_topics ct
       ${metric === 'favorites' ? 'JOIN favorites f ON f.card_id = ct.card_id' : 'JOIN interaction_events e ON e.card_id = ct.card_id'}
       WHERE ct.is_primary = 1 ${typeFilter}
       GROUP BY ct.topic_id`,
      ...(metric === 'favorites' ? [] : [metric]),
    );
    for (const row of rows) byTopic[metric][row.topic_id] = row.amount;
    totals[metric] = rows.reduce((sum, row) => sum + row.amount, 0);
  }

  return { totals, byTopic };
}

export function protectCardBodies(ids: (string | null)[]): void {
  protectedIds = new Set(ids.filter((id): id is string => !!id));
}
async function cleanup(db: SQLite.SQLiteDatabase): Promise<number> {
  const active = await db.getFirstAsync<{ card_id: string }>('SELECT card_id FROM feed_queue WHERE rank=(SELECT active_rank FROM sync_state)');
  const protectedNow = new Set(protectedIds); if (active) protectedNow.add(active.card_id);
  const rows = await db.getAllAsync<{ id: string }>(`SELECT c.id FROM cards c LEFT JOIN favorites f ON f.card_id=c.id
    WHERE c.body_retained=1 AND c.first_read_at IS NOT NULL AND f.card_id IS NULL ORDER BY c.first_read_at,c.id`);
  let excess = Math.max(0, rows.length - 30), removed = 0;
  if (!excess) return 0;
  await db.runAsync(`INSERT OR IGNORE INTO sources(id,provider_id,name,attribution,license) VALUES ('evicted-source','history','Evicted','History only','History only')`);
  for (const r of rows) {
    if (!excess || protectedNow.has(r.id)) continue;
    await db.runAsync('DELETE FROM feed_queue WHERE card_id=?', r.id);
    await db.runAsync('DELETE FROM review_state WHERE card_id=?', r.id);
    await db.runAsync('DELETE FROM review_queue_marks WHERE card_id=?', r.id);
    await db.runAsync(`UPDATE cards SET body_retained=0,title='',summary='',explanation='',source_id='evicted-source',references_json='[]',provenance_json=NULL WHERE id=?`, r.id);
    removed++; excess--;
  }
  await db.runAsync("DELETE FROM sources WHERE id!='evicted-source' AND id NOT IN (SELECT source_id FROM cards)");
  return removed;
}
export async function cleanupReadBodies(): Promise<number> {
  const db = await getDatabase(); return transaction(db, () => cleanup(db));
}
export async function getFavorites(): Promise<Card[]> {
  return (await getCards()).filter(c => c.isFavorite).sort((a,b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? '') || a.id.localeCompare(b.id));
}
export async function getPersistentFeed(): Promise<FeedAssignment[]> {
  const db = await getDatabase();
  return transaction(db, async () => {
    await db.runAsync('DELETE FROM feed_queue WHERE rank<(SELECT active_rank FROM sync_state)');
    await db.runAsync(`DELETE FROM feed_queue WHERE rank>(SELECT active_rank FROM sync_state) AND lane!='review'
      AND card_id IN (SELECT id FROM cards WHERE first_read_at IS NOT NULL)`);
    const cards = await getCards(), interests = await getInterests() ?? [];
    const queued = new Set((await db.getAllAsync<{ card_id: string }>('SELECT card_id FROM feed_queue')).map(r => r.card_id));
    const marks = new Map((await db.getAllAsync<{ card_id: string; due_at: string }>('SELECT * FROM review_queue_marks')).map(r => [r.card_id,r.due_at]));
    let remaining = cards.filter(c => !queued.has(c.id) && (!c.isRead || c.nextReviewAt !== marks.get(c.id)));
    while (remaining.length) {
      const block = buildFeedSchedule(remaining, interests, []);
      if (!block.length) break;
      for (const item of block) {
        await db.runAsync('INSERT INTO feed_queue(card_id,lane,requested_lane) VALUES (?,?,?)', item.cardId, item.lane, item.requestedLane);
        const card = cards.find(c => c.id === item.cardId)!;
        if (item.lane === 'review' && card.nextReviewAt) await db.runAsync('INSERT INTO review_queue_marks VALUES (?,?) ON CONFLICT(card_id) DO UPDATE SET due_at=excluded.due_at', card.id,card.nextReviewAt);
      }
      const used = new Set(block.map(a => a.cardId)); remaining = remaining.filter(c => !used.has(c.id));
    }
    const rows = await db.getAllAsync<{ rank: number; card_id: string; lane: FeedLane; requested_lane: FeedLane }>(`SELECT q.* FROM feed_queue q JOIN cards c ON c.id=q.card_id WHERE c.body_retained=1 ORDER BY q.rank`);
    return rows.map(r => ({ rank: r.rank, cardId: r.card_id, lane: r.lane, requestedLane: r.requested_lane }));
  });
}
async function localInventory(db: SQLite.SQLiteDatabase): Promise<Inventory> {
  const state = (await db.getFirstAsync<{ device_id: string; inventory_version: number }>('SELECT * FROM sync_state WHERE id=1'))!;
  const rows = await db.getAllAsync<{ id: string; content_hash: string; first_read_at: string | null; favorite: number; body_retained: number; idea_fingerprint: string | null; primary_topic: string; expanded: number }>(`
    SELECT c.*,CASE WHEN f.card_id IS NULL THEN 0 ELSE 1 END favorite,ct.topic_id primary_topic,
      EXISTS(SELECT 1 FROM interaction_events e WHERE e.card_id=c.id AND e.event_type='expanded') expanded
    FROM cards c JOIN card_topics ct ON ct.card_id=c.id AND ct.is_primary=1 LEFT JOIN favorites f ON f.card_id=c.id ORDER BY c.id`);
  const retainedCards = rows.filter(r => r.body_retained === 1).map(r => ({ id: r.id, contentHash: r.content_hash, read: r.first_read_at !== null, favorite: r.favorite === 1,
    ...(r.idea_fingerprint ? { ideaFingerprint: r.idea_fingerprint } : {}) }));
  const acked = new Set((await db.getAllAsync<{ event_id: string }>('SELECT event_id FROM history_ack')).map(r => r.event_id));
  const historyEvents = rows.map(r => ({ eventId: `${r.id}:${r.first_read_at ? 1 : 0}:${r.expanded}`, id: r.id, contentHash: r.content_hash,
    primaryTopicId: r.primary_topic, seen: !!r.first_read_at, expanded: !!r.expanded, ...(r.idea_fingerprint ? { ideaFingerprint: r.idea_fingerprint } : {}) })).filter(e => !acked.has(e.eventId));
  if (retainedCards.length > 2000) throw new Error('The local library exceeds this backend protocol limit. Offline reading remains available.');
  return { protocolVersion: 1, deviceId: state.device_id, inventoryVersion: state.inventory_version, snapshotComplete: true,
    counts: { unread: retainedCards.filter(r => !r.read).length, readNonFavorite: retainedCards.filter(r => r.read && !r.favorite).length, favorites: retainedCards.filter(r => r.favorite).length },
    retainedCards, interestTopicIds: await getInterests() ?? [], historyEvents: historyEvents.slice(0,2000),
    pendingDeliveryIds: (await db.getAllAsync<{ delivery_id: string }>('SELECT delivery_id FROM delivery_outbox')).map(r => r.delivery_id) };
}
export async function getInventory(): Promise<Inventory> {
  const db = await getDatabase(); return transaction(db, () => localInventory(db));
}
export async function acknowledgeHistory(eventIds: string[]): Promise<void> {
  const db = await getDatabase(); await transaction(db, async () => {
    for (const id of eventIds) await db.runAsync('INSERT OR IGNORE INTO history_ack VALUES (?)', id);
  });
}
export async function importBackendDelivery(deliveryId: string, values: unknown[]): Promise<number> {
  if (values.length > 10) throw new Error('Backend delivery exceeds the batch limit.');
  const validated = await Promise.all(values.map(async value => ({ value: value as { id?: unknown }, card: await validateBackendCard(value) })));
  if (validated.some(v => typeof v.value?.id !== 'string' || v.value.id.length > 160) || new Set(validated.map(v => v.value.id)).size !== values.length) throw new Error('Backend returned an invalid delivery.');
  const db = await getDatabase();
  return transaction(db, async () => {
    const receipt = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM delivery_receipts WHERE delivery_id=?', deliveryId);
    if (receipt) { await db.runAsync('INSERT OR IGNORE INTO delivery_outbox VALUES (?,?)', deliveryId, receipt.payload); return 0; }
    const acceptedIds: string[] = [], rejectedIds: string[] = []; let added = 0;
    for (const { value, card: c } of validated) {
      if (!c) { rejectedIds.push(value.id as string); continue; }
      const prior = await db.getFirstAsync<{ id: string; content_hash: string; body_retained: number }>('SELECT id,content_hash,body_retained FROM cards WHERE id=? OR content_hash=? OR idea_fingerprint=?', c.id, c.contentHash, c.ideaFingerprint);
      if (prior) { (prior.id === c.id && prior.content_hash === c.contentHash && prior.body_retained === 1 ? acceptedIds : rejectedIds).push(c.id); continue; }
      const source = c.sources[0]; const sourceId = `backend-source-${c.contentHash}`;
      await db.runAsync('INSERT INTO sources(id,provider_id,name,url,attribution,license,license_url,retrieved_at) VALUES (?,?,?,?,?,?,?,?)',
        sourceId, c.providerId, source?.title ?? 'AI generated · unverified', source?.url ?? null,
        source?.attribution ?? 'AI-generated explanation. Unverified; check claims independently.', source?.license ?? 'Generated text; provider terms apply', source?.licenseUrl ?? null, source?.retrievedAt ?? c.generatedAt);
      await db.runAsync(`INSERT INTO cards(id,provider_id,source_id,content_hash,title,summary,explanation,created_at,idea_fingerprint,references_json,provenance_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        c.id,c.providerId,sourceId,c.contentHash,c.title,c.summary,c.explanation,c.generatedAt,c.ideaFingerprint,JSON.stringify(c.sources),JSON.stringify({ contentMode: c.contentMode, providerId: c.providerId, modelId: c.modelId, promptVersion: c.promptVersion }));
      for (const topicId of c.topicIds) await db.runAsync('INSERT INTO card_topics VALUES (?,?,?)', c.id, topicId, topicId === c.primaryTopicId ? 1 : 0);
      acceptedIds.push(c.id); added++;
    }
    await cleanup(db);
    await db.runAsync('UPDATE sync_state SET inventory_version=inventory_version+1 WHERE id=1');
    const ack: DeliveryAck = { acceptedIds, rejectedIds, inventory: await localInventory(db) };
    const payload = JSON.stringify(ack);
    await db.runAsync('INSERT INTO delivery_receipts VALUES (?,?)', deliveryId, payload);
    await db.runAsync('INSERT INTO delivery_outbox VALUES (?,?)', deliveryId, payload);
    return added;
  });
}
export async function getDeliveryOutbox(): Promise<{ id: string; ack: DeliveryAck }[]> {
  const db = await getDatabase(); const rows = await db.getAllAsync<{ delivery_id: string; payload: string }>('SELECT * FROM delivery_outbox ORDER BY rowid');
  return rows.map(r => ({ id: r.delivery_id, ack: JSON.parse(r.payload) }));
}
export async function clearDeliveryOutbox(id: string): Promise<void> {
  const db = await getDatabase(); await transaction(db, async () => { await db.runAsync('DELETE FROM delivery_outbox WHERE delivery_id=?', id); });
}
