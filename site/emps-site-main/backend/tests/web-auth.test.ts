import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Role } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { hashOpaqueToken } from "../src/mobile.utils";
import { PrismaService } from "../src/prisma.service";
import { WebAuthService } from "../src/web-auth.service";

type StoredRefreshToken = {
  expiresAt: Date;
  familyId: string;
  id: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  tokenHash: string;
  userId: string;
};

async function authFixture(role: Role = Role.ADMIN) {
  const user = {
    createdAt: new Date(),
    email: "admin@emps.com",
    id: 1,
    name: "Administrador EMPS",
    passwordHash: await bcrypt.hash("admin123", 4),
    role,
    accountStatus: "ACTIVE",
    updatedAt: new Date(),
  };
  const refreshTokens: StoredRefreshToken[] = [];
  let tokenSequence = 0;
  let accessSequence = 0;

  const refreshTokenRepository = {
    create({
      data,
    }: {
      data: Partial<StoredRefreshToken> & { userId: string };
    }) {
      tokenSequence += 1;
      const record: StoredRefreshToken = {
        expiresAt: data.expiresAt ?? new Date(),
        familyId: data.familyId ?? `family-${tokenSequence}`,
        id: `refresh-${tokenSequence}`,
        lastUsedAt: null,
        revokedAt: null,
        revokedReason: null,
        tokenHash: data.tokenHash ?? "",
        userId: data.userId,
      };
      refreshTokens.push(record);
      return Promise.resolve(record);
    },
    findUnique({ where }: { where: { tokenHash: string } }) {
      const record = refreshTokens.find(
        (candidate) => candidate.tokenHash === where.tokenHash,
      );
      return Promise.resolve(record ? { ...record, user } : null);
    },
    updateMany({
      data,
      where,
    }: {
      data: Partial<StoredRefreshToken>;
      where: Partial<StoredRefreshToken>;
    }) {
      const matches = refreshTokens.filter((candidate) =>
        Object.entries(where).every(([key, value]) => {
          if (key === "revokedAt" && value === null)
            return candidate.revokedAt === null;
          return candidate[key as keyof StoredRefreshToken] === value;
        }),
      );
      for (const record of matches) Object.assign(record, data);
      return Promise.resolve({ count: matches.length });
    },
  };
  const prisma = {
    $transaction(callback: (client: unknown) => Promise<unknown>) {
      return callback(prisma);
    },
    refreshToken: refreshTokenRepository,
    user: {
      findUnique({ where }: { where: { email: string } }) {
        return Promise.resolve(where.email === user.email ? user : null);
      },
    },
  } as unknown as PrismaService;
  const jwt = {
    signAsync() {
      accessSequence += 1;
      return Promise.resolve(`access-${accessSequence}`);
    },
  } as JwtService;

  return {
    refreshTokens,
    service: new WebAuthService(prisma, jwt),
  };
}

test("login web emite refresh opaco com hash e rotação preserva a família", async () => {
  const fixture = await authFixture();
  const login = await fixture.service.login({
    email: " ADMIN@EMPS.COM ",
    password: "admin123",
  });

  assert.equal(login.accessToken, "access-1");
  assert.equal(login.user.role, Role.ADMIN);
  assert.notEqual(login.refreshToken, fixture.refreshTokens[0]?.tokenHash);
  assert.equal(
    fixture.refreshTokens[0]?.tokenHash,
    hashOpaqueToken(login.refreshToken),
  );
  assert.ok(
    login.refreshTokenExpiresAt.getTime() >
      Date.now() + 300 * 24 * 60 * 60 * 1_000,
  );

  const rotated = await fixture.service.refresh(login.refreshToken);
  assert.equal(rotated.accessToken, "access-2");
  assert.notEqual(rotated.refreshToken, login.refreshToken);
  assert.ok(fixture.refreshTokens[0]?.revokedAt instanceof Date);
  assert.equal(
    fixture.refreshTokens[1]?.familyId,
    fixture.refreshTokens[0]?.familyId,
  );
});

test("reuso de refresh antigo revoga a família e logout revoga a sessão atual", async () => {
  const fixture = await authFixture();
  const login = await fixture.service.login({
    email: "admin@emps.com",
    password: "admin123",
  });
  const rotated = await fixture.service.refresh(login.refreshToken);

  await assert.rejects(
    fixture.service.refresh(login.refreshToken),
    UnauthorizedException,
  );
  assert.ok(fixture.refreshTokens[1]?.revokedAt instanceof Date);

  const secondFixture = await authFixture();
  const secondLogin = await secondFixture.service.login({
    email: "admin@emps.com",
    password: "admin123",
  });
  await secondFixture.service.logout(secondLogin.refreshToken);
  assert.ok(secondFixture.refreshTokens[0]?.revokedAt instanceof Date);
  await assert.rejects(
    secondFixture.service.refresh(secondLogin.refreshToken),
    UnauthorizedException,
  );
  assert.ok(rotated.refreshToken.length >= 32);
});

test("conta de motorista não entra no painel administrativo", async () => {
  const fixture = await authFixture(Role.CUSTOMER);
  await assert.rejects(
    fixture.service.login({
      email: "admin@emps.com",
      password: "admin123",
    }),
    UnauthorizedException,
  );
});
