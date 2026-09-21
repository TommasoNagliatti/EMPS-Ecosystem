import assert from "node:assert/strict";
import test from "node:test";
import { Role } from "@prisma/client";
import type { AuthRequest } from "../src/auth";
import { AdminOperationsService } from "../src/admin-operations.service";
import { OperationsController } from "../src/operations.controller";
import { PrismaService } from "../src/prisma.service";
import { RealtimeService } from "../src/realtime.service";

function authRequest(role: Role, sub: string): AuthRequest {
  return {
    headers: {},
    user: { sub, role, email: `${sub}@emps.test` },
  };
}

function controllerWithFindManySpy() {
  const calls: unknown[] = [];
  const prisma = {
    charger: {
      findMany(args: unknown) {
        calls.push(args);
        return Promise.resolve([]);
      },
    },
  } as unknown as PrismaService;

  return {
    calls,
    controller: new OperationsController(
      prisma,
      {} as AdminOperationsService,
      {} as RealtimeService,
    ),
  };
}

test("ADMIN mantém a visão do próprio eletroposto", async () => {
  const { calls, controller } = controllerWithFindManySpy();

  await controller.chargers(authRequest(Role.ADMIN, "1"));

  assert.deepEqual((calls[0] as { where: unknown }).where, {
    station: { adminId: 1 },
  });
});

test("OPERATOR consulta apenas estações atribuídas em station_staff", async () => {
  const { calls, controller } = controllerWithFindManySpy();

  await controller.chargers(authRequest(Role.OPERATOR, "2"));

  assert.deepEqual((calls[0] as { where: unknown }).where, {
    station: { staff: { some: { userId: 2 } } },
  });
});
