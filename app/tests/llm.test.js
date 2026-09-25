// llm.test.js — Sağlayıcı istemcileri + failover/retry makinesi testleri.
// Gerçek API'ye gitmeden yerel bir mock sunucu ile doğrular.
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { withRetry, streamProvider, jsonProvider } = require('../webhook-client');

let server;
let port;
let failCount = 0;

test.before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url !== '/chat/completions') { res.writeHead(404); return res.end('{"error":{"message":"yok"}}'); }
      if (failCount > 0) {
        failCount--;
        res.writeHead(500);
        return res.end('{"error":{"message":"gecici"}}');
      }
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch { /* yok */ }
      if (parsed.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"Mer"}}]}\n\n');
        res.write('data: {"choices":[{"delta":{"content":"haba"}}]}\n\n');
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"choices":[{"message":{"content":"ok"}}]}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

test.after(() => { if (server) server.close(); });

function provider() {
  return { name: 'Test', baseURL: 'http://127.0.0.1:' + port, apiKey: 'test-key', model: 'test-model' };
}

test('streamProvider: SSE akışını toplar', async () => {
  let last = '';
  const r = await streamProvider(provider(), { messages: [], stream: true }, (t) => { last = t; }, 10000, null);
  assert.strictEqual(r.output, 'Merhaba');
  assert.strictEqual(last, 'Merhaba');
  assert.strictEqual(r.provider, 'Test');
});

test('jsonProvider: JSON yanıtı döner', async () => {
  const r = await jsonProvider(provider(), { messages: [], stream: false }, 10000, null);
  assert.ok(r.choices && r.choices[0].message.content === 'ok');
});

test('withRetry: geçici 500 hatasında yeniden dener', async () => {
  failCount = 1;
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    return await jsonProvider(provider(), { messages: [], stream: false }, 10000, null);
  }, 2, [100, 200]);
  assert.strictEqual(result.choices[0].message.content, 'ok');
  assert.strictEqual(calls, 2, 'ilk hata sonrası 2. deneme başarılı olmalı');
});

test('jsonProvider: 4xx hatası net mesaj fırlatır', async () => {
  await assert.rejects(
    () => jsonProvider({ name: 'Test', baseURL: 'http://127.0.0.1:' + port + '/yok', apiKey: 'k', model: 'm' }, { messages: [] }, 5000, null),
    /API hatası \(404\)/,
  );
});
