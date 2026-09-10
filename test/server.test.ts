import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../src/server.ts';

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const server = createAppServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('unexpected address');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('POST /api/parse returns structured required multi-transaction result', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/parse`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'ข้าวมันไก่ 50 น้ำเปล่า 7 แล้วก็ช้อปปิ้ง 500' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.transactions.length, 3);
    assert.deepEqual(body.transactions.map((item: any) => item.amount), [50, 7, 500]);
  });
});

test('POST /api/parse rejects blank input with 400', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/parse`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '   ' }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /blank/);
  });
});

test('malformed JSON is a 400 response rather than a server crash', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/parse`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken',
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /invalid JSON/);
  });
});

test('oversized parse input is rejected with 413', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/parse`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'ก'.repeat(3000) }),
    });
    assert.equal(response.status, 413);
  });
});

test('POST /api/confirm accepts edited reviewed transactions', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transactions: [{
        id: 1, description: 'ข้าวมันไก่พิเศษ', amount: 60, currency: 'THB', category: 'FOOD',
        occurredAt: '2026-09-09T17:30:00+07:00',
      }] }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'confirmed');
    assert.equal(body.transactions[0].description, 'ข้าวมันไก่พิเศษ');
    assert.equal(body.transactions[0].amount, 60);
  });
});

test('POST /api/confirm rejects invalid edited amount', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transactions: [{
        id: 1, description: 'x', amount: -1, currency: 'THB', category: 'OTHER', occurredAt: new Date().toISOString(),
      }] }),
    });
    assert.equal(response.status, 400);
  });
});

test('POST /api/confirm rejects unsafe reviewed amount precision over HTTP', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transactions: [{
        id: 1, description: 'x', amount: 12.345, currency: 'THB', category: 'OTHER', occurredAt: new Date().toISOString(),
      }] }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /two decimal places/);
  });
});
