import {configuration,connect,authorize,failure} from '../_shared/runtime.ts';
import {handleApi} from '../_shared/api.ts';

Deno.serve(async request=>{
  let store;
  try {
    const env=Deno.env.toObject(),config=configuration(env);
    // Reject bad credentials before opening a database connection.
    if(!new URL(request.url).pathname.endsWith('/health')) authorize(request,config.token);
    store=connect(env);
    return await handleApi(request,config,store);
  } catch(error) { return failure(error); }
  finally { await store?.close(); }
});
