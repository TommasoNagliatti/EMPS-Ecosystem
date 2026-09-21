import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpaqueToken,
  elapsedSeconds,
  hashOpaqueToken,
  haversineDistanceKm,
  normalizeEmail,
  resolveIdempotencyKey,
} from "../src/mobile.utils";

test("normaliza o e-mail sem alterar seu conteúdo interno", () => {
  assert.equal(normalizeEmail("  Motorista@EMPS.COM "), "motorista@emps.com");
});
test("gera refresh token opaco e persiste somente hash determinístico", () => {
  const token = createOpaqueToken();
  assert.ok(token.length >= 64);
  assert.equal(hashOpaqueToken(token), hashOpaqueToken(token));
  assert.notEqual(hashOpaqueToken(token), token);
});

test("calcula distância geográfica entre pontos próximos", () => {
  const distance = haversineDistanceKm(
    { latitude: -23.5614, longitude: -46.6559 },
    { latitude: -23.5505, longitude: -46.6333 },
  );
  assert.ok(distance > 2 && distance < 3);
});

test("exige uma chave de idempotência consistente", () => {
  assert.equal(resolveIdempotencyKey("request-123"), "request-123");
  assert.throws(
    () => resolveIdempotencyKey("request-123", "request-456"),
    /divergentes/,
  );
  assert.throws(() => resolveIdempotencyKey("short"), /entre 8 e 100/);
});

test("calcula duração sem produzir valor negativo", () => {
  assert.equal(
    elapsedSeconds(
      new Date("2026-08-28T12:00:00Z"),
      new Date("2026-08-28T12:01:30Z"),
    ),
    90,
  );
  assert.equal(
    elapsedSeconds(
      new Date("2026-08-28T12:02:00Z"),
      new Date("2026-08-28T12:01:30Z"),
    ),
    0,
  );
});
