-- Additive integration state. Apply only after backup and release approval.
CREATE TABLE `gie_station_bindings` (
  `station_id` INTEGER UNSIGNED NOT NULL,
  `gie_station_id` VARCHAR(64) NOT NULL,
  `profile` VARCHAR(40) NOT NULL,
  `origin` ENUM('MEASURED','CALCULATED','EXTERNAL','FORECAST','SIMULATED','IMPORTED') NOT NULL DEFAULT 'SIMULATED',
  `last_generation` VARCHAR(64) NULL,
  `last_event_cursor` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`station_id`),
  UNIQUE INDEX `uq_gie_station_binding_gie_id` (`gie_station_id`),
  CONSTRAINT `gie_station_bindings_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `alerts`
  ADD COLUMN `gie_alert_id` VARCHAR(64) NULL,
  ADD COLUMN `gie_last_revision` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN `gie_generation` VARCHAR(64) NULL,
  ADD COLUMN `gie_payload` JSON NULL,
  ADD COLUMN `acknowledged_at` DATETIME(0) NULL,
  ADD UNIQUE INDEX `uq_alerts_gie_alert_id` (`gie_alert_id`);
