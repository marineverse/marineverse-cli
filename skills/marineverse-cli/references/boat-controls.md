## Requested boat changes

Setup, login, and requests to inspect a boat do not imply permission to change it. Once the user has requested a specific change, use the same environment and verify the intended UUID in their owned/crewed boat list. Ask only if the target or change is ambiguous.

```sh
marineverse globe boats set-heading BOAT_UUID --degrees 215 --json
marineverse globe boats raise-sails BOAT_UUID --json
marineverse globe boats set-sails BOAT_UUID --main 0.75 --jib 0.5 --json
marineverse globe boats lower-sails BOAT_UUID --json
marineverse globe boats drop-anchor BOAT_UUID --json
marineverse globe boats rename BOAT_UUID --name "New Boat Name" --json
```

Heading and sails require owner/skipper/admin access. Heading accepts 0–360, with 360 normalized to 0. Sail levels use 0–1, not percentages; `set-sails` preserves any omitted sail. `raise-sails` fully raises both sails. `lower-sails` and `drop-anchor` both fully lower them: Globe anchors when both levels are below 0.05 and has no separate anchor switch. Raising sails resumes sailing. Never use sail or anchor changes as connectivity tests. Rename requires the owner and a Sailing Pass and sends the existing rename notification. Do not use a rename as a connectivity test.

Boat JSON includes `mainsail_hoist`, `jib_hoist`, and `is_anchored` when supplied by the server. Human boat tables support `--columns name,latitude,longitude,main,jib,anchored`. If an older server rejects sail fields, report that it needs the boat-control backend update; do not fall back to another API or environment.

Inspect `update_accepted`, `verified`, and `warning`. An accepted change whose readback differs is not verified: simulation, anchored-boat behavior, or another controller may adjust state. Readback does not prove a running game client executed the command.
