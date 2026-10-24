-- Apply only to the audited disposable emps_integration_test clone on 127.0.0.1:3308.
-- Cash/POS are operator-confirmed sandbox receipts, never external gateway payments.
ALTER TABLE `lab_charge_intents`
  DROP CHECK `chk_lab_intent_method`,
  ADD CONSTRAINT `chk_lab_intent_method` CHECK (`payment_method` IN ('pix', 'card', 'wallet', 'cash', 'pos'));

ALTER TABLE `lab_charge_sessions`
  ADD COLUMN `auto_stop_at` DATETIME(3) NULL AFTER `started_at`,
  ADD KEY `idx_lab_session_auto_stop` (`status`, `auto_stop_at`);

CREATE TABLE `lab_charge_receipts` (
  `id` CHAR(36) NOT NULL,
  `intent_id` CHAR(36) NOT NULL,
  `station_id` INTEGER UNSIGNED NOT NULL,
  `charger_id` INTEGER UNSIGNED NOT NULL,
  `actor_user_id` INTEGER UNSIGNED NOT NULL,
  `method` VARCHAR(16) NOT NULL,
  `amount_received` DECIMAL(10,2) NOT NULL,
  `confirmation_source` VARCHAR(24) NOT NULL,
  `confirmed_at` DATETIME(3) NOT NULL,
  `consumed_amount` DECIMAL(10,2) NULL,
  `unused_balance` DECIMAL(10,2) NULL,
  `closed_at` DATETIME(3) NULL,
  `return_status` VARCHAR(16) NOT NULL DEFAULT 'NONE',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lab_receipt_intent` (`intent_id`),
  KEY `idx_lab_receipt_station_confirmed` (`station_id`, `confirmed_at`),
  KEY `idx_lab_receipt_actor_confirmed` (`actor_user_id`, `confirmed_at`),
  CONSTRAINT `chk_lab_receipt_method` CHECK (`method` IN ('cash', 'pos')),
  CONSTRAINT `chk_lab_receipt_source` CHECK (`confirmation_source` = 'OPERATOR_CONFIRMED'),
  CONSTRAINT `chk_lab_receipt_amount` CHECK (`amount_received` > 0),
  CONSTRAINT `chk_lab_receipt_return` CHECK (`return_status` IN ('NONE', 'PENDING')),
  CONSTRAINT `chk_lab_receipt_close` CHECK (
    (`closed_at` IS NULL AND `consumed_amount` IS NULL AND `unused_balance` IS NULL AND `return_status` = 'NONE')
    OR
    (`closed_at` IS NOT NULL AND `consumed_amount` >= 0 AND `unused_balance` >= 0
      AND `consumed_amount` + `unused_balance` = `amount_received`
      AND ((`unused_balance` = 0 AND `return_status` = 'NONE')
        OR (`unused_balance` > 0 AND `return_status` = 'PENDING')))
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
