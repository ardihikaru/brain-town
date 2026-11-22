#!/usr/bin/env node
/**
 * Test catalog checker / reporter.
 *   node scripts/test-catalog.mjs          print coverage per epic
 *   node scripts/test-catalog.mjs --check  also validate rows; exit 1 on problems
 *   node scripts/test-catalog.mjs --write  refresh the coverage block in docs/test-catalog/README.md
 *
 * Reads every docs/test-catalog/*.md except README.md and files starting with "_".
 * A case row starts with a checkbox: | ☐ | TC-AUTH-001 | US-AUTH-01 | scenario | + | API | P0 | planned | `spec path` |
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'docs/test-catalog');
const readme = path.join(dir, 'README.md');

const STATUSES = ['planned', 'automated', 'blocked', 'manual-only', 'wont'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const LEVELS = ['API', 'GQL', 'WEB', 'E2E'];
const POLARITIES = ['+', '-'];

const args = new Set(process.argv.slice(2));
const problems = [];

const epicFiles = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('_'))
  .sort();

/** @type {Map<string, string>} */
const seen = new Map();
const epics = [];

for (const file of epicFiles) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let positive = 0;
  let negative = 0;
  const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
  const title = (lines.find((l) => l.startsWith('# ')) ?? file).replace(/^#\s+/, '');

  for (const [i, line] of lines.entries()) {
    if (!/^\|\s*[☐☑]\s*\|/.test(line)) continue;
    const where = `${file}:${i + 1}`;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 9) {
      problems.push(`${where}: expected 9 columns, found ${cells.length}`);
      continue;
    }
    const [box, id, story, , polarity, level, priority, status, spec] = cells;

    if (!/^TC-[A-Z]+-\d{3}$/.test(id)) problems.push(`${where}: bad test case id "${id}"`);
    if (seen.has(id)) problems.push(`${where}: duplicate id ${id} (also in ${seen.get(id)})`);
    seen.set(id, where);
    if (!/^US-[A-Z]+-\d{2}$/.test(story)) problems.push(`${where}: ${id} has bad story id "${story}"`);
    if (!POLARITIES.includes(polarity)) problems.push(`${where}: ${id} polarity must be + or -`);
    if (!LEVELS.includes(level)) problems.push(`${where}: ${id} unknown level "${level}"`);
    if (!PRIORITIES.includes(priority)) problems.push(`${where}: ${id} unknown priority "${priority}"`);
    if (!STATUSES.includes(status)) {
      problems.push(`${where}: ${id} unknown status "${status}"`);
      continue;
    }
    if ((box === '☑') !== (status === 'automated')) {
      problems.push(`${where}: ${id} checkbox must be ☑ exactly when status is automated`);
    }
    if (status === 'automated') {
      const specPaths = [...spec.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      if (specPaths.length === 0) problems.push(`${where}: ${id} is automated but has no spec link`);
      for (const p of specPaths) {
        if (!fs.existsSync(path.join(root, p))) problems.push(`${where}: ${id} spec not found: ${p}`);
      }
    }
    counts[status] += 1;
    if (polarity === '+') positive += 1;
    else negative += 1;
  }
  epics.push({ file, title, counts, positive, negative });
}

const pct = (n, d) => (d === 0 ? '0%' : `${Math.round((n / d) * 100)}%`);
const total = (e) => Object.values(e.counts).reduce((a, b) => a + b, 0);

const header = `| Epic | Cases | + | - | automated | planned | blocked | manual-only | wont | Automated % |
| ---- | ----: | -: | -: | --------: | ------: | ------: | ----------: | ---: | ----------: |`;
const rows = epics.map(
  (e) =>
    `| [${e.title}](${e.file}) | ${total(e)} | ${e.positive} | ${e.negative} | ${e.counts.automated} | ${e.counts.planned} | ${e.counts.blocked} | ${e.counts['manual-only']} | ${e.counts.wont} | ${pct(e.counts.automated, total(e))} |`,
);
const sum = (key) => epics.reduce((a, e) => a + e.counts[key], 0);
const all = epics.reduce((a, e) => a + total(e), 0);
const totalRow = `| **Total** | ${all} | ${epics.reduce((a, e) => a + e.positive, 0)} | ${epics.reduce((a, e) => a + e.negative, 0)} | ${sum('automated')} | ${sum('planned')} | ${sum('blocked')} | ${sum('manual-only')} | ${sum('wont')} | ${pct(sum('automated'), all)} |`;
const table = [header, ...rows, totalRow].join('\n');

if (args.has('--write')) {
  const start = '<!-- coverage:start -->';
  const end = '<!-- coverage:end -->';
  const text = fs.readFileSync(readme, 'utf8');
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a === -1 || b === -1) {
    console.error(`Markers ${start} / ${end} not found in docs/test-catalog/README.md`);
    process.exit(1);
  }
  fs.writeFileSync(readme, `${text.slice(0, a + start.length)}\n\n${table}\n\n${text.slice(b)}`);
  console.log('Updated docs/test-catalog/README.md');
} else {
  console.log(table);
}

if (args.has('--check') || args.has('--write')) {
  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log('\nCatalog OK');
}
