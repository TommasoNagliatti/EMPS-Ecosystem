-- ============================================================================
-- EMPS — Energy Management and Payment Solution
-- Script completo do banco de dados MySQL
-- Inclui o schema-base e a extensão de integração do GIE.
-- Ordem: schema-base -> migration GIE.
-- Compatibilidade recomendada: MySQL 8.0 ou superior.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS emps_db
DEFAULT CHARACTER SET utf8mb4
DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE emps_db;

CREATE TABLE users(
id INT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
full_name VARCHAR(100) NOT NULL, 
email VARCHAR(255) NOT NULL UNIQUE,
password_hash VARCHAR(255) NOT NULL,
role ENUM('admin', 'customer') NOT NULL DEFAULT 'customer',
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)ENGINE = InnoDB;

SELECT * FROM users;
DESCRIBE users;

CREATE TABLE stations(
id INT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
admin_id INT UNSIGNED NOT NULL,
station_name VARCHAR(50) NOT NULL,
postal_code CHAR(8) NOT NULL,
street VARCHAR(80) NOT NULL,
address_number VARCHAR(20) NOT NULL,
complement VARCHAR(80),
neighborhood VARCHAR(80) NOT NULL,
city VARCHAR(80) NOT NULL, 
state CHAR(2) NOT NULL, 
country_code CHAR(2) NOT NULL DEFAULT 'BR',
latitude DECIMAL(10,8),
longitude DECIMAL(11,8),
geocoding_status ENUM('pending', 'success', 'failed') NOT NULL DEFAULT 'pending',
power_limit_kw DECIMAL(10,2),
status ENUM('pending', 'active', 'inactive', 'maintenance') NOT NULL DEFAULT 'pending',
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
CONSTRAINT fk_stations_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT chk_stations_latitude CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
CONSTRAINT chk_stations_longitude CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
CONSTRAINT chk_stations_power_limit CHECK (power_limit_kw IS NULL OR power_limit_kw > 0)
 )ENGINE = InnoDB;
 
 DESCRIBE stations;
 
CREATE TABLE chargers (
id INT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
station_id INT UNSIGNED NOT NULL,
charger_code VARCHAR(50) NOT NULL UNIQUE,
charger_name VARCHAR(100) NOT NULL,
ocpp_identity VARCHAR(100) NOT NULL UNIQUE,
ocpp_version VARCHAR(20),
serial_number VARCHAR(100) UNIQUE,
manufacturer VARCHAR(100),
model VARCHAR(100),
firmware_version VARCHAR(50),
power_type ENUM('AC', 'DC'),
phase_count TINYINT UNSIGNED,
connector_type VARCHAR(50),
rated_max_power_kw DECIMAL(8,2),
configured_power_limit_kw DECIMAL(8,2),
administrative_status ENUM('pending', 'enabled', 'disabled', 'maintenance') NOT NULL DEFAULT 'pending',
provisioned_at DATETIME,
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
INDEX idx_chargers_station (station_id),
CONSTRAINT fk_chargers_station FOREIGN KEY (station_id) REFERENCES stations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT chk_chargers_phase_count CHECK (phase_count IS NULL OR phase_count IN (1, 3)),
CONSTRAINT chk_chargers_rated_power CHECK (rated_max_power_kw IS NULL OR rated_max_power_kw > 0),
CONSTRAINT chk_chargers_power_limit CHECK (configured_power_limit_kw IS NULL OR (configured_power_limit_kw > 0 AND (rated_max_power_kw IS NULL OR configured_power_limit_kw <= rated_max_power_kw)))
) ENGINE = InnoDB;

SELECT * FROM chargers;
DESCRIBE chargers;

CREATE TABLE charger_live_status (
charger_id INT UNSIGNED NOT NULL PRIMARY KEY,
operational_status ENUM('unknown','available', 'preparing', 'charging', 'suspended', 'finishing', 'reserved', 'unavailable', 'faulted', 'offline') NOT NULL DEFAULT 'unknown',
current_power_kw DECIMAL(10,3) NOT NULL DEFAULT 0.000,
meter_total_kwh DECIMAL(14,3),
voltage_v DECIMAL(8,2),
current_a DECIMAL(8,2),
last_error_code VARCHAR(100),
last_seen_at DATETIME,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
CONSTRAINT fk_live_status_charger FOREIGN KEY (charger_id) REFERENCES chargers(id) ON UPDATE CASCADE ON DELETE CASCADE,
CONSTRAINT chk_live_current_power CHECK(current_power_kw >=0),
CONSTRAINT chk_live_meter_total CHECK(meter_total_kwh IS NULL OR meter_total_kwh >=0),
CONSTRAINT chk_live_voltage CHECK(voltage_v IS NULL OR voltage_v >=0),
CONSTRAINT chk_live_current CHECK(current_a IS NULL OR current_a >=0) 
)ENGINE = InnoDB;

SELECT * FROM charger_live_status;
DESCRIBE charger_live_status;

-- Adaptacoes identificadas no aplicativo e no site

ALTER TABLE users
MODIFY COLUMN role ENUM('admin', 'operator', 'customer') NOT NULL DEFAULT 'customer',
ADD COLUMN phone VARCHAR(20) AFTER email,
ADD COLUMN account_status ENUM('pending', 'active', 'inactive', 'blocked') NOT NULL DEFAULT 'active' AFTER role,
ADD COLUMN email_verified_at DATETIME AFTER account_status,
ADD INDEX idx_users_role_status (role, account_status);

DESCRIBE users;

