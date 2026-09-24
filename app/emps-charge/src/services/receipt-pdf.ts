import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ChargingSession } from '../domain/models';
import { receiptRows, currency } from './receipt-html';

/** Presentation only: every monetary component comes from the paid backend record. */
export async function receiptPdf(session: ChargingSession, station: string, charger: string, logo: Uint8Array) {
  const rows = receiptRows(session, station, charger);
  const paid = session.receipt!;
  const doc = await PDFDocument.create();
  doc.setTitle('Comprovante EMPS - ' + paid.transactionId);
  doc.setAuthor('EMPS');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const supported = new Set(regular.getCharacterSet());
  const clean = (value: string) => Array.from(value).map(c => supported.has(c.codePointAt(0)!) ? c : '?').join('');
  let page = doc.addPage([595.28, 841.89]);
  let y = 794;
  const red = rgb(.82,.09,.15);
  const gray = rgb(.30,.34,.40);
  const text = (value: string, x: number, top: number, size = 10, strong = false) => page.drawText(clean(value), {x,y:top,size,font:strong?bold:regular,color:gray});
  const image = await doc.embedPng(logo);
  const dimensions = image.scale(Math.min(135/image.width, 48/image.height));
  page.drawImage(image,{x:40,y:y-dimensions.height,...dimensions});
  y -= 78;
  text('Comprovante de pagamento',40,y,23,true);
  y -= 23;
  text('EMPS Charge | ' + (paid.sandbox ?? ['stripe','sandbox','zero_amount'].includes(paid.provider) ? 'Sandbox / demonstracao' : 'Pagamento registrado'),40,y);
  y -= 18;
  page.drawLine({start:{x:40,y},end:{x:555,y},thickness:2,color:red});
  y -= 27;
  for (const [label, raw] of rows) {
    const value = clean(String(raw ?? 'Não informado'));
    const lines: string[] = []; let line = '';
    for (const c of value) {
      if (regular.widthOfTextAtSize(line+c,10)>300) {lines.push(line);line='';}
      line += c;
    }
    lines.push(line);
    for (let i=0;i<lines.length;i++) {
      if (y<120) {page=doc.addPage([595.28,841.89]);y=790;text('EMPS | Continuação do comprovante',40,y,12,true);y-=30;}
      if (i===0) text(String(label),40,y);
      text(lines[i],248,y);
      y-=14;
    }
    y-=12;
  }
  if (y<135) {page=doc.addPage([595.28,841.89]);y=790;}
  page.drawRectangle({x:40,y:y-45,width:515,height:55,color:rgb(.95,.96,.97)});
  text('Total pago',54,y-23,18,true);
  text(currency(paid.amountPaid),350,y-23,20,true);
  text('Valores oficiais do pagamento. Horários de Brasília.',40,y-70,9);
  text('Este comprovante não substitui documento fiscal.',40,y-85,9);
  return doc.save();
}
