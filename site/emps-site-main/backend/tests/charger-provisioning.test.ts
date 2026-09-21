import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { ChargerProvisioningService } from "../src/charger-provisioning.service";
import { PrismaService } from "../src/prisma.service";
import { RealtimeService } from "../src/realtime.service";
import { hashOpaqueToken } from "../src/mobile.utils";
const activationCode = "EMPS-AB12-CD34";
function fixture(status = "PENDING_CONNECTION") {
  const updates: any[] = [],
    chargerUpdates: any[] = [],
    events: any[] = [];
  const record: any = {
    id: 1n,
    chargerId: 2,
    status: status === "PENDING_APPROVAL" ? "ACCEPTED" : "PENDING",
    createdAt: new Date(),
    updatedAt: new Date(),
    requestPayload: {
      kind: "provisioning-v1",
      status,
      activationExpiresAt: new Date(Date.now() + 60000).toISOString(),
      connectionVerifiedAt: new Date().toISOString(),
      pricePerKwh: 1.89,
    },
    charger: {
      id: 2,
      stationId: 3,
      publicCode: "CH-TEST",
      serialNumber: "SERIAL-A02",
      ocppIdentity: "OCPP-A02",
      administrativeStatus: status === "ENABLED" ? "ENABLED" : "PENDING",
      tariffs: [],
      qrBindings: [],
      station: { id: 3, status: "ACTIVE", tariffs: [] },
    },
  };
  const repo = {
    chargingCommand: {
      findUnique: async (args: any) => {
        assert.equal(args.where.correlationId, hashOpaqueToken(activationCode));
        return record;
      },
      findFirst: async () => record,
      updateMany: async (args: any) => {
        updates.push(args);
        Object.assign(record, args.data);
        return { count: 1 };
      },
    },
    charger: {
      update: async (args: any) => {
        chargerUpdates.push(args);
        return record.charger;
      },
    },
    $transaction: async (callback: any) => callback(repo),
  };
  const realtime = {
    publish: (event: any) => events.push(event),
    publishToOperations: (event: any) => events.push(event),
  };
  return {
    record,
    updates,
    chargerUpdates,
    events,
    service: new ChargerProvisioningService(
      repo as unknown as PrismaService,
      realtime as unknown as RealtimeService,
    ),
  };
}
const claim = {
  activationCode,
  serialNumber: "serial-a02",
  ocppIdentity: "ocpp-a02",
  firmwareVersion: "1.0.0",
};
const admin = { email: "admin@emps.test", role: "ADMIN" as const, sub: "1" };
test("validação confere token, serial e identidade OCPP antes de avançar", async () => {
  const f = fixture();
  const result = await f.service.claim(claim);
  assert.equal(result.status, "PENDING_APPROVAL");
  assert.equal(f.updates.length, 1);
  assert.equal(f.chargerUpdates[0].data.firmwareVersion, "1.0.0");
  assert.equal(f.events.length, 1);
});
test("validação rejeita equipamento diferente mesmo com código correto", async () => {
  const f = fixture();
  await assert.rejects(
    f.service.claim({ ...claim, ocppIdentity: "FALSO" }),
    BadRequestException,
  );
  assert.equal(f.updates.length, 0);
});
test("repetir a validação concluída retorna sucesso sem alterar o banco", async () => {
  const f = fixture("PENDING_APPROVAL");
  const result = await f.service.claim(claim);
  assert.equal(result.verifiedAt, f.record.requestPayload.connectionVerifiedAt);
  assert.equal(f.updates.length, 0);
  assert.equal(f.events.length, 0);
});
test("homologação habilita carregador existente e cria tarifa e QR atomicamente", async () => {
  const f = fixture("PENDING_APPROVAL");
  await f.service.approve(admin, "1");
  assert.equal(f.updates[0].where.status, "ACCEPTED");
  assert.equal(f.chargerUpdates[0].where.id, 2);
  assert.equal(f.chargerUpdates[0].data.administrativeStatus, "ENABLED");
  assert.equal(f.chargerUpdates[0].data.tariffs.create.basePricePerKwh, 1.89);
  assert.ok(f.chargerUpdates[0].data.qrBindings.create.publicToken);
  assert.equal(f.events.length, 3);
});
test("dono arquiva solicitação cancelada preservando histórico físico", async () => {
  const f = fixture("CANCELED");
  assert.deepEqual(await f.service.remove(admin, "1"), {
    deleted: true,
    id: "1",
  });
  assert.equal(f.updates[0].data.requestPayload.removed, true);
});
test("não remove cadastro que já liberou carregador", async () => {
  const f = fixture("ENABLED");
  await assert.rejects(f.service.remove(admin, "1"), ConflictException);
  assert.equal(f.updates.length, 0);
});
