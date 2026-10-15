import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// Creates only the local commercial presentation fixture. Existing Shopping
// records are inspected and returned without updating their operational state.
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (process.env.NODE_ENV === 'production' ||
      process.env.EMPS_REMOTE_DEVELOPMENT !== 'false' ||
      url.protocol !== 'mysql:' ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.port !== '3307' ||
      url.username.toLowerCase() === 'root' ||
      database !== 'emps_demo_test' ||
      process.env.DEMO_HISTORY_TEST_DATABASE !== database) {
    throw new Error('Bootstrap visual permitido somente no MySQL local descartável em 127.0.0.1:3307/emps_demo_test');
  }
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('ADMIN_EMAIL local obrigatório');
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUnique({ where: { email } });
    if (!admin || admin.role !== 'ADMIN' || admin.accountStatus !== 'ACTIVE') {
      throw new Error('Administrador local ativo não encontrado');
    }
    const pinned = process.env.DEMO_VISUAL_COMMERCIAL_STATION_ID;
    if (pinned && !/^\d+$/.test(pinned)) throw new Error('ID da Shopping local inválido');
    const shopping = pinned
      ? await db.station.findUnique({ where: { id: Number(pinned) }, include: { gieBinding: true } })
      : (await db.station.findMany({
          where: { adminId: admin.id, name: 'Shopping Frei Caneca' },
          include: { gieBinding: true },
          take: 2,
        }))[0];
    if (pinned && !shopping) {
      throw new Error('Shopping local indicada não encontrada');
    }
    if (shopping) {
      if (shopping.adminId !== admin.id || shopping.gieBinding ||
          shopping.status !== 'ACTIVE' || shopping.visibility !== 'PUBLIC' ||
          shopping.reviewState !== 'APPROVED') {
        throw new Error('Shopping existente não corresponde ao vínculo comercial legado esperado');
      }
      if (!pinned && await db.station.count({ where: { adminId: admin.id, name: 'Shopping Frei Caneca' } }) !== 1) {
        throw new Error('Mais de uma Shopping Frei Caneca encontrada; informe ID explícito');
      }
      console.log(JSON.stringify({ ownerId: admin.id, shoppingId: shopping.id, created: false }));
      return;
    }
    const created = await db.station.create({
      data: {
        adminId: admin.id,
        name: 'Shopping Frei Caneca',
        description: 'Instalação comercial local para apresentação integrada do GIE e do histórico demonstrativo.',
        venueType: 'shopping',
        postalCode: '01307001',
        street: 'Rua Frei Caneca',
        addressNumber: '569',
        neighborhood: 'Consolação',
        city: 'São Paulo',
        state: 'SP',
        timezone: 'America/Sao_Paulo',
        status: 'ACTIVE',
        reviewState: 'APPROVED',
        visibility: 'PUBLIC',
        guestAllowed: false,
        staff: { create: { userId: admin.id, staffRole: 'OWNER' } },
        chargers: { create: ['AC_01', 'AC_02', 'AC_03', 'AC_04'].map((name) => ({
          publicCode: `LOCAL-SHOPPING-${name}`,
          ocppIdentity: `LOCAL_ONLY_SHOPPING_${name}`,
          name: `${name} · referência local`,
          connectorType: 'TYPE2',
          powerType: 'AC',
          powerKw: 22,
          configuredPowerLimitKw: 22,
          administrativeStatus: 'PENDING',
          liveStatus: { create: { operationalStatus: 'UNKNOWN' } },
        })) },
      },
    });
    console.log(JSON.stringify({ ownerId: admin.id, shoppingId: created.id, created: true }));
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Bootstrap visual falhou');
  process.exitCode = 1;
});
