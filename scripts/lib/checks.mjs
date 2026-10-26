import { posix } from 'node:path';
import { parseMarkdown } from './markdown.mjs';
import { documentPaths } from './project.mjs';

export function resolveLink(from, target) {
  if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) return null;
  const hash = target.indexOf('#');
  const beforeHash = hash < 0 ? target : target.slice(0, hash);
  const fragment = hash < 0 ? null : decodeURIComponent(target.slice(hash + 1));
  const raw = decodeURIComponent(beforeHash.split('?')[0]);
  const path = !raw ? from : raw.startsWith('/') ? posix.normalize(raw.slice(1)) : posix.normalize(posix.join(posix.dirname(from), raw));
  if (path === '..' || path.startsWith('../') || path.includes('\\') || path.includes('\0')) throw new Error(`Link leaves project: ${target}`);
  return { path, fragment };
}

/** Full inbound-link scan even for selected paths: deleted targets must not hide their callers. */
export function checkDocuments(project, config, selected = null) {
  const files = documentPaths(project, config), errors = [], parsed = new Map();
  const get = path => {
    if (!parsed.has(path)) parsed.set(path, parseMarkdown(project.read(path)));
    return parsed.get(path);
  };
  for (const path of files) {
    let doc;
    try { doc = get(path); } catch (e) {
      if (!selected || selected.has(path)) errors.push({ code: 'MARKDOWN_READ', path, message: e.message });
      continue;
    }
    if (!selected || selected.has(path)) for (const issue of doc.unsupported) errors.push({ ...issue, path });
    for (const link of doc.links) {
      let resolved;
      try { resolved = resolveLink(path, link.target); } catch (e) {
        if (!selected || selected.has(path)) errors.push({ code: 'LINK_OUTSIDE', path, line: link.line, message: e.message });
        continue;
      }
      if (!resolved) continue;
      const indexes = ['README.md', 'index.md'].map(name => posix.join(resolved.path, name));
      if (selected && !selected.has(path) && !selected.has(resolved.path) && !indexes.some(p => selected.has(p))) continue;
      const { fragment } = resolved;
      let target = resolved.path;
      try {
        if (!project.exists(target)) {
          errors.push({ code: 'LINK_MISSING', path, line: link.line, message: `Target does not exist in ${project.mode}: ${target}` });
          continue;
        }
        if (fragment && !link.image) {
          if (project.isDirectory(target)) {
            const index = indexes.find(p => project.exists(p));
            if (index) target = index;
            else {
              errors.push({ code: 'LINK_ANCHOR', path, line: link.line, message: `No Markdown index in ${target} provides #${fragment}` });
              continue;
            }
          }
          if (!/\.md$/i.test(target)) continue; // non-Markdown formats require their owning validators
          if (!get(target).anchors.has(fragment)) errors.push({ code: 'LINK_ANCHOR', path, line: link.line, message: `Missing heading/anchor #${fragment} in ${target}` });
        }
      } catch (e) { errors.push({ code: /outside|symlink|regular file/i.test(e.message) ? 'LINK_OUTSIDE' : 'LINK_READ', path, line: link.line, message: e.message }); }
    }
  }
  for (const budget of config.budgets) {
    if (selected && !selected.has(budget.path)) continue;
    try {
      if (!project.exists(budget.path)) {
        errors.push({ code: 'BUDGET_MISSING', path: budget.path, message: 'Budgeted file is missing; repair the path or update the budget in the same change' });
        continue;
      }
      const text = project.read(budget.path);
      const used = budget.unit === 'words' ? text.split(/\s+/u).filter(Boolean).length : [...text.replace(/\s/gu, '')].length;
      if (used > budget.limit) errors.push({ code: 'BUDGET_EXCEEDED', path: budget.path, message: `${used} ${budget.unit} exceeds ${budget.limit}; relocate misplaced detail, remove repetition, or justify a higher budget` });
    } catch (e) { errors.push({ code: 'BUDGET_READ', path: budget.path, message: e.message }); }
  }
  return { filesChecked: files.length, errors };
}
