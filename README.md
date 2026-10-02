# MarineVerse CLI

Explore Multiplayer, Daily Race Practice and Globe racing, read your sailing progress, and control boats you own or crew.

This is a V1 preview. The public production OAuth client ID is included.

## Install from npm

Use Node 24 or newer:

```sh
npm install -g @marineverse/cli
marineverse --help
marineverse globe races list
marineverse login
```

Public races and boat profiles do not require login. In the checkout examples below, replace `node ./bin/marineverse.js` with `marineverse` when using the installed package.

## Set up with your agent

Give Codex or Claude Code [the MarineVerse CLI skill](skills/marineverse-cli/SKILL.md) and ask:

> Install this MarineVerse CLI skill for yourself, then use it to install and configure the MarineVerse CLI. Verify it by listing public Globe races. Let me complete browser login if my next task needs an account.

The skill routes to focused references for setup and each sailing workflow. Give the agent the whole skill directory or repository link so it can read those references before the CLI is installed. It installs the published npm package, or uses an existing checkout when requested. Node 24+ is required; existing configuration and custom skills are preserved.

The shareable skill URL is:

```text
https://raw.githubusercontent.com/marineverse/marineverse-cli/master/skills/marineverse-cli/SKILL.md
```

For a stable release, replace `master` with its tag or commit. Linked references must come from that same ref. You can also give your agent the local `skills/marineverse-cli/` directory and checkout path.

Once the CLI is available, these helpers install the bundled skill into the current user's agent directory:

```sh
node ./bin/marineverse.js skills install --agent codex
node ./bin/marineverse.js skills install --agent claude
node ./bin/marineverse.js skills update --agent codex
node ./bin/marineverse.js skills uninstall --agent codex
```

Add `--scope project` to use the current project's `.agents/skills/` (Codex) or `.claude/skills/` (Claude Code). Personal installs use those directories under your home folder. The skill directory is named `marineverse-cli`; existing `marineverse` skills are preserved. The helpers work offline, include all linked references and legal notices, and never install the CLI or log in automatically. Updates use the skill bundled with the installed CLI; upgrade the CLI first to obtain a newer skill. Modified, manually installed, symlinked, or extra-file copies are preserved and reported as conflicts. Only installations created by the helper can be updated or removed by it. `skills show` prints the entrypoint and links to focused references without installing anything.

## Run from this checkout

Use Node 24 or newer. With nvm, run `nvm use` first.

```sh
npm ci
npm run build
node ./bin/marineverse.js
node ./bin/marineverse.js --help
node ./bin/marineverse.js help
node ./bin/marineverse.js globe boats --help
```

No installation or global linking is needed. From any directory, pass the full path to `bin/marineverse.js` to Node. Re-run `npm run build` after source changes. Optionally run `npm link` to make `marineverse` available as a shell command.

## Localhost setup

Run the API on port 3000 and the frontend on port 3005. The frontend's `MARINEVERSE_API` must be `http://localhost:3000`, so browser login uses the same environment as the CLI.

An API operator registers the dedicated public OAuth application using the server's `marineverse_cli:register` task. It prints a public client ID; no client secret is needed. Configure that ID:

```sh
node ./bin/marineverse.js config set local --api-url http://localhost:3000 --web-url http://localhost:3005 --client-id YOUR_LOCAL_CLIENT_ID
node ./bin/marineverse.js config show
```

`config set` selects the saved environment. Use `config use local` or `--env local` to select it later. No command falls back from localhost to production.

## Version checks and upgrades

```sh
marineverse --version  # Installed version; works offline
marineverse version    # Check for a newer release and show upgrade instructions
marineverse upgrade    # Upgrade using npm or Homebrew
```

To try them from a source checkout, use `node ./bin/marineverse.js version` or `node ./bin/marineverse.js upgrade` after `npm run build`.

A newly published npm release can take a few minutes to become available. If an upgrade reports that the MarineVerse CLI version or tarball is missing, wait a few minutes and run `marineverse upgrade` again.

