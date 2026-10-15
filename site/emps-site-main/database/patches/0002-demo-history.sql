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
ALTER TABLE `demo_energy_readings` ADD CONSTRAINT `fk_demo_readings_station` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demo_energy_readings` ADD CONSTRAINT `fk_demo_readings_batch_station` FOREIGN KEY (`batch_id`, `station_id`) REFERENCES `demo_import_batches`(`id`, `station_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
