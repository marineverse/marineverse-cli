## Use the CLI

Prefer a direct CLI command whenever it covers the task: these commands are much faster than KB search or AI. Check `marineverse --help` and the relevant group's `--help` before deciding no command exists. For example, use `stats distance` for distance totals, `progress show` for lesson progress, and `globe boats profile` for a boat's position instead of asking AI for that data.

For product, setup, and release questions, start with guest content: `marineverse faq` lists topic slugs, `marineverse faq TOPIC` reads first-party answers with links, `marineverse history --limit 5` reads Sailing Club major updates and patch notes, and `marineverse content search "QUERY"` finds keywords across FAQs and history. These commands need no login. Preserve canonical source URLs when answering. Use `--json` for complete rich content, `--locale CODE` for localized detail/history/search, and `--limit 1` through `20` for history/search. History defaults to ten major updates and ten patch notes; search defaults to five results. Sailing Club history is a development timeline, not the user's sailing statistics.

For application releases use `marineverse sailing-club changelog latest`, `changelog version VERSION`, or `changelog list` with inclusive `--from-version`/`--to-version` or ISO `--from-date`/`--to-date` ranges. `list --all` retrieves the entire archive; otherwise lists default to ten releases. `release-notes` and `history` are aliases for the product's `changelog`. These are Sailing Club application releases, separate from the CLI's version.

Use `marineverse terms show "TERM"` for an exact case-insensitive sailing glossary lookup, `terms search "QUERY"` to search terms and definitions, or `terms list` to browse alphabetically. No login is needed. Lists and searches default to 20 definitions; use `--limit 1` through `20` and `--page` to browse. Preserve the returned definition and source URL; an unknown term is not evidence for an invented meaning.

## Useful links

Use `marineverse links` or `marineverse links list --json` to discover useful destinations without login or API access. Print a link with `marineverse links url NAME`; open it on the CLI's machine with `marineverse links open NAME` (or add `--no-browser` to print it). Names are `website`, `llms`, `dashboard`, `try-sailing`, `history`, `links`, `steam`, `quest`, `cli`, `mcp`, and `discord`. These links always point to public production destinations; website pages use the browser's own session.

## Discord community

Use `marineverse discord url` to print the invite URL, `https://discord.gg/marineverse`, or `marineverse discord open` when the user wants it opened in the browser on the CLI's machine. Both commands work without login or environment configuration. Use `discord url --json` for a structured link; `discord open --no-browser` also prints the URL without launching a browser.
