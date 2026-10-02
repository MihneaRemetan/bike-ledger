CREATE TABLE users (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(80)  NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE bikes (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(80)  NOT NULL,
  brand       VARCHAR(120),
  model       VARCHAR(120),
  type        VARCHAR(20)  NOT NULL CHECK (type IN ('ROAD','MTB','GRAVEL','CITY','OTHER')),
  year        INTEGER      CHECK (year BETWEEN 1900 AND 2100),
  notes       TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX bikes_user_idx ON bikes(user_id);

CREATE TABLE components (
  id            SERIAL PRIMARY KEY,
  bike_id       INTEGER          NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
  type          VARCHAR(20)      NOT NULL CHECK (type IN ('CHAIN','CASSETTE','CHAINRING','TYRE_FRONT','TYRE_REAR',
                                                         'BRAKE_PADS','BRAKE_ROTORS','CABLES','BAR_TAPE','OTHER')),
  brand         VARCHAR(120),
  model         VARCHAR(120),
  installed_at  DATE             NOT NULL,
  initial_km    DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (initial_km >= 0),
  max_km        DOUBLE PRECISION NOT NULL CHECK (max_km > 0),
  price         DOUBLE PRECISION CHECK (price >= 0),
  retired_at    DATE,
  created_at    TIMESTAMPTZ      NOT NULL DEFAULT now(),
  CHECK (retired_at IS NULL OR retired_at >= installed_at)
);
CREATE INDEX components_bike_idx ON components(bike_id);

CREATE TABLE rides (
  id            SERIAL PRIMARY KEY,
  bike_id       INTEGER          NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
  date          TIMESTAMPTZ      NOT NULL,
  title         VARCHAR(120),
  distance_km   DOUBLE PRECISION NOT NULL CHECK (distance_km > 0),
  duration_min  INTEGER          CHECK (duration_min >= 0),
  elevation_m   INTEGER          CHECK (elevation_m >= 0),
  source        VARCHAR(10)      NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','GPX')),
  notes         TEXT,
  created_at    TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX rides_bike_date_idx ON rides(bike_id, date);

CREATE TABLE services (
  id            SERIAL PRIMARY KEY,
  bike_id       INTEGER          NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
  component_id  INTEGER          REFERENCES components(id) ON DELETE SET NULL,
  date          DATE             NOT NULL,
  type          VARCHAR(20)      NOT NULL CHECK (type IN ('REPLACE','CLEAN','ADJUST','REPAIR','INSPECTION')),
  cost          DOUBLE PRECISION CHECK (cost >= 0),
  notes         TEXT,
  created_at    TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX services_bike_idx ON services(bike_id);
