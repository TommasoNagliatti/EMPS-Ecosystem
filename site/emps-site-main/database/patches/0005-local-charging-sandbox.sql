-- Apply only to the audited disposable emps_integration_test clone on 127.0.0.1:3308.
-- Sandbox charging never writes charging_sessions, payment_intents, or payments.
-- No foreign keys to operational tables: source IDs are validated by the guarded API.
CREATE TABLE `lab_charge_intents` (
  `id` CHAR(36) NOT NULL,
  `station_id` INTEGER UNSIGNED NOT NULL,
  `charger_id` INTEGER UNSIGNED NOT NULL,
  `actor_user_id` INTEGER UNSIGNED NOT NULL,
  `qr_binding_id` INTEGER UNSIGNED NULL,
  `tariff_id` INTEGER UNSIGNED NOT NULL,
  `payment_method` VARCHAR(16) NOT NULL,
  `spending_limit` DECIMAL(10,2) NOT NULL,
  `price_per_kwh` DECIMAL(10,4) NOT NULL,
  `fixed_fee` DECIMAL(10,2) NOT NULL,
  `status` VARCHAR(20) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lab_intents_actor_key` (`actor_user_id`, `idempotency_key`),
  KEY `idx_lab_intents_station_charger` (`station_id`, `charger_id`),
  KEY `idx_lab_intents_actor_status` (`actor_user_id`, `status`),
  CONSTRAINT `chk_lab_intent_method` CHECK (`payment_method` IN ('pix', 'card', 'wallet')),
  CONSTRAINT `chk_lab_intent_status` CHECK (`status` IN ('AUTHORIZED', 'CANCELED', 'EXPIRED')),
  CONSTRAINT `chk_lab_intent_amounts` CHECK (`spending_limit` >= 0 AND `price_per_kwh` >= 0 AND `fixed_fee` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lab_charge_sessions` (
  `id` CHAR(36) NOT NULL,
  `intent_id` CHAR(36) NOT NULL,
  `station_id` INTEGER UNSIGNED NOT NULL,
  `charger_id` INTEGER UNSIGNED NOT NULL,
  `actor_user_id` INTEGER UNSIGNED NOT NULL,
  `qr_binding_id` INTEGER UNSIGNED NULL,
  `evse` VARCHAR(3) NOT NULL,
  `status` VARCHAR(20) NOT NULL,
  `start_key` VARCHAR(100) NOT NULL,
  `stop_key` VARCHAR(100) NULL,
  `meter_source` VARCHAR(24) NOT NULL DEFAULT 'SANDBOX_ESTIMATE',
  `simulated_power_kw` DECIMAL(10,3) NOT NULL,
  `energy_kwh` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `total_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `started_at` DATETIME(3) NOT NULL,
  `ended_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lab_session_intent` (`intent_id`),
  UNIQUE KEY `uq_lab_session_actor_start` (`actor_user_id`, `start_key`),
  KEY `idx_lab_session_charger_status` (`charger_id`, `status`),
  KEY `idx_lab_session_station_requested` (`station_id`, `requested_at`),
  CONSTRAINT `chk_lab_session_evse` CHECK (`evse` IN ('EV1', 'EV2')),
  CONSTRAINT `chk_lab_session_status` CHECK (`status` IN ('STARTING', 'CHARGING', 'FINISHING', 'FINISHED', 'FAILED')),
  CONSTRAINT `chk_lab_session_meter` CHECK (`meter_source` = 'SANDBOX_ESTIMATE'),
  CONSTRAINT `chk_lab_session_amounts` CHECK (`simulated_power_kw` >= 0 AND `energy_kwh` >= 0 AND `total_amount` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lab_charge_payments` (
  `id` CHAR(36) NOT NULL,
  `session_id` CHAR(36) NOT NULL,
  `provider` VARCHAR(24) NOT NULL DEFAULT 'sandbox',
  `method` VARCHAR(16) NOT NULL,
  `status` VARCHAR(20) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `paid_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lab_payment_session` (`session_id`),
  CONSTRAINT `chk_lab_payment_provider` CHECK (`provider` = 'sandbox'),
  CONSTRAINT `chk_lab_payment_method` CHECK (`method` IN ('pix', 'card', 'wallet')),
  CONSTRAINT `chk_lab_payment_status` CHECK (`status` = 'APPROVED'),
  CONSTRAINT `chk_lab_payment_amount` CHECK (`amount` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
