# Sailing clubs and memberships

Use `marineverse groups search "CITY OR NAME" --json` for public directory discovery without login. Search city/name first when coordinates are unavailable. Name queries include unmapped organizations.

Nearby search: `marineverse groups search --latitude -37.8 --longitude 144.9 --radius-km 50 --json`. Use user-provided coordinates or a trusted resolved place; never infer GPS or fabricate coordinates/distances. Coordinates must be paired finite degrees, latitude −90..90 and longitude −180..180. Radius defaults to 50 km with coordinates; explicit radius requires coordinates and accepts 1..500.

Filters: `--type yacht_club|sailing_school|sailability_chapter|federation|class_association|team|other`, `--country AU` (ISO two letters), `--limit 10` (1..50). Query length is at most 200 characters.

Present returned name, description and canonical MarineVerse page, such as https://www.marineverse.com/associations/assoc-rya. Add type, city and returned distance in kilometers when useful; external websites are secondary. Never expose database IDs or invent missing details. Explain missing data. Empty results do not prove no clubs exist; the directory is not exhaustive. Discovery does not join a club or authorize writes.

Use normal `marineverse login` for your memberships. `marineverse groups list --json` lists your clubs, including pending requests. `clubs` aliases `groups`.

For a specifically requested target and action, use `marineverse groups join CLUB_UUID_OR_SLUG --message "Optional introduction"` or `marineverse groups leave CLUB_UUID_OR_SLUG`. Resolve ambiguous names through search and use returned public UUIDs or slugs. Discovery never authorizes joining; do not choose a club or introduction on the user's behalf.

Open clubs join immediately; approval-required clubs create a pending request, which is not a confirmed membership. Invite-only clubs refuse joining. Join messages accept up to 10,000 characters. Leaving removes an active membership; pending request cancellation is unsupported, and the last admin cannot leave. Report duplicate and permission errors truthfully. Never repeat an ambiguous write automatically; inspect `groups list` first. If an older session lacks permissions, run normal `marineverse login` again.
