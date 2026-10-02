import type { Auth } from './auth.js';
import type { Environment } from './config.js';
import { CliError, usage } from './errors.js';
import { request } from './http.js';

export type RacingMode = 'multiplayer' | 'drp' | 'globe';
export interface RacingFilters { mine?: boolean; league?: string; boat?: string; page?: number; type?: string; status?: string; profile?: string; country?: string; region?: string; subregion?: string; state?: string; city?: string; date?: string; days?: number }
export const racingViews = ['web', 'map_2d', 'map_3d', 'chart'] as const;

function object(value: any): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CliError('INVALID_RESPONSE', 'Expected racing data from MarineVerse.');
  return value;
}
function list(value: any): any[] {
  if (!Array.isArray(value)) throw new CliError('INVALID_RESPONSE', 'Expected a racing result list.');
  return value;
}
export function racingKey(key: string): string {
  if (key.length > 200 || !/^[A-Za-z0-9_-]+$/.test(key)) usage('Use the public race, entry, league or series key returned by MarineVerse.');
  return encodeURIComponent(key);
}
// Keep the reviewed racing DTO fields, including nested performance and dashboard sections.
const fields = new Set([
  'public_key', 'race_public_key', 'entry_public_key', 'league_public_key', 'entry_public_keys', 'name', 'description', 'boat_model', 'simulation_mode', 'requires_sailing_pass', 'parent', 'child_leagues',
  'created_at', 'finished', 'state', 'entries_count', 'start_time', 'end_time', 'reveal_time', 'results_available', 'analytics_available', 'entries', 'other_entries', 'current_user_entry', 'just_better_entry', 'entries_pagination',
  'race_time_seconds', 'time_without_handicap_seconds', 'penalty_seconds', 'handicap', 'in_progress', 'dnf', 'position', 'country_code', 'profile_uuid', 'profile_image_url', 'sail_number', 'is_mine',
  'points', 'points_change', 'rating', 'wins', 'streak', 'races_count', 'unique_races_count', 'total_points_formula', 'stats', 'legs', 'maneuvers', 'ai_summary', 'links', 'web', 'map_2d', 'map_3d', 'chart',
  'start_speed', 'start_delay', 'max_speed', 'first_mark_time', 'first_mark_speed', 'finish_line_speed', 'num_tacks', 'num_gybes', 'avg_speed', 'avg_vmg', 'distance_traveled', 'duration_seconds', 'game_time',
  'metric', 'first', 'second', 'difference', 'duration_difference_seconds', 'start_date', 'end_date', 'threshold', 'races', 'series', 'league', 'pagination', 'current_page', 'per_page', 'total_pages', 'total_entries',
  'type', 'date', 'previous_date', 'countries', 'code', 'region', 'subregion', 'state_name', 'city', 'boat', 'uuid', 'heading', 'latitude', 'longitude', 'speed_knots', 'finish_time', 'distance_to_destination_nm',
  'passed_feature_count', 'next_feature_distance_nm', 'next_feature', 'last_update', 'location_name', 'last_speed_kts', 'last_speed_in_kts', 'owner',
  'user', 'yesterday', 'today', 'global', 'country', 'active', 'multiplayer', 'globe', 'streaks', 'leagues', 'boats', 'daily_race', 'marineverse',
  'valid_subscription', 'subscription_tier', 'rating_change', 'podiums', 'races_completed', 'region_type', 'league_name', 'race_name', 'total_participants', 'race', 'location_key', 'seconds_until_reveal',
  'is_finished', 'attempts_used', 'attempts_limit', 'can_race', 'user_latest_time', 'user_latest_position', 'participants_count', 'has_no_leagues', 'change', 'series_type', 'races_required', 'user_position', 'user_points',
  'is_qualified', 'rating_position', 'last_race_time', 'total_races', 'recent_races', 'race_time', 'podium_position', 'has_boat', 'is_currently_racing', 'active_race_public_key', 'current_streak', 'total_active_days', 'last_sailed_date',
  'my_attempts', 'my_attempts_count', 'my_attempts_pagination', 'replay_available', 'boat_uuid', 'leg', 'differences', 'from_mark', 'to_mark', 'last_race', 'last_considered_race_time', 'days',
  'mode', 'requested_date', 'previous_points', 'points_before', 'points_after', 'calculation_log', 'previous_rating', 'rating_change', 'membership', 'memberships', 'participation', 'podium_totals', 'first_place', 'second_place', 'third_place', 'total', 'status',
  'ranked', 'history_available', 'explanation_available', 'calculated_points_change', 'reconciled', 'ranking', 'third', 'recent_entries', 'entered_at', 'latest_entry',
  'short_description', 'registration_opens_at', 'registration_closes_at', 'start_at', 'started_at', 'completed_at', 'registration_status', 'my_registration', 'is_registered', 'can_register', 'can_cancel_registration', 'is_organizer',
  'participants', 'matches', 'active', 'final_rank', 'seed', 'sailor', 'multiplayer_rating', 'round', 'match_number', 'scheduled_start_at', 'next_match_number', 'finishing_position', 'showed_up',
  'time_zone', 'longest_streak', 'total_count', 'count_unit', 'activities', 'count', 'level', 'streak_message', 'time', 'explain', 'history_unavailable_reason',
  'wind_speed_kn', 'my_result', 'latest_race', 'navigation', 'unqualified_entries', 'unqualified_count', 'total_sailors', 'race_contributions', 'max_points',
  'revealed_races_only', 'threshold_basis', 'calculated_through', 'my_position', 'my_points', 'my_races_completed', 'my_qualified', 'my_races_needed', 'races_needed',
  'published_at', 'is_anchored', 'kind', 'sequence', 'duration', 'rating_boat_model', 'availability_reasons', 'change_unavailable_reason',
  'day', 'activity', 'drp', 'total_entries', 'truncated', 'opportunities', 'sessions', 'available', 'error', 'globe_participation', 'participation_basis',
  'session_key', 'next_start', 'day_of_week', 'hour', 'minute', 'time_label', 'time_zone_label', 'next_session_label', 'volunteers', 'community_volunteers', 'as_of', 'source', 'live', 'events', 'schema_version',
]);
function clean(value: any): any {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => fields.has(key))
    .map(([key, item]) => [key, key === 'next_feature' && item && typeof item === 'object'
      ? { ...clean(item), ...(Object.hasOwn(item, 'id') ? { id: (item as Record<string, unknown>).id } : {}) } : clean(item)]));
  return value;
}
function resource(value: any) {
  const data = object(value);
  if (typeof data.public_key !== 'string' || (data.name != null && typeof data.name !== 'string')) throw new CliError('INVALID_RESPONSE', 'Racing response is missing its public key or has an invalid name.');
  const result = clean(data);
  // Course feature IDs are public geometry identifiers, separate from database row IDs.
  for (const key of ['origin', 'destination', 'course', 'track']) if (data[key] !== undefined) result[key] = data[key];
  return result;
}
function query(filters: RacingFilters, mode?: RacingMode, rankings = false): string {
  const { mine, league, boat, page, type, status, profile, country, region, subregion, state, city, date, days } = filters;
  if (league !== undefined) racingKey(league);
  if (profile !== undefined && (profile.length > 200 || !/^[A-Za-z0-9_/-]+$/.test(profile))) usage('Use a public sailor profile key returned by MarineVerse.');
  if (boat !== undefined && !/^[A-Za-z0-9_-]{1,80}$/.test(boat)) usage('Use a boat model returned by MarineVerse.');
  if (page !== undefined && (!Number.isInteger(page) || page < 1 || page > 10000)) usage('--page must be an integer from 1 to 10000.');
  if (country !== undefined && !/^[A-Za-z]{2}$/.test(country)) usage('Use a two-letter country code, such as AU.');
  for (const [name, value] of Object.entries({ region, subregion, state, city })) if (value !== undefined && (!value.trim() || value.length > 100 || /[\x00-\x1f\x7f]/.test(value))) usage(`--${name} must contain 1–100 characters.`);
  if (date !== undefined) calendarDate(date, '--date');
  if (days !== undefined && (!Number.isInteger(days) || days < 0 || days > 3650)) usage('--days must be an integer from 0 to 3650 (0 means all time).');
  if (rankings) {
    const choices = mode === 'multiplayer' ? ['rating', 'participation'] : ['rating', 'wins', 'streaks'];
    if (type !== undefined && !choices.includes(type)) usage(`Choose --type from: ${choices.join(', ')}.`);
    if (mode === 'multiplayer' && (league !== undefined || date !== undefined)) usage('Multiplayer rankings support --boat and --country, with --days for participation.');
    if (mode === 'drp' && (boat !== undefined || days !== undefined)) usage('Daily Race Practice rankings support --league and --country, with --date for rating.');
    if (date !== undefined && type !== undefined && type !== 'rating') usage('--date is available for rating rankings.');
    if (days !== undefined && type !== 'participation') usage('--days requires --type participation.');
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ mine: mine || undefined, league, boat, page, type, status, profile, country: country?.toUpperCase(), region, subregion, state, city, date, days })) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.size ? `?${params}` : '';
}

