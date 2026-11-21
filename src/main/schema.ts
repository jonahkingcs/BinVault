import type { DatabaseSync } from 'node:sqlite'

function createVersionOne(db: DatabaseSync): void {
  db.exec(`
    BEGIN;
    CREATE TABLE roots (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL,
      path_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      scanned_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE folders (
      id INTEGER PRIMARY KEY,
      root_id INTEGER NOT NULL REFERENCES roots(id),
      parent_id INTEGER REFERENCES folders(id),
      relative_path TEXT NOT NULL,
      path_key TEXT NOT NULL,
      name TEXT NOT NULL,
      present INTEGER NOT NULL DEFAULT 1 CHECK (present IN (0, 1)),
      UNIQUE (root_id, path_key)
    ) STRICT;
    CREATE INDEX folder_children ON folders(parent_id, present);
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY,
      absolute_path TEXT NOT NULL,
      path_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      extension TEXT NOT NULL,
      kind TEXT NOT NULL,
      category TEXT NOT NULL,
      size INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      modified_at INTEGER NOT NULL,
      favourite INTEGER NOT NULL DEFAULT 0 CHECK (favourite IN (0, 1))
    ) STRICT;
    CREATE INDEX asset_categories ON assets(category);
    CREATE INDEX asset_added ON assets(added_at);
    CREATE INDEX asset_names ON assets(name COLLATE NOCASE);
    CREATE TABLE locations (
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      root_id INTEGER NOT NULL REFERENCES roots(id),
      folder_id INTEGER NOT NULL REFERENCES folders(id),
      available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
      PRIMARY KEY (asset_id, root_id)
    ) STRICT;
    CREATE INDEX root_locations ON locations(root_id, available, folder_id);
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE
    ) STRICT;
    CREATE TABLE asset_tags (
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      tag_id INTEGER NOT NULL REFERENCES tags(id),
      PRIMARY KEY (asset_id, tag_id)
    ) STRICT;
    CREATE VIRTUAL TABLE asset_search USING fts5(
      name, folder_path, category, tags, tokenize='trigram case_sensitive 1'
    );
    PRAGMA user_version = 1;
    COMMIT;
  `)
}

export function migrate(db: DatabaseSync): void {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version)
  if (version > 3) throw new Error('This library was created by a newer version of Binwise.')
  if (version === 0) createVersionOne(db)
  if (version < 2) db.exec(`
    BEGIN;
    ALTER TABLE assets ADD COLUMN notes TEXT NOT NULL DEFAULT '';
    PRAGMA user_version = 2;
    COMMIT;
  `)
  if (version < 3) db.exec(`
    BEGIN;
    ALTER TABLE assets ADD COLUMN file_identity TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN confirmed_missing INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_missing IN (0, 1));
    CREATE INDEX missing_identity ON assets(file_identity) WHERE confirmed_missing = 1 AND file_identity <> '';
    PRAGMA user_version = 3;
    COMMIT;
  `)
}
