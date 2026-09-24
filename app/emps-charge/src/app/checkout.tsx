import * as Haptics from 'expo-haptics';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Check,
  CreditCard,
  Info,
  LockKeyhole,
  QrCode,
  ShieldCheck,
  WalletCards,
  Zap,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/ui/app-button';
import { PageHeader } from '@/components/ui/page-header';
import { Colors, Fonts, MaxContentWidth, Radius } from '@/constants/theme';
import type { PaymentMethod } from '@/domain/models';
import { useApp } from '@/context/app-context';
import { formatCurrency } from '@/utils/formatters';

type MethodOption = {
  id: PaymentMethod;
  title: string;
  subtitle: string;
  Icon: LucideIcon;
  badge?: string;
};

const METHODS: MethodOption[] = [
  { id: 'pix', title: 'PIX', subtitle: 'Aprovação em poucos segundos', Icon: QrCode, badge: 'Rápido' },
  { id: 'card', title: 'Cartão', subtitle: 'Stripe Sandbox · cobrança após a recarga', Icon: CreditCard },
  { id: 'wallet', title: 'Carteira digital', subtitle: 'Apple Pay ou Google Pay', Icon: WalletCards },
];

const LIMITS: (number | null)[] = [30, 50, 80];

export default function CheckoutScreen() {
  const { chargerId } = useLocalSearchParams<{ chargerId: string }>();
  const router = useRouter();
  const {
    activeSession,
    getCharger,
    getStation,
    hasQrBinding,
    isDemoMode,
    loadCharger,
    authorizeSession,
    startSession,
  } = useApp();
  const charger = getCharger(chargerId);
  const station = charger ? getStation(charger.stationId) : undefined;
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [limit, setLimit] = useState<number | null>(50);
  const [loading, setLoading] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const submitting = useRef(false);
  const [loadingLabel, setLoadingLabel] = useState('Confirmar e iniciar');
  const [error, setError] = useState('');
  const [entityLoading, setEntityLoading] = useState(!charger || !station);

  useEffect(() => {
    let active = true;
    loadCharger(chargerId)
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Carregador não encontrado.');
        }
      })
      .finally(() => active && setEntityLoading(false));
    return () => {
      active = false;
    };
  }, [chargerId, loadCharger]);

  if (activeSession) return <Redirect href="/charging" />;

  if ((!charger || !station) && entityLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.missing}>
          <ActivityIndicator color={Colors.coral} />
          <Text style={styles.missingTitle}>Preparando pagamento…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!charger || !station) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>Não foi possível montar o pagamento.</Text>
          <AppButton onPress={() => router.replace('/')} title="Voltar ao início" />
        </View>
      </SafeAreaView>
    );
  }

  if (!isDemoMode && !hasQrBinding(charger.id)) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>Escaneie o QR da vaga antes do pagamento.</Text>
          <AppButton onPress={() => router.replace('/scan')} title="Abrir leitor de QR" />
        </View>
      </SafeAreaView>
    );
  }

  const estimatedEnergy = limit ? limit / charger.pricePerKwh : null;

  async function confirmPayment() {
    if (!charger || submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError('');
    setLoadingLabel('Confirmando pagamento…');
    setLoadingLabel(authorized ? 'Liberando carregador…' : 'Autorizando reserva…');
    try {
      if (!authorized) {
        await authorizeSession({chargerId:charger.id,paymentMethod:method,spendingLimit:limit});
        setAuthorized(true);
        return;
      }
      await startSession({ chargerId: charger.id, paymentMethod: method, spendingLimit: limit });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/charging');
    } catch (paymentError) {
      if (authorized) setAuthorized(false);
      setError(paymentError instanceof Error ? paymentError.message : 'Não foi possível iniciar a recarga.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      submitting.current = false;
      setLoading(false);
      setLoadingLabel('Confirmar e iniciar');
    }
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll} role="main" showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <PageHeader title="Pagamento" subtitle={`${station.name} · ${charger.bay}`} />

          <View style={styles.demoBanner}>
            <Info color={isDemoMode ? Colors.yellow : Colors.green} size={17} />
            <View style={styles.demoCopy}>
              <Text style={[styles.demoTitle, !isDemoMode && styles.connectedTitle]}>
                {isDemoMode ? 'Ambiente demonstrativo' : 'Pagamento protegido pela EMPS'}
              </Text>
              <Text style={styles.demoText}>
                {isDemoMode
                  ? 'Nenhuma cobrança real será realizada nesta versão.'
                  : 'A autorização será confirmada pelo servidor antes de liberar o carregador.'}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Como você quer pagar?</Text>
          <View style={styles.methodList}>
            {charger.tariff&&<Text style={{color:Colors.textMuted,fontSize:12,lineHeight:19}}>Tarifa variável: {formatCurrency(Number(charger.tariff.minimum_tariff_per_kwh))} a {formatCurrency(Number(charger.tariff.maximum_tariff_per_kwh))}/kWh. Carência após fim da carga: {charger.tariff.overstay_grace_minutes} min; permanência {formatCurrency(Number(charger.tariff.overstay_fee_per_minute))}/min iniciado, até {formatCurrency(Number(charger.tariff.overstay_fee_cap))}. Reserva antes de iniciar; acerto do total real após encerrar e confirmar a retirada.</Text>}
          {METHODS.filter(m=>!charger.tariff||m.id==='card').map(({ id, title, subtitle, Icon, badge }) => {
              const selected = method === id;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  aria-checked={selected}
                  key={id}
                  disabled={loading || authorized}
                  onPress={() => setMethod(id)}
                  style={({ pressed }) => [
                    styles.methodCard,
                    selected && styles.methodSelected,
                    pressed && styles.pressed,
                  ]}>
                  <View style={[styles.methodIcon, selected && styles.methodIconSelected]}>
                    <Icon color={selected ? Colors.coral : Colors.textMuted} size={22} />
                  </View>
                  <View style={styles.methodCopy}>
                    <View style={styles.methodTitleRow}>
                      <Text style={styles.methodTitle}>{title}</Text>
                      {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
                    </View>
                    <Text style={styles.methodSubtitle}>
                      {isDemoMode
                        ? subtitle
                        : id === 'card'
                          ? 'Cartão cadastrado ou novo cartão'
                          : id === 'wallet'
                            ? 'Carteira disponível no aparelho'
                            : subtitle}
                    </Text>
                  </View>
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected ? <Check color={Colors.white} size={13} strokeWidth={3} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.sectionHeadingRow}>
            <Text style={styles.sectionTitle}>Reserva para autorização</Text>
            <Text style={styles.optional}>Não é o preço final</Text>
          </View>
          <View style={styles.limitRow}>
            {LIMITS.map((item) => {
              const selected = limit === item;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  aria-checked={selected}
                  key={item ?? 'no-limit'}
                  disabled={loading || authorized}
                  onPress={() => setLimit(item)}
                  style={({ pressed }) => [
                    styles.limitPill,
                    selected && styles.limitSelected,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.limitText, selected && styles.limitTextSelected]}>
                    {item ? formatCurrency(item) : 'Sem limite'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.summaryCard}>
            <View style={styles.summaryHeader}>
              <View style={styles.summaryIcon}><Zap color={Colors.coral} size={21} /></View>
              <View style={styles.summaryCopy}>
                <Text style={styles.summaryTitle}>{charger.bay} · {charger.connectorType}</Text>
                <Text style={styles.summarySubtitle}>{station.name}</Text>
              </View>
            </View>
            <View style={styles.separator} />
            <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Tarifa</Text><Text style={styles.summaryValue}>{formatCurrency(charger.pricePerKwh)}/kWh</Text></View>
            <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Potência máxima</Text><Text style={styles.summaryValue}>{charger.powerKw} kW</Text></View>
            <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Limite autorizado</Text><Text style={styles.summaryValue}>{limit ? formatCurrency(limit) : 'Sem limite'}</Text></View>
            {estimatedEnergy ? <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Energia estimada</Text><Text style={styles.summaryValue}>até {estimatedEnergy.toFixed(1).replace('.', ',')} kWh</Text></View> : null}
          </View>

          <View style={styles.paymentNote}>
            <LockKeyhole color={Colors.green} size={17} />
            <Text style={styles.paymentNoteText}>
              {charger.tariff ? 'Reservamos o valor escolhido antes de liberar a recarga. Após a retirada, capturamos o total real e liberamos o restante. Se o total exceder a reserva ou ela expirar, será solicitada nova confirmação. Totais abaixo de R$ 0,50 seguem para o caixa.' : method === 'pix'
                ? 'O PIX cria crédito pré-pago e o saldo não usado é devolvido conforme as regras exibidas.'
                : 'Será feita uma pré-autorização e apenas o valor consumido será capturado ao encerrar.'}
            </Text>
          </View>

          {authorized && <Text style={styles.paymentNoteText}>Pagamento autorizado · Recarga liberada</Text>}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <AppButton
            icon={!loading ? <ShieldCheck color={Colors.white} size={19} /> : undefined}
            loading={loading}
            onPress={confirmPayment}
            title={loading ? loadingLabel : authorized ? 'INICIAR RECARGA' : 'Autorizar pagamento'}
          />
          <Text style={styles.terms}>Ao confirmar, você aceita a tarifa e as condições desta recarga.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: Colors.background, flex: 1 },
  scroll: { paddingBottom: 34 },
  content: {
    alignSelf: 'center',
    gap: 13,
    maxWidth: MaxContentWidth,
    paddingHorizontal: 18,
    width: '100%',
  },
  demoBanner: {
    alignItems: 'center',
    backgroundColor: '#F5BE4F12',
    borderColor: '#F5BE4F3D',
    borderRadius: Radius.medium,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    padding: 12,
  },
  demoCopy: { flex: 1 },
  demoTitle: { color: Colors.yellow, fontFamily: Fonts.semiBold, fontSize: 10 },
  connectedTitle: { color: Colors.green },
  demoText: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 8, marginTop: 2 },
  sectionTitle: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 15, marginTop: 10 },
  methodList: { gap: 9 },
  methodCard: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderColor: Colors.borderSoft,
    borderRadius: Radius.medium,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    minHeight: 70,
    padding: 12,
  },
  methodSelected: { backgroundColor: '#FF323A0D', borderColor: `${Colors.coral}75` },
  pressed: { opacity: 0.75 },
  methodIcon: {
    alignItems: 'center',
    backgroundColor: Colors.surfaceSoft,
    borderRadius: 14,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  methodIconSelected: { backgroundColor: Colors.coralSoft },
  methodCopy: { flex: 1 },
  methodTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  methodTitle: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 12 },
  methodSubtitle: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 9, marginTop: 3 },
  badge: { backgroundColor: Colors.greenSoft, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { color: Colors.green, fontFamily: Fonts.semiBold, fontSize: 7 },
  radio: {
    alignItems: 'center',
    borderColor: Colors.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 21,
    justifyContent: 'center',
    width: 21,
  },
  radioSelected: { backgroundColor: Colors.coralAction, borderColor: Colors.coralAction },
  sectionHeadingRow: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
  optional: { color: Colors.textFaint, fontFamily: Fonts.regular, fontSize: 8 },
  limitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  limitPill: { backgroundColor: Colors.surface, borderColor: Colors.border, borderRadius: Radius.pill, borderWidth: 1, flexGrow: 1, minWidth: 74, paddingHorizontal: 12, paddingVertical: 11 },
  limitSelected: { backgroundColor: Colors.coralAction, borderColor: Colors.coralAction },
  limitText: { color: Colors.textMuted, fontFamily: Fonts.semiBold, fontSize: 10, textAlign: 'center' },
  limitTextSelected: { color: Colors.white },
  summaryCard: { backgroundColor: Colors.surface, borderColor: Colors.borderSoft, borderRadius: Radius.large, borderWidth: 1, gap: 11, marginTop: 7, padding: 16 },
  summaryHeader: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  summaryIcon: { alignItems: 'center', backgroundColor: Colors.coralSoft, borderRadius: 13, height: 42, justifyContent: 'center', width: 42 },
  summaryCopy: { flex: 1 },
  summaryTitle: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 12 },
  summarySubtitle: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 9, marginTop: 2 },
  separator: { backgroundColor: Colors.borderSoft, height: 1 },
  summaryRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 10 },
  summaryValue: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 10 },
  paymentNote: { alignItems: 'flex-start', flexDirection: 'row', gap: 9, paddingHorizontal: 5 },
  paymentNoteText: { color: Colors.textFaint, flex: 1, fontFamily: Fonts.regular, fontSize: 8, lineHeight: 13 },
  error: { backgroundColor: '#FF4D5718', borderRadius: Radius.medium, color: Colors.danger, fontFamily: Fonts.medium, fontSize: 10, padding: 11, textAlign: 'center' },
  terms: { color: Colors.textFaint, fontFamily: Fonts.regular, fontSize: 8, textAlign: 'center' },
  missing: { flex: 1, gap: 20, justifyContent: 'center', padding: 24 },
  missingTitle: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 20, textAlign: 'center' },
});
