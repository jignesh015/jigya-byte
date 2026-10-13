import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readConfig } from '../../../backend/src/config.ts';
import { Failure } from '../../../backend/src/contracts/index.ts';
import { PostgresStore } from './store.ts';

export function configuration(env: Record<string,string|undefined>) {
  if (env.ALLOW_PAID_CALLS && env.ALLOW_PAID_CALLS !== 'false') throw new Error('Paid calls are disabled for the cloud backend');
  const config = readConfig({...env, ALLOW_PAID_CALLS:'false',MAX_CONCURRENT_JOBS:'1'});
  if (config.requestLimit>30 || config.tokenLimit>725760) throw new Error('Cloud limits must not exceed the approved daily caps');
  return config;
}
export function authorize(request: Request, token: string) {
  const actual=Buffer.from(request.headers.get('authorization') ?? ''), expected=Buffer.from(`Bearer ${token}`);
  if (token.length<32 || actual.length!==expected.length || !timingSafeEqual(actual,expected)) throw new Failure('unauthorized',401);
}
export function connect(env: Record<string,string|undefined>) {
  const url=env.JIGYABYTE_DATABASE_URL ?? env.SUPABASE_DB_URL;
  if (!url) throw new Error('Missing cloud database connection');
  return new PostgresStore(url);
}
export function json(value: unknown,status=200) {
  return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export function failure(error: unknown) {
  return json({error:error instanceof Failure ? error.code : 'internal_error'},error instanceof Failure ? error.status : 500);
}
export async function requestBody(request: Request) {
  const reader=request.body?.getReader();
  if (!reader) throw new Failure('invalid_json');
  const chunks:Uint8Array[]=[]; let bytes=0;
  try {
    while (true) {
      const {done,value}=await reader.read(); if (done) break;
      bytes+=value.byteLength; if(bytes>512*1024) throw new Failure('request_too_large',413);
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Failure('invalid_json'); }
}
