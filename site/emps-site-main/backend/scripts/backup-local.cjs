// Backup only: no migration, cleanup or database writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('Local database required');
const docker = [
  path.join(process.env.ProgramFiles, 'Docker/Docker/resources/bin/docker.exe'),
  path.join(process.env.LOCALAPPDATA, 'Programs/DockerDesktop/resources/bin/docker.exe'),
].find(fs.existsSync);
if (!docker) throw Error('Docker not found');
const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
const directory = path.join(root, '../database/backups');
fs.mkdirSync(directory, { recursive: true });
const file = path.join(directory, `before-presentation-${stamp}.sql`);
const fd = fs.openSync(file, 'wx');
let result;
try {
  result = spawnSync(docker, ['exec', '-e', 'MYSQL_PWD=' + decodeURIComponent(url.password),
    'emps-mysql', 'mysqldump', '--no-tablespaces', '--single-transaction', '--quick',
    '--hex-blob', '--set-gtid-purged=OFF', '-u', decodeURIComponent(url.username), url.pathname.slice(1)],
  { windowsHide: true, stdio: ['ignore', fd, 'pipe'] });
} finally { fs.closeSync(fd); }
if (result.status !== 0) throw Error('Backup failed; database unchanged');
const bytes = fs.readFileSync(file);
if (bytes.length < 1000 || !bytes.toString().includes('-- Dump completed on')) throw Error('Incomplete backup');
console.log(JSON.stringify({ file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }));
