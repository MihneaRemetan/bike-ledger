-- Where a component was mounted over time. components.bike_id stays the CURRENT bike.
-- A ride counts toward a part when it is on a bike the part was mounted on, on a day inside that mount.
CREATE TABLE component_mounts (
  id            SERIAL PRIMARY KEY,
  component_id  INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  bike_id       INTEGER NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
  from_date     DATE    NOT NULL,
  to_date       DATE,
  CHECK (to_date IS NULL OR to_date >= from_date)
);
CREATE INDEX component_mounts_component_idx ON component_mounts(component_id);
CREATE INDEX component_mounts_bike_idx ON component_mounts(bike_id);

INSERT INTO component_mounts (component_id, bike_id, from_date)
SELECT id, bike_id, installed_at FROM components;

-- Recurring maintenance: "do this every N km and/or every N days". Whether it is due is computed, not stored.
CREATE TABLE maintenance_rules (
  id            SERIAL PRIMARY KEY,
  bike_id       INTEGER      NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
  component_id  INTEGER      REFERENCES components(id) ON DELETE CASCADE,
  title         VARCHAR(120) NOT NULL,
  service_type  VARCHAR(20)  NOT NULL CHECK (service_type IN ('REPLACE','CLEAN','ADJUST','REPAIR','INSPECTION')),
  every_km      DOUBLE PRECISION CHECK (every_km > 0),
  every_days    INTEGER          CHECK (every_days > 0),
  start_date    DATE         NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (every_km IS NOT NULL OR every_days IS NOT NULL)
);
CREATE INDEX maintenance_rules_bike_idx ON maintenance_rules(bike_id);
