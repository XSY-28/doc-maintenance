import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { validatePair, computeRecord, checkPair, confirmPair, briefPair } from '../scripts/lib/pairs.mjs';

const pair = { source: 'en.md', target: 'zh.md', record: 'pair.yml' };
function fixture(t, en = '# Guide\n\nHello.\n\n## Install\n\nRun it.\n\n## Usage\n\nUse it.\n', zh = '# 指南\n\n你好。\n\n## 安装\n\n运行。\n\n## 用法\n\n使用。\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-pairs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), text); };
  write(pair.source, en); write(pair.target, zh);
  const git = args => {
    // Inspect actual changes before every Git operation, including init.
    spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' });
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  };
  const project = { root, mode: 'worktree', exists: p => fs.existsSync(path.join(root, p)), read: p => fs.readFileSync(path.join(root, p), 'utf8'), git };
  const commit = message => { git(['add', '--', 'en.md', 'zh.md', 'pair.yml']); git(['-c', 'user.name=Pair Test', '-c', 'user.email=pair@example.invalid', 'commit', '-qm', message]); };
  return { root, write, project, git, commit };
}
const codes = errors => errors.map(e => e.code);

test('confirmation records exact prose changes, including prose identical in both languages', t => {
  const f = fixture(t);
  assert.deepEqual(checkPair(f.project, pair, [pair]).map(e => e.code), ['pair-record-missing']);
  assert.equal(confirmPair(f.project, pair, [pair]).changed, true);
  assert.deepEqual(checkPair(f.project, pair, [pair]), []);
  assert.equal(confirmPair(f.project, pair, [pair]).changed, false);
  f.write('en.md', f.project.read('en.md').replace('Hello.', 'New wording.'));
  assert.ok(codes(checkPair(f.project, pair, [pair])).includes('pair-stale'));
  f.write('en.md', '# Shared\n\nIdentical prose.\n'); f.write('zh.md', '# Shared\n\nIdentical prose.\n');
  confirmPair(f.project, pair, [pair]);
  f.write('en.md', '# Shared\n\nChanged shared prose.\n'); f.write('zh.md', '# Shared\n\nChanged shared prose.\n');
  assert.ok(codes(checkPair(f.project, pair, [pair])).includes('pair-stale'));
});

test('structural disagreement blocks confirmation without writing a record', t => {
  const cases = [
    ['# A\n\n- one\n- two\n', '# 甲\n\n- 一\n'],
    ['# A\n\n## B\n', '# 甲\n\n### 乙\n'],
    ['# A\n\n| A | B |\n| - | - |\n| x | y |\n', '# 甲\n\n| 甲 |\n| - |\n| 一 |\n'],
    ['# A\n\n```js\nx()\n```\n', '# 甲\n\n```js\ny()\n```\n'],
    ['# A\n\nUse `--root`.\n', '# 甲\n\n使用 `--path`。\n'],
    ['---\ntitle: A\ncommand: run\n---\n# A\n', '---\ntitle: 甲\ncommand: stop\n---\n# 甲\n'],
  ];
  for (const [en, zh] of cases) {
    const f = fixture(t, en, zh);
    assert.ok(validatePair(f.project, pair, [pair]).length, `${en} must disagree`);
    assert.throws(() => confirmPair(f.project, pair, [pair]));
    assert.equal(f.project.exists('pair.yml'), false);
  }
});

test('mapped local links require locale siblings; explicit language switchers and exact suffixes work', t => {
  const f = fixture(t, '# Guide\n\n[Other](other/en.md?q=1#same) [中文](zh.md)\n', '# 指南\n\n[其他](other/zh.md?q=1#same) [English](en.md)\n');
  const other = { source: 'other/en.md', target: 'other/zh.md', record: 'other/pair.yml' };
  assert.deepEqual(validatePair(f.project, pair, [pair, other]), []);
  f.write('zh.md', '# 指南\n\n[其他](other/en.md?q=1#same) [English](en.md)\n');
  assert.ok(codes(validatePair(f.project, pair, [pair, other])).includes('pair-links'));
  f.write('zh.md', '# 指南\n\n[其他](other/zh.md?q=2#same) [English](en.md)\n');
  assert.ok(codes(validatePair(f.project, pair, [pair, other])).includes('pair-links'));
});

