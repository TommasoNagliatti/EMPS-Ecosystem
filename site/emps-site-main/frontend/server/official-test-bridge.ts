type TestSession = { chargerId: string; operatorId: string };
type BridgeState = {
  sessions: Map<string, TestSession>;
  busy: Set<string>;
};
type BridgeOptions = {
  enabled: boolean;
  sandboxVerifiedUntil: number;
  fetcher?: typeof fetch;
  now?: () => number;
  state: BridgeState;
  onSessionCreated?: (id: string, session: TestSession) => void;
};

const UPSTREAM = 'https://api.emps-charge.tech';
const STATION = '13';
const CHARGERS = new Set(['49', '50', '51']);
const AUTH = new Set(['auth/login', 'auth/refresh', 'auth/logout']);
const READ = /^(?:auth\/(?:health|me)|dashboard\/(?:panel|summary)|stations(?:\/\d+(?:\/gie\/state)?)?|(?:chargers|charging-sessions|payments|clients|alerts)(?:\/\d+(?:\/quote)?)?|charger-provisionings(?:\/(?:stations|\d+))?|v2\/(?:stations|chargers)(?:\/[A-Za-z0-9_-]+)*|platform\/invites)$/;

export function createBridgeState(): BridgeState {
  return { sessions: new Map(), busy: new Set() };
}

