-- ONLY the audited disposable emps_integration_test clone on 127.0.0.1:3308.
-- Preserve EV1/EV2 and admit EV3 only for the existing building charger 51.
-- No operational sessions, payments, tariffs, or physical charger records change.
ALTER TABLE `lab_charge_sessions`
  DROP CHECK `chk_lab_session_evse`,
  ADD CONSTRAINT `chk_lab_session_evse` CHECK (
    `evse` IN ('EV1', 'EV2') OR
    (`evse` = 'EV3' AND `station_id` = 13 AND `charger_id` = 51)
  );
