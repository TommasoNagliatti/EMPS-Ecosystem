import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { attachEnergyWebSocket } from './maquete-energy-ws.mjs';

const DEVICE_ID = 'maquete-01';
const ROUTES = new Map([
  [`/devices/${DEVICE_ID}/commands/next`, 'GET'],
  [`/devices/${DEVICE_ID}/commands/ack`, 'POST'],
  [`/devices/${DEVICE_ID}/heartbeat`, 'POST'],
  [`/devices/${DEVICE_ID}/rfid`, 'POST'],
]);

function validLabIp(value) {
  if (isIP(value) !== 4) return false;
  const parts = value.split('.').map(Number);
  return (parts[0] === 127 && parts[1] === 0 && parts[2] === 0 && parts[3] === 1) || parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function tokenMatches(actual, expected) {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function fail(response, status) {
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' });
  response.end(`${status}\n`);
}

export function createMaqueteBridge({ bindIp, deviceIp, port = 3012, backendPort = 3011, token, stationId = '46' }) {
  if (!validLabIp(bindIp) || !validLabIp(deviceIp) ||
      !Number.isInteger(port) || port < 1024 || port > 65535 ||
      !Number.isInteger(backendPort) || backendPort < 1024 || backendPort > 65535 ||
      typeof token !== 'string' || token.length < 32) {
    throw new Error('Invalid lab bridge configuration: private bind IP, device IP, ports and token are required');
  }

  const server = createServer(async (request, response) => {
    try {
      const remoteIp = request.socket.remoteAddress?.replace(/^::ffff:/, '');
      if (remoteIp !== deviceIp || !tokenMatches(request.headers['x-device-token'], token)) {
        fail(response, 403);
        return;
      }
      const url = new URL(request.url ?? '/', 'http://bridge.invalid');
      const method = ROUTES.get(url.pathname);
      if (!method || request.method !== method || url.search) {
        fail(response, 404);
        return;
      }

      let body;
      if (method === 'POST') {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
          fail(response, 415);
          return;
        }
        if (Number(request.headers['content-length'] ?? 0) > 2048) {
          fail(response, 413);
          return;
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 2048) {
            fail(response, 413);
            return;
          }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      }

      const upstream = await fetch(`http://127.0.0.1:${backendPort}${url.pathname}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: {
          'x-device-token': token,
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body } : {}),
      });
      const result = Buffer.from(await upstream.arrayBuffer());
      if (result.length > 8192) {
        fail(response, 502);
        return;
      }
      response.writeHead(upstream.status, {
        'cache-control': 'no-store',
        'content-type': upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8',
      });
      response.end(result);
    } catch {
      // Never echo a token, RFID UID or internal Backend error onto the network.
      if (!response.headersSent) fail(response, 502);
      else response.end();
    }
  });
  attachEnergyWebSocket(server, {deviceIp,token,backendPort,stationId});
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bindIp = process.env.EMPS_MAQUETE_BRIDGE_BIND_IP;
  const deviceIp = process.env.EMPS_MAQUETE_DEVICE_IP;
  const token = process.env.EMPS_MAQUETE_DEVICE_TOKEN;
  const port = Number(process.env.EMPS_MAQUETE_BRIDGE_PORT || 3012);
  const stationId = process.env.EMPS_MAQUETE_GIE_STATION_ID ?? '46';
  const server = createMaqueteBridge({ bindIp, deviceIp, port, token, stationId });
  server.listen(port, bindIp, () => {
    process.stdout.write(`Maquete lab bridge listening on ${bindIp}:${port}; allowed device ${deviceIp}\n`);
  });
}
