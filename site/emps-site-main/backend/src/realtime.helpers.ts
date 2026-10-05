import { randomUUID } from "node:crypto";
import type { JwtService } from "@nestjs/jwt";
import {
  REALTIME_ROOMS,
  REALTIME_TOPICS,
  type RealtimeChange,
  type RealtimeChangeInput,
  type RealtimeTopic,
} from "./realtime.contract";

export const REALTIME_ROLES = ["ADMIN", "OPERATOR", "CUSTOMER"] as const;
export type RealtimeRole = (typeof REALTIME_ROLES)[number];

export type RealtimeAuthUser = Readonly<{
  exp: number;
  sub: string;
  role: RealtimeRole;
}>;

export type RealtimeHandshake = Readonly<{
  auth?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
}>;

const DEFAULT_CORS_ORIGINS = ["http://localhost:3000", "http://localhost:8081"];

export function parseRealtimeCorsOrigins(value?: string): string[] {
  const origins = (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? [...new Set(origins)] : [...DEFAULT_CORS_ORIGINS];
}

export function realtimeCorsOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
): void {
  const allowedOrigins = parseRealtimeCorsOrigins(
    process.env.CORS_ORIGINS ?? process.env.FRONTEND_URL,
  );
  if (!origin || allowedOrigins.includes(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error("Origem não autorizada pelo realtime EMPS"), false);
}

export function isRealtimeTopic(value: unknown): value is RealtimeTopic {
  return (
    typeof value === "string" &&
    (REALTIME_TOPICS as readonly string[]).includes(value)
  );
}

export function extractRealtimeToken(handshake: RealtimeHandshake): string {
  const authToken = handshake.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) {
    return stripBearerPrefix(authToken);
  }

  const rawAuthorization = handshake.headers?.authorization;
  const authorization = Array.isArray(rawAuthorization)
    ? rawAuthorization[0]
    : rawAuthorization;
  const match = authorization?.trim().match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]?.trim()) {
    throw new Error("Token realtime ausente");
  }
  return match[1].trim();
}

function stripBearerPrefix(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim() ?? trimmed;
  if (!token) throw new Error("Token realtime ausente");
  return token;
}

export function parseRealtimeAuthUser(payload: unknown): RealtimeAuthUser {
  if (!payload || typeof payload !== "object") {
    throw new Error("Token realtime inválido");
  }
  const claims = payload as Record<string, unknown>;
  if (typeof claims.sub !== "string" || !claims.sub.trim()) {
    throw new Error("Token realtime sem usuário");
  }
  if (
    typeof claims.role !== "string" ||
    !(REALTIME_ROLES as readonly string[]).includes(claims.role)
  ) {
    throw new Error("Token realtime sem perfil válido");
  }
  if (
    typeof claims.exp !== "number" ||
    !Number.isFinite(claims.exp) ||
    claims.exp * 1_000 <= Date.now()
  ) {
    throw new Error("Token realtime sem expiração válida");
  }
  return {
    exp: claims.exp,
    sub: claims.sub.trim(),
    role: claims.role as RealtimeRole,
  };
}

export function authenticateRealtimeHandshake(
  jwt: Pick<JwtService, "verify">,
  handshake: RealtimeHandshake,
): RealtimeAuthUser {
  const token = extractRealtimeToken(handshake);
  return parseRealtimeAuthUser(jwt.verify<Record<string, unknown>>(token));
}

export function roomsForRealtimeUser(user: RealtimeAuthUser): string[] {
  return [REALTIME_ROOMS.authenticated, REALTIME_ROOMS.customer(user.sub)];
}

export function createRealtimeChange(
  input: RealtimeChangeInput,
  options: Readonly<{
    eventId?: string;
    occurredAt?: Date;
  }> = {},
): RealtimeChange {
  const entityId = input.entityId.trim();
  if (!entityId) throw new Error("entityId realtime é obrigatório");
  if (!isRealtimeTopic(input.topic))
    throw new Error("Tópico realtime inválido");

  const customerId = input.customerId?.trim();
  if (input.customerId !== undefined && !customerId) {
    throw new Error("customerId realtime inválido");
  }

  return {
    eventId: options.eventId ?? randomUUID(),
    topic: input.topic,
    entityId,
    occurredAt: (options.occurredAt ?? new Date()).toISOString(),
    ...(customerId ? { customerId } : {}),
  };
}
