import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commands = [
  { name: 'api', args: ['run', 'dev:api'] },
  { name: 'web', args: ['run', 'dev:web'] }
];
const children = [];
let shuttingDown = false;

function stopAll(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 500).unref();
}

for (const command of commands) {
  const child = spawn(npm, command.args, {
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' }
  });
  children.push(child);
  child.on('error', (error) => {
    process.stderr.write('[' + command.name + '] ' + error.message + '\n');
    stopAll(1);
  });
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) stopAll(code ?? 1);
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
