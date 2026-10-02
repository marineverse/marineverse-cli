import type { Environment } from './config.js';
import { Auth } from './auth.js';
import { CliError, usage } from './errors.js';
import { request } from './http.js';
import { FeedbackClient } from './feedback.js';
import { ContentClient } from './content.js';
import { ClubsClient } from './clubs.js';
import { RacingClient } from './racing.js';

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
  const data = pick(value, ['uuid', 'name', 'heading', 'location_name', 'latitude', 'longitude', 'p_lat', 'p_lng', 'last_speed_kts', 'last_speed_in_kts', 'mainsail_hoist', 'jib_hoist', 'is_anchored', 'is_owner', 'is_crew',
    'awa', 'time_since_last_update_seconds', 'in_port', 'crew_role', 'weather_now']);
  if (typeof data.uuid !== 'string') throw new CliError('INVALID_RESPONSE', 'Boat response is missing its UUID.');
  data.latitude = data.latitude ?? data.p_lat ?? null;
  data.longitude = data.longitude ?? data.p_lng ?? null;
  data.mainsail_hoist = data.mainsail_hoist ?? value.mainsail_hoist_level ?? null;
  data.jib_hoist = data.jib_hoist ?? value.jib_hoist_level ?? null;
  return data;
}
function raceSummary(value: any) {
  const data = pick(value, ['publicKey', 'name', 'destinationName', 'state', 'entriesCount', 'startTime', 'endTime', 'courseFeatureCount']);
  if (typeof data.publicKey !== 'string') throw new CliError('INVALID_RESPONSE', 'Race response is missing its public key.');
  return data;
}
function entry(value: any) {
  return { ...pick(value, ['position', 'finishTime', 'penaltySeconds', 'raceTimeSeconds', 'distanceToDestination', 'passedFeatureCount', 'nextFeatureDistanceNm', 'state', 'lastUpdate']),
    nextFeature: value.nextFeature == null ? null : pick(value.nextFeature, ['id', 'kind', 'name', 'sequence']),
    boat: boat(value.boat), owner: pick(value.owner, ['uuid', 'name', 'countryCode', 'sailNumber']) };
}
// Course geometry is public race data; features keep their server order (by sequence).
function raceCourse(value: any) {
  return {
    origin: value.origin == null ? null : pick(value.origin, ['lat', 'lng']),
    destination: value.destination == null ? null : pick(value.destination, ['name', 'lat', 'lng']),
    course: value.course == null ? null : { ...pick(value.course, ['version', 'strict_order', 'waypoint_radius_nm_default']), features: array(value.course.features) },
  };
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
  readonly feedback: FeedbackClient;
  readonly content: ContentClient;
  readonly clubs: ClubsClient;
  readonly racing: RacingClient;
  constructor(readonly environment: Environment) {
    this.auth = new Auth(environment);
    this.feedback = new FeedbackClient(this.auth);
    this.content = new ContentClient(environment.apiUrl);
    this.clubs = new ClubsClient(environment.apiUrl, this.auth);
    this.racing = new RacingClient(environment, this.auth);
  }
  private publicGet(path: string) { return request(`${this.environment.apiUrl}/api/v2/globe${path}`); }

  async knowledgeSearch(query: string, limit = 5) {
    if (!query.trim() || query.length > 2000) usage('Search must contain 1–2000 characters.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) usage('--limit must be an integer from 1 to 10.');
    const result = object(await this.auth.post('/api/v3/knowledge_base/search', { query: query.trim(), limit }, 'kb_read'));
    return { articles: array(result.articles).map(article => pick(article, ['uuid', 'title', 'excerpt', 'relevance'])), tokens: pick(result.tokens, ['consumed', 'remaining']) };
  }

  async knowledgeArticle(uuid: string) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(uuid)) usage('Use the article UUID from kb search.');
    const result = object(await this.auth.get(`/api/v3/knowledge_base/${uuid}`, 'kb_read'));
    return { article: pick(result.article, ['uuid', 'title', 'content']) };
  }

  async ask(question: string) {
    if (!question.trim() || question.length > 8000) usage('Question must contain 1–8000 characters.');
    const result = object(await this.auth.post('/api/v3/ai/ask', { question: question.trim() }, 'ai_ask'));
    if (typeof result.answer !== 'string') throw new CliError('INVALID_RESPONSE', 'AI response is missing its answer.');
    return { ...pick(result, ['answer', 'interaction_uuid']), tokens: pick(result.tokens, ['consumed', 'remaining']) };
  }

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
    return { ...raceSummary(race), ...pick(race, ['description', 'publishedAt']), ...raceCourse(race), entries: array(race.entries).map(entry) };
  }
  // Deliberate allowlist of public profile sections. Logs, tracks, crew members and owner-only
  // controls (applications, invite links) are never passed through.
  async profile(uuid: string) {
    const result = object(await this.publicGet(`/boats/${identifier(uuid)}/profile`));
    const port = (value: any) => value == null ? null : pick(value, ['uuid', 'name', 'p_lat', 'p_lng', 'typeName']);
    const latest = result.port_calls ? array(result.port_calls)[0] : undefined; // newest first
    return { boat: boat(result.boat),
      weather: result.weather && Object.keys(result.weather).length ? object(result.weather) : null,
      last_port_call: latest ? { port: pick(latest.port, ['name', 'uuid']), ...pick(latest, ['event_type', 'event_timestamp']) } : null,
      boat_stats: result.boat_stats ? pick(result.boat_stats, ['overall', 'yearly', 'monthly', 'daily']) : undefined,
      passages: result.passages ? array(result.passages).map(passage => ({ ...pick(passage, ['uuid', 'departedAt', 'arrivedAt', 'durationSeconds', 'rhumbDistanceNm']),
        startPort: port(passage.startPort), endPort: port(passage.endPort) })) : undefined,
      seas_visited: result.seas_visited ? array(result.seas_visited).map(visit => ({ sea: pick(visit.sea, ['name']), ...pick(visit, ['first_visited_at', 'latest_visited_at', 'visit_count']) })) : undefined,
      races: result.races ? Object.fromEntries(['active', 'past'].map(group => [group,
        array(result.races[group]).map(item => pick(item, ['publicKey', 'name', 'state', 'finishTime']))])) : undefined };
  }
  // Weather is opt-in: the server adds each boat's `weather_now` estimate within one bounded request.
  async boats(weather = false) {
    const result = object(await this.auth.get(`/api/v3/globe_boats${weather ? '?include=weather' : ''}`));
    return { boats: array(result.boats).map(boat), ...pick(result, ['weather_units']) };
  }
  // One read returns current state, forecast arrays, an interpolated "now" estimate, units and the latest port call.
  async showBoat(uuid: string) {
    const result = object(await this.auth.get(`/api/v3/globe_boats/${identifier(uuid)}`));
    return { boat: boat(result.boat), ...pick(result, ['weather', 'weather_now', 'weather_units', 'last_port_call']) };
  }
  // One bounded, newest-first page of one history type, fetched only on request.
  async boatHistory(uuid: string, options: { type: string; limit: number; since?: string; cursor?: string }) {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 200) usage('--limit must be an integer from 1 to 200.');
    const query = new URLSearchParams({ type: options.type, limit: String(options.limit),
      ...(options.since ? { since: options.since } : {}), ...(options.cursor ? { cursor: options.cursor } : {}) });
    const result = object(await this.auth.get(`/api/v3/globe_boats/${identifier(uuid)}/history?${query}`));
    const port = (value: any) => value == null ? null : pick(value, ['uuid', 'name', 'p_lat', 'p_lng', 'typeName']);
    const item: (value: any) => Record<string, unknown> = ({
      logs: (entry: any) => ({ ...pick(entry, ['timestamp', 'heading', 'last_speed_in_kts', 'sog', 'wind_speed', 'current_speed', 'awa', 'offline', 'event']),
        latitude: entry.p_lat ?? null, longitude: entry.p_lng ?? null }),
      'port-calls': (call: any) => ({ port: pick(call.port, ['name', 'uuid']), ...pick(call, ['event_type', 'event_timestamp']) }),
      passages: (passage: any) => ({ ...pick(passage, ['uuid', 'departedAt', 'arrivedAt', 'durationSeconds', 'rhumbDistanceNm']),
        startPort: port(passage.startPort), endPort: port(passage.endPort) }),
    } as Record<string, (value: any) => Record<string, unknown>>)[options.type] ?? usage('Choose --type logs, port-calls or passages.');
    return { uuid: result.uuid, type: options.type, items: array(result.items).map(item), next_cursor: result.next_cursor ?? null,
      ...pick(result, ['oldest_available_at']) };
  }
  async updateBoat(uuid: string, change: { heading?: number; name?: string; mainsail_hoist?: number; jib_hoist?: number }) {
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
