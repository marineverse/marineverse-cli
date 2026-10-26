import { randomUUID } from 'node:crypto';
import type { Auth } from './auth.js';
import { CliError, usage } from './errors.js';
import { RequestBudget, REQUEST_TIMEOUT_MS } from './http.js';

export type BoatCommand = 'anchor_drop' | 'anchor_set_rode' | 'anchor_secure' | 'anchor_retrieve' | 'boat_set_controls';
export type BoatCommandValues = { rode_m?: number; recommended?: boolean; heading?: number; mainsail_hoist_level?: number;
  jib_hoist_level?: number; mainsheet?: number; jibsheet?: number };
type BoatCommandEnvelope = BoatCommandValues & { command: BoatCommand; command_id: string; issued_at: string; expected_revision: number };

const reasons: Record<string, string> = {
  stale_revision: 'Another controller changed this boat. Read its state before deciding on a new command.',
  simulation_catching_up: 'Boat simulation is catching up. Read its state before deciding on a new command.',
  not_authorized: 'Your crew role does not permit this boat change.',
  application_not_authorized: 'This application is not authorized to control boats.',
  too_far_from_shore: 'Anchoring is unavailable this far from shore.',
  insufficient_depth: 'The water is too shallow for this boat.',
  insufficient_rode: 'There is not enough anchor rode for reliable holding at this depth.',
  insufficient_swing_clearance: 'There is not enough room for the boat to swing clear of land.',
  insufficient_swing_depth: 'The boat could swing into water that is too shallow.',
  shoreline_unavailable: 'Shoreline data is unavailable here.',
  drop_speed_exceeded: 'Slow the boat before dropping the anchor.',
  retrieval_requires_approach: 'Move closer to the anchor before retrieving it.',
  retrieval_load_exceeded: 'Reduce speed or anchor load before retrieving it.',
  take_in_requires_approach: 'Move closer to the anchor before taking in more rode.',
  race_active: 'Anchoring is unavailable during an active race.',
};

export function anchorReason(reason: unknown): string {
  return typeof reason === 'string' ? reasons[reason] ?? reason.replaceAll('_', ' ') : 'Unknown';
}

const record = (value: any): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);

// A receipt is durable acceptance of intent, not proof that deployment/retrieval or native execution finished.
export function commandReceipt(value: unknown, commandId: string, serializeBoat: (value: any) => any) {
  if (!record(value) || value.command_id !== commandId || typeof value.applied !== 'boolean' || typeof value.reason !== 'string' ||
      (value.applied && !record(value.boat))) {
    throw new CliError('INVALID_RESPONSE', 'The command response is invalid. Inspect boat state before sending another command.');
  }
  return { command_id: value.command_id, applied: value.applied, reason: value.reason,
    ...(typeof value.retry_horizon_seconds === 'number' ? { retry_horizon_seconds: value.retry_horizon_seconds } : {}),
    ...(record(value.boat) ? { boat: serializeBoat(value.boat) } : {}) };
}

export async function sendBoatCommand(auth: Auth, path: string, command: BoatCommand, values: BoatCommandValues,
  currentBoat: any, serializeBoat: (value: any) => any) {
  const anchor = currentBoat.anchor;
  if (anchor?.control_protocol !== 1 || !Number.isSafeInteger(anchor.revision) || anchor.revision < 0) {
    throw new CliError('UNSUPPORTED_BOAT_CONTROLS', 'The server does not provide supported boat commands. Update the backend before controlling this boat.', 6);
  }
  const envelope = Object.freeze({ ...values, command, command_id: randomUUID(), issued_at: new Date().toISOString(), expected_revision: anchor.revision });
  return sendBoatEnvelope(auth, path, envelope, serializeBoat);
}

export function parseBoatRequest(text: string): BoatCommandEnvelope {
  let request;
  try { request = text.length <= 8192 ? JSON.parse(text) : null; } catch { /* Report usage without echoing input. */ }
  const fields = ['command', 'command_id', 'issued_at', 'expected_revision', 'rode_m', 'recommended', 'heading', 'mainsail_hoist_level', 'jib_hoist_level', 'mainsheet', 'jibsheet'];
  if (!record(request) || Object.keys(request).some(key => !fields.includes(key)) ||
      !['anchor_drop', 'anchor_set_rode', 'anchor_secure', 'anchor_retrieve', 'boat_set_controls'].includes(request.command) ||
      typeof request.command_id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(request.command_id) ||
      typeof request.issued_at !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(request.issued_at) || !Number.isFinite(Date.parse(request.issued_at)) ||
      !Number.isSafeInteger(request.expected_revision) || request.expected_revision < 0 ||
      (request.recommended !== undefined && typeof request.recommended !== 'boolean') ||
      fields.slice(4).filter(key => key !== 'recommended').some(key => request[key] !== undefined &&
        (typeof request[key] !== 'number' || !Number.isFinite(request[key]) || request[key] < 0 ||
          (key !== 'rode_m' && request[key] > (key === 'heading' ? 360 : 1))))) {
    usage('Pass the unchanged request object from the earlier JSON result, including its command_id, issued_at, and expected_revision.');
  }
  return Object.freeze(request) as BoatCommandEnvelope;
}

export async function sendBoatEnvelope(auth: Auth, path: string, envelope: BoatCommandEnvelope, serializeBoat: (value: any) => any) {
  const budget = new RequestBudget(REQUEST_TIMEOUT_MS);
  try {
    const receipt = commandReceipt(await auth.write('POST', `${path}/commands`, envelope, 'globe_write', budget), envelope.command_id, serializeBoat);
    if (!receipt.applied) {
      const failure = new CliError('BOAT_COMMAND_REJECTED', anchorReason(receipt.reason), 6);
      failure.details = { request: envelope, receipt };
      throw failure;
    }
    return { ...receipt, request: envelope, update_accepted: true,
      warning: 'Command accepted by the server. Boat motion and anchor deployment/retrieval may still be in progress; this does not confirm execution by a connected game client.' };
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    let receipt;
    try { receipt = commandReceipt(error.responseBody, envelope.command_id, serializeBoat); } catch { /* Transport/old-server errors have no receipt. */ }
    error.details ??= { request: envelope, ...(receipt ? { receipt } : {}) };
    if (receipt) error.message = anchorReason(receipt.reason);
    else if (record(error.responseBody) && typeof error.responseBody.reason === 'string' && /^[a-z_]{1,80}$/.test(error.responseBody.reason)) {
      error.details.reason = error.responseBody.reason;
      error.message = anchorReason(error.responseBody.reason);
    }
    else if (error.code === 'NETWORK_ERROR' || error.code === 'INVALID_RESPONSE') {
      error.message = 'Command outcome is unknown. Inspect boat state before sending another command; this request was not automatically retried.';
    }
    error.message += ` Command ${envelope.command_id}.`;
    throw error;
  }
}
