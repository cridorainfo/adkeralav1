import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import { setupBusCors } from '../server/cors.js';

function request(app, options) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: options.method ?? 'GET',
          path: options.path ?? '/',
          headers: options.headers ?? {},
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            server.close();
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        }
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

test('setupBusCors allows Private Network Access preflight from cloud PWA', async () => {
  const app = express();
  setupBusCors(app);
  app.get('/api/hub/status', (_req, res) => res.json({ ok: true }));

  const res = await request(app, {
    method: 'OPTIONS',
    path: '/api/hub/status',
    headers: {
      Origin: 'https://adkeralav1-production.up.railway.app',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Private-Network': 'true',
    },
  });

  assert.equal(res.statusCode, 204);
  assert.equal(
    res.headers['access-control-allow-origin'],
    'https://adkeralav1-production.up.railway.app'
  );
  assert.equal(res.headers['access-control-allow-private-network'], 'true');
});
