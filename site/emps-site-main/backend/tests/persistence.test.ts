import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  apiJson,
  bigId,
  intId,
  chargerStatus,
  currentTariff,
  mobileSessionStatus,
  type ChargerRecord,
} from "../src/persistence";
test("IDs inteiros são validados sem arredondar BIGINT", () => {
  assert.equal(bigId("18446744073709551615"), 18446744073709551615n);
  for (const value of ["0", "-1", "1.5", "1e3", "abc", "18446744073709551616"])
    assert.throws(() => bigId(value));
  assert.equal(intId("4294967295"), 4294967295);
  assert.throws(() => intId("4294967296"));
});
test("JSON mantém IDs como strings e oculta hashes de autenticação", () => {
  assert.deepEqual(
    apiJson({
      id: 9007199254740993n,
      chargerId: 22,
      chargerIds: [22, 23],
      amount: new Prisma.Decimal("1.89"),
      passwordHash: "secret",
      tokenHash: "secret",
      durationSeconds: 60,
    }),
    {
      id: "9007199254740993",
      chargerId: "22",
      chargerIds: ["22", "23"],
      amount: "1.89",
      durationSeconds: 60,
    },
  );
});
test("estado público combina status administrativo e telemetria", () => {
  assert.equal(
    chargerStatus({
      administrativeStatus: "DISABLED",
      liveStatus: { operationalStatus: "AVAILABLE" },
    }),
    "OFFLINE",
  );
  assert.equal(
    chargerStatus({
      administrativeStatus: "ENABLED",
      liveStatus: { operationalStatus: "CHARGING" },
    }),
    "IN_USE",
  );
});
test("tarifa vigente do carregador precede tarifa da estação e ignora tarifa futura", () => {
  const now = new Date();
  const t = (id: number, chargerId: number | null, delta = 0) => ({
    id,
    chargerId,
    validFrom: new Date(now.getTime() + delta),
    validUntil: null,
    status: "ACTIVE",
  });
  const c = {
    tariffs: [t(2, 1, -1000), t(3, 1, 60000)],
    station: { tariffs: [t(1, null, -1000)] },
  } as unknown as ChargerRecord;
  assert.equal(currentTariff(c, now).id, 2);
  c.tariffs = [];
  assert.equal(currentTariff(c, now).id, 1);
  c.station.tariffs = [];
  assert.throws(() => currentTariff(c, now));
});

test("estados oficiais preservam o contrato de sessão do App", () => {
  assert.equal(mobileSessionStatus("START_REQUESTED"), "starting");
  assert.equal(mobileSessionStatus("STOP_REQUESTED"), "stopping");
  assert.equal(mobileSessionStatus("PAYMENT_CAPTURING"), "payment_pending");
  assert.equal(mobileSessionStatus("START_FAILED"), "completed");
  assert.equal(mobileSessionStatus("ACTIVE"), "charging");
});
