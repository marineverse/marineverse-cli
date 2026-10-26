## Requested boat changes

Setup, login, and requests to inspect a boat do not imply permission to change it. Once the user has requested a specific change, use the same environment and verify the intended UUID in their owned/crewed boat list. Ask only if the target or change is ambiguous.

```sh
marineverse globe boats set-heading BOAT_UUID --degrees 215 --json
marineverse globe boats raise-sails BOAT_UUID --json
marineverse globe boats set-sails BOAT_UUID --main 0.75 --jib 0.5 --json
marineverse globe boats lower-sails BOAT_UUID --json
marineverse globe boats drop-anchor BOAT_UUID --json
marineverse globe boats secure-anchor BOAT_UUID --recommended --json
marineverse globe boats set-rode BOAT_UUID --meters 40 --json
marineverse globe boats retrieve-anchor BOAT_UUID --json
marineverse globe boats set-sheets BOAT_UUID --main 0.4 --jib 0.5 --json
marineverse globe boats rename BOAT_UUID --name "New Boat Name" --json
```

Inspect `anchor.can_control` and `anchor.can_trim_sails`; login/view access alone grants no control. Sail-trim crew may change sails and sheets but cannot steer or operate the anchor. Heading accepts 0–360, with 360 normalized to 0. Sail hoists use 0 (lowered) to 1 (raised); sheets use 0 (in) to 1 (eased). Omitted sails/sheets keep their setting. Never use writes as connectivity tests. Rename requires the owner and a Sailing Pass and sends the existing rename notification.

Lowering sails does not drop the physical anchor; raising sails does not retrieve it. `legacy_hold` identifies the old sail-based hold. Read `show BOAT_UUID --check-anchor --json` for `anchor.eligibility` and its reason before anchoring; omit `--check-anchor` for ordinary status. `drop-anchor` starts deployment; attachment occurs only after bottom contact. `secure-anchor --recommended` pays out and secures sufficient rode. `set-rode` accepts `--meters` or `--recommended`. Retrieval can require approaching and unloading the anchor. Track `state`, `bottom_contact`, `rode_m`, `target_rode_m`, and `secured` to distinguish acceptance from completion. Depth is simulated, not real bathymetry.

Offline stowed boats with both sails down retain the ordinary parked position and wind-vane heading behavior, including in port. There is no separate “Start drifting” action. Active attachments use the anchor simulation and its existing port/collision assist; lowering sails does not deploy an anchor.

Read JSON for the complete anchor/permissions/revision, target heading, sheets, velocities and saved timestamps. Human columns include `anchor,rode,target-rode,control,trim-sails`. CLI reads are REST snapshots; `view-3d` opens the website live view. Neither CLI nor browsers run the boat simulation or become master.

Control JSON includes `request`, `command_id`, `applied`, `reason`, `boat`, and `warning`; failures retain the request and any receipt under `error.details`. An accepted command is not proof of final deployment or execution by a game client. Boat commands retain the ordinary 30-second network deadline and are not automatically retried. The CLI never rebases a stale revision or silently repeats an ambiguous write.

After an uncertain result, inspect boat state first. If resolving the same authorized intent, use `globe boats retry-command BOAT_UUID --request 'JSON_REQUEST' --json` with the exact previous request within 15 minutes. Never change its identity, timestamp, revision or values. A stale-revision rejection requires reviewing the current state and intent before sending a new command. Older backends without command support must be updated; do not fall back to legacy anchoring or another environment.