ALTER TABLE stations
ADD COLUMN timezone_name VARCHAR(50) NOT NULL DEFAULT 'America/Sao_Paulo' AFTER longitude,
ADD COLUMN opening_hours VARCHAR(100) AFTER timezone_name,
ADD COLUMN featured BOOLEAN NOT NULL DEFAULT FALSE AFTER opening_hours,
ADD INDEX idx_stations_coordinates (latitude, longitude);

DESCRIBE stations;

ALTER TABLE chargers
ADD COLUMN bay_code VARCHAR(50) AFTER charger_name;

DESCRIBE chargers;

ALTER TABLE charger_live_status
ADD COLUMN temperature_c DECIMAL(6,2) AFTER current_a,
ADD COLUMN last_error_message VARCHAR(255) AFTER last_error_code,
ADD INDEX idx_live_status_operational (operational_status),
ADD CONSTRAINT chk_live_temperature CHECK(temperature_c IS NULL OR temperature_c BETWEEN -50 AND 150);

DESCRIBE charger_live_status;

CREATE TABLE tariffs (
id INT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
station_id INT UNSIGNED NOT NULL,
charger_id INT UNSIGNED,
tariff_name VARCHAR(100) NOT NULL,
base_price_per_kwh DECIMAL(10,4) NOT NULL,
fixed_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
dynamic_pricing_enabled BOOLEAN NOT NULL DEFAULT TRUE,
demand_threshold DECIMAL(5,4) NOT NULL DEFAULT 0.6000,
max_dynamic_adjustment DECIMAL(5,4) NOT NULL DEFAULT 0.3000,
currency_code CHAR(3) NOT NULL DEFAULT 'BRL',
valid_from DATETIME NOT NULL,
valid_until DATETIME,
status ENUM('scheduled', 'active', 'inactive') NOT NULL DEFAULT 'scheduled',
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
INDEX idx_tariffs_station_status (station_id, status),
INDEX idx_tariffs_charger_status (charger_id, status),
CONSTRAINT fk_tariffs_station FOREIGN KEY (station_id) REFERENCES stations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT fk_tariffs_charger FOREIGN KEY (charger_id) REFERENCES chargers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT chk_tariffs_base_price CHECK(base_price_per_kwh >= 0),
CONSTRAINT chk_tariffs_fixed_fee CHECK(fixed_fee >= 0),
CONSTRAINT chk_tariffs_demand_threshold CHECK(demand_threshold BETWEEN 0 AND 1),
CONSTRAINT chk_tariffs_dynamic_adjustment CHECK(max_dynamic_adjustment BETWEEN 0 AND 1),
CONSTRAINT chk_tariffs_validity CHECK(valid_until IS NULL OR valid_until > valid_from)
)ENGINE = InnoDB;

SELECT * FROM tariffs;
DESCRIBE tariffs;

CREATE TABLE station_staff (
station_id INT UNSIGNED NOT NULL,
user_id INT UNSIGNED NOT NULL,
staff_role ENUM('manager', 'operator') NOT NULL DEFAULT 'operator',
assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (station_id, user_id),
INDEX idx_station_staff_user (user_id),
CONSTRAINT fk_station_staff_station FOREIGN KEY (station_id) REFERENCES stations(id) ON UPDATE CASCADE ON DELETE CASCADE,
CONSTRAINT fk_station_staff_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
)ENGINE = InnoDB;

SELECT * FROM station_staff;
DESCRIBE station_staff;

CREATE TABLE user_vehicles (
id INT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
user_id INT UNSIGNED NOT NULL,
manufacturer VARCHAR(80),
model VARCHAR(100) NOT NULL,
license_plate VARCHAR(10) NOT NULL UNIQUE,
connector_preference VARCHAR(50),
is_primary BOOLEAN NOT NULL DEFAULT FALSE,
status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
INDEX idx_user_vehicles_user (user_id),
CONSTRAINT fk_user_vehicles_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
)ENGINE = InnoDB;

SELECT * FROM user_vehicles;
DESCRIBE user_vehicles;

CREATE TABLE station_amenities (
station_id INT UNSIGNED NOT NULL,
amenity_name VARCHAR(50) NOT NULL,
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (station_id, amenity_name),
CONSTRAINT fk_station_amenities_station FOREIGN KEY (station_id) REFERENCES stations(id) ON UPDATE CASCADE ON DELETE CASCADE
)ENGINE = InnoDB;

SELECT * FROM station_amenities;
DESCRIBE station_amenities;

CREATE TABLE user_refresh_tokens (
id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
user_id INT UNSIGNED NOT NULL,
token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
token_family CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
device_name VARCHAR(100),
platform ENUM('android', 'ios', 'web', 'unknown') NOT NULL DEFAULT 'unknown',
expires_at DATETIME NOT NULL,
revoked_at DATETIME,
last_used_at DATETIME,
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
INDEX idx_refresh_tokens_user (user_id),
INDEX idx_refresh_tokens_family (token_family),
INDEX idx_refresh_tokens_expiration (expires_at, revoked_at),
CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
CONSTRAINT chk_refresh_tokens_expiration CHECK(expires_at > created_at),
CONSTRAINT chk_refresh_tokens_revocation CHECK(revoked_at IS NULL OR revoked_at >= created_at)
)ENGINE = InnoDB;

SELECT * FROM user_refresh_tokens;
DESCRIBE user_refresh_tokens;

