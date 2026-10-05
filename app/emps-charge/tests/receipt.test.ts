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

test('comprovante discrimina autorização, captura, liberação e devolução Demo',async()=>{
 const financial={...sample,receipt:{...sample.receipt!,disposition:{authorizedAmount:'30.00',consumedAmount:'18.43',capturedAmount:'30.00',releasedAmount:'0.00',refundDueAmount:'11.57',refundedAmount:'11.57',refundStatus:'SIMULATED',provenance:'SIMULATED'}}};
 const html=receiptHtml(financial,'Estação financeira','DEMO','data:image/png;base64,YQ==');
 for(const label of ['Valor autorizado','Valor efetivamente usado','Valor capturado','Valor liberado','Valor a devolver','Valor devolvido (Demo/Sandbox)','Mesmo meio de pagamento'])assert.ok(html.includes(label));
 assert.ok(html.includes('11,57'));assert.ok(html.includes('18,43'));assert.ok(html.includes('30,00'));
 const bytes=await receiptPdf(financial,'Estação financeira','DEMO',readFileSync('assets/images/emps-logo-red.png'));
 assert.ok((await PDFDocument.load(bytes)).getPageCount()>=1);
});

test('comprovante de reserva separa taxa, energia, permanência e total',async()=>{
 const reserved={...sample,receipt:{...sample.receipt!,reservation:{id:'reservation-test',fee:'4.00',startAt:sample.startedAt,endAt:sample.endedAt!,provider:'SANDBOX',status:'USED',paymentReference:'reservation-demo-test',totalWithCharging:'5.23'}}};
 const html=receiptHtml(reserved,'Estação com reserva','DEMO','data:image/png;base64,YQ==');
 for(const text of ['Reserva','Valor de energia','Taxa de permanência','Total · reserva + recarga','4,00','1,00','0,23','5,23','Demo/Sandbox'])assert.ok(html.includes(text),text);
 const bytes=await receiptPdf(reserved,'Estação com reserva','DEMO',readFileSync('assets/images/emps-logo-red.png'));
 assert.ok((await PDFDocument.load(bytes)).getPageCount()>=1);
});
