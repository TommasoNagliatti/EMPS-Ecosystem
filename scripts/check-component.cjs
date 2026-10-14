const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const component = process.argv[2];
let result;
if (component === 'api') {
  // Never inherit the official connection or write-enabled integration-test flags.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(EMPS_REMOTE_|EMPS_LOCAL_GIE_|STRIPE_|OCPP_|GIE_SERVICE_|PREPAID_LIFECYCLE_STATION_IDS$)/.test(key)) delete env[key];
  }
  Object.assign(env, {
    DATABASE_URL: 'mysql://unit:unit@127.0.0.1:1/unit_tests_not_a_database',
    NODE_ENV: 'test',
    EMPS_V2_MYSQL_TEST: 'false',
    EMPS_REMOTE_DEVELOPMENT: 'false',
    EMPS_LOCAL_GIE_DEMO: 'false',
    STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', STRIPE_PUBLISHABLE_KEY: '',
    OCPP_GATEWAY_URL: '', OCPP_GATEWAY_TOKEN: '', GIE_SERVICE_URL: '', GIE_SERVICE_TOKEN: '',
    JWT_SECRET: 'unit-test-placeholder-never-use-in-a-running-server',
  });
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !path.isAbsolute(npmCli) || !fs.existsSync(npmCli)) {
    throw new Error('Execute npm run check:api a partir da raiz.');
  }
  result = spawnSync(process.execPath, [npmCli, 'run', 'check'], {
    cwd: path.join(root, 'site/emps-site-main/backend'), env,
    stdio: 'inherit', windowsHide: true,
  });
} else if (component === 'gie') {
  const gie = path.join(root, 'gie/GIE');
  const python = path.join(gie, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(python)) throw new Error('Crie a .venv do GIE com requirements-test.txt antes de verificar.');
  const env = { ...process.env, PYTHONPATH: `${gie}${path.delimiter}${path.join(gie, 'src')}`, PYTHONDONTWRITEBYTECODE: '1' };
  for (const key of Object.keys(env)) {
    if (/^(DATABASE_URL|JWT_SECRET|EMPS_REMOTE_|EMPS_LOCAL_GIE_|STRIPE_|OCPP_|GIE_SERVICE_)/.test(key)) delete env[key];
  }
  result = spawnSync(python, ['-m', 'pytest', 'tests/service'], { cwd: gie, env, stdio: 'inherit', windowsHide: true });
} else {
  throw new Error('Use api ou gie; comandos arbitrarios nao sao aceitos.');
}
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
