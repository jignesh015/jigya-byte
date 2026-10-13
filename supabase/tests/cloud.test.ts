import assert from 'node:assert/strict';
import {readConfig} from '../../backend/src/config.ts';
import {snapshot,Failure} from '../../backend/src/contracts/index.ts';
import {prepare} from '../../backend/src/preparation/cards.ts';
import {PostgresStore} from '../functions/_shared/store.ts';
import {runWorker} from '../functions/_shared/worker.ts';
import {handleApi} from '../functions/_shared/api.ts';
import {configuration} from '../functions/_shared/runtime.ts';

const url=Deno.env.get('JIGYABYTE_TEST_DATABASE_URL') ?? '';
const parsed=new URL(url);
if(parsed.hostname!=='127.0.0.1' || parsed.port!=='55439' || parsed.pathname!=='/postgres') throw new Error('Cloud tests require the disposable local Postgres on port 55439');
const config=readConfig({BACKEND_DEVICE_TOKEN:'test-device-token-'.repeat(3),GENERATION_PROVIDER:'gemini',GEMINI_API_KEY:'fixture-only',
  GEMINI_MODEL:'fixture-model',GEMINI_FREE_TIER_CONFIRMED:'true',LIVE_SOURCES_ENABLED:'false'});
const inventory=(unread=0,version=1)=>snapshot({protocolVersion:1,deviceId:'cloud-test',inventoryVersion:version,snapshotComplete:true,
  counts:{unread,readNonFavorite:0,favorites:0},retainedCards:Array.from({length:unread},(_,i)=>({id:`local-${i}`,contentHash:`local-${i}`,read:false,favorite:false})),
  interestTopicIds:['space'],historyEvents:[],pendingDeliveryIds:[]});
const raw=(n=10)=>({cards:Array.from({length:n},(_,i)=>({title:`Fixture unique${i}`,summary:`Sample unique${i}`,explanation:`Mock unique${i}`,primaryTopicId:'space',topicIds:['space']}))});
const setup=async()=>{
  const s=new PostgresStore(url,true);
  await s.db.prepare('TRUNCATE jigyabyte.cards,jigyabyte.devices,jigyabyte.history,jigyabyte.deliveries,jigyabyte.jobs,jigyabyte.usage,jigyabyte.source_cache,jigyabyte.topic_generation,jigyabyte.source_usage RESTART IDENTITY').run();
  await s.db.prepare("UPDATE settings SET value='true' WHERE key='migration_ready'").run();return s;
};

Deno.test('cloud delivery survives lost responses, validates ACK and rolls back stale/conflicting inventory',async()=>{
  const s=await setup();
  try {
    await s.addCards(prepare(raw(),config,10),500);
    const inv=inventory(55);const first=await s.sync(inv,config),again=await s.sync(inv,config);
    assert.equal(first.cards.length,5);assert.equal(first.deliveryId,again.deliveryId);assert.deepEqual(first.cards,again.cards);
    await assert.rejects(s.sync(inventory(54),config),/inventory_version_conflict/);
    const next={...inv,inventoryVersion:2,counts:{...inv.counts,unread:60},retainedCards:[...inv.retainedCards,...first.cards.map(c=>({id:c.id,contentHash:c.contentHash,read:false,favorite:false}))]};
    await assert.rejects(s.acknowledge(first.deliveryId!,next,[],[]),/invalid_ack/);
    await s.acknowledge(first.deliveryId!,next,first.cards.map(c=>c.id),[]);
    assert.equal((await s.acknowledge(first.deliveryId!,inv,first.cards.map(c=>c.id),[])).acknowledged,true);
    assert.equal((await s.sync(next,config)).cards.length,0);
    await assert.rejects(s.sync(inv,config),/stale_inventory/);
  } finally {await s.close();}
});

