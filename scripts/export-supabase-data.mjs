// Read-only export. The live backend must be stopped before the final cutover.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readConfig} from '../backend/src/config.ts';

process.loadEnvFile('backend/.env');
const config=readConfig(process.env);
const host=config.host==='0.0.0.0'?'127.0.0.1':config.host;
const alive=await fetch(`http://${host}:${config.port}/health`,{signal:AbortSignal.timeout(2000)}).then(r=>r.ok).catch(()=>false);
if(alive) throw new Error('Stop the local backend before exporting its state');

const source=resolve(process.argv[2] ?? 'backend/data/backend.sqlite');
const output=resolve('artifacts/supabase-cutover');
if(!existsSync(source)) throw new Error('Backend database is missing');
const db=new DatabaseSync(source,{readOnly:true});
try {
  if(db.prepare('PRAGMA user_version').get().user_version!==7) throw new Error('Expected backend schema 7');
  mkdirSync(output,{recursive:true});
  const tag=randomUUID().replaceAll('-','');
  // SQLite snapshot includes committed WAL pages; copying the main file alone would lose them.
  const backup=resolve(output,`backend-${tag}.sqlite`);
  db.exec(`VACUUM INTO '${backup.replaceAll("'","''")}'`);
  const quoted=value=>value===null?'NULL':typeof value==='number'?String(value):`$jb_${tag}$${value}$jb_${tag}$`;
  const tables=['cards','devices','history','deliveries','jobs','usage','source_cache','topic_generation','source_usage'];
  const sql=['BEGIN;','SELECT pg_advisory_xact_lock(431913);',
    "DO $$ BEGIN IF (SELECT value FROM jigyabyte.settings WHERE key='migration_ready') IS DISTINCT FROM 'false' OR EXISTS(SELECT 1 FROM jigyabyte.devices) OR EXISTS(SELECT 1 FROM jigyabyte.usage) OR EXISTS(SELECT 1 FROM jigyabyte.cards) THEN RAISE EXCEPTION 'Target must be a fresh, unactivated cloud backend'; END IF; END $$;"];
  const counts={};
  const snapshotDb=new DatabaseSync(backup,{readOnly:true});
  try {
    for(const table of tables) {
      const rows=snapshotDb.prepare(`SELECT * FROM ${table}`).all(); counts[table]=rows.length;
      for(const row of rows) {
        if(table==='jobs') {
          row.next_at=Math.ceil(row.next_at);
          if(row.state==='running') {row.state='uncertain';row.error='interrupted_request_requires_reconciliation';}
        }
        const columns=Object.keys(row);
        sql.push(`INSERT INTO jigyabyte.${table} (${columns.map(c=>`"${c}"`).join(',')}) VALUES (${columns.map(c=>quoted(row[c])).join(',')});`);
      }
    }
  } finally {snapshotDb.close();}
  sql.push("UPDATE jigyabyte.settings SET value='true' WHERE key='migration_ready';",'COMMIT;');
  writeFileSync(resolve(output,'import.sql'),sql.join('\n')+'\n');
  console.log(JSON.stringify({exported:true,counts,output:'artifacts/supabase-cutover/import.sql'}));
} finally {db.close();}
