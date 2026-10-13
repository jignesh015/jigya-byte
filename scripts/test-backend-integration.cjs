const { DatabaseSync } = require('node:sqlite');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const path = require('node:path');
const appDb = new DatabaseSync(':memory:');
const adapter = {
  execAsync: async sql => appDb.exec(sql),
  runAsync: async (sql,...args)=>appDb.prepare(sql).run(...args),
  getFirstAsync: async (sql,...args)=>appDb.prepare(sql).get(...args),
  getAllAsync: async (sql,...args)=>appDb.prepare(sql).all(...args),
  withTransactionAsync: async fn => { appDb.exec('BEGIN'); try {await fn();appDb.exec('COMMIT');} catch(e){appDb.exec('ROLLBACK');throw e;} },
};
const modules = new Map();
const secureValues = new Map();
function load(file) {
  if(modules.has(file)) return modules.get(file);
  const exports={}; modules.set(file,exports);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const localRequire=name=>{
    if(name==='expo-sqlite') return {openDatabaseAsync:async()=>adapter};
    if(name==='expo-crypto') return {CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:async(_,value)=>createHash('sha256').update(value).digest('hex')};
    if(name==='expo-secure-store') return {getItemAsync:async key=>secureValues.get(key)??null,setItemAsync:async(key,value)=>secureValues.set(key,value)};
    if(name.startsWith('.')) return load(path.resolve(path.dirname(file),name+'.ts'));
    return require(name);
  };
  vm.runInThisContext(`(function(require,exports){${code}\n})`,{filename:file})(localRequire,exports);return exports;
}
(async()=>{
  const { readConfig }=await import('../backend/src/config.ts');
  const { Store }=await import('../backend/src/storage/store.ts');
  const { prepare }=await import('../backend/src/preparation/cards.ts');
  const { TOPICS }=await import('../backend/src/contracts/index.ts');
  const { createBackend }=await import('../backend/src/server.ts');
  const token=randomBytes(32).toString('hex');
  const config=readConfig({BACKEND_DEVICE_TOKEN:token,BACKEND_DATABASE:':memory:',GENERATION_PROVIDER:'gemini',GEMINI_API_KEY:'fixture-only',GEMINI_MODEL:'mock-model',GEMINI_FREE_TIER_CONFIRMED:'true',LIVE_SOURCES_ENABLED:'false'});
  const store=new Store(':memory:');
  const fixtureConfig={...config,mode:'ai-only',provider:'gemini',model:'mock-model'};
  const sourcedCards=Array.from({length:100},(_,i)=>{
    const topic=TOPICS[i%TOPICS.length],date=new Date().toISOString();
    const source={id:`fixture-source-${i}`,name:'Fixture source',title:`Source ${i}`,url:`https://example.org/news/${i}`,publishedAt:date,retrievedAt:date,dateKind:'published',topicIds:[topic],excerpt:'Fixture evidence, not a live article.'};
    return prepare({cards:[{title:`Idea unique${i}`,summary:`Summary unique${i}`,explanation:`Details unique${i}`,primaryTopicId:topic,topicIds:[topic],sourceIds:[source.id]}]},fixtureConfig,1,[source])[0];
  });
  store.addCards(sourcedCards,500);
  const backend=createBackend(config,store); backend.worker.stopped=true;
  await new Promise(resolve=>backend.server.listen(0,'127.0.0.1',resolve));
  let sync;
  try{
    const data=load(path.resolve('src/data/database.ts'));
    const connection=load(path.resolve('src/data/backendConnection.ts'));
    assert.equal(connection.validateServiceUrl(connection.cloudBackendUrl+'/'),connection.cloudBackendUrl);
    for(const invalid of ['http://fuomvvzgdhleikztdpgz.supabase.co/functions/v1/jigyabyte-api','https://other.supabase.co/functions/v1/jigyabyte-api','https://fuomvvzgdhleikztdpgz.supabase.co','https://fuomvvzgdhleikztdpgz.supabase.co/functions/v1/jigyabyte-api?token=secret']) {
      assert.throws(()=>connection.validateServiceUrl(invalid));
    }
    const {BackendSync}=load(path.resolve('src/data/backendSync.ts'));
    await data.initializeDatabase(); assert.equal((await data.getCards()).length,0);
    const catalog=load(path.resolve('src/data/cardContent.ts'));
    assert.deepEqual(catalog.topics.map(t=>t.id),TOPICS);
    assert.equal(appDb.prepare('SELECT COUNT(*) n FROM topics').get().n,TOPICS.length);
    const contracts=load(path.resolve('src/data/backendContracts.ts'));
    for(const card of sourcedCards.slice(0,20)) assert.ok(await contracts.validateBackendCard(card));
    assert.equal(await contracts.validateBackendCard({...sourcedCards[0],sources:[{...sourcedCards[0].sources[0],url:'https://127.0.0.1/secret'}]}),null);
    await data.importCards(require('./fixtures/cards.cjs').fixtureCards); await data.saveInterests(['space','agentic-coding','cinema']);
    assert.deepEqual(await data.getInterests(),['space','agentic-coding','cinema']);
    const originalQueue=await data.getPersistentFeed();
    assert.equal((await data.getInventory()).counts.unread,10);
    const url=`http://127.0.0.1:${backend.server.address().port}`;
    const settings=await connection.saveBackendSettings({enabled:true,serviceUrl:url,pairingToken:token});
    assert.equal((await connection.getBackendSettings()).pairingToken,token);
    assert.equal(appDb.prepare('SELECT COUNT(*) n FROM user_preferences WHERE value LIKE ?').get('%'+token+'%').n,0);
    let droppedAck=false, consumed=false, latestStatus, changed=0;
    const deps={...data,fetch:async(url,init)=>{
      const response=await fetch(url,init);
      if(url.endsWith('/v1/sync')&&!consumed){consumed=true;await data.recordCardImpression(originalQueue[0].cardId,originalQueue[0].lane,'integration-test');}
      if(url.includes('/ack')&&!droppedAck){droppedAck=true;throw new Error('simulated lost response');}
      return response;
    }};
    sync=new BackendSync(status=>latestStatus=status,async()=>{changed++;await data.getPersistentFeed();},deps);
    sync.configure(settings);
    await sync.run(); assert.equal(latestStatus.state,'offline'); assert.equal((await data.getDeliveryOutbox()).length,1);
    await sync.run();
    assert.equal((await data.getInventory()).counts.unread,60); assert.equal((await data.getDeliveryOutbox()).length,0);
    const sourced= (await data.getCards()).filter(c=>c.references.length);
    assert.ok(sourced.length>=50); assert.equal(sourced[0].references[0].name,'Fixture source');
    assert.equal(sourced[0].sourceUrl,sourced[0].references[0].url);
    assert.equal(store.usage().requests,0); assert.equal(latestStatus.state,'ready'); assert.ok(changed>=5);
    const queue=await data.getPersistentFeed(); assert.deepEqual(queue.slice(0,originalQueue.length),originalQueue);
    const unread=(await data.getCards()).filter(c=>!c.isRead).slice(0,6);
    for(const c of unread) await data.recordInteraction(c.id,'seen');
    const queueBeforeRefresh=await data.getPersistentFeed();
    await sync.refresh(); assert.equal((await data.getInventory()).counts.unread,60);
    assert.deepEqual((await data.getPersistentFeed()).slice(0,queueBeforeRefresh.length),queueBeforeRefresh);
    // Failure keeps local cards and outbox intact; resume can retry without a model call.
    sync.dispose(); const prior=await data.getCards();
    sync=new BackendSync(status=>latestStatus=status,async()=>{}, {...data,fetch:async()=>{throw new Error('offline');}});
    sync.configure(settings); await sync.run(); assert.equal(latestStatus.state,'offline'); assert.equal((await data.getCards()).length,prior.length);
    await sync.refresh(); assert.equal(latestStatus.state,'offline'); assert.equal(latestStatus.unread,60); assert.equal((await data.getCards()).length,prior.length);
    const cancelledRefresh=sync.refresh(); sync.foreground(false); await cancelledRefresh;
    sync.dispose();
    // Connection checks preserve the confirmed color and successful timestamp while pending/offline.
    let failHandshake=false, finishHandshake;
    sync=new BackendSync(status=>latestStatus=status,async()=>{}, {...data,fetch:async()=>{
      await new Promise(resolve=>{finishHandshake=resolve;});
      if(failHandshake) throw new Error('simulated connection loss');
      return new Response(JSON.stringify({protocolVersion:1,provider:'gemini',contentMode:'ai-only'}));
    }});
    sync.configure({...settings,enabled:false});
    let handshake=sync.handshake(); finishHandshake(); await handshake;
    assert.equal(latestStatus.connection,'connected');
    const successfulTimestamp=latestStatus.lastHandshakeAt; assert.ok(successfulTimestamp);
    failHandshake=true; handshake=sync.handshake();
    assert.equal(latestStatus.connection,'connected');
    assert.equal(latestStatus.lastHandshakeAt,successfulTimestamp);
    const failedHandshake=assert.rejects(handshake,/simulated connection loss/);
    finishHandshake(); await failedHandshake;
    assert.equal(latestStatus.connection,'offline');
    assert.equal(latestStatus.lastHandshakeAt,successfulTimestamp);
    failHandshake=false; handshake=sync.handshake();
    assert.equal(latestStatus.connection,'offline');
    finishHandshake(); await handshake;
    assert.equal(latestStatus.connection,'connected');
    assert.ok(latestStatus.lastHandshakeAt>=successfulTimestamp);
    sync.dispose();
    const device=(await data.getInventory()).deviceId;
    const uncertainJob=store.queue(device,5); store.markJob(uncertainJob,'uncertain','upstream_timeout_or_network');
    sync=new BackendSync(status=>latestStatus=status,async()=>{}, {...data,fetch});
    sync.configure(settings); sync.retry(); await sync.run();
    assert.equal(store.job(uncertainJob).state,'queued'); // Actual Android Retry dispatches the explicit endpoint.
    assert.equal(store.usage().requests,0);
    console.log('PASS: Android repositories -> real fixture HTTP backend, 10-to-60 refill, concurrent reading, durable lost-ack retry, stable queue append, read-triggered refill, secure pairing, and offline preservation. Zero live model calls.');
  } finally {sync?.dispose();await backend.close();appDb.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
