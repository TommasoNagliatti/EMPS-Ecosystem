import 'dotenv/config';
import { GieDemoInstallationsService } from '../src/gie-demo-installations.service';
import { GieV3Service } from '../src/gie-v3.service';
import { localLegacyIntegrationDatabase } from '../src/local-legacy-integration';
import { PlatformAccessService } from '../src/platform-access.service';
import { PrismaService } from '../src/prisma.service';
import { RealtimeService } from '../src/realtime.service';

const OWNER_ID = 105;
const SHOPPING_ID = 39;

async function main() {
  let url: URL;
  try { url = new URL(process.env.DATABASE_URL ?? ''); }
  catch { throw new Error('DATABASE_URL da cópia local inválida'); }
  if (!localLegacyIntegrationDatabase(url) ||
      process.env.GIE_COMMERCIAL_STATION_ID !== String(SHOPPING_ID) ||
      process.env.EMPS_LEGACY_LOCAL_OWNER_ID !== String(OWNER_ID))
    throw new Error('Cadastro restrito à cópia local auditada, Shopping 39 e proprietário 105');

  const db = new PrismaService();
  await db.$connect();
  try {
    const [identity] = await db.$queryRaw<Array<{ databaseName: string; version: string }>>`
      SELECT DATABASE() AS databaseName, VERSION() AS version`;
    if (identity?.databaseName !== 'emps_integration_test' || !String(identity.version).startsWith('8.'))
      throw new Error('Identidade MySQL da cópia local não confere');
    const [owner, shopping] = await Promise.all([
      db.user.findUnique({ where: { id: OWNER_ID },
        select: { id: true, email: true, role: true, accountStatus: true } }),
      db.station.findUnique({ where: { id: SHOPPING_ID },
        select: { id: true, adminId: true, name: true } }),
    ]);
    if (!owner || owner.accountStatus !== 'ACTIVE' ||
        !shopping || shopping.adminId !== OWNER_ID ||
        !/shopping\s+frei\s+caneca/i.test(shopping.name))
      throw new Error('Propriedade da Shopping existente não confere com a auditoria');

    const access = new PlatformAccessService(db);
    const gie = new GieV3Service(db, access, new RealtimeService(db));
    const result = await new GieDemoInstallationsService(db, access, gie).ensure(
      { sub: String(owner.id), email: owner.email, role: owner.role }, String(shopping.id));
    console.log(JSON.stringify(result));
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Cadastro local falhou');
  process.exitCode = 1;
});
