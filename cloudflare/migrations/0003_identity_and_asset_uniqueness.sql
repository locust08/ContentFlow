PRAGMA foreign_keys = ON;

UPDATE cf_users
SET auth_user_id = NULL
WHERE auth_user_id IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid)
    FROM cf_users
    WHERE auth_user_id IS NOT NULL
    GROUP BY auth_user_id
  );

UPDATE cf_assets
SET local_path = name
WHERE local_path IS NULL
  AND object_key LIKE 'objects/sha256/%';

DELETE FROM cf_assets
WHERE local_path IS NOT NULL
  AND object_key IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid)
    FROM cf_assets
    WHERE local_path IS NOT NULL AND object_key IS NOT NULL
    GROUP BY project_name, local_path, object_key
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_users_auth_user_id_unique
  ON cf_users(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_assets_registration_unique
  ON cf_assets(project_name, local_path, object_key)
  WHERE local_path IS NOT NULL AND object_key IS NOT NULL;
