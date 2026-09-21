-- Extend the existing administrative roles with the mobile customer role.
ALTER TYPE "Role" ADD VALUE 'CUSTOMER';

-- Suporte ao pagamento presencial no fluxo operacional do painel.
ALTER TYPE "PaymentMethod" ADD VALUE 'CASH';

-- CreateEnum
CREATE TYPE "GeocodingStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "StationStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ChargerPowerType" AS ENUM ('AC', 'DC');

-- CreateEnum
CREATE TYPE "ChargerAdministrativeStatus" AS ENUM ('PENDING', 'ENABLED', 'DISABLED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ChargerOperationalStatus" AS ENUM ('UNKNOWN', 'AVAILABLE', 'PREPARING', 'CHARGING', 'SUSPENDED', 'FINISHING', 'RESERVED', 'UNAVAILABLE', 'FAULTED', 'OFFLINE');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('REQUIRES_ACTION', 'AUTHORIZED', 'REJECTED', 'CANCELED', 'CAPTURED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ChargingCommandType" AS ENUM ('START_CHARGING', 'STOP_CHARGING', 'UNLOCK_CONNECTOR', 'RESET', 'SYNC_STATUS');

-- CreateEnum
CREATE TYPE "ChargingCommandStatus" AS ENUM ('PENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'TIMED_OUT', 'FAILED', 'COMPLETED');

-- AlterTable: widen the legacy client record so a customer can register before adding a vehicle.
ALTER TABLE "Client"
ADD COLUMN "phone" TEXT,
ADD COLUMN "userId" TEXT,
ALTER COLUMN "vehicle" DROP NOT NULL,
ALTER COLUMN "plate" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Charger"
ADD COLUMN "administrativeStatus" "ChargerAdministrativeStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "configuredPowerLimitKw" DECIMAL(10,2),
ADD COLUMN "firmwareVersion" TEXT,
ADD COLUMN "manufacturer" TEXT,
ADD COLUMN "model" TEXT,
ADD COLUMN "ocppIdentity" TEXT,
ADD COLUMN "ocppVersion" TEXT,
ADD COLUMN "phaseCount" INTEGER,
ADD COLUMN "powerType" "ChargerPowerType",
ADD COLUMN "provisionedAt" TIMESTAMP(3),
ADD COLUMN "publicCode" TEXT,
ADD COLUMN "serialNumber" TEXT,
ADD COLUMN "stationId" TEXT;

-- AlterTable
ALTER TABLE "ChargingSession"
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'BRL',
ADD COLUMN "lastMeterKwh" DECIMAL(14,3),
ADD COLUMN "meterEndKwh" DECIMAL(14,3),
ADD COLUMN "meterStartKwh" DECIMAL(14,3),
ADD COLUMN "paymentIntentId" TEXT,
ADD COLUMN "pricePerKwhSnapshot" DECIMAL(10,2),
ADD COLUMN "qrBindingId" TEXT,
ADD COLUMN "spendingLimit" DECIMAL(10,2),
ADD COLUMN "startIdempotencyKey" TEXT,
ADD COLUMN "stationId" TEXT,
ADD COLUMN "stopIdempotencyKey" TEXT,
ADD COLUMN "stopRequestedAt" TIMESTAMP(3),
ADD COLUMN "tariffLockedAt" TIMESTAMP(3),
ADD COLUMN "tariffLockedUntil" TIMESTAMP(3),
ADD COLUMN "transactionId" TEXT;

-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "capturedAt" TIMESTAMP(3),
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'BRL',
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "paymentIntentId" TEXT,
ADD COLUMN "provider" TEXT,
ADD COLUMN "providerPaymentId" TEXT;

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "addressNumber" TEXT NOT NULL,
    "complement" TEXT,
    "neighborhood" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'BR',
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "geocodingStatus" "GeocodingStatus" NOT NULL DEFAULT 'PENDING',
    "powerLimitKw" DECIMAL(10,2),
    "status" "StationStatus" NOT NULL DEFAULT 'PENDING',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "openingHours" TEXT,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Station_latitude_check" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
    CONSTRAINT "Station_longitude_check" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180),
    CONSTRAINT "Station_powerLimitKw_check" CHECK ("powerLimitKw" IS NULL OR "powerLimitKw" > 0)
);

-- CreateTable
CREATE TABLE "ChargerLiveStatus" (
    "chargerId" TEXT NOT NULL,
    "operationalStatus" "ChargerOperationalStatus" NOT NULL DEFAULT 'UNKNOWN',
    "currentPowerKw" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "meterTotalKwh" DECIMAL(14,3),
    "voltageV" DECIMAL(8,2),
    "currentA" DECIMAL(8,2),
    "lastErrorCode" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargerLiveStatus_pkey" PRIMARY KEY ("chargerId"),
    CONSTRAINT "ChargerLiveStatus_currentPowerKw_check" CHECK ("currentPowerKw" >= 0),
    CONSTRAINT "ChargerLiveStatus_meterTotalKwh_check" CHECK ("meterTotalKwh" IS NULL OR "meterTotalKwh" >= 0),
    CONSTRAINT "ChargerLiveStatus_voltageV_check" CHECK ("voltageV" IS NULL OR "voltageV" >= 0),
    CONSTRAINT "ChargerLiveStatus_currentA_check" CHECK ("currentA" IS NULL OR "currentA" >= 0)
);

