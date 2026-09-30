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

Race lists contain registration-open and active races plus the latest ten finished races, not a complete archive. Preserve server leaderboard order and penalties. `races show --json` includes `origin`, `destination` and the ordered `course` features; entries include `nextFeature` and `nextFeatureDistanceNm` (null when none). Course geometry is not a safe route around land. Boat profiles respect existing visibility rules; `boats profile --json` also includes `weather`, `last_port_call`, `boat_stats` (distance in nm), the latest 20 `passages` and `seas_visited`. Boat `latitude` and `longitude` are signed decimal degrees; missing values are null, not zero. Human tables round to five decimal places; JSON retains API precision. Headings are degrees and speed is knots.

`globe boats show BOAT_UUID --json` is the one call for "how is my boat doing now": boat state (`awa`, `time_since_last_update_seconds`, `in_port`, `crew_role`), `weather` forecast arrays (up to six hourly UTC samples), `weather_now` (forecast interpolated to the current minute; null when no current-hour forecast exists), `weather_units` (wind/current kn, waves m, directions °) and `last_port_call`. Describe weather as a forecast, not a live observation. Boat state is last-known simulation state; `time_since_last_update_seconds` tells how fresh it is. Use the website for maps and Windy. For several boats, `globe boats list --mine --columns name,wind,update-age --json` adds each boat's `weather_now` in one request; weather is only fetched when a weather column (`wind`, `wind-dir`, `current`, `wave`) is requested.

For "what happened", use `globe boats history BOAT_UUID --type logs|port-calls|passages --json` (owned/crewed boats, newest first, `--limit` 1–200, optional `--since` ISO time). Follow `next_cursor` with `--cursor` only when more records are needed. Logs are kept for about a day (`oldest_available_at`); older positions are unavailable, not zero. Arrivals and departures come from port calls, not from anchoring. Do not fetch history for ordinary status questions.

For human tables, use `--columns name,latitude,longitude` or consult the command's `--help` for available columns. This flag does not filter JSON. To provide a website link without opening a browser:

```sh
marineverse globe boats view-3d BOAT_UUID --no-browser --json
marineverse globe boats open BOAT_UUID --no-browser --json
marineverse globe races open RACE_KEY --no-browser --json
```

Omit `--no-browser` when the user wants the page opened on the CLI's machine.
