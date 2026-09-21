import test from 'node:test';
import assert from 'node:assert/strict';
import {bill} from '../src/billing';
test('caixa inclui a taxa fixa e arredonda centavos no backend',()=>{
 assert.deepEqual(bill('0.300','1.89','0.50'),{energyKwh:.3,pricePerKwh:1.89,fixedFee:.5,energyAmount:.57,total:1.07});
 assert.equal(bill('1','1.005','0').total,1.01);
 assert.equal(bill('2','1.89','.50','2.00').total,2);
});
