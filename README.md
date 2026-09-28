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

To try them from a source checkout, use `node ./bin/marineverse.js version` or `node ./bin/marineverse.js upgrade` after `npm run build`.

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

## Knowledge base and AI

```sh
marineverse login
marineverse kb search "How do I reef?"
marineverse kb search "Globe sail controls" --limit 3 --json
marineverse kb show ARTICLE_UUID
marineverse ai ask "How can I improve my sailing?"
```

`knowledge-base` is an alias for `kb`. Search returns matching article titles, excerpts, and UUIDs; `show` returns the full article. Both KB and AI require an active MarineVerse membership. If needed, [manage your membership](https://www.marineverse.com/my-profile?tab=billing).

Search deducts the embedding provider's reported token usage from your AI quota, including searches with no matches. Reading an article consumes no AI tokens. `ai ask` uses the same assistant and AI quota as the website. JSON search and AI results include `tokens.consumed` and `tokens.remaining`.

Articles default to `public` (available to members). `admin` articles are only available to admins, and `internal` articles are used by AI but never returned by `kb search/show`. Internal content may inform an AI answer; this visibility is not a place to store secrets.

### Operator rollout

Deploy the server changes and run `bin/rails db:migrate` to add article UUIDs and visibility. Existing articles become public; review their visibility in the admin before making the KB endpoints available to members. Then run `bin/rails marineverse_cli:register` in each target environment. This updates the existing CLI application without changing its public client ID, adding `kb_read` and `ai_ask` to its permissions. Deploy the frontend consent descriptions. Users then run normal `marineverse login` again.

The authenticated v3 endpoints are `POST /api/v3/knowledge_base/search` (`query`, optional integer `limit`, default 5, maximum 10), `GET /api/v3/knowledge_base/:uuid`, and `POST /api/v3/ai/ask` (`question`). Search accepts up to 2,000 characters; AI accepts up to 8,000. Search and AI use POST because they consume quota, and the CLI never automatically retries them. They allow up to 120 seconds client-side, subject to the server's AI request timeout. Requests are limited to 10 per minute per account per controller using the server's Rack::Attack cache store; use a shared cache to enforce this across workers.

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

Before using these commands against production, deploy the backend change that allows `mainsail_hoist` and `jib_hoist` on the existing OAuth boat-update endpoint. No database migration, new OAuth scope, or additional login configuration is needed.

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
