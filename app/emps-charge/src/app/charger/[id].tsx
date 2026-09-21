import { useLocalSearchParams, useRouter } from 'expo-router';
import { Cable, Check, Clock3, Info, MapPin, Navigation, ScanLine, ShieldCheck, Zap } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/ui/app-button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import { Colors, Fonts, MaxContentWidth, Radius } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { formatCurrency } from '@/utils/formatters';
import { openDirections } from '@/utils/maps';

export default function ChargerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getCharger, getStation, hasQrBinding, isDemoMode, loadCharger } = useApp();
  const charger = getCharger(id);
  const station = charger ? getStation(charger.stationId) : undefined;
  const [loading, setLoading] = useState(!charger || !station);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;
    loadCharger(id)
      .catch((error) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : 'Carregador não encontrado.');
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id, loadCharger]);

  if ((!charger || !station) && loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.missing}>
          <ActivityIndicator color={Colors.coral} />
          <Text style={styles.missingTitle}>Confirmando carregador…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!charger || !station) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.missing}><Text style={styles.missingTitle}>{loadError || 'Carregador não encontrado'}</Text><AppButton onPress={() => router.replace('/')} title="Voltar ao início" /></View>
      </SafeAreaView>
    );
  }

  const available = charger.status === 'available';
  const qrValidated = isDemoMode || hasQrBinding(charger.id);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll} role="main" showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <PageHeader title="Confirmar carregador" subtitle="Confira a vaga antes de continuar" />

          <View style={styles.stationRow}>
            <MapPin color={Colors.coral} size={17} />
            <View style={styles.stationCopy}><Text style={styles.stationName}>{station.name}</Text><Text style={styles.stationAddress}>{station.address} · {station.neighborhood}</Text></View>
            <StatusPill status={charger.status} />
          </View>

          <View style={styles.chargerHero}>
            <View style={styles.glow} />
            <View style={styles.chargerGraphic}>
              <View style={styles.chargerScreen}><Zap color={Colors.coral} size={30} fill={`${Colors.coral}20`} /></View>
              <View style={styles.chargerLine} />
              <View style={styles.connector}><Cable color={Colors.text} size={26} /></View>
            </View>
            <Text style={styles.bayEyebrow}>VOCÊ ESTÁ NA</Text>
            <Text style={styles.bay}>{charger.bay}</Text>
            <Text style={styles.publicCode}>{charger.publicCode}</Text>
          </View>

          <View style={styles.metrics}>
            <View style={styles.metric}><Cable color={Colors.cyan} size={19} /><Text style={styles.metricValue}>{charger.connectorType}</Text><Text style={styles.metricLabel}>conector</Text></View>
            <View style={styles.metricDivider} />
            <View style={styles.metric}><Zap color={Colors.yellow} size={19} /><Text style={styles.metricValue}>{charger.powerKw} kW</Text><Text style={styles.metricLabel}>potência máxima</Text></View>
            <View style={styles.metricDivider} />
            <View style={styles.metric}><Text style={styles.moneyIcon}>R$</Text><Text style={styles.metricValue}>{formatCurrency(charger.pricePerKwh)}</Text><Text style={styles.metricLabel}>por kWh</Text></View>
          </View>

          <View style={styles.instructions}>
            <View style={styles.instructionsTitleRow}><ShieldCheck color={Colors.green} size={19} /><Text style={styles.instructionsTitle}>Antes de iniciar</Text></View>
            {['Confira se a vaga acima é a mesma do adesivo.', 'Conecte o cabo firmemente ao seu veículo.', 'Mantenha o conector conectado até a confirmação.'].map((item, index) => (
              <View key={item} style={styles.instructionRow}><View style={styles.step}><Text style={styles.stepText}>{index + 1}</Text></View><Text style={styles.instructionText}>{item}</Text></View>
            ))}
          </View>

          {!available ? (
            <View style={styles.warning}><Info color={Colors.yellow} size={18} /><Text style={styles.warningText}>Este carregador está indisponível agora. Volte ao eletroposto para escolher outra vaga.</Text></View>
          ) : (
            <View style={styles.updated}><Clock3 color={Colors.green} size={12} /><Text style={styles.updatedText}>Status confirmado agora</Text></View>
          )}

          <AppButton
            disabled={!available}
            icon={
              available ? (
                qrValidated ? <Check color={Colors.white} size={19} /> : <ScanLine color={Colors.white} size={19} />
              ) : undefined
            }
            onPress={() =>
              qrValidated ? router.push(`/checkout?chargerId=${charger.id}`) : router.push('/scan')
            }
            title={
              available
                ? qrValidated
                  ? 'É esta vaga · continuar'
                  : 'Escanear QR para continuar'
                : 'Carregador indisponível'
            }
          />
          <AppButton icon={<Navigation color={Colors.text} size={17} />} onPress={() => openDirections(station)} title="Ver rota até o eletroposto" variant="ghost" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: Colors.background, flex: 1 },
  scroll: { paddingBottom: 32 },
  content: { alignSelf: 'center', gap: 14, maxWidth: MaxContentWidth, paddingHorizontal: 18, width: '100%' },
  stationRow: { alignItems: 'center', backgroundColor: Colors.surface, borderColor: Colors.borderSoft, borderRadius: Radius.medium, borderWidth: 1, flexDirection: 'row', gap: 9, marginTop: 10, padding: 12 },
  stationCopy: { flex: 1 },
  stationName: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 12 },
  stationAddress: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 8, marginTop: 2 },
  chargerHero: { alignItems: 'center', backgroundColor: Colors.backgroundElevated, borderColor: Colors.borderSoft, borderRadius: Radius.large, borderWidth: 1, minHeight: 300, overflow: 'hidden', paddingVertical: 26 },
  glow: { backgroundColor: '#FF323A15', borderRadius: 100, height: 200, position: 'absolute', top: 20, width: 200 },
  chargerGraphic: { alignItems: 'center', backgroundColor: Colors.surfaceRaised, borderColor: '#52555C', borderRadius: 16, borderWidth: 2, height: 142, justifyContent: 'flex-start', paddingTop: 16, width: 92 },
  chargerScreen: { alignItems: 'center', backgroundColor: Colors.background, borderColor: Colors.border, borderRadius: 8, borderWidth: 1, height: 58, justifyContent: 'center', width: 61 },
  chargerLine: { backgroundColor: Colors.coral, borderRadius: 3, height: 5, marginTop: 12, width: 42 },
  connector: { alignItems: 'center', backgroundColor: Colors.surfaceSoft, borderRadius: 17, bottom: -12, height: 42, justifyContent: 'center', position: 'absolute', right: -29, width: 42 },
  bayEyebrow: { color: Colors.coralText, fontFamily: Fonts.semiBold, fontSize: 8, letterSpacing: 1.5, marginTop: 22 },
  bay: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 24, marginTop: 2 },
  publicCode: { color: Colors.textFaint, fontFamily: Fonts.mono, fontSize: 9, marginTop: 3 },
  metrics: { backgroundColor: Colors.surface, borderColor: Colors.borderSoft, borderRadius: Radius.large, borderWidth: 1, flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 16 },
  metric: { alignItems: 'center', flex: 1 },
  metricDivider: { backgroundColor: Colors.borderSoft, width: 1 },
  metricValue: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 11, marginTop: 6 },
  metricLabel: { color: Colors.textFaint, fontFamily: Fonts.regular, fontSize: 7, marginTop: 2 },
  moneyIcon: { color: Colors.green, fontFamily: Fonts.bold, fontSize: 14, height: 19 },
  instructions: { backgroundColor: Colors.surface, borderColor: Colors.borderSoft, borderRadius: Radius.large, borderWidth: 1, gap: 13, padding: 16 },
  instructionsTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  instructionsTitle: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  instructionRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  step: { alignItems: 'center', backgroundColor: Colors.surfaceSoft, borderRadius: 11, height: 23, justifyContent: 'center', width: 23 },
  stepText: { color: Colors.textMuted, fontFamily: Fonts.bold, fontSize: 9 },
  instructionText: { color: Colors.textMuted, flex: 1, fontFamily: Fonts.regular, fontSize: 10, lineHeight: 15 },
  warning: { alignItems: 'center', backgroundColor: '#F5BE4F12', borderColor: '#F5BE4F42', borderRadius: Radius.medium, borderWidth: 1, flexDirection: 'row', gap: 9, padding: 12 },
  warningText: { color: Colors.yellow, flex: 1, fontFamily: Fonts.medium, fontSize: 10, lineHeight: 15 },
  updated: { alignItems: 'center', flexDirection: 'row', gap: 5, justifyContent: 'center' },
  updatedText: { color: Colors.green, fontFamily: Fonts.medium, fontSize: 9 },
  missing: { flex: 1, gap: 20, justifyContent: 'center', padding: 24 },
  missingTitle: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 22, textAlign: 'center' },
});
