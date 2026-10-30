## Requested boat changes

Setup, login, and requests to inspect a boat do not imply permission to change it. Once the user has requested a specific change, use the same environment and verify the intended UUID in their owned/crewed boat list. Ask only if the target or change is ambiguous.

```sh
marineverse globe boats set-heading BOAT_UUID --degrees 215 --json
marineverse globe boats raise-sails BOAT_UUID --json
marineverse globe boats set-sails BOAT_UUID --main 0.75 --jib 0.5 --json
marineverse globe boats lower-sails BOAT_UUID --json
marineverse globe boats drop-anchor BOAT_UUID --rode 20 --json
marineverse globe boats set-rode BOAT_UUID --meters 10 --json
marineverse globe boats retrieve-anchor BOAT_UUID --json
marineverse globe boats start-motor BOAT_UUID --throttle 0.6 --json
marineverse globe boats set-throttle BOAT_UUID --level -0.3 --json
marineverse globe boats stop-motor BOAT_UUID --json
marineverse globe boats rename BOAT_UUID --name "New Boat Name" --json
```

Heading, sails, the motor and the anchor require owner/skipper/admin access. Heading accepts 0–360, with 360 normalized to 0. Sail levels use 0–1, not percentages; `set-sails` preserves any omitted sail. `raise-sails` fully raises both sails and resumes sailing; with both sails lowered the boat holds its position. Never use sail, motor or anchor changes as connectivity tests. Rename requires the owner and a Sailing Pass and sends the existing rename notification. Do not use a rename as a connectivity test.

`drop-anchor` drops the anchor at the boat's position with 5 m of chain unless `--rode` (1–60 m) is given. `set-rode` lets chain out or takes it in; the boat swings around the anchor within the chain beyond the depth, and taking chain in pulls it toward the anchor. `retrieve-anchor` lifts it. A refusal names its reason: `too_far_from_shore`, `on_land`, `reef` or `shoreline_unavailable`. Depth is simulated.

Throttle runs from -1 (full astern) to 1 (full ahead), not percentages; `start-motor` keeps the current throttle unless `--throttle` is given. The electric motor runs on the battery and refuses to start when it is empty (`battery_empty`).

Boat JSON includes `mainsail_hoist`, `jib_hoist`, `motor_on`, `motor_throttle`, `battery_energy_wh`, `battery_capacity_wh`, `is_anchored` and `anchor` (`latitude`, `longitude`, `rode_m`, `depth_m`, or `null`). Human boat tables support `--columns name,latitude,longitude,main,jib,anchored,rode,depth,motor,throttle,battery`. If an older server rejects these fields, report that it needs the boat-control backend update; do not fall back to another API or environment.

Inspect `update_accepted`, `verified`, and `warning`. An accepted change whose readback differs is not verified: simulation, anchored-boat behavior, or another controller may adjust state. Readback does not prove a running game client executed the command.