test('identical fenced and generated changes need no refresh, but invalid regions fail', t => {
  const make = (heading, n) => `# ${heading}\n\nText.\n\n\`\`\`js\nconst n = ${n};\n\`\`\`\n\n<!-- doc-maintenance:generated:start stats -->\nCount ${n}\n<!-- doc-maintenance:generated:end stats -->\n`;
  const f = fixture(t, make('Guide', 1), make('指南', 1));
  confirmPair(f.project, pair, [pair]);
  f.write('en.md', make('Guide', 2)); f.write('zh.md', make('指南', 2));
  assert.deepEqual(checkPair(f.project, pair, [pair]), []);
  f.write('zh.md', make('指南', 3));
  assert.ok(validatePair(f.project, pair, [pair]).length);
});

test('frontmatter localizes prose but keeps shape and identifiers; malformed records are diagnosed', t => {
  const f = fixture(t, '---\ntitle: Guide\nslug: guide\ntags: [api]\n---\n# Guide\n', '---\ntitle: 指南\nslug: guide\ntags: [api]\n---\n# 指南\n');
  assert.deepEqual(validatePair(f.project, pair, [pair]), []);
  f.write('pair.yml', 'sections: [broken\n');
  assert.ok(codes(checkPair(f.project, pair, [pair])).includes('pair-record-invalid'));
  confirmPair(f.project, pair, [pair]);
  f.write('pair.yml', `# comment\n${f.project.read('pair.yml')}`);
  assert.ok(codes(checkPair(f.project, pair, [pair])).includes('pair-record-noncanonical'));
});

test('staged checks use supplied index view and confirmation refuses staged writes', t => {
  const f = fixture(t); confirmPair(f.project, pair, [pair]);
  const index = Object.fromEntries(['en.md', 'zh.md', 'pair.yml'].map(p => [p, f.project.read(p)]));
  f.write('en.md', '# Broken\n\n## Extra\n');
  const staged = { ...f.project, mode: 'staged', exists: p => p in index, read: p => index[p] };
  assert.deepEqual(checkPair(staged, pair, [pair]), []);
  assert.throws(() => confirmPair(staged, pair, [pair]), /worktree|working tree/i);
});

test('brief recovers committed confirmation and shows both sides before/after without writing', t => {
  const f = fixture(t); f.git(['init', '-q']); confirmPair(f.project, pair, [pair]); f.commit('confirmed');
  const before = f.project.read('pair.yml');
  f.write('en.md', f.project.read('en.md').replace('Run it.', 'Run the command.'));
  f.write('zh.md', f.project.read('zh.md').replace('运行。', '运行命令。'));
  const brief = briefPair(f.project, pair, {});
  const section = brief.sections.find(s => s.bothChanged);
  assert.ok(section);
  assert.match(section.source.before, /Run it\./); assert.match(section.source.after, /Run the command\./);
  assert.match(section.target.before, /运行。/); assert.match(section.target.after, /运行命令。/);
  assert.equal(f.project.read('pair.yml'), before);
  f.commit('unconfirmed edits');
  assert.throws(() => briefPair(f.project, pair, { base: 'HEAD' }), /confirm|baseline/i);
  assert.ok(briefPair(f.project, pair, {}).sections.some(s => s.bothChanged));
});

test('brief fails clearly when confirmation has no committed historical sources', t => {
  const f = fixture(t); f.git(['init', '-q']); confirmPair(f.project, pair, [pair]);
  assert.throws(() => briefPair(f.project, pair, {}), /baseline|commit|history/i);
});

