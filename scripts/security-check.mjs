import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const forbidden = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /sk_live_[A-Za-z0-9]{16,}/,
  /AIza[0-9A-Za-z_-]{30,}/
];
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'coverage', 'h2a']);
const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.sql', '.toml', '.yml', '.yaml', '.html', '.css', '.rs']);
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (allowedExtensions.has(path.slice(path.lastIndexOf('.')))) files.push(path);
  }
}
await walk('.');
const matches = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  if (/\.env$/.test(file) && !file.endsWith('.env.example')) matches.push(file + ': environment file must not be committed.');
  if (/password\s*[:=]\s*["'][^"']{5,}["']/i.test(text) && !file.endsWith('0001_init.sql')) matches.push(file + ': possible hard-coded password.');
  for (const pattern of forbidden) if (pattern.test(text)) matches.push(file + ': possible secret pattern ' + pattern);
}
if (matches.length) { console.error(matches.join('\n')); process.exit(1); }
console.warn('Secret-pattern scan passed across ' + files.length + ' source/documentation files. This is not a substitute for provider-side secret scanning.');
