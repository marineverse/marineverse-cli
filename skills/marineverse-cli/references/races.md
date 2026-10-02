# Racing and boat profiles

Use `--json` for machine-readable results and inspect the process exit status. JSON has `schema_version`, `data`, and `meta`, or an `error` object. Help and `--version` are plain text; `version --json` supports structured update checks. Use public race keys and boat UUIDs from returned data; never guess internal database IDs.

## Multiplayer and Daily Race Practice

Use `racing multiplayer` for multiplayer results and `racing drp` for Daily Race Practice. Public discovery and rankings need no login:

```sh
marineverse racing leagues list --json
marineverse racing multiplayer races list --boat yacht --json
marineverse racing multiplayer schedule --json
marineverse racing multiplayer ratings list --boat yacht --json
marineverse racing drp races list --league LEAGUE_KEY --json
marineverse racing drp ratings list --league LEAGUE_KEY --json
marineverse racing drp series list --league LEAGUE_KEY --json
marineverse racing drp series list --league LEAGUE_KEY --type weekly --status past --json
marineverse racing tournaments list --json
marineverse racing tournaments show TOURNAMENT_KEY --json
marineverse racing drp races show RACE_KEY --json
marineverse racing drp races leaderboard RACE_KEY --json
marineverse racing drp races summary RACE_KEY --json
marineverse racing drp races stats RACE_KEY --json
marineverse racing drp entries show ENTRY_KEY --json
marineverse racing drp entries legs ENTRY_KEY --json
marineverse racing drp entries compare ENTRY_KEY OTHER_ENTRY_KEY --json
marineverse racing drp series show SERIES_KEY --json
marineverse racing drp series leaderboard SERIES_KEY --json
```

The race and entry commands also work under `racing multiplayer`. Entry `stats` and `maneuvers` read those performance sections. Comparisons return real stats, differences, legs and a visual comparison link, not a stored AI comparison. Race details return an existing AI summary when visible; null means no summary is available. Reads never generate AI text. Preserve server ranking order, points, penalties and handicaps. `race_time_seconds` and numeric leg start/end timestamps are seconds; speeds are knots; recorded leg `distance_traveled` is meters. Preserve missing values rather than guessing zeros.

DRP rankings accept `--type rating|wins|streaks`, `--country AU`, and `--date YYYY-MM-DD` for rating. Multiplayer rankings accept `--type rating|participation`, `--boat`, `--country`, and `--days 30` for recent participation. Both support region, subregion, state and city filters. Race lists, series lists and rankings accept `--page`; read additional pages only when needed. `multiplayer schedule` reads the server-owned community schedule from the MarineVerse API. Preserve returned next UTC starts, volunteers and each IANA `time_zone` when converting to the sailor's time zone.

Use normal login for `racing dashboard`, `racing leagues list --mine`, and `racing multiplayer|drp|globe races list --mine`. These show the user's racing context and recent races. League, race, series and tournament lists and details use a saved session when present for permitted personal context; race/entry detail also lets the sailor inspect their own unrevealed entry. Invalid saved sessions remain errors, not guest fallbacks. Respect visibility errors and reveal times; restricted opponents' analytics are unavailable, not missing telemetry to reconstruct.

For personal progress, actual attempts and rating causes:

```sh
marineverse racing dashboard --json
marineverse racing today --json
marineverse racing yesterday --json
marineverse racing activity --type drp --since 2026-09-01 --until 2026-09-30 --json
marineverse racing drp ratings show --json
marineverse racing drp ratings show --league LEAGUE_KEY --json
marineverse racing drp ratings explain --json
marineverse racing multiplayer ratings show --boat yacht --json
marineverse racing drp entries list --mine --since 2026-09-30T00:00:00Z --json
marineverse racing drp entries list --mine --race RACE_KEY --page 2 --json
marineverse racing tournaments list --mine --json
```

Ratings default to the signed-in sailor and global DRP rating; `--profile PROFILE_KEY` selects a public sailor. Label the actual snapshot `date` separately from `requested_date`. DRP explanations preserve calculator logs, each race's points change and the reconciliation result. Multiplayer `history_available: false` means no historical change can be claimed. `activity` preserves every calendar day and the account time zone; zero counts are real zeros. DRP activity counts races, while MarineVerse activity counts sailing days. Individual entry history includes all attempts, rather than one summary per race.

For a league's current and past series, use `series list --league KEY --type weekly|monthly|seasonal --status current|past|upcoming` and follow pagination. Status uses start/end dates, not creation date. Tournament reads include registration state, participants and scheduled matches; listing a tournament does not authorize registration or organizer changes. Weekly session `next_start` is a concrete UTC occurrence calculated with the session's IANA zone and daylight saving, sorted soonest first.

Use `racing today` or `racing yesterday` for a single daily brief. The activity is
the actual account-local calendar day, rather than each league's latest race.
Today includes available practice and community/Globe opportunities; unavailable
optional sections remain explicitly unavailable. Current owned/crewed Globe
participation does not prove historical boat ownership or activity yesterday.
Activity contains at most 100 attempt summaries per mode, with `total_entries`
and `truncated`. For a complete day, page through `racing drp entries list --mine
--page N --json` (or `multiplayer`), comparing `created_at` in the returned account
time zone. Stop once entries are older than that local date. Follow an entry key
with `entries show` for full performance details or a race key with `races show`
for ranked results and points. Blocked practice and its reasons remain visible in
`racing dashboard`; today's opportunities contain only races you can still enter.

Racing lists, ratings, results and entry legs support `--columns` for human
tables, such as `ratings list --columns name,points,change`. Check command help
for valid names; JSON keeps the full result. `series leaderboard` and `series
show` both return standings, qualifications and race contributions.
Human leg duration is computed from numeric `end_time - start_time` in seconds,
or an explicit `duration_seconds`, labelled `s`. A raw `duration` is shown as
recorded with units unspecified, not seconds, and stays unchanged in JSON.

Canonical replay links are returned by the API:

```sh
marineverse racing drp races links RACE_KEY --json
marineverse racing drp races open RACE_KEY --view map_3d --no-browser --json
marineverse racing multiplayer entries open ENTRY_KEY --view chart --no-browser --json
marineverse racing drp entries compare ENTRY_KEY OTHER_ENTRY_KEY --open --no-browser --json
```

Views are `web`, `map_2d`, `map_3d` and `chart` when visible. `links` only reads URLs. Use `open` or `compare --open` only when the user asks to open a page; omit `--no-browser` to launch on the CLI's machine. Keep returned canonical URLs.

## Globe races and boats

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