The CLI detects how the running copy was installed and upgrades that installation. npm project installs are updated in their project; global installs retain their prefix. Source checkouts and temporary npx installs receive instructions instead. Homebrew releases may follow npm releases. Version checks make one anonymous request to npm with a three-second timeout; they do not run during other commands. `--json` remains available for agents, with package-manager output on stderr. No automatic upgrades, login, or extra settings are needed.

## Profile, progress, and stats

Use normal login for all account features:

```sh
marineverse login
marineverse profile show
marineverse progress show
marineverse stats distance
marineverse stats distance --boat yacht --json
```

`profile show` includes your display name, public UUID, country, time zone, sailing experience, and interests. Progress shows tutorial completion, onboarding state, and your next step. Distance stats show overall totals per boat type in nautical miles and minutes, not monthly history. JSON retains full numeric precision; missing totals stay null.

Use `progress show --columns name,status` or `stats distance --columns boat,distance` to choose table columns. `profile open`, `progress open`, and `stats open` open the matching website pages; add `--no-browser` to print the URL. These website commands use the browser's own session.

Login handles all required permissions. If an older session needs updated permissions, run `marineverse login` again. No extra feature settings are needed.

## Racing

Explore recent races and public rankings, then use returned public keys to read results and performance:

```sh
marineverse racing leagues list
marineverse racing multiplayer races list --boat yacht
marineverse racing multiplayer schedule
marineverse racing multiplayer ratings list --boat yacht
marineverse racing drp races list --league LEAGUE_KEY
marineverse racing drp ratings list --league LEAGUE_KEY --country AU
marineverse racing drp series list --league LEAGUE_KEY
marineverse racing drp series list --league LEAGUE_KEY --type monthly --status past
marineverse racing tournaments list
marineverse racing tournaments show TOURNAMENT_KEY --json
marineverse racing drp races show RACE_KEY --json
marineverse racing drp races leaderboard RACE_KEY
marineverse racing drp races summary RACE_KEY
marineverse racing drp races stats RACE_KEY
marineverse racing drp entries show ENTRY_KEY --json
marineverse racing drp entries legs ENTRY_KEY
marineverse racing drp entries compare ENTRY_KEY OTHER_ENTRY_KEY --json
marineverse racing drp series show SERIES_KEY --json
marineverse racing drp series leaderboard SERIES_KEY
```

Multiplayer supports the same race and entry commands. Entry `stats` and `maneuvers` read individual performance sections. Comparisons return the two entries, their real stat differences, race legs and a visual comparison link. Race details return existing AI summaries when visible; comparisons do not return stored AI reports. Reading results never generates a summary. Preserve server ranking order, points, handicaps and penalties. Race times and numeric leg start/end timestamps are seconds, speeds knots and recorded leg distances meters; JSON preserves precision and missing values. Human leg duration uses numeric end minus start, or explicit `duration_seconds`, labelled `s`. Raw `duration` is shown as recorded with units unspecified and stays unchanged in JSON.

DRP rankings support `--type rating|wins|streaks`; `--date YYYY-MM-DD` selects a rating date. Multiplayer rankings support `--type rating|participation`, with `--days 30` for recent participation. Rankings support country, region, subregion, state and city filters. Listings and rankings support `--page` for more history. `multiplayer schedule` reads the MarineVerse API's regular community sessions with their local times, IANA time zones, next UTC starts and volunteers. Public discovery needs no login. League, race, series and tournament reads use a saved session when present to include permitted personal context. Premium unrevealed DRP opponents' results stay hidden; Intro can expose basic live standings, but opponents' detailed analytics remain restricted until reveal. A saved login can reveal your own entry.

Normal login enables your racing dashboard and personal lists:

```sh
marineverse login
marineverse racing dashboard --json
marineverse racing today --json
marineverse racing yesterday --json
marineverse racing activity --type drp --since 2026-09-01 --until 2026-09-30 --json
marineverse racing drp ratings show
marineverse racing drp ratings show --league LEAGUE_KEY
marineverse racing drp ratings explain
marineverse racing multiplayer ratings show --boat yacht
marineverse racing leagues list --mine
marineverse racing multiplayer races list --mine
marineverse racing drp races list --mine
marineverse racing globe races list --mine
marineverse racing drp entries list --mine --since 2026-09-30T00:00:00Z
marineverse racing drp entries list --mine --race RACE_KEY --page 2
marineverse racing tournaments list --mine
```

