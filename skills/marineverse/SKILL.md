---
name: marineverse
description: Install and configure the MarineVerse CLI, inspect Globe races, leaderboards and boat positions, and carry out requested boat controls. Use for MarineVerse sailing data and CLI setup.
license: Apache-2.0
metadata:
  cli-version: "0.1.0"
---

# MarineVerse

Use the MarineVerse CLI for public Globe data and account-authorized boat controls. This file is self-contained: it can bootstrap the CLI even when only a link to this skill was supplied.

## Install this skill when requested

Save this file as `marineverse/SKILL.md` under the current agent's skill directory:

- Codex personal: `~/.agents/skills/`; project-only: `.agents/skills/`.
- Claude Code personal: `~/.claude/skills/`; project-only: `.claude/skills/`.

Use personal scope unless the user requests project scope. Create only the selected agent's directory. Preserve an existing customized skill; compare it rather than overwriting it. If using an agent's built-in installer, point it to `skills/marineverse` in the same repository/ref as this file. Retain the repository's LICENSE, NOTICE, and THIRD_PARTY_NOTICES with the installed skill. Continue using these instructions in the current session; refresh/restart the agent if needed for later discovery.

The CLI provides `skills install`, `skills update`, and `skills uninstall` after bootstrap. Those helpers manage a copy with checksums and refuse to replace customized files. A manually installed copy can be kept as-is; it does not need to be replaced by the helper.

## Bootstrap the executable

1. Check whether `marineverse --version` and `marineverse --help` work. This skill targets CLI 0.1.0; use the installed command's help to confirm options rather than assuming commands exist in another version. Do not install a second copy if a working one is already available.
2. If the user supplied a MarineVerse CLI checkout, use it. Otherwise the canonical source is `https://github.com/marineverse/marineverse-cli`. Clone it into a user-owned tools directory, honoring a tag/commit supplied by the user. If that source is unavailable, request a checkout or published release; do not substitute a similarly named package or another repository.
3. Check `node --version` and `npm --version`. Node 24 or newer is required. Use the user's existing Node version manager if available; if Node is missing, guide them through installing a supported Node runtime. Do not replace their system runtime or require sudo.
4. From the checkout, run `npm ci`, then `npm run build`. Verify `node ./bin/marineverse.js --help`. To make `marineverse` available on PATH, run `npm link` if its destination is writable. If linking is unavailable, use `node` with the absolute path to `bin/marineverse.js` for every command below and tell the user that path.
5. The intended npm name is `@marineverse/cli`, but publication is a separate release step. Do not assume `npm install -g @marineverse/cli` is available merely because the name appears here. Prefer the verified source-checkout route until the project's release instructions announce npm availability.

The skill does not itself install a runtime or executable just by being loaded. Perform the requested setup and report actual results, including any remaining prerequisite.

## Configure and verify

- Inspect `marineverse config list --json` and `marineverse config show --json` first. Preserve saved environments and credentials. Use explicit `--env` flags; do not silently switch the user's selected environment.
- For normal MarineVerse service access, use `--env production`. API `https://api.marineverse.com`, website `https://www.marineverse.com`, and the public OAuth client ID are built in; no secret or account is required for public reads.
- Use `--env local` only when the user requests local development. Defaults are API `http://localhost:3000` and website `http://localhost:3005`. The operator supplies that server's separate public client ID. Configure it with `config set local --api-url http://localhost:3000 --web-url http://localhost:3005 --client-id LOCAL_CLIENT_ID`; this selects local. Never substitute the production registration or fall back to production after a local failure.
- Verify connectivity with `marineverse --env production globe races list --json`, substituting the requested environment. This read does not change boat state.
- Public races/profiles need no login. For requested private reads or controls, check `auth status --json`; if login is needed, run `auth login` for the same environment and let the user complete the website login/consent. Never request passwords or copy tokens into chat or skill files.
- Browser login must return to the machine running the CLI. `auth login --no-browser` prints a URL for a browser on that machine; it is not a remote device-code login. If the agent runs remotely, explain this constraint before starting a login that cannot complete.

## Use the CLI

Use `--json` for machine-readable results and inspect the process exit status. JSON has `schema_version`, `data`, and `meta`, or an `error` object. Help and version are plain text. Use public race keys and boat UUIDs from returned data; never guess internal database IDs.

```sh
marineverse --env production globe races list --json
marineverse --env production globe races show RACE_KEY --json
marineverse --env production globe races leaderboard RACE_KEY --json
marineverse --env production globe boats profile BOAT_UUID --json
marineverse --env production globe boats list --mine --json
marineverse --env production globe boats show BOAT_UUID --json
```

Race lists contain registration-open and active races plus the latest ten finished races, not a complete archive. Preserve server leaderboard order and penalties. Boat profiles respect existing visibility rules. Boat `latitude` and `longitude` are signed decimal degrees; missing values are null, not zero. Human tables round to five decimal places; JSON retains API precision. Headings are degrees and speed is knots.

For human tables, use `--columns name,latitude,longitude` or consult the command's `--help` for available columns. This flag does not filter JSON. To provide a website link without opening a browser:

```sh
marineverse --env production globe boats view-3d BOAT_UUID --no-browser --json
marineverse --env production globe boats open BOAT_UUID --no-browser --json
marineverse --env production globe races open RACE_KEY --no-browser --json
```

Omit `--no-browser` when the user wants the page opened on the CLI's machine.

## Requested boat changes

Setup, login, and requests to inspect a boat do not imply permission to change it. Once the user has requested a specific change, use the same environment and verify the intended UUID in their owned/crewed boat list. Ask only if the target or change is ambiguous.

```sh
marineverse --env production globe boats set-heading BOAT_UUID --degrees 215 --json
marineverse --env production globe boats rename BOAT_UUID --name "New Boat Name" --json
```

Heading requires owner/skipper/admin access and accepts 0–360, with 360 normalized to 0. Rename requires the owner and a Sailing Pass and sends the existing rename notification. Do not use a rename as a connectivity test.

Inspect `update_accepted`, `verified`, and `warning`. An accepted change whose readback differs is not verified: simulation, anchored-boat behavior, or another controller may adjust state. Readback does not prove a running game client executed the command.

## Failures and completion

Exit codes: 2 usage/configuration, 3 authentication, 4 forbidden, 5 missing resource, 6 validation, 7 network/server/rate limit. The CLI already applies bounded retries to reads. Respect `error.retry_after_seconds`; do not add rapid retry loops. After an ambiguous write failure, read the boat before considering a retry. Stop and report persistent permission or validation failures instead of trying other identities or environments.

For setup, report the executable/version, installed skill location, selected/requested environment, public-read result, and whether login is available or still needed. Do not claim a skill or CLI was installed if it was only downloaded or described. Leave an existing session signed in unless the user requests logout.
