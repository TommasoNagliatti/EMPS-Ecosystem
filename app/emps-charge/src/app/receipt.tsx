import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, Download, Home, Share2, ShieldCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { shareReceiptPdf } from '@/services/receipt-share';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/ui/app-button';
import { PageHeader } from '@/components/ui/page-header';
import { Colors, Fonts, MaxContentWidth, Radius } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import type { PaymentMethod, ChargingSession } from '@/domain/models';
import { formatCurrency, formatDate, formatDuration, formatEnergy } from '@/utils/formatters';

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  pix: 'PIX',
  card: 'Cartão',
  wallet: 'Carteira digital',
};

function ReceiptRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.receiptRow}>
      <Text style={styles.receiptLabel}>{label}</Text>
      <Text style={[styles.receiptValue, strong && styles.receiptStrong]}>{value}</Text>
    </View>
  );
}

export default function ReceiptScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const { getCharger, getStation, history, isDemoMode, loadCharger, paySession, billingQuote, refreshHistory } = useApp();
  const [sharing, setSharing] = useState(false);
  const [paying,setPaying]=useState(false),[paymentMessage,setPaymentMessage]=useState('');
  const session = history.find((item) => item.id === sessionId);
  const [quote,setQuote]=useState<{id:string;customer:ChargingSession['billing']}>();
  useEffect(()=>{
    if(!session?.tariffVersion||session.billingFrozen||session.status==='completed')return;
    let active=true;const refresh=()=>billingQuote(session.id).then(q=>{if(active)setQuote({id:session.id,customer:q.breakdown.customer});}).catch(()=>{if(active)setPaymentMessage('Não foi possível atualizar a cobrança. Tente novamente antes de pagar.');});
    void refresh();const timer=setInterval(refresh,5000);return()=>{active=false;clearInterval(timer);};
  },[billingQuote,session?.id,session?.tariffVersion,session?.billingFrozen,session?.status]);
  const billing=(!session?.billingFrozen&&session?.status!=='completed'&&quote?.id===session?.id?quote?.customer:undefined)??session?.billing,total=billing?Number(billing.total_amount):session?.totalCost??0;
  const charger = session ? getCharger(session.chargerId) : undefined;
  const station = session ? getStation(session.stationId) : undefined;
  const [loadingEntities, setLoadingEntities] = useState(Boolean(session && (!charger || !station)));

  useEffect(() => {
    if (!session || (charger && station)) return;
    let active = true;
    loadCharger(session.chargerId)
      .catch((error) => console.warn('[emps-api] dados do recibo indisponíveis', error))
      .finally(() => active && setLoadingEntities(false));
    return () => {
      active = false;
    };
  }, [charger, loadCharger, session, station]);

  if (session && loadingEntities && (!charger || !station)) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>Carregando recibo…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!session || !charger || !station) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>Recibo não encontrado</Text>
          <AppButton onPress={() => router.replace('/')} title="Voltar ao início" />
        </View>
      </SafeAreaView>
    );
  }

  async function shareReceipt() {
    if (!session || !charger || !station) return;
    if (sharing) return;
    setSharing(true);
    setPaymentMessage('');
    try {
      const current = (await refreshHistory()).find(item => item.id === session.id);
      if (!current) throw new Error('Não foi possível confirmar o pagamento no servidor.');
      await shareReceiptPdf(current, station.name, charger.bay);
    } catch (error) { setPaymentMessage(error instanceof Error ? error.message : 'Não foi possível compartilhar o comprovante.'); }
    finally { setSharing(false); }
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll} role="main" showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <PageHeader onBack={() => router.replace('/')} title="Recibo da recarga" />

          <View style={styles.successHero}>
            <View style={styles.successGlow} />
            <View style={styles.successIcon}><Check color={Colors.white} size={34} strokeWidth={3} /></View>
            <Text style={styles.successTitle}>{session.status==='completed'?'Recarga concluída':'Recarga encerrada · pagamento pendente'}</Text>
            <Text style={styles.successSubtitle}>{session.status!=='completed'?'Confirme a retirada para congelar a permanência e efetuar o pagamento.':isDemoMode||session.telemetrySource?.endsWith('_sandbox')?'Pagamento de teste registrado. Sem confirmação de hardware.':'Pagamento registrado pelo backend.'}</Text>
            <Text style={styles.total}>{formatCurrency(total)}</Text>
            <Text style={styles.totalLabel}>valor total</Text>
          </View>

          <View style={styles.receiptCard}>
            <View style={styles.receiptHeader}>
              <View>
                <Text style={styles.receiptEyebrow}>EMPS CHARGE</Text>
                <Text style={styles.receiptTitle}>{station.name}</Text>
                <Text style={styles.receiptSubtitle}>{station.address} · {charger.bay}</Text>
              </View>
              <View style={styles.approvedPill}><ShieldCheck color={Colors.green} size={12} /><Text style={styles.approvedText}>{session.status==='completed'?'APROVADO':'PENDENTE'}</Text></View>
            </View>
            <View style={styles.separator} />
            <ReceiptRow label="Início" value={formatDate(session.startedAt)} />
            <ReceiptRow label="Término" value={formatDate(session.endedAt ?? session.startedAt)} />
            {session.disconnectedAt&&<ReceiptRow label="Retirada confirmada" value={formatDate(session.disconnectedAt)}/>}
            <ReceiptRow label="Duração" value={formatDuration(session.durationSeconds)} />
            <ReceiptRow label="Energia entregue" value={billing?`${Number(billing.energy_kwh).toLocaleString("pt-BR",{minimumFractionDigits:4,maximumFractionDigits:4})} kWh`:formatEnergy(session.energyKwh)} />
            <ReceiptRow label={session.tariffVersion?"Tarifa efetiva da energia":"Tarifa"} value={`${formatCurrency(Number(billing?.effective_energy_rate_per_kwh??charger.pricePerKwh))}/kWh`} />
            <ReceiptRow
              label="Forma de pagamento"
              value={
                session.receipt?.method === 'cash' ? 'Dinheiro' : session.paymentMethod === 'card' && !isDemoMode
                  ? 'Cartão'
                  : PAYMENT_LABELS[session.paymentMethod]
              }
            />
            <View style={styles.separator} />
            {billing&&<><ReceiptRow label="Energia" value={formatCurrency(Number(billing.energy_amount))}/><ReceiptRow label="Taxa de permanência" value={formatCurrency(Number(billing.overstay_fee))}/></>}
            <ReceiptRow label={session.status==='completed'?"Total pago":"Total da recarga"} strong value={formatCurrency(total)} />
            <View style={styles.transactionBox}>
              <Text style={styles.transactionLabel}>ID DA TRANSAÇÃO</Text>
              <Text selectable style={styles.transactionValue}>{session.transactionId}</Text>
            </View>
          </View>

          <View style={styles.demoNote}>
            <Download color={Colors.yellow} size={16} />
            <Text style={styles.demoNoteText}>
              {isDemoMode
                ? 'Recibo demonstrativo. Nenhum documento fiscal real foi emitido.'
                : 'Recibo sincronizado com a sessão e o pagamento registrados pela EMPS.'}
            </Text>
          </View>

          {session.tariffVersion&&session.status!=='completed'&&<AppButton disabled={paying} title={paying?'Aguardando confirmação…':session.disconnectedAt?'Pagar recarga':'Confirmar retirada e pagar'} onPress={async()=>{setPaying(true);setPaymentMessage('');try{const ok=await paySession(session.id);if(!ok)setPaymentMessage('Pagamento não confirmado. Se você cancelou, pode tentar novamente; caso contrário aguarde o webhook.');}catch(e){setPaymentMessage(e instanceof Error?e.message:'Pagamento indisponível');}finally{setPaying(false);}}}/>}
          {!!paymentMessage&&<Text style={{color:Colors.textMuted}}>{paymentMessage}</Text>}
          {session.status==='completed' && !isDemoMode && <AppButton disabled={sharing} icon={<Share2 color={Colors.white} size={18} />} onPress={shareReceipt} title={sharing ? 'Preparando PDF…' : Platform.OS === 'web' ? 'Baixar comprovante PDF' : 'Compartilhar comprovante PDF'} />}
          <AppButton icon={<Home color={Colors.text} size={18} />} onPress={() => router.replace('/')} title="Voltar ao início" variant="ghost" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: Colors.background, flex: 1 },
  scroll: { paddingBottom: 34 },
  content: { alignSelf: 'center', gap: 13, maxWidth: MaxContentWidth, paddingHorizontal: 18, width: '100%' },
  successHero: { alignItems: 'center', backgroundColor: Colors.backgroundElevated, borderColor: Colors.borderSoft, borderRadius: Radius.large, borderWidth: 1, marginTop: 12, overflow: 'hidden', padding: 25 },
  successGlow: { backgroundColor: '#2CD28A15', borderRadius: 130, height: 260, position: 'absolute', top: -130, width: 260 },
  successIcon: { alignItems: 'center', backgroundColor: Colors.green, borderRadius: 34, height: 68, justifyContent: 'center', width: 68 },
  successTitle: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 21, marginTop: 14 },
  successSubtitle: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 10, marginTop: 3 },
  total: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 31, letterSpacing: -1, marginTop: 18 },
  totalLabel: { color: Colors.textFaint, fontFamily: Fonts.medium, fontSize: 8 },
  receiptCard: { backgroundColor: Colors.surface, borderColor: Colors.borderSoft, borderRadius: Radius.large, borderWidth: 1, gap: 12, padding: 17 },
  receiptHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  receiptEyebrow: { color: Colors.coralText, fontFamily: Fonts.semiBold, fontSize: 8, letterSpacing: 1.4 },
  receiptTitle: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 14, marginTop: 4 },
  receiptSubtitle: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 8, marginTop: 2 },
  approvedPill: { alignItems: 'center', backgroundColor: Colors.greenSoft, borderRadius: Radius.pill, flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 6 },
  approvedText: { color: Colors.green, fontFamily: Fonts.bold, fontSize: 7, letterSpacing: 0.6 },
  separator: { backgroundColor: Colors.borderSoft, height: 1 },
  receiptRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  receiptLabel: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 10 },
  receiptValue: { color: Colors.text, fontFamily: Fonts.medium, fontSize: 10 },
  receiptStrong: { fontFamily: Fonts.bold, fontSize: 14 },
  transactionBox: { alignItems: 'center', backgroundColor: Colors.backgroundElevated, borderRadius: Radius.medium, gap: 4, padding: 10 },
  transactionLabel: { color: Colors.textFaint, fontFamily: Fonts.semiBold, fontSize: 7, letterSpacing: 1.1 },
  transactionValue: { color: Colors.textMuted, fontFamily: Fonts.mono, fontSize: 9 },
  demoNote: { alignItems: 'flex-start', backgroundColor: '#F5BE4F10', borderRadius: Radius.medium, flexDirection: 'row', gap: 8, padding: 11 },
  demoNoteText: { color: Colors.textFaint, flex: 1, fontFamily: Fonts.regular, fontSize: 8, lineHeight: 13 },
  missing: { flex: 1, gap: 20, justifyContent: 'center', padding: 24 },
  missingTitle: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 20, textAlign: 'center' },
});
