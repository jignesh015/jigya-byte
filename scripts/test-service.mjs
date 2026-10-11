import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCardService } from '../service/server.mjs';

test('local service: generation, disk cache, invalid input, cloud refusal and offline fallback', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'jigyabyte-test-'));
  const cacheFile = path.join(temp, 'cards.json');
  let offline = false;
  const calls = [];
  const request = async (url, options) => {
    calls.push(url);
    assert.ok(url.startsWith('http://127.0.0.1:11434/'));
    if (offline) throw new Error('Offline');
    if (url.endsWith('/tags')) return Response.json({ models: [{ name: 'test:latest', size: 100 }] });
    if (url.endsWith('/show')) return Response.json({ modelfile: 'FROM local-weights' });
    const input = JSON.parse(options.body);
    assert.equal(input.stream, false);
    return Response.json({ response: JSON.stringify({ title: 'One idea', summary: 'A short explanation.', explanation: 'A longer explanation.' }) });
  };
  const server = createCardService({ model: 'test', request, cacheFile });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const generate = body => fetch(`${base}/generate`, { method: 'POST', body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await generate({ topicId: 'unknown' })).status, 400);
    const generated = await generate({ topicId: 'space' });
    assert.equal(generated.status, 200);
    const card = await generated.json();
    assert.equal(card.providerId, 'local-ai');
    assert.equal(card.primaryTopicId, 'space');
    assert.equal(card.sourceUrl, null);
    await generate({ topicId: 'space' });
    assert.equal((await (await fetch(`${base}/cards`)).json()).cards.length, 1);
    offline = true;
    assert.equal((await fetch(`${base}/health`)).status, 503);
    assert.equal((await generate({ topicId: 'space' })).status, 503);
    assert.equal((await (await fetch(`${base}/cards`)).json()).cards.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
  const cloud = createCardService({ model: 'test:cloud', request, cacheFile });
  await new Promise(resolve => cloud.listen(0, '127.0.0.1', resolve));
  try {
    const before = calls.length;
    assert.equal((await fetch(`http://127.0.0.1:${cloud.address().port}/health`)).status, 503);
    assert.equal(calls.length, before);
    assert.equal((await (await fetch(`http://127.0.0.1:${cloud.address().port}/cards`)).json()).cards.length, 1);
  } finally { await new Promise(resolve => cloud.close(resolve)); await rm(temp, { recursive: true, force: true }); }
});
