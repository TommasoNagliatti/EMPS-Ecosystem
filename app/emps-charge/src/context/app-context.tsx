import {confirmProviderPayment} from '@/services/payment-sheet';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { EMPS_API_URL, EMPS_DEMO_MODE } from '@/config/runtime';
import { createStorageKeys } from '@/config/storage';
import {
  chargers as demoChargers,
  getCharger as getDemoCharger,
  getStation as getDemoStation,
  initialHistory,
  stations as demoStations,
} from '@/data/mock-data';
import type {
  ChargingSession,
  Charger,
  ConsumerUser,
  Coordinate,
  LiveSessionMetrics,
  PaymentMethod,
  Station,
} from '@/domain/models';
import {
  normalizeChargingSession,
  normalizeChargingSessions,
} from '@/domain/normalizers';
import {
  type AuthResult,
  type AuthTokens,
  createMobileApi,
  type ResolvedQr,
} from '@/services/mobile-api';
import {
  createRealtimeSocket,
  mapRealtimeChangeToInvalidation,
  mergeRealtimeInvalidations,
  parseRealtimeChange,
  type RealtimeInvalidation,
} from '@/services/realtime';
import { parseEmpsQrPublicToken, resolveEmpsQr } from '@/utils/qr';

const STORAGE = createStorageKeys(EMPS_DEMO_MODE);

const demoUser: ConsumerUser = {
  id: 'consumer_demo_001',
  name: 'Matheus',
  email: 'motorista@emps.com',
};

type StartSessionInput = {
  chargerId: string;
  paymentMethod: PaymentMethod;
  spendingLimit: number | null;
};

type AppContextValue = {
  isDemoMode: boolean;
  isHydrated: boolean;
  isRealtimeConnected: boolean;
  isStationsLoading: boolean;
  user: ConsumerUser | null;
  activeSession: ChargingSession | null;
  history: ChargingSession[];
  stations: Station[];
  chargers: Charger[];
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  getStation: (stationId: string) => Station | undefined;
  getCharger: (chargerId: string) => Charger | undefined;
  getStationChargers: (stationId: string) => Charger[];
  loadNearbyStations: (position: Coordinate, radiusKm?: number) => Promise<Station[]>;
  loadStation: (stationId: string) => Promise<Station>;
  loadCharger: (chargerId: string) => Promise<Charger>;
  resolveQrCode: (rawValue: string) => Promise<ResolvedQr>;
  hasQrBinding: (chargerId: string) => boolean;
  startSession: (input: StartSessionInput) => Promise<ChargingSession>;
  refreshActiveSession: () => Promise<ChargingSession | null>;
  refreshHistory: () => Promise<ChargingSession[]>;
  billingQuote: typeof api.billingQuote;
  paySession: (id:string)=>Promise<boolean>;
  finishSession: () => Promise<ChargingSession>;
};

type PendingStart = {
  signature: string;
  paymentKey: string;
  startKey: string;
};

const AppContext = createContext<AppContextValue | null>(null);

async function readSecret(key: string) {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function writeSecret(key: string, value: string | null) {
  if (Platform.OS === 'web') {
    if (value) await AsyncStorage.setItem(key, value);
    else await AsyncStorage.removeItem(key);
    return;
  }

  if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
}

async function storeTokens(tokens: AuthTokens | null) {
  await Promise.all([
    writeSecret(STORAGE.accessToken, tokens?.accessToken ?? null),
    writeSecret(STORAGE.refreshToken, tokens?.refreshToken ?? null),
  ]);
}

const authenticationLostHandlers = new Set<() => Promise<void>>();

const api = createMobileApi({
  baseUrl: EMPS_API_URL,
  getAccessToken: () => readSecret(STORAGE.accessToken),
  getRefreshToken: () => readSecret(STORAGE.refreshToken),
  onAuthenticationLost: async () => {
    await Promise.allSettled(
      [...authenticationLostHandlers].map((handler) => handler()),
    );
  },
  onTokensChanged: storeTokens,
});

function parseStoredValue<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const merged = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => merged.set(item.id, item));
  return [...merged.values()];
}

function createIdempotencyKey(scope: string, userId?: string) {
  const randomPart = Math.random().toString(36).slice(2, 12);
  return `${scope}_${userId ?? 'anonymous'}_${Date.now()}_${randomPart}`;
}

function requireChargingSession(value: unknown): ChargingSession {
  const session = normalizeChargingSession(value);
  if (!session) {
    throw new Error('A API retornou uma sessão de recarga inválida. Atualize e tente novamente.');
  }
  return session;
}

