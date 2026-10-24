const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const forbiddenPath = /(^|\/)(node_modules|\.venv[^/]*|\.next[^/]*|__pycache__|reports|backups|runtime_cache|station-photos)(\/|$)|(^|\/)\.env(?!\.(?:remote\.)?example$)(?:\.|$)|\.(pem|key|p12|pfx|dump|bak|log|tsbuildinfo)$|\.private\.|^(output|tmp)\//i;
const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['Stripe credential', /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{20,}\b|\bwhsec_[A-Za-z0-9]{25,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
];
function inspect(file, content) {
  const issues = [];
  if (forbiddenPath.test(file)) issues.push('private/generated path');
  if (content.includes(0)) return issues;
  const text = content.toString('utf8');
  for (const [label, pattern] of secretPatterns) if (pattern.test(text)) issues.push(label);
  if (file.startsWith('site/emps-site-main/database/') && file.endsWith('.sql') &&
      /^\s*(?:INSERT\s+INTO|REPLACE\s+INTO|CREATE\s+USER|ALTER\s+USER)\b/im.test(text)) {
    issues.push('SQL includes records or accounts; requires private review');
  }
  return issues;
}
function run() {
  const listing = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (listing.status !== 0) throw new Error('Nao foi possivel listar o conteudo Git.');
  const files = [...new Set(listing.stdout.split('\0').filter(Boolean))];
  const failures = [];
  for (const file of files) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    for (const issue of inspect(file, fs.readFileSync(absolute))) failures.push(`${file}: ${issue}`);
  }
  const required = ['README.md', 'STARTUP.md', 'docs/README.md', 'site/emps-site-main/backend/prisma/schema.prisma',
    'site/emps-site-main/frontend/package-lock.json', 'app/emps-charge/package-lock.json', 'gie/GIE/service/isolated_preview.py'];
  for (const file of required) if (!files.includes(file)) failures.push(`${file}: required source missing`);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log(`Publicacao verificada: ${files.length} arquivos; nenhum sinal bloqueante nas regras revisadas. A verificacao nao substitui uma auditoria de seguranca.`);
}
module.exports = { inspect };
if (require.main === module) run();
