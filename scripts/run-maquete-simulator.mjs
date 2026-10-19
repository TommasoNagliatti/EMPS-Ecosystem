// Continuous ESP32 emulator for clicking the local Site. No GPIO or USB output.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(resolve(repo, '..', 'EMPS_BACKUPS', 'emps-maquete-lab.runtime.json'), 'utf8'));
assert.equal(config.deviceId, 'maquete-01');
assert.equal(config.stationId, 46);
const url = 'http://127.0.0.1:3012/devices/maquete-01';
const headers = { 'x-device-token': config.token };
const bootId = `sim_${randomUUID().replaceAll('-', '')}`;
const seen = new Set();
let ev1 = false;
let ev2 = false;
let lastCommandId = null;
let lastSuccessfulHeartbeat = 0;
let lastHeartbeatAttempt = 0;
let running = true;

process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function serial(origin) {
  console.log(`[${origin}] EV1=${ev1 ? 1 : 0} RELE_GPIO15=${ev1 ? 'LOW' : 'HIGH'} | EV2=${ev2 ? 1 : 0} RELE_GPIO33=${ev2 ? 'LOW' : 'HIGH'} (SIMULADOR SEM GPIO)`);
}
function off(reason) {
  if (ev1 || ev2) {
    ev1 = false; ev2 = false;
    serial(`FALHA SEGURA: ${reason}`);
  }
}
async function call(path, method = 'GET', body) {
  const response = await fetch(url + path, {
    method,
    headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(4_000),
  });
  if (![200, 204].includes(response.status)) throw new Error(`HTTP ${response.status} ${path}`);
  return { status: response.status, body: await response.text() };
}
async function heartbeat() {
  const { body } = await call('/heartbeat', 'POST', {
    bootId, ev1, ev2, ...(lastCommandId ? { lastCommandId } : {}),
  });
  lastSuccessfulHeartbeat = Date.now();
  const values = Object.fromEntries(body.trim().split('\n').map(line => line.split('=', 2)));
  if (values.stationId !== '46') throw new Error('Vínculo de estação divergente');
  if (values.ev1Authorized !== '1' && ev1) off('EV1 sem autorização');
  if (values.ev2Authorized !== '1' && ev2) off('EV2 sem autorização');
}

async function poll() {
  const reply = await call('/commands/next');
  if (reply.status === 204) return;
  const [id, action, ttlText] = reply.body.trim().split('|');
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^EV[12]=[01]$/.test(action) || Number(ttlText) <= 0) {
    throw new Error('Comando inválido ou vencido');
  }
  const enabled = action.endsWith('=1');
  console.log(`[SIMULADOR] RECEBIDO id=${id} comando=${action} (sem ESP32, GPIO ou rele)`);
  if (enabled && Date.now() - lastSuccessfulHeartbeat > 8_000) {
    off('heartbeat vencido antes de START');
    console.log(`[SIMULADOR] RECUSADO id=${id} comando=${action}: heartbeat vencido`);
    return;
  }
  if (!seen.has(id)) {
    seen.add(id);
    if (seen.size > 128) seen.delete(seen.values().next().value);
    if (action.startsWith('EV1')) ev1 = enabled;
    else ev2 = enabled;
    serial(`COMANDO ${id}`);
  }
  const ack = await call('/commands/ack', 'POST', { commandId: id, accepted: true, ev1, ev2 });
  const result = JSON.parse(ack.body);
  if (result.commandId !== id || result.status !== 'ACKED') {
    off(`ACK ${result.status ?? 'inválido'}`);
  } else {
    lastCommandId = id;
    console.log(`[SIMULADOR] CONFIRMADO LOGICAMENTE id=${id} comando=${action}; nenhum GPIO foi acionado`);
  }
}

serial('BOOT');
console.log('[SIMULADOR] Ponte em 127.0.0.1:3012; abra o Posto 46 no Site. Ctrl+C encerra.');
while (running) {
  try {
    if (Date.now() - lastHeartbeatAttempt >= 5_000) {
      lastHeartbeatAttempt = Date.now();
      await heartbeat();
    }
    await poll();
  } catch (error) {
    console.log(`[COMUNICACAO] ${error instanceof Error ? error.message : 'falha'}`);
  }
  if (Date.now() - lastSuccessfulHeartbeat > 8_000) off('sem heartbeat');
  await pause(1_200);
}
off('simulador encerrado');
try { await heartbeat(); } catch { /* Backend may already be stopped. */ }
