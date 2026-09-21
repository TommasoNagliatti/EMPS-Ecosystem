import { ChevronRight, MapPin, Zap } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StatusPill } from '@/components/ui/status-pill';
import { Colors, Fonts, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import type { Station } from '@/domain/models';
import { formatDistance } from '@/utils/formatters';

type StationCardProps = {
  station: Station;
  distanceKm: number;
  onPress: () => void;
};

export function StationCard({ station, distanceKm, onPress }: StationCardProps) {
  const { getStationChargers } = useApp();
  const stationChargers = getStationChargers(station.id);
  const available = stationChargers.filter((charger) => charger.status === 'available').length;
  const bestCharger =
    stationChargers.find((charger) => charger.status === 'available') ?? stationChargers[0];
  const maximumPower =
    stationChargers.length > 0
      ? Math.max(...stationChargers.map((item) => item.powerKw))
      : null;
  const minimumPrice =
    stationChargers.length > 0
      ? Math.min(...stationChargers.map((item) => item.pricePerKwh))
      : null;
  const availableLabel = `${available} ${available === 1 ? 'carregador disponível' : 'carregadores disponíveis'}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${station.name}, ${availableLabel}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, Shadow.card, pressed && styles.pressed]}>
      <View style={styles.topRow}>
        <View style={styles.iconBox}>
          <Zap color={Colors.coral} fill={`${Colors.coral}25`} size={22} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.name}>{station.name}</Text>
          <View style={styles.addressRow}>
            <MapPin color={Colors.textFaint} size={13} />
            <Text numberOfLines={1} style={styles.address}>
              {station.neighborhood} · {formatDistance(distanceKm)}
            </Text>
          </View>
        </View>
        <ChevronRight color={Colors.textFaint} size={21} />
      </View>

      <View style={styles.bottomRow}>
        <StatusPill status={available > 0 ? 'available' : bestCharger?.status ?? 'offline'} compact />
        <Text style={styles.detail}>{available}/{stationChargers.length} livres</Text>
        <View style={styles.dot} />
        <Text style={styles.detail}>{maximumPower ? `até ${maximumPower} kW` : 'consultando potência'}</Text>
        <Text style={styles.price}>
          {minimumPrice === null
            ? 'tarifa indisponível'
            : `R$ ${minimumPrice.toFixed(2).replace('.', ',')}/kWh`}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderColor: Colors.borderSoft,
    borderRadius: Radius.large,
    borderWidth: 1,
    gap: 17,
    padding: 16,
  },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  topRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  iconBox: {
    alignItems: 'center',
    backgroundColor: Colors.coralSoft,
    borderRadius: 14,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  copy: { flex: 1 },
  name: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 15 },
  addressRow: { alignItems: 'center', flexDirection: 'row', gap: 4, marginTop: 4 },
  address: {
    color: Colors.textMuted,
    flex: 1,
    fontFamily: Fonts.regular,
    fontSize: 11,
  },
  bottomRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  detail: { color: Colors.textMuted, fontFamily: Fonts.medium, fontSize: 10 },
  dot: { backgroundColor: Colors.textFaint, borderRadius: 2, height: 3, width: 3 },
  price: {
    color: Colors.text,
    fontFamily: Fonts.semiBold,
    fontSize: 10,
    marginLeft: 'auto',
  },
});
