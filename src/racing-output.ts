import { safe, table, selectColumns, type Column } from './format.js';

export const racingColumnNames = {
  'racing-races': ['key', 'name', 'boat', 'finished', 'entries'],
  'racing-results': ['position', 'key', 'name', 'time', 'points', 'handicap', 'penalty'],
  'racing-rankings': ['position', 'name', 'country', 'points', 'rating', 'change', 'wins', 'races', 'streak'],
  'racing-leagues': ['key', 'name', 'description', 'boat', 'sailing-pass'],
  'racing-series': ['key', 'name'],
  'racing-series-results': ['position', 'name', 'points', 'formula'],
  'racing-tournaments': ['key', 'name', 'state', 'start', 'registration', 'registered'],
  'racing-legs': ['name', 'duration', 'tacks', 'gybes', 'speed', 'vmg', 'distance'],
};
const resultColumns: Column[] = [['POSITION', row => row.position], ['ENTRY KEY', row => row.public_key ?? row.boat_uuid], ['SAILOR', row => row.name ?? row.boat?.name],
  ['TIME (s)', row => row.race_time_seconds], ['POINTS', row => row.points], ['HANDICAP', row => row.handicap], ['PENALTY (s)', row => row.penalty_seconds]];
const raceColumns: Column[] = [['RACE KEY', row => row.public_key], ['NAME', row => row.name], ['BOAT', row => row.boat_model], ['FINISHED', row => row.finished], ['ENTRIES', row => row.entries_count]];
const legDuration = (row: any) => {
  if (row && typeof row.start_time === 'number' && typeof row.end_time === 'number') return `${row.end_time - row.start_time} s`;
  if (row?.duration_seconds != null) return `${safe(row.duration_seconds)} s`;
  if (row?.duration != null) return `${safe(row.duration)} (recorded; units unspecified)`;
  return undefined;
};
const legColumns: Column[] = [['LEG', row => row.name], ['DURATION', legDuration],
  ['TACKS', row => row.num_tacks], ['GYBES', row => row.num_gybes], ['AVG SPEED (kn)', row => row.avg_speed], ['AVG VMG (kn)', row => row.avg_vmg], ['DISTANCE (m)', row => row.distance_traveled]];
const lines = (value: any): string => Object.entries(value).map(([key, item]) => `${safe(key)}: ${safe(typeof item === 'object' ? JSON.stringify(item) : item)}`).join('\n');
const pagination = (value: any) => value ? `\nPage ${safe(value.current_page)} of ${safe(value.total_pages)} · ${safe(value.total_entries)} results` : '';
const title = (value: any) => value.name ? `${safe(value.name)} (${safe(value.public_key)})` : safe(value.public_key);
const paragraphs = (value: string) => value.split('\n').map(safe).join('\n');
const nested = (value: any, indent = ''): string => Array.isArray(value)
  ? value.map(item => `${indent}- ${typeof item === 'object' && item !== null ? `\n${nested(item, `${indent}  `)}` : safe(item)}`).join('\n')
  : value !== null && typeof value === 'object' ? Object.entries(value).map(([key, item]) => `${indent}${safe(key)}:${item !== null && typeof item === 'object' ? `\n${nested(item, `${indent}  `)}` : ` ${safe(item)}`}`).join('\n') : `${indent}${safe(value)}`;

const publicResource = (value: any) => value && typeof value.public_key === 'string';
const resources = (value: any) => Array.isArray(value) && value.every(publicResource);
function racingData(data: any): boolean {
  return !!(data && typeof data === 'object' && (
    (['today', 'yesterday'].includes(data.day?.day) && data.day?.time_zone) ||
    (Array.isArray(data.activity?.activities) && data.activity?.time_zone) ||
    ['drp', 'multiplayer'].includes(data.rating?.mode) || data.explanation?.mode === 'drp' ||
    (Array.isArray(data.rankings) && data.pagination) ||
    (data.pagination && (resources(data.races) || resources(data.entries) || resources(data.tournaments))) ||
    resources(data.leagues) || resources(data.series) ||
    ['league', 'race', 'entry', 'series', 'tournament'].some(key => publicResource(data[key])) ||
    resources(data.comparison?.entries) ||
    (Array.isArray(data.schedule?.sessions) && typeof data.schedule?.source === 'string') ||
    (data.dashboard && (data.dashboard.today || data.dashboard.participation || data.dashboard.multiplayer)) ||
    (data.public_key && data.links)
  ));
}

