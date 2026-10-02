import { Command, Option } from 'commander';
import type { MarineVerseClient } from './client.js';
import { racingViews, type RacingMode } from './racing.js';
import type { TableKind } from './output.js';

interface CommandHelpers {
  invoke: (command: Command, action: (client: MarineVerseClient) => Promise<unknown>) => Promise<void>;
  showUrl: (command: Command, url: string, browser: boolean, meta?: { environment?: string }) => Promise<void>;
  tableCommand: (command: Command, kind: TableKind) => Command;
}

export function registerRacingCommands(program: Command, { invoke, showUrl, tableCommand }: CommandHelpers): void {
  const racing = program.command('racing').description('Multiplayer, Daily Race Practice and Globe racing');
  const groups = [racing];
  const action = (command: Command, read: (client: MarineVerseClient) => Promise<unknown>) => invoke(command, read);
  const filters = (opts: any) => ({ ...opts, ...(opts.page !== undefined ? { page: Number(opts.page) } : {}), ...(opts.days !== undefined ? { days: Number(opts.days) } : {}) });
  const page = (command: Command) => command.option('--page <number>', 'Read a result page (default 1)');
  const links = (group: Command, signature: string, read: (client: MarineVerseClient, key: string) => Promise<any>, field: string) => {
    group.command(`links ${signature}`).description('Read canonical website, map and chart links')
      .action((key, _opts, command) => action(command, async client => {
        const result = (await read(client, key))[field];
        return { public_key: result.public_key, links: result.links ?? {} };
      }));
    group.command(`open ${signature}`).description('Open a returned racing link in your browser')
      .addOption(new Option('--view <view>', 'Website view to open').choices([...racingViews]).default('web'))
      .option('--no-browser', 'Print the URL without opening a browser')
      .action((key, opts, command) => action(command, async client => {
        const result = (await read(client, key))[field];
        const url = client.racing.link(result, opts.view);
        await showUrl(command, url, opts.browser, { environment: client.environment.name });
        return undefined;
      }));
  };
  racing.command('dashboard').description('Read your racing dashboard (login required)')
    .action((_opts, command) => action(command, client => client.racing.dashboard()));
  for (const day of ['today', 'yesterday'] as const) racing.command(day)
    .description(day === 'today' ? 'Read today’s activity and available sailing opportunities (login required)' : 'Read yesterday’s race activity in your account time zone (login required)')
    .action((_opts, command) => action(command, client => client.racing.day(day)));
  racing.command('activity').description('Read your sailing activity calendar and streaks (login required)')
    .addOption(new Option('--type <type>', 'Activity to read').choices(['marineverse', 'drp', 'multiplayer']).default('marineverse'))
    .option('--since <date>', 'First calendar date, YYYY-MM-DD').option('--until <date>', 'Last calendar date, YYYY-MM-DD')
    .action((opts, command) => action(command, client => client.racing.activity(opts)));
  const leagues = racing.command('leagues').description('Discover Daily Race Practice leagues and your leagues'); groups.push(leagues);
  tableCommand(leagues.command('list').option('--mine', 'List your eligible leagues (login required)'), 'racing-leagues')
    .action((opts, command) => action(command, client => client.racing.leagues(opts.mine)));
  leagues.command('show <league-key>').description('Read one league')
    .action((key, _opts, command) => action(command, client => client.racing.league(key)));
  links(leagues, '<league-key>', (client, key) => client.racing.league(key), 'league');
  const tournaments = racing.command('tournaments').description('Public tournaments and your registrations'); groups.push(tournaments);
  tableCommand(page(tournaments.command('list').option('--mine', 'List your tournaments (login required)')), 'racing-tournaments')
    .action((opts, command) => action(command, client => client.racing.tournaments(filters(opts))));
  tournaments.command('show <tournament-key>').description('Read tournament participants and scheduled matches')
    .action((key, _opts, command) => action(command, client => client.racing.tournament(key)));
  links(tournaments, '<tournament-key>', (client, key) => client.racing.tournament(key), 'tournament');
  for (const mode of ['multiplayer', 'drp', 'globe'] as RacingMode[]) {
    const group = racing.command(mode).description(mode === 'drp' ? 'Daily Race Practice' : `${mode === 'globe' ? 'Globe' : 'Multiplayer'} races`); groups.push(group);
    if (mode === 'multiplayer') group.command('schedule').description('Read regular sailing sessions and their IANA time zones')
      .action((_opts, command) => action(command, client => client.racing.schedule()));
    const races = group.command('races').description('Recent races, your races and race results'); groups.push(races);
    const list = tableCommand(page(races.command('list').option('--mine', 'List your recent races (login required)')), 'racing-races');
    if (mode === 'drp') list.option('--league <league-key>', 'Filter by league');
    if (mode !== 'globe') list.option('--boat <model>', 'Filter by boat model');
    list.action((opts, command) => action(command, client => client.racing.races(mode, filters(opts))));
    tableCommand(page(races.command('show <race-key>')), 'racing-results').description('Read race details and server-ranked results')
      .action((key, opts, command) => action(command, client => client.racing.race(mode, key, opts.page === undefined ? undefined : Number(opts.page))));
    tableCommand(page(races.command('leaderboard <race-key>')), 'racing-results').description('Read server-ranked results, points and penalties')
      .action((key, opts, command) => action(command, async client => {
        const { race } = await client.racing.race(mode, key, opts.page === undefined ? undefined : Number(opts.page));
        return { race: { public_key: race.public_key, name: race.name, entries: race.entries ?? [], entries_pagination: race.entries_pagination, results_available: race.results_available,
          ...(race.my_result !== undefined ? { my_result: race.my_result } : {}) } };
      }));
    if (mode !== 'globe') races.command('summary <race-key>').description('Read an existing AI race summary when visible')
      .action((key, _opts, command) => action(command, async client => {
        const { race } = await client.racing.race(mode, key);
        return { race: { public_key: race.public_key, name: race.name, ai_summary: race.ai_summary ?? null } };
      }));
    if (mode !== 'globe') page(races.command('stats <race-key>')).description('Read performance stats across ranked race entries')
      .action((key, opts, command) => action(command, async client => {
        const { race } = await client.racing.race(mode, key, opts.page === undefined ? undefined : Number(opts.page));
        return { race: { public_key: race.public_key, name: race.name, results_available: race.results_available, entries_pagination: race.entries_pagination,
          entry_stats: (race.entries ?? []).map((entry: any) => ({ public_key: entry.public_key, name: entry.name, stats: entry.stats ?? null })) } };
      }));
    links(races, '<race-key>', (client, key) => client.racing.race(mode, key), 'race');
    if (mode === 'globe') continue;
    const entries = group.command('entries').description('Race entry performance and comparisons'); groups.push(entries);
    tableCommand(page(entries.command('list').requiredOption('--mine', 'Read your race entry history (login required)')), 'racing-results')
      .option('--since <timestamp>', 'Entries at or after this ISO 8601 timestamp')
      .option('--race <race-key>', 'Read all your attempts for one race')
      .action((opts, command) => action(command, client => client.racing.entries(mode, filters(opts))));
    for (const operation of ['show', 'stats', 'legs', 'maneuvers']) {
      const command = entries.command(`${operation} <entry-key>`);
      if (operation === 'legs') tableCommand(command, 'racing-legs');
      command
      .description(operation === 'show' ? 'Read one entry with stats, legs and maneuvers' : `Read entry ${operation}`)
      .action((key, _opts, command) => action(command, async client => {
        const result = await client.racing.entry(mode, key);
        return operation === 'show' ? result : { entry: { public_key: result.entry.public_key, name: result.entry.name, [operation]: result.entry[operation] ?? null } };
      }));
    }
    entries.command('compare <first-entry-key> <second-entry-key>').description('Compare real performance stats and race legs')
      .option('--open', 'Open the returned comparison link in your browser')
      .option('--no-browser', 'Print the URL without opening a browser')
      .action((first, second, opts, command) => action(command, async client => {
        const result = await client.racing.compare(mode, first, second);
        if (!opts.open) return result;
        await showUrl(command, client.racing.link(result.comparison), opts.browser, { environment: client.environment.name });
        return undefined;
      }));
    links(entries, '<entry-key>', (client, key) => client.racing.entry(mode, key), 'entry');
    const ratings = group.command('ratings').description('Public standings and personal sailing ratings'); groups.push(ratings);
    const rankings = tableCommand(page(ratings.command('list').description('Read public sailor standings')), 'racing-rankings')
      .addOption(new Option('--type <type>', 'Ranking to read').choices(mode === 'multiplayer' ? ['rating', 'participation'] : ['rating', 'wins', 'streaks']).default('rating'))
      .option('--country <code>', 'Two-letter country code')
      .option('--region <name>', 'Geographic region, such as Oceania').option('--subregion <name>', 'Geographic subregion')
      .option('--state <code>', 'State or province code').option('--city <name>', 'City');
    if (mode === 'multiplayer') rankings.option('--boat <model>', 'Boat model').option('--days <count>', 'Participation in the last 0–3650 days (0 means all time)');
    else rankings.option('--league <league-key>', 'League rating').option('--date <date>', 'Rating date in YYYY-MM-DD format');
    rankings.action((opts, command) => action(command, client => client.racing.rankings(mode, filters(opts))));
    const showRating = ratings.command('show').description('Read your rating or a public sailor’s rating')
      .option('--profile <profile-key>', 'Read a public sailor instead of your account');
    if (mode === 'multiplayer') showRating.option('--boat <model>', 'Boat model (default yacht)');
    else showRating.option('--league <league-key>', 'League rating (default global)').option('--date <date>', 'Exact rating date in YYYY-MM-DD format');
    showRating.action((opts, command) => action(command, client => client.racing.rating(mode, filters(opts))));
    if (mode === 'drp') ratings.command('explain').description('Explain the race contributions behind a daily rating change')
      .option('--profile <profile-key>', 'Explain a public sailor instead of your account')
      .option('--league <league-key>', 'League rating (default global)').option('--date <date>', 'Exact rating date in YYYY-MM-DD format')
      .action((opts, command) => action(command, client => client.racing.explainRating(filters(opts))));
    if (mode === 'drp') {
      const series = group.command('series').description('Daily Race Practice weekly, monthly and season series'); groups.push(series);
      tableCommand(page(series.command('list').option('--league <league-key>', 'Filter by league')), 'racing-series')
        .addOption(new Option('--type <type>', 'Series period').choices(['weekly', 'monthly', 'seasonal']))
        .addOption(new Option('--status <status>', 'Series dates relative to today').choices(['current', 'past', 'upcoming']))
        .action((opts, command) => action(command, client => client.racing.series(filters(opts))));
      for (const operation of ['show', 'leaderboard']) tableCommand(series.command(`${operation} <series-key>`), 'racing-series-results')
        .description('Read series races and points rankings')
        .action((key, _opts, command) => action(command, client => client.racing.showSeries(key)));
      links(series, '<series-key>', (client, key) => client.racing.showSeries(key), 'series');
    }
  }
  for (const group of groups) { group.action(() => group.outputHelp()); group.helpCommand(true); }
}
