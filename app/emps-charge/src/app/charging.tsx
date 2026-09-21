import * as Haptics from 'expo-haptics';
import { Redirect, useRouter } from 'expo-router';
import {
  BatteryCharging,
  Check,
  CircleStop,
  CloudOff,
  Gauge,
  LockKeyhole,
  Radio,
  Zap,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { AppButton } from '@/components/ui/app-button';
import { PageHeader } from '@/components/ui/page-header';
import { Colors, Fonts, MaxContentWidth, Radius } from '@/constants/theme';
import { getLiveSessionMetrics, useApp } from '@/context/app-context';
import { formatCurrency, formatEnergy, formatPower, formatTimer } from '@/utils/formatters';

const RING_SIZE = 224;
const STROKE_WIDTH = 12;
const RADIUS = (RING_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function ChargingScreen() {
  const router = useRouter();
  const {
    activeSession,
    finishSession,
    getCharger,
    getStation,
    isDemoMode,
    isRealtimeConnected,
    refreshActiveSession,
  } = useApp();
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [telemetryConnected, setTelemetryConnected] = useState(true);
  const charger = activeSession ? getCharger(activeSession.chargerId) : undefined;
  const station = activeSession ? getStation(activeSession.stationId) : undefined;

  useEffect(() => {
    if (isDemoMode) {
      const interval = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(interval);
    }

    let active = true;
    const refresh = () => {
      refreshActiveSession()
        .then(() => active && setTelemetryConnected(true))
        .catch(() => active && setTelemetryConnected(false));
    };
    refresh();
    const interval = setInterval(
      refresh,
      isRealtimeConnected ? 30_000 : 5_000,
    );
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isDemoMode, isRealtimeConnected, refreshActiveSession]);

  const metrics = useMemo(
    () =>
      activeSession
        ? getLiveSessionMetrics(
            activeSession,
            isDemoMode ? charger?.pricePerKwh ?? 0 : undefined,
            now,
          )
        : null,
    [activeSession, charger?.pricePerKwh, isDemoMode, now],
  );

  if (!activeSession || !metrics) return <Redirect href="/" />;

  const sandbox = isDemoMode || activeSession.telemetrySource?.endsWith('_sandbox') === true;
  const limitProgress = activeSession.spendingLimit
    ? Math.min(metrics.totalCost / activeSession.spendingLimit, 1)
    : Math.min(metrics.energyKwh / 40, 0.92);
  const ringOffset = CIRCUMFERENCE * (1 - limitProgress);

  async function stopCharging() {
    setConfirmVisible(false);
    setStopping(true);
    try {
      const completed = await finishSession();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/receipt?sessionId=${completed.id}`);
    } catch (error) {
      Alert.alert(
        'Não foi possível encerrar',
        error instanceof Error ? error.message : 'Tente novamente em alguns instantes.',
      );
      setStopping(false);
    }
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll} role="main" showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <PageHeader
            onBack={() => router.replace('/')}
            right={<View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>AO VIVO</Text></View>}
            subtitle={`${station?.name} · ${charger?.bay}`}
            title="Recarga em andamento"
          />

          <View style={styles.statusFlow}>
            <View style={styles.statusItem}><View style={styles.statusCheck}><Check color={Colors.white} size={11} strokeWidth={3} /></View><Text style={styles.statusLabel}>{activeSession.tariffVersion?'Pagamento ao final':'Pagamento autorizado'}</Text></View>
            <View style={styles.statusLine} />
            <View style={styles.statusItem}><View style={styles.statusCheck}><Check color={Colors.white} size={11} strokeWidth={3} /></View><Text style={styles.statusLabel}>{sandbox ? 'Sessão sandbox iniciada' : 'Carregador confirmou'}</Text></View>
            <View style={styles.statusLine} />
            <View style={styles.statusItem}><View style={styles.statusPulse}><Radio color={Colors.coral} size={13} /></View><Text style={styles.statusActive}>Carregando</Text></View>
          </View>

          <View style={styles.ringCard}>
            <View style={styles.ringWrapper}>
              <Svg height={RING_SIZE} style={styles.ringSvg} width={RING_SIZE}>
                <Circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  fill="transparent"
                  r={RADIUS}
                  stroke={Colors.surfaceSoft}
                  strokeWidth={STROKE_WIDTH}
                />
                <Circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  fill="transparent"
                  r={RADIUS}
                  stroke={Colors.coral}
                  strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
                  strokeDashoffset={ringOffset}
                  strokeLinecap="round"
                  strokeWidth={STROKE_WIDTH}
                />
              </Svg>
              <View style={styles.ringContent}>
                <View style={styles.batteryIcon}><BatteryCharging color={Colors.coral} size={25} /></View>
                <Text style={styles.energyValue}>{formatEnergy(metrics.energyKwh)}</Text>
                <Text style={styles.energyLabel}>{sandbox ? 'energia simulada' : 'energia entregue'}</Text>
              </View>
            </View>

            <View style={styles.costRow}>
              <View>
                <Text style={styles.costLabel}>CUSTO ATUAL</Text>
                <Text style={styles.costValue}>{formatCurrency(metrics.totalCost)}</Text>
              </View>
              <View style={styles.limitBox}>
                <Text style={styles.limitLabel}>LIMITE</Text>
                <Text style={styles.limitValue}>
                  {activeSession.spendingLimit ? formatCurrency(activeSession.spendingLimit) : 'Sem limite'}
                </Text>
              </View>
            </View>
            {activeSession.spendingLimit ? (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${limitProgress * 100}%` }]} />
              </View>
            ) : null}
          </View>

          <View style={styles.metricsGrid}>
            <View style={styles.metricCard}><Gauge color={Colors.cyan} size={20} /><Text style={styles.metricValue}>{formatPower(metrics.powerKw)}</Text><Text style={styles.metricLabel}>{activeSession.managedPower ? 'potência gerenciada pelo GIE' : 'potência atual'}</Text></View>
            <View style={styles.metricCard}><Zap color={Colors.yellow} size={20} /><Text style={styles.metricValue}>{formatCurrency(charger?.pricePerKwh ?? 0)}</Text><Text style={styles.metricLabel}>tarifa por kWh</Text></View>
            <View style={styles.metricCard}><Text style={styles.timerIcon}>◷</Text><Text style={styles.metricValue}>{formatTimer(metrics.durationSeconds)}</Text><Text style={styles.metricLabel}>tempo de recarga</Text></View>
            <View style={styles.metricCard}><LockKeyhole color={Colors.green} size={20} /><Text style={styles.metricValue}>{charger?.connectorType}</Text><Text style={styles.metricLabel}>{sandbox ? 'conector simulado' : 'conector travado'}</Text></View>
          </View>

          <View style={styles.offlineNote}>
            <CloudOff color={Colors.blue} size={18} />
            <View style={styles.offlineCopy}>
              <Text style={styles.offlineTitle}>Pode fechar o aplicativo</Text>
              <Text style={styles.offlineText}>{sandbox ? 'A sessão simulada continua enquanto os serviços locais estiverem ativos.' : 'A recarga continua no carregador e será recuperada quando você voltar.'}</Text>
            </View>
          </View>

          <View style={styles.telemetryRow}>
            <View
              style={[
                styles.telemetryDot,
                !isDemoMode && !isRealtimeConnected && styles.telemetryDotFallback,
                !isDemoMode &&
                  !isRealtimeConnected &&
                  !telemetryConnected &&
                  styles.telemetryDotDisconnected,
              ]}
            />
            <Text style={styles.telemetryText}>
              {isDemoMode
                ? 'Telemetria atualizada agora · Dados demonstrativos'
                : isRealtimeConnected
                  ? sandbox ? 'Tempo real conectado · sandbox, sem confirmação de hardware' : 'Tempo real conectado · dados confirmados pela EMPS'
                  : telemetryConnected
                    ? 'Tempo real reconectando · atualização REST a cada 5 s'
                  : 'Sem atualização recente · tentando reconectar'}
            </Text>
          </View>

          <AppButton
            icon={!stopping ? <CircleStop color={Colors.white} size={19} /> : undefined}
            loading={stopping}
            onPress={() => setConfirmVisible(true)}
            title={stopping ? sandbox ? 'Encerrando sessão sandbox…' : 'Aguardando confirmação do carregador…' : 'Encerrar recarga'}
            variant="danger"
          />
          <Modal
            accessibilityLabel="Confirmar encerramento da recarga"
            animationType="fade"
            onRequestClose={() => setConfirmVisible(false)}
            transparent
            visible={confirmVisible}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <View style={styles.modalIcon}>
                  <CircleStop color={Colors.coral} size={29} />
                </View>
                <Text style={styles.modalTitle}>Encerrar a recarga?</Text>
                <Text style={styles.modalText}>
                  {sandbox ? 'O backend encerrará a sessão simulada e registrará o consumo e o pagamento sandbox.' : 'O carregador vai parar, calcular o consumo final e liberar o conector após a confirmação do equipamento.'}
                </Text>
                <AppButton onPress={stopCharging} title="Encerrar agora" />
                <AppButton
                  onPress={() => setConfirmVisible(false)}
                  title="Continuar carregando"
                  variant="ghost"
                />
              </View>
            </View>
          </Modal>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: Colors.background, flex: 1 },
  scroll: { paddingBottom: 34 },
  content: { alignSelf: 'center', gap: 14, maxWidth: MaxContentWidth, paddingHorizontal: 18, width: '100%' },
  livePill: { alignItems: 'center', backgroundColor: Colors.coralSoft, borderColor: `${Colors.coral}55`, borderRadius: Radius.pill, borderWidth: 1, flexDirection: 'row', gap: 5, paddingHorizontal: 8, paddingVertical: 6 },
  liveDot: { backgroundColor: Colors.coral, borderRadius: 3, height: 6, width: 6 },
  liveText: { color: Colors.coralText, fontFamily: Fonts.bold, fontSize: 7, letterSpacing: 0.8 },
  statusFlow: { alignItems: 'center', backgroundColor: Colors.surface, borderColor: Colors.borderSoft, borderRadius: Radius.medium, borderWidth: 1, flexDirection: 'row', justifyContent: 'center', marginTop: 8, paddingHorizontal: 10, paddingVertical: 13 },
  statusItem: { alignItems: 'center', flex: 1, gap: 5 },
  statusCheck: { alignItems: 'center', backgroundColor: Colors.green, borderRadius: 10, height: 20, justifyContent: 'center', width: 20 },
  statusPulse: { alignItems: 'center', backgroundColor: Colors.coralSoft, borderColor: Colors.coral, borderRadius: 11, borderWidth: 1, height: 22, justifyContent: 'center', width: 22 },
  statusLine: { backgroundColor: Colors.border, height: 1, marginBottom: 19, width: 18 },
  statusLabel: { color: Colors.textMuted, fontFamily: Fonts.medium, fontSize: 7, textAlign: 'center' },
  statusActive: { color: Colors.coralText, fontFamily: Fonts.semiBold, fontSize: 7 },
  ringCard: { alignItems: 'center', backgroundColor: Colors.backgroundElevated, borderColor: Colors.borderSoft, borderRadius: Radius.large, borderWidth: 1, paddingBottom: 20, paddingTop: 22 },
  ringWrapper: { height: RING_SIZE, justifyContent: 'center', width: RING_SIZE },
  ringSvg: { transform: [{ rotate: '-90deg' }] },
  ringContent: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  batteryIcon: { alignItems: 'center', backgroundColor: Colors.coralSoft, borderRadius: 20, height: 42, justifyContent: 'center', width: 42 },
  energyValue: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 27, letterSpacing: -0.7, marginTop: 10 },
  energyLabel: { color: Colors.textMuted, fontFamily: Fonts.medium, fontSize: 9, marginTop: 2 },
  costRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 28, width: '100%' },
  costLabel: { color: Colors.textFaint, fontFamily: Fonts.semiBold, fontSize: 8, letterSpacing: 1 },
  costValue: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 22, marginTop: 2 },
  limitBox: { alignItems: 'flex-end' },
  limitLabel: { color: Colors.textFaint, fontFamily: Fonts.semiBold, fontSize: 8, letterSpacing: 1 },
  limitValue: { color: Colors.textMuted, fontFamily: Fonts.semiBold, fontSize: 12, marginTop: 4 },
  progressTrack: { backgroundColor: Colors.surfaceSoft, borderRadius: 4, height: 5, marginTop: 13, overflow: 'hidden', width: '82%' },
  progressFill: { backgroundColor: Colors.coral, borderRadius: 4, height: '100%' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: { alignItems: 'center', backgroundColor: Colors.surface, borderColor: Colors.borderSoft, borderRadius: Radius.medium, borderWidth: 1, flexBasis: '47%', flexGrow: 1, minHeight: 100, justifyContent: 'center' },
  metricValue: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 14, marginTop: 7 },
  metricLabel: { color: Colors.textFaint, fontFamily: Fonts.regular, fontSize: 8, marginTop: 2 },
  timerIcon: { color: Colors.violet, fontFamily: Fonts.bold, fontSize: 23, lineHeight: 24 },
  offlineNote: { alignItems: 'center', backgroundColor: '#4D91FF12', borderColor: '#4D91FF35', borderRadius: Radius.medium, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 13 },
  offlineCopy: { flex: 1 },
  offlineTitle: { color: Colors.blue, fontFamily: Fonts.semiBold, fontSize: 10 },
  offlineText: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 8, lineHeight: 13, marginTop: 2 },
  telemetryRow: { alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'center' },
  telemetryDot: { backgroundColor: Colors.green, borderRadius: 3, height: 6, width: 6 },
  telemetryDotFallback: { backgroundColor: Colors.yellow },
  telemetryDotDisconnected: { backgroundColor: Colors.danger },
  telemetryText: { color: Colors.textFaint, fontFamily: Fonts.regular, fontSize: 8 },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: Colors.overlay,
    flex: 1,
    justifyContent: 'center',
    padding: 22,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: Radius.large,
    borderWidth: 1,
    gap: 12,
    maxWidth: 420,
    padding: 20,
    width: '100%',
  },
  modalIcon: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: Colors.coralSoft,
    borderRadius: 28,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  modalTitle: {
    color: Colors.text,
    fontFamily: Fonts.bold,
    fontSize: 19,
    marginTop: 4,
    textAlign: 'center',
  },
  modalText: {
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 10,
    lineHeight: 16,
    marginBottom: 5,
    textAlign: 'center',
  },
});
