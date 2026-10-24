const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../domain/web-charge-url.ts');
function load(configured) {
  const previous = process.env.NEXT_PUBLIC_WEB_CHARGE_ORIGIN;
  if (configured === undefined) delete process.env.NEXT_PUBLIC_WEB_CHARGE_ORIGIN;
  else process.env.NEXT_PUBLIC_WEB_CHARGE_ORIGIN = configured;
  const mod = new Module(filename, module);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  if (previous === undefined) delete process.env.NEXT_PUBLIC_WEB_CHARGE_ORIGIN;
  else process.env.NEXT_PUBLIC_WEB_CHARGE_ORIGIN = previous;
  return mod.exports;
}

test('configured phone-accessible origin is preferred and tokens are encoded', () => {
  const { webChargeUrl } = load('http://192.168.15.2:3010/');
  assert.equal(webChargeUrl('token/76', 'http://127.0.0.1:3010'),
    'http://192.168.15.2:3010/charge/token%2F76');
});

test('browser origin is a safe fallback and invalid schemes are ignored', () => {
  assert.equal(load(undefined).webChargeUrl('abc', 'http://127.0.0.1:3010'),
    'http://127.0.0.1:3010/charge/abc');
  assert.equal(load('javascript:alert(1)').webChargeUrl('abc'), '/charge/abc');
});
