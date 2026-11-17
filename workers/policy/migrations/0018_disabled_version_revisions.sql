CREATE TABLE IF NOT EXISTS disabled_version_revisions (
  version TEXT PRIMARY KEY CHECK (version = lower(version)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_disabled_versions_lookup ON disabled_versions(lower(version));

INSERT OR IGNORE INTO disabled_version_revisions (version, revision)
SELECT lower(version), 1 FROM disabled_versions GROUP BY lower(version);

CREATE TRIGGER IF NOT EXISTS disabled_version_revision_insert
AFTER INSERT ON disabled_versions
BEGIN
  INSERT INTO disabled_version_revisions (version, revision)
  VALUES (lower(NEW.version), 1)
  ON CONFLICT(version) DO UPDATE SET
    revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
END;

CREATE TRIGGER IF NOT EXISTS disabled_version_revision_delete
AFTER DELETE ON disabled_versions
BEGIN
  INSERT INTO disabled_version_revisions (version, revision)
  VALUES (lower(OLD.version), 1)
  ON CONFLICT(version) DO UPDATE SET
    revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
END;

CREATE TRIGGER IF NOT EXISTS disabled_version_revision_update
AFTER UPDATE ON disabled_versions
BEGIN
  INSERT INTO disabled_version_revisions (version, revision)
  VALUES (lower(OLD.version), 1)
  ON CONFLICT(version) DO UPDATE SET
    revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
  INSERT INTO disabled_version_revisions (version, revision)
  SELECT lower(NEW.version), 1 WHERE lower(OLD.version) <> lower(NEW.version)
  ON CONFLICT(version) DO UPDATE SET
    revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
END;
