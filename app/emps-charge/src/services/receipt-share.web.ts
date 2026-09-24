import { Asset } from 'expo-asset';
import type { ChargingSession } from '../domain/models';
import { receiptPdf } from './receipt-pdf';

export async function shareReceiptPdf(session: ChargingSession, station: string, charger: string) {
  const asset = Asset.fromModule(require('../../assets/images/emps-logo-red.png'));
  const response = await fetch(asset.uri);
  if (!response.ok) throw new Error('Não foi possível carregar a logo EMPS. Tente novamente.');
  const bytes = await receiptPdf(session,station,charger,new Uint8Array(await response.arrayBuffer()));
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/pdf'}));
  const link = document.createElement('a');
  link.href=url;
  link.download='EMPS-comprovante-'+session.id.replace(/[^a-zA-Z0-9_-]/g,'')+'.pdf';
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(()=>URL.revokeObjectURL(url),60_000); }
}
