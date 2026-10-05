import assert from "node:assert/strict";
import test from "node:test";
import {
  REALTIME_CHANGE_EVENT,
  REALTIME_ROOMS,
  REALTIME_TOPICS,
} from "../src/realtime.contract";
import {
  authenticateRealtimeHandshake,
  createRealtimeChange,
  extractRealtimeToken,
  parseRealtimeCorsOrigins,
  parseRealtimeAuthUser,
  realtimeCorsOrigin,
  roomsForRealtimeUser,

} from "../src/realtime.helpers";
import { RealtimeGateway } from "../src/realtime.gateway";
import { RealtimeService } from "../src/realtime.service";

test("contrato realtime mantém apenas metadados mínimos", () => {
  const change = createRealtimeChange(
    {
      topic: "payment.updated",
      entityId: "payment-1",
      customerId: "1",
    },
    {
      eventId: "event-1",
      occurredAt: new Date("2026-08-28T12:00:00.000Z"),
    },
  );

  assert.deepEqual(change, {
    eventId: "event-1",
    topic: "payment.updated",
    entityId: "payment-1",
    occurredAt: "2026-08-28T12:00:00.000Z",
    customerId: "1",
  });
  assert.deepEqual(REALTIME_TOPICS, [
    "session.created",
    "session.updated",
    "payment.updated",
    "charger.updated",
    "station.updated",
    "alert.updated",
    "customer.updated",
    "dashboard.updated",
  ]);
});

test("atribui salas autenticadas conforme o perfil do JWT", () => {
  const exp = Math.floor(Date.now() / 1_000) + 300;
  assert.deepEqual(
    roomsForRealtimeUser({ exp, sub: "2", role: "ADMIN" }),
    ["authenticated", "customer:2"],
  );
  assert.throws(() =>
    parseRealtimeAuthUser({ exp, sub: "1", role: "GOODWE_ADMIN" }),
  );
  assert.deepEqual(
    roomsForRealtimeUser({ exp, sub: "3", role: "OPERATOR" }),
    ["authenticated", "customer:3"],
  );
  assert.deepEqual(
    roomsForRealtimeUser({ exp, sub: "1", role: "CUSTOMER" }),
    ["authenticated", "customer:1"],
  );
});

test("extrai JWT do auth.token ou do Bearer header", () => {
  assert.equal(
    extractRealtimeToken({
      auth: { token: "auth-token" },
      headers: { authorization: "Bearer ignored-token" },
    }),
    "auth-token",
  );
  assert.equal(
    extractRealtimeToken({
      headers: { authorization: "bearer header-token" },
    }),
    "header-token",
  );
  assert.throws(() => extractRealtimeToken({}), /Token realtime ausente/);
});

test("autentica handshake e rejeita claims sem usuário ou perfil válido", () => {
  const verifiedTokens: string[] = [];
  const validExp = Math.floor(Date.now() / 1_000) + 300;
  const jwt = {
    verify(token: string) {
      verifiedTokens.push(token);
      return {
        exp: validExp,
        sub: "1",
        role: "CUSTOMER",
        email: "not-emitted@emps.test",
      };
    },
  };
  assert.deepEqual(
    authenticateRealtimeHandshake(jwt as never, {
      auth: { token: "signed-token" },
    }),
    {
      exp: validExp,
      sub: "1",
      role: "CUSTOMER",
    },
  );
  assert.deepEqual(verifiedTokens, ["signed-token"]);

  assert.throws(
    () =>
      authenticateRealtimeHandshake(
        {
          verify: () => ({
            exp: Math.floor(Date.now() / 1_000) + 300,
            sub: "1",
            role: "UNKNOWN",
          }),
        } as never,
        { auth: { token: "signed-token" } },
      ),
    /perfil válido/,
  );
  assert.throws(
    () =>
      authenticateRealtimeHandshake(
        {
          verify: () => ({ exp: 1, sub: "1", role: "CUSTOMER" }),
        } as never,
        { auth: { token: "expired-token" } },
      ),
    /expiração válida/,
  );
});

test("origens CORS vêm de CORS_ORIGINS e removem espaços e duplicatas", () => {
  assert.deepEqual(
    parseRealtimeCorsOrigins(
      " https://app.emps.test,https://ops.emps.test,https://app.emps.test ",
    ),
    ["https://app.emps.test", "https://ops.emps.test"],
  );
  assert.deepEqual(parseRealtimeCorsOrigins(), [
    "http://localhost:3000",
    "http://localhost:8081",
  ]);
});

