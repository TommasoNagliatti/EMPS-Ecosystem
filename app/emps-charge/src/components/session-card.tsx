import { BatteryCharging, ChevronRight, CircleCheck, Clock3, MapPin } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import type { ChargingSession } from '@/domain/models';
import { formatCurrency, formatDate, formatEnergy } from '@/utils/formatters';

export function SessionCard({ session, onPress }: { session: ChargingSession; onPress?: () => void }) {
  const { getCharger, getStation } = useApp();
  const station = getStation(session.stationId);
  const charger = getCharger(session.chargerId);
  const isActive = session.status === 'charging';

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.card, isActive && styles.activeCard, pressed && styles.pressed]}>
      <View style={[styles.icon, isActive && styles.activeIcon]}>
        {isActive ? (
          <BatteryCharging color={Colors.coral} size={23} />
        ) : (
          <CircleCheck color={Colors.green} size={22} />
        )}
      </View>
      <View style={styles.copy}>
        <View style={styles.topRow}>
          <Text numberOfLines={1} style={styles.title}>{station?.name ?? 'Eletroposto EMPS'}</Text>
          <Text style={styles.price}>{formatCurrency(session.totalCost)}</Text>
        </View>
        <View style={styles.locationRow}>
          <MapPin color={Colors.textFaint} size={11} />
          <Text numberOfLines={1} style={styles.location}>{charger?.bay} · {charger?.connectorType}</Text>
        </View>
        <View style={styles.bottomRow}>
          <View style={styles.meta}><Clock3 color={Colors.textFaint} size={11} /><Text style={styles.metaText}>{isActive ? 'Agora' : formatDate(session.startedAt)}</Text></View>
          <View style={styles.dot} />
          <Text style={styles.metaText}>{formatEnergy(session.energyKwh)}</Text>
        </View>
      </View>
      {onPress ? <ChevronRight color={Colors.textFaint} size={19} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderColor: Colors.borderSoft,
    borderRadius: Radius.large,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 106,
    padding: 14,
  },
  activeCard: { borderColor: `${Colors.coral}70` },
  pressed: { opacity: 0.76 },
  icon: {
    alignItems: 'center',
    backgroundColor: Colors.greenSoft,
    borderRadius: 16,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  activeIcon: { backgroundColor: Colors.coralSoft },
  copy: { flex: 1, minWidth: 0 },
  topRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  title: { color: Colors.text, flex: 1, fontFamily: Fonts.semiBold, fontSize: 13 },
  price: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 13 },
  locationRow: { alignItems: 'center', flexDirection: 'row', gap: 4, marginTop: 5 },
  location: { color: Colors.textMuted, flex: 1, fontFamily: Fonts.regular, fontSize: 10 },
  bottomRow: { alignItems: 'center', flexDirection: 'row', gap: 7, marginTop: 10 },
  meta: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  metaText: { color: Colors.textFaint, fontFamily: Fonts.medium, fontSize: 9 },
  dot: { backgroundColor: Colors.textFaint, borderRadius: 2, height: 3, width: 3 },
});
