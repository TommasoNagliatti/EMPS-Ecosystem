import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma, SessionStatus } from "@prisma/client";

export function intId(value: string | number): number {
  if (!/^[1-9]\d*$/.test(String(value)) || BigInt(value) > 4294967295n)
    throw new BadRequestException("ID inválido");
  return Number(value);
}
export function bigId(value: string | bigint): bigint {
  if (
    !/^[1-9]\d*$/.test(String(value)) ||
    BigInt(value) > 18446744073709551615n
  )
    throw new BadRequestException("ID inválido");
  return BigInt(value);
}
export const activeSessionStatuses: SessionStatus[] = [
  "AWAITING_CABLE",
  "PAYMENT_AUTHORIZING",
  "PAYMENT_AUTHORIZED",
  "START_REQUESTED",
  "STARTING",
  "ACTIVE",
  "STOP_REQUESTED",
  "STOPPING",
  "FINALIZING_METER",
  "PAYMENT_CAPTURING",
];
export function mobileSessionStatus(status: SessionStatus) {
  if (["FINISHED", "CANCELED", "INTERRUPTED", "START_FAILED", "CHARGER_TIMEOUT"].includes(status)) return "completed";
  if (["WAITING_PAYMENT", "PAYMENT_CAPTURING"].includes(status)) return "payment_pending";
  if (["STOP_REQUESTED", "STOPPING", "FINALIZING_METER"].includes(status)) return "stopping";
  return status === "ACTIVE" ? "charging" : "starting";
}
export const chargerInclude = {
  liveStatus: true,
  tariffs: true,
  station: { include: { tariffs: true, amenities: true } },
} as const;
export type ChargerRecord = Prisma.ChargerGetPayload<{
  include: typeof chargerInclude;
}>;
export function currentTariff(charger: ChargerRecord, now = new Date()) {
  const valid = (t: ChargerRecord["tariffs"][number]) =>
    t.status === "ACTIVE" &&
    t.validFrom <= now &&
    (!t.validUntil || t.validUntil > now);
  const latest = (items: ChargerRecord["tariffs"]) =>
    items
      .filter(valid)
      .sort(
        (a, b) => b.validFrom.getTime() - a.validFrom.getTime() || b.id - a.id,
      )[0];
  const tariff =
    latest(charger.tariffs) ??
    latest(charger.station.tariffs.filter((t) => t.chargerId === null));
  if (!tariff)
    throw new ConflictException("Carregador sem tarifa ativa vigente");
  return tariff;
}
export enum ChargerStatus {
  AVAILABLE = "AVAILABLE",
  IN_USE = "IN_USE",
  OFFLINE = "OFFLINE",
  MAINTENANCE = "MAINTENANCE",
  CRITICAL_ERROR = "CRITICAL_ERROR",
}
export function chargerStatus(charger: {
  administrativeStatus: string;
  liveStatus?: { operationalStatus: string } | null;
}): ChargerStatus {
  if (charger.administrativeStatus === "MAINTENANCE")
    return ChargerStatus.MAINTENANCE;
  if (charger.administrativeStatus !== "ENABLED") return ChargerStatus.OFFLINE;
  const state = charger.liveStatus?.operationalStatus;
  if (state === "AVAILABLE") return ChargerStatus.AVAILABLE;
  if (state === "FAULTED") return ChargerStatus.CRITICAL_ERROR;
  if (
    ["PREPARING", "CHARGING", "SUSPENDED", "FINISHING", "RESERVED"].includes(
      state ?? "",
    )
  )
    return ChargerStatus.IN_USE;
  return ChargerStatus.OFFLINE;
}
export function presentCharger<T extends ChargerRecord>(charger: T) {
  let pricePerKwh: Prisma.Decimal | null = null;
  try {
    pricePerKwh = currentTariff(charger).basePricePerKwh;
  } catch (error) {
    if (!(error instanceof ConflictException)) throw error;
  }
  return {
    ...charger,
    status: chargerStatus(charger),
    pricePerKwh,
    temperature: charger.liveStatus?.temperatureC ?? null,
  };
}
export const clientSelect = {
  id: true,
  name: true,
  phone: true,
  createdAt: true,
  updatedAt: true,
  vehicles: true,
} as const;
export function presentClient<
  T extends Prisma.UserGetPayload<{ select: typeof clientSelect }>,
>(user: T) {
  const vehicle =
    user.vehicles.find((v) => v.isPrimary && v.status === "ACTIVE") ??
    user.vehicles.find((v) => v.status === "ACTIVE");
  return {
    id: user.id,
    userId: user.id,
    name: user.name,
    phone: user.phone,
    vehicle: vehicle?.model ?? null,
    plate: vehicle?.licensePlate ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
export const sessionInclude = {
  reservation: true,
  client: { select: clientSelect },
  charger: { include: chargerInclude },
  payments: { orderBy: { createdAt: "desc" as const } },
  paymentIntent: true,
  commands: { orderBy: { createdAt: "asc" as const } },
} as const;
export type SessionRecord = Prisma.ChargingSessionGetPayload<{
  include: typeof sessionInclude;
}>;
export function presentAdminSession(session: SessionRecord) {
  return {
    ...session,
    client: session.client
      ? presentClient(session.client)
      : {
          id: null,
          name: "Cliente avulso (caixa)",
          vehicle: null,
          plate: null,
        },
    charger: presentCharger(session.charger),
    payment: session.payments[0] ?? null,
    stationId: session.charger.stationId,
    startTime: session.startTime ?? session.requestedAt,
    durationMinutes:
      session.durationSeconds === null
        ? null
        : Math.ceil(session.durationSeconds / 60),
  };
}
export function stationScope(user: {
  sub: string;
  role: string;
  selectedStationId?: number;
  stationPermission?: 'READ' | 'OPERATE' | 'MANAGE';
}): Prisma.StationWhereInput {
  const roles = user.stationPermission === 'MANAGE' ? ['OWNER','MANAGER'] : user.stationPermission === 'OPERATE' ? ['OWNER','MANAGER','OPERATOR','COLLECTOR'] : ['OWNER','MANAGER','OPERATOR','COLLECTOR','VIEWER'];
  return { ...(user.selectedStationId ? {id:user.selectedStationId}:{}), OR: [
    {adminId:intId(user.sub)},
    {staff:{some:{userId:intId(user.sub),staffRole:{in:roles as Prisma.EnumStaffRoleFilter['in']}}}},
  ]};
}
// JSON IDs stay strings for existing clients, including unsigned BIGINT values.
export function apiJson(value: unknown, key = ""): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && (key === "id" || key.endsWith("Id")))
    return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (Array.isArray(value))
    return value.map((v) => apiJson(v, key.endsWith("Ids") ? "id" : ""));
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !["passwordHash", "tokenHash", "uidHash"].includes(k))
        .map(([k, v]) => [k, apiJson(v, k)]),
    );
  return value;
}