export function getLiveSessionMetrics(
  session: ChargingSession,
  demoPricePerKwh?: number,
  now = Date.now(),
): LiveSessionMetrics {
  const durationSeconds = Number.isFinite(session.durationSeconds)
    ? Math.max(0, session.durationSeconds)
    : 0;
  const energyKwh = Number.isFinite(session.energyKwh) ? Math.max(0, session.energyKwh) : 0;
  const totalCost = Number.isFinite(session.totalCost) ? Math.max(0, session.totalCost) : 0;
  const powerKw = Number.isFinite(session.powerKw) ? Math.max(0, session.powerKw) : 0;

  if (demoPricePerKwh === undefined) {
    return {
      durationSeconds,
      energyKwh,
      totalCost,
      powerKw,
    };
  }

  const startedAt = new Date(session.startedAt).getTime();
  const elapsedRealSeconds = Number.isFinite(startedAt)
    ? Math.max(0, (now - startedAt) / 1000)
    : 0;
  const simulatedSecondsOffset = Number.isFinite(session.simulatedSecondsOffset)
    ? Math.max(0, session.simulatedSecondsOffset)
    : 0;
  const liveDurationSeconds = simulatedSecondsOffset + elapsedRealSeconds;
  const liveEnergyKwh = energyKwh + (powerKw * elapsedRealSeconds) / 3600;
  const safePrice = Number.isFinite(demoPricePerKwh) ? Math.max(0, demoPricePerKwh) : 0;

  return {
    durationSeconds: liveDurationSeconds,
    energyKwh: liveEnergyKwh,
    totalCost: liveEnergyKwh * safePrice,
    powerKw,
  };
}

