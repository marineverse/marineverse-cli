## Profile, progress, and statistics

After login:

```sh
marineverse profile show --json
marineverse progress show --json
marineverse stats distance --json
marineverse stats distance --boat yacht --json
```

Profile is read-only. Progress includes tutorial completion, onboarding state, and the next step. Distance statistics are overall totals by boat type, in nautical miles and minutes; they do not provide monthly or daily history. Preserve null totals as unknown, not zero. Use boat types returned by the API rather than guessing them.

For human tables, `progress show --columns name,status` and `stats distance --columns boat,distance,time` select displayed columns. `profile open`, `progress open`, and `stats open` open the matching website pages; use `--no-browser --json` to return a link.
