-- Charger onboarding is intentionally separated from the operational Charger table.
-- A physical unit only becomes visible to drivers after connection verification and EMPS approval.
CREATE TYPE "ChargerProvisioningStatus" AS ENUM (
  'PENDING_CONNECTION',
  'PENDING_APPROVAL',
  'ENABLED',
  'REJECTED',
  'CANCELED',
  'EXPIRED'
);

CREATE TABLE "ChargerProvisioning" (
  "id" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "chargerId" TEXT,
  "status" "ChargerProvisioningStatus" NOT NULL DEFAULT 'PENDING_CONNECTION',
  "name" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "connectorType" TEXT NOT NULL,
  "powerType" "ChargerPowerType" NOT NULL,
  "phaseCount" INTEGER,
  "powerKw" DECIMAL(10,2) NOT NULL,
  "pricePerKwh" DECIMAL(10,2) NOT NULL,
  "manufacturer" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "serialNumber" TEXT NOT NULL,
  "ocppIdentity" TEXT NOT NULL,
  "ocppVersion" TEXT NOT NULL DEFAULT '1.6J',
  "firmwareVersion" TEXT,
  "activationTokenHash" TEXT NOT NULL,
  "activationTokenLastFour" TEXT NOT NULL,
  "activationExpiresAt" TIMESTAMP(3) NOT NULL,
  "connectionVerifiedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ChargerProvisioning_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChargerProvisioning_phaseCount_check" CHECK ("phaseCount" IS NULL OR "phaseCount" IN (1, 3)),
  CONSTRAINT "ChargerProvisioning_powerKw_check" CHECK ("powerKw" > 0),
  CONSTRAINT "ChargerProvisioning_pricePerKwh_check" CHECK ("pricePerKwh" > 0),
  CONSTRAINT "ChargerProvisioning_expiration_check" CHECK ("activationExpiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "ChargerProvisioning_chargerId_key" ON "ChargerProvisioning"("chargerId");
CREATE UNIQUE INDEX "ChargerProvisioning_activationTokenHash_key" ON "ChargerProvisioning"("activationTokenHash");
CREATE INDEX "ChargerProvisioning_stationId_status_createdAt_idx" ON "ChargerProvisioning"("stationId", "status", "createdAt");
CREATE INDEX "ChargerProvisioning_requestedById_status_idx" ON "ChargerProvisioning"("requestedById", "status");
CREATE INDEX "ChargerProvisioning_reviewedById_idx" ON "ChargerProvisioning"("reviewedById");
CREATE INDEX "ChargerProvisioning_status_activationExpiresAt_idx" ON "ChargerProvisioning"("status", "activationExpiresAt");
CREATE INDEX "ChargerProvisioning_serialNumber_idx" ON "ChargerProvisioning"("serialNumber");
CREATE INDEX "ChargerProvisioning_ocppIdentity_idx" ON "ChargerProvisioning"("ocppIdentity");

-- Terminal requests remain immutable audit records, while an active physical unit
-- cannot be registered twice even under concurrent requests.
CREATE UNIQUE INDEX "ChargerProvisioning_active_serialNumber_key"
ON "ChargerProvisioning"("serialNumber")
WHERE "status" IN ('PENDING_CONNECTION', 'PENDING_APPROVAL', 'ENABLED');

CREATE UNIQUE INDEX "ChargerProvisioning_active_ocppIdentity_key"
ON "ChargerProvisioning"("ocppIdentity")
WHERE "status" IN ('PENDING_CONNECTION', 'PENDING_APPROVAL', 'ENABLED');

ALTER TABLE "ChargerProvisioning"
  ADD CONSTRAINT "ChargerProvisioning_stationId_fkey"
  FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ChargerProvisioning"
  ADD CONSTRAINT "ChargerProvisioning_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ChargerProvisioning"
  ADD CONSTRAINT "ChargerProvisioning_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ChargerProvisioning"
  ADD CONSTRAINT "ChargerProvisioning_chargerId_fkey"
  FOREIGN KEY ("chargerId") REFERENCES "Charger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