export function AppProvider({ children }: PropsWithChildren) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [isStationsLoading, setIsStationsLoading] = useState(false);
  const [user, setUser] = useState<ConsumerUser | null>(null);
  const [activeSession, setActiveSession] = useState<ChargingSession | null>(null);
  const [history, setHistory] = useState<ChargingSession[]>(EMPS_DEMO_MODE ? initialHistory : []);
  const [stations, setStations] = useState<Station[]>(EMPS_DEMO_MODE ? demoStations : []);
  const [chargers, setChargers] = useState<Charger[]>(EMPS_DEMO_MODE ? demoChargers : []);
  const [qrBindings, setQrBindings] = useState<Record<string, string>>({});
  const activeSessionRef = useRef<ChargingSession | null>(null);
  const historyRef = useRef<ChargingSession[]>(EMPS_DEMO_MODE ? initialHistory : []);
  const nearbyQueryRef = useRef<{position: Coordinate; radiusKm: number} | null>(null);
  const nearbyGenerationRef = useRef(0);
  const stationsRef = useRef<Station[]>(EMPS_DEMO_MODE ? demoStations : []);
  const chargersRef = useRef<Charger[]>(EMPS_DEMO_MODE ? demoChargers : []);
  const recentRealtimeEvents = useRef(new Set<string>());
  const authenticationEpochRef = useRef(0);
  const authenticatedUserIdRef = useRef<string | null>(null);
  const pendingRealtimeInvalidationRef = useRef<RealtimeInvalidation | null>(null);
  const realtimeFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeReconciliationRunningRef = useRef(false);
  const sessionRefreshGenerationRef = useRef(0);
  const historyRefreshGenerationRef = useRef(0);
  const pendingStart = useRef<PendingStart | null>(null);
  const pendingStopKey = useRef<string | null>(null);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    stationsRef.current = stations;
  }, [stations]);

  useEffect(() => {
    chargersRef.current = chargers;
  }, [chargers]);

  const clearAuthentication = useCallback(async () => {
    authenticationEpochRef.current += 1;
    sessionRefreshGenerationRef.current += 1;
    historyRefreshGenerationRef.current += 1;
    authenticatedUserIdRef.current = null;
    pendingRealtimeInvalidationRef.current = null;
    recentRealtimeEvents.current.clear();
    if (realtimeFlushTimerRef.current) {
      clearTimeout(realtimeFlushTimerRef.current);
      realtimeFlushTimerRef.current = null;
    }
    setStations([]);
    setChargers([]);
    nearbyQueryRef.current = null;
    nearbyGenerationRef.current += 1;
    setUser(null);
    setActiveSession(null);
    setHistory([]);
    setQrBindings({});
    setIsStationsLoading(false);
    setIsRealtimeConnected(false);
    await storeTokens(null);
    await AsyncStorage.multiRemove([STORAGE.user, STORAGE.activeSession, STORAGE.history]);
  }, []);

  useEffect(() => {
    authenticationLostHandlers.add(clearAuthentication);
    return () => {
      authenticationLostHandlers.delete(clearAuthentication);
    };
  }, [clearAuthentication]);

  const isAuthenticationCurrent = useCallback(
    (epoch: number, userId: string | null) =>
      authenticationEpochRef.current === epoch &&
      authenticatedUserIdRef.current === userId,
    [],
  );

  const cacheEntitiesForSessions = useCallback(
    async (sessions: ChargingSession[]) => {
      if (EMPS_DEMO_MODE || sessions.length === 0) return;
      const authenticationEpoch = authenticationEpochRef.current;
      const authenticatedUserId = authenticatedUserIdRef.current;

      const chargerIds = [...new Set(sessions.map((session) => session.chargerId))];
      const stationIds = [...new Set(sessions.map((session) => session.stationId))];
      const [chargerResults, stationResults] = await Promise.all([
        Promise.allSettled(chargerIds.map((id) => api.charger(id))),
        Promise.allSettled(stationIds.map((id) => api.station(id))),
      ]);
      const nextChargers = chargerResults.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const nextStations = stationResults.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      if (!isAuthenticationCurrent(authenticationEpoch, authenticatedUserId)) return;
      if (nextChargers.length > 0) setChargers((current) => mergeById(current, nextChargers));
      if (nextStations.length > 0) setStations((current) => mergeById(current, nextStations));
    },
    [isAuthenticationCurrent],
  );

  const synchronizeSessions = useCallback(async () => {
    if (EMPS_DEMO_MODE) return;
    const authenticationEpoch = authenticationEpochRef.current;
    const authenticatedUserId = authenticatedUserIdRef.current;
    const sessionGeneration = ++sessionRefreshGenerationRef.current;
    const historyGeneration = ++historyRefreshGenerationRef.current;
    const [rawActiveSession, rawHistory] = await Promise.all([
      api.activeSession(),
      api.sessionHistory(),
    ]);
    const nextActiveSession = normalizeChargingSession(rawActiveSession);
    const nextHistory = normalizeChargingSessions(rawHistory);
    if (!isAuthenticationCurrent(authenticationEpoch, authenticatedUserId)) return;
    if (sessionGeneration === sessionRefreshGenerationRef.current) {
      setActiveSession(nextActiveSession);
    }
    if (historyGeneration === historyRefreshGenerationRef.current) {
      setHistory(nextHistory);
    }
    await cacheEntitiesForSessions([
      ...(nextActiveSession ? [nextActiveSession] : []),
      ...nextHistory,
    ]);
  }, [cacheEntitiesForSessions, isAuthenticationCurrent]);

  useEffect(() => {
    let mounted = true;

    async function hydrate() {
      const entries = await AsyncStorage.multiGet([
        STORAGE.user,
        STORAGE.activeSession,
        STORAGE.history,
      ]);
      if (!mounted) return;

      const stored = Object.fromEntries(entries);
      const cachedUser = parseStoredValue<ConsumerUser | null>(stored[STORAGE.user], null);
      const cachedSession = normalizeChargingSession(
        parseStoredValue<unknown>(stored[STORAGE.activeSession], null),
      );
      const cachedHistory = normalizeChargingSessions(
        parseStoredValue<unknown>(
          stored[STORAGE.history],
          EMPS_DEMO_MODE ? initialHistory : [],
        ),
      );

      if (EMPS_DEMO_MODE) {
        authenticationEpochRef.current += 1;
        authenticatedUserIdRef.current = cachedUser?.id ?? null;
        setUser(cachedUser);
        setActiveSession(cachedSession);
        setHistory(cachedHistory);
        return;
      }

      const [accessToken, refreshToken] = await Promise.all([
        readSecret(STORAGE.accessToken),
        readSecret(STORAGE.refreshToken),
      ]);
      if (!mounted) return;

      if (!cachedUser || !accessToken || !refreshToken) {
        await clearAuthentication();
        return;
      }

      authenticationEpochRef.current += 1;
      authenticatedUserIdRef.current = cachedUser.id;
      setUser(cachedUser);
      try {
        await synchronizeSessions();
      } catch (error) {
        // Caches keep the authenticated app usable during a temporary outage.
        setActiveSession(cachedSession);
        setHistory(cachedHistory);
        console.warn('[emps-api] sincronização inicial indisponível', error);
      }
    }

    hydrate()
      .catch((error) => console.error('[emps-app] falha ao restaurar sessão', error))
      .finally(() => mounted && setIsHydrated(true));

    return () => {
      mounted = false;
    };
  }, [clearAuthentication, synchronizeSessions]);

  useEffect(() => {
    if (!isHydrated) return;

    const writes: [string, string][] = [[STORAGE.history, JSON.stringify(history)]];
    if (user) writes.push([STORAGE.user, JSON.stringify(user)]);
    if (activeSession) writes.push([STORAGE.activeSession, JSON.stringify(activeSession)]);

    AsyncStorage.multiSet(writes)
      .then(async () => {
        if (!user) await AsyncStorage.removeItem(STORAGE.user);
        if (!activeSession) await AsyncStorage.removeItem(STORAGE.activeSession);
      })
      .catch((error) => console.warn('[emps-app] não foi possível salvar o cache local', error));
  }, [activeSession, history, isHydrated, user]);

  const applyAuthentication = useCallback(
    async (result: AuthResult) => {
      authenticationEpochRef.current += 1;
      sessionRefreshGenerationRef.current += 1;
      historyRefreshGenerationRef.current += 1;
      authenticatedUserIdRef.current = result.user.id;
      await storeTokens(result);
      await AsyncStorage.setItem(STORAGE.user, JSON.stringify(result.user));
      setUser(result.user);
      setActiveSession(null);
      setHistory([]);
      if (!EMPS_DEMO_MODE) {
        try {
          await synchronizeSessions();
        } catch (error) {
          console.warn('[emps-api] login concluído, mas a sincronização ficou pendente', error);
        }
      }
    },
    [synchronizeSessions],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail.includes('@')) throw new Error('Informe um e-mail válido.');
      if (password.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');

      if (EMPS_DEMO_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 450));
        const nextUser =
          normalizedEmail === demoUser.email
            ? demoUser
            : {
                id: `consumer_${Date.now()}`,
                name: normalizedEmail.split('@')[0].replace(/[._-]/g, ' '),
                email: normalizedEmail,
              };
        await applyAuthentication({
          accessToken: `demo-access-${nextUser.id}`,
          refreshToken: `demo-refresh-${nextUser.id}`,
          user: nextUser,
        });
        setHistory(initialHistory);
        return;
      }

      await applyAuthentication(await api.login(normalizedEmail, password));
    },
    [applyAuthentication],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const normalizedName = name.trim();
      const normalizedEmail = email.trim().toLowerCase();
      if (normalizedName.split(/\s+/).length < 2) throw new Error('Informe seu nome completo.');
      if (!normalizedEmail.includes('@')) throw new Error('Informe um e-mail válido.');
      if (password.length < 8) throw new Error('Crie uma senha com pelo menos 8 caracteres.');

      if (EMPS_DEMO_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 550));
        const nextUser = {
          id: `consumer_${Date.now()}`,
          name: normalizedName,
          email: normalizedEmail,
        };
        await applyAuthentication({
          accessToken: `demo-access-${nextUser.id}`,
          refreshToken: `demo-refresh-${nextUser.id}`,
          user: nextUser,
        });
        setHistory(initialHistory);
        return;
      }

      await applyAuthentication(await api.register(normalizedName, normalizedEmail, password));
    },
    [applyAuthentication],
  );

  const logout = useCallback(async () => {
    if (!EMPS_DEMO_MODE) {
      const refreshToken = await readSecret(STORAGE.refreshToken);
      if (refreshToken) {
        try {
          await api.logout(refreshToken);
        } catch (error) {
          console.warn('[emps-api] logout remoto não confirmado; credenciais locais removidas', error);
        }
      }
    }
    await clearAuthentication();
  }, [clearAuthentication]);

  const getStation = useCallback(
    (stationId: string) => stations.find((station) => station.id === stationId),
    [stations],
  );
  const getCharger = useCallback(
    (chargerId: string) => chargers.find((charger) => charger.id === chargerId),
    [chargers],
  );
  const getStationChargers = useCallback(
    (stationId: string) => chargers.filter((charger) => charger.stationId === stationId && stations.find(s => s.id === stationId)?.chargerIds.includes(charger.id)),
    [chargers, stations],
  );

  const loadNearbyStations = useCallback(
    async (position: Coordinate, radiusKm = 25) => {
      if (EMPS_DEMO_MODE) {
        setStations(demoStations);
        setChargers(demoChargers);
        return demoStations;
      }

      const authenticationEpoch = authenticationEpochRef.current;
      const authenticatedUserId = authenticatedUserIdRef.current;
      nearbyQueryRef.current = {position, radiusKm};
      const generation = ++nearbyGenerationRef.current;
      setIsStationsLoading(true);
      try {
        const nearby = await api.nearbyStations(position, radiusKm);
        if (!isAuthenticationCurrent(authenticationEpoch, authenticatedUserId)) return [];
        if(generation !== nearbyGenerationRef.current) return [];
        setStations(nearby);
        const chargerIds = [...new Set(nearby.flatMap((station) => station.chargerIds))];
        const results = await Promise.allSettled(chargerIds.map((id) => api.charger(id)));
        const nearbyChargers = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        );
        if (!isAuthenticationCurrent(authenticationEpoch, authenticatedUserId)) return [];
        if(generation === nearbyGenerationRef.current) setChargers(nearbyChargers);
        return nearby;
      } finally {
        if (isAuthenticationCurrent(authenticationEpoch, authenticatedUserId)) {
          setIsStationsLoading(false);
        }
      }
    },
    [isAuthenticationCurrent],
  );

  const loadStation = useCallback(
    async (stationId: string) => {
      if (EMPS_DEMO_MODE) {
        const station = getDemoStation(stationId);
        if (!station) throw new Error('Eletroposto não encontrado.');
        return station;
      }

      const authenticationEpoch = authenticationEpochRef.current;
      const authenticatedUserId = authenticatedUserIdRef.current;
      const station = await api.station(stationId);
      if (!isAuthenticationCurrent(authenticationEpoch, authenticatedUserId)) return station;
      setStations((current) => mergeById(current, [station]));
      const results = await Promise.allSettled(station.chargerIds.map((id) => api.charger(id)));
      const stationChargers = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      if (!isAuthenticationCurrent(authenticationEpoch, authenticatedUserId)) return station;
      setChargers((current) => [...current.filter(c => c.stationId !== stationId), ...stationChargers.filter(c => c.stationId === stationId)]);
      return station;
    },
    [isAuthenticationCurrent],
  );

  const loadCharger = useCallback(
    async (chargerId: string) => {
      if (EMPS_DEMO_MODE) {
        const charger = getDemoCharger(chargerId);
        if (!charger) throw new Error('Carregador não encontrado.');
        return charger;
      }

      const authenticationEpoch = authenticationEpochRef.current;
      const authenticatedUserId = authenticatedUserIdRef.current;
      const charger = await api.charger(chargerId);
      if (!isAuthenticationCurrent(authenticationEpoch, authenticatedUserId)) return charger;
      setChargers((current) => mergeById(current, [charger]));
      const station = await api.station(charger.stationId);
      if (!isAuthenticationCurrent(authenticationEpoch, authenticatedUserId)) return charger;
      setStations((current) => mergeById(current, [station]));
      return charger;
    },
    [isAuthenticationCurrent],
  );

  const resolveQrCode = useCallback(
    async (rawValue: string) => {
      if (EMPS_DEMO_MODE) {
        const resolution = resolveEmpsQr(rawValue);
        if (!resolution.ok) throw new Error(resolution.message);
        const charger = getDemoCharger(resolution.chargerId);
        const station = charger ? getDemoStation(charger.stationId) : undefined;
        if (!charger || !station) throw new Error('Carregador não encontrado.');
        const resolved = {
          charger,
          qrBindingId: `demo-binding-${charger.id}`,
          station,
          tariffLockedUntil: new Date(Date.now() + 5 * 60_000).toISOString(),
        };
        setQrBindings((current) => ({ ...current, [charger.id]: resolved.qrBindingId }));
        return resolved;
      }

      const parsed = parseEmpsQrPublicToken(rawValue);
      if (!parsed.ok) throw new Error(parsed.message);
      const resolved = await api.resolveQr(parsed.publicToken);
      if (resolved.charger.stationId !== resolved.station.id) {
        throw new Error('O QR retornou um vínculo inconsistente. Não inicie a recarga.');
      }
      setStations((current) => mergeById(current, [resolved.station]));
      setChargers((current) => mergeById(current, [resolved.charger]));
      setQrBindings((current) => ({
        ...current,
        [resolved.charger.id]: resolved.qrBindingId,
      }));
      return resolved;
    },
    [],
  );

  const hasQrBinding = useCallback(
    (chargerId: string) => Boolean(qrBindings[chargerId]),
    [qrBindings],
  );

  const startSession = useCallback(
    async ({ chargerId, paymentMethod, spendingLimit }: StartSessionInput) => {
      if (activeSession) throw new Error('Você já tem uma recarga em andamento.');
      const charger = EMPS_DEMO_MODE ? getDemoCharger(chargerId) : getCharger(chargerId);
      if (!charger || charger.status !== 'available') {
        throw new Error('Este carregador não está disponível neste momento.');
      }

      if (EMPS_DEMO_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        const simulatedSecondsOffset = 12 * 60 + 34;
        const session: ChargingSession = {
          id: `ses_${Date.now()}`,
          stationId: charger.stationId,
          chargerId: charger.id,
          startedAt: new Date(Date.now() - simulatedSecondsOffset * 1000).toISOString(),
          status: 'charging',
          paymentMethod,
          spendingLimit,
          energyKwh: 0,
          totalCost: 0,
          powerKw: Math.min(charger.powerKw * 0.82, 74.6),
          durationSeconds: simulatedSecondsOffset,
          simulatedSecondsOffset: 0,
        };
        setActiveSession(session);
        return session;
      }

      const qrBindingId = qrBindings[chargerId];
      if (!qrBindingId) {
        throw new Error('Escaneie o QR desta vaga antes de autorizar o pagamento.');
      }

      const signature = `${chargerId}:${paymentMethod}:${spendingLimit ?? 'none'}`;
      if (!pendingStart.current || pendingStart.current.signature !== signature) {
        pendingStart.current = {
          signature,
          paymentKey: createIdempotencyKey('payment', user?.id),
          startKey: createIdempotencyKey('start', user?.id),
        };
      }

      const operation = pendingStart.current;
      let paymentIntent = await api.createPaymentIntent(
        chargerId,
        paymentMethod,
        spendingLimit,
        operation.paymentKey,
      );
      if (paymentIntent.status === 'rejected') {
        pendingStart.current = null;
        throw new Error('O pagamento foi recusado. Escolha outra forma de pagamento.');
      }
      if (paymentIntent.status === 'requires_action') {
        if(!paymentIntent.providerClientSecret)throw new Error('Confirmação indisponível. Tente novamente.');
        const result=await confirmProviderPayment(paymentIntent.providerClientSecret);
        if(result?.canceled)throw new Error('Pagamento cancelado. Você pode tentar novamente.');
        for(let i=0;i<10&&paymentIntent.status==='requires_action';i++){await new Promise(r=>setTimeout(r,600));paymentIntent=await api.paymentIntent(paymentIntent.id);}
        if(paymentIntent.status!=='authorized')throw new Error('Aguardando confirmação do pagamento pelo backend.');
      }

      const session = requireChargingSession(
        await api.startCharging({
          idempotencyKey: operation.startKey,
          paymentIntentId: paymentIntent.id,
          qrBindingId,
          spendingLimit,
        }),
      );
      pendingStart.current = null;
      sessionRefreshGenerationRef.current += 1;
      setActiveSession(session);
      return session;
    },
    [activeSession, getCharger, qrBindings, user?.id],
  );

  const refreshActiveSession = useCallback(async () => {
    if (EMPS_DEMO_MODE) return activeSessionRef.current;
    const authenticationEpoch = authenticationEpochRef.current;
    const authenticatedUserId = authenticatedUserIdRef.current;
    const generation = ++sessionRefreshGenerationRef.current;
    const nextSession = normalizeChargingSession(await api.activeSession());
    if (
      !isAuthenticationCurrent(authenticationEpoch, authenticatedUserId) ||
      generation !== sessionRefreshGenerationRef.current
    ) {
      return activeSessionRef.current;
    }
    setActiveSession(nextSession);
    if (nextSession) await cacheEntitiesForSessions([nextSession]);
    return nextSession;
  }, [cacheEntitiesForSessions, isAuthenticationCurrent]);

  const refreshHistory = useCallback(async () => {
    if (EMPS_DEMO_MODE) return historyRef.current;
    const authenticationEpoch = authenticationEpochRef.current;
    const authenticatedUserId = authenticatedUserIdRef.current;
    const generation = ++historyRefreshGenerationRef.current;
    const nextHistory = normalizeChargingSessions(await api.sessionHistory());
    if (
      !isAuthenticationCurrent(authenticationEpoch, authenticatedUserId) ||
      generation !== historyRefreshGenerationRef.current
    ) {
      return historyRef.current;
    }
    setHistory(nextHistory);
    await cacheEntitiesForSessions(nextHistory);
    return nextHistory;
  }, [cacheEntitiesForSessions, isAuthenticationCurrent]);

  const refreshCachedEntities = useCallback(async () => {
    if (EMPS_DEMO_MODE) return;
    const authenticationEpoch = authenticationEpochRef.current;
    const authenticatedUserId = authenticatedUserIdRef.current;
    if(nearbyQueryRef.current) {
      await loadNearbyStations(nearbyQueryRef.current.position, nearbyQueryRef.current.radiusKm);
      return;
    }
    const stationIds = [...new Set(stationsRef.current.map((station) => station.id))];
    const chargerIds = [...new Set(chargersRef.current.map((charger) => charger.id))];
    const [stationResults, chargerResults] = await Promise.all([
      Promise.allSettled(stationIds.map((id) => api.station(id))),
      Promise.allSettled(chargerIds.map((id) => api.charger(id))),
    ]);
    const nextStations = stationResults.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const nextChargers = chargerResults.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    if (!isAuthenticationCurrent(authenticationEpoch, authenticatedUserId)) return;
    setStations(nextStations);
    setChargers(nextChargers);
  }, [isAuthenticationCurrent, loadNearbyStations]);

  const flushRealtimeInvalidations = useCallback(async function flushPendingRealtimeInvalidations() {
    if (realtimeReconciliationRunningRef.current) return;
    realtimeReconciliationRunningRef.current = true;
    if (realtimeFlushTimerRef.current) {
      clearTimeout(realtimeFlushTimerRef.current);
      realtimeFlushTimerRef.current = null;
    }

    try {
      while (pendingRealtimeInvalidationRef.current) {
        const invalidation = pendingRealtimeInvalidationRef.current;
        pendingRealtimeInvalidationRef.current = null;
        const authenticatedUserId = authenticatedUserIdRef.current;
        if (!authenticatedUserId) continue;

        const active = activeSessionRef.current;
        const cachedChargerIds = new Set(
          chargersRef.current.map((charger) => charger.id),
        );
        const cachedStationIds = new Set(
          stationsRef.current.map((station) => station.id),
        );
        const chargerIds = invalidation.chargerIds.filter(
          (id) => cachedChargerIds.has(id) || active?.chargerId === id,
        );
        const stationIds = invalidation.stationIds.filter(
          (id) => cachedStationIds.has(id) || active?.stationId === id,
        );
        const refreshSessions =
          invalidation.refreshSessions ||
          invalidation.refreshHistory ||
          chargerIds.some((id) => active?.chargerId === id);

        const refreshes: Promise<unknown>[] = [];
        if (refreshSessions) refreshes.push(synchronizeSessions());
        refreshes.push(...chargerIds.map((id) => loadCharger(id)));
        refreshes.push(...stationIds.map((id) => loadStation(id)));
        if (invalidation.refreshCachedEntities) {
          refreshes.push(refreshCachedEntities());
        }

        const results = await Promise.allSettled(refreshes);
        if (
          authenticatedUserIdRef.current === authenticatedUserId &&
          results.some((result) => result.status === 'rejected')
        ) {
          console.warn('[emps-realtime] uma invalidação REST ficou pendente');
        }
      }
    } finally {
      realtimeReconciliationRunningRef.current = false;
      if (
        pendingRealtimeInvalidationRef.current &&
        !realtimeFlushTimerRef.current
      ) {
        realtimeFlushTimerRef.current = setTimeout(() => {
          realtimeFlushTimerRef.current = null;
          void flushPendingRealtimeInvalidations();
        }, 0);
      }
    }
  }, [loadCharger, loadStation, refreshCachedEntities, synchronizeSessions]);

  const enqueueRealtimeInvalidation = useCallback(
    (invalidation: RealtimeInvalidation) => {
      pendingRealtimeInvalidationRef.current = mergeRealtimeInvalidations(
        pendingRealtimeInvalidationRef.current,
        invalidation,
      );
      if (realtimeReconciliationRunningRef.current) return;
      if (realtimeFlushTimerRef.current) {
        clearTimeout(realtimeFlushTimerRef.current);
      }
      realtimeFlushTimerRef.current = setTimeout(() => {
        realtimeFlushTimerRef.current = null;
        void flushRealtimeInvalidations();
      }, 120);
    },
    [flushRealtimeInvalidations],
  );

  const handleRealtimeChange = useCallback(
    (payload: unknown) => {
      const parsed = parseRealtimeChange(payload);
      if (parsed) {
        if (
          parsed.customerId &&
          parsed.customerId !== authenticatedUserIdRef.current
        ) {
          return;
        }
        if (recentRealtimeEvents.current.has(parsed.eventId)) return;
        recentRealtimeEvents.current.add(parsed.eventId);
        if (recentRealtimeEvents.current.size > 200) {
          const oldestEventId = recentRealtimeEvents.current.values().next().value;
          if (oldestEventId) recentRealtimeEvents.current.delete(oldestEventId);
        }
      }

      enqueueRealtimeInvalidation(mapRealtimeChangeToInvalidation(payload));
    },
    [enqueueRealtimeInvalidation],
  );

  useEffect(() => {
    if (EMPS_DEMO_MODE || !isHydrated || !user?.id || !EMPS_API_URL) return;

    let disposed = false;
    let socket: ReturnType<typeof createRealtimeSocket> | null = null;
    let authenticationRetry: ReturnType<typeof setTimeout> | null = null;
    const readRealtimeToken = async () => {
      try {
        return await readSecret(STORAGE.accessToken);
      } catch (error) {
        console.warn('[emps-realtime] não foi possível ler o access token', error);
        return null;
      }
    };
    const connect = async () => {
      const token = await readRealtimeToken();
      if (disposed || !token) return;

      socket = createRealtimeSocket(EMPS_API_URL, token);
      const onConnect = () => setIsRealtimeConnected(false);
      const onReady = () => {
        if (authenticationRetry) clearTimeout(authenticationRetry);
        authenticationRetry = null;
        setIsRealtimeConnected(true);
        handleRealtimeChange(null);
      };
      const onDisconnect = (reason: string) => {
        setIsRealtimeConnected(false);
        if (reason !== 'io server disconnect' || disposed) return;
        void synchronizeSessions()
          .catch(() => undefined)
          .then(async () => {
            const nextToken = await readRealtimeToken();
            if (
              !disposed &&
              socket &&
              nextToken &&
              authenticatedUserIdRef.current
            ) {
              socket.auth = { token: nextToken };
              socket.connect();
            }
          });
      };
      const onConnectError = () => {
        setIsRealtimeConnected(false);
        if (disposed || !socket || socket.active || authenticationRetry) return;
        authenticationRetry = setTimeout(async () => {
          authenticationRetry = null;
          const nextToken = await readRealtimeToken();
          if (!disposed && socket && nextToken) {
            socket.auth = { token: nextToken };
            socket.connect();
          }
        }, 3_000);
      };
      const onChange = (payload: unknown) => {
        handleRealtimeChange(payload);
      };
      const onReconnectAttempt = async () => {
        const nextToken = await readRealtimeToken();
        if (!disposed && socket && nextToken) socket.auth = { token: nextToken };
      };

      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      socket.on('connect_error', onConnectError);
      socket.on('emps:ready', onReady);
      socket.on('emps:change', onChange);
      socket.io.on('reconnect_attempt', onReconnectAttempt);
      socket.connect();
    };

    void connect();
    return () => {
      disposed = true;
      if (authenticationRetry) clearTimeout(authenticationRetry);
      if (socket) {
        socket.io.removeAllListeners('reconnect_attempt');
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
  }, [handleRealtimeChange, isHydrated, synchronizeSessions, user?.id]);

  useEffect(() => {
    if (EMPS_DEMO_MODE || !isHydrated || !user?.id) return;
    const sessionSafetyInterval = setInterval(
      () =>
        enqueueRealtimeInvalidation({
          chargerIds: [],
          refreshCachedEntities: false,
          refreshHistory: true,
          refreshSessions: true,
          stationIds: [],
        }),
      isRealtimeConnected ? 60_000 : 15_000,
    );
    const entitySafetyInterval = setInterval(
      () =>
        enqueueRealtimeInvalidation({
          chargerIds: [],
          refreshCachedEntities: true,
          refreshHistory: false,
          refreshSessions: false,
          stationIds: [],
        }),
      5 * 60_000,
    );
    return () => {
      clearInterval(sessionSafetyInterval);
      clearInterval(entitySafetyInterval);
    };
  }, [enqueueRealtimeInvalidation, isHydrated, isRealtimeConnected, user?.id]);

  const paySession=useCallback(async(id:string)=>{
    const epoch=authenticationEpochRef.current,uid=authenticatedUserIdRef.current;
    await api.disconnectSession(id);
    if(!isAuthenticationCurrent(epoch,uid))return false;
    await refreshHistory();
    const payment=await api.paySession(id);
    if(payment.status==='requires_action'){
      if(!payment.providerClientSecret)throw new Error('Stripe não retornou os dados para confirmação.');
      const result=await confirmProviderPayment(payment.providerClientSecret);
      if(result?.canceled)return false;
    }
    for(let i=0;i<10;i++){
      if(!isAuthenticationCurrent(epoch,uid))return false;
      const rows=await refreshHistory();
      if(rows.find(s=>s.id===id)?.status==='completed')return true;
      await new Promise(r=>setTimeout(r,600));
    }
    return false;
  },[isAuthenticationCurrent,refreshHistory]);
  const finishSession = useCallback(async () => {
    if (!activeSession) throw new Error('Nenhuma recarga em andamento.');

    if (EMPS_DEMO_MODE) {
      await new Promise((resolve) => setTimeout(resolve, 850));
      const charger = getDemoCharger(activeSession.chargerId);
      const metrics = getLiveSessionMetrics(activeSession, charger?.pricePerKwh ?? 0);
      const completed: ChargingSession = {
        ...activeSession,
        ...metrics,
        status: 'completed',
        endedAt: new Date().toISOString(),
        transactionId: `EMPS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(
          Date.now(),
        ).slice(-5)}`,
      };
      setHistory((current) => [completed, ...current]);
      setActiveSession(null);
      return completed;
    }

    if (!pendingStopKey.current) {
      pendingStopKey.current = createIdempotencyKey('stop', user?.id);
    }
    const completed = requireChargingSession(
      await api.stopCharging(activeSession.id, pendingStopKey.current),
    );
    pendingStopKey.current = null;
    sessionRefreshGenerationRef.current += 1;
    historyRefreshGenerationRef.current += 1;
    setHistory((current) => [completed, ...current.filter((item) => item.id !== completed.id)]);
    setActiveSession(null);
    return completed;
  }, [activeSession, user?.id]);

  const value = useMemo<AppContextValue>(
    () => ({
      isDemoMode: EMPS_DEMO_MODE,
      isHydrated,
      isRealtimeConnected,
      isStationsLoading,
      user,
      activeSession,
      history,
      stations,
      chargers,
      login,
      register,
      logout,
      getStation,
      getCharger,
      getStationChargers,
      loadNearbyStations,
      loadStation,
      loadCharger,
      resolveQrCode,
      hasQrBinding,
      startSession,
      refreshActiveSession,
      refreshHistory,
      finishSession,
      paySession,
      billingQuote:api.billingQuote,
    }),
    [
      activeSession,
      chargers,
      finishSession,
      paySession,
      getCharger,
      getStation,
      getStationChargers,
      hasQrBinding,
      history,
      isHydrated,
      isRealtimeConnected,
      isStationsLoading,
      loadCharger,
      loadNearbyStations,
      loadStation,
      login,
      logout,
      refreshActiveSession,
      refreshHistory,
      register,
      resolveQrCode,
      startSession,
      stations,
      user,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
