import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProgram, createServices, run, CliError } from '../dist/extension.js';

test('extensions reuse commands and errors while owning their identity and maintenance', async () => {
  let stdout = '', stderr = '';
  const services = createServices({ stdout: message => { stdout += message; }, stderr: message => { stderr += message; } });
  const application = {
    name: 'sailing-tools', version: '9.8.7',
    registerMaintenance: program => program.command('version').action(() => services.stdout('custom version\n')),
    extend: program => program.command('extra').action(() => { throw new CliError('NOT_FOUND', 'Missing resource', 5); }),
  };
  const program = createProgram(services, application);
  assert.ok(program.commands.some(command => command.name() === 'profile'));
  assert.ok(program.commands.some(command => command.name() === 'extra'));
  assert.ok(!program.commands.some(command => command.name() === 'upgrade'));
  assert.equal(await run(['node', 'sailing-tools', '--version'], services, application), 0);
  assert.equal(stdout, '9.8.7\n');
  stdout = '';
  assert.equal(await run(['node', 'sailing-tools', 'extra', '--json'], services, application), 5);
  assert.equal(JSON.parse(stdout).error.code, 'NOT_FOUND');
  assert.equal(stderr, '');
  assert.ok(!createProgram().commands.some(command => command.name() === 'extra'));
});
