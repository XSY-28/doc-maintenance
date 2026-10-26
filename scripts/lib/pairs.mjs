import { createHash, randomUUID } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument as parseYamlDocument } from 'yaml';
import { parseMarkdown } from './markdown.mjs';
import { createProject } from './project.mjs';
import { resolveLink } from './checks.mjs';

const same = isDeepStrictEqual;
const digest = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const diagnostic = (code, path, message, line) => ({ code, path, ...(line ? { line } : {}), message });
const proseKeys = new Set(['title', 'description', 'summary', 'abstract']);

// Frontmatter is data: only explicitly prose-valued properties may be translated.
function metadataEqual(left, right, key = '', seen = new Map()) {
  if (same(left, right)) return true;
  if (typeof left === 'string' && typeof right === 'string' && proseKeys.has(key)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right) || Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
  if (!Array.isArray(left) && ![Object.prototype, null].includes(Object.getPrototypeOf(left))) return false;
  const keys = Object.keys(left).sort();
  if (!same(keys, Object.keys(right).sort())) return false;
  if (seen.get(left)?.has(right)) return true;
  if (!seen.has(left)) seen.set(left, new WeakSet());
  seen.get(left).add(right);
  return keys.every(k => metadataEqual(left[k], right[k], Array.isArray(left) ? key : k, seen));
}

function readDocument(project, path) {
  const text = project.read(path).replace(/\r\n/g, '\n');
  const raw = parseMarkdown(text), lines = text.split('\n');
  const codeLines = new Set();
  for (const token of raw.tokens) if (['fence', 'code_block'].includes(token.type) && token.map) {
    for (let i = token.map[0]; i < token.map[1]; i++) codeLines.add(i);
  }
  const regions = [], ids = new Set();
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    if (codeLines.has(i)) continue;
    const marker = /^\s*<!-- doc-maintenance:generated:(start|end) ([A-Za-z0-9_.-]+) -->\s*$/.exec(lines[i]);
    if (!marker) {
      if (lines[i].includes('<!-- doc-maintenance:generated:')) throw new Error(`Malformed generated marker at line ${i + 1}`);
      continue;
    }
    if (marker[1] === 'start') {
      if (open || ids.has(marker[2])) throw new Error(`Nested or duplicate generated region at line ${i + 1}`);
      ids.add(marker[2]); open = { id: marker[2], start: i };
    } else {
      if (!open || open.id !== marker[2]) throw new Error(`Unmatched generated end at line ${i + 1}`);
      regions.push({ ...open, end: i + 1, text: lines.slice(open.start, i + 1).join('\n') }); open = null;
    }
  }
  if (open) throw new Error(`Unterminated generated region ${open.id} at line ${open.start + 1}`);
  const masked = [...lines];
  for (const region of regions) for (let i = region.start; i < region.end; i++) masked[i] = '';
  const parsed = parseMarkdown(masked.join('\n'));
  const excluded = [...regions];
  for (const token of parsed.tokens) if (['fence', 'code_block'].includes(token.type) && token.map) excluded.push({ start: token.map[0], end: token.map[1] });
  const sections = parsed.sections.map((section, index) => {
    const start = index === 0 ? 0 : section.line - 1;
    const end = parsed.sections[index + 1] ? parsed.sections[index + 1].line - 1 : lines.length;
    // Remove the complete line spans, rather than replacing with blank lines: code
    // may grow without turning a semantically unchanged section into stale prose.
    const kept = lines.slice(start, end).filter((_, i) => !excluded.some(span => start + i >= span.start && start + i < span.end));
    return { ...section, text: lines.slice(start, end).join('\n'), hash: digest(kept.join('\n')) };
  });
  return { ...parsed, sections, regions };
}

function documents(project, pair) {
  return [readDocument(project, pair.source), readDocument(project, pair.target)];
}

