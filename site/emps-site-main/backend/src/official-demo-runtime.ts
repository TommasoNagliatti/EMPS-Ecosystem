import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { localLegacyIntegrationActive } from './local-legacy-integration';

export const OFFICIAL_DEMO_STATIONS = [13, 39, 46, 47] as const;
export const OFFICIAL_DATABASE_UUID = '2baa7d1d-c101-11f1-9255-0e27fb6e351d';
export const APPROVED_SCHEMA_SHA = '5b0b847858013d989dc2bf3c4c0d75b1b97c9797144471dae0fa3a02440a29bb';
export const APPROVED_DATA_SHA = '2f0b401e38e571d68cc8d0f748152e91de7b014ad13d9da57a680b3b25391d7b';
let verified: string | null = null;

// An environment flag alone never enables the official exception. Read-only
// database admission must finish before Nest starts providers or background jobs.
function configuration(env: NodeJS.ProcessEnv): string {
  return createHash('sha256').update(JSON.stringify([
    env.NODE_ENV, env.DATABASE_URL, env.EMPS_OFFICIAL_DEMO_RUNTIME,
    env.EMPS_OFFICIAL_SCHEMA_SHA256, env.EMPS_OFFICIAL_DATA_SHA256,
    env.EMPS_REMOTE_DEVELOPMENT, env.EMPS_LOCAL_LEGACY_INTEGRATION,
    env.EMPS_DEMO_REHEARSAL_UUID, env.HOST,
    env.EMPS_PHYSICAL_COMMANDS_ENABLED, env.EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED,
    env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET,
    env.EMPS_LAB_STRIPE_TEST_ENABLED, env.EMPS_LAB_STRIPE_SECRET_KEY,
    env.EMPS_MAQUETE_STATION_ID, env.EMPS_MAQUETE_DEVICE_ID,
    env.EMPS_OFFICIAL_USB_RELAY_SCOPE,
    env.OCPP_GATEWAY_URL, env.OCPP_GATEWAY_TOKEN,
  ])).digest('hex');
}

function target(env: NodeJS.ProcessEnv) {
  if (!['OFFICIAL', 'REHEARSAL'].includes(env.EMPS_OFFICIAL_DEMO_RUNTIME ?? ''))
    throw new Error('Explicit official demo runtime target required');
  const rehearsal = env.EMPS_OFFICIAL_DEMO_RUNTIME === 'REHEARSAL';
  let url: URL;
  try { url = new URL(env.DATABASE_URL ?? ''); }
  catch { throw new Error('Invalid private demo database configuration'); }
  const database = rehearsal ? 'emps_official_runtime_test' : 'emps_db';
  const uuid = rehearsal ? env.EMPS_DEMO_REHEARSAL_UUID : OFFICIAL_DATABASE_UUID;
  if (env.NODE_ENV !== 'production' || env.EMPS_REMOTE_DEVELOPMENT === 'true' ||
      env.EMPS_LOCAL_LEGACY_INTEGRATION === 'true' ||
      env.EMPS_OFFICIAL_SCHEMA_SHA256 !== APPROVED_SCHEMA_SHA ||
      env.EMPS_OFFICIAL_DATA_SHA256 !== APPROVED_DATA_SHA ||
      url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' ||
      url.port !== (rehearsal ? '3308' : '3306') || url.pathname !== '/' + database ||
      !url.password || !url.username || decodeURIComponent(url.username).toLowerCase() === 'root' ||
      env.EMPS_MAQUETE_STATION_ID !== '46' || env.EMPS_MAQUETE_DEVICE_ID !== 'maquete-01' ||
      env.OCPP_GATEWAY_URL || env.OCPP_GATEWAY_TOKEN ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(uuid ?? ''))
    throw new Error('Official demo configuration does not match the approved scope');
  if (rehearsal && (uuid === OFFICIAL_DATABASE_UUID || env.HOST !== '127.0.0.1' ||
      env.EMPS_PHYSICAL_COMMANDS_ENABLED !== 'false' ||
      env.EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED !== 'false' ||
      env.STRIPE_SECRET_KEY || env.STRIPE_WEBHOOK_SECRET || env.EMPS_LAB_STRIPE_SECRET_KEY ||
      env.EMPS_LAB_STRIPE_TEST_ENABLED === 'true'))
    throw new Error('Rehearsal must be isolated, loopback-only and without external side effects');
  return { database, uuid };
}

export type DemoRuntimeDatabase = Pick<PrismaClient, '$transaction'>;

