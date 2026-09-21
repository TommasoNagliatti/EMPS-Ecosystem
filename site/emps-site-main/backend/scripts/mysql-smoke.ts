import { cleanupQa } from './qa-cleanup';
import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { createDevelopmentFixture } from "../prisma/seed";
import { MobileService } from "../src/mobile.service";
import { PrismaService } from "../src/prisma.service";
import { JwtService } from "@nestjs/jwt";
import { PaymentGatewayService } from "../src/payment-gateway.service";
import { ChargingGatewayService } from "../src/charging-gateway.service";
import { RealtimeService } from "../src/realtime.service";

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Smoke test é exclusivo de desenvolvimento");
  const db = new PrismaClient();
  const password = `QA-${randomUUID()}`;
  const port = Number(process.env.SMOKE_PORT ?? 3107);
  const base = `http://127.0.0.1:${port}`;
  const tested: Array<{ method: string; path: string; status: number }> = [];
  mkdirSync("reports", { recursive: true });
  const schema = () =>
    db.$queryRaw`SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION`;
  const before = await schema();
  const database =
    await db.$queryRaw`SELECT DATABASE() AS db, VERSION() AS version, @@hostname AS hostname`;
  const tables = await db.$queryRaw<
    Array<{ name: string }>
  >`SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME`;
  assert.equal(tables.length, 20);
  if (process.env.SMOKE_ALLOW_QA !== 'true') throw new Error('Defina SMOKE_ALLOW_QA=true; a fixture será removida ao terminar, salvo SMOKE_KEEP_QA=true');
  const f = await createDevelopmentFixture(db, password);
  const log = createWriteStream("reports/mysql-smoke-server.log");
  const server = spawn(process.execPath, ["dist/main.js"], {
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      PAYMENT_PROVIDER: "sandbox",
      OCPP_GATEWAY_URL: "",
      JWT_SECRET: randomUUID() + randomUUID(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    token?: string,
    key?: string,
    cookie?: string,
    expected = 200,
  ) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    tested.push({ method, path, status: response.status });
    assert.equal(response.status, expected, `${method} ${path}: ${text}`);
    return { data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (server.exitCode !== null)
        throw new Error("Servidor encerrou antes de iniciar");
      try {
        if ((await fetch(base + "/auth/health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(ready, "Servidor não iniciou");
    assert.equal((await request("GET", "/auth/health")).data.database, "mysql");
    await request(
      "GET",
      "/chargers",
      undefined,
      undefined,
      undefined,
      undefined,
      401,
    );
    await request(
      "POST",
      "/auth/login",
      { email: f.admin.email, password: "errada" },
      undefined,
      undefined,
      undefined,
      401,
    );
    const web = await request("POST", "/auth/login", {
      email: f.admin.email,
      password,
    });
    let admin = web.data.accessToken;
    assert.equal(web.data.user.id, String(f.admin.id));
    const refreshed = await request(
      "POST",
      "/auth/refresh",
      {},
      undefined,
      undefined,
      web.cookie,
    );
    assert.notEqual(refreshed.cookie, web.cookie);
    admin = refreshed.data.accessToken;
    await request("GET", "/auth/me", undefined, admin);
    await request("GET", "/users/me", undefined, admin);
    const op = (
      await request("POST", "/auth/login", {
        email: f.operator.email,
        password,
      })
    ).data.accessToken;
    const other = (
      await request("POST", "/auth/login", {
        email: f.outsider.email,
        password,
      })
    ).data.accessToken;
    assert.equal(
      (await request("GET", "/chargers", undefined, op)).data.length,
      3,
    );
    assert.equal(
      (await request("GET", "/chargers", undefined, other)).data.length,
      0,
    );
    await request(
      "GET",
      `/chargers/${f.chargers[0].id}`,
      undefined,
      other,
      undefined,
      undefined,
      404,
    );
    await request("GET", "/charger-provisionings/stations", undefined, admin);
    await request("GET", "/charger-provisionings", undefined, admin);
    const registration = {
      name: "QA Motorista",
      email: `driver-${f.label}@emps.invalid`,
      password,
    };
    const registered = (
      await request(
        "POST",
        "/mobile/v1/auth/register",
        registration,
        undefined,
        undefined,
        undefined,
        201,
      )
    ).data;
    assert.equal(typeof registered.user.id, "string");
    const login = (
      await request(
        "POST",
        "/mobile/v1/auth/login",
        { email: registration.email, password },
        undefined,
        undefined,
        undefined,
        201,
      )
    ).data;
    const rotated = (
      await request(
        "POST",
        "/mobile/v1/auth/refresh",
        { refreshToken: login.refreshToken },
        undefined,
        undefined,
        undefined,
        201,
      )
    ).data;
    const driver = rotated.accessToken;
    await request("GET", "/mobile/v1/auth/me", undefined, driver);
    const stations = (
      await request(
        "GET",
        "/mobile/v1/stations/nearby?lat=-23.5614&lng=-46.6559&radiusKm=10",
        undefined,
        driver,
      )
    ).data;
    assert.ok(stations.some((s: any) => s.id === String(f.station.id)));
    await request(
      "GET",
      `/mobile/v1/stations/${f.station.id}`,
      undefined,
      driver,
    );
    const charger = (
      await request(
        "GET",
        `/mobile/v1/chargers/${f.chargers[0].id}`,
        undefined,
        driver,
      )
    ).data;
    assert.equal(charger.pricePerKwh, 1.89);
    const qr = (
      await request(
        "GET",
        `/mobile/v1/qr/${f.chargers[0].qrBindings[0].publicToken}`,
        undefined,
        driver,
      )
    ).data;
    const intentBody = {
      chargerId: String(f.chargers[0].id),
      method: "pix",
      spendingLimit: 20,
    };
    const intent = (
      await request(
        "POST",
        "/mobile/v1/payment-intents",
        intentBody,
        driver,
        "qa-intent-001",
        undefined,
        201,
      )
    ).data;
    const again = (
      await request(
        "POST",
        "/mobile/v1/payment-intents",
        intentBody,
        driver,
        "qa-intent-001",
        undefined,
        201,
      )
    ).data;
    assert.equal(intent.id, again.id);
    await request(
      "POST",
      "/mobile/v1/payment-intents",
      { ...intentBody, spendingLimit: 25 },
      driver,
      "qa-intent-001",
      undefined,
      409,
    );
    await request(
      "GET",
      `/mobile/v1/payment-intents/${intent.id}`,
      undefined,
      driver,
    );
    const start = {
      qrBindingId: qr.qrBindingId,
      paymentIntentId: intent.id,
      spendingLimit: 20,
      idempotencyKey: "qa-start-001",
    };
    const session = (
      await request(
        "POST",
        "/mobile/v1/charging-sessions/start",
        start,
        driver,
        "qa-start-001",
        undefined,
        201,
      )
    ).data;
    assert.equal(session.status, "charging");
    assert.equal(
      (
        await request(
          "POST",
          "/mobile/v1/charging-sessions/start",
          start,
          driver,
          "qa-start-001",
          undefined,
          201,
        )
      ).data.id,
      session.id,
    );
    await request(
      "GET",
      "/mobile/v1/charging-sessions/active",
      undefined,
      driver,
    );
    await request(
      "GET",
      `/mobile/v1/charging-sessions/${session.id}`,
      undefined,
      driver,
    );
    const stopped = (
      await request(
        "POST",
        `/mobile/v1/charging-sessions/${session.id}/stop`,
        {},
        driver,
        "qa-stop-001",
        undefined,
        201,
      )
    ).data;
    assert.equal(stopped.status, "completed");
    assert.ok(stopped.totalCost >= 0.5);
    assert.equal(
      (
        await request(
          "POST",
          `/mobile/v1/charging-sessions/${session.id}/stop`,
          {},
          driver,
          "qa-stop-001",
          undefined,
          201,
        )
      ).data.id,
      session.id,
    );
    await request("GET", "/mobile/v1/charging-sessions", undefined, driver);
    const persisted = await db.chargingSession.findUniqueOrThrow({
      where: { id: BigInt(session.id) },
      include: { payments: true, commands: true },
    });
    assert.equal(persisted.status, "FINISHED");
    assert.equal(persisted.payments.length, 1);
    assert.equal(persisted.payments[0].status, "APPROVED");
    assert.equal(persisted.commands.length, 2);
    const native = await db.$queryRaw<
      Array<{ status: string; method: string; provider: string }>
    >`SELECT status,payment_method AS method,provider FROM payment_intents WHERE id=${BigInt(intent.id)}`;
    assert.equal(native[0].status, "authorized");
    assert.equal(native[0].method, "pix");
    assert.equal(native[0].provider, "sandbox");
    for (const path of [
      "/chargers",
      "/charging-sessions",
      "/payments",
      "/alerts",
      "/dashboard/summary",
    ])
      await request("GET", path, undefined, admin);
    // Provisioning endpoint compatibility, backed by pending charger + checklist.
    const prov = (
      await request(
        "POST",
        "/charger-provisionings",
        {
          stationId: String(f.station.id),
          name: "QA Provisionado",
          location: "QA-4",
          connectorType: "TYPE2",
          powerType: "AC",
          phaseCount: 3,
          powerKw: 22,
          pricePerKwh: 2.15,
          manufacturer: "QA",
          model: "Protótipo",
          serialNumber: `QA-${f.label}`,
          ocppIdentity: `QA-${f.label}`,
          ocppVersion: "1.6J",
        },
        admin,
        undefined,
        undefined,
        201,
      )
    ).data;
    await request(
      "POST",
      "/device/v1/charger-provisionings/claim",
      {
        activationCode: prov.activationCode,
        serialNumber: `QA-${f.label}`,
        ocppIdentity: "ERRADO",
      },
      undefined,
      undefined,
      undefined,
      400,
    );
    const claim = {
      activationCode: prov.activationCode,
      serialNumber: `QA-${f.label}`,
      ocppIdentity: `QA-${f.label}`,
    };
    await request(
      "POST",
      "/device/v1/charger-provisionings/claim",
      claim,
      undefined,
      undefined,
      undefined,
      201,
    );
    const approved = (
      await request(
        "POST",
        `/charger-provisionings/${prov.id}/approve`,
        {},
        admin,
        undefined,
        undefined,
        201,
      )
    ).data;
    assert.equal(approved.status, "ENABLED");
    assert.ok(approved.charger.qrBindings[0].publicToken);
    await request(
      "GET",
      `/mobile/v1/qr/${approved.charger.qrBindings[0].publicToken}`,
      undefined,
      driver,
    );
    const client = (
      await request(
        "POST",
        "/clients",
        {
          name: "QA Avulso",
          vehicle: "QA EV",
          plate: `QA${Date.now().toString().slice(-7)}`,
        },
        admin,
        undefined,
        undefined,
        201,
      )
    ).data;
    await request(
      "PATCH",
      `/clients/${client.id}`,
      { vehicle: "QA EV atualizado" },
      admin,
    );
    await request("GET", `/clients/${client.id}`, undefined, admin);
    await request("GET", "/clients", undefined, admin);
    const cash = (
      await request(
        "POST",
        `/chargers/${f.chargers[1].id}/postpaid-sessions`,
        {
          tarifaKwh: 1.89,
          origem: "caixa",
          motivo: "pagamento_no_encerramento",
        },
        admin,
        undefined,
        undefined,
        201,
      )
    ).data;
    await request(
      "POST",
      `/charging-sessions/${cash.sessaoId}/settle-cash`,
      {
        energiaConsumidaKwh: 1,
        valorCobrado: 2.39,
        valorRecebido: 5,
        origem: "caixa",
      },
      admin,
      undefined,
      undefined,
      201,
    );
    await request(
      "POST",
      `/chargers/${f.chargers[2].id}/commands`,
      { command: "sincronizar_status" },
      admin,
      undefined,
      undefined,
      201,
    );
    // Concurrent customers compete for one charger; only one reservation succeeds.
    const second = (
      await request(
        "POST",
        "/mobile/v1/auth/register",
        { ...registration, email: `second-${f.label}@emps.invalid` },
        undefined,
        undefined,
        undefined,
        201,
      )
    ).data;
    const raceCharger = f.chargers[2];
    const raceBody = {
      chargerId: String(raceCharger.id),
      method: "card",
      spendingLimit: 10,
    };
    const pair = await Promise.all([
      request(
        "POST",
        "/mobile/v1/payment-intents",
        raceBody,
        driver,
        "qa-race-intent",
        undefined,
        201,
      ),
      request(
        "POST",
        "/mobile/v1/payment-intents",
        raceBody,
        driver,
        "qa-race-intent",
        undefined,
        201,
      ),
    ]);
    assert.equal(pair[0].data.id, pair[1].data.id);
    const secondIntent = (
      await request(
        "POST",
        "/mobile/v1/payment-intents",
        raceBody,
        second.accessToken,
        "qa-race-intent",
        undefined,
        201,
      )
    ).data;
    const tokens = [driver, second.accessToken];
    const race = await Promise.all(
      [pair[0].data, secondIntent].map(async (pi, index) => {
        const path = "/mobile/v1/charging-sessions/start";
        const response = await fetch(base + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tokens[index]}`,
            "Idempotency-Key": "qa-race-start",
          },
          body: JSON.stringify({
            paymentIntentId: pi.id,
            qrBindingId: String(raceCharger.qrBindings[0].id),
            spendingLimit: 10,
            idempotencyKey: "qa-race-start",
          }),
        });
        tested.push({ method: "POST", path, status: response.status });
        return { status: response.status, data: await response.json(), index };
      }),
    );
    assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
    const winner = race.find((r) => r.status === 201)!;
    const winnerToken = tokens[winner.index];
    await Promise.all([
      request(
        "POST",
        `/mobile/v1/charging-sessions/${winner.data.id}/stop`,
        {},
        winnerToken,
        "qa-race-stop",
        undefined,
        201,
      ),
      request(
        "POST",
        `/mobile/v1/charging-sessions/${winner.data.id}/stop`,
        {},
        winnerToken,
        "qa-race-stop",
        undefined,
        201,
      ),
    ]);
    assert.equal(
      await db.payment.count({ where: { sessionId: BigInt(winner.data.id) } }),
      1,
    );
    assert.equal(
      (
        await db.chargingSession.findUniqueOrThrow({
          where: { id: BigInt(winner.data.id) },
        })
      ).status,
      "FINISHED",
    );
    await request(
      "GET",
      `/mobile/v1/charging-sessions/${session.id}`,
      undefined,
      second.accessToken,
      undefined,
      undefined,
      404,
    );
    await request(
      "GET",
      "/chargers/not-an-id",
      undefined,
      admin,
      undefined,
      undefined,
      400,
    );
    await db.qrBinding.update({
      where: { id: f.chargers[0].qrBindings[0].id },
      data: { isActive: false },
    });
    await request(
      "GET",
      `/mobile/v1/qr/${f.chargers[0].qrBindings[0].publicToken}`,
      undefined,
      driver,
      undefined,
      undefined,
      404,
    );
    const manual = (
      await request(
        "POST",
        `/chargers/${f.chargers[1].id}/manual-release`,
        {
          tarifaKwh: 999,
          valorRecebido: 10,
          origem: "caixa",
          motivo: "fallback_qr_code",
          modo: "pre_pago",
        },
        admin,
        undefined,
        undefined,
        201,
      )
    ).data;
    assert.equal(
      manual.energiaLiberadaKwh,
      Number(((10 - 0.5) / 1.89).toFixed(3)),
    );
    await request(
      "POST",
      `/charging-sessions/${manual.sessaoId}/settle-cash`,
      {
        energiaConsumidaKwh: 1,
        valorCobrado: 2.39,
        valorRecebido: 10,
        origem: "caixa",
      },
      admin,
      undefined,
      undefined,
      201,
    );
    assert.equal(
      await db.payment.count({ where: { sessionId: BigInt(manual.sessaoId) } }),
      1,
    );
    // Inject a transient provider failure against the real persisted session.
    const retryIntent = (
      await request(
        "POST",
        "/mobile/v1/payment-intents",
        {
          chargerId: String(f.chargers[1].id),
          method: "wallet",
          spendingLimit: 10,
        },
        driver,
        "qa-retry-intent",
        undefined,
        201,
      )
    ).data;
    const retrySession = (
      await request(
        "POST",
        "/mobile/v1/charging-sessions/start",
        {
          paymentIntentId: retryIntent.id,
          qrBindingId: String(f.chargers[1].qrBindings[0].id),
          spendingLimit: 10,
          idempotencyKey: "qa-retry-start",
        },
        driver,
        "qa-retry-start",
        undefined,
        201,
      )
    ).data;
    class FailingProvider extends PaymentGatewayService {
      override async settleIntent(): Promise<never> {
        throw new Error("QA provider indisponível");
      }
    }
    const retryService = new MobileService(
      db as PrismaService,
      new JwtService(),
      new FailingProvider(),
      new ChargingGatewayService(),
      new RealtimeService(),
    );
    await assert.rejects(
      retryService.stopCharging(
        registered.user.id,
        retrySession.id,
        "qa-retry-stop",
      ),
      /QA provider/,
    );
    const pending = await db.chargingSession.findUniqueOrThrow({
      where: { id: BigInt(retrySession.id) },
    });
    assert.equal(pending.status, "WAITING_PAYMENT");
    assert.ok(pending.endTime);
    const retried = (
      await request(
        "POST",
        `/mobile/v1/charging-sessions/${retrySession.id}/stop`,
        {},
        driver,
        "qa-retry-stop",
        undefined,
        201,
      )
    ).data;
    assert.equal(retried.status, "completed");
    assert.equal(retried.energyKwh, Number(pending.energyKwh));
    assert.equal(
      await db.payment.count({ where: { sessionId: BigInt(retrySession.id) } }),
      1,
    );
    assert.equal(
      await db.chargingCommand.count({
        where: { sessionId: BigInt(retrySession.id), type: "STOP_CHARGING" },
      }),
      1,
    );
    const alreadyPaid = (
      await request(
        "POST",
        "/payments/simulate",
        { sessionId: session.id },
        admin,
        undefined,
        undefined,
        201,
      )
    ).data;
    assert.equal(alreadyPaid.id, String(persisted.payments[0].id));
    assert.equal(
      await db.payment.count({ where: { sessionId: BigInt(session.id) } }),
      1,
    );
    const adminSession = (
      await request(
        "POST",
        "/charging-sessions/start",
        { clientId: client.id, chargerId: String(f.chargers[2].id) },
        admin,
        undefined,
        undefined,
        201,
      )
    ).data;
    await request(
      "POST",
      `/charging-sessions/${adminSession.id}/finish`,
      {},
      admin,
      undefined,
      undefined,
      201,
    );
    const adminPayment = await db.payment.findFirstOrThrow({
      where: { sessionId: BigInt(adminSession.id) },
    });
    await request("GET", `/payments/${adminPayment.id}`, undefined, admin);
    await request(
      "POST",
      `/payments/${adminPayment.id}/approve`,
      {},
      admin,
      undefined,
      undefined,
      201,
    );
    const toCancel = (
      await request(
        "POST",
        "/charging-sessions/start",
        { clientId: client.id, chargerId: String(f.chargers[2].id) },
        admin,
        undefined,
        undefined,
        201,
      )
    ).data;
    await request(
      "POST",
      `/charging-sessions/${toCancel.id}/cancel`,
      {},
      admin,
      undefined,
      undefined,
      201,
    );
    await request(
      "PATCH",
      `/chargers/${f.chargers[2].id}`,
      { name: "QA Editado", pricePerKwh: 2.1 },
      admin,
    );
    await request(
      "PATCH",
      `/chargers/${f.chargers[2].id}/status`,
      { status: "MAINTENANCE" },
      admin,
    );
    await request(
      "PATCH",
      `/chargers/${f.chargers[2].id}/status`,
      { status: "AVAILABLE" },
      admin,
    );
    await request(
      "POST",
      `/chargers/${f.chargers[2].id}/commands`,
      { command: "solicitar_manutencao" },
      admin,
      undefined,
      undefined,
      201,
    );
    const alerts = (await request("GET", "/alerts", undefined, admin)).data;
    await request(
      "PATCH",
      `/alerts/${alerts[0].id}/status`,
      { status: "RESOLVED" },
      admin,
    );
    await request("DELETE", `/clients/${client.id}`, undefined, admin);
    await request(
      "GET",
      `/clients/${client.id}`,
      undefined,
      admin,
      undefined,
      undefined,
      404,
    );
    await request(
      "POST",
      "/mobile/v1/auth/refresh",
      { refreshToken: login.refreshToken },
      undefined,
      undefined,
      undefined,
      401,
    );
    await request(
      "POST",
      "/mobile/v1/auth/refresh",
      { refreshToken: rotated.refreshToken },
      undefined,
      undefined,
      undefined,
      401,
    );
    await request(
      "POST",
      "/mobile/v1/auth/logout",
      { refreshToken: registered.refreshToken },
      driver,
      undefined,
      undefined,
      204,
    );
    await request(
      "POST",
      "/auth/logout",
      {},
      undefined,
      undefined,
      refreshed.cookie,
      204,
    );
    await request(
      "POST",
      "/auth/refresh",
      {},
      undefined,
      undefined,
      refreshed.cookie,
      401,
    );
    assert.deepEqual(
      await schema(),
      before,
      "Estrutura SQL mudou durante a validação",
    );
    const report = {
      passed: true,
      database,
      tables: tables.map((t) => t.name),
      fixture: {
        label: f.label,
        stationId: f.station.id,
        adminId: f.admin.id,
        driverId: registered.user.id,
        sessionId: session.id,
        paymentId: String(persisted.payments[0].id),
      },
      tested,
      schemaUnchanged: true,
    };
    writeFileSync("reports/mysql-smoke.json", JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        passed: true,
        requests: tested.length,
        fixture: report.fixture,
        database,
      }),
    );
  } catch (error) {
    writeFileSync(
      "reports/mysql-smoke-failure.json",
      JSON.stringify(
        { error: String(error), fixture: f.label, tested },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    server.kill();
    if (process.env.SMOKE_KEEP_QA !== 'true') await cleanupQa(db, f.label, true);
    await db.$disconnect();
    log.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
