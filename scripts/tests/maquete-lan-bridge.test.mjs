import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createMaqueteBridge } from '../maquete-lan-bridge.mjs';

const token = 'maquete-device-token-for-local-tests-only-12345';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('lab bridge forwards only authenticated maquete device routes', async () => {
  const seen = [];
  const backend = createServer((request, response) => {
    seen.push({ path: request.url, method: request.method, token: request.headers['x-device-token'] });
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ACK');
  });
  const backendPort = await listen(backend);
  const bridge = createMaqueteBridge({
    bindIp: '127.0.0.1', deviceIp: '127.0.0.1', port: 3012, backendPort, token,
  });
  const port = await listen(bridge);
  try {
    const base = `http://127.0.0.1:${port}`;
    const path = '/devices/maquete-01/commands/next';
    assert.equal((await fetch(base + path)).status, 403);
    assert.equal((await fetch(base + '/stations/46/dashboard', {
      headers: { 'x-device-token': token },
    })).status, 404);
    assert.equal((await fetch(base + '/v2/stations/46/charging-sandbox/chargers/76/start', {
      method: 'POST', headers: { 'x-device-token': token, 'content-type': 'application/json' },
      body: '{}',
    })).status, 404);
    assert.equal((await fetch(base + path + '?debug=1', {
      headers: { 'x-device-token': token },
    })).status, 404);
    assert.equal((await fetch(base + path, {
      headers: { 'x-device-token': token },
    })).status, 200);
    assert.deepEqual(seen, [{ path, method: 'GET', token }]);

    const ack = await fetch(base + '/devices/maquete-01/commands/ack', {
      method: 'POST',
      headers: { 'x-device-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ commandId: 'example', accepted: true }),
    });
    assert.equal(ack.status, 200);
    assert.equal(seen.length, 2);
    assert.equal(seen[1].path, '/devices/maquete-01/commands/ack');
  } finally {
    await close(bridge);
    await close(backend);
  }
});

test('lab bridge requires explicit private IPs and a long token', () => {
  assert.throws(() => createMaqueteBridge({
    bindIp: '0.0.0.0', deviceIp: '127.0.0.1', token,
  }), /Invalid lab bridge/);
  assert.throws(() => createMaqueteBridge({
    bindIp: '127.0.0.1', deviceIp: '8.8.8.8', token,
  }), /Invalid lab bridge/);
  assert.throws(() => createMaqueteBridge({
    bindIp: '127.0.0.1', deviceIp: '127.0.0.1', token: 'short',
  }), /Invalid lab bridge/);
});
