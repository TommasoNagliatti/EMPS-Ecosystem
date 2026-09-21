import { AlertTriangle, Check, Clock3, Wrench } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius } from '@/constants/theme';
import type { ChargerStatus } from '@/domain/models';

const STATUS = {
  available: { label: 'Disponível', color: Colors.green, Icon: Check },
  in_use: { label: 'Em uso', color: Colors.cyan, Icon: Clock3 },
  offline: { label: 'Indisponível', color: Colors.danger, Icon: AlertTriangle },
  maintenance: { label: 'Manutenção', color: Colors.yellow, Icon: Wrench },
} as const;

export function StatusPill({ status, compact = false }: { status: ChargerStatus; compact?: boolean }) {
  const config = STATUS[status];
  return (
    <View
      accessibilityLabel={`Status: ${config.label}`}
      style={[
        styles.pill,
        compact && styles.compact,
        { backgroundColor: `${config.color}1F`, borderColor: `${config.color}55` },
      ]}>
      <config.Icon color={config.color} size={compact ? 12 : 14} strokeWidth={2.5} />
      <Text style={[styles.label, compact && styles.compactLabel, { color: config.color }]}>
        {config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 30,
    paddingHorizontal: 10,
  },
  compact: { gap: 4, minHeight: 24, paddingHorizontal: 8 },
  label: { fontFamily: Fonts.semiBold, fontSize: 11 },
  compactLabel: { fontSize: 9 },
});
