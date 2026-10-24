import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chargingDebtQuote, idleDebtAmount } from '../src/idle-debt-policy';

const stopped = new Date('2026-10-21T03:00:00Z');
const at = (seconds: number) => new Date(stopped.getTime() + seconds * 1000);
test('ten-minute grace is free, then R$2.50 per minute with no cap', () => {
  assert.equal(idleDebtAmount(stopped, at(599)).amount, '0.00');
  assert.equal(idleDebtAmount(stopped, at(600)).amount, '0.00');
  assert.equal(idleDebtAmount(stopped, at(660)).amount, '2.50');
  assert.equal(idleDebtAmount(stopped, at(630)).amount, '1.25');
  assert.equal(idleDebtAmount(stopped, at(600 + 24 * 3600)).amount, '3600.00');
});
test('debt is added on top, preserving the energy budget', () => {
  assert.deepEqual(chargingDebtQuote('20', '7.50'), { energyBudget: '20.00', outstandingDebt: '7.50', total: '27.50' });
  assert.equal(chargingDebtQuote('20', '0').total, '20.00');
});
test('invalid times and amounts cannot produce collectible debt', () => {
  assert.throws(() => idleDebtAmount(stopped, at(-1)));
  assert.throws(() => idleDebtAmount(new Date('invalid'), at(700)));
  for (const invalid of ['-1', 'NaN', 'Infinity', '1.001']) assert.throws(() => chargingDebtQuote('20', invalid));
  assert.throws(() => chargingDebtQuote('0', '5'));
});