test('independent section confirmations merge with ordinary Git', t => {
  const f = fixture(t); f.git(['init', '-q']); confirmPair(f.project, pair, [pair]); f.commit('base');
  const base = f.git(['rev-parse', 'HEAD']).trim();
  f.git(['checkout', '-qb', 'install']);
  f.write('en.md', f.project.read('en.md').replace('Run it.', 'Install now.'));
  f.write('zh.md', f.project.read('zh.md').replace('运行。', '现在安装。'));
  confirmPair(f.project, pair, [pair]); f.commit('install');
  f.git(['checkout', '-qb', 'usage', base]);
  f.write('en.md', f.project.read('en.md').replace('Use it.', 'Use safely.'));
  f.write('zh.md', f.project.read('zh.md').replace('使用。', '安全使用。'));
  confirmPair(f.project, pair, [pair]); f.commit('usage');
  f.git(['-c', 'user.name=Pair Test', '-c', 'user.email=pair@example.invalid', 'merge', '--no-edit', 'install']);
  assert.deepEqual(checkPair(f.project, pair, [pair]), []);
});

test('confirmation refuses a record alias to a document without modifying the document', t => {
  const f = fixture(t);
  const before = f.project.read('en.md');
  fs.symlinkSync('en.md', path.join(f.root, 'pair.yml'));
  assert.throws(() => confirmPair(f.project, pair, [pair]), /symlink|alias|document/i);
  assert.equal(f.project.read('en.md'), before);
});

test('brief explicitly reports ambiguous section alignment after one-sided heading insertion', t => {
  const f = fixture(t); f.git(['init', '-q']); confirmPair(f.project, pair, [pair]); f.commit('confirmed');
  f.write('en.md', f.project.read('en.md') + '\n## Extra\n\nNew section.\n');
  assert.throws(() => briefPair(f.project, pair, {}), /heading|align|structure/i);
});

test('generated regions and fenced blocks may grow without changing confirmation', t => {
  const f = fixture(t, '# Guide\n\nText.\n\n```js\na()\n```\n\n<!-- doc-maintenance:generated:start data -->\n1\n<!-- doc-maintenance:generated:end data -->\n', '# 指南\n\nText.\n\n```js\na()\n```\n\n<!-- doc-maintenance:generated:start data -->\n1\n<!-- doc-maintenance:generated:end data -->\n');
  confirmPair(f.project, pair, [pair]);
  for (const file of ['en.md', 'zh.md']) f.write(file, f.project.read(file).replace('a()', 'a()\nb()').replace('\n1\n', '\n1\n2\n3\n'));
  assert.deepEqual(checkPair(f.project, pair, [pair]), []);
});

test('localized links resolve URI-encoded filenames and root-relative destinations before parity', t => {
  const f = fixture(t);
  const nested = { source: 'manual/en.md', target: 'manual/zh.md', record: 'manual/pair.yml' };
  const other = { source: 'docs/English Guide.md', target: 'docs/中文 指南.md', record: 'docs/pair.yml' };
  f.write(nested.source, '# Guide\n\n[Other](/docs/English%20Guide.md?mode=1#same)\n');
  f.write(nested.target, '# 指南\n\n[其他](/docs/%E4%B8%AD%E6%96%87%20%E6%8C%87%E5%8D%97.md?mode=1#same)\n');
  assert.deepEqual(validatePair(f.project, nested, [nested, other]), []);
  confirmPair(f.project, nested, [nested, other]);
  assert.deepEqual(checkPair(f.project, nested, [nested, other]), []);
  // The wrong locale remains wrong even when its URI spelling differs.
  f.write(nested.target, '# 指南\n\n[其他](/docs/English%20Guide.md?mode=1#same)\n');
  assert.ok(codes(validatePair(f.project, nested, [nested, other])).includes('pair-links'));
});

test('encoded project escapes are reported as parity diagnostics', t => {
  const f = fixture(t, '# Guide\n\n[Bad](%2E%2E/outside.md)\n', '# 指南\n\n[坏](%2E%2E/outside.md)\n');
  assert.ok(codes(validatePair(f.project, pair, [pair])).includes('pair-links'));
});

