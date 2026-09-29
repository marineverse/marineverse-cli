import { CliError, usage } from './errors.js';
import { request } from './http.js';
import type { Auth } from './auth.js';

export const clubTypes = ['yacht_club', 'sailing_school', 'sailability_chapter', 'federation', 'class_association', 'team', 'other'];
export interface ClubSearchOptions { latitude?: number; longitude?: number; radiusKm?: number; type?: string; country?: string; limit?: number }

function invalid(): never { throw new CliError('INVALID_RESPONSE', 'Expected a valid club membership response.'); }
function publicClub(club: any) {
  if (!club || typeof club.uuid !== 'string' || typeof club.slug !== 'string' || typeof club.name !== 'string' || typeof club.description !== 'string' || typeof club.url !== 'string') invalid();
  return Object.fromEntries(['uuid', 'slug', 'name', 'description', 'url', 'type', 'type_label', 'city', 'country_code', 'latitude', 'longitude', 'website', 'join_policy'].filter(key => club[key] !== undefined).map(key => [key, club[key]]));
}
function identifier(club: string) {
  if (club.length > 100 || !/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/.test(club)) usage('Use a club UUID or slug from marineverse groups search.');
  return encodeURIComponent(club);
}
function membership(value: any) {
  if (!value || typeof value.role !== 'string' || typeof value.status !== 'string') invalid();
  return { role: value.role, status: value.status };
}
function pending(value: any) {
  if (!value || typeof value.status !== 'string' || (value.message !== undefined && value.message !== null && typeof value.message !== 'string')) invalid();
  return { status: value.status, ...(value.message !== undefined ? { message: value.message } : {}) };
}

export class ClubsClient {
  constructor(private readonly apiUrl: string, private readonly auth: Auth) {}

  async list() {
    const result = await this.auth.get('/api/v3/sailing-clubs/my', 'clubs_read');
    if (!Array.isArray(result?.memberships) || !Array.isArray(result?.pending_requests)) invalid();
    return { memberships: result.memberships.map((entry: any) => ({ club: publicClub(entry?.club), ...membership(entry) })),
      pending_requests: result.pending_requests.map((entry: any) => ({ club: publicClub(entry?.club), ...pending(entry) })) };
  }

  async join(club: string, message?: string) {
    const key = identifier(club);
    if (message !== undefined && (!message.trim() || message.length > 10000)) usage('--message must contain 1–10000 characters.');
    const result = await this.auth.write('POST', `/api/v3/sailing-clubs/${key}/join`, message === undefined ? {} : { message: message.trim() }, 'clubs_write');
    if (!['joined', 'pending_approval'].includes(result?.status)) invalid();
    return { status: result.status, club: publicClub(result.club),
      ...(result.membership !== undefined ? { membership: membership(result.membership) } : {}),
      ...(result.request !== undefined ? { request: pending(result.request) } : {}) };
  }

  async leave(club: string) {
    const key = identifier(club);
    const result = await this.auth.write('DELETE', `/api/v3/sailing-clubs/${key}/leave`, {}, 'clubs_write');
    if (result?.status !== 'left') invalid();
    return { status: result.status, club: publicClub(result.club) };
  }

  async search(query?: string, options: ClubSearchOptions = {}) {
    if (query !== undefined && (!query.trim() || query.length > 200)) usage('Search must contain 1–200 characters.');
    const { latitude, longitude, radiusKm, type, country, limit = 10 } = options;
    if ((latitude === undefined) !== (longitude === undefined)) usage('Provide both --latitude and --longitude.');
    if (radiusKm !== undefined && latitude === undefined) usage('--radius-km requires --latitude and --longitude.');
    for (const [name, value, min, max] of [['latitude', latitude, -90, 90], ['longitude', longitude, -180, 180], ['radius-km', radiusKm, 1, 500]] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) usage(`--${name} must be a number from ${min} to ${max}.`);
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) usage('--limit must be an integer from 1 to 50.');
    if (type !== undefined && !clubTypes.includes(type)) usage(`Choose --type from: ${clubTypes.join(', ')}.`);
    if (country !== undefined && !/^[A-Za-z]{2}$/.test(country)) usage('Use a two-letter country code such as AU for --country.');
    const url = new URL('/api/v2/sailing-clubs', this.apiUrl);
    const filters = { q: query?.trim(), latitude, longitude, radius_km: radiusKm, club_type: type, country_code: country?.toUpperCase(), limit };
    for (const [key, value] of Object.entries(filters)) if (value !== undefined) url.searchParams.set(key, String(value));
    const result = await request(url.href);
    if (!Array.isArray(result?.clubs)) throw new CliError('INVALID_RESPONSE', 'Expected sailing clubs.');
    return { clubs: result.clubs.map((club: any) => {
      if (!club || typeof club.name !== 'string' || typeof club.description !== 'string' || typeof club.canonicalUrl !== 'string') {
        throw new CliError('INVALID_RESPONSE', 'Club response is missing its name, description or MarineVerse URL.');
      }
      return { uuid: club.uuid, slug: club.slug, join_policy: club.joinPolicy ?? club.join_policy, name: club.name, description: club.description, url: club.canonicalUrl, type: club.clubType,
        city: club.city, country_code: club.countryCode, ...(club.distanceKm !== undefined ? { distance_km: club.distanceKm } : {}) };
    }) };
  }
}