`ratings show` reads your own rating by default; `--profile PROFILE_KEY` reads a public sailor. DRP defaults to the global rating, with `--league` for league ratings. The result labels the requested date and the actual rating snapshot date; an older snapshot is not today's result. `ratings explain` shows the calculator's per-race contributions and whether they reconcile with the saved points change. Multiplayer returns the stored boat rating; historical changes remain unavailable when the source has no history.

`activity` returns your calendar's daily counts and streak totals in your account's time zone, including zero-activity dates in JSON. `entries list --mine` returns individual attempts with optional `--since` and `--page`. Series lists support `--type weekly|monthly|seasonal` and `--status current|past|upcoming`, based on series start/end dates. Tournament details include participants, registration state and scheduled matches.

`racing today` combines your day's attempts with available DRP practice, upcoming community sessions and Globe opportunities. `racing yesterday` reports yesterday's actual calendar activity. Dates use your account time zone; current owned/crewed Globe participation is labelled separately and does not prove a boat was yours yesterday. An unavailable community schedule is reported as unavailable.

To share a canonical visual replay, print the returned links or explicitly open a view:

```sh
marineverse racing drp races links RACE_KEY --json
marineverse racing drp races open RACE_KEY --view map_3d
marineverse racing multiplayer entries open ENTRY_KEY --view chart --no-browser
marineverse racing drp entries compare ENTRY_KEY OTHER_ENTRY_KEY --open
```

Views are `web`, `map_2d`, `map_3d` and `chart` where available. `links` prints URLs; only `open` or `compare --open` launches a browser. Add `--no-browser` to print the selected URL. Existing `globe races` commands remain available.

Racing lists, standings, race results and entry legs support ordered table
columns, for example `racing drp ratings list --columns name,points,change`.
Check the command's help for supported columns; this never filters JSON.

## Useful links

```sh
marineverse links                 # List useful destinations
marineverse links url dashboard   # Print a named URL
marineverse links open try-sailing
marineverse links list --json
```

Names are `website`, `llms`, `dashboard`, `try-sailing`, `history`, `links`, `steam`, `quest`, `cli`, `mcp`, and `discord`. These commands use public production URLs and work without login, API access, or environment configuration. Add `--no-browser` to `links open` to print the URL.

## Discord community

```sh
marineverse discord open  # Open the invite in your browser
marineverse discord url   # Print https://discord.gg/marineverse
```

Both commands work without login. Add `--json` for structured output, or use `discord open --no-browser` to print the URL without opening a browser.

## Feedback and roadmap

Browse public boards, search posts, and read discussions without logging in:

```sh
marineverse feedback roadmap
marineverse feedback boards list
marineverse feedback posts list BOARD_SLUG --search "docking" --sort top
marineverse feedback posts suggested BOARD_SLUG --title "A docking idea" --description "Details"
marineverse feedback posts show BOARD_SLUG POST_SLUG
marineverse feedback boards feed BOARD_SLUG --types posts,comments --page 2
marineverse feedback posts open BOARD_SLUG POST_SLUG
```

Use board and post slugs from the results. Post details include the post UUID, voters, related posts, comments, and replies. Lists support `--page`, `--sort trending|top|new`, and `--filter`; check `feedback posts list --help` for filters. The roadmap shows up to 20 posts per status, as on the website. Add `--json` for complete structured results or `--no-browser` to an `open` command to print its URL.

`posts suggested` finds up to five similar posts before you publish. Signed-in suggestions use the website's semantic search; anonymous suggestions use text search. Suggestions are never automatically retried.

Normal login enables your vote state, `--filter mine`, `--filter upvoted_by_me`, and contributions:

