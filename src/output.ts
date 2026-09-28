import { stripVTControlCharacters } from 'node:util';
import { usage } from './errors.js';

export function safe(value: unknown): string {
  return stripVTControlCharacters(String(value ?? '—')).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}
function table(rows: any[], columns: [string, (row: any) => unknown][]): string {
  if (!rows.length) return '(none)';
  const cells = [columns.map(([title]) => title), ...rows.map(row => columns.map(([, get]) => safe(get(row))))];
  const widths = columns.map((_, i) => Math.max(...cells.map(row => row[i].length)));
  return cells.map(row => row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}
const raceColumns: [string, (row: any) => unknown][] = [['RACE KEY', r => r.publicKey], ['NAME', r => r.name], ['STATE', r => r.state], ['START (UTC)', r => r.startTime]];
const rounded = (value: unknown) => typeof value === 'number' ? Math.round(value * 10) / 10 : value;
const coordinate = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(5) : value;
const boatColumns: [string, (row: any) => unknown][] = [['BOAT UUID', b => b.uuid], ['NAME', b => b.name], ['LATITUDE (°)', b => coordinate(b.latitude)], ['LONGITUDE (°)', b => coordinate(b.longitude)], ['HEADING (°)', b => rounded(b.heading)], ['SPEED (kn)', b => rounded(b.last_speed_kts ?? b.last_speed_in_kts)], ['LOCATION', b => b.location_name], ['MAIN', b => b.mainsail_hoist], ['JIB', b => b.jib_hoist], ['ANCHORED', b => b.is_anchored]];
const leaderboardColumns: [string, (row: any) => unknown][] = [['POS', e => e.position], ['BOAT UUID', e => e.boat.uuid], ['BOAT', e => e.boat.name], ['LATITUDE (°)', e => coordinate(e.boat.latitude)], ['LONGITUDE (°)', e => coordinate(e.boat.longitude)], ['STATE', e => e.state], ['DISTANCE (nm)', e => rounded(e.distanceToDestination)], ['RACE TIME (s)', e => rounded(e.raceTimeSeconds)], ['PENALTY (s)', e => e.penaltySeconds]];
const tutorialColumns: [string, (row: any) => unknown][] = [['TUTORIAL', r => r.name], ['STATUS', r => r.status], ['STARTED (UTC)', r => r.started_at], ['FINISHED (UTC)', r => r.finished_at]];
const distanceColumns: [string, (row: any) => unknown][] = [['BOAT TYPE', r => r.boat_type], ['DISTANCE (nm)', r => rounded(r.total_distance_nm)], ['TIME (min)', r => rounded(r.total_time_minutes)]];
export const columnNames = {
  boats: ['uuid', 'name', 'latitude', 'longitude', 'heading', 'speed', 'location', 'main', 'jib', 'anchored'],
  races: ['key', 'name', 'state', 'start'],
  leaderboard: ['position', 'uuid', 'name', 'latitude', 'longitude', 'state', 'distance', 'race-time', 'penalty'],
  tutorials: ['name', 'status', 'started', 'finished'],
  distance: ['boat', 'distance', 'time'],
};
export type TableKind = keyof typeof columnNames;

export function validateColumns(kind: TableKind, requested?: string): string[] | undefined {
  if (requested === undefined) return undefined;
  const columns = requested.split(',').map(value => value.trim());
  if (columns.some(value => !columnNames[kind].includes(value)) || new Set(columns).size !== columns.length) {
    usage(`Choose unique column names from: ${columnNames[kind].join(', ')}.`);
  }
  return columns;
}
function selected(kind: TableKind, columns: [string, (row: any) => unknown][], names?: string[]) {
  return names ? names.map(name => columns[columnNames[kind].indexOf(name)]!) : columns;
}

export function human(data: any, columns?: string[]): string {
  if (data.profile) return human(data.profile);
  if (data.progress) {
    const { tutorials, ...summary } = data.progress;
    return `${human(summary)}\n\n${table(tutorials, selected('tutorials', tutorialColumns, columns))}`;
  }
  if (data.distance_stats) return `${safe(data.display_name)} — Overall sailing totals\n${table(data.distance_stats, selected('distance', distanceColumns, columns))}`;
  if (data.registration_open) return ['Registration open', table(data.registration_open, selected('races', raceColumns, columns)), '\nActive', table(data.active, selected('races', raceColumns, columns)), '\nFinished (latest 10)', table(data.finished, selected('races', raceColumns, columns))].join('\n');
  if (data.entries) {
    const details = ['state', 'description', 'startTime', 'endTime'].filter(key => data[key] != null).map(key => `${key}: ${safe(data[key])}`).join('\n');
    return `${data.name ? `${safe(data.name)} (${safe(data.publicKey)})\n` : ''}${details ? `${details}\n` : ''}${table(data.entries, selected('leaderboard', leaderboardColumns, columns))}`;
  }
  if (data.boats) return table(data.boats, selected('boats', boatColumns, columns));
  if (data.boat) return `${table([data.boat], selected('boats', boatColumns, columns))}${data.warning ? `\n${safe(data.warning)}` : ''}${data.verified === true ? '\nUpdate verified.' : ''}`;
  return Object.entries(data).map(([key, value]) => `${key}: ${safe(typeof value === 'object' ? JSON.stringify(value) : value)}`).join('\n');
}
