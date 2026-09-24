import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';

import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { ChargingSession } from '../domain/models';
import { receiptPdf } from './receipt-pdf';

export async function shareReceiptPdf(session: ChargingSession, station: string, charger: string) {
  if (Platform.OS === 'web') throw new Error('Abra o App no Android ou iOS para gerar e compartilhar o PDF. Os dados do recibo continuam disponíveis nesta tela.');
  if (!await Sharing.isAvailableAsync()) throw new Error('O compartilhamento não está disponível neste aparelho. Consulte o recibo nesta tela.');
  const logo = await Asset.fromModule(require('../../assets/images/emps-logo-red.png')).downloadAsync();
  if (!logo.localUri) throw new Error('Não foi possível carregar a logo. Tente novamente.');
  const logoBytes = await new File(logo.localUri).bytes();
  const cache = new Directory(Paths.cache, 'emps-receipts');
  cache.create({idempotent:true});
  for (const entry of cache.list()) {
    const match = /^receipt-(\d+)-[a-z0-9]+\.pdf$/.exec(entry.name);
    if (entry instanceof File && match && Date.now()-Number(match[1])>86_400_000) entry.delete();
  }
  const bytes = await receiptPdf(session,station,charger,logoBytes);
  const target = new File(cache, 'receipt-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'.pdf');
  target.create(); target.write(bytes);
  // Android can resolve the share intent before the receiving app reads the file.
  // Keep it in the app-private cache and expire it on a subsequent share after 24h.
  await Sharing.shareAsync(target.uri,{mimeType:'application/pdf',UTI:'com.adobe.pdf',dialogTitle:'Compartilhar comprovante EMPS'});
}