```sh
marineverse login
marineverse feedback posts upvote BOARD_SLUG POST_SLUG
marineverse feedback posts unvote BOARD_SLUG POST_SLUG
marineverse feedback posts create BOARD_SLUG --title "A sailing idea" --description "Details of the idea"
marineverse feedback posts update BOARD_SLUG POST_SLUG --title "Updated title" --description "Updated details"
marineverse feedback comments create POST_UUID --content "My suggestion"
marineverse feedback comments create POST_UUID --reply-to COMMENT_UUID --content "A reply"
marineverse feedback comments update COMMENT_UUID --content "Updated comment"
marineverse feedback comments upvote COMMENT_UUID
marineverse feedback comments unvote COMMENT_UUID
marineverse feedback comments delete COMMENT_UUID
```

Creating a post also upvotes it. You can edit your own posts and edit or delete your own comments; deleting a comment also removes its replies. Replies are one level deep. Merged posts are read-only. Private boards are not exposed. Writes are never automatically retried.

Operators: deploy the v3 feedback API and frontend OAuth permission descriptions, then run the server's `marineverse_cli:register` task to add `feedback_read` and `feedback_write` to the existing CLI application. No database migration is needed for feedback. Existing CLI users run `marineverse login` again to grant the new permissions.

## Find sailing clubs and schools

Discover real clubs, schools, Sailability chapters, federations, class associations and teams without login:

```sh
marineverse groups search "Melbourne" --type sailing_school
marineverse groups search "Royal Yachting Association" --json
marineverse groups search --latitude -37.8 --longitude 144.9 --radius-km 50 --country AU
```

Results include each organization's name, description and canonical MarineVerse page. Nearby results include distance in kilometers. Use returned links to review details; the directory is not exhaustive. Name/city searches can include organizations without mapped locations. Coordinates must be paired signed degrees; never invent a location or distance. Radius defaults to 50 km with coordinates and accepts 1–500; an explicit radius requires coordinates. Queries accept up to 200 characters. `--limit` defaults to 10 and accepts 1–50; `--country` is an ISO two-letter code. Types are `yacht_club`, `sailing_school`, `sailability_chapter`, `federation`, `class_association`, `team` and `other`.

List and manage your club memberships with normal login:

```sh
marineverse login
marineverse groups list --json
marineverse groups join CLUB_UUID_OR_SLUG --message "I'd like to join your club."
marineverse groups leave CLUB_UUID_OR_SLUG
```

Use a public UUID or slug returned by search or your club list. `clubs` is an alias for `groups`. The list includes pending requests. Open clubs join immediately; approval-required clubs create a pending request; invite-only clubs refuse joining. Join messages accept up to 10,000 characters. Leaving removes an active membership; pending request cancellation is unsupported, and the last admin cannot leave. These account operations require login. If an older session needs updated permissions, run `marineverse login` again.

Operators: deploy the club membership API and frontend consent descriptions, then run `bin/rails marineverse_cli:register` to add `clubs_read` and `clubs_write` to the existing CLI application.

## Public FAQs, sailing terms and history

```sh
marineverse faq                         # Discover public FAQ topics
marineverse terms show "apparent wind" # Read a sailing glossary definition
marineverse terms search "wind"        # Search terms and definitions
marineverse terms list --page 2         # Browse the glossary alphabetically
marineverse faq marineverse-sailing-club # Read a topic from the catalog
marineverse history --limit 5
marineverse sailing-club changelog latest
marineverse sailing-club changelog version 2.9.7
marineverse sailing-club changelog list --from-version 2.4.0 --to-version 2.9.7
marineverse sailing-club release-notes list --from-date 2025-01-01 --to-date 2025-12-31
marineverse sailing-club changelog list --all
marineverse content search "multiplayer" --json
```

These guest commands read first-party FAQs and Sailing Club updates without login. Answers retain their source URLs and links; JSON includes the original rich content. `history` shows the latest ten major updates and patch notes by default. Search is a keyword search across FAQs and history, with five results by default. Both accept `--limit 1` through `20`; FAQ details, history, and search accept `--locale en-US` (unsupported languages fall back to English).

`terms show` looks up an exact glossary term, ignoring case. `terms search` searches published terms and definitions; `terms list` browses alphabetically. Lists and searches default to 20 definitions and accept `--limit 1` through `20` and `--page`. All glossary commands work without login and include their source URL.

Search includes English alongside the requested language and reports the actual language of each result, without repeating the same question or release.

