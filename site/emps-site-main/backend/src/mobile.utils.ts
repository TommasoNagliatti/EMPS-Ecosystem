import { createHash, randomBytes } from "node:crypto";

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}
export function createOpaqueToken(bytes = 48) {
  return randomBytes(bytes).toString("base64url");
}

export function hashOpaqueToken(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function haversineDistanceKm(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
) {
  const earthRadiusKm = 6371;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const firstLatitude = radians(first.latitude);
  const secondLatitude = radians(second.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

export function resolveIdempotencyKey(
  headerValue: string | undefined,
  bodyValue?: string,
) {
  const header = headerValue?.trim();
  const body = bodyValue?.trim();
  if (header && body && header !== body) {
    throw new Error("Chaves de idempotência divergentes");
  }
  const key = header || body;
  if (
    !key ||
    key.length < 8 ||
    key.length > 100 ||
    !/^[\x21-\x7e]+$/.test(key)
  ) {
    throw new Error("Idempotency-Key deve ter entre 8 e 100 caracteres");
  }
  return key;
}

export function elapsedSeconds(startedAt: Date, endedAt = new Date()) {
  return Math.max(
    0,
    Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
  );
}