export async function initializeOfficialDemoRuntime(db: DemoRuntimeDatabase, env: NodeJS.ProcessEnv = process.env) {
  verified = null;
  if (!env.EMPS_OFFICIAL_DEMO_RUNTIME || env.EMPS_OFFICIAL_DEMO_RUNTIME === 'OFF') return;
  const expected = target(env), fingerprint = configuration(env);
  await db.$transaction(async tx => {
    const [identity] = await tx.$queryRaw<Array<{ databaseName: string; serverUuid: string; version: string }>>`
      SELECT DATABASE() AS databaseName, @@server_uuid AS serverUuid, VERSION() AS version`;
    if (identity?.databaseName !== expected.database || identity?.serverUuid !== expected.uuid || !identity?.version.startsWith('8.0.'))
      throw new Error('Official demo database identity mismatch');
    const stations = await tx.station.findMany({where:{id:{in:[...OFFICIAL_DEMO_STATIONS]}},
      select:{id:true,adminId:true,name:true,visibility:true,reviewState:true,guestAllowed:true}});
    const byId = new Map(stations.map(s => [s.id,s]));
    if (stations.length !== 4 || byId.get(13)?.adminId !== 64 || byId.get(13)?.name !== 'Prédio Comercial' ||
        byId.get(13)?.visibility !== 'PUBLIC' ||
        byId.get(39)?.adminId !== 105 || byId.get(39)?.name !== 'Shopping Frei Caneca' ||
        [46,47].some(id => {const s=byId.get(id);return !s || s.adminId!==105 || s.visibility!=='PRIVATE' || s.reviewState!=='DRAFT' || s.guestAllowed;}))
      throw new Error('Approved demo station ownership/protection mismatch');
    const profiles = new Map([[13,['Commercial_HighAutonomy_V2','COMMERCIAL']],
      [46,['DEMO_POSTO_24H_001','POSTO']],[47,['DEMO_CASA_001','CASA']]]);
    const bindings = await tx.gieStationBinding.findMany({where:{stationId:{in:[...OFFICIAL_DEMO_STATIONS]}}});
    if (bindings.length !== 3 || bindings.some(b => b.origin!=='SIMULATED' ||
        profiles.get(b.stationId)?.[0]!==b.gieStationId || profiles.get(b.stationId)?.[1]!==b.profile))
      throw new Error('Approved GIE bindings mismatch; Shopping must retain its legacy GIE');
    const chargers = await tx.charger.findMany({where:{id:{in:[49,50,51,76,77,78]}},
      select:{id:true,stationId:true,publicCode:true,ocppIdentity:true,administrativeStatus:true}});
    const ids = new Map(chargers.map(c => [c.id,c]));
    if (chargers.length !== 6 || ids.get(51)?.publicCode!=='CH-f2f059af5117b95fb970' ||
        ids.get(49)?.publicCode!=='CH-26f5af4e137bbe735ed5' || [49,50,51].some(id=>ids.get(id)?.stationId!==13) ||
        [[76,46,'SIMULATED_DEMO_POSTO_24H_001_EVSE_01'],[77,46,'SIMULATED_DEMO_POSTO_24H_001_EVSE_02'],
          [78,47,'SIMULATED_DEMO_CASA_001_EVSE_01']].some(([id,stationId,identity])=>{
            const c=ids.get(Number(id));return !c || c.stationId!==stationId || c.ocppIdentity!==identity || c.administrativeStatus!=='PENDING';}))
      throw new Error('Approved charger identities/protections mismatch');
    const device = await tx.labDevice.findUnique({where:{id:'maquete-01'},select:{stationId:true}});
    const staff = await tx.stationStaff.findMany({where:{userId:64,stationId:{in:[39,46,47]}},select:{stationId:true,staffRole:true}});
    if (device?.stationId!==46 || staff.length!==3 || staff.some(s=>s.staffRole!=='MANAGER'))
      throw new Error('Approved device or manager membership mismatch');
    const batches = await tx.demoImportBatch.findMany({where:{stationId:{in:[...OFFICIAL_DEMO_STATIONS]},status:'ACTIVE'},
      select:{stationId:true,origin:true,datasetSha256:true}});
    const sha = new Map([[13,'87de2c756128656571a63b48a38082226f4c005e1fe9525ea52b96b67b168b49'],
      [39,'87de2c756128656571a63b48a38082226f4c005e1fe9525ea52b96b67b168b49'],
      [46,'1f1a5e480ba83864ae7bfc5d58bd5bbe6e165306f0cafea6dd6f06e19280da6c'],
      [47,'df9e559f72002bbd2ba1179811eb8219d8027f1313c9b7922e03290ee2866e16']]);
    if (batches.length!==4 || new Set(batches.map(b=>b.stationId)).size!==4 ||
        batches.some(b=>b.origin!=='SIMULATED' || sha.get(b.stationId)!==b.datasetSha256))
      throw new Error('Approved demo dataset provenance mismatch');
  }, {isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30_000});
  if (configuration(env)!==fingerprint) throw new Error('Demo configuration changed during admission');
  verified = fingerprint;
}

export function officialDemoRuntimeActive(env: NodeJS.ProcessEnv = process.env) {
  return verified !== null && verified === configuration(env);
}
export function demoIntegrationActive(env: NodeJS.ProcessEnv = process.env) {
  return localLegacyIntegrationActive(env) || officialDemoRuntimeActive(env);
}
export function demoManagerAccess(stationId: string | number, env: NodeJS.ProcessEnv = process.env) {
  return localLegacyIntegrationActive(env) || (officialDemoRuntimeActive(env) &&
    (OFFICIAL_DEMO_STATIONS as readonly number[]).includes(Number(stationId)));
}
export function demoStaffNetworkScope(userId: number, env: NodeJS.ProcessEnv = process.env): Prisma.StationWhereInput {
  const member = {staff:{some:{userId,staffRole:{in:['OWNER','MANAGER'] as ('OWNER'|'MANAGER')[]}}}};
  return localLegacyIntegrationActive(env) ? {OR:[{adminId:userId},member]} :
    officialDemoRuntimeActive(env) ? {OR:[{adminId:userId},{id:{in:[...OFFICIAL_DEMO_STATIONS]},...member}]} : {adminId:userId};
}
export function demoCardDatabaseScope(env: NodeJS.ProcessEnv = process.env) {
  return officialDemoRuntimeActive(env) && env.EMPS_OFFICIAL_DEMO_RUNTIME==='OFFICIAL' ? 'emps_db' : 'emps_integration_test';
}
