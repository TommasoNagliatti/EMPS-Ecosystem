import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeChargingSession} from '../src/domain/normalizers';
import {canConfirmConnectorRemoval,requiresConnectorRemoval} from '../src/domain/charge-lifecycle';

const lifecycle={version:'PREPAID_LIMIT_V2',serverTime:'2026-10-13T13:01:00Z',stoppedAt:'2026-10-13T13:00:00Z',disconnectedAt:null,removalDeadline:'2026-10-13T13:10:00Z',graceSeconds:600,remainingGraceSeconds:540,occupancyState:'GRACE',overstaySeconds:0,removalConfirmationMode:'customer'};
const base={id:'900',chargerId:'51',stationId:'13',startedAt:'2026-10-13T12:00:00Z',paymentMethod:'card',status:'completed'};

test('completed payment does not discard pending removal or require a V1 tariff',()=>{
 const session=normalizeChargingSession({...base,lifecycle})!;
 assert.deepEqual(session.lifecycle,lifecycle);
 assert.equal(requiresConnectorRemoval(session),true);assert.equal(canConfirmConnectorRemoval(session),true);
 const done=normalizeChargingSession({...base,lifecycle:{...lifecycle,occupancyState:'REMOVED',disconnectedAt:'2026-10-13T13:01:00Z'}})!;
 assert.equal(requiresConnectorRemoval(done),false);
});
test('gateway-confirmed sessions never offer manual removal',()=>{
 const session=normalizeChargingSession({...base,lifecycle:{...lifecycle,removalConfirmationMode:'gateway'}})!;
 assert.equal(requiresConnectorRemoval(session),true);assert.equal(canConfirmConnectorRemoval(session),false);
});
test('malformed lifecycle cannot silently become a legacy completed session',()=>{
 assert.equal(normalizeChargingSession({...base,lifecycle:{...lifecycle,graceSeconds:15}}),null);
 assert.equal(normalizeChargingSession({...base,lifecycle:{...lifecycle,removalDeadline:'wrong'}}),null);
 assert.equal(normalizeChargingSession({...base,lifecycle:null})?.status,'completed');
});
