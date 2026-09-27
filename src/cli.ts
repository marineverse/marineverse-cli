import { Command, CommanderError, Option } from 'commander';
import { configDir, readConfig, resolveEnvironment, selectEnvironment, setEnvironment, type Environment, type GlobalOptions } from './config.js';
import { MarineVerseClient } from './client.js';
import { CliError, usage } from './errors.js';
import { human, safe, columnNames, validateColumns, type TableKind } from './output.js';
import { VERSION } from './version.js';
import { openBrowser } from './auth.js';
import { bundledSkill, manageSkill, type SkillAction } from './skills.js';

export interface Services {
  client: (environment: Environment) => MarineVerseClient;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  openBrowser?: (url: string) => Promise<void>;
}
const defaults: Services = { client: environment => new MarineVerseClient(environment), stdout: message => process.stdout.write(message), stderr: message => process.stderr.write(message) };

export function registerPublicCommands(program: Command, services: Services = defaults): void {
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
  const browserCommand = (group: Command, signature: string, description: string, path: (key?: string) => string) => {
    group.command(signature).description(description).option('--no-browser', 'Print the URL without opening a browser')
      .action(async (key: string | undefined, opts, command: Command) => {
        if (key !== undefined && !/^[A-Za-z0-9_-]+$/.test(key)) usage('Resource keys may contain letters, numbers, underscores, and hyphens.');
        const options = command.optsWithGlobals() as GlobalOptions;
        const environment = await resolveEnvironment(options);
        const url = new URL(path(key), environment.webUrl).href;
        if (opts.browser) {
          try { await (services.openBrowser || openBrowser)(url); }
          catch { throw new CliError('BROWSER_ERROR', `Could not open your browser. Open this URL manually: ${url}`); }
        }
        services.stdout(options.json
          ? `${JSON.stringify({ schema_version: 1, data: { url, browser_opened: opts.browser }, meta: { environment: environment.name } })}\n`
          : `${url}\n`);
      });
  };
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
  const registerLogin = (parent: Command) => parent.command('login').description('Sign in through the MarineVerse website')
    .option('--no-browser', 'Print a URL to open on this machine')
    .addOption(new Option('--storage <mode>', 'Credential storage (file is Unix-only)').choices(['keyring', 'file']).default('keyring'))
    .action(async (opts, command) => invoke(command, client => client.auth.login({ browser: opts.browser, storage: opts.storage,
      announce: url => services.stderr(`Open this MarineVerse page to authorize the CLI:\n${url}\n`) })));
  registerLogin(auth);
  registerLogin(program);
  auth.command('status').description('Verify the session and show identity, scopes, and expiry').action(execute(client => client.auth.status()));
  auth.command('logout').description('Revoke credentials and remove the local copy').action(execute(client => client.auth.logout()));
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
  tableCommand(boats.command('list'), 'boats').requiredOption('--mine', 'List boats you own or crew').action(execute(client => client.boats()));
  tableCommand(boats.command('show <boat-uuid>'), 'boats').description('Read one of your owned/crewed boats').action((uuid, opts, command) => invoke(command, client => client.showBoat(uuid)));
  tableCommand(boats.command('set-heading <boat-uuid>'), 'boats').requiredOption('--degrees <number>', 'Heading from 0 through 360 (360 becomes 0)')
    .action((uuid, opts, command) => {
      const heading = Number(opts.degrees);
      if (!opts.degrees.trim() || !Number.isFinite(heading) || heading < 0 || heading > 360) usage('Heading must be a finite number between 0 and 360.');
      return invoke(command, client => client.updateBoat(uuid, { heading: heading % 360 }));
    });
  tableCommand(boats.command('rename <boat-uuid>'), 'boats').requiredOption('--name <name>').description('Rename your boat (Sailing Pass required; sends the existing rename notification)')
    .action((uuid, opts, command) => {
      const name = opts.name.replace(/\s+/g, ' ').trim();
      if (!/^[A-Za-z0-9' ]{2,100}$/.test(name)) usage('Name must be 2–100 letters, numbers, spaces, or apostrophes.');
      return invoke(command, client => client.updateBoat(uuid, { name }));
    });
  for (const group of [program, config, auth, skills, globe, races, boats]) {
    group.action(() => { group.outputHelp(); });
    group.helpCommand(true);
  }
}

export function createProgram(services: Services = defaults): Command {
  const program = new Command().name('marineverse').description('MarineVerse public races, boat profiles, and authenticated boat controls')
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
    const failure = error instanceof CliError ? error : error instanceof CommanderError
      ? new CliError('INVALID_USAGE', error.message, 2) : new CliError('INTERNAL_ERROR', 'Operation failed. Check your configuration and credential store.');
    if (argv.includes('--json')) services.stdout(`${JSON.stringify({ schema_version: 1, error: { code: failure.code, message: failure.message, retry_after_seconds: failure.retryAfterSeconds } })}\n`);
    else services.stderr(`${failure.code}: ${safe(failure.message)}\n`);
    return failure.exitCode;
  }
}
