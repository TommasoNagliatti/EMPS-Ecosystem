import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceTokenMatches, heartbeatText, labConfig, labGieSnapshot, parseUid, uidHash, unavailableGie } from '../src/lab-maquete-domain';
import type { GieV3Envelope } from '../src/gie-v3.service';
import { LabMaqueteService } from '../src/lab-maquete.service';

const clone = 'mysql://emps_integration_app:local-secret@127.0.0.1:3308/emps_integration_test';
const env = {
  NODE_ENV: 'development', EMPS_LOCAL_LEGACY_INTEGRATION: 'true', EMPS_REMOTE_DEVELOPMENT: 'false',
  EMPS_PHYSICAL_COMMANDS_ENABLED: 'false', EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED: 'false',
  PAYMENT_PROVIDER: 'sandbox', HOST: '127.0.0.1', DEMO_HISTORY_TEST_DATABASE: 'emps_integration_test',
  DATABASE_URL: clone, EMPS_MAQUETE_LAB_ENABLED: 'true', EMPS_MAQUETE_DEVICE_ID: 'maquete-01',
  EMPS_MAQUETE_STATION_ID: '46', EMPS_MAQUETE_DEVICE_TOKEN: 'local-lab-device-token-with-32-characters',
};

test('USB laboratory gate is pinned to the explicitly bound 3308 clone and preserves physical command block', () => {
  assert.deepEqual(labConfig(env), { stationId: 46, deviceId: 'maquete-01', token: env.EMPS_MAQUETE_DEVICE_TOKEN });
  for (const changed of [clone.replace('3308','3306'), clone.replace('3308','3307'),
    clone.replace('emps_integration_test','emps_db'), clone.replace('127.0.0.1','localhost')])
    assert.throws(() => labConfig({ ...env, DATABASE_URL: changed }), /exclusivamente/);
  assert.throws(() => labConfig({ ...env, EMPS_PHYSICAL_COMMANDS_ENABLED: 'true' }), /exclusivamente/);
  assert.throws(() => labConfig({ ...env, EMPS_MAQUETE_DEVICE_TOKEN: 'short' }), /inválido/);
  assert.equal(labConfig({ ...env, EMPS_MAQUETE_LAB_ENABLED: 'false' }), null);
  assert.equal(deviceTokenMatches(env.EMPS_MAQUETE_DEVICE_TOKEN, env.EMPS_MAQUETE_DEVICE_TOKEN), true);
  assert.equal(deviceTokenMatches(env.EMPS_MAQUETE_DEVICE_TOKEN, 'bad'), false);
});

function gie(): GieV3Envelope {
  return { station_id: '46', gie_station_id: 'DEMO_POSTO_24H_001', generation: 'g1', mode: 'NORMAL',
    observed_at: '2026-10-18T12:00:00Z', online: true, health: null, source: 'SIMULATED',
    physical_dispatch: false, hardware_commands_sent: false,
    state: { timestamp: '2025-12-01T15:00:00-03:00', execution_allowed: true,
      provenance: { origin: 'SIMULATED', station_id: 'DEMO_POSTO_24H_001' },
      visual_state: { valid: true, grid_importing: true, building_active: true },
      numeric_state: { grid_import_kw: 8.25, solar_kw: 3.5 },
      station_extension: { station_id: 'DEMO_POSTO_24H_001', equipment: {
        batteries: [{ id: 'BAT_01' }, { id: 'BAT_02' }] },
        battery_decisions: { BAT_01: { soc_after: 0.251 }, BAT_02: { soc_after: 0.678 } } } } };
}

test('LCD snapshot uses only valid current GIE decision and individual battery SoCs', () => {
  const state = labGieSnapshot(gie(), 46);
  assert.deepEqual([state.gridKw, state.solarKw, state.bat01Soc, state.bat02Soc], [8.25,3.5,25.1,67.8]);
  assert.equal(state.scenarioAt, '2025-12-01T15:00:00-03:00');
  assert.match(heartbeatText(46,'Posto 24h',state,false,true), /gieValid=1\ngieSource=SIMULATED\ngieScenarioAt=2025-12-01T15:00:00-03:00\ngridKw=8.25\nsolarKw=3.5\nbat01Soc=25.1\nbat02Soc=67.8/);
  assert.match(heartbeatText(46,'Posto 24h',state,false,true), /ev1Authorized=0\nev2Authorized=1/);
  for (const invalid of [
    { ...gie(), online: false },
    { ...gie(), station_id: '13' },
    { ...gie(), hardware_commands_sent: true },
    { ...gie(), state: { ...gie().state, execution_allowed: false } },
    { ...gie(), state: { ...gie().state, visual_state: { valid: false } } },
  ]) assert.deepEqual(labGieSnapshot(invalid as GieV3Envelope,46), unavailableGie);
  const unavailable = heartbeatText(46,'Posto 24h',unavailableGie,false,false);
  assert.match(unavailable,/gieValid=0/);
  assert.doesNotMatch(unavailable,/solarKw=|bat01Soc=/);
});

