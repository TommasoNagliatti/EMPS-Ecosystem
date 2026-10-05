-- Preserve equipment identities when an approved configuration removes solar.
ALTER TABLE station_solar_assets ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'CONFIGURED';