test('confirmation preserves the last record when its directory cannot accept an atomic replacement', { skip: process.getuid?.() === 0 }, t => {
  const f = fixture(t); confirmPair(f.project, pair, [pair]);
  const before = f.project.read('pair.yml');
  f.write('en.md', f.project.read('en.md').replace('Hello.', 'Reviewed update.'));
  fs.chmodSync(f.root, 0o555);
  try {
    assert.throws(() => confirmPair(f.project, pair, [pair]), /EACCES|EPERM|permission/i);
    assert.equal(f.project.read('pair.yml'), before);
    assert.deepEqual(fs.readdirSync(f.root).sort(), ['en.md', 'pair.yml', 'zh.md']);
  } finally { fs.chmodSync(f.root, 0o755); }
});

test('preamble stays protected when the first heading contains only punctuation', t => {
  const make = (preamble, heading, extra = '') => `${preamble}\n\n\`\`\`text\nshared code\n${extra}\`\`\`\n\n<!-- doc-maintenance:generated:start data -->\nshared data${extra}\n<!-- doc-maintenance:generated:end data -->\n\n# ${heading}\n\nBody.\n`;
  const f = fixture(t, make('Initial preamble.', '!!!'), make('初始前言。', '???'));
  confirmPair(f.project, pair, [pair]);
  assert.deepEqual(checkPair(f.project, pair, [pair]), []);
  // Independently validated shared blocks remain exempt, even in the preamble.
  f.write('en.md', make('Initial preamble.', '!!!', 'more\n'));
  f.write('zh.md', make('初始前言。', '???', 'more\n'));
  assert.deepEqual(checkPair(f.project, pair, [pair]), []);
  f.write('en.md', make('Changed preamble.', '!!!', 'more\n'));
  assert.ok(codes(checkPair(f.project, pair, [pair])).includes('pair-stale'));
});

test('frontmatter retains YAML numeric types and distinguishes prose strings from mappings', t => {
  const make = value => `---\nvalue: ${value}\n---\n# Guide\n`;
  for (const [left, right] of [['.nan', 'null'], ['.inf', 'null'], ['.nan', '.inf']]) {
    const f = fixture(t, make(left), make(right));
    assert.ok(codes(validatePair(f.project, pair, [pair])).includes('pair-frontmatter'), `${left} and ${right} must differ`);
    assert.throws(() => confirmPair(f.project, pair, [pair]), /Frontmatter/);
  }
  const matching = fixture(t, make('.nan'), make('.nan'));
  assert.deepEqual(validatePair(matching.project, pair, [pair]), []);
  const collision = fixture(t, '---\ntitle: Guide\n---\n# Guide\n', '---\ntitle:\n  localized: string\n---\n# 指南\n');
  assert.ok(codes(validatePair(collision.project, pair, [pair])).includes('pair-frontmatter'));
});

test('automatic brief uses the newest confirmed snapshot after shared code changes', t => {
  const make = (heading, code) => `# ${heading}\n\nOriginal prose.\n\n\`\`\`js\n${code}\n\`\`\`\n`;
  const f = fixture(t, make('Guide', 'a()'), make('指南', 'a()'));
  f.git(['init', '-q']); confirmPair(f.project, pair, [pair]); f.commit('original confirmation');
  f.write('en.md', make('Guide', 'b()')); f.write('zh.md', make('指南', 'b()'));
  assert.equal(confirmPair(f.project, pair, [pair]).changed, false);
  f.commit('shared code update with unchanged confirmation');
  const updated = f.git(['rev-parse', 'HEAD']).trim();
  f.write('en.md', f.project.read('en.md').replace('Original prose.', 'New prose.'));
  const automatic = briefPair(f.project, pair, {}), explicit = briefPair(f.project, pair, { base: 'HEAD' });
  assert.equal(automatic.base, updated);
  assert.deepEqual(automatic.sections, explicit.sections);
  assert.match(automatic.sections[0].source.before, /b\(\)/);
  // A newer unrelated commit is also a valid snapshot of the same confirmed pair.
  f.write('other.txt', 'Unrelated work.\n');
  f.git(['add', '--', 'other.txt']);
  f.git(['-c', 'user.name=Pair Test', '-c', 'user.email=pair@example.invalid', 'commit', '-qm', 'unrelated work']);
  assert.equal(briefPair(f.project, pair, {}).base, f.git(['rev-parse', 'HEAD']).trim());
});
