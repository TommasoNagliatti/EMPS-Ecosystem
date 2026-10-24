const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const file = path.resolve(__dirname, '../domain/request-id.ts');
const mod = new Module(file, module);
mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, file);
test('HTTP LAN request keys use cryptographic bytes without requiring randomUUID', () => {
  const id = mod.exports.requestId({ getRandomValues(bytes) { bytes.fill(255); return bytes; } });
  assert.equal(id, 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  const ids = new Set(Array.from({ length: 100 }, () => mod.exports.requestId()));
  assert.equal(ids.size, 100);
});