test('RFID UIDs are HMACed and never accepted from malformed card data', () => {
  assert.equal(parseUid({uid:'a1b2c3d4'}),'A1B2C3D4');
  assert.throws(() => parseUid({uid:'A1B2C3'}));
  assert.throws(() => parseUid({uid:'A1B2C3D4;EV1=1'}));
  assert.equal(uidHash('A1B2C3D4','secret'),uidHash('a1b2c3d4','secret'));
  assert.notEqual(uidHash('A1B2C3D4','secret'),'A1B2C3D4');
});

test('expired laboratory command is terminal on GET and a protected database cannot queue commands', async () => {
  const keys = Object.keys(env);
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  const old = new Date(Date.now() - 2_000);
  let writes = 0;
  const db = {
    labDevice: { findUnique: async () => ({ id: 'maquete-01', stationId: 46, bootId: 'sim_test', lastHeartbeatAt: new Date(),
      ev1: false, ev2: false, authorizedEv1: false, authorizedEv2: false }) },
    labDeviceCommand: { findFirst: async ({ where }: { where: { evse: string } }) => where.evse === 'EV1'
      ? { id: 'expired-id', status: 'PENDING', expiresAt: old, ackedAt: null } : null },
    labDeviceEvent: { findFirst: async () => null },
    $transaction: async () => { writes++; throw new Error('Write attempted'); },
  };
  const access = { require: async (_: unknown, id: unknown) => ({ id: Number(id) }) };
  const gie = { cachedState: () => null, refresh: async () => null };
  try {
    Object.assign(process.env, env);
    const service = new LabMaqueteService(db as never, access as never, gie as never);
    const state = await service.state({ sub: '64' } as never, '46');
    assert.equal(state.connectionSource, 'SIMULATOR');
    assert.equal(state.evses.EV1.lastCommandStatus, 'EXPIRED');
    assert.equal(state.evses.EV1.pendingCommandId, null);
    process.env.DATABASE_URL = clone.replace('3308', '3306');
    await assert.rejects(service.issue({ sub: '64' } as never, '46', { evse: 'EV1', enabled: true }), /exclusivamente/);
    assert.equal(writes, 0);
  } finally {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('a START cannot replace a safety STOP or authorize a relay already reported active', async () => {
  const keys = Object.keys(env);
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  let reported = true;
  let pendingStop = false;
  let created = 0;
  const tx = {
    $queryRaw: async () => [],
    labDevice: { findUnique: async () => ({ id: 'maquete-01', stationId: 46,
      lastHeartbeatAt: new Date(Date.now() - 1_000), ev1: reported, ev2: false,
      authorizedEv1: false, authorizedEv2: false }) },
    labDeviceCommand: {
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => pendingStop ? { enabled: false, status: 'PENDING',
        expiresAt: new Date(Date.now() + 10_000) } : null,
      create: async () => { created++; throw new Error('unsafe START was queued'); },
    },
  };
  const db = { $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) };
  const access = { require: async () => ({ id: 46 }) };
  const gie = { cachedState: () => null, refresh: async () => null };
  try {
    Object.assign(process.env, env);
    const service = new LabMaqueteService(db as never, access as never, gie as never);
    await assert.rejects(service.issue({ sub: '64' } as never, '46', { evse: 'EV1', enabled: true }), /já reporta relé ativo/);
    reported = false; pendingStop = true;
    await assert.rejects(service.issue({ sub: '64' } as never, '46', { evse: 'EV1', enabled: true }), /Parada pendente/);
    assert.equal(created, 0);
  } finally {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('a late session mirror cannot queue START after its sandbox charge has finished', async () => {
  const keys = [...Object.keys(env), 'EMPS_CHARGING_SANDBOX_ENABLED'];
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  const sessionId = 'a88100a4-83f0-4c04-9f9f-f95a24b0af4a';
  let commandCreated = 0;
  let locks = 0;
  const tx = {
    $queryRaw: async () => { locks++; return []; },
    labDevice: { findUnique: async () => ({ id: 'maquete-01', stationId: 46 }) },
    labDeviceCommand: {
      updateMany: async () => ({ count: 0 }),
      create: async () => { commandCreated++; throw new Error('late START was queued'); },
    },
    labChargeSession: { findUnique: async () => ({ id: sessionId, stationId: 46, chargerId: 76,
      actorUserId: 64, evse: 'EV1', status: 'FINISHED' }) },
  };
  const db = { $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) };
  const access = { require: async () => ({ id: 46 }) };
  const gie = { cachedState: () => null, refresh: async () => null };
  try {
    Object.assign(process.env, env, { EMPS_CHARGING_SANDBOX_ENABLED: 'true' });
    const service = new LabMaqueteService(db as never, access as never, gie as never);
    await assert.rejects(service.issue({ sub: '64' } as never, '46',
      { evse: 'EV1', enabled: true, requestId: sessionId }, 'CHARGING_SESSION'), /já não autoriza/);
    assert.equal(locks, 2); // lab device and charger use transaction locks
    assert.equal(commandCreated, 0);
  } finally {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('completed sandbox session revokes device authorization without relying on the operator role', async () => {
  const keys = [...Object.keys(env), 'EMPS_CHARGING_SANDBOX_ENABLED'];
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  const sessionId = 'b861bd1b-84e3-47a3-afab-d65abcc72411';
  let authorization = true;
  let invalidatedStarts = 0;
  let stopCommands = 0;
  let permissionChecks = 0;
  const tx = {
    $queryRaw: async () => [],
    labDevice: {
      findUnique: async () => ({ id: 'maquete-01', stationId: 46 }),
      update: async ({ data }: { data: { authorizedEv1: boolean } }) => {
        authorization = data.authorizedEv1;
        return {};
      },
    },
    labChargeSession: { findUnique: async () => ({ id: sessionId, stationId: 46,
      chargerId: 76, evse: 'EV1', status: 'FINISHED' }) },
    station: { findUnique: async () => ({ visibility: 'PRIVATE', reviewState: 'DRAFT' }) },
    gieStationBinding: { findUnique: async () => ({ profile: 'POSTO', origin: 'SIMULATED' }) },
    labDeviceCommand: {
      updateMany: async ({ where }: { where: { enabled?: boolean } }) => {
        if (where.enabled) invalidatedStarts++;
        return { count: 1 };
      },
      findFirst: async () => null,
      create: async ({ data }: { data: { enabled: boolean; evse: string } }) => {
        assert.equal(data.enabled, false);
        assert.equal(data.evse, 'EV1');
        stopCommands++;
        return { id: 'stop-id', evse: data.evse, enabled: false, status: 'PENDING',
          expiresAt: new Date(Date.now() + 10_000) };
      },
    },
    labDeviceEvent: { create: async () => ({}) },
  };
  const db = { $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) };
  const access = { require: async () => { permissionChecks++; throw new Error('role revoked'); } };
  const gie = { cachedState: () => null, refresh: async () => null };
  try {
    Object.assign(process.env, env, { EMPS_CHARGING_SANDBOX_ENABLED: 'true' });
    const service = new LabMaqueteService(db as never, access as never, gie as never);
    const result = await service.stopCompletedSandboxSession(sessionId);
    assert.equal(result.command.status, 'PENDING');
    assert.equal(authorization, false);
    assert.equal(invalidatedStarts, 1);
    assert.equal(stopCommands, 1);
    assert.equal(permissionChecks, 0);
  } finally {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('late START ACK and heartbeat cannot keep a finished sandbox charge authorized', async () => {
  const keys = [...Object.keys(env), 'EMPS_CHARGING_SANDBOX_ENABLED'];
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  const sessionId = 'a381f68c-865a-4356-83f5-f16eb9d1258e';
  const commandId = 'c8eb75ee-04f0-4574-9114-4aa6f9eb7547';
  let authorized = true;
  let safetyStops = 0;
  const now = new Date();
  const tx = {
    $queryRaw: async () => [],
    labDevice: {
      findUnique: async () => ({ id: 'maquete-01', stationId: 46, bootId: 'sim_same',
        lastHeartbeatAt: now, ev1: true, ev2: false, authorizedEv1: true,
        authorizedEv2: false, lastCommandId: commandId }),
      update: async ({ data }: { data: { authorizedEv1: boolean } }) => {
        authorized = data.authorizedEv1;
        return { authorizedEv1: authorized, ev1: true, authorizedEv2: false, ev2: false };
      },
    },
    labChargeSession: {
      findUnique: async () => ({ id: sessionId, stationId: 46, chargerId: 76,
        evse: 'EV1', status: 'FINISHED', autoStopAt: new Date(now.getTime() - 1_000) }),
      findMany: async () => [],
    },
    labDeviceCommand: {
      findFirst: async ({ where }: { where: { id?: string } }) => where.id === commandId
        ? { id: commandId, deviceId: 'maquete-01', stationId: 46, requestId: sessionId,
          evse: 'EV1', enabled: true, status: 'DELIVERED', bootId: 'sim_same',
          expiresAt: new Date(now.getTime() + 30_000) } : null,
      findMany: async () => [],
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: { enabled: boolean } }) => {
        assert.equal(data.enabled, false);
        safetyStops++;
        return { id: 'stop-id', evse: 'EV1', enabled: false, status: 'PENDING',
          expiresAt: new Date(now.getTime() + 30_000) };
      },
    },
    labDeviceEvent: { create: async () => ({}) },
  };
  const db = { $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    station: { findUnique: async () => ({ name: 'Posto 24h' }) } };
  const gie = { cachedState: () => null, refresh: async () => null };
  try {
    Object.assign(process.env, env, { EMPS_CHARGING_SANDBOX_ENABLED: 'true' });
    const service = new LabMaqueteService(db as never, {} as never, gie as never);
    const config = labConfig();
    assert.ok(config);
    const ack = await service.ack(config, { commandId, accepted: true, ev1: true, ev2: false });
    assert.equal(ack.status, 'FAILED');
    assert.equal(authorized, false);
    authorized = true;
    const heartbeat = await service.heartbeat(config, { bootId: 'sim_same', ev1: true, ev2: false });
    assert.match(heartbeat, /ev1Authorized=0/);
    assert.equal(authorized, false);
    assert.equal(safetyStops, 2);
  } finally {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