CREATE TABLE charger_qr_bindings (
id INT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
charger_id INT UNSIGNED NOT NULL,
public_token VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
short_code VARCHAR(30) NOT NULL UNIQUE,
version_number SMALLINT UNSIGNED NOT NULL DEFAULT 1,
is_active BOOLEAN NOT NULL DEFAULT TRUE,
valid_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
valid_until DATETIME,
revoked_at DATETIME,
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
INDEX idx_qr_bindings_charger_active (charger_id, is_active),
CONSTRAINT fk_qr_bindings_charger FOREIGN KEY (charger_id) REFERENCES chargers(id) ON UPDATE CASCADE ON DELETE CASCADE,
CONSTRAINT chk_qr_bindings_version CHECK(version_number > 0),
CONSTRAINT chk_qr_bindings_validity CHECK(valid_until IS NULL OR valid_until > valid_from),
CONSTRAINT chk_qr_bindings_revocation CHECK(revoked_at IS NULL OR revoked_at >= valid_from)
)ENGINE = InnoDB;

SELECT * FROM charger_qr_bindings;
DESCRIBE charger_qr_bindings;

CREATE TABLE payment_intents (
id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
customer_id INT UNSIGNED NOT NULL,
charger_id INT UNSIGNED NOT NULL,
tariff_id INT UNSIGNED NOT NULL,
qr_binding_id INT UNSIGNED,
payment_method ENUM('pix', 'card', 'wallet') NOT NULL,
spending_limit DECIMAL(10,2),
authorized_amount DECIMAL(10,2),
currency_code CHAR(3) NOT NULL DEFAULT 'BRL',
status ENUM('created', 'requires_action', 'processing', 'authorized', 'rejected', 'expired', 'canceled') NOT NULL DEFAULT 'created',
provider VARCHAR(80),
external_intent_id VARCHAR(150),
idempotency_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
tariff_locked_until DATETIME NOT NULL,
expires_at DATETIME NOT NULL,
authorized_at DATETIME,
failure_code VARCHAR(100),
failure_message VARCHAR(255),
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
UNIQUE INDEX uq_payment_intents_customer_key (customer_id, idempotency_key),
UNIQUE INDEX uq_payment_intents_provider_external (provider, external_intent_id),
INDEX idx_payment_intents_customer_status (customer_id, status),
INDEX idx_payment_intents_charger_status (charger_id, status),
CONSTRAINT fk_payment_intents_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT fk_payment_intents_charger FOREIGN KEY (charger_id) REFERENCES chargers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT fk_payment_intents_tariff FOREIGN KEY (tariff_id) REFERENCES tariffs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT fk_payment_intents_qr_binding FOREIGN KEY (qr_binding_id) REFERENCES charger_qr_bindings(id) ON UPDATE CASCADE ON DELETE SET NULL,
CONSTRAINT chk_payment_intents_spending_limit CHECK(spending_limit IS NULL OR spending_limit > 0),
CONSTRAINT chk_payment_intents_authorized_amount CHECK(authorized_amount IS NULL OR authorized_amount >= 0),
CONSTRAINT chk_payment_intents_tariff_lock CHECK(tariff_locked_until > created_at),
CONSTRAINT chk_payment_intents_expiration CHECK(expires_at > created_at)
)ENGINE = InnoDB;

SELECT * FROM payment_intents;
DESCRIBE payment_intents;