`sailing-club changelog` (also `release-notes` or `history`) reads application release notes only, with ten recent releases by default. Version and ISO date ranges include both endpoints; `latest` uses the release date. `list --all` returns the complete archive. These are Sailing Club releases, separate from the CLI's own version.

Use public content for product, setup, and release questions; use the knowledge base or MarineVerse AI for deeper sailing guidance.

## Knowledge base and AI

```sh
marineverse login
marineverse kb search "How do I reef?"
marineverse kb search "Globe sail controls" --limit 3 --json
marineverse kb show ARTICLE_UUID
marineverse ai ask "How can I improve my sailing?"
```

`knowledge-base` is an alias for `kb`. Search returns matching article titles, excerpts, and UUIDs; `show` returns the full article. Both KB and AI require an active MarineVerse membership. If needed, [manage your membership](https://www.marineverse.com/my-profile?tab=billing).

`ai ask` uses the same assistant as the website.

Articles default to `public` (available to members). `admin` articles are only available to admins, and `internal` articles are used by AI but never returned by `kb search/show`. Internal content may inform an AI answer; this visibility is not a place to store secrets.

### Operator rollout

Deploy the server changes and run `bin/rails db:migrate` to add article UUIDs and visibility. Existing articles become public; review their visibility in the admin before making the KB endpoints available to members. Then run `bin/rails marineverse_cli:register` in each target environment. This updates the existing CLI application without changing its public client ID, adding `kb_read` and `ai_ask` to its permissions. Deploy the frontend consent descriptions. Users then run normal `marineverse login` again.

The authenticated v3 endpoints are `POST /api/v3/knowledge_base/search` (`query`, optional integer `limit`, default 5, maximum 10), `GET /api/v3/knowledge_base/:uuid`, and `POST /api/v3/ai/ask` (`question`). Search accepts up to 2,000 characters; AI accepts up to 8,000. Search and AI use POST. They allow up to 120 seconds client-side, subject to the server's AI request timeout. Requests are limited to 10 per minute per account per controller using the server's Rack::Attack cache store; use a shared cache to enforce this across workers.

## Try it

Public commands require no login, and never send stored credentials:

```sh
node ./bin/marineverse.js --env local globe races list
node ./bin/marineverse.js --env local globe races show RACE_PUBLIC_KEY
node ./bin/marineverse.js --env local globe races leaderboard RACE_PUBLIC_KEY --json
node ./bin/marineverse.js --env local globe boats profile BOAT_UUID
```

Copy race keys and boat UUIDs from command output. The race list includes registration-open, active, and the latest ten finished races. Private boat profiles retain their normal access restrictions.

`races show --json` also includes the race `origin`, `destination` (name and position), and `course` (the ordered waypoints, gates, and marks; `features` is empty for a direct race). Each leaderboard entry in `show` and `leaderboard` JSON includes `nextFeature` (id, kind, name, sequence) alongside `nextFeatureDistanceNm`; both are `null` when there is no next feature.

Boat profiles, lists, details, update results, and leaderboards include latitude/longitude columns by default in signed decimal degrees (five decimal places). JSON boat objects expose `latitude` and `longitude` at the API's full precision, including when the public API uses `p_lat`/`p_lng`. Missing coordinates display as `—` (`null` in JSON), never a guessed position.

Choose table columns and their order with `--columns`. Each table command's `--help` lists its available fields. Without this flag, the default columns are shown. JSON always retains the complete result.

```sh
node ./bin/marineverse.js globe boats profile BOAT_UUID --columns name,latitude,longitude
node ./bin/marineverse.js globe boats list --mine --columns name,heading,speed,latitude,longitude
node ./bin/marineverse.js globe races list --columns key,name,state
node ./bin/marineverse.js globe races leaderboard RACE_PUBLIC_KEY --columns position,name,distance
```

`globe boats show BOAT_UUID` returns the current state and weather in one request. JSON adds the boat's `awa` (apparent wind angle, °), `time_since_last_update_seconds` (how long since the simulation last updated the boat), `in_port`, and `crew_role`, plus:

- `weather`: the forecast at the boat's position as time-aligned arrays of up to six hourly samples starting at the current UTC hour (`time`, `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, `wave_height`, `wave_direction`, `ocean_current_velocity`, `ocean_current_direction`, `visibility`, `weather_code`), or `null` when no forecast is available. Marine fields are `null` where no marine forecast exists.
- `weather_now`: the value interpolated to the current minute, as the simulation does (`wind_speed_kn`, `wind_direction_deg`, `wind_gusts_kn`, `wave_height_m`, `wave_direction_deg`, `current_speed_kn`, `current_direction_deg`). It is a forecast estimate, not a sensor reading, and is `null` when the available forecast does not start at the current hour, for example an older fallback forecast.
- `weather_units`: wind, gusts, and current in knots; waves in metres; directions in degrees; visibility in metres.
- `last_port_call`: the most recent arrival or departure (`port`, `event_type`, `event_timestamp`), or `null`.

It does not load logs, tracks, statistics, passages, crew, or races. Optional table columns `wind`, `wind-dir`, `current`, `wave` (from `weather_now`), `update-age`, and `in-port` appear only when requested:

```sh
marineverse globe boats show BOAT_UUID --columns name,heading,speed,main,jib,wind,wind-dir,current,wave,update-age,in-port
marineverse globe boats list --mine --columns name,heading,speed,wind,update-age
```

`globe boats profile BOAT_UUID --json` (public, no login) keeps these sections of the public profile: `boat`, `weather` (forecast arrays), `last_port_call`, `boat_stats` (overall distance and yearly, monthly, and daily distance history in nm), `passages` (the latest 20, with start and end ports, times, duration, and rhumb-line distance), `seas_visited`, and `races`. Tracking logs, track geometry, crew members, and owner-only data are not included.

Read what happened to one of your boats with `globe boats history`. Each request reads one type, newest first, as a separate bounded page:

```sh
marineverse globe boats history BOAT_UUID --type logs --since 2026-09-30T00:00:00Z --limit 100 --json
marineverse globe boats history BOAT_UUID --type port-calls --limit 50
marineverse globe boats history BOAT_UUID --type passages --limit 20
marineverse globe boats history BOAT_UUID --type passages --cursor NEXT_CURSOR
```

- `logs` (default): simulation tracking entries with UTC `timestamp`, `latitude`/`longitude`, `heading`, `last_speed_in_kts`, `sog`, `wind_speed`, `current_speed` (knots), `awa`, `offline`, and `event` for breaks such as a teleport. The server keeps only about the last day of logs; `oldest_available_at` shows the oldest retained entry. Earlier logs are no longer available.
- `port-calls`: arrivals and departures (`port`, `event_type`, `event_timestamp`).
- `passages`: completed port-to-port passages (start and end ports, `departedAt`, `arrivedAt`, `durationSeconds`, `rhumbDistanceNm`), ordered by when they were recorded on arrival.

`--limit` is 1–200 (default 50). `--since` keeps records at or after an ISO 8601 time. When more records exist, the result has `next_cursor` (and the table prints the `--cursor` to use); pass it with the same `--type` to read the next page without repeats or gaps. An empty history is an empty `items` list; if the log store is unavailable, the command fails with a server error instead of returning an empty list. Recorded values are never filled in from the boat's current state.

`boats list --mine` includes `time_since_last_update_seconds` for every boat. It fetches weather only when you select a weather column (`wind`, `wind-dir`, `current`, or `wave`); each boat then gets `weather_now`, and the result includes `weather_units`, all from one bounded request. This also applies with `--json`, although `--columns` still does not filter JSON fields.

Open resources in your default browser using the selected environment's website URL (`http://localhost:3005` for local, `https://www.marineverse.com` for production by default):

```sh
node ./bin/marineverse.js --env local globe boats open BOAT_UUID
node ./bin/marineverse.js --env local globe boats view-3d BOAT_UUID
node ./bin/marineverse.js --env local globe races open RACE_PUBLIC_KEY
node ./bin/marineverse.js --env local globe races open
```

Add `--no-browser` to print the URL without launching a browser, including in automation with `--json`. These commands do not call the API or pass CLI tokens to the browser; the website uses its own login session.

```sh
node ./bin/marineverse.js --env local auth login
node ./bin/marineverse.js --env local auth status
node ./bin/marineverse.js --env local globe boats list --mine
node ./bin/marineverse.js --env local globe boats show YOUR_BOAT_UUID
node ./bin/marineverse.js --env local globe boats set-heading YOUR_BOAT_UUID --degrees 215
node ./bin/marineverse.js --env local globe boats rename YOUR_BOAT_UUID --name "New Boat Name"
node ./bin/marineverse.js --env local auth logout
```

In a terminal, login asks how you want to sign in. Press Enter to open a browser on the same computer, or choose device code login for a remote or headless machine.

```sh
marineverse login                  # choose interactively (Enter = browser)
marineverse login --browser        # browser login without asking
marineverse login --device-auth --no-browser  # approve from another device
```

For device login, open the printed URL on any device, sign in, check that the code matches your terminal, and approve. Keep the CLI running until login finishes. Codes expire after 15 minutes; press Ctrl+C to cancel.

`--no-browser` prevents opening a browser; it does not select the login method. Scripts and `--json` never prompt, so pass `--device-auth` for remote login. The CLI never asks for your MarineVerse password.

Heading and sail changes require owner, skipper, or admin crew access. Rename requires the owner and a Sailing Pass, and uses the existing rename notification behavior. Updates are read back: `update_accepted` reports acceptance and `verified` reports whether the requested state was observed. An anchored boat can turn with the wind after accepting a heading; another controller can also change state. A readback is not proof of execution by a running game client.

### Sails and anchoring

```sh
marineverse globe boats raise-sails BOAT_UUID
marineverse globe boats set-sails BOAT_UUID --main 0.75 --jib 0.5
marineverse globe boats lower-sails BOAT_UUID
marineverse globe boats drop-anchor BOAT_UUID
marineverse globe boats show BOAT_UUID --columns name,latitude,longitude,main,jib,anchored
```

Sail levels range from `0` (fully lowered) to `1` (fully raised). `set-sails` changes only the sails you specify. In Globe, both sails below `0.05` means anchored: `drop-anchor` and `lower-sails` set both to zero. `raise-sails` sets both to one and resumes sailing. There is no separate anchor toggle. Commands send one update, then read back the result; `--json` includes the requested change and verification status.

`marineverse login` is also available as a shortcut for `marineverse auth login`, with the same options.

## Settings and credentials

The built-in production environment uses `https://api.marineverse.com`, `https://www.marineverse.com`, and the public MarineVerse CLI OAuth client ID. No client secret is needed. To try production explicitly without changing your selected local environment:

```sh
node ./bin/marineverse.js --env production auth login
node ./bin/marineverse.js --env production auth status
```

```sh
node ./bin/marineverse.js config path
node ./bin/marineverse.js config list
node ./bin/marineverse.js config use local
```

Settings live in `~/.config/marineverse/config.json` on macOS/Linux (`$XDG_CONFIG_HOME` is honored), or `%APPDATA%\MarineVerse\config.json` on Windows. `MARINEVERSE_CONFIG_DIR` overrides the directory for isolated testing. Settings contain environment URLs and public OAuth client IDs, not tokens.

Tokens default to the OS credential store: macOS Keychain, Windows Credential Manager, or a Linux Secret Service (such as GNOME Keyring or KWallet). On Linux the CLI requires a Secret Service and never falls back to the session-only kernel keyring, because a login stored there disappears when the session ends. Headless and cloud Linux sessions usually have no Secret Service, so login fails before you approve anything with `CREDENTIAL_STORE_UNAVAILABLE`; use `--storage file` there. If saved login details exist but their tokens are gone, commands report `CREDENTIAL_MISSING`; run `marineverse login` again (`auth logout` also clears it). Unix users may explicitly choose `auth login --storage file`; tokens then live in private files under the configuration directory (0700 directory, 0600 files). Windows uses the credential store, not file mode. Account metadata identifies which store and user are active. Credentials are isolated by configuration directory, environment, API origin, client ID, and account.

`auth status` verifies the session with the API, which may refresh and save tokens. `auth status --local` only reads the stored identity, scopes, and expiry: no network access, refresh, or writes.

Configuration precedence is command flags, `MARINEVERSE_ENV` / `MARINEVERSE_API_URL` / `MARINEVERSE_WEB_URL` / `MARINEVERSE_CLIENT_ID`, saved settings, then built-in defaults. An API-origin override does not inherit another origin's OAuth credentials. Only loopback development origins can use HTTP. `auth logout` removes local credentials and reports whether server revocation was confirmed.

## Automation and HTTP behavior

`--json` writes one versioned JSON object to stdout; diagnostics go to stderr. Errors also have a JSON envelope and nonzero exit status. Help/version do not contact the API. Exit codes: 0 success, 2 usage/configuration, 3 authentication, 4 forbidden, 5 missing resource, 6 validation, 7 network/server/rate limit.

Every API request, including OAuth, identifies itself with `User-Agent: marineverse-cli/<version>`, `X-MarineVerse-Client: marineverse-cli`, and `X-MarineVerse-Client-Version: <version>`, using the installed CLI version. These are diagnostic labels, not authentication; servers must not trust them for authorization.

Ordinary requests allow 15 seconds per attempt. GET requests retry at most twice for transient connection failures, timeouts, and HTTP 429/502/503/504, with a shared 30-second request budget including backoff and any token refresh. `Retry-After` is a minimum wait; waits above five seconds stop automatic retries and are exposed as `error.retry_after_seconds`. Mutations and token exchanges are never automatically replayed. Check state after an ambiguous mutation failure before retrying. Optional `error.diagnostics` includes a sanitized cause, request stage, elapsed milliseconds, attempt count, and a request ID when available; share these when reporting a failure. Requests do not poll in the background or follow redirects. Only login (`login` or `auth login`), explicit `open` / `view-3d` commands, and racing `compare --open` can launch a browser; `--no-browser` suppresses launching. Concurrent token refresh is serialized per credential.

## Development and release checks

`package.json` is the source of truth for the CLI version. `npm version patch --no-git-tag-version` bumps it and the lockfile; CLI output, request headers, update checks, and installed-skill metadata read that version automatically. The bundled skill uses command help to discover capabilities and does not duplicate the release number.

```sh
npm test
npm run check
npm run check:release
npm run test:package
```

Tests use synthetic accounts/tokens and loopback fixture servers. They do not need production credentials or contact MarineVerse production. Internal plans, manual test fixtures, screenshots, and logs belong under ignored `docs/ai_plans/` and must not be committed. The npm package uses an explicit file allowlist. Release checks inspect Git candidates and the package manifest, but do not replace manual review or a dedicated secret scanner before publication.

The public command-registration function is exported for future composition into a separate private admin CLI; admin commands and credentials do not belong in this package.

### Publish a release

Set the intended version with `npm version patch --no-git-tag-version` if it has not already been bumped. Commit and push the changes, deploy any required backend changes, and wait for GitHub CI to pass. Then:

```sh
npm run release
```

The script reads the version from `package.json`, requires a clean checkout pushed to origin, runs tests and release/package checks, and publishes the packed artifact to npm with public access and the `latest` tag. Sign in with `npm login` first if needed; npm handles publishing verification prompts. It then creates and pushes the matching Git tag. It never bumps the version or commits changes for you. If a release is interrupted, rerun it: an already-published package is reused only when its checksum matches exactly. A different package under the same version or a conflicting Git tag stops the release.

Preview with `npm run release -- --dry-run`. This allows uncommitted work and runs the same checks and packaging without publishing or changing Git. Finally, the script prints the tarball URL and SHA-256 for the Homebrew formula; update and push the tap separately.

## License and trademarks

Copyright 2026 MarineVerse. Licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE) and [third-party notices](THIRD_PARTY_NOTICES). Dependencies retain their own licenses.

MarineVerse is a trademark of Virtual Reality Sailing Pty Ltd. The Apache license does not grant trademark rights to the MarineVerse name or logo except as described in its Section 6. Forks should use their own branding and must not imply that MarineVerse sponsors or endorses them. This trademark clarification does not change the software license.