export function racingHuman(data: any, columns?: string[]): string | undefined {
  if (!racingData(data)) return undefined;
  const selected = (kind: keyof typeof racingColumnNames, values: Column[]) => selectColumns(racingColumnNames[kind], values, columns);
  if (Array.isArray(data.rankings)) return table(data.rankings, selected('racing-rankings', [['POSITION', row => row.position], ['SAILOR', row => row.name], ['COUNTRY', row => row.country_code],
    ['POINTS', row => row.points], ['RATING', row => row.rating], ['CHANGE', row => row.points_change], ['WINS', row => row.wins], ['RACES', row => row.races_count ?? row.unique_races_count], ['STREAK', row => row.streak]])) + (data.date ? `\nRating date: ${safe(data.date)}` : '') + pagination(data.pagination);
  if (data.day) {
    const day = data.day;
    const sections = [`${safe(day.day)} · ${safe(day.date)} · ${safe(day.time_zone)}`];
    for (const mode of ['drp', 'multiplayer']) if (day.activity?.[mode]) {
      const activity = day.activity[mode];
      sections.push(`${mode === 'drp' ? 'Daily Race Practice' : 'Multiplayer'} activity · ${safe(activity.total_entries)} attempts\n${table(activity.entries ?? [], [
        ['ENTRY KEY', row => row.public_key], ['RACE', row => row.race_name], ['RACE KEY', row => row.race_public_key], ['TIME (s)', row => row.race_time_seconds], ['CREATED', row => row.created_at], ['DNF', row => row.dnf]
      ])}${activity.truncated ? `\nAll attempts: marineverse racing ${mode} entries list --mine --page 1 --json (follow pagination; compare dates in ${safe(day.time_zone)}).` : ''}`);
    }
    if (day.opportunities) {
      if (day.opportunities.drp) sections.push(`Daily Race Practice opportunities\n${table(day.opportunities.drp, [['LEAGUE', row => row.league_name], ['RACE KEY', row => row.race?.public_key], ['AVAILABLE', row => row.race?.can_race], ['ATTEMPTS', row => `${row.race?.attempts_used ?? '—'}/${row.race?.attempts_limit ?? '—'}`], ['REASONS', row => row.race?.availability_reasons?.join('; ')]])}`);
      if (day.opportunities.multiplayer) {
        const multiplayer = day.opportunities.multiplayer;
        sections.push(multiplayer.available ? `Next community sessions\n${table(multiplayer.sessions ?? [], [['SESSION', row => row.description], ['NEXT START (UTC)', row => row.next_start], ['TIME ZONE', row => row.time_zone]])}` : `Community schedule unavailable: ${safe(multiplayer.error)}`);
      }
      if (day.opportunities.globe) sections.push(`Globe registration opportunities\n${table(day.opportunities.globe, raceColumns)}`);
    }
    if (day.globe_participation?.length) sections.push(`Globe participation · current owned or crewed boats\n${table(day.globe_participation, raceColumns)}`);
    if (day.links) sections.push(lines(day.links));
    return sections.join('\n\n');
  }
  if (data.activity) {
    const activity = data.activity;
    return `${safe(activity.type)} activity · ${safe(activity.start_date)} to ${safe(activity.end_date)} · ${safe(activity.time_zone)}\nCurrent streak: ${safe(activity.current_streak)} · Longest streak: ${safe(activity.longest_streak)} · Active days: ${safe(activity.total_active_days)}\nTotal ${safe(activity.count_unit)}: ${safe(activity.total_count)}\n\n${table(activity.activities.filter((day: any) => day.count > 0), [['DATE', row => row.date], ['COUNT', row => row.count], ['LEVEL', row => row.level]])}${activity.streak_message ? `\n${safe(activity.streak_message)}` : ''}`;
  }
  if (data.rating) {
    const rating = data.rating;
    return `${safe(rating.name)} · ${safe(rating.league?.name ?? rating.boat_model ?? 'Global rating')}\n${nested(rating)}${rating.history_available === false ? '\nHistorical rating changes are unavailable for this boat model.' : ''}`;
  }
  if (data.explanation) {
    const { races, ...summary } = data.explanation;
    return `${nested(summary)}\n\nRace contributions\n${table(races ?? [], [['RACE', row => row.name], ['KEY', row => row.public_key], ['BEFORE', row => row.points_before], ['AFTER', row => row.points_after], ['CHANGE', row => row.points_change]])}${races?.length ? `\n\n${races.map((race: any) => `${title(race)}\n${nested(race.calculation_log)}`).join('\n\n')}` : ''}`;
  }
  if (data.tournaments) return table(data.tournaments, selected('racing-tournaments', [['TOURNAMENT KEY', row => row.public_key], ['NAME', row => row.name], ['STATE', row => row.state], ['START', row => row.start_at], ['REGISTRATION', row => row.registration_status], ['REGISTERED', row => row.my_registration?.is_registered]])) + pagination(data.pagination);
  if (data.tournament) {
    const { participants, matches, ...summary } = data.tournament;
    return `${title(data.tournament)}\n${nested(summary)}\n\nParticipants\n${table(participants ?? [], [['SAILOR', row => row.sailor?.name], ['COUNTRY', row => row.sailor?.country_code], ['SEED', row => row.seed], ['FINAL RANK', row => row.final_rank], ['ACTIVE', row => row.active]])}\n\nMatches\n${table(matches ?? [], [['ROUND', row => row.round], ['MATCH', row => row.match_number], ['STATE', row => row.state], ['START', row => row.scheduled_start_at], ['SAILORS', row => row.participants?.map((participant: any) => participant.sailor?.name).join(', ')]])}`;
  }
  if (Array.isArray(data.entries) && data.pagination) return table(data.entries, selected('racing-results', resultColumns)) + pagination(data.pagination);
  if (data.schedule) return `${table(data.schedule.sessions, [['SESSION', row => row.description], ['WEEKLY TIME', row => row.time_label ?? `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][row.day_of_week]} ${String(row.hour).padStart(2, '0')}:${String(row.minute).padStart(2, '0')}`], ['TIME ZONE', row => row.time_zone], ['NEXT START (UTC)', row => row.next_start], ['VOLUNTEERS', row => row.volunteers.map((person: any) => person.name).join(', ')]])}\n\n${lines(data.schedule.links)}\nSource: ${safe(data.schedule.source)}`;
  if (Array.isArray(data.races)) return table(data.races, selected('racing-races', raceColumns)) + pagination(data.pagination);
  if (data.leagues) return table(data.leagues, selected('racing-leagues', [['LEAGUE KEY', row => row.public_key], ['NAME', row => row.name], ['DESCRIPTION', row => row.description], ['BOAT', row => row.boat_model], ['SAILING PASS', row => row.requires_sailing_pass]]));
  if (data.league) return `${title(data.league)}\n${lines(data.league)}`;
  if (data.race) {
    const race = data.race;
    const sections = [title(race)];
    const { entries, entry_stats, my_result, my_attempts, links, ai_summary, ...details } = race;
    sections.push(lines(details));
    if (entries !== undefined) sections.push(table(entries, selected('racing-results', resultColumns)) + pagination(race.entries_pagination));
    if (my_result !== undefined) sections.push(`Your latest result\n${my_result === null ? '(unavailable)' : table([my_result], selected('racing-results', resultColumns))}`);
    if (my_attempts !== undefined) sections.push(`Your attempts\n${table(my_attempts, selected('racing-results', resultColumns))}${pagination(race.my_attempts_pagination)}`);
    if (entry_stats !== undefined) sections.push(table(entry_stats, [['SAILOR', row => row.name], ['ENTRY KEY', row => row.public_key], ['START (kn)', row => row.stats?.start_speed], ['DELAY (s)', row => row.stats?.start_delay], ['MAX (kn)', row => row.stats?.max_speed], ['FIRST MARK (s)', row => row.stats?.first_mark_time], ['FINISH (kn)', row => row.stats?.finish_line_speed]]) + pagination(race.entries_pagination));
    if (ai_summary !== undefined) sections.push(ai_summary === null ? 'No AI summary available.' : paragraphs(ai_summary));
    if (links) sections.push(lines(links));
    return sections.join('\n\n');
  }
  if (data.entry) {
    const { stats, legs, maneuvers, links, ...details } = data.entry;
    return [title(data.entry), lines(details), ...(stats !== undefined ? [`Stats\n${stats === null ? '(unavailable)' : lines(stats)}`] : []),
      ...(legs !== undefined ? [`Legs\n${legs === null ? '(unavailable)' : table(legs, selected('racing-legs', legColumns))}`] : []),
      ...(maneuvers ? [`Maneuvers\n${table(maneuvers, [['TIME (s)', row => row.game_time], ['TYPE', row => row.type]])}`] : []),
      ...(links ? [lines(links)] : [])].join('\n\n');
  }
  if (data.series) {
    if (Array.isArray(data.series)) return table(data.series, selected('racing-series', [['SERIES KEY', row => row.public_key], ['NAME', row => row.name]])) + pagination(data.pagination);
    const { entries, races, links, ...details } = data.series;
    return [title(data.series), lines(details), ...(entries ? [table(entries, selected('racing-series-results', [['POSITION', row => row.position], ['SAILOR', row => row.name], ['POINTS', row => row.points], ['FORMULA', row => row.total_points_formula]]))] : []),
      ...(races ? [table(races, raceColumns)] : []), ...(links ? [lines(links)] : [])].join('\n\n');
  }
  if (data.comparison) {
    const comparison = data.comparison;
    return [comparison.entries.map(title).join(' vs '),
      ...(Array.isArray(comparison.stats) ? [table(comparison.stats, [['METRIC', row => row.metric], ['FIRST', row => row.first], ['SECOND', row => row.second], ['DIFFERENCE', row => row.difference]])] : []),
      ...(comparison.legs ? [`Leg comparisons\n${table(comparison.legs, [['LEG', row => row.first?.name ?? row.second?.name ?? row.leg ?? row.name],
        ['FIRST DURATION', row => legDuration(row.first)],
        ['SECOND DURATION', row => legDuration(row.second)],
        ['DIFFERENCE (s)', row => row.differences?.duration_seconds ?? row.duration_difference_seconds], ['TACK DIFFERENCE', row => row.differences?.num_tacks], ['SPEED DIFFERENCE (kn)', row => row.differences?.avg_speed]])}`] : []),
      ...(comparison.ai_summary ? [paragraphs(comparison.ai_summary)] : []), ...(comparison.links ? [lines(comparison.links)] : [])].join('\n\n');
  }
  if (data.dashboard) {
    const dashboard = data.dashboard;
    const sections = [dashboard.user ? `${safe(dashboard.user.name)} · ${safe(dashboard.user.country_code)}` : 'Racing dashboard'];
    if (dashboard.today) sections.push(`Today's races\n${table(dashboard.today.leagues ?? [], [['LEAGUE', row => row.league_name], ['RACE KEY', row => row.race?.public_key], ['ATTEMPTS', row => `${row.race?.attempts_used ?? '—'}/${row.race?.attempts_limit ?? '—'}`], ['TIME (s)', row => row.race?.user_latest_time], ['POSITION', row => row.race?.user_latest_position], ['REVEAL', row => row.race?.reveal_time], ['AVAILABLE', row => row.race?.can_race], ['REASONS', row => row.race?.availability_reasons?.join('; ')]])}`);
    if (dashboard.yesterday) sections.push(`Previous races · ${safe(dashboard.yesterday.wins)} wins · ${safe(dashboard.yesterday.podiums)} podiums\n${table(dashboard.yesterday.leagues ?? [], [['LEAGUE', row => row.league_name], ['RACE KEY', row => row.race_public_key], ['POSITION', row => row.position], ['TIME (s)', row => row.time ?? row.race_time], ['STREAK', row => row.streak]])}`);
    if (dashboard.rating) sections.push(`Rating\n${nested(dashboard.rating)}`);
    if (dashboard.series?.active) sections.push(`Current series\n${table(dashboard.series.active, [['SERIES', row => row.name], ['KEY', row => row.public_key], ['RACES', row => `${row.races_completed ?? '—'}/${row.races_required ?? '—'}`], ['POSITION', row => row.user_position], ['POINTS', row => row.user_points], ['QUALIFIED', row => row.is_qualified]])}`);
    if (dashboard.multiplayer) sections.push(`Multiplayer · ${safe(dashboard.multiplayer.total_races)} races\n${table(dashboard.multiplayer.boats ?? [], [['BOAT', row => row.boat_model], ['RACES', row => row.races_count], ['RATING', row => row.rating], ['POSITION', row => row.rating_position]])}\n\nRecent multiplayer races\n${table(dashboard.multiplayer.recent_races ?? [], [['RACE', row => row.race_name], ['RACE KEY', row => row.race_public_key], ['ENTRY KEY', row => row.entry_public_key], ['TIME (s)', row => row.race_time], ['PODIUM', row => row.podium_position]])}`);
    if (dashboard.globe) sections.push(`Globe\n${table(dashboard.globe.boats ?? [], [['BOAT', row => row.name], ['UUID', row => row.uuid], ['LOCATION', row => row.location_name], ['RACES', row => row.races_count], ['ACTIVE RACE', row => row.active_race_public_key]])}`);
    if (dashboard.streaks) sections.push(`Streaks\n${nested(dashboard.streaks)}`);
    if (dashboard.participation) sections.push(`Participation\n${nested(dashboard.participation)}`);
    return sections.join('\n\n');
  }
  if (data.public_key && data.links) return lines(data.links);
  return undefined;
}
