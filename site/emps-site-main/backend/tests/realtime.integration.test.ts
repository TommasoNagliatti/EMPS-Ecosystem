import assert from "node:assert/strict";
import test from "node:test";
import { Module } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { NestFactory } from "@nestjs/core";
import { io, type Socket } from "socket.io-client";
import type { AddressInfo } from "node:net";
import { REALTIME_CHANGE_EVENT } from "../src/realtime.contract";
import { RealtimeModule } from "../src/realtime.module";
import { RealtimeService } from "../src/realtime.service";

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: "realtime-integration-test-secret",
      signOptions: {
        audience: "emps-clients",
        expiresIn: "5m",
        issuer: "emps-api",
      },
      verifyOptions: {
        audience: "emps-clients",
        issuer: "emps-api",
      },
    }),
    RealtimeModule,
  ],
})
class RealtimeIntegrationModule {}

function waitFor(condition: () => boolean, timeoutMs = 1_500): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const inspect = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("Tempo esgotado aguardando evento realtime"));
        return;
      }
      setTimeout(inspect, 10);
    };
    inspect();
  });
}

function connectRealtime(url: string, token: string): Promise<Socket> {
  const socket = io(url, {
    auth: { token },
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error("Tempo esgotado conectando ao realtime"));
    }, 1_500);

    socket.once("emps:ready", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      socket.disconnect();
      reject(error);
    });
    socket.connect();
  });
}

test("canal Socket.IO autentica JWT e isola eventos entre clientes", async () => {
  const app = await NestFactory.create(RealtimeIntegrationModule, {
    logger: false,
  });
  const sockets: Socket[] = [];

  try {
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo;
    const realtimeUrl = `http://127.0.0.1:${address.port}/realtime`;
    const jwt = app.get(JwtService);
    const realtime = app.get(RealtimeService);

    await assert.rejects(
      connectRealtime(realtimeUrl, "jwt-invalido"),
      /Não autorizado/,
    );

    const expiringSocket = await connectRealtime(
      realtimeUrl,
      await jwt.signAsync(
        { sub: "temporary-customer", role: "CUSTOMER" },
        { expiresIn: "1s" },
      ),
    );
    sockets.push(expiringSocket);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Socket não foi encerrado após expiração do JWT")),
        2_000,
      );
      expiringSocket.once("disconnect", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    assert.equal(expiringSocket.connected, false);
    sockets.pop();

    const [operations, customerOne, customerTwo] = await Promise.all([
      connectRealtime(
        realtimeUrl,
        await jwt.signAsync({ sub: "operator-1", role: "OPERATOR" }),
      ),
      connectRealtime(
        realtimeUrl,
        await jwt.signAsync({ sub: "customer-1", role: "CUSTOMER" }),
      ),
      connectRealtime(
        realtimeUrl,
        await jwt.signAsync({ sub: "customer-2", role: "CUSTOMER" }),
      ),
    ]);
    sockets.push(operations, customerOne, customerTwo);

    const received = new Map<Socket, string[]>();
    for (const socket of sockets) {
      received.set(socket, []);
      socket.on(REALTIME_CHANGE_EVENT, (change: { eventId: string }) => {
        received.get(socket)?.push(change.eventId);
      });
    }

    const privateChange = realtime.publishToCustomer("customer-1", {
      entityId: "session-1",
      topic: "session.updated",
    });
    await waitFor(
      () =>
        received.get(operations)?.includes(privateChange.eventId) === true &&
        received.get(customerOne)?.includes(privateChange.eventId) === true,
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(received.get(customerTwo)?.includes(privateChange.eventId), false);

    const operationsChange = realtime.publishToOperations({
      entityId: "alert-1",
      topic: "alert.updated",
    });
    await waitFor(
      () => received.get(operations)?.includes(operationsChange.eventId) === true,
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(received.get(customerOne)?.includes(operationsChange.eventId), false);
    assert.equal(received.get(customerTwo)?.includes(operationsChange.eventId), false);

    const publicChange = realtime.publish({
      entityId: "charger-1",
      topic: "charger.updated",
    });
    await waitFor(() =>
      sockets.every(
        (socket) => received.get(socket)?.includes(publicChange.eventId) === true,
      ),
    );
  } finally {
    for (const socket of sockets) socket.disconnect();
    await app.close();
  }
});
