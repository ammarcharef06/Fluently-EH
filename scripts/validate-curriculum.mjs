import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const directory = resolve('packages/curriculum/src/drafts');
const files = (await readdir(directory)).filter((name) => name.endsWith('.json'));
const ids = new Set();
const errors = [];
for (const file of files) {
  const entry = JSON.parse(await readFile(join(directory, file), 'utf8'));
  if (ids.has(entry.id)) errors.push('Duplicate lesson ID: ' + entry.id);
  ids.add(entry.id);
  if (entry.status !== 'draft') errors.push(file + ': draft directory may contain drafts only.');
  const text = JSON.stringify(entry);
  if (/\bIPA\b|\/[a-z]{1,3}\//i.test(text)) errors.push(file + ': forbidden phonetic notation marker detected.');
  if (!entry.source?.note || !entry.source?.license) errors.push(file + ': source and rights fields are required.');
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('Validated ' + files.length + ' draft lesson(s). None are eligible for publication without human approval.');
