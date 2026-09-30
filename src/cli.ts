import { Command, CommanderError, Option } from 'commander';
import { configDir, readConfig, resolveEnvironment, selectEnvironment, setEnvironment, type Environment, type GlobalOptions } from './config.js';
import { MarineVerseClient } from './client.js';
import { CliError, errno, usage } from './errors.js';
import { human, safe, columnNames, validateColumns, type TableKind } from './output.js';
import { VERSION } from './version.js';
import { checkVersion, versionMessage, upgrade, type VersionInfo, type UpgradeResult } from './updates.js';
import { openBrowser, chooseLoginMethod, confirmDeviceLogin, type LoginMethod } from './auth.js';
import { bundledSkill, manageSkill, type SkillAction } from './skills.js';
import { feedbackFilters, feedbackSorts, roadmapFilters } from './feedback.js';
import { marineverseLinks } from './links.js';

export interface Services {
  client: (environment: Environment) => MarineVerseClient;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  openBrowser?: (url: string) => Promise<void>;
  checkVersion?: () => Promise<VersionInfo>;
  upgrade?: (output: (message: string) => void) => Promise<UpgradeResult>;
  isInteractive?: () => boolean;
  chooseLoginMethod?: () => Promise<LoginMethod | undefined>;
  confirmDeviceLogin?: () => Promise<boolean>;
}
const defaults: Services = { client: environment => new MarineVerseClient(environment), stdout: message => process.stdout.write(message), stderr: message => process.stderr.write(message) };