function normalizeLink(link, owner, locale, pairs) {
  const target = link.target;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return ['external', target, link.image];
  const split = target.search(/[?#]/), suffix = split < 0 ? '' : target.slice(split);
  // Share the core resolver for percent decoding, repo-root paths, and escape
  // rejection. The untranslated raw suffix remains exact for pair parity.
  const resolved = resolveLink(owner, target).path;
  for (const [index, pair] of pairs.entries()) {
    if (resolved !== pair.source && resolved !== pair.target) continue;
    // Links to the other language of the current document are explicit switchers.
    if (pair[locale] === owner && resolved === pair[locale === 'source' ? 'target' : 'source']) return ['switcher', index, suffix, link.image];
    if (resolved !== pair[locale]) return ['wrong-locale', resolved, suffix, link.image];
    return ['pair', index, suffix, link.image];
  }
  return ['local', resolved, suffix, link.image];
}

/** Deterministic parity only; a successful check is never a translation review. */
export function validatePair(project, pair, pairs = [pair]) {
  const errors = [];
  for (const name of ['source', 'target']) {
    try { if (!project.exists(pair[name])) errors.push(diagnostic('pair-file-missing', pair[name], `Missing ${name} Markdown in ${project.mode}`)); }
    catch (e) { errors.push(diagnostic('pair-file-invalid', pair[name], e.message)); }
  }
  if (errors.length) return errors;
  let source, target;
  try { [source, target] = documents(project, pair); }
  catch (e) { return [diagnostic('pair-parse', pair.source, `Cannot validate pair: ${e.message}`)]; }
  for (const [path, doc] of [[pair.source, source], [pair.target, target]]) {
    for (const error of doc.unsupported ?? []) errors.push(diagnostic('pair-unsupported', path, error.message, error.line));
  }
  if (!same(source.structure, target.structure)) errors.push(diagnostic('pair-structure', pair.target, 'Heading depths, list layout, table layout, and code must agree with the source'));
  if (!same(source.inlineCode, target.inlineCode)) errors.push(diagnostic('pair-identifiers', pair.target, 'Inline code identifiers differ from the source'));
  if (!metadataEqual(source.frontmatter, target.frontmatter)) errors.push(diagnostic('pair-frontmatter', pair.target, 'Frontmatter keys, data shape, and identifiers differ; only title/description/summary/abstract string values are localizable'));
  if (!same(source.regions.map(r => [r.id, r.text]), target.regions.map(r => [r.id, r.text]))) errors.push(diagnostic('pair-generated', pair.target, 'Generated region IDs, order, and contents must match exactly'));
  try {
    const left = source.links.map(link => normalizeLink(link, pair.source, 'source', pairs));
    const right = target.links.map(link => normalizeLink(link, pair.target, 'target', pairs));
    if (!same(left, right)) errors.push(diagnostic('pair-links', pair.target, 'Links must preserve destinations, query strings, fragments, order, and locale siblings; links to the paired language are allowed switchers'));
  } catch (e) { errors.push(diagnostic('pair-links', pair.target, `Cannot resolve pair links: ${e.message}`)); }
  return errors;
}

function recordData(project, pair) {
  const [source, target] = documents(project, pair);
  if (source.sections.length !== target.sections.length) throw new Error('Pair sections cannot be aligned; repair heading structure before confirmation');
  const sections = {};
  for (const [name, doc] of [['source', source], ['target', target]]) {
    const keys = new Set();
    for (const section of doc.sections) {
      if (keys.has(section.key)) throw new Error(`Duplicate ${name} section key ${JSON.stringify(section.key)} in ${pair[name]}; heading identity collides with another section. Repair the heading keys before confirming; no record can safely represent both sections`);
      keys.add(section.key);
    }
  }
  for (let i = 0; i < source.sections.length; i++) sections[source.sections[i].key] = { source: source.sections[i].hash, target: target.sections[i].hash };
  return { format: 'doc-maintenance-pair', version: 1, source: pair.source, target: pair.target, sections };
}

function renderRecord(data) {
  const lines = ['format: doc-maintenance-pair', 'version: 1', `source: ${JSON.stringify(data.source)}`, `target: ${JSON.stringify(data.target)}`, 'sections:'];
  for (const [key, hashes] of Object.entries(data.sections)) {
    lines.push(`  ${JSON.stringify(key)}:`, `    source: ${JSON.stringify(hashes.source)}`, `    target: ${JSON.stringify(hashes.target)}`, '');
  }
  return lines.join('\n');
}

export function computeRecord(project, pair) { return renderRecord(recordData(project, pair)); }

function parseRecord(text, pair) {
  const yaml = parseYamlDocument(text, { uniqueKeys: true });
  if (yaml.errors.length) throw new Error(yaml.errors[0].message);
  const data = yaml.toJS({ maxAliasCount: 0 });
  if (!data || typeof data !== 'object' || Array.isArray(data) || !same(Object.keys(data).sort(), ['format', 'version', 'source', 'target', 'sections'].sort()) || data.format !== 'doc-maintenance-pair' || data.version !== 1 || data.source !== pair.source || data.target !== pair.target || !data.sections || typeof data.sections !== 'object' || Array.isArray(data.sections)) throw new Error('Record format, version, or pair identity is invalid');
  for (const [key, entry] of Object.entries(data.sections)) {
    if (!key.startsWith('/') || !entry || typeof entry !== 'object' || !same(Object.keys(entry).sort(), ['source', 'target']) || !['source', 'target'].every(k => /^sha256:[a-f0-9]{64}$/.test(entry[k]))) throw new Error(`Invalid section entry: ${key}`);
  }
  return data;
}

export function checkPair(project, pair, pairs = [pair]) {
  const errors = validatePair(project, pair, pairs);
  try {
    if (!project.exists(pair.record)) { errors.push(diagnostic('pair-record-missing', pair.record, 'Confirmation record missing; review both languages and explicitly confirm this pair')); return errors; }
    const text = project.read(pair.record), record = parseRecord(text, pair);
    if (renderRecord(record) !== text) errors.push(diagnostic('pair-record-noncanonical', pair.record, 'Record is not canonical; explicitly confirm the reviewed pair'));
    if (!errors.some(e => ['pair-file-missing', 'pair-file-invalid', 'pair-parse'].includes(e.code)) && !same(record, recordData(project, pair))) errors.push(diagnostic('pair-stale', pair.record, 'Section content changed since confirmation; inspect brief, review both languages, then explicitly confirm'));
  } catch (e) { errors.push(diagnostic('pair-record-invalid', pair.record, `Cannot validate confirmation record: ${e.message}`)); }
  return errors;
}

export function confirmPair(project, pair, pairs = [pair]) {
  if (project.mode !== 'worktree') throw new Error('Confirmation requires the working tree, never staged inputs');
  const errors = validatePair(project, pair, pairs);
  if (errors.length) throw new Error(`Cannot confirm pair: ${errors.map(e => `${e.path}: ${e.message}`).join('; ')}`);
  const record = computeRecord(project, pair), changed = !project.exists(pair.record) || project.read(pair.record) !== record;
  if (changed) {
    const destination = (project.path ? project : createProject(project.root)).path(pair.record);
    let permissions = 0o666;
    if (project.exists(pair.record)) {
      const entry = lstatSync(destination);
      permissions = entry.mode & 0o777;
      if (entry.isSymbolicLink() || entry.nlink !== 1) throw new Error('Confirmation record must not be a symlink or hardlink alias to another document');
    }
    mkdirSync(dirname(destination), { recursive: true });
    // Revalidate ancestors after directory creation before the only intentional write.
    const safeDestination = (project.path ? project : createProject(project.root)).path(pair.record);
    const temporary = `${safeDestination}.${randomUUID()}.tmp`;
    let descriptor, created = false;
    try {
      descriptor = openSync(temporary, 'wx', permissions); created = true;
      writeFileSync(descriptor, record, 'utf8');
      closeSync(descriptor); descriptor = undefined;
      renameSync(temporary, safeDestination);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      if (created) {
        try { unlinkSync(temporary); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
    }
  }
  return { record: pair.record, changed };
}

function historicalProject(project, revision) {
  return { mode: 'history', read: path => project.git(['show', `${revision}:${path}`]), exists: path => { try { project.git(['cat-file', '-e', `${revision}:${path}`]); return true; } catch { return false; } } };
}

/** Recover only evidence-backed committed baselines; never manufacture old translations. */
export function briefPair(project, pair, { base } = {}) {
  if (project.mode !== 'worktree') throw new Error('Brief requires the working tree');
  if (!project.exists(pair.record)) throw new Error('Confirmation record missing; no confirmed baseline can be recovered');
  const currentRecord = project.read(pair.record);
  parseRecord(currentRecord, pair);
  let revisions;
  try {
    if (base) revisions = [project.git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim()];
    else {
      // HEAD may contain the latest valid snapshot even when the record did not
      // change (shared code updates or unrelated commits). Then inspect complete
      // path history so unconfirmed newer snapshots can fall back safely.
      const head = project.git(['rev-parse', '--verify', 'HEAD']).trim();
      const history = project.git(['log', '--full-history', '--topo-order', '--format=%H', '--', pair.source, pair.target, pair.record]).trim().split('\n').filter(Boolean);
      revisions = [...new Set([head, ...history])];
    }
  }
  catch (e) { throw new Error(`Cannot recover committed confirmation baseline: ${e.message}`); }
  let baseline, baselineRevision, missingHistory;
  for (const revision of revisions) {
    const historical = historicalProject(project, revision);
    let oldRecord;
    try { oldRecord = historical.read(pair.record); } catch { continue; }
    if (oldRecord !== currentRecord) continue;
    try {
      if (validatePair(historical, pair).some(error => error.code !== 'pair-links')) continue;
      if (computeRecord(historical, pair) !== currentRecord) continue;
      baseline = documents(historical, pair); baselineRevision = revision; break;
    } catch (e) { missingHistory = e.message; }
  }
  if (!baseline) throw new Error(`No confirmed committed baseline ${base ? `at ${base}` : 'matching the stored record'}; commit a reviewed pair and its record together, or provide a matching --base${missingHistory ? `. Historical source unavailable: ${missingHistory}` : ''}`);
  const current = documents(project, pair);
  if (!same(current[0].headings.map(h => h.level), current[1].headings.map(h => h.level))) throw new Error('Cannot align current sections: repair matching heading depths in both languages before requesting a brief');
  const oldSource = new Map(baseline[0].sections.map((section, i) => [section.key, { source: section, target: baseline[1].sections[i] }]));
  const newSource = new Map(current[0].sections.map((section, i) => [section.key, { source: section, target: current[1].sections[i] }]));
  const sections = [];
  for (const key of new Set([...oldSource.keys(), ...newSource.keys()])) {
    const before = oldSource.get(key), after = newSource.get(key);
    const source = { before: before?.source?.text ?? null, after: after?.source?.text ?? null, changed: before?.source?.hash !== after?.source?.hash };
    const target = { before: before?.target?.text ?? null, after: after?.target?.text ?? null, changed: before?.target?.hash !== after?.target?.hash };
    if (source.changed || target.changed) sections.push({ key, source, target, bothChanged: source.changed && target.changed });
  }
  return { pair: { ...pair }, base: baselineRevision, sections, notes: ['Before/after text comes from committed confirmation history. Changed hashes are review cues, not a semantic translation judgment.'] };
}
