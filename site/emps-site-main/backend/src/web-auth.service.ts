import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Role, type User } from "@prisma/client";
import * as bcrypt from "bcrypt";
import type { LoginDto } from "./dtos";
import {
  createOpaqueToken,
  hashOpaqueToken,
  normalizeEmail,
} from "./mobile.utils";
import { PrismaService } from "./prisma.service";
import { MobileRegisterDto } from './mobile.dtos';
import { assertRemoteAccount, assertRemoteHttpRequest, remoteDevelopment } from './remote-development';

@Injectable()
export class WebAuthService {
  private readonly remoteTokens = new Map<string, {userId:number; familyId:string; expiresAt:Date; revoked:boolean}>();
  private readonly remoteRevokedFamilies = new Set<string>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private refreshTokenExpiry() {
    const configured = Number(process.env.WEB_REFRESH_TOKEN_DAYS ?? 365);
    const days = Number.isFinite(configured)
      ? Math.min(3_650, Math.max(1, configured))
      : 365;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1_000);
  }

  private publicUser(user: Pick<User, "id" | "name" | "email" | "role">) {
    return {
      email: user.email,
      id: String(user.id),
      name: user.name,
      role: user.role,
    };
  }

  private async signAccessToken(user: Pick<User, "id" | "email" | "role">) {
    return this.jwt.signAsync({
      email: user.email,
      jti: createOpaqueToken(16),
      role: user.role,
      sub: String(user.id),
    });
  }

  private async issueAuthentication(user: User, familyId?: string) {
    if (remoteDevelopment()) {
      assertRemoteAccount(user.email);
      for (const [key, token] of this.remoteTokens) if (token.expiresAt <= new Date()) this.remoteTokens.delete(key);
      const families = new Set([...this.remoteTokens.values()].map(token => token.familyId));
      for (const family of this.remoteRevokedFamilies) if (!families.has(family)) this.remoteRevokedFamilies.delete(family);
      if (familyId && this.remoteRevokedFamilies.has(familyId)) throw new UnauthorizedException('Local development session family revoked');
      if (this.remoteTokens.size >= 500) throw new UnauthorizedException('Local development session limit reached');
      const refreshToken = createOpaqueToken();
      const refreshTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
      this.remoteTokens.set(hashOpaqueToken(refreshToken), {userId:user.id, familyId:familyId??randomUUID(), expiresAt:refreshTokenExpiresAt, revoked:false});
      return {accessToken:await this.signAccessToken(user), refreshToken, refreshTokenExpiresAt, user:this.publicUser(user)};
    }
    const refreshToken = createOpaqueToken();
    const refreshTokenExpiresAt = this.refreshTokenExpiry();
    await this.prisma.refreshToken.create({
      data: {
        expiresAt: refreshTokenExpiresAt,
        familyId: familyId ?? randomUUID(),
        platform: "WEB",
        tokenHash: hashOpaqueToken(refreshToken),
        userId: user.id,
      },
    });
    return {
      accessToken: await this.signAccessToken(user),
      refreshToken,
      refreshTokenExpiresAt,
      user: this.publicUser(user),
    };
  }

  async login(dto: LoginDto) {
    assertRemoteAccount(normalizeEmail(dto.email));
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(dto.email) },
    });
    const validPassword = user
      ? await bcrypt.compare(dto.password, user.passwordHash)
      : false;
    if (
      !user ||
      user.accountStatus !== "ACTIVE" ||
      !validPassword
    ) {
      throw new UnauthorizedException("Credenciais inválidas");
    }
    return this.issueAuthentication(user);
  }

  async register(dto: MobileRegisterDto) {
    assertRemoteHttpRequest('POST', '/auth/register');
    if (Buffer.byteLength(dto.password,'utf8')>72)throw new BadRequestException('Senha excede 72 bytes');
    if (dto.password !== dto.passwordConfirmation || dto.acceptTerms !== true) throw new BadRequestException('Confirme a senha e aceite os termos');
    try {
      const user = await this.prisma.user.create({data: {name:dto.name.trim(), email:normalizeEmail(dto.email), passwordHash:await bcrypt.hash(dto.password,12), role:'CUSTOMER', termsAcceptedAt:new Date()}});
      return this.issueAuthentication(user);
    } catch (error) {
      if ((error as {code?:string}).code === 'P2002') throw new ConflictException('Já existe uma conta com este e-mail');
      throw error;
    }
  }

  async refresh(refreshToken: string) {
    if (remoteDevelopment()) {
      const current = this.remoteTokens.get(hashOpaqueToken(refreshToken));
      if (!current || current.expiresAt <= new Date()) throw new UnauthorizedException('Local development session expired');
      if (current.revoked) {
        this.remoteRevokedFamilies.add(current.familyId);
        for (const token of this.remoteTokens.values()) if (token.familyId === current.familyId) token.revoked = true;
        throw new UnauthorizedException('Local development session already rotated');
      }
      // Consume before awaiting the user lookup so simultaneous refreshes cannot both rotate.
      current.revoked = true;
      const user = await this.prisma.user.findUnique({where:{id:current.userId}});
      if (!user || user.accountStatus !== 'ACTIVE') throw new UnauthorizedException('Account no longer active');
      assertRemoteAccount(user.email);
      return this.issueAuthentication(user, current.familyId);
    }
    const current = await this.prisma.refreshToken.findUnique({
      include: { user: true },
      where: { tokenHash: hashOpaqueToken(refreshToken) },
    });
    if (!current || current.expiresAt <= new Date()) {
      throw new UnauthorizedException("Sessão expirada. Entre novamente");
    }
    if (current.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        data: {
          revokedAt: new Date(),
        },
        where: { familyId: current.familyId, revokedAt: null },
      });
      throw new UnauthorizedException("Sessão inválida. Entre novamente");
    }
    if (
      current.user.accountStatus !== "ACTIVE"
    ) {
      throw new UnauthorizedException("Conta sem acesso ao painel");
    }

    const nextRawToken = createOpaqueToken();
    const nextExpiresAt = this.refreshTokenExpiry();
    const rotated = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        data: {
          lastUsedAt: new Date(),
          revokedAt: new Date(),
        },
        where: { id: current.id, revokedAt: null },
      });
      if (revoked.count !== 1) return false;
      await tx.refreshToken.create({
        data: {
          expiresAt: nextExpiresAt,
          familyId: current.familyId,
          platform: "WEB",
          tokenHash: hashOpaqueToken(nextRawToken),
          userId: current.userId,
        },
      });
      return true;
    });
    if (!rotated) {
      throw new UnauthorizedException("Sessão já renovada. Entre novamente");
    }

    return {
      accessToken: await this.signAccessToken(current.user),
      refreshToken: nextRawToken,
      refreshTokenExpiresAt: nextExpiresAt,
      user: this.publicUser(current.user),
    };
  }

  async logout(refreshToken: string) {
    if (remoteDevelopment()) {
      const current = this.remoteTokens.get(hashOpaqueToken(refreshToken));
      if (current) {
        this.remoteRevokedFamilies.add(current.familyId);
        for (const token of this.remoteTokens.values()) if (token.familyId === current.familyId) token.revoked = true;
      }
      return;
    }
    await this.prisma.refreshToken.updateMany({
      data: { revokedAt: new Date() },
      where: {
        revokedAt: null,
        tokenHash: hashOpaqueToken(refreshToken),
      },
    });
  }
}
