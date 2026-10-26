import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('scripts/doc-maintenance.mjs');
function example(t) {
  const root = mkdtempSync(join(tmpdir(), 'doc-workflow-'));
  cpSync(resolve('examples/minimal'), root, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function call(root, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args, '--root', root, '--json'], { encoding: 'utf8' });
  return { status: result.status, ...JSON.parse(result.stdout) };
}

test('a user can check, synchronize and explicitly confirm the packaged bilingual example', t => {
  const root = example(t);
  assert.equal(call(root, 'check').status, 0);
  const before = readFileSync(join(root, 'guide.i18n.yaml'), 'utf8');
  writeFileSync(join(root, 'guide.md'), readFileSync(join(root, 'guide.md'), 'utf8').replace('This sample keeps', 'This local sample keeps'));
  const stale = call(root, 'check', '--files', 'guide.md');
  assert.equal(stale.status, 1);
  assert.ok(stale.errors.some(e => e.code === 'pair-stale'));
  assert.equal(readFileSync(join(root, 'guide.i18n.yaml'), 'utf8'), before);
  assert.equal(call(root, 'confirm', '--pair', 'guide.md').status, 2);
  assert.equal(readFileSync(join(root, 'guide.i18n.yaml'), 'utf8'), before);
  writeFileSync(join(root, 'guide.zh.md'), readFileSync(join(root, 'guide.zh.md'), 'utf8').replace('本示例让', '本地示例让'));
  assert.equal(call(root, 'confirm', '--pair', 'guide.md', '--reviewed').status, 0);
  assert.equal(call(root, 'check').status, 0);
});

test('configured generator check catches a changed source without rewriting the generated reference', t => {
  const root = example(t);
  assert.equal(call(root, 'run', 'generated').status, 0);
  const before = readFileSync(join(root, 'reference.md'), 'utf8');
  const settings = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'));
  settings.retryLimit.default = 8;
  writeFileSync(join(root, 'settings.json'), JSON.stringify(settings));
  const failed = call(root, 'run', 'generated');
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /stale/);
  assert.equal(readFileSync(join(root, 'reference.md'), 'utf8'), before);
  const generate = spawnSync(process.execPath, ['project-check.mjs', '--write'], { cwd: root, encoding: 'utf8' });
  assert.equal(generate.status, 0);
  assert.match(readFileSync(join(root, 'reference.md'), 'utf8'), /retryLimit \| 8/);
  assert.equal(call(root, 'run', 'generated').status, 0);
});

test('configured commands time out and do not leave child work running', async t => {
  const root = example(t);
  const grandchild = "require('node:fs').writeFileSync('child-ready','yes');setTimeout(()=>require('node:fs').writeFileSync('late-output','bad'),1200)";
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'inherit'});setTimeout(()=>{},5000)`;
  writeFileSync(join(root, '.doc-maintenance.json'), JSON.stringify({ commands: { slow: { argv: [process.execPath, '-e', parent], timeoutMs: 600 } } }));
  const r = call(root, 'run', 'slow');
  assert.equal(r.status, 1);
  assert.equal(r.timedOut, true);
  assert.ok(existsSync(join(root, 'child-ready')), 'the subprocess actually started before the timeout');
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.equal(existsSync(join(root, 'late-output')), false);
});
