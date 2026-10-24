-- Disposable clone 3308 only; verify container and backup before applying.
-- Paid visitor scenario only. Historical owner sessions and operational ledgers are untouched.
INSERT INTO tariffs (station_id,charger_id,tariff_name,base_price_per_kwh,
  fixed_fee,dynamic_pricing_enabled,currency_code,valid_from,status)
SELECT 47,78,'SANDBOX - Residencia - visitante',2.0000,0.00,0,'BRL',UTC_TIMESTAMP(3),'active'
WHERE DATABASE()='emps_integration_test'
  AND EXISTS(SELECT 1 FROM chargers WHERE id=78 AND station_id=47
    AND administrative_status='pending' AND ocpp_identity='SIMULATED_DEMO_CASA_001_EVSE_01')
  AND NOT EXISTS(SELECT 1 FROM tariffs WHERE station_id=47 AND charger_id=78
    AND tariff_name='SANDBOX - Residencia - visitante');
