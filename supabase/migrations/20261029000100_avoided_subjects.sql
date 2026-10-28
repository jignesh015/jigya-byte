BEGIN;
CREATE TABLE IF NOT EXISTS jigyabyte.avoided_subjects (
  device_id text NOT NULL,
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 280),
  topic_ids text NOT NULL,
  PRIMARY KEY (device_id, subject)
);
ALTER TABLE jigyabyte.avoided_subjects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON jigyabyte.avoided_subjects FROM PUBLIC, anon, authenticated;
COMMIT;
