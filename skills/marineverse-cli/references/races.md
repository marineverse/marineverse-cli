# Globe races and profiles

Use `--json` for machine-readable results and inspect the process exit status. JSON has `schema_version`, `data`, and `meta`, or an `error` object. Help and `--version` are plain text; `version --json` supports structured update checks. Use public race keys and boat UUIDs from returned data; never guess internal database IDs.

```sh
marineverse globe races list --json
marineverse globe races show RACE_KEY --json
marineverse globe races leaderboard RACE_KEY --json
marineverse globe boats profile BOAT_UUID --json
marineverse globe boats list --mine --json
marineverse globe boats show BOAT_UUID --json
```

Race lists contain registration-open and active races plus the latest ten finished races, not a complete archive. Preserve server leaderboard order and penalties. Boat profiles respect existing visibility rules. Boat `latitude` and `longitude` are signed decimal degrees; missing values are null, not zero. Human tables round to five decimal places; JSON retains API precision. Headings are degrees and speed is knots.

For human tables, use `--columns name,latitude,longitude` or consult the command's `--help` for available columns. This flag does not filter JSON. To provide a website link without opening a browser:

```sh
marineverse globe boats view-3d BOAT_UUID --no-browser --json
marineverse globe boats open BOAT_UUID --no-browser --json
marineverse globe races open RACE_KEY --no-browser --json
```

Omit `--no-browser` when the user wants the page opened on the CLI's machine.
