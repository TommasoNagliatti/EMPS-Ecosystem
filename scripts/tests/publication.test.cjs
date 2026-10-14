const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('../check-publication.cjs');
const root = path.resolve(__dirname, '../..');
test('private config, dumps, logs and customer photos cannot be published', () => {
  for (const file of ['site/backend/.env.remote', 'a/private.key', 'reports/a.txt', 'output/private.jpg', 'a/backups/b.sql', 'a/station-photos/x.jpg']) {
    assert.ok(inspect(file, Buffer.from('')).length, file);
  }
});
test('sanitized examples and frozen GIE evidence are allowed', () => {
  for (const file of ['site/backend/.env.example', 'site/backend/.env.remote.example', 'gie/GIE/outputs/simulation/v1/run_24h/simulation.json']) {
    assert.deepEqual(inspect(file, Buffer.from('{}')), []);
  }
});
test('known secret formats are detected without printing their values', () => {
  const prefixes = ['gh' + 'p_', 'sk_' + 'test_', 'pk_' + 'live_', 'wh' + 'sec_'];
  for (const prefix of prefixes) assert.ok(inspect('fixture.txt', Buffer.from(prefix + 'a'.repeat(40))).length);
});
test('database publication is schema-only', () => {
  assert.ok(inspect('site/emps-site-main/database/fixture.sql', Buffer.from('INSERT INTO users VALUES (1);')).length);
  assert.deepEqual(inspect('site/emps-site-main/database/fixture.sql', Buffer.from('CREATE TABLE users(id INT);')), []);
});
test('source paths and component lockfiles are portable and present', () => {
  for (const file of ['site/emps-site-main/frontend/package-lock.json', 'site/emps-site-main/backend/package-lock.json', 'app/emps-charge/package-lock.json', 'gie/GIE/requirements-test.txt']) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'START_EMPS_V2.ps1'), 'utf8'), /C:\\goodwill_ai/);
  const checker = fs.readFileSync(path.join(root, 'scripts/check-component.cjs'), 'utf8');
  assert.match(checker, /EMPS_V2_MYSQL_TEST: 'false'/);
  assert.match(checker, /STRIPE_SECRET_KEY: ''/);
  assert.match(checker, /OCPP_GATEWAY_URL: ''/);
});