function calendarDate(value: string, flag: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) usage(`${flag} must be a valid date in YYYY-MM-DD format.`);
}

export class RacingClient {
  constructor(private readonly environment: Environment, private readonly auth: Auth) {}
  private async get(path: string, personal = false, optionalSession = false) {
    const endpoint = `/api/v3/racing${path}`;
    if (personal || (optionalSession && await this.auth.credentials.read())) return object(await this.auth.get(endpoint, 'sailing_cv'));
    return object(await request(`${this.environment.apiUrl}${endpoint}`));
  }
  async dashboard() {
    const result = await this.get('/dashboard', true);
    return { dashboard: clean(object(result.dashboard)) };
  }
  async day(day: 'today' | 'yesterday') {
    const result = await this.get(`/day?${new URLSearchParams({ day })}`, true);
    return { day: clean(object(result.day)) };
  }
  async activity(options: { type?: string; since?: string; until?: string } = {}) {
    const type = options.type ?? 'marineverse';
    if (!['marineverse', 'drp', 'multiplayer'].includes(type)) usage('Choose --type marineverse, drp or multiplayer.');
    for (const [flag, value] of Object.entries({ '--since': options.since, '--until': options.until })) if (value !== undefined) calendarDate(value, flag);
    if (options.since && options.until && options.since > options.until) usage('--since must be at or before --until.');
    const params = new URLSearchParams({ type });
    if (options.since) params.set('since', options.since);
    if (options.until) params.set('until', options.until);
    const result = await this.get(`/activity?${params}`, true);
    const activity = object(result.activity);
    list(activity.activities);
    return { activity: clean(activity) };
  }
  async schedule() {
    const result = await this.get('/schedule');
    const schedule = object(result.schedule);
    if (schedule.schema_version !== 1 || typeof schedule.source !== 'string' || typeof schedule.as_of !== 'string') throw new CliError('INVALID_RESPONSE', 'Unsupported racing schedule.');
    for (const value of list(schedule.sessions)) {
      const session = object(value);
      if (typeof session.session_key !== 'string' || typeof session.description !== 'string' || typeof session.time_zone !== 'string'
        || typeof session.next_start !== 'string' || !Number.isFinite(Date.parse(session.next_start))) throw new CliError('INVALID_RESPONSE', 'Expected a valid upcoming sailing session.');
      try { new Intl.DateTimeFormat('en', { timeZone: session.time_zone }); }
      catch { throw new CliError('INVALID_RESPONSE', 'The sailing session time zone is invalid.'); }
      list(session.volunteers);
    }
    object(schedule.links);
    list(schedule.community_volunteers);
    return { schedule: clean(schedule) };
  }
  async leagues(mine = false) {
    const result = await this.get(`/leagues${query({ mine })}`, mine, true);
    return { leagues: list(result.leagues).map(resource) };
  }
  async league(key: string) {
    const result = await this.get(`/leagues/${racingKey(key)}`, false, true);
    return { league: resource(result.league) };
  }
  async races(mode: RacingMode, filters: RacingFilters = {}) {
    const result = await this.get(`/${mode}/races${query(filters)}`, !!filters.mine, true);
    return { races: list(result.races).map(resource), ...(result.pagination !== undefined ? { pagination: clean(object(result.pagination)) } : {}) };
  }
  async race(mode: RacingMode, key: string, page?: number) {
    const result = await this.get(`/${mode}/races/${racingKey(key)}${query({ page })}`, false, true);
    const race = resource(result.race);
    if (race.entries !== undefined) list(race.entries);
    return { race };
  }
  async entry(mode: RacingMode, key: string) {
    const result = await this.get(`/${mode}/entries/${racingKey(key)}`, false, true);
    return { entry: resource(result.entry) };
  }
  async entries(mode: RacingMode, options: { mine?: boolean; page?: number; since?: string; race?: string }) {
    if (!options.mine) usage('Use --mine to read your race entry history.');
    const filters = query({ mine: true, page: options.page });
    if (options.race !== undefined) racingKey(options.race);
    if (options.since !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(options.since) || !Number.isFinite(Date.parse(options.since)))) usage('--since must be an ISO 8601 timestamp with a time zone.');
    const extras = new URLSearchParams();
    if (options.since !== undefined) extras.set('since', options.since);
    if (options.race !== undefined) extras.set('race', options.race);
    const result = await this.get(`/${mode}/entries${filters}${extras.size ? `&${extras}` : ''}`, true);
    return { entries: list(result.entries).map(resource), pagination: clean(object(result.pagination)) };
  }
  async compare(mode: RacingMode, first: string, second: string) {
    racingKey(first); racingKey(second);
    if (first === second) usage('Choose two different entry keys to compare.');
    const result = await this.get(`/${mode}/entries/compare?${new URLSearchParams({ entries: `${first},${second}` })}`, false, true);
    const comparison = object(result.comparison);
    const entries = list(comparison.entries).map(resource);
    if (entries.length !== 2 || entries.some(entry => ![first, second].includes(entry.public_key))) throw new CliError('INVALID_RESPONSE', 'Expected the two requested racing entries.');
    return { comparison: { ...clean(comparison), entries } };
  }
  async rankings(mode: RacingMode, filters: RacingFilters = {}) {
    const result = await this.get(`/${mode}/rankings${query(filters, mode, true)}`);
    return { ...clean(result), rankings: list(result.rankings).map(value => clean(object(value))) };
  }
  async rating(mode: RacingMode, filters: RacingFilters = {}) {
    const suffix = query(filters);
    const result = await this.get(`/${mode}/rating${suffix}`, true);
    return { rating: clean(object(result.rating)) };
  }
  async explainRating(filters: RacingFilters = {}) {
    const suffix = query(filters);
    const result = await this.get(`/drp/rating/explain${suffix}`, true);
    return { explanation: clean(object(result.explanation)) };
  }
  async tournaments(options: RacingFilters = {}) {
    const result = await this.get(`/tournaments${query({ mine: options.mine, page: options.page })}`, !!options.mine, true);
    return { tournaments: list(result.tournaments).map(resource), pagination: clean(object(result.pagination)) };
  }
  async tournament(key: string) {
    const result = await this.get(`/tournaments/${racingKey(key)}`, false, true);
    return { tournament: resource(result.tournament) };
  }
  async series(filters: RacingFilters = {}) {
    if (filters.type !== undefined && !['weekly', 'monthly', 'seasonal'].includes(filters.type)) usage('Choose --type weekly, monthly or seasonal.');
    if (filters.status !== undefined && !['current', 'past', 'upcoming'].includes(filters.status)) usage('Choose --status current, past or upcoming.');
    const result = await this.get(`/drp/series${query(filters)}`, false, true);
    return { series: list(result.series).map(resource), ...(result.pagination !== undefined ? { pagination: clean(object(result.pagination)) } : {}) };
  }
  async showSeries(key: string) {
    const result = await this.get(`/drp/series/${racingKey(key)}`, false, true);
    return { series: resource(result.series) };
  }
  link(resource: any, view: string = 'web'): string {
    if (!(racingViews as readonly string[]).includes(view)) usage(`Choose --view from: ${racingViews.join(', ')}.`);
    const value = object(resource).links?.[view];
    if (typeof value !== 'string') throw new CliError('LINK_UNAVAILABLE', `MarineVerse did not return a ${view} link for this result.`);
    let url: URL;
    try { url = new URL(value); } catch { throw new CliError('INVALID_RESPONSE', 'MarineVerse returned an invalid racing link.'); }
    if (![new URL(this.environment.webUrl).origin, 'https://www.marineverse.com'].includes(url.origin) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new CliError('INVALID_RESPONSE', 'MarineVerse returned a racing link outside the configured or official website.');
    return url.href;
  }
}
