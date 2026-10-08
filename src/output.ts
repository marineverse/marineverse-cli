import { usage } from './errors.js';
import { racingHuman, racingColumnNames } from './racing-output.js';
import { safe, table } from './format.js';
export { safe } from './format.js';
const raceColumns: [string, (row: any) => unknown][] = [['RACE KEY', r => r.publicKey], ['NAME', r => r.name], ['STATE', r => r.state], ['START (UTC)', r => r.startTime]];
const rounded = (value: unknown) => typeof value === 'number' ? Math.round(value * 10) / 10 : value;
const coordinate = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(5) : value;
// Weather columns read the server's interpolated `weather_now` estimate, not the first forecast sample.
const boatColumns: [string, (row: any) => unknown][] = [['BOAT UUID', b => b.uuid], ['NAME', b => b.name], ['LATITUDE (°)', b => coordinate(b.latitude)], ['LONGITUDE (°)', b => coordinate(b.longitude)], ['HEADING (°)', b => rounded(b.heading)], ['SPEED (kn)', b => rounded(b.last_speed_kts ?? b.last_speed_in_kts)], ['LOCATION', b => b.location_name], ['MAIN', b => b.mainsail_hoist], ['JIB', b => b.jib_hoist], ['ANCHORED', b => b.is_anchored],
  ['WIND (kn)', b => rounded(b.weather_now?.wind_speed_kn)], ['WIND DIR (°)', b => rounded(b.weather_now?.wind_direction_deg)], ['CURRENT (kn)', b => rounded(b.weather_now?.current_speed_kn)],
  ['WAVE (m)', b => rounded(b.weather_now?.wave_height_m)], ['UPDATED (s ago)', b => b.time_since_last_update_seconds], ['IN PORT', b => b.in_port], ['OWNER', b => b.owner?.name]];
