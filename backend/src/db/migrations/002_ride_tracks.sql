-- Simplified GPS track of a ride, as [[lat, lon], ...]. Kept apart from rides so ride lists stay light.
CREATE TABLE ride_tracks (
  ride_id  INTEGER PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  points   JSONB NOT NULL
);
