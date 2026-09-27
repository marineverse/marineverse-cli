import type { Environment } from './config.js';
import { Auth } from './auth.js';
import { CliError, usage } from './errors.js';
import { request } from './http.js';

function object(value: any): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CliError('INVALID_RESPONSE', 'Unexpected API response structure.');
  return value;
}
function array(value: any): any[] {
  if (!Array.isArray(value)) throw new CliError('INVALID_RESPONSE', 'Expected an API result list.');
  return value;
}
function pick(value: any, keys: string[]) {
  object(value);
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}
function identifier(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) usage('Use the public race key or boat UUID, without a URL or path.');
  return encodeURIComponent(value);
}
export function boat(value: any) {
  const data = pick(value, ['uuid', 'name', 'heading', 'location_name', 'latitude', 'longitude', 'p_lat', 'p_lng', 'last_speed_kts', 'last_speed_in_kts', 'mainsail_hoist', 'jib_hoist', 'is_owner', 'is_crew']);
  if (typeof data.uuid !== 'string') throw new CliError('INVALID_RESPONSE', 'Boat response is missing its UUID.');
  data.latitude = data.latitude ?? data.p_lat ?? null;
  data.longitude = data.longitude ?? data.p_lng ?? null;
  return data;
}
function raceSummary(value: any) {
  const data = pick(value, ['publicKey', 'name', 'destinationName', 'state', 'entriesCount', 'startTime', 'endTime', 'courseFeatureCount']);
  if (typeof data.publicKey !== 'string') throw new CliError('INVALID_RESPONSE', 'Race response is missing its public key.');
  return data;
}
function entry(value: any) {
  return { ...pick(value, ['position', 'finishTime', 'penaltySeconds', 'raceTimeSeconds', 'distanceToDestination', 'passedFeatureCount', 'nextFeatureDistanceNm', 'state', 'lastUpdate']),
    boat: boat(value.boat), owner: pick(value.owner, ['uuid', 'name', 'countryCode', 'sailNumber']) };
}

const tutorialNames = [
  'yacht_tutorial_basics', 'yacht_tutorial_steering', 'yacht_tutorial_wind_direction', 'yacht_tutorial_sailing_terms',
  'yacht_tutorial_upwind', 'yacht_tutorial_pos_speed', 'yacht_tutorial_starting_race', 'yacht_tutorial_spinnaker',
  'hansa303_tutorial_basics', 'dinghy_tutorial_basics', 'dinghy_tutorial_sailing_terms', 'dinghy_tutorial_going_fast',
  'sailing_ed_self_mastery', 'navigation_rules', 'maneuvering_monohull_sail', 'maneuvering_monohull_power', 'maneuvering_catamaran',
];

function identity(value: any) {
  const data = pick(value, ['uuid', 'display_name']);
  if (typeof data.uuid !== 'string') throw new CliError('INVALID_RESPONSE', 'Profile response is missing its UUID.');
  return data;
}

function metric(value: unknown): number | null {
  if (value == null) return null;
  // Rails serializes decimal columns as strings, including scientific notation.
  if (typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) value = Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new CliError('INVALID_RESPONSE', 'Unexpected sailing statistics.');
  return value;
}

export class MarineVerseClient {
  readonly auth: Auth;
  constructor(readonly environment: Environment) { this.auth = new Auth(environment); }
  private publicGet(path: string) { return request(`${this.environment.apiUrl}/api/v2/globe${path}`); }

  async myProfile() {
    const result = object(await this.auth.get('/api/v3/users/me'));
    return { profile: { ...identity(result), ...pick(result, ['sailing_experience', 'marineverse_interests', 'time_zone',
      'country_code', 'main_use_case', 'sailing_experience_level']) } };
  }

  private async sailingProgress() { return object(await this.auth.get('/api/v3/sailing_progress', 'sailing_cv')); }

  async progress() {
    const result = await this.sailingProgress();
    const tutorial = object(result.tutorial);
    return { progress: { ...identity(result), ...pick(result, ['next_step', 'yacht_onboarding_progress', 'dinghy_onboarding_progress', 'finished_race']),
      tutorials: tutorialNames.filter(name => `${name}_started_at` in tutorial || `${name}_finished_at` in tutorial).map(name => {
        const started = tutorial[`${name}_started_at`] ?? null;
        const finished = tutorial[`${name}_finished_at`] ?? null;
        if ([started, finished].some(value => value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value))))) {
          throw new CliError('INVALID_RESPONSE', 'Unexpected tutorial timestamps.');
        }
        return { name, status: finished ? 'completed' : started ? 'in_progress' : 'not_started', started_at: started, finished_at: finished };
      }) } };
  }

  async distance(boatType?: string) {
    const result = await this.sailingProgress();
    const stats = object(result.boat_stats);
    if (boatType !== undefined && !Object.hasOwn(stats, boatType)) usage(`Unknown boat type. Choose from: ${Object.keys(stats).join(', ')}.`);
    return { ...identity(result), period: 'overall', distance_stats: Object.entries(stats)
      .filter(([name]) => boatType === undefined || name === boatType)
      .map(([name, value]) => {
        const row = object(value);
        return { boat_type: name, total_distance_nm: metric(row.total_distance_nm), total_time_minutes: metric(row.total_time_minutes) };
      }) };
  }

  async races() {
    const result = object(await this.publicGet('/races'));
    return { registration_open: array(result.registration_open_races).map(raceSummary), active: array(result.active_races).map(raceSummary),
      finished: array(result.finished_races).map(raceSummary), finished_limit: 10 };
  }
  async race(key: string): Promise<Record<string, any>> {
    const result = object(await this.publicGet(`/races/${identifier(key)}`));
    const race = object(result.race);
    return { ...raceSummary(race), ...pick(race, ['description', 'publishedAt']), entries: array(race.entries).map(entry) };
  }
  async profile(uuid: string) {
    const result = object(await this.publicGet(`/boats/${identifier(uuid)}/profile`));
    return { boat: boat(result.boat), races: result.races ? Object.fromEntries(['active', 'past'].map(group => [group,
      array(result.races[group]).map(item => pick(item, ['publicKey', 'name', 'state', 'finishTime']))])) : undefined };
  }
  async boats() { return { boats: array((await this.auth.get('/api/v3/globe_boats')).boats).map(boat) }; }
  async showBoat(uuid: string) { return { boat: boat((await this.auth.get(`/api/v3/globe_boats/${identifier(uuid)}`)).boat) }; }
  async updateBoat(uuid: string, change: { heading?: number; name?: string }) {
    const path = `/api/v3/globe_boats/${identifier(uuid)}`;
    const accepted = boat((await request(`${this.environment.apiUrl}${path}`, { method: 'PATCH',
      headers: { Authorization: `Bearer ${await this.auth.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ boat: change }) })).boat);
    try {
      const verified = await this.showBoat(uuid);
      const matches = Object.entries(change).every(([key, value]) => verified.boat[key] === value);
      return { ...verified, requested_change: change, update_accepted: true, verified: matches,
        ...(!matches ? { warning: 'The saved state differs from the request. Simulation or another controller may have adjusted it; anchored boats turn with the wind.' } : {}) };
    } catch {
      return { boat: accepted, requested_change: change, update_accepted: true, verified: false, warning: 'Update accepted, but readback failed. Check boat state before retrying.' };
    }
  }
}