const leaderboardColumns: [string, (row: any) => unknown][] = [['POS', e => e.position], ['BOAT UUID', e => e.boat.uuid], ['BOAT', e => e.boat.name], ['LATITUDE (°)', e => coordinate(e.boat.latitude)], ['LONGITUDE (°)', e => coordinate(e.boat.longitude)], ['STATE', e => e.state], ['DISTANCE (nm)', e => rounded(e.distanceToDestination)], ['RACE TIME (s)', e => rounded(e.raceTimeSeconds)], ['PENALTY (s)', e => e.penaltySeconds]];
const historyColumns: Record<'logs' | 'port-calls' | 'passages', [string, (row: any) => unknown][]> = {
  logs: [['TIME (UTC)', l => l.timestamp], ['LATITUDE (°)', l => coordinate(l.latitude)], ['LONGITUDE (°)', l => coordinate(l.longitude)], ['HEADING (°)', l => rounded(l.heading)],
    ['SPEED (kn)', l => rounded(l.last_speed_in_kts)], ['SOG (kn)', l => rounded(l.sog)], ['WIND (kn)', l => rounded(l.wind_speed)], ['CURRENT (kn)', l => rounded(l.current_speed)],
    ['AWA (°)', l => rounded(l.awa)], ['NOTE', l => l.event ?? (l.offline ? 'offline' : '')]],
  'port-calls': [['TIME (UTC)', c => c.event_timestamp], ['EVENT', c => c.event_type], ['PORT', c => c.port?.name], ['PORT UUID', c => c.port?.uuid]],
  passages: [['PASSAGE UUID', p => p.uuid], ['FROM', p => p.startPort?.name], ['TO', p => p.endPort?.name], ['DEPARTED (UTC)', p => p.departedAt],
    ['ARRIVED (UTC)', p => p.arrivedAt], ['DISTANCE (nm)', p => rounded(p.rhumbDistanceNm)], ['DURATION (h)', p => typeof p.durationSeconds === 'number' ? rounded(p.durationSeconds / 3600) : null]],
};
const tutorialColumns:[string, (row: any) => unknown][] = [['TUTORIAL', r => r.name], ['STATUS', r => r.status], ['STARTED (UTC)', r => r.started_at], ['FINISHED (UTC)', r => r.finished_at]];
const distanceColumns: [string, (row: any) => unknown][] = [['BOAT TYPE', r => r.boat_type], ['DISTANCE (nm)', r => rounded(r.total_distance_nm)], ['TIME (min)', r => rounded(r.total_time_minutes)]];
export const columnNames = {
  ...racingColumnNames,
  boats: ['uuid', 'name', 'latitude', 'longitude', 'heading', 'speed', 'location', 'main', 'jib', 'anchored', 'wind', 'wind-dir', 'current', 'wave', 'update-age', 'in-port', 'owner'],
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
// Optional columns appear only when requested with --columns, keeping default tables compact.
const optionalColumns: Partial<Record<TableKind, number>> = { boats: 10 };
function selected(kind: TableKind, columns: [string, (row: any) => unknown][], names?: string[]) {
  return names ? names.map(name => columns[columnNames[kind].indexOf(name)]!) : columns.slice(0, optionalColumns[kind]);
}

function richText(value: any, source: string): string {
  if (typeof value === 'string') return value.split('\n').map(safe).join('\n');
  if (Array.isArray(value)) return value.map(node => richText(node, source)).join('');
  if (!value || typeof value !== 'object') return '';
  if (value.type === 'br') return '\n';
  const text = richText(value.children, source);
  if (typeof value.props?.href === 'string') {
    let href = value.props.href;
    try { href = new URL(href, source).href; } catch { /* Retain a readable source value. */ }
    return `${text} (${safe(href)})`;
  }
  return value.type === 'p' ? `${text}\n\n` : text;
}

export function human(data: any, columns?: string[]): string {
  const racing = racingHuman(data, columns);
  if (racing !== undefined) return racing;
  if (data.topics) return table(data.topics, [['TOPIC', topic => topic.slug], ['TITLE', topic => topic.title], ['URL', topic => topic.url]]);
  if (data.term) return `${safe(data.term.term)}\n${safe(data.term.definition)}\nSource: ${safe(data.term.source)}`;
  if (data.glossary) return `${data.glossary.terms.map((entry: any) => `${safe(entry.term)}\n${safe(entry.definition)}`).join('\n\n') || 'No matching sailing terms found.'}\n\nPage ${safe(data.glossary.page)} · ${safe(data.glossary.total)} results\nSource: ${safe(data.glossary.source)}`;
  if (data.faq) {
    const faq = data.faq;
    return `${safe(faq.title)}\nSource: ${safe(faq.source || faq.url)}\n\n${faq.content.sections.map((section: any) =>
      `${safe(section.section)}\n\n${(section.items || []).map((item: any) => `${safe(item.question)}\n${richText(item.answer, faq.source || faq.url).trim()}`).join('\n\n')}`).join('\n\n')}${faq.content.footer ? `\n\n${richText(faq.content.footer, faq.source || faq.url).trim()}` : ''}`;
  }
  if (data.history) {
    const history = data.history;
    const labels = history.content.labels || {};
    const updates = (history.content.sections || []).map((section: any) =>
      `${safe(labels[section.titleKey] || section.titleKey)}\n${(section.cards || []).map((card: any) =>
        `${safe(labels[card.titleKey] || card.titleKey)} · ${safe(labels[card.dateKey] || card.dateKey)}\n${safe(card.href)}`).join('\n\n')}`).join('\n\n');
    return `${safe(history.title)}\nSource: ${safe(history.source || history.url)}${updates ? `\n\n${updates}` : ''}\n\nPatch notes\n\n${history.content.entries.map((entry: any) =>
      `${safe(entry.version)} · ${safe(entry.date || entry.released_on)}\n${(entry.items || []).map((item: any) => `- ${safe(item)}`).join('\n')}`).join('\n\n') || 'No patch notes found.'}`;
  }
  if (data.search) return data.search.results.map((result: any) =>
    `${safe(result.title)}${result.version ? ` (${safe(result.version)})` : ''}\n${safe(result.snippet)}\nSource: ${safe(result.url || result.source)}`).join('\n\n') || 'No matching public content found.';
  if (data.links) return table(data.links, [['NAME', link => link.name], ['TITLE', link => link.title], ['DESCRIPTION', link => link.description], ['URL', link => link.url]]);
  const paragraphs = (value: string) => value.split('\n').map(safe).join('\n');
  const postTable = (posts: any[]) => table(posts, [['BOARD', p => p.board_slug], ['POST', p => p.slug], ['TITLE', p => p.title], ['STATUS', p => p.status], ['VOTES', p => p.vote_count], ['COMMENTS', p => p.comment_count], ['UPVOTED', p => p.upvoted_by_me]]);
  const pagination = (value: any) => `Page ${safe(value.current_page)} of ${safe(value.total_pages)} · ${safe(value.total_entries)} results`;
  const commentText = (comment: any): string => `${safe(comment.author?.name)} · ${safe(comment.uuid)} · ${safe(comment.vote_count)} votes${comment.is_pinned ? ' · pinned' : ''}\n${paragraphs(comment.content)}${comment.replies?.length ? `\n\nReplies:\n${comment.replies.map(commentText).join('\n\n')}` : ''}`;
  if (data.memberships && data.pending_requests) return `Memberships\n${table(data.memberships, [['CLUB', e => e.club.slug || e.club.uuid], ['NAME', e => e.club.name], ['ROLE', e => e.role], ['STATUS', e => e.status]])}\n\nPending requests\n${table(data.pending_requests, [['CLUB', e => e.club.slug || e.club.uuid], ['NAME', e => e.club.name], ['STATUS', e => e.status], ['MESSAGE', e => e.message]])}`;
  if (data.club && ['joined', 'pending_approval', 'left'].includes(data.status)) return `${data.status === 'joined' ? 'Joined' : data.status === 'pending_approval' ? 'Join request pending approval for' : 'Left'} ${safe(data.club.name)} (${safe(data.club.slug || data.club.uuid)}).`;
  if (data.clubs) return table(data.clubs, [['CLUB', c => c.slug || c.uuid], ['NAME', c => c.name], ['DESCRIPTION', c => c.description], ['MARINEVERSE URL', c => c.url], ...(data.clubs.some((c: any) => c.distance_km !== undefined) ? [['DISTANCE (km)', (c: any) => rounded(c.distance_km)] as [string, (row: any) => unknown]] : [])]);
  if (data.boards) return table(data.boards, [['BOARD', b => b.slug], ['NAME', b => b.name], ['POSTS', b => b.post_count], ['DESCRIPTION', b => b.description]]);
  if (data.roadmap) return [['planned', 'Planned'], ['in_progress', 'In progress'], ['complete', 'Complete']].map(([key, name]) => `${name}\n${postTable(data.roadmap[key!])}`).join('\n\n');
  if (data.posts) return `${data.name ? `${safe(data.name)}\n` : ''}${postTable(data.posts)}${data.current_page === undefined ? '' : `\n${pagination(data)}`}`;
  if (data.feed) return `${safe(data.feed.board.name)} — Recent activity\n${data.feed.entries.map((entry: any) => `${safe(entry.title)} · ${safe(entry.created_words)}\n${safe(entry.description)}\n${safe(entry.post_link.board_slug)}/${safe(entry.post_link.slug)}`).join('\n\n') || '(none)'}\n${pagination(data.feed)}`;
  if (data.post) {
    const post = data.post;
    return `${data.message ? `${safe(data.message)}\n` : ''}${safe(post.title)}\nPost: ${safe(post.slug)} · UUID: ${safe(post.uuid)}\nStatus: ${safe(post.status)} · Votes: ${safe(post.vote_count)} · Comments: ${safe(post.comment_count)}\nBy ${safe(post.author?.name)}\n\n${paragraphs(post.description)}${post.upvoted_by ? `\n\nUpvoted by: ${post.upvoted_by.map((user: any) => safe(user.name)).join(', ') || '(none)'}` : ''}${post.merged_into_post ? `\n\nMerged into: ${safe(post.merged_into_post.board_slug || '')}/${safe(post.merged_into_post.slug)} — ${safe(post.merged_into_post.title)}` : ''}${post.similar_posts?.length ? `\n\nRelated posts\n${postTable(post.similar_posts)}` : ''}${post.comments ? `\n\nComments\n${post.comments.map(commentText).join('\n\n') || '(none)'}` : ''}`;
  }
  if (data.comment) return `${safe(data.message)}\n${commentText(data.comment)}`;
  if (data.article) return `${safe(data.article.title)} (${safe(data.article.uuid)})\n\n${paragraphs(data.article.content)}`;
  if (data.answer) return paragraphs(data.answer);
  if (data.articles) return data.articles.length
    ? data.articles.map((article: any) => `${safe(article.title)} (${safe(article.uuid)})\n${safe(article.excerpt)}`).join('\n\n')
    : 'No matching articles found.';
  if (data.profile) return human(data.profile);
  if (data.progress) {
    const { tutorials, ...summary } = data.progress;
    return `${human(summary)}\n\n${table(tutorials, selected('tutorials', tutorialColumns, columns))}`;
  }
  if (data.distance_stats) return `${safe(data.display_name)} — Overall sailing totals\n${table(data.distance_stats, selected('distance', distanceColumns, columns))}`;
  if (data.registration_open) return ['Registration open', table(data.registration_open, selected('races', raceColumns, columns)), '\nActive', table(data.active, selected('races', raceColumns, columns)), '\nFinished (latest 10)', table(data.finished, selected('races', raceColumns, columns))].join('\n');
  if (data.entries) {
    const details = ['state', 'description', 'startTime', 'endTime'].filter(key => data[key] != null).map(key => `${key}: ${safe(data[key])}`).join('\n');
    return `${data.name ? `${safe(data.name)} (${safe(data.publicKey)})\n` : ''}${details ? `${details}\n` : ''}${table(data.entries, selected('leaderboard', leaderboardColumns, columns))}${data.entries_pagination ? `\n${pagination(data.entries_pagination)}` : ''}`;
  }
  if (data.boats) return table(data.boats, selected('boats', boatColumns, columns));
  if (data.items && data.type in historyColumns) {
    const notes = [data.oldest_available_at !== undefined ? `Oldest retained log: ${safe(data.oldest_available_at)}` : '',
      data.next_cursor ? `More records: add --cursor ${safe(data.next_cursor)}` : ''].filter(Boolean);
    return [table(data.items, historyColumns[data.type as keyof typeof historyColumns]), ...notes].join('\n');
  }
  if (typeof data.boat?.is_followed === 'boolean') return `${data.boat.is_followed ? 'Following' : 'Stopped following'} ${safe(data.boat.name)} (${safe(data.boat.uuid)}).`;
  if (data.boat) return `${table([{ ...data.boat, weather_now: data.weather_now }], selected('boats', boatColumns, columns))}${data.warning ? `\n${safe(data.warning)}` : ''}${data.verified === true ? '\nUpdate verified.' : ''}`;
  return Object.entries(data).map(([key, value]) => `${key}: ${safe(typeof value === 'object' ? JSON.stringify(value) : value)}`).join('\n');
}