test("callback CORS consulta CORS_ORIGINS e rejeita origem desconhecida", () => {
  const previousOrigins = process.env.CORS_ORIGINS;
  process.env.CORS_ORIGINS = "https://app.emps.test";
  try {
    realtimeCorsOrigin("https://app.emps.test", (error, allowed) => {
      assert.equal(error, null);
      assert.equal(allowed, true);
    });
    realtimeCorsOrigin("https://evil.test", (error, allowed) => {
      assert.match(error?.message ?? "", /não autorizada/);
      assert.equal(allowed, false);
    });
  } finally {
    if (previousOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previousOrigins;
  }
});

test("serviço não transmite sessão privada para outras contas", async () => {
  const emissions: Array<{ rooms: string[]; event: string; payload: unknown }> =
    [];
  const realtime = new RealtimeService({user:{findFirst:async()=>({id:1})}} as never);
  realtime.attachEmitter({
    to(rooms: string | string[]) {
      return {
        emit(event: string, payload: unknown) {
          emissions.push({
            rooms: Array.isArray(rooms) ? rooms : [rooms],
            event,
            payload,
          });
          return true;
        },
      } as never;
    },
  } as never);

  const change = realtime.publishToCustomer("1", {
    topic: "session.updated",
    entityId: "session-1",
  });

  await realtime.flush();
  assert.equal(realtime.isReady(), true);
  assert.equal(emissions.length, 1);
  assert.deepEqual(emissions[0]?.rooms, ["customer:1"]);
  assert.equal(emissions[0]?.event, REALTIME_CHANGE_EVENT);
  assert.deepEqual(emissions[0]?.payload, change);
});

test("gateway recusa JWT inválido antes da conexão e associa salas após autenticar", async () => {
  type Middleware = (
    socket: Record<string, unknown>,
    next: (error?: Error) => void,
  ) => void;
  let middleware: Middleware | undefined;
  const realtime = new RealtimeService({user:{findFirst:async()=>({id:1})}} as never);
  const validExp = Math.floor(Date.now() / 1_000) + 300;
  const jwt = {
    verify(token: string) {
      if (token !== "valid-token") throw new Error("invalid signature");
      return {
        exp: validExp,
        sub: "1",
        role: "CUSTOMER",
        email: "never-stored@emps.test",
      };
    },
  };
  const server = {
    use(handler: Middleware) {
      middleware = handler;
    },
    to() {
      return { emit: () => true };
    },
  };
  const gateway = new RealtimeGateway(jwt as never, realtime, {user:{findUnique:async()=>({accountStatus:"ACTIVE",role:"CUSTOMER"})}} as never);
  gateway.afterInit(server as never);

  const invalidSocket = {
    handshake: { auth: { token: "invalid-token" }, headers: {} },
    data: {},
  };
  const invalidError = await new Promise<Error | undefined>((resolve) => {
    middleware?.(invalidSocket, resolve);
  });
  assert.equal(invalidError?.message, "Não autorizado");
  assert.deepEqual((invalidError as Error & { data?: unknown })?.data, {
    code: "UNAUTHORIZED",
  });

  const joinedRooms: string[][] = [];
  const emittedEvents: Array<{ event: string; payload: unknown }> = [];
  const socket = {
    id: "socket-1",
    handshake: { auth: { token: "valid-token" }, headers: {} },
    data: {},
    async join(rooms: string[]) {
      joinedRooms.push(rooms);
    },
    emit(event: string, payload: unknown) {
      emittedEvents.push({ event, payload });
    },
    disconnect() {},
  };
  const authError = await new Promise<Error | undefined>((resolve) => {
    middleware?.(socket, resolve);
  });
  assert.equal(authError, undefined);
  await gateway.handleConnection(socket as never);

  const authenticatedData = socket.data as {
    authorizationExpiryTimer?: ReturnType<typeof setTimeout>;
    user?: unknown;
  };
  assert.ok(authenticatedData.authorizationExpiryTimer);
  assert.deepEqual(authenticatedData.user, {
    exp: validExp,
    sub: "1",
    role: "CUSTOMER",
  });
  assert.deepEqual(joinedRooms, [["authenticated", "customer:1"]]);
  assert.equal(emittedEvents[0]?.event, "emps:ready");
  gateway.handleDisconnect(socket as never);
});
