#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createProject, loadConfig, normalizePath } from './lib/project.mjs';
import { checkDocuments } from './lib/checks.mjs';

const HELP = `doc-maintenance — repository documentation checks

  check   [--staged | --changed REF | --files PATH ...]
  confirm --pair PATH --reviewed
  brief   --pair PATH [--base REF]
  run     NAME

Common: --root DIR (default current directory), --config RELPATH, --json
check is read-only and never executes project commands or confirms translations.
confirm writes only the named pair's record; --reviewed acknowledges content review,
not a machine proof of semantic equivalence. run executes one configured argv.
Exit: 0 passed, 1 check/command failed, 2 invalid request/configuration/operation.
`;

function parseArgs(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const [command, ...rest] = argv;
  if (!['check', 'confirm', 'brief', 'run'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const options = { command, root: process.cwd(), json: false, files: [] };
  const seen = new Set();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (command === 'run' && !arg.startsWith('-') && !options.name) { options.name = arg; continue; }
    if (seen.has(arg)) throw new Error(`Repeated option: ${arg}`);
    seen.add(arg);
    if (['--json', '--staged', '--reviewed'].includes(arg)) options[arg.slice(2)] = true;
    else if (['--root', '--config', '--changed', '--pair', '--base'].includes(arg)) {
      if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = rest[++i];
    } else if (arg === '--files') {
      while (rest[i + 1] && !rest[i + 1].startsWith('--')) options.files.push(normalizePath(rest[++i]));
      if (!options.files.length) throw new Error('--files needs at least one path');
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  const allowed = {
    check: ['--staged', '--changed', '--files'],
    confirm: ['--pair', '--reviewed'], brief: ['--pair', '--base'], run: [],
  };
  for (const arg of seen) if (!['--root', '--config', '--json', ...allowed[command]].includes(arg)) throw new Error(`${arg} is not valid for ${command}`);
  if ([options.staged, options.changed, options.files.length > 0].filter(Boolean).length > 1) throw new Error('--staged, --changed and --files are mutually exclusive');
  if (['confirm', 'brief'].includes(command) && !options.pair) throw new Error(`${command} requires --pair PATH`);
  if (command === 'confirm' && !options.reviewed) throw new Error('confirm requires --reviewed after reviewing both language contents');
  if (command === 'run' && !options.name) throw new Error('run requires a configured command name');
  if (options.changed?.startsWith('-') || options.base?.startsWith('-')) throw new Error('Git references must not begin with a dash');
  return options;
}

function selection(project, configPath, options) {
  let paths = null, scope = 'full';
  if (options.staged) {
    paths = project.git(['diff', '--cached', '--name-only', '-z', '--no-renames', '--']).split('\0').filter(Boolean);
    scope = 'staged-changes';
  } else if (options.changed) {
    project.requireGitRoot();
    paths = [...project.git(['diff', '--name-only', '-z', '--no-renames', options.changed, '--']).split('\0'), ...project.git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')].filter(Boolean);
    scope = `working-changes-vs:${options.changed}`;
  } else if (options.files.length) { paths = options.files; scope = 'selected-files'; }
  if (paths?.includes(configPath)) return { selected: null, scope: `${scope};full-because-config-changed` };
  return { selected: paths ? new Set(paths) : null, scope };
}

function configuredCommand(project, name, command) {
  return new Promise(resolve => {
    const started = Date.now(), cap = 1024 * 1024;
    let stdout = '', stderr = '', timedOut = false, truncated = false, launchError;
    const child = spawn(command.argv[0], command.argv.slice(1), { cwd: project.root, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const capture = (current, data) => {
      const next = current + data.toString();
      if (Buffer.byteLength(next) > cap) { truncated = true; return Buffer.from(next).subarray(0, cap).toString(); }
      return next;
    };
    child.stdout.on('data', data => { stdout = capture(stdout, data); });
    child.stderr.on('data', data => { stderr = capture(stderr, data); });
    child.on('error', error => { launchError = error.message; });
    const timer = setTimeout(() => {
      timedOut = true;
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: false });
        killer.on('error', () => child.kill('SIGKILL'));
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') child.kill('SIGKILL'); }
      }
    }, command.timeoutMs ?? 120000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const ok = code === 0 && !timedOut && !launchError;
      resolve({ ok, command: 'run', name, input: 'worktree', scope: name, filesChecked: 0, exitCode: code, signal, timedOut, durationMs: Date.now() - started, stdout, stderr, truncated,
        errors: ok ? [] : [{ code: timedOut ? 'COMMAND_TIMEOUT' : 'COMMAND_FAILED', path: '.doc-maintenance.json', message: launchError || (timedOut ? `${name} exceeded its time limit` : `${name} exited with ${code ?? signal}`) }],
        notes: ['Only this configured command was executed. Its outcome does not prove unrelated documentation claims.'] });
    });
  });
}

async function execute(options) {
  const project = createProject(options.root, options.staged ? 'staged' : 'worktree');
  const configPath = normalizePath(options.config ?? '.doc-maintenance.json');
  const config = loadConfig(project, configPath, Boolean(options.config));
  if (options.command === 'check') {
    const { selected, scope } = selection(project, configPath, options);
    const pairs = config.pairs.filter(pair => !selected || [pair.source, pair.target, pair.record].some(path => selected.has(path)));
    if (selected) for (const pair of pairs) { selected.add(pair.source); selected.add(pair.target); }
    const result = checkDocuments(project, config, selected);
    if (pairs.length) {
      const { checkPair } = await import('./lib/pairs.mjs');
      for (const pair of pairs) result.errors.push(...checkPair(project, pair, config.pairs));
    }
    return { ok: result.errors.length === 0, command: 'check', input: project.mode, scope, selected: selected ? [...selected].sort() : null, ...result,
      notes: ['Content meaning, translation fidelity and reader success require evidence-led review.', 'External URLs are not fetched. Non-Markdown fragments are not validated. Project commands were not executed.', 'Link checking scans configured documents for inbound links; pair/budget checks respect the reported scope.'] };
  }
  if (options.command === 'run') {
    if (!Object.hasOwn(config.commands, options.name)) throw new Error(`Unknown configured command: ${options.name}`);
    return configuredCommand(project, options.name, config.commands[options.name]);
  }
  const path = normalizePath(options.pair);
  const pair = config.pairs.find(p => [p.source, p.target, p.record].includes(path));
  if (!pair) throw new Error(`No configured pair contains ${path}`);
  const { confirmPair, briefPair } = await import('./lib/pairs.mjs');
  if (options.command === 'confirm') {
    const result = confirmPair(project, pair, config.pairs);
    return { ok: true, command: 'confirm', input: 'worktree', scope: pair.source, filesChecked: 2, ...result, errors: [], notes: ['Recorded the contents you acknowledged reviewing. This is not a proof of semantic equivalence.'] };
  }
  project.requireGitRoot();
  return { ok: true, command: 'brief', input: 'worktree', scope: pair.source, filesChecked: 2, ...briefPair(project, pair, { base: options.base }), errors: [], notes: ['Review both-side changes before choosing a translation direction. No file was changed.'] };
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
  if (options.help) process.stdout.write(HELP);
  else {
    const result = await execute(options);
    if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'} ${result.command} (${result.input}, ${result.scope})\n`);
      for (const e of result.errors) process.stdout.write(`${e.path}${e.line ? ':' + e.line : ''} [${e.code}] ${e.message}\n`);
      if (result.command === 'run') process.stdout.write(result.stdout + result.stderr);
      if (result.command === 'brief') process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (result.command === 'confirm') process.stdout.write(`${result.changed ? 'Updated' : 'Unchanged'} ${result.record}\n`);
      for (const note of result.notes) process.stdout.write(`Note: ${note}\n`);
    }
    process.exitCode = result.ok ? 0 : 1;
  }
} catch (e) {
  const result = { ok: false, command: options?.command ?? process.argv[2] ?? null, errors: [{ code: 'OPERATION_ERROR', path: options?.config ?? '', message: e.message }] };
  if (options?.json || process.argv.includes('--json')) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else process.stderr.write(`ERROR: ${e.message}\n`);
  process.exitCode = 2;
}
