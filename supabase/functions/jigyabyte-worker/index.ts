import {configuration,connect,authorize,failure,json} from '../_shared/runtime.ts';
import {runWorker} from '../_shared/worker.ts';

Deno.serve(async request=>{
  let store;
  try {
    const env=Deno.env.toObject();
    authorize(request,env.JIGYABYTE_WORKER_TOKEN ?? '');
    if(request.method!=='POST') return json({error:'method_not_allowed'},405);
    const config=configuration(env); store=connect(env);
    return json(await runWorker(config,store));
  } catch(error) { return failure(error); }
  finally { await store?.close(); }
});
