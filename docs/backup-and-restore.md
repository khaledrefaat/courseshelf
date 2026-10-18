# Back up and restore Courseshelf

## Back up

The Library backup menu is **intentionally hidden** in the current app. The export
helper, validation and tests remain, but there is no exposed backup button.
If the `sqlite3` CLI is available, use the following manual procedure instead.
It is an optional maintenance tool, not a Courseshelf runtime dependency.

1. Resolve any note/progress save warnings, quit Courseshelf fully and stop dev.
   Unsaved failed drafts are not guaranteed to be present in a database backup.
2. Locate the existing database using the paths below.
3. Choose a **new, nonexistent** backup filename in a folder you own, outside
   course folders and app data/config folders. Do not overwrite an older backup.
4. Replace both absolute paths in this command (do not paste the example unchanged):

```sh
sqlite3 -readonly '/absolute/path/to/courseshelf.db' "VACUUM INTO '/absolute/path/to/courseshelf-backup-YYYY-MM-DD.db';"
```

The read-only source open rejects a mistyped/missing source instead of creating an
empty database. SQLite `VACUUM INTO` leaves the source unchanged and creates a
consistent snapshot, including when the source uses WAL. Do not copy only a live
`.db` file while ignoring its WAL.

Unlike the dormant in-app helper, the CLI command does not perform Courseshelf's
target-path safety checks and SQLite can reuse an existing empty target. You must
choose a new destination yourself. Escape any `'` in the SQL destination path as
`''`. See [SQLite's VACUUM INTO documentation](https://www.sqlite.org/lang_vacuum.html).

Verify that the output exists and is non-empty, then run a full integrity check:

```sh
sqlite3 -readonly '/absolute/path/to/backup.db' 'PRAGMA integrity_check;'
```

The result must be `ok`. The in-app helper additionally checks the SQLite file
header; the manual integrity check validates that the CLI output opens as a database.
Interrupted exports may leave incomplete files; do not
use those. Choose a new filename to retry. No backup file is silently overwritten
or automatically deleted.

Backups contain courses, lesson paths, progress, notes and SQL-plugin migration
metadata. They **do not include videos or cover images**, nor the persisted
filesystem grants. Keep the original video folders and back up the app's
`covers/` directory separately if you want to preserve its thumbnails.

## Locate the database and compare row counts

On Ubuntu, the live database is normally
`$XDG_CONFIG_HOME/com.khaled.courseshelf/courseshelf.db`, or
`~/.config/com.khaled.courseshelf/courseshelf.db` when `XDG_CONFIG_HOME` is unset.
The SQL plugin uses the app config directory. Covers use the app data directory,
normally `~/.local/share/com.khaled.courseshelf/covers/` (respecting `XDG_DATA_HOME`).

Replace both example paths below. Prefer comparing immediately after export;
new activity will legitimately change counts. Missing lessons are included.

```sh
sqlite3 -readonly '/absolute/path/to/live/courseshelf.db' "ATTACH DATABASE 'file:/absolute/path/to/backup.db?mode=ro' AS backup; SELECT 'courses', (SELECT COUNT(*) FROM main.courses), (SELECT COUNT(*) FROM backup.courses) UNION ALL SELECT 'lessons', (SELECT COUNT(*) FROM main.lessons), (SELECT COUNT(*) FROM backup.lessons) UNION ALL SELECT 'progress', (SELECT COUNT(*) FROM main.progress), (SELECT COUNT(*) FROM backup.progress) UNION ALL SELECT 'notes', (SELECT COUNT(*) FROM main.notes), (SELECT COUNT(*) FROM backup.notes);"
```

Each line is `table|live count|backup count`. SQL paths containing `'` must escape
it as `''` in the ATTACH string. The attached backup uses a read-only SQLite URI;
encode reserved filename characters such as `?`, `#`, and `%` as `%3F`, `%23`, and
`%25` in that URI. Both opens are read-only so a mistyped path cannot silently
create an empty database.

## Manual restore (no in-app restore yet)

1. Verify the backup with `PRAGMA integrity_check` above. Keep an untouched copy.
2. Quit Courseshelf completely and stop `pnpm tauri dev` if running. Do not
   replace the database while any Courseshelf process is using it.
3. Preserve the current `courseshelf.db` **and any** `courseshelf.db-wal` and
   `courseshelf.db-shm` files together in a separately named recovery folder.
   Move them there rather than deleting them. Keep app permissions/grants and
   covers in place; do not touch video folders.
4. Copy the verified backup to the live database location, naming the copy
   `courseshelf.db`. Ensure no old `-wal` or `-shm` remains beside the replacement
   (those belong with the preserved old database). Preserve your user ownership
   and normal read/write permissions.
5. Relaunch Courseshelf. Check course, lesson, progress and note counts and try
   playback. If a drive moved or a persisted grant is unavailable, use **Locate
   folder**; paths alone do not grant filesystem access. Missing thumbnails can
   be replaced with **Edit course** or recovered from a separate covers backup.
6. If the restore is wrong, quit fully again, preserve the restored files as
   another set, then put the original database/WAL/SHM set back together.

Use backups from the same app version (or a supported earlier schema). Do not
manually edit migration metadata or replace a newer database with an unsupported
schema while the app is running.

Cover cleanup is best-effort. A failed cleanup after editing/removal may leave
an orphaned image in `covers/`. There is no automatic sweep.
