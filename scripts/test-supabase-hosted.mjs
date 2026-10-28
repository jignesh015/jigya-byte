// Isolated hosted smoke device. --generate makes at most one real, budgeted Gemini attempt.
import assert from 'node:assert/strict';
import process from 'node:process';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {cardSubject,avoidsCard} from '../src/data/subjectAvoidance.ts';
process.loadEnvFile('.env.cloud');
const base='https://fuomvvzgdhleikztdpgz.supabase.co/functions/v1/';
const device=`deployment-probe-${randomUUID()}`;
// Cleanup is scoped to this probe only. Daily usage and newly generated cache are retained.
writeFileSync('artifacts/supabase-cutover/probe-cleanup.sql',`BEGIN;
SELECT pg_advisory_xact_lock(431913);
DELETE FROM jigyabyte.deliveries WHERE device_id='${device}';
DELETE FROM jigyabyte.history WHERE device_id='${device}';
DELETE FROM jigyabyte.jobs WHERE device_id='${device}';
DELETE FROM jigyabyte.devices WHERE id='${device}';
DELETE FROM jigyabyte.avoided_subjects WHERE device_id IN ('${device}','${device}-avoid');
DELETE FROM jigyabyte.deliveries WHERE device_id='${device}-avoid';
DELETE FROM jigyabyte.history WHERE device_id='${device}-avoid';
DELETE FROM jigyabyte.jobs WHERE device_id='${device}-avoid';
DELETE FROM jigyabyte.devices WHERE id='${device}-avoid';
COMMIT;\n`);
const api=async(path,body,token=process.env.BACKEND_DEVICE_TOKEN)=>{
  const response=await fetch(base+'jigyabyte-api'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const result=await response.json();if(!response.ok)throw new Error(`${path}: ${response.status} ${result.error}`);return result;
};
const unauthorized=await fetch(base+'jigyabyte-api/v1/status');assert.equal(unauthorized.status,401);
const unauthorizedWorker=await fetch(base+'jigyabyte-worker',{method:'POST',headers:{Authorization:`Bearer ${process.env.BACKEND_DEVICE_TOKEN}`}});assert.equal(unauthorizedWorker.status,401);
const before=await api('/v1/status');assert.equal(before.migrationReady,true);
let inventory={protocolVersion:1,deviceId:device,inventoryVersion:1,snapshotComplete:true,counts:{unread:0,readNonFavorite:0,favorites:0},
  retainedCards:[],interestTopicIds:['space'],historyEvents:[],pendingDeliveryIds:[]};
const first=await api('/v1/sync',inventory),again=await api('/v1/sync',inventory);
assert.equal(first.cards.length,10);assert.equal(first.deliveryId,again.deliveryId);assert.deepEqual(first.cards,again.cards);
inventory={...inventory,inventoryVersion:2};
const ack={inventory,acceptedIds:[],rejectedIds:first.cards.map(c=>c.id)};
assert.equal((await api(`/v1/deliveries/${first.deliveryId}/ack`,ack)).acknowledged,true);
assert.equal((await api(`/v1/deliveries/${first.deliveryId}/ack`,ack)).acknowledged,true);
console.log(JSON.stringify({authenticated:true,unauthorizedBlocked:true,workerRejectsPhoneToken:true,cachedDelivery:first.cards.length,lostResponseRetry:true,lostAckRetry:true,usage:before.usage}));
if(process.argv.includes('--avoidance')) {
  const blocked=first.cards[0],subject={subject:cardSubject(blocked),topicIds:blocked.topicIds};
  const payload={protocolVersion:1,deviceId:`${device}-avoid`,subjects:[subject]};
  for(let i=0;i<2;i++) {
    const response=await api('/v1/avoidance/batches',payload);
    assert.deepEqual(response.acknowledgedSubjects,[subject.subject]);
  }
  const delivery=await api('/v1/sync',{...inventory,deviceId:payload.deviceId,inventoryVersion:1});
  assert.equal(delivery.cards.length,10);
  assert.ok(delivery.cards.every(c=>!avoidsCard(c,[subject])));
  const invalid=await fetch(base+'jigyabyte-api/v1/avoidance/batches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  assert.equal(invalid.status,401);
  const after=await api('/v1/connection');
  assert.deepEqual(after.usage,before.usage);
  console.log(JSON.stringify({avoidanceAuthenticated:true,idempotentPreference:true,cachedExclusions:true,
    compactSubjectBytes:Buffer.byteLength(subject.subject),noGenerationReserved:true}));
}
if(process.argv.includes('--generate')) {
  const db=new DatabaseSync('backend/data/backend.sqlite',{readOnly:true});
  const cards=db.prepare('SELECT body FROM cards').all().map(r=>JSON.parse(r.body));db.close();
  inventory={...inventory,inventoryVersion:3,counts:{unread:0,readNonFavorite:0,favorites:cards.length},
    retainedCards:cards.map(c=>({id:c.id,contentHash:c.contentHash,ideaFingerprint:c.ideaFingerprint,read:true,favorite:true}))};
  const queued=await api('/v1/sync',inventory);assert.ok(queued.refillJobId);
  const response=await fetch(base+'jigyabyte-worker',{method:'POST',headers:{Authorization:`Bearer ${process.env.JIGYABYTE_WORKER_TOKEN}`},signal:AbortSignal.timeout(125000)});
  const result=await response.json();console.log(JSON.stringify({workerHttpStatus:response.status,...result}));
  assert.equal(response.status,200);
  const after=await api('/v1/status');
  assert.equal(after.usage.requests,before.usage.requests+1);
  console.log(JSON.stringify({attemptReserved:true,usage:after.usage}));
}
