import 'dotenv/config';
import { PrismaService } from '../src/prisma.service';
import { localLegacyIntegrationDatabase } from '../src/local-legacy-integration';
import * as bcrypt from 'bcrypt';

const SHOPPING_ID = 39;
const OWNER_ID = 105;
const DEMO_GIE_IDS = ['DEMO_POSTO_24H_001', 'DEMO_CASA_001'];

async function main() {
  let url: URL;
  try { url = new URL(process.env.DATABASE_URL ?? ''); }
  catch { throw new Error('DATABASE_URL da cópia local inválida'); }
  const email = process.env.EMPS_INTEGRATION_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.EMPS_INTEGRATION_ADMIN_PASSWORD;
  if (!localLegacyIntegrationDatabase(url) ||
      process.env.GIE_COMMERCIAL_STATION_ID !== String(SHOPPING_ID) ||
      process.env.EMPS_LEGACY_LOCAL_OWNER_ID !== String(OWNER_ID) ||
      !email || !/^[a-z0-9._%+-]+@emps\.invalid$/.test(email) ||
      !password || Buffer.byteLength(password, 'utf8') < 16 || Buffer.byteLength(password, 'utf8') > 72)
    throw new Error('Conta de revisão exige cópia local auditada e credenciais .invalid de 16 a 72 bytes');

  const db = new PrismaService();
  await db.$connect();
  try {
    const [identity] = await db.$queryRaw<Array<{ databaseName: string; version: string }>>`
      SELECT DATABASE() AS databaseName, VERSION() AS version`;
    if (identity?.databaseName !== 'emps_integration_test' || !String(identity.version).startsWith('8.'))
      throw new Error('Identidade MySQL da cópia local não confere');

    const result = await db.$transaction(async tx => {
      const [stations, bindings, legacyUsers] = await Promise.all([
        tx.station.findMany({ select: { id: true, name: true, adminId: true,
          status: true, reviewState: true, visibility: true } }),
        tx.gieStationBinding.findMany({ where: { gieStationId: { in: DEMO_GIE_IDS } },
          select: { stationId: true, gieStationId: true, origin: true } }),
        tx.user.count({ where: { email: { not: email } } }),
      ]);
      if (legacyUsers !== 10 || bindings.length !== 2 ||
          new Set(bindings.map(binding => binding.gieStationId)).size !== 2)
        throw new Error('As dez contas antigas e as duas instalações GIE esperadas não foram confirmadas');
      const demoIds = new Set(bindings.map(binding => binding.stationId));
      const legacyStations = stations.filter(station => !demoIds.has(station.id));
      const shopping = legacyStations.find(station => station.id === SHOPPING_ID);
      const [legacyChargers, demoChargers] = await Promise.all([
        tx.charger.count({ where: { stationId: { in: legacyStations.map(station => station.id) } } }),
        tx.charger.count({ where: { stationId: { in: [...demoIds] } } }),
      ]);
      if (stations.length !== 10 || legacyStations.length !== 8 ||
          legacyChargers !== 13 || demoChargers !== 3 ||
          !shopping || shopping.adminId !== OWNER_ID ||
          !/shopping\s+frei\s+caneca/i.test(shopping.name) ||
          bindings.some(binding => binding.origin !== 'SIMULATED') ||
          stations.filter(station => demoIds.has(station.id)).some(station =>
            station.adminId !== OWNER_ID || station.status !== 'PENDING' ||
            station.reviewState !== 'DRAFT' || station.visibility !== 'PRIVATE'))
        throw new Error('O inventário da cópia local difere da auditoria; nenhuma conta foi criada');

      const existing = await tx.user.findUnique({ where: { email } });
      if (existing && (existing.role !== 'ADMIN' || existing.accountStatus !== 'ACTIVE' ||
          existing.presentationTools !== true || existing.platformReviewer !== false ||
          !await bcrypt.compare(password, existing.passwordHash)))
        throw new Error('Conta de revisão existente difere do perfil esperado; preservada sem alterações');
      const user = existing ?? await tx.user.create({ data: {
        email, name: 'Revisão local EMPS', passwordHash: await bcrypt.hash(password, 12),
        role: 'ADMIN', accountStatus: 'ACTIVE', presentationTools: true,
        platformReviewer: false,
      } });

      const reviewStationIds = new Set([SHOPPING_ID, ...demoIds]);
      let createdMemberships = 0;
      for (const station of stations) {
        const desired = reviewStationIds.has(station.id) ? 'OWNER' : 'VIEWER';
        const where = { stationId_userId: { stationId: station.id, userId: user.id } };
        const membership = await tx.stationStaff.findUnique({ where });
        if (membership && membership.staffRole !== desired) {
          // Promote only this clone-only review account's initial MANAGER grant.
          if (desired !== 'OWNER' || membership.staffRole !== 'MANAGER')
            throw new Error(`Permissão da conta de revisão divergente na estação ${station.id}`);
          await tx.stationStaff.update({ where, data: { staffRole: 'OWNER' } });
        }
        if (!membership) {
          await tx.stationStaff.create({ data: { stationId: station.id, userId: user.id, staffRole: desired } });
          createdMemberships++;
        }
      }
      return { id: user.id, email, created: !existing, legacyStations: legacyStations.length,
        demoStations: demoIds.size, createdMemberships, viewOnlyStations: 7, managedStations: 3 };
    }, { timeout: 30_000 });
    console.log(JSON.stringify(result));
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Conta de revisão local falhou');
  process.exitCode = 1;
});
