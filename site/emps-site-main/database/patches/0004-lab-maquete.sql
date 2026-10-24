-- Apply only to the audited disposable emps_integration_test clone on 127.0.0.1:3308.
-- The protected 3306/3307 databases and official database must never receive this patch.
-- Explicit binding is a separate, guarded INSERT into lab_devices after this patch.
CREATE TABLE `lab_devices` (
  `id` VARCHAR(64) NOT NULL,
  `station_id` INTEGER UNSIGNED NOT NULL,
  `boot_id` VARCHAR(64) NULL,
  `last_heartbeat_at` DATETIME(3) NULL,
  `ev1` BOOLEAN NOT NULL DEFAULT FALSE,
  `ev2` BOOLEAN NOT NULL DEFAULT FALSE,
  `authorized_ev1` BOOLEAN NOT NULL DEFAULT FALSE,
  `authorized_ev2` BOOLEAN NOT NULL DEFAULT FALSE,
  `last_command_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lab_device_station` (`id`, `station_id`),
  UNIQUE KEY `uq_lab_device_one_per_station` (`station_id`),
  CONSTRAINT `fk_lab_device_station` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lab_commands_request` (`device_id`, `request_id`),
  KEY `idx_lab_commands_queue` (`device_id`, `status`, `created_at`),
  KEY `idx_lab_commands_station` (`station_id`, `created_at`),
  CONSTRAINT `fk_lab_command_device` FOREIGN KEY (`device_id`, `station_id`) REFERENCES `lab_devices` (`id`, `station_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_lab_command_evse` CHECK (`evse` IN ('EV1', 'EV2')),
  CONSTRAINT `chk_lab_command_status` CHECK (`status` IN ('PENDING', 'DELIVERED', 'ACKED', 'EXPIRED', 'FAILED'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lab_device_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `device_id` VARCHAR(64) NOT NULL,
  `station_id` INTEGER UNSIGNED NOT NULL,
  `kind` VARCHAR(40) NOT NULL,
  `details` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_lab_events_device` (`device_id`, `created_at`),
  CONSTRAINT `fk_lab_event_device` FOREIGN KEY (`device_id`, `station_id`) REFERENCES `lab_devices` (`id`, `station_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lab_rfid_tags` (
  `id` CHAR(36) NOT NULL,
  `device_id` VARCHAR(64) NOT NULL,
  `station_id` INTEGER UNSIGNED NOT NULL,
  `uid_hash` CHAR(64) NOT NULL,
  `label` VARCHAR(32) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lab_rfid_uid` (`device_id`, `uid_hash`),
  CONSTRAINT `fk_lab_tag_device` FOREIGN KEY (`device_id`, `station_id`) REFERENCES `lab_devices` (`id`, `station_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