-- CreateTable
CREATE TABLE "QrBinding" (
    "id" TEXT NOT NULL,
    "chargerId" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QrBinding_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QrBinding_version_check" CHECK ("version" > 0),
    CONSTRAINT "QrBinding_validity_check" CHECK ("expiresAt" IS NULL OR "expiresAt" > "validFrom")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RefreshToken_expiration_check" CHECK ("expiresAt" > "createdAt")
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "chargerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'REQUIRES_ACTION',
    "provider" TEXT NOT NULL DEFAULT 'SIMULATED',
    "providerIntentId" TEXT,
    "spendingLimit" DECIMAL(10,2),
    "authorizedAmount" DECIMAL(10,2),
    "capturedAmount" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "expiresAt" TIMESTAMP(3),
    "authorizedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentIntent_spendingLimit_check" CHECK ("spendingLimit" IS NULL OR "spendingLimit" > 0),
    CONSTRAINT "PaymentIntent_authorizedAmount_check" CHECK ("authorizedAmount" IS NULL OR "authorizedAmount" >= 0),
    CONSTRAINT "PaymentIntent_capturedAmount_check" CHECK ("capturedAmount" IS NULL OR "capturedAmount" >= 0)
);

-- CreateTable
CREATE TABLE "ChargingCommand" (
    "id" TEXT NOT NULL,
    "chargerId" TEXT NOT NULL,
    "sessionId" TEXT,
    "clientId" TEXT,
    "type" "ChargingCommandType" NOT NULL,
    "status" "ChargingCommandStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "ocppMessageId" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "timeoutAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargingCommand_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChargingCommand_attempts_check" CHECK ("attempts" >= 0)
);

-- CreateTable: provider event IDs are persisted before processing to make webhook handling idempotent.
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- Constraints for fields added to legacy tables.
ALTER TABLE "Charger"
ADD CONSTRAINT "Charger_phaseCount_check" CHECK ("phaseCount" IS NULL OR "phaseCount" IN (1, 3)),
ADD CONSTRAINT "Charger_configuredPowerLimitKw_check" CHECK (
  "configuredPowerLimitKw" IS NULL OR
  ("configuredPowerLimitKw" > 0 AND "configuredPowerLimitKw" <= "powerKw")
);

