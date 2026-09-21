"use client";
import type { GieState } from '@/domain/gie';

import type {
  ApiResource,
  ChargerProvisioning,
  ChargerProvisioningStationOption,
  ChargerCommand,
  ClaimChargerProvisioningRequest,
  CreateChargerProvisioningRequest,
  DashboardData,
  FrontSession,
  ManualReleaseRequest,
  ManualReleaseResult,
  PostpaidReleaseRequest,
  PostpaidReleaseResult,
  PostpaidSettlementRequest,
  PostpaidSettlementResult,
  ResourceRow,
} from "@/domain/emps";
import {
  mapChargerStatus,
  mapDashboardData,
  mapResourceList,
  mapUserRole,
  responseNumber,
  responseText,
} from "@/services/emps-mappers";

const SESSION_KEY = "emps_front_session:v2";
const LEGACY_SESSION_KEY = "emps_front_session";
const API_TIMEOUT_MS = 12_000;
const REFRESH_LOCK_NAME = "emps:web-session-refresh";
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(
  /\/$/,
  ""
);

export const empsApiUrl = API_URL;
export const EMPS_SESSION_CHANGED_EVENT = "emps:session-changed";

export const isDemoMode = process.env.NEXT_PUBLIC_EMPS_DEMO_MODE === "true";

let refreshInFlight: Promise<FrontSession> | null = null;
let sessionGeneration = 0;

class SessionExpiredError extends Error {}

function accessTokenExpiresAt(token: string) {
  if (typeof window === "undefined") return null;
  try {
    const encodedPayload = token.split(".")[1];
    if (!encodedPayload) return null;
    const normalized = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );
    const payload = JSON.parse(window.atob(padded)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1_000 : null;
  } catch {
    return null;
  }
}

export function millisecondsUntilSessionRefresh(token: string) {
  const expiresAt = accessTokenExpiresAt(token);
  if (expiresAt === null) return null;
  return Math.max(0, expiresAt - Date.now() - 60_000);
}

function notifySessionChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EMPS_SESSION_CHANGED_EVENT));
  }
}

const resourceEndpoints: Record<ApiResource, string> = {
  carregadores: "/chargers",
  sessoes: "/charging-sessions",
  pagamentos: "/payments",
  alertas: "/alerts",
  clientes: "/clients",
};

const wait = (ms = 180) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hasBrowserStorage() {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.sessionStorage);
  } catch {
    return false;
  }
}

function parseStoredSession(raw: string): FrontSession | null {
  try {
    const candidate = JSON.parse(raw) as Partial<FrontSession>;
    if (
      !candidate.usuarioId ||
      !candidate.nome ||
      !candidate.email ||
      !candidate.role ||
      !candidate.modo
    ) {
      return null;
    }

    if (candidate.modo === "api" && !candidate.token) return null;

    return {
      usuarioId: candidate.usuarioId,
      nome: candidate.nome,
      email: candidate.email,
      role: candidate.role,
      token: candidate.token ?? null,
      modo: candidate.modo,
    };
  } catch {
    return null;
  }
}

export const frontSession = {
  get(): FrontSession | null {
    if (!hasBrowserStorage()) return null;

    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      if (!raw) {
        window.sessionStorage.removeItem(LEGACY_SESSION_KEY);
        return null;
      }
      const session = parseStoredSession(raw);
      if (!session) window.sessionStorage.removeItem(SESSION_KEY);
      return session;
    } catch {
      return null;
    }
  },
  set(session: FrontSession) {
    if (!hasBrowserStorage()) return;
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      window.sessionStorage.removeItem(LEGACY_SESSION_KEY);
      sessionGeneration += 1;
    } catch {
      // A sessao continua valida para a requisicao atual mesmo sem persistencia.
    } finally {
      notifySessionChanged();
    }
  },
  clear() {
    if (!hasBrowserStorage()) return;
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
      window.sessionStorage.removeItem(LEGACY_SESSION_KEY);
      sessionGeneration += 1;
    } catch {
      // O navegador pode bloquear storage em contextos privados ou incorporados.
    } finally {
      notifySessionChanged();
    }
  },
};

