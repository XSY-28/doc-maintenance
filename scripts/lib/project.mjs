import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import picomatch from 'picomatch';

const DEFAULT_EXCLUDES = ['node_modules/**', '.git/**', 'work/**', 'dist/**', 'coverage/**'];

export function normalizePath(path) {
  if (typeof path !== 'string' || !path || path.includes('\0') || path.includes('\\') || isAbsolute(path) || /^[A-Za-z]:/.test(path)) {
    throw new Error(`Expected a repository-relative POSIX path: ${JSON.stringify(path)}`);
  }
  const parts = path.split('/').filter(p => p && p !== '.');
  if (!parts.length || parts.some(p => p === '..')) throw new Error(`Path leaves project or names its root: ${path}`);
  return parts.join('/');
}

/** A view of either working files or the exact Git index. Never falls back from index to disk. */
export function createProject(root, mode = 'worktree') {
  root = realpathSync(resolve(root));
  if (!statSync(root).isDirectory()) throw new Error(`Project is not a directory: ${root}`);
  const inside = path => path === root || path.startsWith(root + sep);
  const absolute = path => {
    const normalized = normalizePath(path);
    const full = resolve(root, normalized);
    let ancestor = full;
    while (!existsSync(ancestor)) {
      // A broken symlink also must not become a destination for a later write.
      try { if (lstatSync(ancestor).isSymbolicLink()) throw new Error(`Broken symlink: ${path}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      ancestor = dirname(ancestor);
    }
    if (!inside(realpathSync(ancestor))) throw new Error(`Path resolves outside project: ${path}`);
    return full;
  };
  const git = args => {
    // Inspect changes before Git operations. GIT_OPTIONAL_LOCKS avoids index refresh writes during reads.
    const opts = { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] };
    try {
      const safe = ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false'];
      execFileSync('git', [...safe, 'status', '--porcelain=v1', '-z'], opts);
      return execFileSync('git', [...safe, ...args], opts);
    } catch (e) { throw new Error(`Git ${args[0]} failed: ${String(e.stderr || e.message).trim()}`); }
  };
  const requireGitRoot = () => {
    if (realpathSync(git(['rev-parse', '--show-toplevel']).trim()) !== root) {
      throw new Error('--root must be the Git repository root for staged/changed/history operations');
    }
  };
  let entries;
  if (mode === 'staged') {
    requireGitRoot();
    entries = new Map();
    for (const line of git(['ls-files', '--stage', '-z']).split('\0').filter(Boolean)) {
      const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(line);
      if (!match || match[3] !== '0') throw new Error('Git index has unresolved conflicts; resolve them before checking staged content');
      entries.set(match[4], { mode: match[1], oid: match[2] });
    }
  }
  const indexFile = path => {
    path = normalizePath(path);
    const entry = entries.get(path);
    if (entry && !['100644', '100755'].includes(entry.mode)) throw new Error(`Index entry is not a regular file: ${path}`);
    return entry;
  };
  const cache = new Map();
  return {
    root, mode, git, requireGitRoot, path: absolute,
    list(exclude = DEFAULT_EXCLUDES) {
      const skip = picomatch([...DEFAULT_EXCLUDES, ...exclude], { dot: true });
      if (entries) return [...entries.keys()].filter(p => !skip(p));
      const files = [];
      function walk(dir) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name), p = relative(root, full).split(sep).join('/');
          if (skip(p) || skip(p + '/')) continue;
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile()) files.push(p);
          else if (entry.isSymbolicLink()) {
            // Do not walk linked directories; in-root file links remain checkable when referenced.
            try { absolute(p); if (statSync(full).isFile()) files.push(p); } catch { /* explicit references report the invalid link */ }
          }
        }
      }
      walk(root);
      return files.sort();
    },
    exists(path) {
      if (['.', './', ''].includes(path)) return true;
      path = normalizePath(path);
      if (entries) {
        const entry = indexFile(path);
        return Boolean(entry) || [...entries.keys()].some(p => p.startsWith(path + '/'));
      }
      return existsSync(absolute(path));
    },
    isDirectory(path) {
      if (['.', './', ''].includes(path)) return true;
      path = normalizePath(path);
      if (entries) return !entries.has(path) && [...entries.keys()].some(p => p.startsWith(path + '/'));
      return existsSync(absolute(path)) && statSync(absolute(path)).isDirectory();
    },
    read(path) {
      path = normalizePath(path);
      if (!entries) return readFileSync(absolute(path), 'utf8');
      const entry = indexFile(path);
      if (!entry) throw new Error(`File is absent from index: ${path}`);
      if (!cache.has(entry.oid)) cache.set(entry.oid, git(['cat-file', 'blob', entry.oid]));
      return cache.get(entry.oid);
    },
  };
}

function object(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context} must be an object`);
}
function keys(value, allowed, context) {
  object(value, context);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${context} field: ${key}`);
}
function patterns(value, context) {
  if (!Array.isArray(value) || value.some(p => typeof p !== 'string' || !p || p.startsWith('!') || p.includes('\\') || p.startsWith('/') || p.split('/').includes('..'))) {
    throw new Error(`${context} must be an array of positive project-relative glob patterns`);
  }
  return value;
}

export function loadConfig(project, path = '.doc-maintenance.json', explicit = false) {
  path = normalizePath(path);
  if (explicit && !project.exists(path)) throw new Error(`Configuration not found in ${project.mode}: ${path}`);
  const input = project.exists(path) ? JSON.parse(project.read(path)) : {};
  keys(input, ['documents', 'exclude', 'budgets', 'pairs', 'commands'], 'configuration');
  const config = {
    documents: patterns(input.documents ?? ['**/*.md'], 'documents'),
    exclude: [...DEFAULT_EXCLUDES, ...patterns(input.exclude ?? [], 'exclude')],
    budgets: input.budgets ?? [], pairs: input.pairs ?? [], commands: input.commands ?? {},
  };
  if (!Array.isArray(config.budgets) || !Array.isArray(config.pairs)) throw new Error('budgets and pairs must be arrays');
  const budgets = new Set();
  for (const budget of config.budgets) {
    keys(budget, ['path', 'limit', 'unit'], 'budget');
    budget.path = normalizePath(budget.path);
    if (budgets.has(budget.path)) throw new Error(`Duplicate budget: ${budget.path}`);
    budgets.add(budget.path);
    if (!Number.isSafeInteger(budget.limit) || budget.limit < 1) throw new Error(`Invalid budget limit for ${budget.path}`);
    if (!['words', 'characters'].includes(budget.unit)) throw new Error(`Budget unit must be words or characters: ${budget.path}`);
  }
  const pairPaths = new Set();
  for (const pair of config.pairs) {
    keys(pair, ['source', 'target', 'record'], 'pair');
    for (const key of ['source', 'target', 'record']) {
      pair[key] = normalizePath(pair[key]);
      if (pairPaths.has(pair[key])) throw new Error(`Duplicate pair path: ${pair[key]}`);
      pairPaths.add(pair[key]);
    }
    if (!/\.md$/i.test(pair.source) || !/\.md$/i.test(pair.target) || !/\.ya?ml$/i.test(pair.record)) throw new Error('Pairs require Markdown source/target and a YAML record');
  }
  object(config.commands, 'commands');
  for (const [name, command] of Object.entries(config.commands)) {
    keys(command, ['argv', 'description', 'timeoutMs'], `command ${name}`);
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid command name: ${name}`);
    if (!Array.isArray(command.argv) || !command.argv.length || command.argv.some(a => typeof a !== 'string' || a.includes('\0')) || !command.argv[0]) throw new Error(`Command ${name} requires argv strings`);
    if (command.description !== undefined && typeof command.description !== 'string') throw new Error(`Command ${name} description must be a string`);
    if (command.timeoutMs !== undefined && (!Number.isSafeInteger(command.timeoutMs) || command.timeoutMs < 1 || command.timeoutMs > 3600000)) throw new Error(`Command ${name} timeoutMs must be between 1 and 3600000`);
  }
  return config;
}

export function documentPaths(project, config) {
  const match = picomatch(config.documents, { dot: true });
  return project.list(config.exclude).filter(path => match(path));
}
