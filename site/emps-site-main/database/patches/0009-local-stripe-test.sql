-- Disposable local clone 3308 only. No operational payment tables change.
ALTER TABLE lab_charge_intents
  ADD COLUMN card_provider VARCHAR(24) NOT NULL DEFAULT 'sandbox',
  ADD COLUMN card_intent_id VARCHAR(128) NULL,
  ADD CONSTRAINT chk_lab_card_provider CHECK (
    card_provider = 'sandbox' OR (card_provider = 'stripe_test' AND payment_method = 'card')
  );
