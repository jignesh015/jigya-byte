// Copy only approved provider settings; never print secret values.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {readConfig} from '../backend/src/config.ts';
process.loadEnvFile('backend/.env');
const local=readConfig(process.env);
if(local.paid || !local.freeConfirmed || local.provider!=='gemini') throw new Error('Expected the approved free Gemini configuration');
if(local.requestLimit>30 || local.tokenLimit>725760) throw new Error('Local limits exceed the approved caps');
const template=readFileSync('supabase/cloud-config.example','utf8');
const lines=[];
for(const line of template.split(/\r?\n/)) {
  const match=line.match(/^([A-Z_]+)=(.*)$/); if(!match) continue;
  const [_,name,fallback]=match;
  if(['JIGYABYTE_DATABASE_URL','BACKEND_DEVICE_TOKEN','JIGYABYTE_WORKER_TOKEN'].includes(name)) continue;
  const value=process.env[name] ?? fallback;
  if(/[\r\n]/.test(value)) throw new Error('Environment value contains a newline');
  lines.push(`${name}=${value}`);
}
if(existsSync('.env.cloud')) throw new Error('Cloud secrets file already exists; preserve it rather than rotating phone credentials accidentally');
lines.push(`BACKEND_DEVICE_TOKEN=${randomBytes(32).toString('hex')}`,`JIGYABYTE_WORKER_TOKEN=${randomBytes(32).toString('hex')}`);
writeFileSync('.env.cloud',lines.join('\n')+'\n',{mode:0o600});
console.log('Prepared ignored .env.cloud with approved provider configuration and separate random pairing/worker tokens. No credentials printed.');
