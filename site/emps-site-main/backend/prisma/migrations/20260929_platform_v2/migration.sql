-- DropForeignKey
ALTER TABLE `payment_intents` DROP FOREIGN KEY `fk_payment_intents_customer`;

-- AlterTable
ALTER TABLE `charger_readings` ADD COLUMN `data_provenance` ENUM('MEASURED', 'CALCULATED', 'EXTERNAL', 'FORECAST', 'SIMULATED', 'IMPORTED') NULL;

-- AlterTable
ALTER TABLE `charging_sessions` ADD COLUMN `guest_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
    ADD COLUMN `rfid_credential_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
    ADD COLUMN `unit_reference` VARCHAR(100) NULL;

-- AlterTable
ALTER TABLE `payment_intents` ADD COLUMN `guest_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
    MODIFY `customer_id` INTEGER UNSIGNED NULL;

-- AlterTable
ALTER TABLE `station_energy_readings` ADD COLUMN `data_provenance` ENUM('MEASURED', 'CALCULATED', 'EXTERNAL', 'FORECAST', 'SIMULATED', 'IMPORTED') NULL,
    ADD COLUMN `import_batch_id` CHAR(36) NULL,
    ADD COLUMN `source_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;

-- AlterTable
ALTER TABLE `station_staff` MODIFY `staff_role` ENUM('owner', 'viewer', 'collector', 'manager', 'operator') NOT NULL DEFAULT 'operator';

