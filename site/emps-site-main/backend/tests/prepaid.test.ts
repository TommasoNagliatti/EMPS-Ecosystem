import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentDisposition} from '../src/payment-disposition';
import {assertPrepaidAmount} from '../src/prepaid-domain';

test('Cartão: 30 autorizados, 18,43 capturados, 11,57 liberados',()=>{
 const d=paymentDisposition({method:'CARD',provider:'stripe',authorized:30,consumed:'18.43',captured:'18.43'});
 assert.equal(d.authorizedAmount,'30.00');assert.equal(d.capturedAmount,'18.43');assert.equal(d.releasedAmount,'11.57');assert.equal(d.refundedAmount,'0.00');assert.equal(d.provenance,'EXTERNAL');
});
test('Pix Sandbox distingue valor pago, consumo e refund simulado',()=>{
 const d=paymentDisposition({method:'PIX',provider:'sandbox',authorized:30,consumed:'18.43',captured:'18.43'});
 assert.equal(d.capturedAmount,'30.00');assert.equal(d.consumedAmount,'18.43');assert.equal(d.releasedAmount,'0.00');assert.equal(d.refundDueAmount,'11.57');assert.equal(d.refundedAmount,'11.57');assert.equal(d.refundStatus,'SIMULATED');assert.equal(d.refundDestination,'SAME_PAYMENT_METHOD');
 const real=paymentDisposition({method:'PIX',provider:'external',authorized:30,consumed:'18.43',captured:30});assert.equal(real.refundedAmount,'0.00');assert.equal(real.refundStatus,'PENDING_PROVIDER');
});
test('Admissão deixa margem para STOP e exige potência conhecida',()=>{
 assert.doesNotThrow(()=>assertPrepaidAmount(12.5,7.4,2,0));assert.throws(()=>assertPrepaidAmount(1,2000,2.29,0),/Autorize ao menos/);assert.throws(()=>assertPrepaidAmount(30,null,2,0),/Potência/);
});
