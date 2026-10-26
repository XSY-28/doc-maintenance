import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = JSON.parse(readFileSync(new URL('settings.json', import.meta.url), 'utf8'));
const cell = value => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const table = ['# Configuration reference', '', '| Setting | Default | Description |', '| --- | --- | --- |',
  ...Object.entries(source).map(([key, value]) => `| ${cell(key)} | ${cell(value.default)} | ${cell(value.description)} |`), '',
].join('\n');
const target = new URL('reference.md', import.meta.url);
if (process.argv[2] === '--write') {
  writeFileSync(target, table);
  console.log(`Generated ${fileURLToPath(target)}`);
} else if (process.argv[2] === 'check') {
  if (readFileSync(target, 'utf8') !== table) {
    console.error('reference.md is stale. Update settings.json, then run node project-check.mjs --write.');
    process.exitCode = 1;
  } else console.log('reference.md matches settings.json');
} else {
  console.error('Usage: node project-check.mjs check|--write');
  process.exitCode = 2;
}