ALTER TABLE "ChargingSession"
ADD CONSTRAINT "ChargingSession_spendingLimit_check" CHECK ("spendingLimit" IS NULL OR "spendingLimit" > 0),
ADD CONSTRAINT "ChargingSession_meterStartKwh_check" CHECK ("meterStartKwh" IS NULL OR "meterStartKwh" >= 0),
ADD CONSTRAINT "ChargingSession_meterEndKwh_check" CHECK ("meterEndKwh" IS NULL OR "meterEndKwh" >= 0),
ADD CONSTRAINT "ChargingSession_lastMeterKwh_check" CHECK ("lastMeterKwh" IS NULL OR "lastMeterKwh" >= 0),
ADD CONSTRAINT "ChargingSession_tariffWindow_check" CHECK ("tariffLockedUntil" IS NULL OR "tariffLockedAt" IS NULL OR "tariffLockedUntil" > "tariffLockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Station_code_key" ON "Station"("code");
CREATE INDEX "Station_adminId_idx" ON "Station"("adminId");
CREATE INDEX "Station_status_idx" ON "Station"("status");
CREATE INDEX "Station_latitude_longitude_idx" ON "Station"("latitude", "longitude");

CREATE INDEX "ChargerLiveStatus_operationalStatus_idx" ON "ChargerLiveStatus"("operationalStatus");
CREATE INDEX "ChargerLiveStatus_lastSeenAt_idx" ON "ChargerLiveStatus"("lastSeenAt");

CREATE UNIQUE INDEX "QrBinding_publicToken_key" ON "QrBinding"("publicToken");
CREATE UNIQUE INDEX "QrBinding_code_key" ON "QrBinding"("code");
CREATE INDEX "QrBinding_chargerId_revokedAt_idx" ON "QrBinding"("chargerId", "revokedAt");
CREATE INDEX "QrBinding_expiresAt_idx" ON "QrBinding"("expiresAt");

CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_expiresAt_idx" ON "RefreshToken"("userId", "expiresAt");
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

CREATE INDEX "PaymentIntent_chargerId_status_idx" ON "PaymentIntent"("chargerId", "status");
CREATE INDEX "PaymentIntent_clientId_status_createdAt_idx" ON "PaymentIntent"("clientId", "status", "createdAt");
CREATE UNIQUE INDEX "PaymentIntent_clientId_idempotencyKey_key" ON "PaymentIntent"("clientId", "idempotencyKey");
CREATE UNIQUE INDEX "PaymentIntent_provider_providerIntentId_key" ON "PaymentIntent"("provider", "providerIntentId");

CREATE UNIQUE INDEX "ChargingCommand_correlationId_key" ON "ChargingCommand"("correlationId");
CREATE UNIQUE INDEX "ChargingCommand_ocppMessageId_key" ON "ChargingCommand"("ocppMessageId");
CREATE INDEX "ChargingCommand_chargerId_status_createdAt_idx" ON "ChargingCommand"("chargerId", "status", "createdAt");
CREATE INDEX "ChargingCommand_sessionId_type_idx" ON "ChargingCommand"("sessionId", "type");
CREATE UNIQUE INDEX "ChargingCommand_clientId_type_idempotencyKey_key" ON "ChargingCommand"("clientId", "type", "idempotencyKey");

CREATE UNIQUE INDEX "WebhookEvent_provider_providerEventId_key" ON "WebhookEvent"("provider", "providerEventId");
CREATE INDEX "WebhookEvent_processedAt_createdAt_idx" ON "WebhookEvent"("processedAt", "createdAt");

CREATE UNIQUE INDEX "Client_userId_key" ON "Client"("userId");
CREATE INDEX "Client_name_idx" ON "Client"("name");

CREATE UNIQUE INDEX "Charger_publicCode_key" ON "Charger"("publicCode");
CREATE UNIQUE INDEX "Charger_ocppIdentity_key" ON "Charger"("ocppIdentity");
CREATE UNIQUE INDEX "Charger_serialNumber_key" ON "Charger"("serialNumber");
CREATE INDEX "Charger_stationId_status_idx" ON "Charger"("stationId", "status");
CREATE INDEX "Charger_administrativeStatus_idx" ON "Charger"("administrativeStatus");

CREATE UNIQUE INDEX "ChargingSession_paymentIntentId_key" ON "ChargingSession"("paymentIntentId");
CREATE UNIQUE INDEX "ChargingSession_transactionId_key" ON "ChargingSession"("transactionId");
CREATE INDEX "ChargingSession_clientId_status_idx" ON "ChargingSession"("clientId", "status");
CREATE INDEX "ChargingSession_chargerId_status_idx" ON "ChargingSession"("chargerId", "status");
CREATE INDEX "ChargingSession_stationId_startTime_idx" ON "ChargingSession"("stationId", "startTime");
CREATE INDEX "ChargingSession_qrBindingId_idx" ON "ChargingSession"("qrBindingId");
CREATE UNIQUE INDEX "ChargingSession_clientId_startIdempotencyKey_key" ON "ChargingSession"("clientId", "startIdempotencyKey");
CREATE UNIQUE INDEX "ChargingSession_clientId_stopIdempotencyKey_key" ON "ChargingSession"("clientId", "stopIdempotencyKey");

-- PostgreSQL-only concurrency guards: a client and a charger can each own at most one active session.
CREATE UNIQUE INDEX "ChargingSession_one_active_per_client_idx"
ON "ChargingSession"("clientId")
WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "ChargingSession_one_active_per_charger_idx"
ON "ChargingSession"("chargerId")
WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
CREATE INDEX "Payment_paymentIntentId_idx" ON "Payment"("paymentIntentId");
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");
CREATE UNIQUE INDEX "Payment_provider_providerPaymentId_key" ON "Payment"("provider", "providerPaymentId");

-- These indexes cover legacy foreign keys and the dashboard's common filters.
CREATE INDEX "Alert_chargerId_idx" ON "Alert"("chargerId");
CREATE INDEX "Alert_status_createdAt_idx" ON "Alert"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Station" ADD CONSTRAINT "Station_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Charger" ADD CONSTRAINT "Charger_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChargerLiveStatus" ADD CONSTRAINT "ChargerLiveStatus_chargerId_fkey" FOREIGN KEY ("chargerId") REFERENCES "Charger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QrBinding" ADD CONSTRAINT "QrBinding_chargerId_fkey" FOREIGN KEY ("chargerId") REFERENCES "Charger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_chargerId_fkey" FOREIGN KEY ("chargerId") REFERENCES "Charger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChargingSession" ADD CONSTRAINT "ChargingSession_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChargingSession" ADD CONSTRAINT "ChargingSession_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChargingSession" ADD CONSTRAINT "ChargingSession_qrBindingId_fkey" FOREIGN KEY ("qrBindingId") REFERENCES "QrBinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChargingCommand" ADD CONSTRAINT "ChargingCommand_chargerId_fkey" FOREIGN KEY ("chargerId") REFERENCES "Charger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChargingCommand" ADD CONSTRAINT "ChargingCommand_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChargingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChargingCommand" ADD CONSTRAINT "ChargingCommand_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
