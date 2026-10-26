import MarkdownIt from 'markdown-it';
import GithubSlugger from 'github-slugger';
import { parse as parseYaml } from 'yaml';

const parser = new MarkdownIt({ html: true, linkify: false });
// Inspect explicit unresolved references before tokenization discards escapes and
// splits formatted labels. The parser's label helper honors nesting and escapes.
parser.inline.ruler.before('link', 'undefined_reference', (state, silent) => {
  const start = state.pos, image = state.src[start] === '!' && state.src[start + 1] === '[';
  const labelStart = image ? start + 1 : start;
  if (state.src[labelStart] !== '[') return false;
  const labelEnd = state.md.helpers.parseLinkLabel(state, labelStart, true);
  if (labelEnd < 0 || state.src[labelEnd + 1] !== '[') return false;
  const refEnd = state.md.helpers.parseLinkLabel(state, labelEnd + 1, false);
  if (refEnd < 0) return false;
  const label = state.src.slice(labelEnd + 2, refEnd) || state.src.slice(labelStart + 1, labelEnd);
  if (state.env.references?.[state.md.utils.normalizeReference(label)]) return false;
  if (!silent) {
    const token = state.push('undefined_reference', '', 0);
    token.content = state.src.slice(start, refEnd + 1);
    token.meta = { offset: start };
  }
  state.pos = refEnd + 1;
  return true;
});
const plain = tokens => tokens.map(t => ['text', 'code_inline', 'image'].includes(t.type) ? t.content : ['softbreak', 'hardbreak'].includes(t.type) ? ' ' : '').join('');
const unescapeHtml = value => parser.utils.unescapeAll(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Parse a GitHub-flavored Markdown subset using tokens rather than regexing prose/code alike. */
export function parseMarkdown(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  let offset = 0, frontmatter = null;
  if (lines[0] === '---') {
    const end = lines.findIndex((line, i) => i > 0 && ['---', '...'].includes(line));
    if (end < 0) throw new Error('Unterminated YAML frontmatter');
    frontmatter = parseYaml(lines.slice(1, end).join('\n'));
    if (frontmatter !== null && (typeof frontmatter !== 'object' || Array.isArray(frontmatter))) throw new Error('YAML frontmatter must be a mapping');
    offset = end + 1;
  }
  const env = {};
  const tokens = parser.parse(lines.slice(offset).join('\n'), env);
  for (const token of tokens) if (token.map) token.map = token.map.map(n => n + offset);
  const headings = [], links = [], anchors = new Set(), structure = [], inlineCode = [], unsupported = [];
  const slugger = new GithubSlugger();
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], line = (token.map?.[0] ?? 0) + 1;
    if (token.type === 'heading_open') {
      const value = plain(tokens[i + 1]?.children ?? []), slug = slugger.slug(value), level = Number(token.tag.slice(1));
      anchors.add(slug);
      while (stack.length && stack.at(-1).level >= level) stack.pop();
      // The heading namespace cannot collide with the '/' preamble, even when
      // a punctuation-only heading produces an empty GitHub slug.
      const key = '/heading/' + [...stack.map(h => h.slug), slug].map(s => s.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
      const heading = { level, text: value, slug, line, key };
      stack.push(heading); headings.push(heading);
    }
    if (['fence', 'code_block'].includes(token.type)) structure.push([token.type, token.info.trim(), token.content]);
    else if (token.type === 'heading_open') structure.push(['heading', token.tag]);
    else if (/^(bullet_list|ordered_list|list_item|table|thead|tbody|tr|th|td)_(open|close)$/.test(token.type)) {
      structure.push([token.type, token.type === 'ordered_list_open' ? (token.attrGet('start') ?? '1') : null]);
    }
    if (token.type === 'inline') {
      let lineOffset = 0;
      for (const child of token.children ?? []) {
        if (child.type === 'link_open') links.push({ target: child.attrGet('href'), line: line + lineOffset, image: false });
        if (child.type === 'image') links.push({ target: child.attrGet('src'), line: line + lineOffset, image: true });
        if (child.type === 'code_inline') inlineCode.push(child.content);
        if (child.type === 'html_inline') inspectHtml(child.content, line + lineOffset);
        if (['softbreak', 'hardbreak'].includes(child.type)) lineOffset++;
        if (child.type === 'undefined_reference') unsupported.push({ code: 'REFERENCE_UNDEFINED', line: line + token.content.slice(0, child.meta.offset).split('\n').length - 1, message: `Undefined reference link: ${child.content}` });
      }
    }
    if (token.type === 'html_block') inspectHtml(token.content, line);
  }
  function inspectHtml(html, line) {
    // Only actual tags, never comment bodies. HTML link targets are not fetched.
    const masked = html.replace(/<!--[\s\S]*?-->/g, comment => comment.replace(/[^\n]/g, ' '));
    for (const tag of masked.matchAll(/<([a-z][\w-]*)\b((?:"[^"]*"|'[^']*'|[^<>"'])*)>/gi)) {
      const tagLine = line + masked.slice(0, tag.index).split('\n').length - 1;
      const attrs = new Map();
      for (const a of tag[2].matchAll(/\b([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) attrs.set(a[1].toLowerCase(), unescapeHtml(a[2] ?? a[3] ?? a[4]));
      if (attrs.has('id')) anchors.add(attrs.get('id'));
      if (tag[1].toLowerCase() === 'a' && attrs.has('name')) anchors.add(attrs.get('name'));
      for (const attr of ['href', 'xlink:href', 'src', 'poster', ...(tag[1].toLowerCase() === 'object' ? ['data'] : [])]) {
        if (attrs.has(attr)) links.push({ target: attrs.get(attr), line: tagLine, image: !['href', 'xlink:href'].includes(attr) });
      }
      if (attrs.has('srcset')) unsupported.push({ code: 'HTML_SRCSET_UNCHECKED', line: tagLine, message: 'HTML srcset needs the project HTML/site validator; responsive image candidates were not checked' });
    }
  }
  const starts = [{ key: '/', heading: null, line: 1, start: 0 }, ...headings.map(h => ({ key: h.key, heading: h.text, line: h.line, start: h.line - 1 }))];
  const sections = starts.map((s, i) => ({ key: s.key, heading: s.heading, line: s.line, text: lines.slice(s.start, starts[i + 1]?.start ?? lines.length).join('\n') }));
  return { tokens, headings, links, anchors, sections, structure, inlineCode, frontmatter, unsupported };
}
