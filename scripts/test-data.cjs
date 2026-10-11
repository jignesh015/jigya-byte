const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const testFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'jigyabyte-sql-'));
const testFile = path.join(testFolder, 'test.db');
let db = new DatabaseSync(testFile);
const adapter = {
  execAsync: async sql => db.exec(sql),
  runAsync: async (sql, ...args) => db.prepare(sql).run(...args),
  getFirstAsync: async (sql, ...args) => db.prepare(sql).get(...args),
  getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args),
  withTransactionAsync: async fn => {
    db.exec('BEGIN');
    try { await fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  },
};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = name => {
    if (name === 'expo-sqlite') return { openDatabaseAsync: async () => adapter };
    if (name === 'expo-crypto') return {
      CryptoDigestAlgorithm: { SHA256: 'sha256' },
      digestStringAsync: async (_, value) => createHash('sha256').update(value).digest('hex'),
    };
    if (name.startsWith('.')) return load(require('node:path').resolve(require('node:path').dirname(file), `${name}.ts`));
    return require(name);
  };
  vm.runInThisContext(`(function(require,exports){${code}\n})`, { filename: file })(localRequire, exports);
  return exports;
}
(async () => {
  // Start from a genuine version-4 database with existing personal state.
  const migrationSource = fs.readFileSync(path.resolve('src/data/database.ts'), 'utf8');
  const migrations = [...migrationSource.matchAll(/await db\.execAsync\(`([\s\S]*?)`\);/g)];
  for (const match of migrations.slice(0, 4)) db.exec(match[1]);
  db.prepare('INSERT INTO topics VALUES (?,?,?)').run('space','Space',0);
  db.prepare('INSERT INTO sources(id,provider_id,name,attribution,license) VALUES (?,?,?,?,?)').run('legacy-source','sample','Legacy','Original','Original');
  db.prepare('INSERT INTO cards(id,provider_id,source_id,content_hash,title,summary,explanation,created_at) VALUES (?,?,?,?,?,?,?,?)').run('legacy-card','sample','legacy-source','legacy-hash','Legacy title','Legacy summary','Legacy detail','2020-01-01');
  db.prepare('INSERT INTO card_topics VALUES (?,?,?)').run('legacy-card','space',1);
  db.prepare('INSERT INTO interaction_events(card_id,event_type,happened_at) VALUES (?,?,?)').run('legacy-card','seen','2020-01-02T00:00:00Z');
  db.prepare('INSERT INTO interaction_events(card_id,event_type,happened_at) VALUES (?,?,?)').run('legacy-card','expanded','2020-01-03T00:00:00Z');
  db.prepare('INSERT INTO favorites VALUES (?,?)').run('legacy-card','2020-01-04T00:00:00Z');
  db.prepare('INSERT INTO review_state VALUES (?,?,?,?)').run('legacy-card','2099-01-01','easy','2020-01-04');
  db.prepare('INSERT INTO user_preferences VALUES (?,?,?)').run('interest_topic_ids','["space"]','2020-01-04');
  db.prepare('INSERT INTO sources(id,provider_id,name,attribution,license) VALUES (?,?,?,?,?)').run('sample-source','jigyabyte-sample','JigyaByte sample','Original','Original');
  db.prepare('INSERT INTO cards(id,provider_id,source_id,content_hash,title,summary,explanation,created_at) VALUES (?,?,?,?,?,?,?,?)').run('sample-old','jigyabyte-sample','sample-source','sample-hash','Starter','Summary','Detail','2020-01-01');
  db.exec("INSERT INTO card_topics VALUES ('sample-old','space',1); INSERT INTO favorites VALUES ('sample-old','2020-01-01'); INSERT INTO review_state VALUES ('sample-old','2099-01-01','easy','2020-01-01'); INSERT INTO feed_queue(card_id,lane,requested_lane) VALUES ('sample-old','discovery','discovery'); INSERT INTO review_queue_marks VALUES ('sample-old','2099-01-01'); INSERT INTO interaction_events(card_id,event_type,happened_at) VALUES ('sample-old','seen','2020-01-01');");
  let data = load(require('node:path').resolve('src/data/database.ts'));
  await data.initializeDatabase();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cards WHERE provider_id='jigyabyte-sample'").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sources WHERE provider_id='jigyabyte-sample'").get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM feed_queue').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM review_queue_marks').get().n,0);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,7);


  assert.equal((await data.getCards()).length,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM interaction_events').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM favorites').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM review_state').get().n,0);
  assert.deepEqual(await data.getInterests(),['space']);
  // Remove only this fixture's personal state before exercising the isolated fixture tests.
  db.exec("DELETE FROM favorites; DELETE FROM interaction_events; DELETE FROM review_state; DELETE FROM card_topics WHERE card_id='legacy-card'; DELETE FROM cards WHERE id='legacy-card';");
  assert.equal((await data.getCards()).length, 0);
  const {fixtureCards} = require('./fixtures/cards.cjs');
  assert.equal(await data.importCards([{...fixtureCards[0], providerId:'jigyabyte-sample'}]),0);
  assert.equal((await data.getCards()).length,0);
  assert.equal(await data.importCards(fixtureCards),10);
  const cards = await data.getCards();
  assert.equal(cards.length, 10);
  assert.deepEqual((await data.getAnalytics()).totals, { seen: 0, expanded: 0, favorites: 0 });
  const card = cards[0];
  await data.recordInteraction(card.id, 'seen');
  await data.recordInteraction(card.id, 'seen');
  await data.recordInteraction(card.id, 'expanded');
  await data.recordInteraction(card.id, 'expanded');
  await data.setFavorite(card.id, true);
  await data.setFavorite(card.id, true);
  // A secondary tag must not duplicate category totals.
  await adapter.runAsync('INSERT INTO card_topics VALUES (?, ?, 0)', card.id, cards[1].primaryTopicId);
  let snapshot = await data.getAnalytics();
  assert.deepEqual(snapshot.totals, { seen: 1, expanded: 1, favorites: 1 });
  assert.equal(snapshot.byTopic.seen[card.primaryTopicId], 1);
  assert.equal(snapshot.byTopic.seen[cards[1].primaryTopicId] ?? 0, 0);
  await data.setFavorite(card.id, false);
  assert.equal((await data.getAnalytics()).totals.favorites, 0);
  db.close();
  db = new DatabaseSync(testFile);
  cache.delete(path.resolve('src/data/database.ts'));
  data = load(path.resolve('src/data/database.ts'));
  await data.initializeDatabase();
  assert.deepEqual((await data.getAnalytics()).totals, { seen: 1, expanded: 1, favorites: 0 });
  await data.scheduleReview(card.id, 'again');
  assert.ok((await data.getCards()).find(c => c.id === card.id).nextReviewAt);
  assert.equal(await data.importCards(fixtureCards), 0);
  const { buildFeedSchedule } = load(require('node:path').resolve('src/data/feed.ts'));
  const eligible = cards.map((c, i) => ({ ...c, nextReviewAt: i === 0 ? '2020-01-01T00:00:00Z' : null }));
  const schedule = buildFeedSchedule(eligible, cards.slice(1, 3).map(c => c.primaryTopicId), []);
  assert.equal(schedule.length, 10);
  assert.equal(schedule.filter(c => c.lane === 'review').length, 1);
  assert.equal(schedule.filter(c => c.lane === 'interest').length, 2);
  assert.equal(schedule.filter(c => c.lane === 'discovery').length, 7);
  const makeBackendCard = i => {
    const title=`Offline idea word${i}`,summary=`Summary word${i}`,explanation=`Explanation word${i}`;
    const normalized=v=>v.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const hash=v=>createHash('sha256').update(v).digest('hex'); const contentHash=hash(normalized(`${title}\n${summary}\n${explanation}`));
    return {id:`card-${contentHash}`,schemaVersion:1,contentHash,ideaFingerprint:hash(normalized(title)),title,summary,explanation,primaryTopicId:'space',topicIds:['space'],
      contentMode:'ai-only',providerId:'gemini',modelId:'mock-model',promptVersion:'1',generatedAt:'2026-10-11T00:00:00Z',sources:[]};
  };
  const incoming=Array.from({length:80},(_,i)=>makeBackendCard(i));
  const before=(await data.getInventory()).inventoryVersion;
  for(let i=0;i<8;i++) assert.equal(await data.importBackendDelivery(`delivery-${i}`,incoming.slice(i*10,i*10+10)),10);
  assert.ok((await data.getInventory()).inventoryVersion>before);
  assert.equal((await data.getDeliveryOutbox()).length,8);
  assert.equal(await data.importBackendDelivery('delivery-0',incoming.slice(0,10)),0);
  const firstQueue=await data.getPersistentFeed(); const againQueue=await data.getPersistentFeed();
  assert.deepEqual(againQueue,firstQueue);
  for(let i=0;i<40;i++) await data.setFavorite(incoming[i].id,true);
  for(const c of incoming) await data.recordInteraction(c.id,'seen');
  const originalFirstRead=(await data.getCards()).find(c=>c.id===incoming[0].id).firstReadAt;
  await data.recordInteraction(incoming[0].id,'seen');
  assert.equal((await data.getCards()).find(c=>c.id===incoming[0].id).firstReadAt,originalFirstRead);
  await data.scheduleReview(card.id,'again');
  const analyticsBefore=await data.getAnalytics();
  await data.cleanupReadBodies();
  const inventoryAfter=await data.getInventory();
  assert.equal(inventoryAfter.counts.readNonFavorite,30); assert.equal(inventoryAfter.counts.favorites,40); assert.equal(inventoryAfter.counts.unread,9);
  assert.deepEqual((await data.getAnalytics()).totals,analyticsBefore.totals);
  assert.equal((await data.getFavorites()).length,40);
  assert.equal((await data.getCards()).some(c=>c.id===card.id),false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM review_state WHERE card_id=?').get(card.id).n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM interaction_events WHERE card_id=? AND event_type=?').get(card.id,'reviewed').n>0,true);
  const oldestFavorite=incoming[0].id;
  data.protectCardBodies([oldestFavorite]); await data.setFavorite(oldestFavorite,false); await data.cleanupReadBodies();
  assert.equal((await data.getCards()).some(c=>c.id===oldestFavorite),true);
  data.protectCardBodies([]); await data.cleanupReadBodies();
  // If protection evicted another body, the count is already capped; create one extra read to force another cleanup.
  const extra=makeBackendCard(999); await data.importBackendDelivery('extra',[extra]); await data.recordInteraction(extra.id,'seen'); await data.cleanupReadBodies();
  assert.equal((await data.getCards()).some(c=>c.id===oldestFavorite),false);
  assert.equal(await data.importBackendDelivery('evicted-repeat',[incoming[0]]),0);
  assert.equal((await data.getCards()).some(c=>c.id===oldestFavorite),false);
  const seen=await data.getAnalytics();
  db.close(); db=new DatabaseSync(testFile); cache.delete(path.resolve('src/data/database.ts')); data=load(path.resolve('src/data/database.ts')); await data.initializeDatabase();
  assert.equal((await data.getCards()).some(c=>c.id===card.id),false); // Startup never resurrects evicted bodies.
  assert.deepEqual((await data.getAnalytics()).totals,seen.totals);
  assert.equal((await data.getFavorites()).length,39);
  assert.ok((await data.getDeliveryOutbox()).length>=8);
  const invalid={...makeBackendCard(1001),summary:'a'.repeat(241)};
  assert.equal(await data.importBackendDelivery('invalid',[invalid]),0);
  assert.deepEqual((await data.getDeliveryOutbox()).find(r=>r.id==='invalid').ack.rejectedIds,[invalid.id]);
  console.log('PASS: v4-to-v6 card-library reset and migration, persistent queue, delivery outbox and dedup, 40 protected favorites, 30 read-body cap, safe active unfavorite, no resurrection, analytics/reviews and restart recovery.');
  db.close();
  fs.rmSync(testFile);
  fs.rmdirSync(testFolder);
})().catch(e => { console.error(e); process.exitCode = 1; });
