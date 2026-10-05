import { intId } from "./persistence";
import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Post,
  Req,
  Res,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Throttle } from "@nestjs/throttler";
import { Role } from "@prisma/client";
import type { Response } from "express";
import { PrismaService } from "./prisma.service";
import { LoginDto } from "./dtos";
import { WebAuthService } from "./web-auth.service";
import { MobileRegisterDto } from './mobile.dtos';

export type AuthUser = { sub: string; email: string; role: Role; selectedStationId?: number; stationPermission?: 'READ' | 'OPERATE' | 'MANAGE' };
export type AuthRequest = {
  headers: { authorization?: string; cookie?: string; 'x-station-id'?: string };
  method?: string;
  user: AuthUser;
};

const WEB_REFRESH_COOKIE = "emps_web_refresh";

function readCookie(header: string | undefined, name: string) {
  const encoded = header
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)
    ?.slice(1)
    .join("=");
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function refreshCookieOptions(expires?: Date) {
  return {
    expires,
    httpOnly: true,
    path: "/auth",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

function setRefreshCookie(
  response: Response,
  refreshToken: string,
  expires: Date,
) {
  response.cookie(
    WEB_REFRESH_COOKIE,
    refreshToken,
    refreshCookieOptions(expires),
  );
}

function clearRefreshCookie(response: Response) {
  response.clearCookie(WEB_REFRESH_COOKIE, refreshCookieOptions());
}

const ROLES_KEY = "emps:roles";
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const StationScoped = () => SetMetadata('emps:station-scoped', true);

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = request.headers.authorization?.replace(/^Bearer /, "");
    if (!token) throw new UnauthorizedException("Token ausente");
    try {
      request.user = this.jwt.verify(token);
      // Never trust scope claims from a client token. Derive them for this request.
      delete request.user.selectedStationId;
      delete request.user.stationPermission;
      if (request.headers['x-station-id']) request.user.selectedStationId = intId(request.headers['x-station-id']);
      const user = await this.prisma.user.findUnique({
        where: { id: intId(request.user.sub) },
        select: { role: true, accountStatus: true },
      });
      if (
        !user ||
        user.accountStatus !== "ACTIVE" ||
        user.role !== request.user.role
      )
        throw new UnauthorizedException();
      return true;
    } catch {
      throw new UnauthorizedException("Token inválido");
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const allowedRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowedRoles?.length) return true;

    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (this.reflector.getAllAndOverride<boolean>('emps:station-scoped', [context.getHandler(), context.getClass()])) {
      request.user.stationPermission = request.method === 'GET' ? 'READ' : allowedRoles.includes(Role.OPERATOR) ? 'OPERATE' : 'MANAGE';
      if(request.method!=='GET'){
        const {stationScope}=await import('./persistence');
        if(!await this.prisma.station.findFirst({where:stationScope(request.user),select:{id:true}}))throw new ForbiddenException('Sem permissão para operar esta estação');
      }
      return true; // Every station lookup still intersects stationScope; global role grants no station access.
    }
    if (!request.user || !allowedRoles.includes(request.user.role)) {
      throw new ForbiddenException(
        "Você não possui permissão para esta operação",
      );
    }
    return true;
  }
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webAuth: WebAuthService,
  ) {}

  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('register')
  async register(@Body() dto: MobileRegisterDto, @Res({passthrough:true}) response: Response) {
    const authentication = await this.webAuth.register(dto);
    setRefreshCookie(response, authentication.refreshToken, authentication.refreshTokenExpiresAt);
    const {refreshToken, refreshTokenExpiresAt, ...result} = authentication;
    return result;
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const authentication = await this.webAuth.login(dto);
    setRefreshCookie(
      response,
      authentication.refreshToken,
      authentication.refreshTokenExpiresAt,
    );
    const { refreshToken, refreshTokenExpiresAt, ...publicAuthentication } =
      authentication;
    void refreshToken;
    void refreshTokenExpiresAt;
    return publicAuthentication;
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post("refresh")
  async refresh(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = readCookie(request.headers.cookie, WEB_REFRESH_COOKIE);
    if (!refreshToken) {
      clearRefreshCookie(response);
      throw new UnauthorizedException("Sessão expirada. Entre novamente");
    }
    try {
      const authentication = await this.webAuth.refresh(refreshToken);
      setRefreshCookie(
        response,
        authentication.refreshToken,
        authentication.refreshTokenExpiresAt,
      );
      const {
        refreshToken: nextRefreshToken,
        refreshTokenExpiresAt,
        ...publicAuthentication
      } = authentication;
      void nextRefreshToken;
      void refreshTokenExpiresAt;
      return publicAuthentication;
    } catch (error) {
      if (error instanceof UnauthorizedException) clearRefreshCookie(response);
      throw error;
    }
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post("logout")
  async logout(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = readCookie(request.headers.cookie, WEB_REFRESH_COOKIE);
    if (refreshToken) await this.webAuth.logout(refreshToken);
    clearRefreshCookie(response);
  }
  @UseGuards(JwtGuard)
  @Get("me")
  async me(@Req() request: AuthRequest) {
    return this.prisma.user.findUnique({
      where: { id: intId(request.user.sub) },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        presentationTools: true,
        platformReviewer: true,
        createdAt: true,
      },
    });
  }
  @Get("health") async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ok", service: "EMPS API", database: "mysql" };
  }
}
