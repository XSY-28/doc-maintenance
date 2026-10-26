import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('scripts/doc-maintenance.mjs');
function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'doc-maintenance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
function run(root, ...args) {
  const p = spawnSync(process.execPath, [cli, ...args, '--root', root, '--json'], { encoding: 'utf8' });
  let result;
  try { result = JSON.parse(p.stdout); } catch { assert.fail(`CLI did not return JSON: ${p.stdout}\n${p.stderr}`); }
  return { status: p.status, ...result };
}
function git(root, ...args) {
  spawnSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' });
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('reports broken links and word budgets without rewriting input', t => {
  const body = '# Guide\n\nRead [missing](gone.md).\n';
  const root = fixture(t, {
    'README.md': body,
    '.doc-maintenance.json': JSON.stringify({ budgets: [{ path: 'README.md', unit: 'words', limit: 3 }] }),
  });
  const r = run(root, 'check');
  assert.equal(r.status, 1);
  assert.ok(r.errors.some(e => e.code === 'LINK_MISSING' && e.path === 'README.md'));
  assert.ok(r.errors.some(e => e.code === 'BUDGET_EXCEEDED'));
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), body);
});

test('resolves reference links, encoded paths, heading duplicates and explicit anchors', t => {
  const root = fixture(t, {
    'README.md': '# Start\n\n[guide][g]\n\n[g]: docs/a%20b.md#repeat-1\n\n[custom](docs/a%20b.md#manual)\n',
    'docs/a b.md': '---\ntitle: 示例\n---\n# Repeat\n\n## Repeat\n\n<a id="manual"></a>\n',
  });
  assert.equal(run(root, 'check').status, 0);
  writeFileSync(join(root, 'README.md'), '# Start\n\n[bad](docs/a%20b.md#absent)\n');
  assert.ok(run(root, 'check').errors.some(e => e.code === 'LINK_ANCHOR'));
});

test('Chinese character budgets count Unicode characters; missing budgeted file fails', t => {
  const root = fixture(t, {
    'README.md': '中文中文',
    '.doc-maintenance.json': JSON.stringify({ budgets: [
      { path: 'README.md', unit: 'characters', limit: 3 },
      { path: 'moved.md', unit: 'words', limit: 20 },
    ] }),
  });
  const r = run(root, 'check');
  assert.equal(r.status, 1);
  assert.ok(r.errors.some(e => e.code === 'BUDGET_EXCEEDED'));
  assert.ok(r.errors.some(e => e.code === 'BUDGET_MISSING'));
});

test('file-scoped checks catch inbound links when their target was removed', t => {
  const root = fixture(t, { 'README.md': '# Start\n\n[old](docs/removed.md)\n' });
  const r = run(root, 'check', '--files', 'docs/removed.md');
  assert.equal(r.status, 1);
  assert.ok(r.errors.some(e => e.code === 'LINK_MISSING' && e.path === 'README.md'));
});

test('staged checking reads links and configuration from index, not repaired working files', t => {
  const root = fixture(t, { 'README.md': '# Guide\n', 'target.md': '# Target\n' });
  git(root, 'init', '-q');
  git(root, 'add', 'README.md', 'target.md');
  git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline');
  writeFileSync(join(root, 'README.md'), '# Guide\n\n[broken](absent.md)\n');
  git(root, 'add', 'README.md');
  writeFileSync(join(root, 'README.md'), '# Guide\n\n[fixed](target.md)\n');
  assert.equal(run(root, 'check').status, 0);
  const staged = run(root, 'check', '--staged');
  assert.equal(staged.status, 1);
  assert.equal(staged.input, 'staged');
  assert.ok(staged.errors.some(e => e.code === 'LINK_MISSING'));
});

test('checking a project does not execute configured commands; explicit run propagates failure', t => {
  const root = fixture(t, {
    'README.md': '# Guide\n',
    '.doc-maintenance.json': JSON.stringify({ commands: {
      verify: { argv: [process.execPath, '-e', 'process.exit(7)'], description: 'existing project check' },
    } }),
  });
  assert.equal(run(root, 'check').status, 0);
  const r = run(root, 'run', 'verify');
  assert.equal(r.status, 1);
  assert.equal(r.exitCode, 7);
});

test('rejects unknown config options and paths escaping the project', t => {
  const root = fixture(t, { 'README.md': '# Guide\n', '.doc-maintenance.json': '{"budget": []}' });
  assert.equal(run(root, 'check').status, 2);
  writeFileSync(join(root, '.doc-maintenance.json'), '{}');
  writeFileSync(join(root, 'README.md'), '# Guide\n\n[escape](../outside.md)\n');
  assert.ok(run(root, 'check').errors.some(e => e.code === 'LINK_OUTSIDE'));
});

test('does not follow symlink targets outside the project', t => {
  const root = fixture(t, { 'README.md': '# Guide\n\n[linked](outside/file.md)\n' });
  symlinkSync(tmpdir(), join(root, 'outside'));
  assert.ok(run(root, 'check').errors.some(e => e.code === 'LINK_OUTSIDE'));
});

test('index reads never invoke a repository filesystem monitor', t => {
  const root = fixture(t, { 'README.md': '# Guide\n', 'monitor.sh': '#!/bin/sh\nprintf called >> monitor-calls\nprintf token\\0\n' });
  chmodSync(join(root, 'monitor.sh'), 0o755);
  git(root, 'init', '-q');
  git(root, 'add', 'README.md');
  git(root, 'config', 'core.fsmonitor', './monitor.sh');
  const r = run(root, 'check', '--staged');
  assert.equal(r.status, 0);
  assert.equal(existsSync(join(root, 'monitor-calls')), false);
});

test('scoped checks resolve directory indexes before filtering inbound anchors', t => {
  const root = fixture(t, { 'README.md': '# Home\n\n[Guide](docs/#removed)\n', 'docs/README.md': '# New\n\n[Home](../#home)\n' });
  const r = run(root, 'check', '--files', 'docs/README.md');
  assert.equal(r.status, 1);
  assert.ok(r.errors.some(e => e.code === 'LINK_ANCHOR' && e.path === 'README.md'));
  assert.ok(!r.errors.some(e => e.path === 'docs/README.md'));
});

test('checks HTML targets on their physical lines and reports unsupported responsive targets', t => {
  const root = fixture(t, { 'README.md': '<div>\n<p>Intro</p>\n<a title="a > b" href="missing.md">link</a>\n<link href="missing.css">\n<iframe title="a > b" src="missing.html"></iframe>\n<img srcset="missing.png 1x, missing2.png 2x">\n</div>\n' });
  const r = run(root, 'check');
  assert.equal(r.status, 1);
  assert.ok(r.errors.some(e => e.code === 'LINK_MISSING' && e.line === 3));
  assert.ok(r.errors.some(e => e.code === 'LINK_MISSING' && e.line === 4));
  assert.ok(r.errors.some(e => e.code === 'LINK_MISSING' && e.line === 5));
  assert.ok(r.errors.some(e => e.code === 'HTML_SRCSET_UNCHECKED' && e.line === 6));
});

test('reference detection respects escaped literals and formatted missing labels', t => {
  const root = fixture(t, { 'README.md': 'Write \\[label\\][target] literally.\n' });
  assert.equal(run(root, 'check').status, 0);
  writeFileSync(join(root, 'README.md'), 'Read [guide *now*][missing] and [guide `next`][absent].\n');
  const r = run(root, 'check');
  assert.equal(r.status, 1);
  assert.equal(r.errors.filter(e => e.code === 'REFERENCE_UNDEFINED').length, 2);
});