async function demoRowsFor(resource: ApiResource): Promise<ResourceRow[]> {
  const { alerts, chargers, clients, payments, sessions } = await import(
    "@/data/mock/emps-mock-data"
  );
  const resources: Record<ApiResource, ResourceRow[]> = {
    carregadores: chargers,
    sessoes: sessions,
    pagamentos: payments,
    alertas: alerts,
    clientes: clients,
  };
  return resources[resource];
}

function extractErrorMessage(payload: unknown, status: number) {
  if (status === 429) {
    return "Muitas tentativas em pouco tempo. Aguarde um minuto antes de tentar novamente.";
  }
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (typeof payload === "object" && payload !== null) {
    const raw = payload as Record<string, unknown>;
    const message = raw.message ?? raw.error;
    if (Array.isArray(message)) return message.map(String).join(" ");
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return `A API EMPS respondeu com erro ${status}.`;
}

async function readResponse(response: Response) {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null) as Promise<unknown>;
  }
  return response.text().catch(() => "");
}

function redirectToLogin() {
  frontSession.clear();
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.replace("/login");
  }
}

function authenticationSession(
  payload: unknown,
  fallback?: FrontSession | { email: string }
): FrontSession {
  const raw = asRecord(payload);
  const user = asRecord(raw.user);
  const token = responseText(payload, "accessToken", "token");
  const usuarioId = String(user.id ?? user.usuarioId ?? "");

  if (!token || !usuarioId) {
    throw new SessionExpiredError(
      "A API nao devolveu uma sessao valida. Entre novamente."
    );
  }

  return {
    usuarioId,
    nome: String(
      user.name ??
        user.nome ??
        (fallback && "nome" in fallback ? fallback.nome : "Usuario EMPS")
    ),
    email: String(
      user.email ??
        (fallback && "email" in fallback ? fallback.email : "")
    )
      .trim()
      .toLowerCase(),
    role: mapUserRole(user.role),
    token,
    modo: "api",
  };
}

async function withRefreshLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(REFRESH_LOCK_NAME, operation);
  }
  return operation();
}

async function refreshApiSession(force = false): Promise<FrontSession> {
  const stored = frontSession.get();
  if (stored && (!force || stored.modo === "front-only")) return stored;
  if (isDemoMode) {
    throw new SessionExpiredError("Sua sessao expirou. Entre novamente.");
  }
  if (refreshInFlight) return refreshInFlight;

  const generationAtStart = sessionGeneration;
  refreshInFlight = withRefreshLock(async () => {
    let response: Response;
    const timeoutController = new AbortController();
    const timeout = window.setTimeout(
      () => timeoutController.abort(),
      API_TIMEOUT_MS
    );
    try {
      response = await fetch(`${API_URL}/auth/refresh`, {
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "POST",
        signal: timeoutController.signal,
      });
    } catch {
      if (timeoutController.signal.aborted) {
        throw new Error(
          "A renovacao da sessao demorou para responder. Tente novamente."
        );
      }
      throw new Error(
        `Nao foi possivel renovar a sessao pela API EMPS em ${API_URL}.`
      );
    } finally {
      window.clearTimeout(timeout);
    }

    const payload = await readResponse(response);
    if (!response.ok) {
      const error = new Error(extractErrorMessage(payload, response.status));
      if (response.status === 400 || response.status === 401) {
        if (generationAtStart === sessionGeneration) redirectToLogin();
        throw new SessionExpiredError(error.message);
      }
      throw error;
    }

    const nextSession = authenticationSession(payload, frontSession.get() ?? undefined);
    if (generationAtStart !== sessionGeneration) {
      const current = frontSession.get();
      if (current) return current;
      throw new SessionExpiredError("A sessao foi encerrada.");
    }
    frontSession.set(nextSession);
    return nextSession;
  }).finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function request(
  path: string,
  init: RequestInit = {},
  options: { authenticated?: boolean; retryAuthentication?: boolean } = {}
) {
  const authenticated = options.authenticated ?? true;
  let session = authenticated ? frontSession.get() : null;

  if (authenticated && (!session || session.modo !== "api" || !session.token)) {
    session = await refreshApiSession();
  }

  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");
  if (session?.token) headers.set("Authorization", `Bearer ${session.token}`);

  let response: Response;
  const timeoutController = new AbortController();
  const timeout = window.setTimeout(
    () => timeoutController.abort(),
    API_TIMEOUT_MS
  );
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      cache: "no-store",
      credentials: "include",
      headers,
      signal: init.signal ?? timeoutController.signal,
    });
  } catch {
    if (timeoutController.signal.aborted) {
      throw new Error(
        "A API EMPS demorou para responder. Verifique a rede e tente novamente."
      );
    }
    throw new Error(
      `Nao foi possivel conectar a API EMPS em ${API_URL}. Verifique se o backend esta em execucao.`
    );
  } finally {
    window.clearTimeout(timeout);
  }

  const payload = await readResponse(response);
  if (!response.ok) {
    if (
      response.status === 401 &&
      authenticated &&
      options.retryAuthentication !== false
    ) {
      await refreshApiSession(true);
      return request(path, init, {
        authenticated: true,
        retryAuthentication: false,
      });
    }
    if (response.status === 401 && authenticated) redirectToLogin();
    throw new Error(extractErrorMessage(payload, response.status));
  }

  return payload;
}

