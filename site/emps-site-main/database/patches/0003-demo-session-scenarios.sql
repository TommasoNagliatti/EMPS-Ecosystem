-- LOCAL candidate only. Adds a financial interpretation of existing simulated sessions.
-- Re-running this statement on the same disposable MySQL database is idempotent.
CREATE TABLE IF NOT EXISTS `demo_session_scenarios` (
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

    PRIMARY KEY (`session_id`, `scenario_version`),
    INDEX `idx_demo_scenario_batch_version`(`batch_id`, `station_id`, `scenario_version`),
    CONSTRAINT `fk_demo_scenario_session` FOREIGN KEY (`session_id`, `batch_id`, `station_id`)
      REFERENCES `demo_charging_sessions`(`id`, `batch_id`, `station_id`)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `chk_demo_scenario_usage` CHECK (
      (`usage_kind` = 'OWNER' AND `credential_kind` = 'HYPOTHETICAL_RFID'
        AND `amount` = 0 AND `channel` IS NULL AND `method` IS NULL)
      OR (`usage_kind` = 'VISITOR' AND `credential_kind` = 'NONE'
        AND `channel` IS NOT NULL AND `method` IS NOT NULL)
      OR (`usage_kind` = 'UNSERVED' AND `credential_kind` = 'NONE'
        AND `amount` = 0 AND `cost_amount` = 0 AND `channel` IS NULL AND `method` IS NULL)
    )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
