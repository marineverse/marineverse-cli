# MarineVerse CLI

Browse Globe races and public boat profiles, sign in through the MarineVerse website, and control boats you own or crew.

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

Give Codex or Claude Code [the MarineVerse skill](skills/marineverse/SKILL.md) and ask:

> Install this MarineVerse skill for yourself, then use it to install and configure the MarineVerse CLI. Verify it by listing public Globe races. Let me complete browser login if my next task needs an account.

The skill includes setup instructions and works before the CLI is installed. It installs the published npm package, or uses an existing checkout when requested. It preserves existing configuration and does not change boats during setup. Node 24+ is required; the agent will report missing prerequisites.

The shareable skill URL is:

```text
https://raw.githubusercontent.com/marineverse/marineverse-cli/master/skills/marineverse/SKILL.md
```

For a stable release, replace `master` with its tag or commit. You can also give your agent the local `skills/marineverse/SKILL.md` file and checkout path.

Once the CLI is available, these helpers install the bundled skill into the current user's agent directory:

```sh
node ./bin/marineverse.js skills install --agent codex
node ./bin/marineverse.js skills install --agent claude
node ./bin/marineverse.js skills update --agent codex
node ./bin/marineverse.js skills uninstall --agent codex
```

Add `--scope project` to use the current project's `.agents/skills/` (Codex) or `.claude/skills/` (Claude Code). Personal installs use those directories under your home folder. The helpers work offline, include legal notices, and never install the CLI or log in automatically. Updates use the skill bundled with the installed CLI; upgrade the CLI first to obtain a newer skill. Modified, manually installed, symlinked, or extra-file copies are preserved and reported as conflicts. Only installations created by the helper can be updated or removed by it. `skills show` prints the complete instructions without installing anything.

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

Available in CLI 0.1.1 and later. To try them from a source checkout, use `node ./bin/marineverse.js version` or `node ./bin/marineverse.js upgrade` after `npm run build`.

The CLI detects how the running copy was installed and upgrades that installation. npm project installs are updated in their project; global installs retain their prefix. Source checkouts and temporary npx installs receive instructions instead. Homebrew releases may follow npm releases. Version checks make one anonymous request to npm with a three-second timeout; they do not run during other commands. `--json` remains available for agents, with package-manager output on stderr. No automatic upgrades, login, or extra settings are needed.

## Profile, progress, and stats

Available in CLI 0.1.1 and later. Use normal login for all account features:

```sh
marineverse login
marineverse profile show
marineverse progress show
marineverse stats distance
marineverse stats distance --boat yacht --json
```

`profile show` includes your display name, public UUID, country, time zone, sailing experience, and interests. Progress shows tutorial completion, onboarding state, and your next step. Distance stats show overall totals per boat type in nautical miles and minutes, not monthly history. JSON retains full numeric precision; missing totals stay null.

Use `progress show --columns name,status` or `stats distance --columns boat,distance` to choose table columns. `profile open`, `progress open`, and `stats open` open the matching website pages; add `--no-browser` to print the URL. These website commands use the browser's own session.

Login handles all required permissions. If an older session lacks access to progress or stats, run `marineverse login` again. No extra feature settings are needed.

### Operator rollout

Before releasing this version, deploy the updated server registration task and run `bin/rails marineverse_cli:register` in each target environment. It updates the existing MarineVerse CLI application without changing its public client ID, adding `sailing_cv` to `public globe_read globe_write`. Existing progress and profile API endpoints need no new migration. Users then sign in normally to consent to the full permission set. Update the frontend consent description to include progress, distance, and time statistics.

## Try it

Public commands require no login, and never send stored credentials:

```sh
node ./bin/marineverse.js --env local globe races list
node ./bin/marineverse.js --env local globe races show RACE_PUBLIC_KEY
node ./bin/marineverse.js --env local globe races leaderboard RACE_PUBLIC_KEY --json
node ./bin/marineverse.js --env local globe boats profile BOAT_UUID
```

Copy race keys and boat UUIDs from command output. The race list includes registration-open, active, and the latest ten finished races. Private boat profiles retain their normal access restrictions.

Boat profiles, lists, details, update results, and leaderboards include latitude/longitude columns by default in signed decimal degrees (five decimal places). JSON boat objects expose `latitude` and `longitude` at the API's full precision, including when the public API uses `p_lat`/`p_lng`. Missing coordinates display as `—` (`null` in JSON), never a guessed position.

