import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";

// Append-only development fixture. Never clears tables or changes existing users.
export async function createDevelopmentFixture(
  prisma: PrismaClient,
  password: string,
  label = `mysql-qa-${Date.now()}`,
) {
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.$transaction(
    async (tx) => {
      const admin = await tx.user.create({
        data: {
          name: `QA MySQL ${label}`,
          email: `${label}@emps.invalid`,
          passwordHash,
          role: "ADMIN",
        },
      });
      const operator = await tx.user.create({
        data: {
          name: `QA Operador ${label}`,
          email: `operator-${label}@emps.invalid`,
          passwordHash,
          role: "OPERATOR",
        },
      });
      const outsider = await tx.user.create({
        data: {
          name: `QA Sem acesso ${label}`,
          email: `other-${label}@emps.invalid`,
          passwordHash,
          role: "OPERATOR",
        },
      });
      const station = await tx.station.create({
        data: {
          adminId: admin.id,
          name: `QA MySQL ${label}`.slice(0, 50),
          postalCode: "01310100",
          street: "Avenida Paulista",
          addressNumber: "1000",
          neighborhood: "Bela Vista",
          city: "São Paulo",
          state: "SP",
          latitude: -23.5614,
          longitude: -46.6559,
          status: "ACTIVE",
          geocodingStatus: "SUCCESS",
          staff: { create: { userId: operator.id } },
          amenities: { create: { amenityName: "Wi-Fi" } },
          tariffs: {
            create: {
              name: "QA tarifa base",
              basePricePerKwh: 1.89,
              fixedFee: 0.5,
              validFrom: new Date(),
              status: "ACTIVE",
            },
          },
        },
      });
      const chargers = [];
      for (let i = 1; i <= 3; i++)
        chargers.push(
          await tx.charger.create({
            data: {
              stationId: station.id,
              publicCode: `QA-${randomUUID()}`.slice(0, 50),
              name: `QA Carregador ${i}`,
              location: `QA-${i}`,
              ocppIdentity: `QA-${randomUUID()}`,
              connectorType: "TYPE2",
              powerType: "AC",
              phaseCount: 3,
              powerKw: 22,
              configuredPowerLimitKw: 22,
              administrativeStatus: "ENABLED",
              liveStatus: {
                create: { operationalStatus: "AVAILABLE", meterTotalKwh: 0 },
              },
              qrBindings: {
                create: {
                  publicToken: randomUUID(),
                  code: `QA-${randomUUID().slice(0, 20)}`,
                },
              },
            },
            include: { qrBindings: true },
          }),
        );
      return { label, admin, operator, outsider, station, chargers };
    },
    { timeout: 15000 },
  );
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed.ts")) {
  if (process.env.SEED_ALLOW_QA !== 'true') throw new Error('Seed cria fixtures QA; use bootstrap:admin para contas normais. Para QA explícito defina SEED_ALLOW_QA=true.');
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12)
    throw new Error(
      "Defina SEED_PASSWORD com pelo menos 12 caracteres para criar dados QA",
    );
  if (process.env.NODE_ENV === "production")
    throw new Error("Seed disponível apenas em desenvolvimento");
  const prisma = new PrismaClient();
  createDevelopmentFixture(prisma, password)
    .then((f) =>
      console.log(
        JSON.stringify({
          label: f.label,
          adminEmail: f.admin.email,
          operatorEmail: f.operator.email,
          stationId: f.station.id,
          chargerIds: f.chargers.map((c) => c.id),
        }),
      ),
    )
    .finally(() => prisma.$disconnect());
}
