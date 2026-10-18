import 'dotenv/config';
import {PrismaService} from '../src/prisma.service';
import {localLegacyIntegrationDatabase} from '../src/local-legacy-integration';

const BUILDING_ID = 13;
const SHOPPING_ID = 39;
const POSTO_ID = 46;
const CASA_ID = 47;
const LEGACY_ADMIN_ID = 64;
const OWNER_ID = 105;
const OLD_NAME = 'EMPS Demonstração Integrada';
const NEW_NAME = 'Prédio Comercial';

async function main() {
  const apply = process.argv.slice(2).includes('--apply');
  if (process.argv.slice(2).some(argument => argument !== '--apply'))
    throw new Error('Use sem argumentos para pré-verificação ou --apply para alterar somente a cópia local');
  let url: URL;
  try { url = new URL(process.env.DATABASE_URL ?? ''); }
  catch { throw new Error('DATABASE_URL da cópia local inválida'); }
  if (!localLegacyIntegrationDatabase(url) ||
      process.env.GIE_COMMERCIAL_STATION_ID !== String(SHOPPING_ID) ||
      process.env.EMPS_LEGACY_LOCAL_OWNER_ID !== String(OWNER_ID))
    throw new Error('Alterações permitidas apenas na cópia auditada em 127.0.0.1:3308');

  const db = new PrismaService();
  await db.$connect();
  try {
    const [identity] = await db.$queryRaw<Array<{databaseName: string; version: string}>>`
      SELECT DATABASE() AS databaseName, VERSION() AS version`;
    if (identity?.databaseName !== 'emps_integration_test' || !String(identity.version).startsWith('8.'))
      throw new Error('Identidade MySQL da cópia local não confere');

    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM stations WHERE id IN (${BUILDING_ID}, ${SHOPPING_ID}, ${POSTO_ID}, ${CASA_ID}) FOR UPDATE`;
      const stations = await tx.station.findMany({
        where: {id: {in: [BUILDING_ID, SHOPPING_ID, POSTO_ID, CASA_ID]}},
        select: {id: true, name: true, adminId: true, status: true, reviewState: true,
          visibility: true, gieProvisioning: true, _count: {select: {chargers: true}}},
      });
      const station = (id: number) => stations.find(row => row.id === id);
      const building = station(BUILDING_ID);
      const shopping = station(SHOPPING_ID);
      const admin = await tx.user.findUnique({where: {id: LEGACY_ADMIN_ID},
        select: {id: true, email: true, role: true, accountStatus: true, presentationTools: true}});
      const [operational] = await tx.$queryRaw<Array<{sessions: bigint; payments: bigint}>>`
        SELECT (SELECT COUNT(*) FROM charging_sessions) AS sessions,
               (SELECT COUNT(*) FROM payments) AS payments`;
      if (!admin || admin.email !== 'admin.dev@emps.local' || admin.role !== 'ADMIN' ||
          admin.accountStatus !== 'ACTIVE' || !admin.presentationTools ||
          !building || building.adminId !== LEGACY_ADMIN_ID ||
          ![OLD_NAME, NEW_NAME].includes(building.name) || building._count.chargers !== 3 ||
          !shopping || shopping.adminId !== OWNER_ID ||
          !/shopping\s+frei\s+caneca/i.test(shopping.name) ||
          Number(operational?.sessions) !== 65 || Number(operational?.payments) !== 61)
        throw new Error('Conta, Prédio, Shopping ou registros operacionais diferem do inventário auditado');

      for (const id of [POSTO_ID, CASA_ID]) {
        const demo = station(id);
        const provisioning = demo?.gieProvisioning as Record<string, unknown> | null;
        if (!demo || demo.adminId !== OWNER_ID || demo.status !== 'PENDING' ||
            demo.reviewState !== 'DRAFT' || demo.visibility !== 'PRIVATE' ||
            provisioning?.origin !== 'SIMULATED' || provisioning?.physical_dispatch !== false)
          throw new Error(`Instalação demonstrativa ${id} diverge do perfil protegido`);
      }

      let renamed = false;
      if (apply && building.name === OLD_NAME) {
        await tx.station.update({where: {id: BUILDING_ID}, data: {name: NEW_NAME}});
        renamed = true;
      }
      const memberships: Array<{stationId: number; role: string; created: boolean}> = [];
      for (const stationId of [POSTO_ID, CASA_ID]) {
        const where = {stationId_userId: {stationId, userId: LEGACY_ADMIN_ID}};
        const existing = await tx.stationStaff.findUnique({where});
        if (existing && existing.staffRole !== 'MANAGER')
          throw new Error(`Permissão existente incompatível em ${stationId}; nenhuma promoção automática`);
        if (apply && !existing)
          await tx.stationStaff.create({data: {stationId, userId: LEGACY_ADMIN_ID,
            staffRole: 'MANAGER'}});
        memberships.push({stationId, role: 'MANAGER', created: apply && !existing});
      }
      return {database: identity.databaseName, applied: apply, buildingId: BUILDING_ID,
        buildingName: apply ? NEW_NAME : building.name, renamed,
        buildingOwnerId: building.adminId, demoOwnerId: OWNER_ID,
        chargersPreserved: building._count.chargers, operationalSessions: Number(operational.sessions),
        operationalPayments: Number(operational.payments), adminId: admin.id,
        presentationToolsAlreadyEnabled: admin.presentationTools, memberships};
    }, {timeout: 30_000});
    console.log(JSON.stringify(result));
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Cadastro local do Prédio falhou');
  process.exitCode = 1;
});
