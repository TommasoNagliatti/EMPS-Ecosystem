import { useFocusEffect, useRouter } from 'expo-router';
import { History as HistoryIcon, Zap } from 'lucide-react-native';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SessionCard } from '@/components/session-card';
import { Colors, Fonts, MaxContentWidth, Radius } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { formatCurrency, formatEnergy } from '@/utils/formatters';

export default function HistoryScreen() {
  const router = useRouter();
  const { activeSession, history, refreshHistory } = useApp();

  useFocusEffect(
    useCallback(() => {
      refreshHistory().catch((error) =>
        console.warn('[emps-api] histórico temporariamente indisponível', error),
      );
    }, [refreshHistory]),
  );
  const totalEnergy = history.reduce((sum, item) => sum + item.energyKwh, 0);
  const totalSpent = history.reduce((sum, item) => sum + item.totalCost, 0);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll} role="main" showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.eyebrow}>SUA ENERGIA</Text>
            <Text style={styles.title}>Minhas recargas</Text>
            <Text style={styles.subtitle}>Acompanhe a sessão atual e consulte seus recibos.</Text>
          </View>

          <View style={styles.summary}>
            <View style={styles.summaryItem}>
              <View style={styles.summaryIcon}><HistoryIcon color={Colors.cyan} size={18} /></View>
              <Text style={styles.summaryValue}>{history.length}</Text>
              <Text style={styles.summaryLabel}>recargas</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <View style={styles.summaryIcon}><Zap color={Colors.yellow} size={18} /></View>
              <Text style={styles.summaryValue}>{formatEnergy(totalEnergy)}</Text>
              <Text style={styles.summaryLabel}>consumidos</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <View style={styles.summaryIcon}><Text style={styles.currencyIcon}>R$</Text></View>
              <Text style={styles.summaryValue}>{formatCurrency(totalSpent)}</Text>
              <Text style={styles.summaryLabel}>investidos</Text>
            </View>
          </View>

          {activeSession ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Em andamento</Text>
              <SessionCard onPress={() => router.push('/charging')} session={activeSession} />
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Histórico</Text>
              <Text style={styles.sectionCount}>{history.length} recibos</Text>
            </View>
            <View style={styles.list}>
              {history.map((session) => (
                <SessionCard
                  key={session.id}
                  onPress={() => router.push(`/receipt?sessionId=${session.id}`)}
                  session={session}
                />
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: Colors.background, flex: 1 },
  scroll: { paddingBottom: 34 },
  content: { alignSelf: 'center', maxWidth: MaxContentWidth, paddingHorizontal: 18, width: '100%' },
  header: { paddingBottom: 24, paddingTop: 26 },
  eyebrow: { color: Colors.coralText, fontFamily: Fonts.semiBold, fontSize: 9, letterSpacing: 1.6 },
  title: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 27, letterSpacing: -0.8, marginTop: 5 },
  subtitle: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 12, marginTop: 6 },
  summary: { backgroundColor: Colors.surface, borderColor: Colors.borderSoft, borderRadius: Radius.large, borderWidth: 1, flexDirection: 'row', marginBottom: 28, paddingHorizontal: 10, paddingVertical: 18 },
  summaryItem: { alignItems: 'center', flex: 1, minWidth: 0 },
  summaryIcon: { alignItems: 'center', height: 24, justifyContent: 'center' },
  summaryValue: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 13, marginTop: 5 },
  summaryLabel: { color: Colors.textFaint, fontFamily: Fonts.medium, fontSize: 8, marginTop: 2 },
  summaryDivider: { backgroundColor: Colors.border, width: 1 },
  currencyIcon: { color: Colors.green, fontFamily: Fonts.bold, fontSize: 13 },
  section: { gap: 12, marginBottom: 28 },
  sectionRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 16 },
  sectionCount: { color: Colors.textFaint, fontFamily: Fonts.medium, fontSize: 9 },
  list: { gap: 11 },
});
