-- Proposed additive schema for explicit official release review. NOT authorized for application.
-- Generated from verified emps_db MySQL 8.0.46 to Prisma schema at 4ea2d5d.
-- Do not run older local-only patches against production; see 0012-official-demo-runtime-schema.md.

-- AlterTable
ALTER TABLE `alerts` ADD COLUMN `acknowledged_at` DATETIME(0) NULL,
    ADD COLUMN `gie_alert_id` VARCHAR(64) NULL,
    ADD COLUMN `gie_generation` VARCHAR(64) NULL,
    ADD COLUMN `gie_last_revision` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    ADD COLUMN `gie_payload` JSON NULL;

-- CreateTable
CREATE TABLE `gie_station_bindings` (
    `station_id` INTEGER UNSIGNED NOT NULL,
    `gie_station_id` VARCHAR(64) NOT NULL,
    `profile` VARCHAR(40) NOT NULL,
    `origin` ENUM('MEASURED', 'CALCULATED', 'EXTERNAL', 'FORECAST', 'SIMULATED', 'IMPORTED') NOT NULL DEFAULT 'SIMULATED',
    `last_generation` VARCHAR(64) NULL,
    `last_event_cursor` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_gie_station_binding_gie_id`(`gie_station_id`),
    PRIMARY KEY (`station_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lab_devices` (
    `id` VARCHAR(64) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `boot_id` VARCHAR(64) NULL,
    `last_heartbeat_at` DATETIME(3) NULL,
    `ev1` BOOLEAN NOT NULL DEFAULT false,
    `ev2` BOOLEAN NOT NULL DEFAULT false,
    `authorized_ev1` BOOLEAN NOT NULL DEFAULT false,
    `authorized_ev2` BOOLEAN NOT NULL DEFAULT false,
    `last_command_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `lab_devices_station_id_key`(`station_id`),
    UNIQUE INDEX `uq_lab_device_station`(`id`, `station_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lab_device_commands` (
    `id` CHAR(36) NOT NULL,
    `device_id` VARCHAR(64) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `requested_by` INTEGER UNSIGNED NULL,
    `request_id` CHAR(36) NULL,
    `evse` VARCHAR(3) NOT NULL,
    `enabled` BOOLEAN NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `boot_id` VARCHAR(64) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `delivered_at` DATETIME(3) NULL,
    `acked_at` DATETIME(3) NULL,
    `error` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_lab_commands_queue`(`device_id`, `status`, `created_at`),
    INDEX `idx_lab_commands_station`(`station_id`, `created_at`),
    UNIQUE INDEX `uq_lab_commands_request`(`device_id`, `request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lab_device_events` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `device_id` VARCHAR(64) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `kind` VARCHAR(40) NOT NULL,
    `details` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_lab_events_device`(`device_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lab_rfid_tags` (
    `id` CHAR(36) NOT NULL,
    `device_id` VARCHAR(64) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `uid_hash` CHAR(64) NOT NULL,
    `label` VARCHAR(32) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_lab_rfid_uid`(`device_id`, `uid_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lab_charge_intents` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `charger_id` INTEGER UNSIGNED NOT NULL,
    `actor_user_id` INTEGER UNSIGNED NULL,
    `qr_binding_id` INTEGER UNSIGNED NULL,
    `payment_method` VARCHAR(16) NOT NULL,
    `spending_limit` DECIMAL(10, 2) NOT NULL,
    `tariff_id` INTEGER UNSIGNED NOT NULL,
    `price_per_kwh` DECIMAL(10, 4) NOT NULL,
    `fixed_fee` DECIMAL(10, 2) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `card_provider` VARCHAR(24) NOT NULL DEFAULT 'sandbox',
    `card_intent_id` VARCHAR(128) NULL,
    `guest_id` CHAR(36) NULL,

    INDEX `idx_lab_intents_station_charger`(`station_id`, `charger_id`),
    INDEX `idx_lab_intents_actor_status`(`actor_user_id`, `status`),
    UNIQUE INDEX `uq_lab_intents_guest_key`(`guest_id`, `idempotency_key`),
    UNIQUE INDEX `uq_lab_intents_actor_key`(`actor_user_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lab_charge_sessions` (
    `id` CHAR(36) NOT NULL,
    `intent_id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `charger_id` INTEGER UNSIGNED NOT NULL,
    `actor_user_id` INTEGER UNSIGNED NULL,
    `qr_binding_id` INTEGER UNSIGNED NULL,
    `evse` VARCHAR(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `start_key` VARCHAR(100) NOT NULL,
    `stop_key` VARCHAR(100) NULL,
    `meter_source` VARCHAR(24) NOT NULL,
    `simulated_power_kw` DECIMAL(10, 3) NOT NULL,
    `energy_kwh` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    `total_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NOT NULL,
    `auto_stop_at` DATETIME(3) NULL,
    `ended_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_lab_session_intent`(`intent_id`),
    INDEX `idx_lab_session_charger_status`(`charger_id`, `status`),
    INDEX `idx_lab_session_station_requested`(`station_id`, `requested_at`),
    INDEX `idx_lab_session_auto_stop`(`status`, `auto_stop_at`),
    UNIQUE INDEX `uq_lab_session_actor_start`(`actor_user_id`, `start_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lab_charge_payments` (
    `id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `provider` VARCHAR(24) NOT NULL,
    `method` VARCHAR(16) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `paid_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_lab_payment_session`(`session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lab_charge_receipts` (
    `id` CHAR(36) NOT NULL,
    `intent_id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `charger_id` INTEGER UNSIGNED NOT NULL,
    `actor_user_id` INTEGER UNSIGNED NOT NULL,
    `method` VARCHAR(16) NOT NULL,
    `amount_received` DECIMAL(10, 2) NOT NULL,
    `confirmation_source` VARCHAR(24) NOT NULL,
    `confirmed_at` DATETIME(3) NOT NULL,
    `consumed_amount` DECIMAL(10, 2) NULL,
    `unused_balance` DECIMAL(10, 2) NULL,
    `closed_at` DATETIME(3) NULL,
    `return_status` VARCHAR(16) NOT NULL DEFAULT 'NONE',

    UNIQUE INDEX `uq_lab_receipt_intent`(`intent_id`),
    INDEX `idx_lab_receipt_station_confirmed`(`station_id`, `confirmed_at`),
    INDEX `idx_lab_receipt_actor_confirmed`(`actor_user_id`, `confirmed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `demo_import_batches` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `gie_profile` VARCHAR(40) NOT NULL,
    `gie_station_id` VARCHAR(64) NULL,
    `dataset_key` VARCHAR(100) NOT NULL,
    `dataset_sha256` CHAR(64) NOT NULL,
    `source_revision` VARCHAR(64) NULL,
    `scenario_version` VARCHAR(40) NOT NULL,
    `seed` INTEGER UNSIGNED NOT NULL,
    `status` ENUM('STAGED', 'ACTIVE', 'SUPERSEDED') NOT NULL DEFAULT 'STAGED',
    `origin` ENUM('SIMULATED') NOT NULL DEFAULT 'SIMULATED',
    `source_started_at` DATETIME(0) NULL,
    `source_ended_at` DATETIME(0) NULL,
    `tariff_config` JSON NULL,
    `source_manifest` JSON NULL,
    `completed_at` DATETIME(0) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_demo_batches_station_status`(`station_id`, `status`, `created_at`),
    UNIQUE INDEX `uq_demo_batches_id_station`(`id`, `station_id`),
    UNIQUE INDEX `uq_demo_batches_source_scenario`(`station_id`, `dataset_key`, `dataset_sha256`, `scenario_version`, `seed`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `demo_charging_sessions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `batch_id` CHAR(36) NOT NULL,
    `source_session_id` VARCHAR(128) NOT NULL,
    `source_charger_id` VARCHAR(100) NULL,
    `charger_id` INTEGER UNSIGNED NULL,
    `source_status` VARCHAR(40) NULL,
    `status` ENUM('COMPLETED', 'UNSERVED') NOT NULL,
    `billable` BOOLEAN NOT NULL DEFAULT false,
    `started_at` DATETIME(0) NOT NULL,
    `ended_at` DATETIME(0) NULL,
    `duration_seconds` INTEGER UNSIGNED NULL,
    `requested_energy_kwh` DECIMAL(18, 10) NULL,
    `delivered_energy_kwh` DECIMAL(18, 10) NOT NULL,
    `tariff_per_kwh` DECIMAL(10, 4) NOT NULL,
    `fixed_fee` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `energy_cost_per_kwh` DECIMAL(10, 4) NOT NULL DEFAULT 0,
    `cost_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'BRL',
    `origin` ENUM('SIMULATED') NOT NULL DEFAULT 'SIMULATED',
    `source_payload` JSON NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_demo_sessions_station_time`(`station_id`, `started_at`),
    INDEX `idx_demo_sessions_batch_time`(`batch_id`, `started_at`),
    INDEX `idx_demo_sessions_batch_charger_time`(`batch_id`, `source_charger_id`, `started_at`),
    INDEX `idx_demo_sessions_charger`(`charger_id`),
    UNIQUE INDEX `uq_demo_sessions_source`(`batch_id`, `source_session_id`),
    UNIQUE INDEX `uq_demo_sessions_id_batch_station`(`id`, `batch_id`, `station_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `demo_payments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `batch_id` CHAR(36) NOT NULL,
    `session_id` BIGINT UNSIGNED NOT NULL,
    `source_payment_id` VARCHAR(128) NOT NULL,
    `channel` ENUM('APP_EMPS', 'WEB_CHARGE', 'CAIXA') NOT NULL,
    `method` ENUM('PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'BRL',
    `status` ENUM('SIMULATED_SETTLED') NOT NULL DEFAULT 'SIMULATED_SETTLED',
    `origin` ENUM('SIMULATED') NOT NULL DEFAULT 'SIMULATED',
    `settled_at` DATETIME(0) NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_demo_payments_session`(`session_id`),
    INDEX `idx_demo_payments_station_time`(`station_id`, `settled_at`),
    INDEX `idx_demo_payments_batch_time`(`batch_id`, `settled_at`),
    INDEX `idx_demo_payments_batch_channel_method`(`batch_id`, `channel`, `method`),
    UNIQUE INDEX `uq_demo_payments_source`(`batch_id`, `source_payment_id`),
    UNIQUE INDEX `uq_demo_payments_session_batch_station`(`session_id`, `batch_id`, `station_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `demo_session_scenarios` (
    `session_id` BIGINT UNSIGNED NOT NULL,
    `scenario_version` VARCHAR(40) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `batch_id` CHAR(36) NOT NULL,
    `usage_kind` ENUM('OWNER', 'VISITOR', 'UNSERVED') NOT NULL,
    `credential_kind` ENUM('HYPOTHETICAL_RFID', 'NONE') NOT NULL,
    `driver_key` VARCHAR(64) NOT NULL,
    `driver_name` VARCHAR(100) NOT NULL,
    `tariff_per_kwh` DECIMAL(10, 4) NOT NULL,
    `energy_cost_per_kwh` DECIMAL(10, 4) NOT NULL,
    `cost_amount` DECIMAL(12, 2) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `channel` ENUM('APP_EMPS', 'WEB_CHARGE', 'CAIXA') NULL,
    `method` ENUM('PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH') NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'BRL',
    `origin` ENUM('SIMULATED') NOT NULL DEFAULT 'SIMULATED',
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_demo_scenario_batch_version`(`batch_id`, `station_id`, `scenario_version`),
    PRIMARY KEY (`session_id`, `scenario_version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `demo_energy_readings` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `batch_id` CHAR(36) NOT NULL,
    `source_reading_id` VARCHAR(128) NOT NULL,
    `interval_start` DATETIME(0) NOT NULL,
    `interval_end` DATETIME(0) NOT NULL,
    `building_power_kw` DECIMAL(18, 10) NULL,
    `solar_power_kw` DECIMAL(18, 10) NULL,
    `grid_power_kw` DECIMAL(18, 10) NULL,
    `ev_requested_power_kw` DECIMAL(18, 10) NULL,
    `ev_delivered_power_kw` DECIMAL(18, 10) NULL,
    `building_energy_kwh` DECIMAL(18, 10) NULL,
    `solar_energy_kwh` DECIMAL(18, 10) NULL,
    `grid_energy_kwh` DECIMAL(18, 10) NULL,
    `ev_requested_energy_kwh` DECIMAL(18, 10) NULL,
    `ev_delivered_energy_kwh` DECIMAL(18, 10) NULL,
    `battery_states` JSON NULL,
    `source_payload` JSON NULL,
    `origin` ENUM('SIMULATED') NOT NULL DEFAULT 'SIMULATED',
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_demo_readings_station_time`(`station_id`, `interval_start`),
    UNIQUE INDEX `uq_demo_readings_source`(`batch_id`, `source_reading_id`),
    UNIQUE INDEX `uq_demo_readings_interval`(`batch_id`, `interval_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `uq_alerts_gie_alert_id` ON `alerts`(`gie_alert_id`);

-- AddForeignKey
ALTER TABLE `gie_station_bindings` ADD CONSTRAINT `gie_station_bindings_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lab_devices` ADD CONSTRAINT `lab_devices_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lab_device_commands` ADD CONSTRAINT `lab_device_commands_device_id_station_id_fkey` FOREIGN KEY (`device_id`, `station_id`) REFERENCES `lab_devices`(`id`, `station_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lab_device_events` ADD CONSTRAINT `lab_device_events_device_id_station_id_fkey` FOREIGN KEY (`device_id`, `station_id`) REFERENCES `lab_devices`(`id`, `station_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lab_rfid_tags` ADD CONSTRAINT `lab_rfid_tags_device_id_station_id_fkey` FOREIGN KEY (`device_id`, `station_id`) REFERENCES `lab_devices`(`id`, `station_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demo_import_batches` ADD CONSTRAINT `fk_demo_batches_station` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demo_charging_sessions` ADD CONSTRAINT `fk_demo_sessions_station` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demo_charging_sessions` ADD CONSTRAINT `fk_demo_sessions_batch_station` FOREIGN KEY (`batch_id`, `station_id`) REFERENCES `demo_import_batches`(`id`, `station_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demo_charging_sessions` ADD CONSTRAINT `fk_demo_sessions_charger` FOREIGN KEY (`charger_id`) REFERENCES `chargers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demo_payments` ADD CONSTRAINT `fk_demo_payments_station` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demo_payments` ADD CONSTRAINT `fk_demo_payments_batch_station` FOREIGN KEY (`batch_id`, `station_id`) REFERENCES `demo_import_batches`(`id`, `station_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demo_payments` ADD CONSTRAINT `fk_demo_payments_session_batch_station` FOREIGN KEY (`session_id`, `batch_id`, `station_id`) REFERENCES `demo_charging_sessions`(`id`, `batch_id`, `station_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demo_session_scenarios` ADD CONSTRAINT `fk_demo_scenario_session` FOREIGN KEY (`session_id`, `batch_id`, `station_id`) REFERENCES `demo_charging_sessions`(`id`, `batch_id`, `station_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demo_energy_readings` ADD CONSTRAINT `fk_demo_readings_station` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demo_energy_readings` ADD CONSTRAINT `fk_demo_readings_batch_station` FOREIGN KEY (`batch_id`, `station_id`) REFERENCES `demo_import_batches`(`id`, `station_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve the extra ledger CHECKs verified on the preview. Prisma diff does not represent CHECKs.
ALTER TABLE `lab_device_commands`
 ADD CONSTRAINT `chk_lab_command_evse` CHECK (`evse` IN ('EV1','EV2')),
 ADD CONSTRAINT `chk_lab_command_status` CHECK (`status` IN ('PENDING','DELIVERED','ACKED','EXPIRED','FAILED'));
ALTER TABLE `lab_charge_intents`
 ADD CONSTRAINT `chk_lab_card_provider` CHECK (`card_provider`='sandbox' OR (`card_provider`='stripe_test' AND `payment_method`='card')),
 ADD CONSTRAINT `chk_lab_intent_amounts` CHECK (`spending_limit`>=0 AND `price_per_kwh`>=0 AND `fixed_fee`>=0),
 ADD CONSTRAINT `chk_lab_intent_method` CHECK (`payment_method` IN ('pix','card','wallet','cash','pos')),
 ADD CONSTRAINT `chk_lab_intent_status` CHECK (`status` IN ('AUTHORIZED','CANCELED','EXPIRED')),
 ADD CONSTRAINT `chk_lab_intent_subject` CHECK ((`actor_user_id` IS NOT NULL AND `guest_id` IS NULL) OR (`actor_user_id` IS NULL AND `guest_id` IS NOT NULL AND `station_id`=13));
ALTER TABLE `lab_charge_sessions`
 ADD CONSTRAINT `chk_lab_session_amounts` CHECK (`simulated_power_kw`>=0 AND `energy_kwh`>=0 AND `total_amount`>=0),
 ADD CONSTRAINT `chk_lab_session_evse` CHECK (`evse` IN ('EV1','EV2') OR (`evse`='EV3' AND `station_id`=13 AND `charger_id`=51)),
 ADD CONSTRAINT `chk_lab_session_meter` CHECK (`meter_source`='SANDBOX_ESTIMATE'),
 ADD CONSTRAINT `chk_lab_session_status` CHECK (`status` IN ('STARTING','CHARGING','FINISHING','FINISHED','FAILED'));
ALTER TABLE `lab_charge_payments`
 ADD CONSTRAINT `chk_lab_payment_amount` CHECK (`amount`>=0),
 ADD CONSTRAINT `chk_lab_payment_method` CHECK (`method` IN ('pix','card','wallet')),
 ADD CONSTRAINT `chk_lab_payment_provider` CHECK (`provider`='sandbox' OR (`provider`='stripe_test' AND `method`='card')),
 ADD CONSTRAINT `chk_lab_payment_status` CHECK (`status`='APPROVED');
ALTER TABLE `lab_charge_receipts`
 ADD CONSTRAINT `chk_lab_receipt_amount` CHECK (`amount_received`>0),
 ADD CONSTRAINT `chk_lab_receipt_method` CHECK (`method` IN ('cash','pos')),
 ADD CONSTRAINT `chk_lab_receipt_return` CHECK (`return_status` IN ('NONE','PENDING')),
 ADD CONSTRAINT `chk_lab_receipt_source` CHECK (`confirmation_source`='OPERATOR_CONFIRMED'),
 ADD CONSTRAINT `chk_lab_receipt_close` CHECK (
  (`closed_at` IS NULL AND `consumed_amount` IS NULL AND `unused_balance` IS NULL AND `return_status`='NONE') OR
  (`closed_at` IS NOT NULL AND `consumed_amount`>=0 AND `unused_balance`>=0 AND `consumed_amount`+`unused_balance`=`amount_received` AND
   ((`unused_balance`=0 AND `return_status`='NONE') OR (`unused_balance`>0 AND `return_status`='PENDING'))));
ALTER TABLE `demo_session_scenarios`
 ADD CONSTRAINT `chk_demo_scenario_usage` CHECK (
  (`usage_kind`='OWNER' AND `credential_kind`='HYPOTHETICAL_RFID' AND `amount`=0 AND `channel` IS NULL AND `method` IS NULL) OR
  (`usage_kind`='VISITOR' AND `credential_kind`='NONE' AND `channel` IS NOT NULL AND `method` IS NOT NULL) OR
  (`usage_kind`='UNSERVED' AND `credential_kind`='NONE' AND `amount`=0 AND `cost_amount`=0 AND `channel` IS NULL AND `method` IS NULL));