-- AlterTable
ALTER TABLE `stations` ADD COLUMN `availability` JSON NULL,
    ADD COLUMN `description` VARCHAR(500) NULL,
    ADD COLUMN `gie_provisioning` JSON NULL,
    ADD COLUMN `guest_allowed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `reservation_policy` JSON NULL,
    ADD COLUMN `reservation_rate_per_hour` DECIMAL(10, 2) NULL,
    ADD COLUMN `review_state` ENUM('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED') NULL,
    ADD COLUMN `technical_review_required` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `venue_type` VARCHAR(50) NULL,
    ADD COLUMN `visibility` ENUM('PUBLIC', 'PRIVATE') NOT NULL DEFAULT 'PUBLIC';

-- AlterTable
ALTER TABLE `users` ADD COLUMN `platform_reviewer` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `presentation_tools` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `terms_accepted_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `station_batteries` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `capacity_kwh` DECIMAL(12, 3) NOT NULL,
    `max_charge_kw` DECIMAL(10, 3) NOT NULL,
    `max_discharge_kw` DECIMAL(10, 3) NOT NULL,
    `soc_percent` DECIMAL(5, 2) NULL,
    `min_soc_percent` DECIMAL(5, 2) NOT NULL DEFAULT 10,
    `max_soc_percent` DECIMAL(5, 2) NOT NULL DEFAULT 95,
    `efficiency` DECIMAL(5, 4) NOT NULL DEFAULT 0.95,
    `manufacturer` VARCHAR(100) NULL,
    `model` VARCHAR(100) NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'CONFIGURED',
    `integration_ref` VARCHAR(150) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `station_batteries_station_id_idx`(`station_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `station_solar_assets` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `installed_kwp` DECIMAL(12, 3) NOT NULL,
    `ac_power_kw` DECIMAL(10, 3) NULL,
    `inverter` VARCHAR(100) NULL,
    `manufacturer` VARCHAR(100) NULL,
    `model` VARCHAR(100) NULL,
    `integration_ref` VARCHAR(150) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `station_solar_assets_station_id_idx`(`station_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `station_photos` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `storage_key` VARCHAR(150) NOT NULL,
    `mime_type` VARCHAR(30) NOT NULL,
    `size_bytes` INTEGER UNSIGNED NOT NULL,
    `position` TINYINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `station_photos_storage_key_key`(`storage_key`),
    UNIQUE INDEX `station_photos_station_id_position_key`(`station_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `station_review_requests` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `submitted_by` INTEGER UNSIGNED NOT NULL,
    `reviewed_by` INTEGER UNSIGNED NULL,
    `state` ENUM('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED') NOT NULL DEFAULT 'PENDING_REVIEW',
    `proposed_config` JSON NOT NULL,
    `reason` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_at` DATETIME(3) NULL,

    INDEX `station_review_requests_station_id_state_idx`(`station_id`, `state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `station_invites` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `role` ENUM('owner', 'viewer', 'collector', 'manager', 'operator') NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `invited_by` INTEGER UNSIGNED NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `accepted_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `station_invites_token_hash_key`(`token_hash`),
    INDEX `station_invites_station_id_email_idx`(`station_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `station_audit_events` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `actor_id` INTEGER UNSIGNED NOT NULL,
    `action` VARCHAR(80) NOT NULL,
    `details` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `station_audit_events_station_id_created_at_idx`(`station_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guest_charge_identities` (
    `id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `charger_id` INTEGER UNSIGNED NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `guest_charge_identities_token_hash_key`(`token_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `charger_reservations` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `charger_id` INTEGER UNSIGNED NOT NULL,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `session_id` BIGINT UNSIGNED NULL,
    `start_at` DATETIME(3) NOT NULL,
    `end_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NULL,
    `status` ENUM('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'USED', 'NO_SHOW') NOT NULL DEFAULT 'PENDING_PAYMENT',
    `fee` DECIMAL(10, 2) NOT NULL,
    `policy_snapshot` JSON NOT NULL,
    `provider` VARCHAR(80) NULL,
    `provider_payment_id` VARCHAR(150) NULL,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `charger_reservations_session_id_key`(`session_id`),
    INDEX `charger_reservations_charger_id_start_at_end_at_status_idx`(`charger_id`, `start_at`, `end_at`, `status`),
    UNIQUE INDEX `charger_reservations_user_id_idempotency_key_key`(`user_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rfid_credentials` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `user_id` INTEGER UNSIGNED NULL,
    `uid_hash` CHAR(64) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `unit_reference` VARCHAR(100) NULL,
    `vehicle_reference` VARCHAR(100) NULL,
    `organization` VARCHAR(100) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `rfid_credentials_station_id_uid_hash_key`(`station_id`, `uid_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `telemetry_sources` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `kind` VARCHAR(30) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `verified_physical` BOOLEAN NOT NULL DEFAULT false,
    `verified_by` INTEGER UNSIGNED NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `telemetry_sources_token_hash_key`(`token_hash`),
    INDEX `telemetry_sources_station_id_idx`(`station_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `uq_payment_intents_guest_key` ON `payment_intents`(`guest_id`, `idempotency_key`);

-- AddForeignKey
ALTER TABLE `charging_sessions` ADD CONSTRAINT `charging_sessions_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `guest_charge_identities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `charging_sessions` ADD CONSTRAINT `charging_sessions_rfid_credential_id_fkey` FOREIGN KEY (`rfid_credential_id`) REFERENCES `rfid_credentials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_intents` ADD CONSTRAINT `payment_intents_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `guest_charge_identities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_intents` ADD CONSTRAINT `fk_payment_intents_customer` FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_energy_readings` ADD CONSTRAINT `station_energy_readings_source_id_fkey` FOREIGN KEY (`source_id`) REFERENCES `telemetry_sources`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_batteries` ADD CONSTRAINT `station_batteries_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_solar_assets` ADD CONSTRAINT `station_solar_assets_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_photos` ADD CONSTRAINT `station_photos_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_review_requests` ADD CONSTRAINT `station_review_requests_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_invites` ADD CONSTRAINT `station_invites_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_audit_events` ADD CONSTRAINT `station_audit_events_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `charger_reservations` ADD CONSTRAINT `charger_reservations_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `charger_reservations` ADD CONSTRAINT `charger_reservations_charger_id_fkey` FOREIGN KEY (`charger_id`) REFERENCES `chargers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `charger_reservations` ADD CONSTRAINT `charger_reservations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `charger_reservations` ADD CONSTRAINT `charger_reservations_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `charging_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rfid_credentials` ADD CONSTRAINT `rfid_credentials_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rfid_credentials` ADD CONSTRAINT `rfid_credentials_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `telemetry_sources` ADD CONSTRAINT `telemetry_sources_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domain constraints are additive; no historical rows are reclassified.
ALTER TABLE station_batteries ADD CONSTRAINT v2_battery_limits CHECK (capacity_kwh > 0 AND max_charge_kw > 0 AND max_discharge_kw > 0 AND min_soc_percent >= 0 AND max_soc_percent <= 100 AND min_soc_percent < max_soc_percent AND efficiency > 0 AND efficiency <= 1 AND (soc_percent IS NULL OR soc_percent BETWEEN 0 AND 100));
ALTER TABLE station_solar_assets ADD CONSTRAINT v2_solar_limits CHECK (installed_kwp > 0 AND (ac_power_kw IS NULL OR ac_power_kw > 0));
ALTER TABLE station_photos ADD CONSTRAINT v2_photo_position CHECK (position BETWEEN 0 AND 4);
ALTER TABLE charger_reservations ADD CONSTRAINT v2_reservation_window CHECK (end_at > start_at AND fee >= 0);
ALTER TABLE guest_charge_identities ADD CONSTRAINT v2_guest_charger FOREIGN KEY (charger_id) REFERENCES chargers(id) ON DELETE RESTRICT ON UPDATE CASCADE;
