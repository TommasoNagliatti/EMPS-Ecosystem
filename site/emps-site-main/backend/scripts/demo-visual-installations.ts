import 'dotenv/config';
import { GieDemoInstallationsService } from '../src/gie-demo-installations.service';
import { GieV3Service } from '../src/gie-v3.service';
import { PlatformAccessService } from '../src/platform-access.service';
import { PrismaService } from '../src/prisma.service';
import { RealtimeService } from '../src/realtime.service';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (process.env.NODE_ENV === 'production' ||
      process.env.EMPS_REMOTE_DEVELOPMENT !== 'false' ||
      url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' || url.port !== '3307' ||
      !url.username || url.username.toLowerCase() === 'root' ||
      decodeURIComponent(url.pathname.slice(1)) !== 'emps_demo_test' ||
      process.env.DEMO_HISTORY_TEST_DATABASE !== 'emps_demo_test') {
    throw new Error('Cadastro visual permitido somente em MySQL local descartável');
  }
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const shoppingId = process.env.GIE_COMMERCIAL_STATION_ID;
  if (!email || !shoppingId || !/^\d+$/.test(shoppingId)) {
    throw new Error('Administrador e Shopping locais obrigatórios');
  }
  const db = new PrismaService();
  await db.$connect();
  try {
    const admin = await db.user.findUnique({ where: { email },
      select: { id: true, email: true, role: true, accountStatus: true } });
    if (!admin || admin.role !== 'ADMIN' || admin.accountStatus !== 'ACTIVE') {
      throw new Error('Administrador local ativo não encontrado');
    }
    const access = new PlatformAccessService(db);
    const gie = new GieV3Service(db, access, new RealtimeService(db));
    const result = await new GieDemoInstallationsService(db, access, gie).ensure(
      { sub: String(admin.id), email: admin.email, role: admin.role }, shoppingId);
    console.log(JSON.stringify(result));
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Cadastro visual falhou');
  process.exitCode = 1;
});