Choose table columns and their order with `--columns`. Each table command's `--help` lists its available fields. Without this flag, the default columns are shown. JSON always retains the complete result.

```sh
node ./bin/marineverse.js globe boats profile BOAT_UUID --columns name,latitude,longitude
node ./bin/marineverse.js globe boats list --mine --columns name,heading,speed,latitude,longitude
node ./bin/marineverse.js globe races list --columns key,name,state
node ./bin/marineverse.js globe races leaderboard RACE_PUBLIC_KEY --columns position,name,distance
```

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

Login opens the existing website login/consent page, using authorization code + S256 PKCE and a short-lived loopback listener. `auth login --no-browser` prints a link to open in a browser on the same computer; this is not a remote device-code flow. The CLI never asks for your MarineVerse password. It refreshes tokens as needed.

Heading changes require owner, skipper, or admin crew access. Rename requires the owner and a Sailing Pass, and uses the existing rename notification behavior. Updates are read back: `update_accepted` reports acceptance and `verified` reports whether the requested state was observed. An anchored boat can turn with the wind after accepting a heading; another controller can also change state. A readback is not proof of execution by a running game client.

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

Tokens default to the OS credential store: macOS Keychain, Windows Credential Manager, or an available Linux credential service. If unavailable, login reports the failure. Unix users may explicitly choose `auth login --storage file`; tokens then live in private files under the configuration directory (0700 directory, 0600 files). Windows uses the credential store, not file mode. Account metadata identifies which store and user are active. Credentials are isolated by configuration directory, environment, API origin, client ID, and account.

Configuration precedence is command flags, `MARINEVERSE_ENV` / `MARINEVERSE_API_URL` / `MARINEVERSE_WEB_URL` / `MARINEVERSE_CLIENT_ID`, saved settings, then built-in defaults. An API-origin override does not inherit another origin's OAuth credentials. Only loopback development origins can use HTTP. `auth logout` removes local credentials and reports whether server revocation was confirmed.

The design borrows user configuration and named-environment conventions from [Google Cloud CLI](https://docs.cloud.google.com/sdk/docs/configurations), and explicit credential storage and browser login patterns from [Codex](https://learn.chatgpt.com/docs/auth).

## Automation and HTTP behavior

`--json` writes one versioned JSON object to stdout; diagnostics go to stderr. Errors also have a JSON envelope and nonzero exit status. Help/version do not contact the API. Exit codes: 0 success, 2 usage/configuration, 3 authentication, 4 forbidden, 5 missing resource, 6 validation, 7 network/server/rate limit.

Every API request, including OAuth, identifies itself with `User-Agent: marineverse-cli/<version>`, `X-MarineVerse-Client: marineverse-cli`, and `X-MarineVerse-Client-Version: <version>`, using the installed CLI version. These are diagnostic labels, not authentication; servers must not trust them for authorization.

Requests time out after 15 seconds. GET requests retry at most twice for HTTP 429/502/503/504, with exponential backoff and jitter. `Retry-After` is a minimum wait; waits above five seconds stop automatic retries and are exposed as `error.retry_after_seconds`. Network failures, mutations, and token exchanges are not automatically retried. Check state after an ambiguous mutation failure before retrying. Requests do not poll in the background or follow redirects. Only `auth login` and explicit `open` / `view-3d` commands launch a browser. Concurrent token refresh is serialized per credential.

## Development and release checks

```sh
npm test
npm run check
npm run check:release
npm run test:package
```

Tests use synthetic accounts/tokens and loopback fixture servers. They do not need production credentials or contact MarineVerse production. Internal plans, manual test fixtures, screenshots, and logs belong under ignored `docs/ai_plans/` and must not be committed. The npm package uses an explicit file allowlist. Release checks inspect Git candidates and the package manifest, but do not replace manual review or a dedicated secret scanner before publication.

The public command-registration function is exported for future composition into a separate private admin CLI; admin commands and credentials do not belong in this package.

## License and trademarks

Copyright 2026 MarineVerse. Licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE) and [third-party notices](THIRD_PARTY_NOTICES). Dependencies retain their own licenses.

MarineVerse is a trademark of Virtual Reality Sailing Pty Ltd. The Apache license does not grant trademark rights to the MarineVerse name or logo except as described in its Section 6. Forks should use their own branding and must not imply that MarineVerse sponsors or endorses them. This trademark clarification does not change the software license.
