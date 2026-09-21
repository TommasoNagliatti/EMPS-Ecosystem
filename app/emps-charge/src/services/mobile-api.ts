import type {
  ChargingSession,
  Charger,
  ConsumerUser,
  Coordinate,
  PaymentMethod,
  Station,
} from '@/domain/models';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthResult = AuthTokens & {
  user: ConsumerUser;
};

export type ResolvedQr = {
  qrBindingId: string;
  station: Station;
  charger: Charger;
  tariffLockedUntil: string;
};

export type PaymentIntent = {
  id: string;
  status: 'requires_action' | 'authorized' | 'rejected';
  method: PaymentMethod;
  providerClientSecret?: string;
};

export type StartChargingInput = {
  qrBindingId: string;
  paymentIntentId: string;
  spendingLimit: number | null;
  idempotencyKey: string;
};

export interface MobileApi {
  login(email: string, password: string): Promise<AuthResult>;
  register(name: string, email: string, password: string): Promise<AuthResult>;
  logout(refreshToken: string): Promise<void>;
  nearbyStations(position: Coordinate, radiusKm?: number): Promise<Station[]>;
  station(stationId: string): Promise<Station>;
  charger(chargerId: string): Promise<Charger>;
  resolveQr(publicToken: string): Promise<ResolvedQr>;
  createPaymentIntent(
    chargerId: string,
    method: PaymentMethod,
    spendingLimit: number | null,
    idempotencyKey: string,
  ): Promise<PaymentIntent>;
  paymentIntent(paymentIntentId: string): Promise<PaymentIntent>;
  billingQuote(id:string):Promise<{frozen:boolean;breakdown:{customer:NonNullable<ChargingSession['billing']>}}> ;
  disconnectSession(id:string):Promise<unknown>;
  paySession(id:string):Promise<{status:string;provider:string;providerClientSecret?:string}>;
  startCharging(input: StartChargingInput): Promise<ChargingSession>;
  activeSession(): Promise<ChargingSession | null>;
  sessionHistory(): Promise<ChargingSession[]>;
  stopCharging(sessionId: string, idempotencyKey: string): Promise<ChargingSession>;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

type ClientOptions = {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  getRefreshToken: () => Promise<string | null>;
  onTokensChanged: (tokens: AuthTokens) => Promise<void>;
  onAuthenticationLost: () => Promise<void>;
};

type RequestOptions = RequestInit & {
  authenticated?: boolean;
  retryAuthentication?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function apiMessage(error: unknown) {
  if (error instanceof ApiRequestError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new ApiRequestError('A conexão demorou demais. Tente novamente.', 408, 'REQUEST_TIMEOUT');
  }
  return new ApiRequestError(
    'Não foi possível conectar à EMPS. Confira sua internet e tente novamente.',
    0,
    'NETWORK_ERROR',
  );
}

export function createMobileApi({
  baseUrl,
  getAccessToken,
  getRefreshToken,
  onTokensChanged,
  onAuthenticationLost,
}: ClientOptions): MobileApi {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, '');
  let refreshInFlight: Promise<AuthTokens> | null = null;

  async function execute<T>(
    path: string,
    init: RequestOptions,
    accessToken?: string | null,
  ): Promise<T> {
    if (!normalizedBaseUrl) {
      throw new ApiRequestError(
        'A URL da API EMPS não foi configurada neste aplicativo.',
        0,
        'API_URL_MISSING',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(`${normalizedBaseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...init.headers,
        },
        signal: controller.signal,
      });

      const rawBody = await response.text();
      let payload: unknown = null;
      if (rawBody.trim().length > 0) {
        try {
          payload = JSON.parse(rawBody) as unknown;
        } catch {
          throw new ApiRequestError(
            'A API EMPS retornou uma resposta inválida.',
            response.status,
            'INVALID_RESPONSE',
          );
        }
      }

      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.message === 'string'
            ? payload.message
            : 'Não foi possível concluir a solicitação.';
        const code =
          isRecord(payload) && typeof payload.code === 'string'
            ? payload.code
            : undefined;
        throw new ApiRequestError(
          message,
          response.status,
          code,
        );
      }

      if (response.status === 204) return undefined as T;
      if (rawBody.trim().length === 0) return null as T;
      if (isRecord(payload) && Object.prototype.hasOwnProperty.call(payload, 'data')) {
        return payload.data as T;
      }
      return payload as T;
    } catch (error) {
      throw apiMessage(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function refreshAuthentication(): Promise<AuthTokens> {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) {
        throw new ApiRequestError('Sua sessão expirou. Entre novamente.', 401, 'REFRESH_TOKEN_MISSING');
      }

      const refreshed = await execute<AuthResult>(
        '/mobile/v1/auth/refresh',
        {
          authenticated: false,
          body: JSON.stringify({ refreshToken }),
          method: 'POST',
          retryAuthentication: false,
        },
        null,
      );
      const tokens = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
      };
      await onTokensChanged(tokens);
      return tokens;
    })();

    try {
      return await refreshInFlight;
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        (error.status === 400 || error.status === 401)
      ) {
        await onAuthenticationLost();
      }
      throw error;
    } finally {
      refreshInFlight = null;
    }
  }

  async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
    const authenticated = init.authenticated !== false;
    const token = authenticated ? await getAccessToken() : null;

    try {
      return await execute<T>(path, init, token);
    } catch (error) {
      if (
        authenticated &&
        init.retryAuthentication !== false &&
        error instanceof ApiRequestError &&
        error.status === 401
      ) {
        const tokens = await refreshAuthentication();
        try {
          return await execute<T>(
            path,
            { ...init, retryAuthentication: false },
            tokens.accessToken,
          );
        } catch (retryError) {
          if (retryError instanceof ApiRequestError && retryError.status === 401) {
            await onAuthenticationLost();
          }
          throw retryError;
        }
      }
      throw error;
    }
  }

  return {
    login: (email, password) =>
      request<AuthResult>('/mobile/v1/auth/login', {
        authenticated: false,
        body: JSON.stringify({ email, password }),
        method: 'POST',
      }),
    register: (name, email, password) =>
      request<AuthResult>('/mobile/v1/auth/register', {
        authenticated: false,
        body: JSON.stringify({ name, email, password }),
        method: 'POST',
      }),
    logout: (refreshToken) =>
      request<void>('/mobile/v1/auth/logout', {
        body: JSON.stringify({ refreshToken }),
        method: 'POST',
        retryAuthentication: false,
      }),
    nearbyStations: (position, radiusKm = 25) => {
      const query = new URLSearchParams({
        lat: String(position.latitude),
        lng: String(position.longitude),
        radiusKm: String(radiusKm),
      });
      return request<Station[]>(`/mobile/v1/stations/nearby?${query}`);
    },
    station: (stationId) =>
      request<Station>(`/mobile/v1/stations/${encodeURIComponent(stationId)}`),
    charger: (chargerId) =>
      request<Charger>(`/mobile/v1/chargers/${encodeURIComponent(chargerId)}`),
    resolveQr: (publicToken) =>
      request<ResolvedQr>(`/mobile/v1/qr/${encodeURIComponent(publicToken)}`),
    createPaymentIntent: (chargerId, method, spendingLimit, idempotencyKey) =>
      request<PaymentIntent>('/mobile/v1/payment-intents', {
        body: JSON.stringify({ chargerId, method, spendingLimit }),
        headers: { 'Idempotency-Key': idempotencyKey },
        method: 'POST',
      }),
    billingQuote:(id)=>request(`/mobile/v1/charging-sessions/${encodeURIComponent(id)}/billing`),
    disconnectSession:(id)=>request(`/mobile/v1/charging-sessions/${encodeURIComponent(id)}/disconnect`,{method:'POST'}),
    paySession:(id)=>request(`/mobile/v1/charging-sessions/${encodeURIComponent(id)}/payment`,{method:'POST'}),
    paymentIntent: (paymentIntentId) =>
      request<PaymentIntent>(
        `/mobile/v1/payment-intents/${encodeURIComponent(paymentIntentId)}`,
      ),
    startCharging: (input) =>
      request<ChargingSession>('/mobile/v1/charging-sessions/start', {
        body: JSON.stringify(input),
        headers: { 'Idempotency-Key': input.idempotencyKey },
        method: 'POST',
      }),
    activeSession: () => request<ChargingSession | null>('/mobile/v1/charging-sessions/active'),
    sessionHistory: () => request<ChargingSession[]>('/mobile/v1/charging-sessions'),
    stopCharging: (sessionId, idempotencyKey) =>
      request<ChargingSession>(`/mobile/v1/charging-sessions/${encodeURIComponent(sessionId)}/stop`, {
        headers: { 'Idempotency-Key': idempotencyKey },
        method: 'POST',
      }),
  };
}
