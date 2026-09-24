import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptHtml} from '../src/services/receipt-html';
import type {ChargingSession} from '../src/domain/models';
import {receiptPdf} from '../src/services/receipt-pdf';
import {readFileSync, writeFileSync} from 'node:fs';
import {PDFDocument} from 'pdf-lib';
const sample={id:'9007199254740993',status:'completed',startedAt:'2026-09-22T01:00:00Z',endedAt:'2026-09-22T01:03:00Z',energyKwh:.5,totalCost:999,receipt:{paymentId:'91',transactionId:'PAY-DEMO',paidAt:'2026-09-22T01:04:00Z',method:'card',status:'approved',amountPaid:'1.23',energyAmount:'1.00',overstayFee:'.23',provider:'stripe'}} as ChargingSession;
test('gera PDF real com logo e rejeita pagamento pendente',async()=>{
 const logo=readFileSync('assets/images/emps-logo-red.png');
 const bytes=await receiptPdf(sample,'Estação de teste EMPS','Carregador DEMO',logo);
 const pdf=await PDFDocument.load(bytes);
 assert.equal(pdf.getPageCount(),1);
 assert.equal(pdf.getAuthor(),'EMPS');
 assert.ok(bytes.length>logo.length/2);
 await assert.rejects(()=>receiptPdf({...sample,status:'payment_pending'},'A','B',logo),/confirmação/);
 const long=await receiptPdf(sample,'Estação '.repeat(1000),'B',logo);
 assert.ok((await PDFDocument.load(long)).getPageCount()>=2);
 if(process.env.EMPS_PDF_PREVIEW) writeFileSync(process.env.EMPS_PDF_PREVIEW,bytes);
});
test('PDF usa o total pago oficial, IDs exatos e escapa texto externo',()=>{
 const html=receiptHtml(sample,'<script>alert(1)</script>','DEMO & 1','data:image/png;base64,YQ==');
 assert.ok(html.includes('1,23'));assert.ok(!html.includes('999'));assert.ok(html.includes('9007199254740993'));
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('22:04:00'));assert.ok(html.includes('Taxa de permanência'));
});
test('PDF não representa cobrança pendente ou histórico sem pagamento como quitado',()=>{
 assert.throws(()=>receiptHtml({...sample,status:'payment_pending'},'A','B','data:image/png;base64,YQ=='),/confirmação/);
 assert.throws(()=>receiptHtml({...sample,receipt:undefined},'A','B','data:image/png;base64,YQ=='),/confirmação/);
 const html=receiptHtml({...sample,receipt:{...sample.receipt!,energyAmount:null,overstayFee:null}},'A','B','data:image/png;base64,YQ==');assert.ok(html.includes('Não discriminado no registro legado'));
});
