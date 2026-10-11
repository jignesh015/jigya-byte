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
  const { createBackend }=await import('../backend/src/server.ts');
  const token=randomBytes(32).toString('hex');
  const config=readConfig({BACKEND_DEVICE_TOKEN:token,BACKEND_DATABASE:':memory:',GENERATION_PROVIDER:'gemini',GEMINI_API_KEY:'fixture-only',GEMINI_MODEL:'mock-model',GEMINI_FREE_TIER_CONFIRMED:'true'});
  const store=new Store(':memory:');
  const fixtureConfig={...config,mode:'ai-only',provider:'gemini',model:'mock-model'};
  store.addCards(Array.from({length:100},(_,i)=>prepare({cards:[{title:`Idea unique${i}`,summary:`Summary unique${i}`,explanation:`Details unique${i}`,primaryTopicId:'space',topicIds:['space'],sourceIds:[]}]},fixtureConfig,[],1)[0]),500);
  const backend=createBackend(config,store); backend.worker.stopped=true;
  await new Promise(resolve=>backend.server.listen(0,'127.0.0.1',resolve));
  let sync;
  try{
    const data=load(path.resolve('src/data/database.ts'));
    const connection=load(path.resolve('src/data/backendConnection.ts'));
    const {BackendSync}=load(path.resolve('src/data/backendSync.ts'));
    await data.initializeDatabase(); assert.equal((await data.getCards()).length,0);
    await data.importCards(require('./fixtures/cards.cjs').fixtureCards); await data.saveInterests(['space']);
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
    const device=(await data.getInventory()).deviceId;
    const uncertainJob=store.queue(device,5); store.markJob(uncertainJob,'uncertain','upstream_timeout_or_network');
    sync=new BackendSync(status=>latestStatus=status,async()=>{}, {...data,fetch});
    sync.configure(settings); sync.retry(); await sync.run();
    assert.equal(store.job(uncertainJob).state,'queued'); // Actual Android Retry dispatches the explicit endpoint.
    assert.equal(store.usage().requests,0);
    console.log('PASS: Android repositories -> real fixture HTTP backend, 10-to-60 refill, concurrent reading, durable lost-ack retry, stable queue append, read-triggered refill, secure pairing, and offline preservation. Zero live model calls.');
  } finally {sync?.dispose();await backend.close();appDb.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
