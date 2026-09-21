import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Coffee,
  Clock3,
  MapPin,
  Navigation,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Wifi,
  Zap,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/ui/app-button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import { Colors, Fonts, MaxContentWidth, Radius } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { formatCurrency } from '@/utils/formatters';
import { openDirections } from '@/utils/maps';

const AMENITY_ICONS = { Café: Coffee, 'Wi-Fi': Wifi, Segurança: ShieldCheck } as const;

export default function StationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getStation, getStationChargers, loadStation } = useApp();
  const station = getStation(id);
  const [loading, setLoading] = useState(!station);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;
    loadStation(id)
      .catch((error) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : 'Eletroposto não encontrado.');
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id, loadStation]);

  if (!station && loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.missing}>
          <ActivityIndicator color={Colors.coral} />
          <Text style={styles.missingTitle}>Carregando eletroposto…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!station) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>{loadError || 'Eletroposto não encontrado'}</Text>
          <AppButton onPress={() => router.replace('/')} title="Voltar ao mapa" />
        </View>
      </SafeAreaView>
    );
  }

  const stationChargers = getStationChargers(station.id);
  const available = stationChargers.filter((charger) => charger.status === 'available').length;

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll} role="main" showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <PageHeader title="Detalhes do eletroposto" />

          <View style={styles.heroCard}>
            <View style={styles.heroTop}>
              <View style={styles.heroIcon}><Zap color={Colors.coral} size={27} /></View>
              <View style={styles.heroCopy}>
                <Text style={styles.stationName}>{station.name}</Text>
                <View style={styles.addressRow}>
                  <MapPin color={Colors.textFaint} size={13} />
                  <Text style={styles.address}>{station.address} · {station.neighborhood}</Text>
                </View>
              </View>
            </View>
            <View style={styles.heroBottom}>
              <View style={styles.availabilityPill}><View style={styles.greenDot} /><Text style={styles.availabilityText}>{available} de {stationChargers.length} livres</Text></View>
              <View style={styles.hours}><Clock3 color={Colors.textMuted} size={13} /><Text style={styles.hoursText}>{station.openingHours}</Text></View>
            </View>
          </View>

          <AppButton
            icon={<Navigation color={Colors.text} size={18} />}
            onPress={() => openDirections(station)}
            title="Como chegar"
            variant="secondary"
          />

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Carregadores</Text>
            <Text style={styles.sectionHint}>Selecione uma vaga</Text>
          </View>

          <View style={styles.chargerList}>
            {stationChargers.map((charger) => (
              <Pressable
                accessibilityRole="button"
                key={charger.id}
                onPress={() => router.push(`/charger/${charger.id}`)}
                style={({ pressed }) => [styles.chargerCard, pressed && styles.pressed]}>
                <View style={[styles.chargerIcon, charger.status === 'available' && styles.availableIcon]}>
                  <Zap color={charger.status === 'available' ? Colors.green : Colors.textFaint} size={22} />
                </View>
                <View style={styles.chargerCopy}>
                  <View style={styles.chargerTop}>
                    <Text style={styles.chargerName}>{charger.bay}</Text>
                    <StatusPill compact status={charger.status} />
                  </View>
                  <Text style={styles.chargerDetails}>
                    {charger.connectorType} · {charger.powerKw} kW · {formatCurrency(charger.pricePerKwh)}/kWh
                  </Text>
                </View>
                <Text style={styles.arrow}>›</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Comodidades</Text>
          </View>
          <View style={styles.amenities}>
            {station.amenities.map((amenity) => {
              const Icon = AMENITY_ICONS[amenity as keyof typeof AMENITY_ICONS] ?? Sparkles;
              return (
                <View key={amenity} style={styles.amenity}>
                  <Icon color={Colors.cyan} size={18} />
                  <Text style={styles.amenityText}>{amenity}</Text>
                </View>
              );
            })}
          </View>

          <AppButton
            icon={<ScanLine color={Colors.white} size={19} />}
            onPress={() => router.push('/scan')}
            style={styles.scanButton}
            title="Escanear QR da vaga"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: Colors.background, flex: 1 },
  scroll: { paddingBottom: 34 },
  content: { alignSelf: 'center', maxWidth: MaxContentWidth, paddingHorizontal: 18, width: '100%' },
  heroCard: { backgroundColor: Colors.surface, borderColor: Colors.borderSoft, borderRadius: Radius.large, borderWidth: 1, gap: 18, marginTop: 16, padding: 18 },
  heroTop: { alignItems: 'center', flexDirection: 'row', gap: 13 },
  heroIcon: { alignItems: 'center', backgroundColor: Colors.coralSoft, borderRadius: 18, height: 58, justifyContent: 'center', width: 58 },
  heroCopy: { flex: 1 },
  stationName: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 19 },
  addressRow: { alignItems: 'center', flexDirection: 'row', gap: 4, marginTop: 5 },
  address: { color: Colors.textMuted, flex: 1, fontFamily: Fonts.regular, fontSize: 10 },
  heroBottom: { alignItems: 'center', borderTopColor: Colors.borderSoft, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 15 },
  availabilityPill: { alignItems: 'center', backgroundColor: Colors.greenSoft, borderRadius: Radius.pill, flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 6 },
  greenDot: { backgroundColor: Colors.green, borderRadius: 4, height: 7, width: 7 },
  availabilityText: { color: Colors.green, fontFamily: Fonts.semiBold, fontSize: 9 },
  hours: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  hoursText: { color: Colors.textMuted, fontFamily: Fonts.medium, fontSize: 9 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, marginTop: 28 },
  sectionTitle: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 16 },
  sectionHint: { color: Colors.textFaint, fontFamily: Fonts.medium, fontSize: 9 },
  chargerList: { gap: 10 },
  chargerCard: { alignItems: 'center', backgroundColor: Colors.surface, borderColor: Colors.borderSoft, borderRadius: Radius.medium, borderWidth: 1, flexDirection: 'row', gap: 11, minHeight: 78, padding: 12 },
  pressed: { opacity: 0.75 },
  chargerIcon: { alignItems: 'center', backgroundColor: Colors.surfaceSoft, borderRadius: 14, height: 46, justifyContent: 'center', width: 46 },
  availableIcon: { backgroundColor: Colors.greenSoft },
  chargerCopy: { flex: 1 },
  chargerTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  chargerName: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 13 },
  chargerDetails: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 9, marginTop: 6 },
  arrow: { color: Colors.textFaint, fontFamily: Fonts.regular, fontSize: 24, marginLeft: 3 },
  amenities: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  amenity: { alignItems: 'center', backgroundColor: Colors.surface, borderColor: Colors.borderSoft, borderRadius: Radius.medium, borderWidth: 1, flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 11 },
  amenityText: { color: Colors.textMuted, fontFamily: Fonts.medium, fontSize: 10 },
  scanButton: { marginTop: 30 },
  missing: { flex: 1, gap: 20, justifyContent: 'center', padding: 24 },
  missingTitle: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 22, textAlign: 'center' },
});
