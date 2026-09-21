import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Bell, LocateFixed, MapPin, ScanLine, Search, Zap } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Brand } from '@/components/brand';
import { StationCard } from '@/components/station-card';
import { StationMap } from '@/components/station-map';
import { Colors, Fonts, MaxContentWidth, Radius, Shadow } from '@/constants/theme';
import type { Coordinate } from '@/domain/models';
import { getLiveSessionMetrics, useApp } from '@/context/app-context';
import { distanceInKm, formatCurrency, formatEnergy } from '@/utils/formatters';

const DEFAULT_COORDINATE: Coordinate = { latitude: -23.5733, longitude: -46.6417 };

export default function HomeScreen() {
  const router = useRouter();
  const {
    user,
    activeSession,
    chargers,
    getCharger,
    getStation,
    isDemoMode,
    isStationsLoading,
    loadNearbyStations,
    stations,
  } = useApp();
  const [query, setQuery] = useState('');
  const [userCoordinate, setUserCoordinate] = useState(DEFAULT_COORDINATE);
  const [selectedStationId, setSelectedStationId] = useState<string>();
  const [locating, setLocating] = useState(false);
  const [stationsError, setStationsError] = useState('');

  useEffect(() => {
    let active = true;
    loadNearbyStations(DEFAULT_COORDINATE).catch((error) => {
      if (active) {
        setStationsError(
          error instanceof Error ? error.message : 'Não foi possível carregar os eletropostos.',
        );
      }
    });
    return () => {
      active = false;
    };
  }, [loadNearbyStations]);

  const filteredStations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    const matches = normalized
      ? stations.filter((station) =>
          [station.name, station.address, station.neighborhood, station.city]
            .join(' ')
            .toLocaleLowerCase('pt-BR')
            .includes(normalized),
        )
      : stations;

    return [...matches].sort(
      (left, right) =>
        distanceInKm(userCoordinate, left.coordinates) -
        distanceInKm(userCoordinate, right.coordinates),
    );
  }, [query, stations, userCoordinate]);

  const activeStation = activeSession ? getStation(activeSession.stationId) : null;
  const activeCharger = activeSession ? getCharger(activeSession.chargerId) : null;
  const liveMetrics = activeSession
    ? getLiveSessionMetrics(
        activeSession,
        isDemoMode ? activeCharger?.pricePerKwh ?? 0 : undefined,
      )
    : null;

  async function useCurrentLocation() {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert(
          'Localização não autorizada',
          'Você ainda pode buscar por bairro ou endereço. Ative a localização nos ajustes para ordenar por distância.',
        );
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const nextCoordinate = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setUserCoordinate(nextCoordinate);
      setStationsError('');
      await loadNearbyStations(nextCoordinate);
    } catch (error) {
      Alert.alert(
        'Não foi possível atualizar sua posição',
        error instanceof Error
          ? error.message
          : 'Verifique se o GPS e a internet estão disponíveis e tente novamente.',
      );
    } finally {
      setLocating(false);
    }
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        role="main"
        showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Brand compact />
            <Pressable
              accessibilityLabel="Notificações"
              accessibilityRole="button"
              onPress={() => Alert.alert('Tudo certo', 'Você não tem novas notificações.')}
              style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
              <Bell color={Colors.text} size={20} />
              <View style={styles.notificationDot} />
            </Pressable>
          </View>

          <View style={styles.greeting}>
            <Text style={styles.greetingMuted}>Olá, {user?.name.split(' ')[0]}</Text>
            <Text accessibilityRole="header" style={styles.greetingTitle}>Onde vamos carregar hoje?</Text>
          </View>

          {activeSession && liveMetrics ? (
            <Pressable
              onPress={() => router.push('/charging')}
              style={({ pressed }) => [styles.activeCard, pressed && styles.pressed]}>
              <LinearGradient
                colors={[Colors.coralAction, '#A9142B']}
                end={{ x: 1, y: 1 }}
                start={{ x: 0, y: 0 }}
                style={styles.activeGradient}>
                <View style={styles.activeTop}>
                  <View style={styles.activeIcon}><Zap color={Colors.white} size={20} fill="#FFFFFF30" /></View>
                  <View style={styles.activeCopy}>
                    <Text style={styles.activeEyebrow}>RECARGA EM ANDAMENTO</Text>
                    <Text style={styles.activeTitle}>{activeStation?.name} · {activeCharger?.bay}</Text>
                  </View>
                  <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>AO VIVO</Text></View>
                </View>
                <View style={styles.activeMetrics}>
                  <View><Text style={styles.activeMetric}>{formatEnergy(liveMetrics.energyKwh)}</Text><Text style={styles.activeLabel}>energia</Text></View>
                  <View style={styles.activeDivider} />
                  <View><Text style={styles.activeMetric}>{formatCurrency(liveMetrics.totalCost)}</Text><Text style={styles.activeLabel}>estimado</Text></View>
                  <Text style={styles.activeLink}>Acompanhar →</Text>
                </View>
              </LinearGradient>
            </Pressable>
          ) : (
            <Pressable
              accessibilityLabel="Escanear QR code do carregador"
              accessibilityRole="button"
              onPress={() => router.push('/scan')}
              style={({ pressed }) => [styles.scanCard, Shadow.coral, pressed && styles.pressed]}>
              <LinearGradient
                colors={[Colors.coralAction, '#A9142B']}
                end={{ x: 1, y: 1 }}
                start={{ x: 0, y: 0 }}
                style={styles.scanGradient}>
                <View style={styles.scanIcon}><ScanLine color={Colors.white} size={32} /></View>
                <View style={styles.scanCopy}>
                  <Text style={styles.scanTitle}>Escanear QR</Text>
                  <Text style={styles.scanSubtitle}>Aponte para o código na vaga</Text>
                </View>
                <Text style={styles.scanArrow}>→</Text>
              </LinearGradient>
            </Pressable>
          )}

          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>ELETROPOSTOS</Text>
              <Text style={styles.sectionTitle}>Perto de você</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={locating}
              onPress={useCurrentLocation}
              style={({ pressed }) => [styles.locationButton, pressed && styles.pressed]}>
              <LocateFixed color={locating ? Colors.textFaint : Colors.coral} size={17} />
              <Text style={styles.locationText}>{locating ? 'Localizando…' : 'Minha posição'}</Text>
            </Pressable>
          </View>

          <View style={styles.searchField}>
            <Search color={Colors.textFaint} size={18} />
            <TextInput
              onChangeText={setQuery}
              placeholder="Buscar bairro ou endereço"
              placeholderTextColor={Colors.textFaint}
              selectionColor={Colors.coral}
              style={styles.searchInput}
              value={query}
            />
          </View>

          <StationMap
            chargers={chargers}
            onSelectStation={(stationId) => {
              setSelectedStationId(stationId);
              router.push(`/station/${stationId}`);
            }}
            selectedStationId={selectedStationId}
            stations={filteredStations}
            userCoordinate={userCoordinate}
          />

          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Mais próximos</Text>
            <View style={styles.countPill}><MapPin color={Colors.textMuted} size={11} /><Text style={styles.countText}>{isStationsLoading ? 'Atualizando…' : `${filteredStations.length} locais`}</Text></View>
          </View>

          <View style={styles.stationList}>
            {filteredStations.map((station) => (
              <StationCard
                distanceKm={distanceInKm(userCoordinate, station.coordinates)}
                key={station.id}
                onPress={() => router.push(`/station/${station.id}`)}
                station={station}
              />
            ))}
            {filteredStations.length === 0 && !isStationsLoading ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Nenhum eletroposto encontrado</Text>
                <Text style={styles.emptyText}>{stationsError || 'Tente buscar por outro bairro ou endereço.'}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: Colors.background, flex: 1 },
  scrollContent: { paddingBottom: 34 },
  content: { alignSelf: 'center', maxWidth: MaxContentWidth, paddingHorizontal: 18, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14 },
  headerButton: { alignItems: 'center', backgroundColor: Colors.surface, borderColor: Colors.border, borderRadius: 21, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  notificationDot: { backgroundColor: Colors.coral, borderColor: Colors.surface, borderRadius: 4, borderWidth: 2, height: 8, position: 'absolute', right: 8, top: 7, width: 8 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  greeting: { marginBottom: 22, marginTop: 12 },
  greetingMuted: { color: Colors.textMuted, fontFamily: Fonts.medium, fontSize: 13 },
  greetingTitle: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 25, letterSpacing: -0.8, marginTop: 4 },
  scanCard: { borderRadius: Radius.large, marginBottom: 32 },
  scanGradient: { alignItems: 'center', borderRadius: Radius.large, flexDirection: 'row', gap: 14, minHeight: 94, paddingHorizontal: 18 },
  scanIcon: { alignItems: 'center', backgroundColor: '#FFFFFF22', borderColor: '#FFFFFF38', borderRadius: 18, borderWidth: 1, height: 58, justifyContent: 'center', width: 58 },
  scanCopy: { flex: 1 },
  scanTitle: { color: Colors.white, fontFamily: Fonts.bold, fontSize: 18 },
  scanSubtitle: { color: '#FFFFFFCB', fontFamily: Fonts.regular, fontSize: 11, marginTop: 2 },
  scanArrow: { color: Colors.white, fontFamily: Fonts.regular, fontSize: 25 },
  activeCard: { borderRadius: Radius.large, marginBottom: 32, overflow: 'hidden' },
  activeGradient: { gap: 16, minHeight: 130, padding: 17 },
  activeTop: { alignItems: 'center', flexDirection: 'row', gap: 11 },
  activeIcon: { alignItems: 'center', backgroundColor: '#FFFFFF20', borderRadius: 14, height: 42, justifyContent: 'center', width: 42 },
  activeCopy: { flex: 1 },
  activeEyebrow: { color: '#FFFFFFC9', fontFamily: Fonts.semiBold, fontSize: 8, letterSpacing: 1.3 },
  activeTitle: { color: Colors.white, fontFamily: Fonts.semiBold, fontSize: 13, marginTop: 2 },
  livePill: { alignItems: 'center', backgroundColor: '#00000026', borderRadius: Radius.pill, flexDirection: 'row', gap: 5, paddingHorizontal: 8, paddingVertical: 5 },
  liveDot: { backgroundColor: Colors.white, borderRadius: 3, height: 6, width: 6 },
  liveText: { color: Colors.white, fontFamily: Fonts.bold, fontSize: 7, letterSpacing: 0.7 },
  activeMetrics: { alignItems: 'flex-end', flexDirection: 'row', gap: 14 },
  activeMetric: { color: Colors.white, fontFamily: Fonts.bold, fontSize: 17 },
  activeLabel: { color: '#FFFFFFAE', fontFamily: Fonts.regular, fontSize: 8 },
  activeDivider: { backgroundColor: '#FFFFFF36', height: 32, width: 1 },
  activeLink: { color: Colors.white, fontFamily: Fonts.semiBold, fontSize: 10, marginLeft: 'auto', paddingBottom: 8 },
  sectionHeader: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
  sectionEyebrow: { color: Colors.coralText, fontFamily: Fonts.semiBold, fontSize: 9, letterSpacing: 1.5 },
  sectionTitle: { color: Colors.text, fontFamily: Fonts.bold, fontSize: 21, marginTop: 3 },
  locationButton: { alignItems: 'center', backgroundColor: Colors.surface, borderColor: Colors.border, borderRadius: Radius.pill, borderWidth: 1, flexDirection: 'row', gap: 6, minHeight: 34, paddingHorizontal: 11 },
  locationText: { color: Colors.textMuted, fontFamily: Fonts.medium, fontSize: 9 },
  searchField: { alignItems: 'center', backgroundColor: Colors.surface, borderColor: Colors.border, borderRadius: Radius.pill, borderWidth: 1, flexDirection: 'row', gap: 10, marginBottom: 14, minHeight: 48, paddingHorizontal: 15 },
  searchInput: { color: Colors.text, flex: 1, fontFamily: Fonts.medium, fontSize: 12, minHeight: 46, paddingVertical: 0 },
  listHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 13, marginTop: 25 },
  listTitle: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 16 },
  countPill: { alignItems: 'center', backgroundColor: Colors.surface, borderRadius: Radius.pill, flexDirection: 'row', gap: 4, paddingHorizontal: 9, paddingVertical: 6 },
  countText: { color: Colors.textMuted, fontFamily: Fonts.medium, fontSize: 9 },
  stationList: { gap: 12 },
  empty: { alignItems: 'center', backgroundColor: Colors.surface, borderRadius: Radius.large, gap: 5, padding: 28 },
  emptyTitle: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 14 },
  emptyText: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 11 },
});