export function registerPublicCommands(program: Command, services: Services = defaults): void {
  program.command('upgrade').description('Upgrade this installation using npm or Homebrew')
    .action(async (_opts, command) => {
      const result = await (services.upgrade || upgrade)(services.stderr);
      services.stdout(command.optsWithGlobals().json
        ? `${JSON.stringify({ schema_version: 1, data: result, meta: {} })}\n`
        : `${result.message}\n`);
    });
  program.command('version').description('Show installed version, check for updates, and show how to upgrade')
    .action(async (_opts, command) => {
      const result = await (services.checkVersion || checkVersion)();
      services.stdout(command.optsWithGlobals().json
        ? `${JSON.stringify({ schema_version: 1, data: result, meta: {} })}\n`
        : `${versionMessage(result)}\n`);
    });
  const tableCommands = new Map<Command, TableKind>();
  const tableCommand = (command: Command, kind: TableKind) => {
    tableCommands.set(command, kind);
    return command.option('--columns <fields>', `Table columns in order: ${columnNames[kind].join(', ')} (does not filter JSON)`);
  };
  const execute = (action: (client: MarineVerseClient) => Promise<unknown>) => async (_options: unknown, command: Command) => {
    const options = command.optsWithGlobals() as GlobalOptions;
    const kind = tableCommands.get(command);
    const columns = kind ? validateColumns(kind, command.opts().columns) : undefined;
    const environment = await resolveEnvironment(options);
    const data = await action(services.client(environment));
    services.stdout(options.json ? `${JSON.stringify({ schema_version: 1, data, meta: { environment: environment.name } })}\n` : `${human(data, columns)}\n`);
  };
  // Positional arguments are captured by each handler; execution remains shared.
  const invoke = async (command: Command, action: (client: MarineVerseClient) => Promise<unknown>) => execute(action)(command.opts(), command);
  const showUrl = async (command: Command, url: string, browser: boolean, meta: { environment?: string } = {}) => {
    if (browser) {
      try { await (services.openBrowser || openBrowser)(url); }
      catch { throw new CliError('BROWSER_ERROR', `Could not open your browser. Open this URL manually: ${url}`); }
    }
    services.stdout(command.optsWithGlobals().json
      ? `${JSON.stringify({ schema_version: 1, data: { url, browser_opened: browser }, meta })}\n`
      : `${url}\n`);
  };
  const browserCommand = (group: Command, signature: string, description: string, path: (...keys: string[]) => string) => {
    group.command(signature).description(description).option('--no-browser', 'Print the URL without opening a browser')
      .action(async (...args: any[]) => {
        const command = args.at(-1) as Command;
        const opts = command.opts();
        const keys = args.slice(0, command.registeredArguments.length).filter((value): value is string => value !== undefined);
        if (keys.some(key => !/^[\p{L}\p{N}_-]+$/u.test(key))) usage('Resource keys may contain letters, numbers, underscores, and hyphens.');
        const options = command.optsWithGlobals() as GlobalOptions;
        const environment = await resolveEnvironment(options);
        const url = new URL(path(...keys.map(encodeURIComponent)), environment.webUrl).href;
        await showUrl(command, url, opts.browser, { environment: environment.name });
      });
  };
  const links = program.command('links').description('List, print, or open useful MarineVerse links');
  const listLinks = (_opts: unknown, command: Command) => {
    const data = { links: marineverseLinks };
    services.stdout(command.optsWithGlobals().json
      ? `${JSON.stringify({ schema_version: 1, data, meta: {} })}\n`
      : `${human(data)}\n`);
  };
  links.action(listLinks);
  links.command('list').description('List useful MarineVerse links').action(listLinks);
  const linkUrl = (name: string) => {
    const link = marineverseLinks.find(link => link.name === name);
    if (!link) usage(`Unknown link "${name}". Choose from: ${marineverseLinks.map(link => link.name).join(', ')}.`);
    return link.url;
  };
  links.command('url <name>').description('Print a named MarineVerse URL')
    .action((name, _opts, command) => showUrl(command, linkUrl(name), false));
  links.command('open <name>').description('Open a named MarineVerse link in your browser')
    .option('--no-browser', 'Print the URL without opening a browser')
    .action((name, opts, command) => showUrl(command, linkUrl(name), opts.browser));
  links.helpCommand(true);
  const discord = program.command('discord').description('Join the MarineVerse Discord community');
  const discordUrl = linkUrl('discord');
  discord.command('open').description('Open the MarineVerse Discord invite in your browser')
    .option('--no-browser', 'Print the URL without opening a browser')
    .action((opts, command) => showUrl(command, discordUrl, opts.browser));
  discord.command('url').description('Print the MarineVerse Discord invite URL')
    .action((_opts, command) => showUrl(command, discordUrl, false));
  const config = program.command('config').description('Configure API, website, and OAuth client for each environment');
  config.command('set <name>').requiredOption('--web-url <origin>').option('--client-id <id>')
    .description('Save and select an environment (client ID is public, not a secret)')
    .action(async (name, opts, command) => {
      const apiUrl = command.optsWithGlobals().apiUrl;
      if (!apiUrl) usage('config set requires --api-url <origin>.');
      const result = await setEnvironment(name, apiUrl, opts.webUrl, opts.clientId);
      services.stdout(command.optsWithGlobals().json ? `${JSON.stringify({ schema_version: 1, data: result, meta: { environment: name } })}\n` : `${human(result)}\n`);
    });
  config.command('show').action(execute(async client => client.environment));
  config.command('path').description('Show where settings and account metadata live').action(execute(async () => ({ config_directory: configDir() })));
  config.command('list').description('List saved environments').action(execute(async () => readConfig()));
  config.command('use <name>').description('Select a saved environment without changing it').action(async (name, opts, command) => {
    await selectEnvironment(name);
    await invoke(command, async client => client.environment);
  });
  const auth = program.command('auth').description('Sign in through the MarineVerse website');
  // --browser and --no-browser share one value, which stays undefined unless either is given:
  // only --no-browser (false) stops the browser launch; only an explicit --browser (true) skips the chooser.
  const registerLogin = (parent: Command) => parent.command('login').description('Sign in through the MarineVerse website')
    .option('--no-browser', 'Print the sign-in URL without opening a browser')
    .option('--browser', 'Use browser login on this computer without asking')
    .option('--device-auth', 'Use device code login from another browser or device (remote or headless) without asking')
    .addOption(new Option('--storage <mode>', 'Credential storage (file is Unix-only)').choices(['keyring', 'file']).default('keyring'))
    .action(async (opts, command) => {
      const browserFlag = opts.browser === true;
      const browser = opts.browser !== false;
      if (browserFlag && opts.deviceAuth) usage('Choose either --browser or --device-auth.');
      // Scripts and --json never wait on the chooser; they keep the existing browser login.
      const interactive = !command.optsWithGlobals().json && (services.isInteractive || (() => !!process.stdin.isTTY && !!process.stderr.isTTY))();
      const method = opts.deviceAuth ? 'device' : browserFlag || !interactive ? 'browser' : await (services.chooseLoginMethod || chooseLoginMethod)();
      if (!method) throw new CliError('AUTH_CANCELLED', 'Login cancelled.', 3);
      const deviceLogin = (client: MarineVerseClient) => client.auth.deviceLogin({ browser, storage: opts.storage,
        announce: (url, code, expiresIn) => services.stderr(`Open this MarineVerse page on any device and enter the code:\n${url}\n\n  ${code}\n\nThe code expires in ${Math.round(expiresIn / 60)} minutes. Waiting for approval...\n`) });
      return invoke(command, async client => {
        if (method === 'device') return deviceLogin(client);
        try {
          return await client.auth.login({ browser, storage: opts.storage,
            announce: url => services.stderr(`Open this MarineVerse page to authorize the CLI:\n${url}\nIf the browser cannot reach this computer, run marineverse login --device-auth instead.\n`) });
        } catch (error) {
          // login() has closed its listener by now, so only one grant is ever active; never switch without asking.
          if (!(error instanceof CliError) || error.code !== 'AUTH_TIMEOUT' || !interactive || !await (services.confirmDeviceLogin || confirmDeviceLogin)()) throw error;
          return deviceLogin(client);
        }
      });
    });
  registerLogin(auth);
  registerLogin(program);
  auth.command('status').description('Verify the session and show identity, scopes, and expiry (may refresh and save tokens)')
    .option('--local', 'Show stored identity, scopes, and expiry without network access or token refresh')
    .action((opts, command) => invoke(command, client => opts.local ? client.auth.localStatus() : client.auth.status()));
  auth.command('logout').description('Revoke credentials and remove the local copy').action(execute(client => client.auth.logout()));
  const profile = program.command('profile').description('Your MarineVerse profile');
  const feedback = program.command('feedback').description('Browse the roadmap and discuss feedback');
  feedback.command('roadmap').description('Planned, in-progress, and completed work (latest 20 per status)')
    .option('--search <text>', 'Search titles and descriptions')
    .addOption(new Option('--filter <filter>', 'Filter roadmap posts').choices(roadmapFilters).default('all'))
    .action((opts, command) => invoke(command, client => client.feedback.roadmap(opts)));
  const feedbackBoards = feedback.command('boards').description('Feedback boards and recent activity');
  feedbackBoards.command('list').description('List public feedback boards').action(execute(client => client.feedback.boards()));
  feedbackBoards.command('feed <board>').description('Read recent posts, comments, and votes')
    .option('--page <number>', 'Activity page', '1').option('--types <types>', 'Comma-separated posts,comments,votes')
    .action((board, opts, command) => invoke(command, client => client.feedback.feed(board, opts)));
  const feedbackPosts = feedback.command('posts').description('Read, create, edit, and vote on posts');
  feedbackPosts.command('suggested <board>').description('Find similar posts before creating feedback')
    .requiredOption('--title <text>', 'Proposed title').option('--description <text>', 'Proposed details')
    .action((board, opts, command) => invoke(command, client => client.feedback.suggested(board, opts.title, opts.description)));
  feedbackPosts.command('list <board>').description('Browse or search a board')
    .option('--search <text>', 'Search titles and descriptions').option('--page <number>', 'Results page', '1')
    .addOption(new Option('--sort <sort>', 'Sort posts').choices(feedbackSorts).default('trending'))
    .addOption(new Option('--filter <filter>', 'Filter posts').choices(feedbackFilters).default('all'))
    .action((board, opts, command) => invoke(command, client => client.feedback.posts(board, opts)));
  feedbackPosts.command('show <board> <post>').description('Read a post, voters, related posts, and comments')
    .action((board, post, _opts, command) => invoke(command, client => client.feedback.show(board, post)));
  feedbackPosts.command('create <board>').description('Publish a post (login required)')
    .requiredOption('--title <text>', 'Post title').requiredOption('--description <text>', 'Post details')
    .action((board, opts, command) => invoke(command, client => client.feedback.create(board, opts.title, opts.description)));
  feedbackPosts.command('update <board> <post>').description('Edit your own post (supply both title and description)')
    .requiredOption('--title <text>', 'Post title').requiredOption('--description <text>', 'Post details')
    .action((board, post, opts, command) => invoke(command, client => client.feedback.update(board, post, opts.title, opts.description)));
  for (const [name, remove] of [['upvote', false], ['unvote', true]] as const) {
    feedbackPosts.command(`${name} <board> <post>`).description(remove ? 'Remove your upvote' : 'Upvote a post')
      .action((board, post, _opts, command) => invoke(command, client => client.feedback.vote(board, post, remove)));
  }
  const feedbackComments = feedback.command('comments').description('Comment, reply, edit, delete, and vote');
  feedbackComments.command('create <post-uuid>').description('Publish a comment or reply (login required)')
    .requiredOption('--content <text>', 'Comment text').option('--reply-to <comment-uuid>', 'Reply to a top-level comment')
    .action((uuid, opts, command) => invoke(command, client => client.feedback.comment(uuid, opts.content, opts.replyTo)));
  feedbackComments.command('update <comment-uuid>').description('Edit your own comment').requiredOption('--content <text>', 'Comment text')
    .action((uuid, opts, command) => invoke(command, client => client.feedback.editComment(uuid, opts.content)));
  feedbackComments.command('delete <comment-uuid>').description('Delete your own comment and its replies')
    .action((uuid, _opts, command) => invoke(command, client => client.feedback.deleteComment(uuid)));
  for (const [name, remove] of [['upvote', false], ['unvote', true]] as const) {
    feedbackComments.command(`${name} <comment-uuid>`).description(remove ? 'Remove your comment upvote' : 'Upvote a comment')
      .action((uuid, _opts, command) => invoke(command, client => client.feedback.voteComment(uuid, remove)));
  }
  browserCommand(feedback, 'open', 'Open the feedback roadmap', () => '/feedback');
  browserCommand(feedbackBoards, 'open <board>', 'Open a feedback board', board => `/feedback/${board}`);
  browserCommand(feedbackPosts, 'open <board> <post>', 'Open a post on the website', (board, post) => `/feedback/${board}/${post}`);
  const kb = program.command('kb').alias('knowledge-base').description('Search and read sailing knowledge (membership required)');
  program.command('faq [topic]').description('List public FAQ topics or read a topic without login')
    .option('--locale <code>', 'Language code, such as en-US')
    .action((topic, opts, command) => invoke(command, client => topic ? client.content.faq(topic, opts) : client.content.topics(opts)));
  program.command('history').description('Read MarineVerse Sailing Club updates and development history')
    .option('--locale <code>', 'Language code, such as en-US')
    .option('--limit <count>', 'Maximum patch notes, 1–20', '10')
    .action((opts, command) => invoke(command, client => client.content.history({ locale: opts.locale, limit: Number(opts.limit) })));
  const sailingClub = program.command('sailing-club').description('MarineVerse Sailing Club product information');
  const changelog = sailingClub.command('changelog').aliases(['release-notes', 'history']).description('Read public Sailing Club application release notes');
  const historyOptions = (command: Command) => command.option('--locale <code>', 'Language code, such as en-US')
    .option('--limit <count>', 'Maximum releases, 1–20')
    .option('--from-version <version>', 'First included release version').option('--to-version <version>', 'Last included release version')
    .option('--from-date <date>', 'First included ISO release date').option('--to-date <date>', 'Last included ISO release date')
    .option('--all', 'Read every release');
  const releaseOptions = (opts: any) => ({ ...opts, limit: opts.limit === undefined ? (opts.all ? undefined : 10) : Number(opts.limit) });
  historyOptions(changelog.command('list', { isDefault: true }).description('List recent releases, an inclusive range, or all releases'))
    .action((opts, command) => invoke(command, client => client.content.changelog(releaseOptions(opts))));
  changelog.command('latest').description('Read the latest release by release date').option('--locale <code>', 'Language code, such as en-US')
    .action((opts, command) => invoke(command, client => client.content.changelog({ locale: opts.locale, latest: true })));
  changelog.command('version <version>').description('Read one exact release version').option('--locale <code>', 'Language code, such as en-US')
    .action((version, opts, command) => invoke(command, client => client.content.changelog({ locale: opts.locale, version })));
  const content = program.command('content').description('Search public FAQs and Sailing Club patch notes without login');
  const clubs = program.command('groups').alias('clubs').description('Find sailing clubs and schools, and manage your memberships');
  clubs.command('list').alias('my').description('List your memberships and pending join requests')
    .action(execute(client => client.clubs.list()));
  clubs.command('join <club>').description('Join a club or request approval using its UUID or slug')
    .option('--message <text>', 'Message for the club approving your request')
    .action((club, opts, command) => invoke(command, client => client.clubs.join(club, opts.message)));
  clubs.command('leave <club>').description('Leave a club using its UUID or slug')
    .action((club, _opts, command) => invoke(command, client => client.clubs.leave(club)));
  clubs.command('search [query]').description('Search names, short names or cities, or find nearby clubs')
    .option('--latitude <degrees>', 'Centre latitude in degrees', Number)
    .option('--longitude <degrees>', 'Centre longitude in degrees', Number)
    .option('--radius-km <kilometres>', 'Nearby radius, 1–500 kilometres (default 50)', Number)
    .option('--type <type>', 'Club type, such as sailability_chapter or federation')
    .option('--country <code>', 'Two-letter country code, such as AU')
    .option('--limit <count>', 'Maximum results, 1–50', '10')
    .action((query, opts, command) => invoke(command, client => client.clubs.search(query, { ...opts, limit: Number(opts.limit) })));
  content.command('search <query>').description('Find public content by keyword')
    .option('--locale <code>', 'Language code, such as en-US')
    .option('--limit <count>', 'Maximum results, 1–20', '5')
    .action((query, opts, command) => invoke(command, client => client.content.search(query, { locale: opts.locale, limit: Number(opts.limit) })));
  kb.command('search <query>').description('Find relevant sailing articles')
    .option('--limit <count>', 'Maximum articles, 1–10', '5')
    .action((query, opts, command) => invoke(command, client => client.knowledgeSearch(query, Number(opts.limit))));
  kb.command('show <article-uuid>').description('Read a full article')
    .action((uuid, _opts, command) => invoke(command, client => client.knowledgeArticle(uuid)));
  const ai = program.command('ai').description('Ask the MarineVerse assistant (membership required)');
  ai.command('ask <question>').description('Ask a question using your MarineVerse account')
    .action((question, _opts, command) => invoke(command, client => client.ask(question)));
  profile.command('show').description('Show your profile (login required)').action(execute(client => client.myProfile()));
  browserCommand(profile, 'open', 'Open your profile on the website', () => '/my-profile');
  const progress = program.command('progress').description('Your sailing lessons and next step');
  tableCommand(progress.command('show'), 'tutorials').description('Show tutorial progress (login required)').action(execute(client => client.progress()));
  browserCommand(progress, 'open', 'Open your sailing progress on the website', () => '/marineverse-cup/my-progress');
  const stats = program.command('stats').description('Your sailing statistics');
  tableCommand(stats.command('distance'), 'distance').description('Overall distance and sailing time by boat type (login required)')
    .option('--boat <type>', 'Show one boat type from the distance table')
    .action((opts, command) => invoke(command, client => client.distance(opts.boat)));
  browserCommand(stats, 'open', 'Open your distance statistics on the website', () => '/marineverse-cup/my-distance-stats');
  const skills = program.command('skills').description('Install the bundled MarineVerse skill for Codex or Claude Code');
  skills.command('show').description('Print the self-contained skill, including CLI setup instructions').action(async (_opts, command) => {
    const skill = await bundledSkill();
    services.stdout(command.optsWithGlobals().json ? `${JSON.stringify({ schema_version: 1, data: { skill }, meta: {} })}\n` : skill);
  });
  for (const action of ['install', 'update', 'uninstall'] as SkillAction[]) {
    skills.command(action).description(`${action[0]!.toUpperCase()}${action.slice(1)} the skill; preserve customized or unmanaged files`)
      .addOption(new Option('--agent <agent>', 'Agent receiving the skill').choices(['codex', 'claude']).makeOptionMandatory())
      .addOption(new Option('--scope <scope>', 'Personal directory or current project').choices(['user', 'project']).default('user'))
      .action(async (opts, command) => {
        const result = await manageSkill(action, opts.agent, opts.scope);
        services.stdout(command.optsWithGlobals().json ? `${JSON.stringify({ schema_version: 1, data: result, meta: {} })}\n` : `${human(result)}\n`);
      });
  }
  const globe = program.command('globe').description('Browse races and control your Globe boats');
  const races = globe.command('races').description('Public races; no login needed');
  browserCommand(races, 'open [race-key]', 'Open a race or the race list on the website', key => key ? `/globe/races/${key}` : '/globe/races');
  tableCommand(races.command('list'), 'races').description('Registration-open, active, and latest ten finished races').action(execute(client => client.races()));
  tableCommand(races.command('show <race-key>'), 'leaderboard').description('Race details and leaderboard').action((key, opts, command) => invoke(command, client => client.race(key)));
  tableCommand(races.command('leaderboard <race-key>'), 'leaderboard').description('Server-ranked leaderboard including time penalties')
    .action((key, opts, command) => invoke(command, async client => { const race = await client.race(key); return { publicKey: race.publicKey, name: race.name, entries: race.entries }; }));
  const boats = globe.command('boats').description('Public profiles and authenticated boat controls');
  browserCommand(boats, 'open <boat-uuid>', 'Open a public boat profile on the website', key => `/globe/boats-profiles/${key}`);
  browserCommand(boats, 'view-3d <boat-uuid>', 'Open the boat’s 3D view on the website', key => `/globe/boats-profiles/${key}/3d`);
  tableCommand(boats.command('profile <boat-uuid>'), 'boats').description('View a public boat profile without login').action((uuid, opts, command) => invoke(command, client => client.profile(uuid)));
  // Weather is fetched only when a weather column is requested.
  tableCommand(boats.command('list'), 'boats').requiredOption('--mine', 'List boats you own or crew')
    .action((opts, command) => invoke(command, client => client.boats(
      String(opts.columns ?? '').split(',').some(column => ['wind', 'wind-dir', 'current', 'wave'].includes(column.trim())))));
  tableCommand(boats.command('show <boat-uuid>'), 'boats').description('Read one of your owned/crewed boats').action((uuid, opts, command) => invoke(command, client => client.showBoat(uuid)));
  boats.command('history <boat-uuid>').description('Recorded logs, port calls, or passages of your boat, newest first (one type per request)')
    .addOption(new Option('--type <type>', 'History to read').choices(['logs', 'port-calls', 'passages']).default('logs'))
    .option('--limit <count>', 'Maximum records, 1–200', '50')
    .option('--since <time>', 'Only records at or after this ISO 8601 time, such as 2026-09-30T00:00:00Z')
    .option('--cursor <cursor>', 'Continue from next_cursor of the previous page')
    .action((uuid, opts, command) => invoke(command, client => client.boatHistory(uuid, { ...opts, limit: Number(opts.limit) })));
  tableCommand(boats.command('set-heading <boat-uuid>'), 'boats').requiredOption('--degrees <number>', 'Heading from 0 through 360 (360 becomes 0)')
    .action((uuid, opts, command) => {
      const heading = Number(opts.degrees);
      if (!opts.degrees.trim() || !Number.isFinite(heading) || heading < 0 || heading > 360) usage('Heading must be a finite number between 0 and 360.');
      return invoke(command, client => client.updateBoat(uuid, { heading: heading % 360 }));
    });
  for (const [name, level, description] of [
    ['raise-sails', 1, 'Fully raise both sails to start sailing'],
    ['lower-sails', 0, 'Fully lower both sails (anchors the boat in Globe)'],
    ['drop-anchor', 0, 'Anchor the boat by fully lowering both sails'],
  ] as const) {
    tableCommand(boats.command(`${name} <boat-uuid>`), 'boats').description(description)
      .action((uuid, _opts, command) => invoke(command, client => client.updateBoat(uuid, { mainsail_hoist: level, jib_hoist: level })));
  }
  tableCommand(boats.command('set-sails <boat-uuid>'), 'boats').description('Set either sail; omitted sails keep their current level')
    .option('--main <level>', 'Mainsail hoist from 0 (lowered) to 1 (fully raised)')
    .option('--jib <level>', 'Jib hoist from 0 (lowered) to 1 (fully raised)')
    .action((uuid, opts, command) => {
      const change: { mainsail_hoist?: number; jib_hoist?: number } = {};
      for (const [option, field] of [['main', 'mainsail_hoist'], ['jib', 'jib_hoist']] as const) {
        if (opts[option] === undefined) continue;
        const level = Number(opts[option]);
        if (!opts[option].trim() || !Number.isFinite(level) || level < 0 || level > 1) usage(`--${option} must be a finite number between 0 and 1.`);
        change[field] = level;
      }
      if (!Object.keys(change).length) usage('Specify --main and/or --jib with a level from 0 to 1.');
      return invoke(command, client => client.updateBoat(uuid, change));
    });
  tableCommand(boats.command('rename <boat-uuid>'), 'boats').requiredOption('--name <name>').description('Rename your boat (Sailing Pass required; sends the existing rename notification)')
    .action((uuid, opts, command) => {
      const name = opts.name.replace(/\s+/g, ' ').trim();
      if (!/^[A-Za-z0-9' ]{2,100}$/.test(name)) usage('Name must be 2–100 letters, numbers, spaces, or apostrophes.');
      return invoke(command, client => client.updateBoat(uuid, { name }));
    });
  for (const group of [program, config, auth, discord, profile, progress, stats, skills, globe, races, boats, kb, ai, content, sailingClub, clubs, feedback, feedbackBoards, feedbackPosts, feedbackComments]) {
    group.action(() => { group.outputHelp(); });
    group.helpCommand(true);
  }
}

export function createProgram(services: Services = defaults): Command {
  const program = new Command().name('marineverse').description('MarineVerse races, boats, profile, sailing progress, and statistics')
    .version(VERSION).option('--env <name>', 'Configured environment').option('--api-url <origin>', 'Override API origin (does not reuse credentials across origins)')
    .option('--json', 'Print a versioned JSON result').option('--no-color', 'Disable color (output is plain by default)')
    .showHelpAfterError().exitOverride().configureOutput({ writeOut: services.stdout, writeErr: () => {} });
  registerPublicCommands(program, services);
  return program;
}

export async function run(argv: string[], services: Services = defaults): Promise<number> {
  try {
    const program = createProgram(services);
    if (argv.length <= 2) { program.outputHelp(); return 0; }
    await program.parseAsync(argv);
    return 0;
  }
  catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0;
    const syscall = (error as NodeJS.ErrnoException)?.syscall;
    const failure = error instanceof CliError ? error : error instanceof CommanderError
      ? new CliError('INVALID_USAGE', error.message, 2)
      : errno(error) !== 'unknown error'
        ? new CliError('FILESYSTEM_ERROR', `A local file operation failed (${errno(error)}${typeof syscall === 'string' && /^[a-z]+$/.test(syscall) ? ` during ${syscall}` : ''}). Check permissions under ${configDir()}.`, 2)
        : new CliError('INTERNAL_ERROR', 'Operation failed. Check your configuration and credential store.');
    if (argv.includes('--json')) services.stdout(`${JSON.stringify({ schema_version: 1, error: { code: failure.code, message: failure.message, retry_after_seconds: failure.retryAfterSeconds } })}\n`);
    else services.stderr(`${failure.code}: ${safe(failure.message)}\n`);
    return failure.exitCode;
  }
}