function fail(status: number, message: string) {
  return Response.json({ message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function localUrl(url: URL) {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '3010';
}

function cookieHeader(value: string | null) {
  return value?.split(';').map(part => part.trim()).find(part => /^emps_web_refresh=[A-Za-z0-9._~-]+$/.test(part));
}

function forwardedResponse(response: Response) {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  headers.set('Content-Type', response.headers.get('Content-Type') ?? 'application/json');
  for (const cookie of response.headers.getSetCookie()) {
    if (/^emps_web_refresh=/.test(cookie)) {
      // Keep HttpOnly, Secure, SameSite and expiry; only translate this cookie's path.
      headers.append('Set-Cookie', cookie.replace(/;\s*Path=\/auth(?=;|$)/i, '; Path=/api/official-test/auth'));
    }
  }
  return new Response(response.body, { status: response.status, headers });
}

export async function handleOfficialTestRequest(request: Request, parts: string[], options: BridgeOptions): Promise<Response> {
  if (!options.enabled) return fail(404, 'A conexao de teste esta desativada.');
  const url = new URL(request.url);
  const path = parts.join('/');
  if (!localUrl(url) || request.headers.get('host') !== url.host || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) {
    return fail(403, 'Esta conexao so funciona neste computador.');
  }
  const origin = request.headers.get('origin');
  if ((origin && origin !== url.origin) || (request.method !== 'GET' && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return fail(403, 'Origem da requisicao nao autorizada.');
  }
  const authRoute = request.method === 'POST' && AUTH.has(path);
  const readRoute = request.method === 'GET' && READ.test(path);
  const release = path.match(/^chargers\/(49|50|51)\/(manual-release|postpaid-sessions)$/);
  const settlement = path.match(/^charging-sessions\/(\d+)\/settle-cash$/);
  const command = path.match(/^chargers\/(49|50|51)\/commands$/);
  const writeRoute = request.method === 'POST' && (release || settlement || command);
  if (!authRoute && !readRoute && !writeRoute) return fail(403, 'Somente o Caixa de teste da instalacao 13 esta habilitado para alteracoes.');
  if (!readRoute && url.search) return fail(400, 'Parametros inesperados.');
  const authorization = request.headers.get('authorization');
  if (!authRoute && path !== 'auth/health' && !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization ?? '')) return fail(401, 'Entre novamente com sua conta EMPS.');

  let body: Record<string, unknown> | undefined;
  if (request.method === 'POST') {
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '') && path !== 'auth/refresh' && path !== 'auth/logout') return fail(415, 'Envie dados em JSON.');
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 16_384) { await reader.cancel(); return fail(413, 'Requisicao muito grande.'); }
        chunks.push(chunk.value);
      }
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    try {
      body = raw ? JSON.parse(raw) : {};
      if (!body || Array.isArray(body) || typeof body !== 'object') return fail(400, 'Dados invalidos.');
    } catch { return fail(400, 'Dados invalidos.'); }
  }

  const headers = new Headers({ Accept: 'application/json' });
  if (authorization) headers.set('Authorization', authorization);
  const station = request.headers.get('x-station-id');
  if (station) headers.set('X-Station-Id', station);
  if (authRoute) {
    const cookie = cookieHeader(request.headers.get('cookie'));
    if (cookie) headers.set('Cookie', cookie);
  }
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const upstream = (target: string, method = 'GET', payload?: Record<string, unknown>) => fetcher(`${UPSTREAM}/${target}`, {
    method, headers: new Headers([...headers, ...(payload ? [['Content-Type', 'application/json'] as [string, string]] : [])]),
    body: payload ? JSON.stringify(payload) : undefined, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000),
  });
  let lock: string | undefined;
  try {
    if (writeRoute) {
      const remaining = options.sandboxVerifiedUntil - now();
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 24 * 60 * 60_000) return fail(403, 'O acesso de teste expirou. Confira o gateway antes de ativar novamente.');
      if (station !== STATION) return fail(403, 'Selecione a instalacao 13 para usar o Caixa de teste.');
      const identity = await upstream('auth/me');
      if (!identity.ok) return forwardedResponse(identity);
      const user = await identity.json() as { id?: unknown; role?: unknown };
      // Station membership, not global role, authorizes operations in the official API.
      if (!/^\d+$/.test(String(user.id))) return fail(401, 'Conta nao identificada pela API oficial.');
      const operatorId = String(user.id);
      const chargerId = release?.[1] ?? command?.[1] ?? options.state.sessions.get(settlement?.[1] ?? '')?.chargerId;
      if (!chargerId || !CHARGERS.has(chargerId)) return fail(403, 'Somente sessoes criadas neste teste podem ser alteradas.');
      lock = chargerId;
      if (options.state.busy.has(lock)) { lock = undefined; return fail(409, 'Uma operacao ja esta em andamento. Atualize antes de tentar novamente.'); }
      options.state.busy.add(lock);
      const chargerResponse = await upstream(`chargers/${chargerId}`);
      if (!chargerResponse.ok) return forwardedResponse(chargerResponse);
      const charger = await chargerResponse.json() as { stationId?: unknown };
      if (String(charger.stationId) !== STATION) return fail(403, 'Este carregador nao pertence a instalacao de teste.');
      if (release) {
        const allowed = new Set(['tarifaKwh', 'operadorId', 'origem', 'motivo', 'modo', 'valorRecebido']);
        if (Object.keys(body!).some(key => !allowed.has(key)) || body!.origem !== 'caixa' || !Number.isFinite(body!.tarifaKwh) || Number(body!.tarifaKwh) <= 0) return fail(400, 'Dados de Caixa invalidos.');
        if (release[2] === 'manual-release' && (body!.motivo !== 'fallback_qr_code' || (body!.modo && body!.modo !== 'pre_pago') || !Number.isFinite(body!.valorRecebido) || Number(body!.valorRecebido) < 0.5 || Number(body!.valorRecebido) > 100)) return fail(400, 'Informe um valor de teste entre R$ 0,50 e R$ 100,00.');
        if (release[2] === 'postpaid-sessions' && (body!.motivo !== 'pagamento_no_encerramento' || body!.valorRecebido !== undefined || body!.modo !== undefined)) return fail(400, 'Dados de conta aberta invalidos.');
        if (options.state.sessions.size >= 1024) return fail(409, 'Limite de sessoes deste teste atingido.');
      } else {
        let sessionId = settlement?.[1];
        if (command) {
          if (Object.keys(body!).some(key => key !== 'command') || body!.command !== 'encerrar_carga') return fail(403, 'Somente encerrar a recarga de teste esta habilitado.');
          const sessionsResponse = await upstream('charging-sessions?status=ACTIVE');
          if (!sessionsResponse.ok) return forwardedResponse(sessionsResponse);
          const sessions = await sessionsResponse.json() as Array<{ id: unknown; chargerId: unknown }>;
          sessionId = String(sessions.find(session => String(session.chargerId) === chargerId)?.id ?? '');
        }
        const tracked = options.state.sessions.get(sessionId ?? '');
        if (!tracked || tracked.operatorId !== operatorId || tracked.chargerId !== chargerId) return fail(403, 'Esta sessao nao foi criada por sua conta neste teste.');
        const sessionResponse = await upstream(`charging-sessions/${sessionId}`);
        if (!sessionResponse.ok) return forwardedResponse(sessionResponse);
        const session = await sessionResponse.json() as { stationId?: unknown; chargerId?: unknown; clientId?: unknown; paymentIntentId?: unknown; sessionOrigin?: unknown; billingMode?: unknown; payments?: Array<{ status?: unknown }> };
        if (String(session.stationId) !== STATION || String(session.chargerId) !== chargerId || session.clientId != null || session.paymentIntentId != null || session.sessionOrigin !== 'ADMIN_SITE') return fail(403, 'Sessao comercial ou fora do escopo de teste.');
        if (settlement && (session.billingMode !== 'POSTPAID' || session.payments?.some(payment => payment.status === 'APPROVED'))) return fail(409, 'Esta sessao ja possui recebimento ou nao e uma conta pos-paga. Nenhum novo recebimento foi enviado.');
        if (settlement && (body!.origem !== 'caixa' || Number(body!.valorRecebido) > 100 || Object.keys(body!).some(key => !['origem', 'operadorId', 'energiaConsumidaKwh', 'valorCobrado', 'valorRecebido', 'quoteToken'].includes(key)))) return fail(400, 'Acerto fora do escopo de Caixa de teste.');
      }
      if (!command) body!.operadorId = operatorId;
    }
    const response = await upstream(path + url.search, request.method, body);
    if (release && writeRoute && response.ok) {
      const payload = await response.clone().json() as { sessaoId?: unknown };
      if (/^\d+$/.test(String(payload.sessaoId))) {
        const session = { chargerId: release[1], operatorId: String(body!.operadorId) };
        options.state.sessions.set(String(payload.sessaoId), session);
        options.onSessionCreated?.(String(payload.sessaoId), session);
      }
    }
    return forwardedResponse(response);
  } catch {
    return fail(502, request.method === 'POST' ? 'Nao foi possivel confirmar a operacao. Atualize sessoes e carregadores antes de tentar novamente; nao repita a liberacao automaticamente.' : 'Nao foi possivel consultar a API oficial. Tente atualizar.');
  } finally {
    if (lock) options.state.busy.delete(lock);
  }
}