Deno.test('overlapping cloud workers claim once and concurrent daily reservations stop at the shared cap',async()=>{
  const s=await setup(),other=new PostgresStore(url,true);
  try {
    await s.sync(inventory(),config);
    const claims=await Promise.all([s.claim(),other.claim()]);assert.equal(claims.filter(Boolean).length,1);
    const job=claims.find(Boolean)!;
    const limited={...config,requestLimit:1};
    const reservations=await Promise.allSettled([s.reserveBudget(job,limited,10),other.reserveBudget(job,limited,10)]);
    assert.equal(reservations.filter(r=>r.status==='fulfilled').length,1);assert.equal((await s.usage()).requests,1);
    await s.db.prepare('UPDATE jobs SET lease_until=0 WHERE id=?').run(job.id);
    assert.equal(await other.claim(),null);assert.equal((await s.job(job.id))?.state,'uncertain');
    await assert.rejects(s.finish(job,'completed'),/job_lease_lost/);
    await s.retry(job.id,config);assert.equal((await s.job(job.id))?.state,'queued');assert.equal((await s.usage()).requests,1);
  } finally {await s.close();await other.close();}
});

Deno.test('cloud worker attempts one route per invocation, preserves fallback and stores surplus',async()=>{
  const s=await setup();
  try {
    const chain={...config,geminiFallbackModels:['second-model']};
    await s.sync(inventory(55),chain);
    const called:string[]=[];
    const generator=(c:typeof config)=>async()=>{called.push(c.model!);if(c.model===config.model) throw new Failure('upstream_unavailable');return raw();};
    assert.equal((await runWorker(chain,s,generator)).state,'degraded');assert.deepEqual(called,[config.model]);
    const job=(await s.jobs())[0];assert.equal(job.provider_index,1);assert.equal(job.state,'queued');
    await s.db.prepare('UPDATE jobs SET next_at=0 WHERE id=?').run(job.id);
    assert.equal((await runWorker(chain,s,generator)).state,'completed');assert.deepEqual(called,[config.model,'second-model']);
    assert.equal((await s.cards()).length,10);assert.equal((await s.usage()).requests,2);
    assert.equal((await s.sync(inventory(55),chain)).cards.length,5);
  } finally {await s.close();}
});

Deno.test('API requires phone token, respects migration barrier and has matching hosted route paths',async()=>{
  const s=await setup();
  try {
    const request=(path:string,token='bad')=>new Request(`https://example.org/functions/v1/jigyabyte-api${path}`,{headers:{Authorization:`Bearer ${token}`}});
    assert.equal((await handleApi(request('/v1/status'),config,s)).status,401);
    assert.equal((await handleApi(request('/v1/status',config.token),config,s)).status,200);
    assert.equal((await handleApi(new Request('https://example.org/jigyabyte-api/v1/status',{headers:{Authorization:`Bearer ${config.token}`}}),config,s)).status,200);
    await s.db.prepare("UPDATE settings SET value='false' WHERE key='migration_ready'").run();
    assert.equal((await (await handleApi(request('/health'),config,s)).json()).ready,false);
    const sync=new Request('https://example.org/functions/v1/jigyabyte-api/v1/sync',{method:'POST',headers:{Authorization:`Bearer ${config.token}`},body:JSON.stringify(inventory())});
    assert.equal((await handleApi(sync,config,s)).status,503);
    let calls=0;await runWorker(config,s,()=>async()=>{calls++;return raw();});assert.equal(calls,0);
    assert.throws(()=>configuration({BACKEND_DEVICE_TOKEN:config.token,ALLOW_PAID_CALLS:'true'}),/Paid calls/);
  } finally {await s.close();}
});

Deno.test('cloud timeout remains uncertain and transaction rollback preserves cache and ledger',async()=>{
  const s=await setup();
  try {
    await s.sync(inventory(),config);
    let calls=0;const generator=()=>async()=>{calls++;throw new Failure('upstream_timeout_or_network');};
    await runWorker(config,s,generator);await runWorker(config,s,generator);
    assert.equal(calls,1);assert.equal((await s.jobs())[0].state,'uncertain');assert.equal((await s.usage()).requests,1);
    await assert.rejects(s.transaction(async()=>{await s.addCards(prepare(raw(),config,10),500);throw new Error('rollback');}),/rollback/);
    assert.equal((await s.cards()).length,0);assert.equal((await s.usage()).requests,1);
  } finally {await s.close();}
});