CREATE TABLE charging_sessions (
tariff_version VARCHAR(40) NULL,
billing_snapshot JSON NULL,
disconnected_at DATETIME(3) NULL,
id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
session_code VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
customer_id INT UNSIGNED,
charger_id INT UNSIGNED NOT NULL,
tariff_id INT UNSIGNED NOT NULL,
payment_intent_id BIGINT UNSIGNED,
qr_binding_id INT UNSIGNED,
started_by_user_id INT UNSIGNED,
session_origin ENUM('mobile_app', 'admin_site', 'ocpp', 'system') NOT NULL,
billing_mode ENUM('prepaid', 'postpaid') NOT NULL DEFAULT 'prepaid',
preferred_payment_method ENUM('pix', 'card', 'wallet', 'cash', 'simulated'),
spending_limit DECIMAL(10,2),
energy_limit_kwh DECIMAL(12,3),
status ENUM('awaiting_cable', 'payment_authorizing', 'payment_authorized', 'start_requested', 'starting', 'charging', 'stop_requested', 'stopping', 'finalizing_meter', 'payment_capturing', 'payment_pending', 'completed', 'canceled', 'interrupted', 'start_failed', 'charger_timeout') NOT NULL DEFAULT 'awaiting_cable',
requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
started_at DATETIME,
ended_at DATETIME,
duration_seconds INT UNSIGNED,
start_meter_kwh DECIMAL(14,3),
end_meter_kwh DECIMAL(14,3),
energy_kwh DECIMAL(12,3) NOT NULL DEFAULT 0.000,
average_power_kw DECIMAL(10,3),
base_price_per_kwh_snapshot DECIMAL(10,4) NOT NULL,
applied_price_per_kwh DECIMAL(10,4) NOT NULL,
fixed_fee_snapshot DECIMAL(10,2) NOT NULL DEFAULT 0.00,
dynamic_adjustment_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0000,
total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
currency_code CHAR(3) NOT NULL DEFAULT 'BRL',
start_idempotency_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin UNIQUE,
stop_idempotency_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin UNIQUE,
stop_reason VARCHAR(255),
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
UNIQUE INDEX uq_sessions_payment_intent (payment_intent_id),
INDEX idx_sessions_customer_status (customer_id, status),
INDEX idx_sessions_charger_status (charger_id, status),
INDEX idx_sessions_started_at (started_at),
CONSTRAINT fk_sessions_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT fk_sessions_charger FOREIGN KEY (charger_id) REFERENCES chargers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT fk_sessions_tariff FOREIGN KEY (tariff_id) REFERENCES tariffs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT fk_sessions_payment_intent FOREIGN KEY (payment_intent_id) REFERENCES payment_intents(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT fk_sessions_qr_binding FOREIGN KEY (qr_binding_id) REFERENCES charger_qr_bindings(id) ON UPDATE CASCADE ON DELETE SET NULL,
CONSTRAINT fk_sessions_started_by FOREIGN KEY (started_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
CONSTRAINT chk_sessions_spending_limit CHECK(spending_limit IS NULL OR spending_limit > 0),
CONSTRAINT chk_sessions_energy_limit CHECK(energy_limit_kwh IS NULL OR energy_limit_kwh > 0),
CONSTRAINT chk_sessions_time_range CHECK(ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at),
CONSTRAINT chk_sessions_start_meter CHECK(start_meter_kwh IS NULL OR start_meter_kwh >= 0),
CONSTRAINT chk_sessions_end_meter CHECK(end_meter_kwh IS NULL OR end_meter_kwh >= 0),
CONSTRAINT chk_sessions_meter_range CHECK(end_meter_kwh IS NULL OR start_meter_kwh IS NULL OR end_meter_kwh >= start_meter_kwh),
CONSTRAINT chk_sessions_energy CHECK(energy_kwh >= 0),
CONSTRAINT chk_sessions_average_power CHECK(average_power_kw IS NULL OR average_power_kw >= 0),
CONSTRAINT chk_sessions_base_price CHECK(base_price_per_kwh_snapshot >= 0),
CONSTRAINT chk_sessions_applied_price CHECK(applied_price_per_kwh >= 0),
CONSTRAINT chk_sessions_fixed_fee CHECK(fixed_fee_snapshot >= 0),
CONSTRAINT chk_sessions_dynamic_rate CHECK(dynamic_adjustment_rate BETWEEN 0 AND 1),
CONSTRAINT chk_sessions_total_amount CHECK(total_amount >= 0)
)ENGINE = InnoDB;

SELECT * FROM charging_sessions;
DESCRIBE charging_sessions;

CREATE TABLE payments (
id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
payment_code VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
charging_session_id BIGINT UNSIGNED NOT NULL,
payment_intent_id BIGINT UNSIGNED,
payment_method ENUM('pix', 'card', 'wallet', 'cash', 'simulated') NOT NULL,
amount DECIMAL(12,2) NOT NULL,
amount_received DECIMAL(12,2),
change_amount DECIMAL(12,2),
currency_code CHAR(3) NOT NULL DEFAULT 'BRL',
status ENUM('pending', 'processing', 'authorized', 'approved', 'rejected', 'canceled', 'refunded', 'partially_refunded') NOT NULL DEFAULT 'pending',
provider VARCHAR(80),
external_transaction_id VARCHAR(150),
idempotency_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin UNIQUE,
failure_code VARCHAR(100),
failure_message VARCHAR(255),
paid_at DATETIME,
refunded_at DATETIME,
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
UNIQUE INDEX uq_payments_provider_transaction (provider, external_transaction_id),
INDEX idx_payments_session (charging_session_id),
INDEX idx_payments_status_created (status, created_at),
CONSTRAINT fk_payments_session FOREIGN KEY (charging_session_id) REFERENCES charging_sessions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT fk_payments_intent FOREIGN KEY (payment_intent_id) REFERENCES payment_intents(id) ON UPDATE CASCADE ON DELETE SET NULL,
CONSTRAINT chk_payments_amount CHECK(amount >= 0),
CONSTRAINT chk_payments_amount_received CHECK(amount_received IS NULL OR amount_received >= 0),
CONSTRAINT chk_payments_change CHECK(change_amount IS NULL OR change_amount >= 0),
CONSTRAINT chk_payments_refund_time CHECK(refunded_at IS NULL OR paid_at IS NULL OR refunded_at >= paid_at)
)ENGINE = InnoDB;

SELECT * FROM payments;
DESCRIBE payments;

CREATE TABLE charger_readings (
id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
charger_id INT UNSIGNED NOT NULL,
charging_session_id BIGINT UNSIGNED,
measured_at DATETIME(3) NOT NULL,
power_kw DECIMAL(10,3),
energy_total_kwh DECIMAL(14,3),
voltage_v DECIMAL(8,2),
current_a DECIMAL(8,2),
temperature_c DECIMAL(6,2),
state_of_charge_percent DECIMAL(5,2),
reading_source ENUM('ocpp', 'modbus', 'simulator', 'manual') NOT NULL,
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
INDEX idx_readings_charger_time (charger_id, measured_at),
INDEX idx_readings_session_time (charging_session_id, measured_at),
CONSTRAINT fk_readings_charger FOREIGN KEY (charger_id) REFERENCES chargers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT fk_readings_session FOREIGN KEY (charging_session_id) REFERENCES charging_sessions(id) ON UPDATE CASCADE ON DELETE SET NULL,
CONSTRAINT chk_readings_power CHECK(power_kw IS NULL OR power_kw >= 0),
CONSTRAINT chk_readings_energy_total CHECK(energy_total_kwh IS NULL OR energy_total_kwh >= 0),
CONSTRAINT chk_readings_voltage CHECK(voltage_v IS NULL OR voltage_v >= 0),
CONSTRAINT chk_readings_current CHECK(current_a IS NULL OR current_a >= 0),
CONSTRAINT chk_readings_temperature CHECK(temperature_c IS NULL OR temperature_c BETWEEN -50 AND 150),
CONSTRAINT chk_readings_state_of_charge CHECK(state_of_charge_percent IS NULL OR state_of_charge_percent BETWEEN 0 AND 100)
)ENGINE = InnoDB;

SELECT * FROM charger_readings;
DESCRIBE charger_readings;

CREATE TABLE station_energy_readings (
id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
station_id INT UNSIGNED NOT NULL,
measured_at DATETIME(3) NOT NULL,
grid_power_kw DECIMAL(10,3),
solar_power_kw DECIMAL(10,3),
battery_power_kw DECIMAL(10,3),
charger_power_kw DECIMAL(10,3),
battery_state_of_charge_percent DECIMAL(5,2),
reading_source ENUM('sems_plus', 'modbus', 'simulator', 'manual') NOT NULL,
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
INDEX idx_station_energy_time (station_id, measured_at),
CONSTRAINT fk_station_energy_station FOREIGN KEY (station_id) REFERENCES stations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT chk_station_energy_solar CHECK(solar_power_kw IS NULL OR solar_power_kw >= 0),
CONSTRAINT chk_station_energy_chargers CHECK(charger_power_kw IS NULL OR charger_power_kw >= 0),
CONSTRAINT chk_station_energy_battery_soc CHECK(battery_state_of_charge_percent IS NULL OR battery_state_of_charge_percent BETWEEN 0 AND 100)
)ENGINE = InnoDB;

SELECT * FROM station_energy_readings;
DESCRIBE station_energy_readings;

CREATE TABLE alerts (
id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
station_id INT UNSIGNED,
charger_id INT UNSIGNED,
charging_session_id BIGINT UNSIGNED,
alert_type VARCHAR(100) NOT NULL,
title VARCHAR(150) NOT NULL,
description TEXT NOT NULL,
severity ENUM('low', 'medium', 'high', 'critical') NOT NULL,
status ENUM('open', 'checking', 'resolved') NOT NULL DEFAULT 'open',
alert_source ENUM('emps', 'sems_plus', 'internal_rule', 'ocpp', 'modbus', 'payment_provider') NOT NULL,
error_code VARCHAR(100),
resolved_by_user_id INT UNSIGNED,
resolved_at DATETIME,
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
INDEX idx_alerts_station_status (station_id, status),
INDEX idx_alerts_charger_status (charger_id, status),
INDEX idx_alerts_severity_status (severity, status),
CONSTRAINT fk_alerts_station FOREIGN KEY (station_id) REFERENCES stations(id) ON UPDATE CASCADE ON DELETE SET NULL,
CONSTRAINT fk_alerts_charger FOREIGN KEY (charger_id) REFERENCES chargers(id) ON UPDATE CASCADE ON DELETE SET NULL,
CONSTRAINT fk_alerts_session FOREIGN KEY (charging_session_id) REFERENCES charging_sessions(id) ON UPDATE CASCADE ON DELETE SET NULL,
CONSTRAINT fk_alerts_resolved_by FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
CONSTRAINT chk_alerts_resolution_time CHECK(resolved_at IS NULL OR resolved_at >= created_at)
)ENGINE = InnoDB;

SELECT * FROM alerts;
DESCRIBE alerts;

CREATE TABLE charging_commands (
id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
charger_id INT UNSIGNED NOT NULL,
charging_session_id BIGINT UNSIGNED,
requested_by_user_id INT UNSIGNED,
command_type ENUM('start_charging', 'pause_charging', 'resume_charging', 'stop_charging', 'unlock_connector', 'sync_status', 'reset_charger', 'request_maintenance', 'run_checklist', 'schedule_test') NOT NULL,
status ENUM('queued', 'sent', 'accepted', 'rejected', 'completed', 'failed', 'timeout') NOT NULL DEFAULT 'queued',
correlation_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin UNIQUE,
request_payload JSON,
response_payload JSON,
error_message VARCHAR(255),
requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
sent_at DATETIME,
processed_at DATETIME,
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
INDEX idx_commands_charger_status (charger_id, status),
INDEX idx_commands_session (charging_session_id),
CONSTRAINT fk_commands_charger FOREIGN KEY (charger_id) REFERENCES chargers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
CONSTRAINT fk_commands_session FOREIGN KEY (charging_session_id) REFERENCES charging_sessions(id) ON UPDATE CASCADE ON DELETE SET NULL,
CONSTRAINT fk_commands_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
CONSTRAINT chk_commands_sent_time CHECK(sent_at IS NULL OR sent_at >= requested_at),
CONSTRAINT chk_commands_processed_time CHECK(processed_at IS NULL OR processed_at >= requested_at)
)ENGINE = InnoDB;

SELECT * FROM charging_commands;
DESCRIBE charging_commands;

SHOW TABLES;

-- ============================================================================
-- EXTENSÃO DE INTEGRAÇÃO DO GIE
-- ============================================================================

-- Extensão mínima da telemetria atual. Os campos antigos são preservados para
-- compatibilidade; os novos campos eliminam ambiguidades de unidade/sinal e
-- registram a proveniência necessária ao GIE.
ALTER TABLE charger_live_status
    ADD COLUMN requested_power_kw DECIMAL(10,3) AFTER current_power_kw,
    ADD CONSTRAINT chk_live_requested_power
        CHECK(requested_power_kw IS NULL OR requested_power_kw >= 0);

ALTER TABLE charger_readings
    ADD COLUMN received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER measured_at,
    ADD COLUMN sequence_number BIGINT UNSIGNED AFTER received_at,
    ADD COLUMN measurement_quality ENUM('good', 'stale', 'bad', 'unknown')
        NOT NULL DEFAULT 'unknown' AFTER sequence_number,
    ADD COLUMN requested_power_kw DECIMAL(10,3) AFTER measurement_quality,
    ADD CONSTRAINT chk_readings_requested_power
        CHECK(requested_power_kw IS NULL OR requested_power_kw >= 0);

ALTER TABLE station_energy_readings
    ADD COLUMN received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER measured_at,
    ADD COLUMN sequence_number BIGINT UNSIGNED AFTER received_at,
    ADD COLUMN measurement_quality ENUM('good', 'stale', 'bad', 'unknown')
        NOT NULL DEFAULT 'unknown' AFTER sequence_number,
    ADD COLUMN battery_charge_power_kw DECIMAL(10,3) AFTER battery_power_kw,
    ADD COLUMN battery_discharge_power_kw DECIMAL(10,3) AFTER battery_charge_power_kw,
    ADD COLUMN charger_requested_power_kw DECIMAL(10,3) AFTER charger_power_kw,
    ADD COLUMN building_power_kw DECIMAL(10,3) AFTER charger_requested_power_kw,
    ADD COLUMN outside_temperature_c DECIMAL(6,2) AFTER building_power_kw,
    ADD COLUMN relative_humidity_percent DECIMAL(5,2) AFTER outside_temperature_c,
    ADD COLUMN connected_vehicle_count TINYINT UNSIGNED AFTER relative_humidity_percent,
    ADD COLUMN queued_vehicle_count TINYINT UNSIGNED AFTER connected_vehicle_count,
    ADD CONSTRAINT chk_station_energy_battery_charge
        CHECK(battery_charge_power_kw IS NULL OR battery_charge_power_kw >= 0),
    ADD CONSTRAINT chk_station_energy_battery_discharge
        CHECK(battery_discharge_power_kw IS NULL OR battery_discharge_power_kw >= 0),
    ADD CONSTRAINT chk_station_energy_requested
        CHECK(charger_requested_power_kw IS NULL OR charger_requested_power_kw >= 0),
    ADD CONSTRAINT chk_station_energy_building
        CHECK(building_power_kw IS NULL OR building_power_kw >= 0),
    ADD CONSTRAINT chk_station_energy_humidity
        CHECK(relative_humidity_percent IS NULL OR relative_humidity_percent BETWEEN 0 AND 100),
    ADD CONSTRAINT chk_station_energy_connected
        CHECK(connected_vehicle_count IS NULL OR connected_vehicle_count <= 4),
    ADD CONSTRAINT chk_station_energy_queue
        CHECK(queued_vehicle_count IS NULL OR queued_vehicle_count <= 3);

-- O GIE V1 só aceita quatro posições físicas EVSE1..EVSE4. Esta tabela mantém
-- esse acoplamento fora do cadastro genérico de carregadores e permite uma
-- futura evolução para N carregadores sem alterar IDs reais.
CREATE TABLE gie_evse_mappings (
    id INT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
    station_id INT UNSIGNED NOT NULL,
    charger_id INT UNSIGNED NOT NULL UNIQUE,
    evse_slot TINYINT UNSIGNED NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE INDEX uq_gie_mapping_station_slot (station_id, evse_slot),
    INDEX idx_gie_mapping_station_active (station_id, is_active),
    CONSTRAINT fk_gie_mapping_station
        FOREIGN KEY (station_id) REFERENCES stations(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_gie_mapping_charger
        FOREIGN KEY (charger_id) REFERENCES chargers(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_gie_mapping_slot CHECK(evse_slot BETWEEN 1 AND 4)
) ENGINE = InnoDB;

-- Série canônica de 15 minutos. Nenhuma lacuna é preenchida silenciosamente:
-- o backend só executa o ciclo quando todas as variáveis reais estão presentes.
CREATE TABLE gie_interval_snapshots (
    id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
    station_id INT UNSIGNED NOT NULL,
    interval_start DATETIME NOT NULL,
    building_power_kw DECIMAL(10,3) NOT NULL,
    outside_temperature_c DECIMAL(6,2) NOT NULL,
    relative_humidity_percent DECIMAL(5,2) NOT NULL,
    requested_power_kw DECIMAL(10,3) NOT NULL,
    delivered_power_kw DECIMAL(10,3) NOT NULL,
    occupied_chargers TINYINT UNSIGNED NOT NULL,
    connected_cars TINYINT UNSIGNED NOT NULL,
    arriving_cars TINYINT UNSIGNED NOT NULL,
    queued_cars TINYINT UNSIGNED NOT NULL,
    occupancy_percent DECIMAL(5,2) NOT NULL,
    delivered_energy_kwh DECIMAL(10,3) NOT NULL,
    source VARCHAR(50) NOT NULL,
    provenance JSON,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE INDEX uq_gie_snapshot_station_interval (station_id, interval_start),
    INDEX idx_gie_snapshot_history (station_id, interval_start),
    CONSTRAINT fk_gie_snapshot_station
        FOREIGN KEY (station_id) REFERENCES stations(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_gie_snapshot_alignment
        CHECK(MINUTE(interval_start) IN (0, 15, 30, 45) AND SECOND(interval_start) = 0),
    CONSTRAINT chk_gie_snapshot_nonnegative
        CHECK(building_power_kw >= 0 AND requested_power_kw >= 0
            AND delivered_power_kw >= 0 AND delivered_energy_kwh >= 0),
    CONSTRAINT chk_gie_snapshot_counts
        CHECK(occupied_chargers <= 4 AND connected_cars <= 4
            AND arriving_cars <= 6 AND queued_cars <= 3),
    CONSTRAINT chk_gie_snapshot_occupancy
        CHECK(occupancy_percent BETWEEN 0 AND 100
            AND occupancy_percent = occupied_chargers * 25),
    CONSTRAINT chk_gie_snapshot_connections
        CHECK(occupied_chargers = connected_cars),
    CONSTRAINT chk_gie_snapshot_power
        CHECK(delivered_power_kw <= requested_power_kw),
    CONSTRAINT chk_gie_snapshot_energy
        CHECK(ABS(delivered_energy_kwh - delivered_power_kw * 0.25) <= 0.002),
    CONSTRAINT chk_gie_snapshot_humidity
        CHECK(relative_humidity_percent BETWEEN 0 AND 100)
) ENGINE = InnoDB;

CREATE TABLE gie_cycles (
    id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL PRIMARY KEY,
    station_id INT UNSIGNED NOT NULL,
    decision_time DATETIME NOT NULL,
    status ENUM('requested', 'ok', 'degraded', 'blocked', 'unavailable', 'failed')
        NOT NULL DEFAULT 'requested',
    execution_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    request_payload JSON,
    result_payload JSON,
    error_message VARCHAR(1000),
    duration_ms INT UNSIGNED,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE INDEX uq_gie_cycle_station_decision (station_id, decision_time),
    INDEX idx_gie_cycles_station_created (station_id, created_at),
    CONSTRAINT fk_gie_cycle_station
        FOREIGN KEY (station_id) REFERENCES stations(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_gie_cycle_alignment
        CHECK(MINUTE(decision_time) IN (0, 15, 30, 45) AND SECOND(decision_time) = 0)
) ENGINE = InnoDB;

ALTER TABLE charging_commands
    MODIFY COLUMN command_type ENUM(
        'start_charging', 'pause_charging', 'resume_charging', 'stop_charging',
        'unlock_connector', 'sync_status', 'reset_charger', 'request_maintenance',
        'run_checklist', 'schedule_test', 'set_power_limit'
    ) NOT NULL,
    ADD COLUMN gie_cycle_id BIGINT UNSIGNED AFTER requested_by_user_id,
    ADD COLUMN valid_until DATETIME(3) AFTER error_message,
    ADD INDEX idx_commands_gie_cycle (gie_cycle_id),
    ADD CONSTRAINT fk_commands_gie_cycle
        FOREIGN KEY (gie_cycle_id) REFERENCES gie_cycles(id)
        ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE alerts
    MODIFY COLUMN alert_source ENUM(
        'emps', 'sems_plus', 'internal_rule', 'ocpp', 'modbus',
        'payment_provider', 'gie'
    ) NOT NULL;



-- EMPS PLATFORM V2 / 20260929 (additive; requires fresh backup on existing DB)
-- DropForeignKey
ALTER TABLE `payment_intents` DROP FOREIGN KEY `fk_payment_intents_customer`;

-- AlterTable
ALTER TABLE `charger_readings` ADD COLUMN `data_provenance` ENUM('MEASURED', 'CALCULATED', 'EXTERNAL', 'FORECAST', 'SIMULATED', 'IMPORTED') NULL;

-- AlterTable
ALTER TABLE `charging_sessions` ADD COLUMN `guest_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
    ADD COLUMN `rfid_credential_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
    ADD COLUMN `unit_reference` VARCHAR(100) NULL;

-- AlterTable
ALTER TABLE `payment_intents` ADD COLUMN `guest_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
    MODIFY `customer_id` INTEGER UNSIGNED NULL;

-- AlterTable
ALTER TABLE `station_energy_readings` ADD COLUMN `data_provenance` ENUM('MEASURED', 'CALCULATED', 'EXTERNAL', 'FORECAST', 'SIMULATED', 'IMPORTED') NULL,
    ADD COLUMN `import_batch_id` CHAR(36) NULL,
    ADD COLUMN `source_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;

-- AlterTable
ALTER TABLE `station_staff` MODIFY `staff_role` ENUM('owner', 'viewer', 'collector', 'manager', 'operator') NOT NULL DEFAULT 'operator';

-- AlterTable
ALTER TABLE `stations` ADD COLUMN `availability` JSON NULL,
    ADD COLUMN `description` VARCHAR(500) NULL,
    ADD COLUMN `gie_provisioning` JSON NULL,
    ADD COLUMN `guest_allowed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `reservation_policy` JSON NULL,
    ADD COLUMN `reservation_rate_per_hour` DECIMAL(10, 2) NULL,
    ADD COLUMN `review_state` ENUM('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED') NULL,
    ADD COLUMN `technical_review_required` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `venue_type` VARCHAR(50) NULL,
    ADD COLUMN `visibility` ENUM('PUBLIC', 'PRIVATE') NOT NULL DEFAULT 'PUBLIC';

-- AlterTable
ALTER TABLE `users` ADD COLUMN `platform_reviewer` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `presentation_tools` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `terms_accepted_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `station_batteries` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `capacity_kwh` DECIMAL(12, 3) NOT NULL,
    `max_charge_kw` DECIMAL(10, 3) NOT NULL,
    `max_discharge_kw` DECIMAL(10, 3) NOT NULL,
    `soc_percent` DECIMAL(5, 2) NULL,
    `min_soc_percent` DECIMAL(5, 2) NOT NULL DEFAULT 10,
    `max_soc_percent` DECIMAL(5, 2) NOT NULL DEFAULT 95,
    `efficiency` DECIMAL(5, 4) NOT NULL DEFAULT 0.95,
    `manufacturer` VARCHAR(100) NULL,
    `model` VARCHAR(100) NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'CONFIGURED',
    `integration_ref` VARCHAR(150) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `station_batteries_station_id_idx`(`station_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `station_solar_assets` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `installed_kwp` DECIMAL(12, 3) NOT NULL,
    `ac_power_kw` DECIMAL(10, 3) NULL,
    `inverter` VARCHAR(100) NULL,
    `manufacturer` VARCHAR(100) NULL,
    `model` VARCHAR(100) NULL,
    `integration_ref` VARCHAR(150) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `station_solar_assets_station_id_idx`(`station_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `station_photos` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `storage_key` VARCHAR(150) NOT NULL,
    `mime_type` VARCHAR(30) NOT NULL,
    `size_bytes` INTEGER UNSIGNED NOT NULL,
    `position` TINYINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `station_photos_storage_key_key`(`storage_key`),
    UNIQUE INDEX `station_photos_station_id_position_key`(`station_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `station_review_requests` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `submitted_by` INTEGER UNSIGNED NOT NULL,
    `reviewed_by` INTEGER UNSIGNED NULL,
    `state` ENUM('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED') NOT NULL DEFAULT 'PENDING_REVIEW',
    `proposed_config` JSON NOT NULL,
    `reason` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_at` DATETIME(3) NULL,

    INDEX `station_review_requests_station_id_state_idx`(`station_id`, `state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `station_invites` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `role` ENUM('owner', 'viewer', 'collector', 'manager', 'operator') NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `invited_by` INTEGER UNSIGNED NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `accepted_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `station_invites_token_hash_key`(`token_hash`),
    INDEX `station_invites_station_id_email_idx`(`station_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `station_audit_events` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `actor_id` INTEGER UNSIGNED NOT NULL,
    `action` VARCHAR(80) NOT NULL,
    `details` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `station_audit_events_station_id_created_at_idx`(`station_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guest_charge_identities` (
    `id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `charger_id` INTEGER UNSIGNED NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `guest_charge_identities_token_hash_key`(`token_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `charger_reservations` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `charger_id` INTEGER UNSIGNED NOT NULL,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `session_id` BIGINT UNSIGNED NULL,
    `start_at` DATETIME(3) NOT NULL,
    `end_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NULL,
    `status` ENUM('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'USED', 'NO_SHOW') NOT NULL DEFAULT 'PENDING_PAYMENT',
    `fee` DECIMAL(10, 2) NOT NULL,
    `policy_snapshot` JSON NOT NULL,
    `provider` VARCHAR(80) NULL,
    `provider_payment_id` VARCHAR(150) NULL,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `charger_reservations_session_id_key`(`session_id`),
    INDEX `charger_reservations_charger_id_start_at_end_at_status_idx`(`charger_id`, `start_at`, `end_at`, `status`),
    UNIQUE INDEX `charger_reservations_user_id_idempotency_key_key`(`user_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rfid_credentials` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `user_id` INTEGER UNSIGNED NULL,
    `uid_hash` CHAR(64) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `unit_reference` VARCHAR(100) NULL,
    `vehicle_reference` VARCHAR(100) NULL,
    `organization` VARCHAR(100) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `rfid_credentials_station_id_uid_hash_key`(`station_id`, `uid_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `telemetry_sources` (
    `id` CHAR(36) NOT NULL,
    `station_id` INTEGER UNSIGNED NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `kind` VARCHAR(30) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `verified_physical` BOOLEAN NOT NULL DEFAULT false,
    `verified_by` INTEGER UNSIGNED NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `telemetry_sources_token_hash_key`(`token_hash`),
    INDEX `telemetry_sources_station_id_idx`(`station_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `uq_payment_intents_guest_key` ON `payment_intents`(`guest_id`, `idempotency_key`);

-- AddForeignKey
ALTER TABLE `charging_sessions` ADD CONSTRAINT `charging_sessions_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `guest_charge_identities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `charging_sessions` ADD CONSTRAINT `charging_sessions_rfid_credential_id_fkey` FOREIGN KEY (`rfid_credential_id`) REFERENCES `rfid_credentials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_intents` ADD CONSTRAINT `payment_intents_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `guest_charge_identities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_intents` ADD CONSTRAINT `fk_payment_intents_customer` FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_energy_readings` ADD CONSTRAINT `station_energy_readings_source_id_fkey` FOREIGN KEY (`source_id`) REFERENCES `telemetry_sources`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_batteries` ADD CONSTRAINT `station_batteries_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_solar_assets` ADD CONSTRAINT `station_solar_assets_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_photos` ADD CONSTRAINT `station_photos_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_review_requests` ADD CONSTRAINT `station_review_requests_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_invites` ADD CONSTRAINT `station_invites_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_audit_events` ADD CONSTRAINT `station_audit_events_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `charger_reservations` ADD CONSTRAINT `charger_reservations_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `charger_reservations` ADD CONSTRAINT `charger_reservations_charger_id_fkey` FOREIGN KEY (`charger_id`) REFERENCES `chargers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `charger_reservations` ADD CONSTRAINT `charger_reservations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `charger_reservations` ADD CONSTRAINT `charger_reservations_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `charging_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rfid_credentials` ADD CONSTRAINT `rfid_credentials_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rfid_credentials` ADD CONSTRAINT `rfid_credentials_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `telemetry_sources` ADD CONSTRAINT `telemetry_sources_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domain constraints are additive; no historical rows are reclassified.
ALTER TABLE station_batteries ADD CONSTRAINT v2_battery_limits CHECK (capacity_kwh > 0 AND max_charge_kw > 0 AND max_discharge_kw > 0 AND min_soc_percent >= 0 AND max_soc_percent <= 100 AND min_soc_percent < max_soc_percent AND efficiency > 0 AND efficiency <= 1 AND (soc_percent IS NULL OR soc_percent BETWEEN 0 AND 100));
ALTER TABLE station_solar_assets ADD CONSTRAINT v2_solar_limits CHECK (installed_kwp > 0 AND (ac_power_kw IS NULL OR ac_power_kw > 0));
ALTER TABLE station_photos ADD CONSTRAINT v2_photo_position CHECK (position BETWEEN 0 AND 4);
ALTER TABLE charger_reservations ADD CONSTRAINT v2_reservation_window CHECK (end_at > start_at AND fee >= 0);
ALTER TABLE guest_charge_identities ADD CONSTRAINT v2_guest_charger FOREIGN KEY (charger_id) REFERENCES chargers(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve equipment identities when an approved configuration removes solar.
ALTER TABLE station_solar_assets ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'CONFIGURED';