async function demoLogin(email: string, password: string) {
  await wait();

  if (!email.includes("@") || password.trim().length < 6) {
    throw new Error("Informe e-mail valido e senha com pelo menos 6 caracteres.");
  }

  const session: FrontSession = {
    usuarioId: "usr_admin_front",
    nome: "Administrador EMPS",
    email,
    role: "admin",
    token: null,
    modo: "front-only",
  };

  frontSession.set(session);
  return session;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function mapProvisioning(value: unknown): ChargerProvisioning {
  const raw = asRecord(value);
  return {
    ...(raw as unknown as ChargerProvisioning),
    phaseCount:
      raw.phaseCount === null || raw.phaseCount === undefined
        ? null
        : Number(raw.phaseCount),
    powerKw: Number(raw.powerKw ?? 0),
    pricePerKwh: Number(raw.pricePerKwh ?? 0),
  };
}

function mapProvisioningList(value: unknown): ChargerProvisioning[] {
  return Array.isArray(value) ? value.map(mapProvisioning) : [];
}

export const api = {
  stations: () => request('/stations') as Promise<Array<{id:string;name:string}>>,
  createStation: (body:unknown) => request('/stations',{method:'POST',body:JSON.stringify(body)}),
  gieState: (stationId:string) => request('/stations/'+encodeURIComponent(stationId)+'/gie/state') as Promise<GieState>,
  gieAction: (stationId:string,path:string,body:unknown) => request('/stations/'+encodeURIComponent(stationId)+'/gie/'+path,{method:'POST',body:JSON.stringify(body)}),
  cashQuote: (sessionId:string) => request('/charging-sessions/'+encodeURIComponent(sessionId)+'/quote') as Promise<{energyKwh:number;pricePerKwh:number;fixedFee:number;overstayFee?:number;energyAmount:number;total:number;quoteToken:string;elapsedMinutes:number}>,
  openCashSessions: () => request('/charging-sessions') as Promise<Array<{id:string;chargerId:string;startTime:string;pricePerKwhSnapshot:string;status:string;billingMode:string;sessionOrigin:string}>>,

  async login(email: string, password: string) {
    frontSession.clear();
    if (refreshInFlight) await refreshInFlight.catch(() => undefined);
    if (isDemoMode) return demoLogin(email, password);

    const payload = await withRefreshLock(() =>
      request(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
        },
        { authenticated: false }
      )
    );
    const session = authenticationSession(payload, { email });

    frontSession.set(session);
    return session;
  },

  async ensureSession() {
    const session = frontSession.get();
    if (session?.modo === "front-only") return session;
    if (
      session?.token &&
      (millisecondsUntilSessionRefresh(session.token) ?? 1) > 0
    ) {
      return session;
    }
    if (session) return refreshApiSession(true);
    return refreshApiSession();
  },

  async refreshSession() {
    return refreshApiSession(true);
  },

  async logout() {
    const pendingRefresh = refreshInFlight;
    frontSession.clear();
    if (pendingRefresh) await pendingRefresh.catch(() => undefined);
    try {
      if (!isDemoMode) {
        await withRefreshLock(() =>
          fetch(`${API_URL}/auth/logout`, {
            cache: "no-store",
            credentials: "include",
            headers: { Accept: "application/json" },
            method: "POST",
          })
        );
      }
    } catch {
      // O logout local deve funcionar mesmo se a API estiver temporariamente offline.
    } finally {
      frontSession.clear();
      if (typeof window !== "undefined") window.location.assign("/login");
    }
  },

  async dashboard(): Promise<DashboardData> {
    if (isDemoMode) {
      await wait();
      const { dashboardData } = await import("@/data/mock/emps-mock-data");
      return clone(dashboardData);
    }

    const [summary, carregadores, sessoes, pagamentos, alertas] =
      await Promise.all([
        request("/dashboard/summary"),
        request("/chargers"),
        request("/charging-sessions"),
        request("/payments"),
        request("/alerts"),
      ]);

    return mapDashboardData(summary, {
      carregadores,
      sessoes,
      pagamentos,
      alertas,
    });
  },

  async list<T extends ResourceRow>(resource: ApiResource): Promise<T[]> {
    if (isDemoMode) {
      await wait();
      return clone(await demoRowsFor(resource)) as T[];
    }

    const payload = await request(resourceEndpoints[resource]);
    return mapResourceList(resource, payload) as T[];
  },

  async provisioningStations(): Promise<ChargerProvisioningStationOption[]> {
    if (isDemoMode) {
      return [
        {
          _count: { chargers: 1, provisionings: 0 },
          city: "São Paulo",
          code: "EMPS-PAULISTA",
          id: "st_001",
          name: "EMPS Paulista",
          state: "SP",
          status: "ACTIVE",
        },
      ];
    }
    const payload = await request("/charger-provisionings/stations");
    return Array.isArray(payload)
      ? (payload as ChargerProvisioningStationOption[])
      : [];
  },

  async listProvisionings(): Promise<ChargerProvisioning[]> {
    if (isDemoMode) return [];
    return mapProvisioningList(await request("/charger-provisionings"));
  },

  async createProvisioning(
    input: CreateChargerProvisioningRequest
  ): Promise<ChargerProvisioning & { activationCode: string }> {
    if (isDemoMode) {
      throw new Error("O cadastro físico exige a API EMPS conectada.");
    }
    const payload = await request("/charger-provisionings", {
      body: JSON.stringify(input),
      method: "POST",
    });
    const record = asRecord(payload);
    return {
      ...mapProvisioning(record),
      activationCode: String(record.activationCode ?? ""),
    };
  },

  async claimProvisioning(input: ClaimChargerProvisioningRequest) {
    const payload = await request(
      "/device/v1/charger-provisionings/claim",
      { body: JSON.stringify(input), method: "POST" },
      { authenticated: false }
    );
    return asRecord(payload);
  },

  async approveProvisioning(id: string): Promise<ChargerProvisioning> {
    return mapProvisioning(
      await request(`/charger-provisionings/${encodeURIComponent(id)}/approve`, {
        body: JSON.stringify({}),
        method: "POST",
      })
    );
  },

  async rejectProvisioning(
    id: string,
    reason: string
  ): Promise<ChargerProvisioning> {
    return mapProvisioning(
      await request(`/charger-provisionings/${encodeURIComponent(id)}/reject`, {
        body: JSON.stringify({ reason }),
        method: "POST",
      })
    );
  },

  async cancelProvisioning(id: string): Promise<ChargerProvisioning> {
    return mapProvisioning(
      await request(`/charger-provisionings/${encodeURIComponent(id)}/cancel`, {
        body: JSON.stringify({}),
        method: "POST",
      })
    );
  },

  async deleteProvisioning(id: string): Promise<{ deleted: true; id: string }> {
    if (isDemoMode) {
      throw new Error("A exclusão exige a API EMPS conectada.");
    }
    return (await request(
      `/charger-provisionings/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    )) as { deleted: true; id: string };
  },

  async resolveAlert(alertaId: string) {
    if (isDemoMode) {
      await wait(120);
      return { ok: true, alertaId, status: "resolvido" as const };
    }

    await request(`/alerts/${encodeURIComponent(alertaId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "RESOLVED" }),
    });
    return { ok: true, alertaId, status: "resolvido" as const };
  },

  async finishSession(sessaoId: string) {
    if (isDemoMode) {
      await wait(120);
      return { ok: true, sessaoId, status: "finalizada" as const };
    }

    await request(`/charging-sessions/${encodeURIComponent(sessaoId)}/finish`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    return { ok: true, sessaoId, status: "finalizada" as const };
  },

  async requestChargerStatus(carregadorId: string) {
    if (isDemoMode) {
      await wait(120);
      return { ok: true, carregadorId, queued: true };
    }

    await request(`/chargers/${encodeURIComponent(carregadorId)}/commands`, {
      method: "POST",
      body: JSON.stringify({ command: "sincronizar_status" }),
    });
    return { ok: true, carregadorId, queued: true };
  },

  async sendChargerCommand(carregadorId: string, command: ChargerCommand) {
    if (isDemoMode) {
      await wait(140);
      return {
        ok: true,
        carregadorId,
        command,
        processedAt: new Date().toISOString(),
      };
    }

    const payload = await request(
      `/chargers/${encodeURIComponent(carregadorId)}/commands`,
      {
        method: "POST",
        body: JSON.stringify({ command }),
      }
    );
    return {
      ok: true,
      carregadorId,
      command,
      processedAt:
        responseText(payload, "processedAt", "updatedAt", "createdAt") ||
        new Date().toISOString(),
    };
  },

  async registerPayment(pagamentoId: string) {
    if (isDemoMode) {
      await wait(120);
      return { ok: true, pagamentoId, status: "aprovado" as const };
    }

    await request(`/payments/${encodeURIComponent(pagamentoId)}/approve`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    return { ok: true, pagamentoId, status: "aprovado" as const };
  },

  async releaseChargerManually(
    releaseRequest: ManualReleaseRequest
  ): Promise<ManualReleaseResult> {
    if (releaseRequest.valorRecebido <= 0 || releaseRequest.tarifaKwh <= 0) {
      throw new Error("Informe um valor recebido valido para liberar energia.");
    }

    if (isDemoMode) {
      await wait(180);
      return {
        ok: true,
        liberacaoId: `manual_${Date.now()}`,
        sessaoId: `ses_manual_${Date.now()}`,
        carregadorId: releaseRequest.carregadorId,
        chargerStatus: "em_uso",
        valorRecebido: releaseRequest.valorRecebido,
        energiaLiberadaKwh: Number(
          (releaseRequest.valorRecebido / releaseRequest.tarifaKwh).toFixed(2)
        ),
        status: "liberacao_manual_confirmada",
      };
    }

    const { carregadorId, ...releaseBody } = releaseRequest;
    const body = {
      ...releaseBody,
      operadorId: frontSession.get()?.usuarioId ?? releaseBody.operadorId,
    };
    const payload = await request(
      `/chargers/${encodeURIComponent(carregadorId)}/manual-release`,
      { method: "POST", body: JSON.stringify(body) }
    );
    return {
      ok: true,
      liberacaoId:
        responseText(payload, "liberacaoId", "releaseId", "id") || carregadorId,
      sessaoId: responseText(payload, "sessaoId", "sessionId"),
      carregadorId:
        responseText(payload, "carregadorId", "chargerId") || carregadorId,
      chargerStatus: mapChargerStatus(
        responseText(payload, "chargerStatus", "status") || "IN_USE"
      ) as "em_uso",
      valorRecebido:
        responseNumber(payload, "valorRecebido", "amountReceived") ||
        releaseRequest.valorRecebido,
      energiaLiberadaKwh:
        responseNumber(payload, "energiaLiberadaKwh", "releasedEnergyKwh") ||
        Number((releaseRequest.valorRecebido / releaseRequest.tarifaKwh).toFixed(2)),
      status: "liberacao_manual_confirmada",
    };
  },

  async startPostpaidCashSession(
    postpaidRequest: PostpaidReleaseRequest
  ): Promise<PostpaidReleaseResult> {
    if (postpaidRequest.tarifaKwh <= 0) {
      throw new Error("Tarifa invalida para iniciar conta em aberto.");
    }

    if (isDemoMode) {
      await wait(180);
      const startedAt = new Date().toISOString();
      return {
        ok: true,
        liberacaoId: `postpaid_${Date.now()}`,
        sessaoId: `ses_postpaid_${Date.now()}`,
        carregadorId: postpaidRequest.carregadorId,
        chargerStatus: "em_uso",
        tarifaKwh: postpaidRequest.tarifaKwh,
        startedAt,
        status: "sessao_pos_paga_iniciada",
      };
    }

    const { carregadorId, ...postpaidBody } = postpaidRequest;
    const body = {
      ...postpaidBody,
      operadorId: frontSession.get()?.usuarioId ?? postpaidBody.operadorId,
    };
    const payload = await request(
      `/chargers/${encodeURIComponent(carregadorId)}/postpaid-sessions`,
      { method: "POST", body: JSON.stringify(body) }
    );
    const sessaoId = responseText(payload, "sessaoId", "sessionId", "id");
    if (!sessaoId) {
      throw new Error("A API nao devolveu a sessao pos-paga criada.");
    }

    return {
      ok: true,
      liberacaoId:
        responseText(payload, "liberacaoId", "releaseId") || sessaoId,
      sessaoId,
      carregadorId:
        responseText(payload, "carregadorId", "chargerId") || carregadorId,
      chargerStatus: mapChargerStatus(
        responseText(payload, "chargerStatus", "status") || "IN_USE"
      ) as "em_uso",
      tarifaKwh:
        responseNumber(payload, "tarifaKwh", "pricePerKwh") ||
        postpaidRequest.tarifaKwh,
      startedAt:
        responseText(payload, "startedAt", "dataInicio", "startTime") ||
        new Date().toISOString(),
      status: "sessao_pos_paga_iniciada",
    };
  },

  async settlePostpaidCashSession(
    settlementRequest: PostpaidSettlementRequest
  ): Promise<PostpaidSettlementResult> {
    if (settlementRequest.valorRecebido < settlementRequest.valorCobrado) {
      throw new Error("Valor recebido menor que o total da sessao.");
    }

    if (isDemoMode) {
      await wait(180);
      return {
        ok: true,
        sessaoId: settlementRequest.sessaoId,
        carregadorId: settlementRequest.carregadorId,
        chargerStatus: "disponivel",
        energiaConsumidaKwh: settlementRequest.energiaConsumidaKwh,
        valorCobrado: settlementRequest.valorCobrado,
        valorRecebido: settlementRequest.valorRecebido,
        troco: Number(
          (settlementRequest.valorRecebido - settlementRequest.valorCobrado).toFixed(2)
        ),
        processedAt: new Date().toISOString(),
        status: "sessao_pos_paga_finalizada",
      };
    }

    const { carregadorId, sessaoId, ...settlementBody } = settlementRequest;
    const body = {
      ...settlementBody,
      operadorId: frontSession.get()?.usuarioId ?? settlementBody.operadorId,
    };
    const payload = await request(
      `/charging-sessions/${encodeURIComponent(sessaoId)}/settle-cash`,
      { method: "POST", body: JSON.stringify(body) }
    );
    return {
      ok: true,
      sessaoId: responseText(payload, "sessaoId", "sessionId") || sessaoId,
      carregadorId:
        responseText(payload, "carregadorId", "chargerId") || carregadorId,
      chargerStatus: mapChargerStatus(
        responseText(payload, "chargerStatus", "status") || "AVAILABLE"
      ) as "disponivel",
      energiaConsumidaKwh:
        responseNumber(payload, "energiaConsumidaKwh", "energyKwh") ||
        settlementRequest.energiaConsumidaKwh,
      valorCobrado:
        responseNumber(payload, "valorCobrado", "amountCharged") ||
        settlementRequest.valorCobrado,
      valorRecebido:
        responseNumber(payload, "valorRecebido", "amountReceived") ||
        settlementRequest.valorRecebido,
      troco:
        responseNumber(payload, "troco", "change") ||
        Number(
          (settlementRequest.valorRecebido - settlementRequest.valorCobrado).toFixed(2)
        ),
      processedAt:
        responseText(payload, "processedAt", "updatedAt", "endTime") ||
        new Date().toISOString(),
      status: "sessao_pos_paga_finalizada",
    };
  },
};
