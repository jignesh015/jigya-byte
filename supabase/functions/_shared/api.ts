import { providerRoutes,generationBatchSize } from '../../../backend/src/config.ts';
import type { Config } from '../../../backend/src/config.ts';
import { Failure,avoidanceBatch,snapshot,object,array,string,history } from '../../../backend/src/contracts/index.ts';
import type { PostgresStore } from './store.ts';
import { authorize,json,failure,requestBody } from './runtime.ts';

export async function handleApi(request:Request,config:Config,store:PostgresStore) {
  try {
    const pathname=new URL(request.url).pathname;
    // Supabase's gateway forwards /function-name/... to the function runtime.
    const path=pathname.replace(/^\/(?:functions\/v1\/)?jigyabyte-api(?=\/|$)/,'') || '/';
    if(request.method==='GET' && path==='/health') return json({service:'JigyaByte',protocolVersion:1,ready:await store.ready()});
    authorize(request,config.token);
    if(request.method==='GET' && path==='/v1/connection') return json({protocolVersion:1,provider:config.provider,
      model:config.model,contentMode:config.mode,migrationReady:await store.ready(),
      usage:await store.usage(),usageDay:new Date().toISOString().slice(0,10),limits:{requests:config.requestLimit},
      retryUncertainAllowed:config.provider==='gemini'&&config.freeConfirmed&&!config.paid});
    if(request.method==='GET' && path==='/v1/status') {
      const routes=providerRoutes(config),jobs=await store.jobs(),uncertain=jobs.filter(j=>j.state==='uncertain');
      const free=(i:number)=>routes[i]?.provider==='gemini' && routes[i].freeConfirmed && !routes[i].paid;
      return json({protocolVersion:1,provider:config.provider,model:config.provider==='disabled'?null:config.model,contentMode:config.mode,
        migrationReady:await store.ready(),cacheCards:(await store.cards()).length,usage:await store.usage(),
        retryUncertainAllowed:uncertain.length?uncertain.every(j=>free(j.provider_index)&&(!j.diagnostics||JSON.parse(j.diagnostics).provider==='gemini')):free(0),
        fallbackChain:routes.map(r=>({provider:r.provider,model:r.model})),
        modelCooldowns:await store.cooldowns(),
        limits:{requests:config.requestLimit,reservedTokens:config.tokenLimit,reservedCost:config.costLimit},
        generation:{maxCardsPerRequest:generationBatchSize(config),deliveryBatch:10,topicSelection:'random-balanced',liveSourcesEnabled:config.liveSources},
        sources:JSON.parse((await store.db.prepare("SELECT value FROM settings WHERE key='last_source_status'").get())?.value ?? '[]'),
        inventory:{minimum:config.unreadMin,refillAt:config.refillAt,target:config.target,readNonFavoriteLimit:config.readLimit},jobs});
    }
    if(!await store.ready()) throw new Failure('migration_not_ready',503);
    if(request.method==='POST' && path==='/v1/avoidance/batches') {
      const batch=avoidanceBatch(await requestBody(request));
      await store.addAvoidedSubjects(batch.deviceId,batch.subjects);
      return json({protocolVersion:1,acknowledgedSubjects:batch.subjects.map(s=>s.subject)});
    }
    if(request.method==='POST' && path==='/v1/sync') return json(await store.sync(snapshot(await requestBody(request)),config));
    const ack=path.match(/^\/v1\/deliveries\/([a-zA-Z0-9-]+)\/ack$/);
    if(request.method==='POST' && ack) {
      const b=object(await requestBody(request));
      return json(await store.acknowledge(ack[1],snapshot(b.inventory),array(b.acceptedIds,10).map(v=>string(v)),array(b.rejectedIds,10).map(v=>string(v))));
    }
    const job=path.match(/^\/v1\/jobs\/([a-zA-Z0-9-]+)$/);
    if(request.method==='GET' && job) {
      const result=await store.job(job[1]); if(!result) throw new Failure('job_not_found',404); return json(result);
    }
    const retry=path.match(/^\/v1\/jobs\/([a-zA-Z0-9-]+)\/retry$/);
    if(request.method==='POST' && retry) return json(await store.retry(retry[1],config));
    if(request.method==='POST' && path==='/v1/history/batches') {
      const b=object(await requestBody(request)); if(b.protocolVersion!==1) throw new Failure('unsupported_protocol');
      const device=string(b.deviceId),events=history(b.events);
      await store.transaction(async()=>{await store.addHistory(device,events);});
      return json({protocolVersion:1,acknowledgedEventIds:events.map(e=>e.eventId)});
    }
    throw new Failure('not_found',404);
  } catch(error) { return failure(error); }
}
