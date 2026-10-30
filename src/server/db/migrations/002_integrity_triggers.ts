export const migration002IntegrityTriggers = {
  version: 2,
  name: "immutable_release_and_history_guards",
  sql: `
CREATE TRIGGER settings_releases_no_update
BEFORE UPDATE ON settings_releases
BEGIN
  SELECT RAISE(ABORT, 'settings releases are immutable');
END;

CREATE TRIGGER settings_releases_no_delete
BEFORE DELETE ON settings_releases
BEGIN
  SELECT RAISE(ABORT, 'settings releases are immutable');
END;

CREATE TRIGGER settings_history_no_update
BEFORE UPDATE ON settings_history
BEGIN
  SELECT RAISE(ABORT, 'settings history is immutable');
END;

CREATE TRIGGER settings_history_no_delete
BEFORE DELETE ON settings_history
BEGIN
  SELECT RAISE(ABORT, 'settings history is immutable');
END;

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are immutable');
END;

CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are immutable');
END;
`,
} as const;
