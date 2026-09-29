## Install this skill when requested

Save the complete `skills/marineverse-cli` directory (SKILL.md and references) under the current agent's skill directory:

- Codex personal: `~/.agents/skills/`; project-only: `.agents/skills/`.
- Claude Code personal: `~/.claude/skills/`; project-only: `.claude/skills/`.

Use personal scope unless the user requests project scope. Create only the selected agent's directory. Preserve an existing customized skill; compare it rather than overwriting it. If using an agent's built-in installer, point it to `skills/marineverse-cli` in the same repository/ref as this file. Retain the repository's LICENSE, NOTICE, and THIRD_PARTY_NOTICES with the installed skill. Continue using these instructions in the current session; refresh/restart the agent if needed for later discovery.

The CLI provides `skills install`, `skills update`, and `skills uninstall` after bootstrap. Those helpers manage a copy with checksums and refuse to replace customized files. A manually installed copy can be kept as-is; it does not need to be replaced by the helper.

## Bootstrap the executable

1. Check whether `marineverse --version` and `marineverse --help` work. Use the installed command's help to confirm available commands and options. Do not install a second copy if a working one is already available.
2. For a normal installation, check `node --version` and `npm --version`. Node 24 or newer is required. Use the user's existing Node version manager if available; if Node is missing, guide them through installing a supported runtime. Do not replace their system runtime or require sudo.
3. Install the published package with `npm install -g @marineverse/cli`, then verify `marineverse --version` and `marineverse --help`. Use the user's requested version if specified. Do not substitute similarly named packages. If global installation is not writable, use a user-owned npm prefix and explain the PATH setup.
4. If the user supplied a checkout or requested source installation, use `https://github.com/marineverse/marineverse-cli`, honoring their tag/commit. From the checkout, run `npm ci`, then `npm run build`. Verify `node ./bin/marineverse.js --help`. Optionally `npm link` if its destination is writable; otherwise use the absolute path to `bin/marineverse.js` and report that path.

The skill does not itself install a runtime or executable just by being loaded. Perform the requested setup and report actual results, including any remaining prerequisite.

## Configure and verify

- Inspect `marineverse config list --json` and `marineverse config show --json` first. Preserve saved environments and credentials; do not silently switch the user's selected environment.
- Production is the default for fresh installs; normal commands need no environment flag. API `https://api.marineverse.com`, website `https://www.marineverse.com`, and the public OAuth client ID are built in. If existing settings select another environment and the user wants production, use an explicit `--env production` without changing their settings.
- Use `--env local` only when the user requests local development. Defaults are API `http://localhost:3000` and website `http://localhost:3005`. The operator supplies that server's separate public client ID. Configure it with `config set local --api-url http://localhost:3000 --web-url http://localhost:3005 --client-id LOCAL_CLIENT_ID`; this selects local. Never substitute the production registration or fall back to production after a local failure.
- Verify connectivity with `marineverse globe races list --json`, adding an environment flag only when needed. This read does not change boat state.
- Public races and boat profiles need no login. For requested private reads or controls, check `auth status --json`; if login is needed, run `marineverse login` for the same environment and let the user complete the website login/consent. Login requests all supported permissions. If an older session lacks access to progress or stats, run normal login again; there are no per-feature scope switches. Never request passwords or copy tokens into chat or skill files.
- Browser login must return to the machine running the CLI. `login --no-browser` prints a URL for a browser on that machine; it is not a remote device-code login. If the agent runs remotely, explain this constraint before starting a login that cannot complete.

## Version checks and upgrades

`marineverse --version` reads the installed version offline. `marineverse version --json` makes one anonymous npm request to check for updates and reports installation-specific upgrade instructions. A failed check does not mean the installation is current.

When an upgrade is requested, use `marineverse upgrade`. It uses npm or Homebrew for the running installation and prints instructions for source checkouts or temporary npx installs. Check the returned `upgraded` value and verify with `marineverse --version`; a successful exit alone may mean instructions were printed. Older CLI versions may lack these commands; use the existing installation's package manager instead. Do not switch package managers or create a second installation during an upgrade.

After upgrading, update helper-managed skills with `marineverse skills update --agent codex` or `--agent claude`, preserving the original user/project scope. Manually installed or customized skills require comparison with the bundled `skills show` output; do not overwrite them automatically.

## Failures and completion

Exit codes: 2 usage/configuration, 3 authentication, 4 forbidden, 5 missing resource, 6 validation, 7 network/server/rate limit. The CLI already applies bounded retries to reads. Respect `error.retry_after_seconds`; do not add rapid retry loops. After an ambiguous write failure, read the boat before considering a retry. Stop and report persistent permission or validation failures instead of trying other identities or environments.

For setup, report the executable/version, installed skill location, selected/requested environment, public-read result, and whether login is available or still needed. Do not claim a skill or CLI was installed if it was only downloaded or described. Leave an existing session signed in unless the user requests logout.
