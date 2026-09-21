import type {
  Alert,
  AlertSeverity,
  AlertStatus,
  ApiResource,
  Charger,
  ChargerEnergySource,
  ChargerStatus,
  ChargingSession,
  Client,
  DashboardData,
  DashboardSummary,
  EnergyFlowTelemetry,
  IntegrationHealth,
  Payment,
  PaymentStatus,
  ResourceRow,
  SessionStatus,
  TelemetryPoint,
  UserRole,
} from "@/domain/emps";

type JsonRecord = Record<string, unknown>;

const currentIso = () => new Date().toISOString();

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function firstDefined(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null);
}

function text(value: unknown, fallback = "") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function nullableText(value: unknown) {
  const valueAsText = text(value);
  return valueAsText || null;
}

function number(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function nullableNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = number(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

function iso(value: unknown, fallback = currentIso()) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }

  return fallback;
}

function optionalIso(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value as string | number);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.results)) return record.results;
  return [];
}

function enumKey(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

export function mapUserRole(value: unknown): UserRole {
  const role = enumKey(value);
  if (role === "ADMIN") return "admin";
  if (role === "GOODWE_ADMIN") return "goodwe";
  if (role === "STATION_OWNER") return "proprietario";
  return "operador";
}

export function mapChargerStatus(value: unknown): ChargerStatus {
  const statuses: Record<string, ChargerStatus> = {
    AVAILABLE: "disponivel",
    DISPONIVEL: "disponivel",
    IN_USE: "em_uso",
    EM_USO: "em_uso",
    BUSY: "em_uso",
    CHARGING: "em_uso",
    PREPARING: "em_uso",
    SUSPENDED: "em_uso",
    FINISHING: "em_uso",
    RESERVED: "em_uso",
    OFFLINE: "offline",
    UNAVAILABLE: "offline",
    MAINTENANCE: "manutencao",
    MANUTENCAO: "manutencao",
    CRITICAL_ERROR: "erro",
    ERROR: "erro",
    ERRO: "erro",
    FAULTED: "erro",
  };

  return statuses[enumKey(value)] ?? "offline";
}

export function mapSessionStatus(value: unknown): SessionStatus {
  const statuses: Record<string, SessionStatus> = {
    ACTIVE: "ativa",
    ATIVA: "ativa",
    FINISHED: "finalizada",
    COMPLETED: "finalizada",
    FINALIZADA: "finalizada",
    CANCELED: "cancelada",
    CANCELLED: "cancelada",
    CANCELADA: "cancelada",
    WAITING_PAYMENT: "aguardando_pagamento",
    AGUARDANDO_PAGAMENTO: "aguardando_pagamento",
  };

  return statuses[enumKey(value)] ?? "cancelada";
}

export function mapPaymentStatus(value: unknown): PaymentStatus {
  const statuses: Record<string, PaymentStatus> = {
    APPROVED: "aprovado",
    APROVADO: "aprovado",
    PAID: "aprovado",
    PENDING: "pendente",
    PENDENTE: "pendente",
    REJECTED: "recusado",
    DECLINED: "recusado",
    RECUSADO: "recusado",
    REFUNDED: "estornado",
    VOIDED: "estornado",
    ESTORNADO: "estornado",
  };

  return statuses[enumKey(value)] ?? "pendente";
}

function mapAlertStatus(value: unknown): AlertStatus {
  const statuses: Record<string, AlertStatus> = {
    OPEN: "aberto",
    ABERTO: "aberto",
    CHECKING: "verificando",
    VERIFYING: "verificando",
    VERIFICANDO: "verificando",
    RESOLVED: "resolvido",
    RESOLVIDO: "resolvido",
  };

  return statuses[enumKey(value)] ?? "aberto";
}

function mapAlertSeverity(value: unknown): AlertSeverity {
  const severities: Record<string, AlertSeverity> = {
    LOW: "baixa",
    BAIXA: "baixa",
    MEDIUM: "media",
    MEDIA: "media",
    HIGH: "alta",
    ALTA: "alta",
    CRITICAL: "critica",
    CRITICA: "critica",
  };

  return severities[enumKey(value)] ?? "media";
}

function mapPaymentMethod(value: unknown): Payment["metodo"] {
  const methods: Record<string, Payment["metodo"]> = {
    PIX: "PIX",
    CARD: "cartao",
    CARTAO: "cartao",
    DIGITAL_WALLET: "carteira",
    WALLET: "carteira",
    CARTEIRA: "carteira",
    CASH: "caixa",
    CAIXA: "caixa",
    SIMULATED: "simulado",
    SIMULADO: "simulado",
  };

  return methods[enumKey(value)] ?? "simulado";
}

function durationBetween(start: string, end: string | null) {
  const startMs = Date.parse(start);
  const endMs = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.round((endMs - startMs) / 60_000));
}

export function mapClient(value: unknown): Client {
  const raw = asRecord(value);
  const user = asRecord(raw.user);
  const sessions = array(raw.sessions).map(asRecord);
  const status = enumKey(firstDefined(raw.status, raw.active));

  return {
    usuarioId: text(firstDefined(raw.usuarioId, raw.id, raw.userId), "cliente-sem-id"),
    nome: text(firstDefined(raw.nome, raw.name), "Cliente sem nome"),
    email: text(firstDefined(raw.email, raw.userEmail, user.email), "Nao informado"),
    telefone: text(
      firstDefined(raw.telefone, raw.phone, raw.phoneNumber, user.phone),
      "Nao informado"
    ),
    veiculo: text(firstDefined(raw.veiculo, raw.vehicle, raw.vehicleModel), "Nao informado"),
    placa: text(firstDefined(raw.placa, raw.plate, raw.licensePlate), "Nao informada"),
    status:
      status === "INACTIVE" || status === "INATIVO" || status === "FALSE"
        ? "inativo"
        : "ativo",
    totalSessoes: number(firstDefined(raw.totalSessoes, raw.totalSessions), sessions.length),
    totalGasto: number(
      firstDefined(raw.totalGasto, raw.totalSpent),
      sessions.reduce(
        (sum, session) => sum + number(firstDefined(session.totalPrice, session.valorTotal)),
        0
      )
    ),
    criadoEm: iso(firstDefined(raw.criadoEm, raw.createdAt, raw.created_at)),
  };
}

export function mapCharger(value: unknown): Charger {
  const raw = asRecord(value);
  const station = asRecord(firstDefined(raw.station, raw.estacao));
  const liveStatus = asRecord(
    firstDefined(
      raw.liveStatus,
      raw.live_status,
      raw.telemetry,
      station.liveStatus,
      station.live_status
    )
  );
  const sessions = array(raw.sessions).map(asRecord);
  const activeSession =
    sessions.find((session) => mapSessionStatus(session.status) === "ativa") ??
    asRecord(firstDefined(raw.activeSession, liveStatus.activeSession));
  const activeClient = asRecord(firstDefined(activeSession.client, activeSession.user));
  const status = mapChargerStatus(
    firstDefined(
      liveStatus.operationalStatus,
      liveStatus.status,
      raw.status,
      raw.chargerStatus
    )
  );
  const maximumPower = number(
    firstDefined(
      raw.potenciaMaximaKw,
      raw.maxPowerKw,
      raw.powerKw,
      raw.ratedPowerKw,
      station.maxPowerKw,
      station.powerLimitKw
    )
  );

  return {
    carregadorId: text(firstDefined(raw.carregadorId, raw.id, raw.chargerId), "carregador-sem-id"),
    nome: text(firstDefined(raw.nome, raw.name), "Carregador"),
    status,
    potenciaMaximaKw: maximumPower,
    potenciaAtualKw: number(
      firstDefined(
        liveStatus.currentPowerKw,
        liveStatus.powerKw,
        raw.potenciaAtualKw,
        raw.currentPowerKw,
        raw.current_power_kw
      ),
      status === "em_uso" ? maximumPower : 0
    ),
    tarifaKwh: number(firstDefined(raw.tarifaKwh, raw.pricePerKwh, raw.price_per_kwh)),
    tipoConector: text(
      firstDefined(raw.tipoConector, raw.connectorType, raw.connector),
      "Nao informado"
    ),
    estacaoId: text(
      firstDefined(raw.estacaoId, raw.stationId, station.id, station.stationId),
      "estacao-emps"
    ),
    estacaoNome: text(
      firstDefined(raw.estacaoNome, raw.stationName, station.name, station.nome),
      "Eletroposto EMPS"
    ),
    localizacao: text(
      firstDefined(raw.localizacao, raw.location, station.address, station.endereco),
      "Local nao informado"
    ),
    serialNumber: text(
      firstDefined(raw.serialNumber, raw.serial, raw.ocppIdentity),
      text(firstDefined(raw.id, raw.chargerId), "Nao informado")
    ),
    ultimaComunicacao: iso(
      firstDefined(
        liveStatus.updatedAt,
        liveStatus.lastSeenAt,
        liveStatus.lastHeartbeatAt,
        raw.ultimaComunicacao,
        raw.lastCommunication,
        raw.lastSeenAt,
        raw.updatedAt,
        raw.createdAt
      )
    ),
    temperaturaC: nullableNumber(
      firstDefined(liveStatus.temperatureC, liveStatus.temperature, raw.temperaturaC, raw.temperature)
    ),
    energiaHojeKwh: number(
      firstDefined(
        liveStatus.energyTodayKwh,
        liveStatus.todayEnergyKwh,
        raw.energiaHojeKwh,
        raw.energyTodayKwh
      )
    ),
    receitaHoje: number(
      firstDefined(liveStatus.revenueToday, raw.receitaHoje, raw.revenueToday)
    ),
    usuarioAtualId:
      nullableText(
        firstDefined(
          liveStatus.currentUserId,
          raw.usuarioAtualId,
          raw.currentUserId,
          activeSession.clientId,
          activeClient.id
        )
      ) ?? null,
    sessoesHoje: number(
      firstDefined(liveStatus.sessionsToday, raw.sessoesHoje, raw.sessionsToday),
      sessions.length
    ),
    ocupacaoHojePercent: number(
      firstDefined(
        liveStatus.occupancyTodayPercent,
        raw.ocupacaoHojePercent,
        raw.occupancyTodayPercent,
        raw.occupancyRate
      )
    ),
    tempoMedioSessaoMinutos: number(
      firstDefined(
        liveStatus.averageSessionMinutes,
        raw.tempoMedioSessaoMinutos,
        raw.averageSessionMinutes,
        raw.averageChargingTime
      )
    ),
    motivoFalha:
      nullableText(firstDefined(liveStatus.failureReason, raw.motivoFalha, raw.failureReason)) ??
      null,
    motivoAtencao:
      nullableText(
        firstDefined(liveStatus.attentionReason, raw.motivoAtencao, raw.attentionReason)
      ) ?? null,
  };
}

export function mapChargingSession(value: unknown): ChargingSession {
  const raw = asRecord(value);
  const client = asRecord(firstDefined(raw.client, raw.user, raw.usuario));
  const charger = asRecord(firstDefined(raw.charger, raw.carregador));
  const payment = asRecord(firstDefined(raw.payment, raw.pagamento));
  const dataInicio = iso(firstDefined(raw.dataInicio, raw.startTime, raw.startedAt, raw.createdAt));
  const dataFim = optionalIso(firstDefined(raw.dataFim, raw.endTime, raw.finishedAt));
  const status = mapSessionStatus(raw.status);

  return {
    sessaoId: text(firstDefined(raw.sessaoId, raw.id, raw.sessionId), "sessao-sem-id"),
    usuarioId: text(firstDefined(raw.usuarioId, raw.clientId, raw.userId, client.id), "cliente-sem-id"),
    usuarioNome: text(
      firstDefined(raw.usuarioNome, raw.clientName, raw.userName, client.name, client.nome),
      "Cliente"
    ),
    carregadorId: text(
      firstDefined(raw.carregadorId, raw.chargerId, charger.id),
      "carregador-sem-id"
    ),
    carregadorNome: text(
      firstDefined(raw.carregadorNome, raw.chargerName, charger.name, charger.nome),
      "Carregador"
    ),
    status,
    dataInicio,
    dataFim,
    duracaoMinutos: number(
      firstDefined(raw.duracaoMinutos, raw.durationMinutes),
      durationBetween(dataInicio, dataFim)
    ),
    energiaKwh: number(firstDefined(raw.energiaKwh, raw.energyKwh)),
    valorTotal: number(firstDefined(raw.valorTotal, raw.totalPrice, raw.amount)),
    statusPagamento: mapPaymentStatus(
      firstDefined(
        raw.statusPagamento,
        raw.paymentStatus,
        payment.status,
        status === "finalizada" ? "PENDING" : undefined
      )
    ),
  };
}

export function mapPayment(value: unknown): Payment {
  const raw = asRecord(value);
  const session = asRecord(firstDefined(raw.session, raw.sessao));
  const client = asRecord(firstDefined(session.client, raw.client, raw.user));
  const charger = asRecord(firstDefined(session.charger, raw.charger));

  return {
    pagamentoId: text(firstDefined(raw.pagamentoId, raw.id, raw.paymentId), "pagamento-sem-id"),
    sessaoId: text(firstDefined(raw.sessaoId, raw.sessionId, session.id), "sessao-sem-id"),
    usuarioId: text(
      firstDefined(raw.usuarioId, raw.clientId, session.clientId, client.id),
      "cliente-sem-id"
    ),
    usuarioNome: text(
      firstDefined(raw.usuarioNome, raw.clientName, client.name, client.nome),
      "Cliente"
    ),
    carregadorId: text(
      firstDefined(raw.carregadorId, raw.chargerId, session.chargerId, charger.id),
      "carregador-sem-id"
    ),
    valorTotal: number(firstDefined(raw.valorTotal, raw.amount, raw.totalPrice)),
    status: mapPaymentStatus(raw.status),
    metodo: mapPaymentMethod(firstDefined(raw.metodo, raw.method)),
    dataPagamento: optionalIso(
      firstDefined(raw.dataPagamento, raw.paidAt, raw.processedAt)
    ),
    transactionId:
      nullableText(firstDefined(raw.transactionId, raw.transactionCode, raw.code)) ?? null,
  };
}

export function mapAlert(value: unknown): Alert {
  const raw = asRecord(value);
  const charger = asRecord(firstDefined(raw.charger, raw.carregador));
  const rawOrigin = enumKey(firstDefined(raw.origem, raw.origin));
  const origin: Alert["origem"] =
    rawOrigin === "SEMS" || rawOrigin === "SEMS+"
      ? "SEMS+"
      : rawOrigin === "REGRA_INTERNA" || rawOrigin === "INTERNAL_RULE"
        ? "regra interna"
        : "EMPS";

  return {
    alertaId: text(firstDefined(raw.alertaId, raw.id, raw.alertId), "alerta-sem-id"),
    carregadorId:
      nullableText(firstDefined(raw.carregadorId, raw.chargerId, charger.id)) ?? null,
    carregadorNome:
      nullableText(
        firstDefined(raw.carregadorNome, raw.chargerName, charger.name, charger.nome)
      ) ?? null,
    titulo: text(firstDefined(raw.titulo, raw.title), "Alerta operacional"),
    descricao: text(firstDefined(raw.descricao, raw.description), "Sem detalhes."),
    severidade: mapAlertSeverity(firstDefined(raw.severidade, raw.severity)),
    status: mapAlertStatus(raw.status),
    origem: origin,
    dataCriacao: iso(firstDefined(raw.dataCriacao, raw.createdAt, raw.created_at)),
  };
}

export function mapResourceList(
  resource: ApiResource,
  response: unknown
): ResourceRow[] {
  const values = array(response);

  if (resource === "carregadores") return values.map(mapCharger);
  if (resource === "sessoes") return values.map(mapChargingSession);
  if (resource === "pagamentos") return values.map(mapPayment);
  if (resource === "alertas") return values.map(mapAlert);
  return values.map(mapClient);
}

function telemetryLabel(raw: JsonRecord) {
  return text(firstDefined(raw.hora, raw.hour, raw.day, raw.label), "--");
}

function mapRevenuePoint(value: unknown): TelemetryPoint {
  const raw = asRecord(value);
  return {
    hora: telemetryLabel(raw),
    receita: number(firstDefined(raw.receita, raw.revenue, raw.amount)),
    energiaKwh: number(firstDefined(raw.energiaKwh, raw.energyKwh, raw.energy)),
    sessoes: number(firstDefined(raw.sessoes, raw.sessions, raw.count)),
  };
}

function mapEnergyPoint(value: unknown): TelemetryPoint {
  const raw = asRecord(value);
  return {
    hora: telemetryLabel(raw),
    receita: number(firstDefined(raw.receita, raw.revenue, raw.amount)),
    energiaKwh: number(firstDefined(raw.energiaKwh, raw.energyKwh, raw.energy)),
    sessoes: number(firstDefined(raw.sessoes, raw.sessions, raw.count)),
  };
}

function mapEnergySources(value: unknown): ChargerEnergySource[] {
  const values = Array.isArray(value) ? value : text(value).split(",");
  const sources = values
    .map(enumKey)
    .map((source): ChargerEnergySource | null => {
      if (source === "GRID" || source === "REDE") return "grid";
      if (source === "SOLAR") return "solar";
      if (source === "BATTERY" || source === "BATERIA") return "battery";
      return null;
    })
    .filter((source): source is ChargerEnergySource => source !== null);

  return [...new Set(sources)];
}

function mapEnergyFlow(rawSummary: JsonRecord, chargers: Charger[]): EnergyFlowTelemetry {
  const station = asRecord(firstDefined(rawSummary.station, rawSummary.estacao));
  const liveStatus = asRecord(
    firstDefined(
      rawSummary.energyFlow,
      rawSummary.liveStatus,
      rawSummary.live_status,
      station.liveStatus,
      station.live_status,
      rawSummary.telemetry
    )
  );
  const chargerPower = number(
    firstDefined(liveStatus.chargerPowerKw, liveStatus.loadPowerKw),
    chargers.reduce((sum, charger) => sum + charger.potenciaAtualKw, 0)
  );
  const explicitSources = mapEnergySources(
    firstDefined(liveStatus.chargerSources, liveStatus.sources, liveStatus.energySources)
  );
  const gridPower = nullableNumber(
    firstDefined(liveStatus.gridPowerKw, liveStatus.gridKw)
  );
  const solarPower = nullableNumber(
    firstDefined(liveStatus.solarPowerKw, liveStatus.solarKw)
  );
  const batteryPower = nullableNumber(
    firstDefined(liveStatus.batteryPowerKw, liveStatus.batteryKw)
  );
  const batterySocPercent = nullableNumber(
    firstDefined(
      liveStatus.batterySocPercent,
      liveStatus.batteryLevelPercent,
      liveStatus.batterySoc,
      liveStatus.soc
    )
  );
  const sources =
    explicitSources;
  const rawBatteryMode = enumKey(liveStatus.batteryMode);
  const batteryMode: EnergyFlowTelemetry["batteryMode"] =
    rawBatteryMode === "CHARGING" || rawBatteryMode === "CARREGANDO"
      ? "charging"
      : rawBatteryMode === "DISCHARGING" || rawBatteryMode === "DESCARREGANDO"
        ? "discharging"
        : rawBatteryMode === "IDLE" || rawBatteryMode === "OCIOSA"
          ? "idle"
          : "unknown";

  return {
    batteryMode,
    batteryPowerKw: batteryPower,
    batterySocPercent,
    chargerPowerKw: chargerPower,
    chargerSources: sources,
    gridPowerKw: gridPower ?? (sources.includes("grid") ? chargerPower : null),
    solarChargingBattery: boolean(liveStatus.solarChargingBattery),
    solarPowerKw: solarPower,
    updatedAt: optionalIso(
      firstDefined(liveStatus.updatedAt, station.updatedAt, rawSummary.updatedAt)
    ),
  };
}

function mapIntegration(value: unknown): IntegrationHealth {
  const raw = asRecord(value);
  const rawState = enumKey(firstDefined(raw.estado, raw.state, raw.status));
  const state: IntegrationHealth["estado"] =
    rawState === "READY" || rawState === "PRONTO" || rawState === "OK"
      ? "pronto"
      : rawState === "BLOCKED" || rawState === "BLOQUEADO"
        ? "bloqueado"
        : "pendente";

  return {
    nome: text(firstDefined(raw.nome, raw.name), "Integracao"),
    estado: state,
    detalhe: text(firstDefined(raw.detalhe, raw.detail, raw.message), "Sem detalhes."),
  };
}

export function mapDashboardData(
  summaryResponse: unknown,
  resources: {
    carregadores: unknown;
    sessoes: unknown;
    pagamentos: unknown;
    alertas: unknown;
  }
): DashboardData {
  const summaryEnvelope = asRecord(summaryResponse);
  const raw = asRecord(firstDefined(summaryEnvelope.data, summaryEnvelope.summary, summaryResponse));
  const statusCount = asRecord(firstDefined(raw.chargerStatusCount, raw.statusCount));
  const carregadores = mapResourceList(
    "carregadores",
    resources.carregadores
  ) as Charger[];
  const sessoes = mapResourceList("sessoes", resources.sessoes) as ChargingSession[];
  const pagamentos = mapResourceList("pagamentos", resources.pagamentos) as Payment[];
  const alertas = mapResourceList("alertas", resources.alertas) as Alert[];
  const receitaPorHora = array(
    firstDefined(raw.receitaPorHora, raw.revenueByHour, raw.revenueByDay)
  ).map(mapRevenuePoint);
  const energiaPorHora = array(
    firstDefined(raw.energiaPorHora, raw.energyByHour, raw.energyByDay)
  ).map(mapEnergyPoint);
  const activeSessions = sessoes.filter((session) => session.status === "ativa").length;
  const availableChargers = carregadores.filter(
    (charger) => charger.status === "disponivel"
  ).length;
  const offlineChargers = carregadores.filter((charger) =>
    ["offline", "erro"].includes(charger.status)
  ).length;
  const criticalAlerts = alertas.filter(
    (alert) => alert.severidade === "critica" && alert.status !== "resolvido"
  ).length;
  const approvedPayments = pagamentos.filter((payment) => payment.status === "aprovado");
  const resumo: DashboardSummary = {
    receitaHoje: number(firstDefined(raw.receitaHoje, raw.revenueToday)),
    receitaMes: number(firstDefined(raw.receitaMes, raw.revenueMonth)),
    energiaHojeKwh: number(firstDefined(raw.energiaHojeKwh, raw.energyTodayKwh)),
    sessoesHoje: number(firstDefined(raw.sessoesHoje, raw.sessionsToday)),
    sessoesAtivas: number(firstDefined(raw.sessoesAtivas, raw.activeSessions), activeSessions),
    carregadoresDisponiveis: number(
      firstDefined(raw.carregadoresDisponiveis, raw.availableChargers, statusCount.available),
      availableChargers
    ),
    carregadoresOffline: number(
      firstDefined(raw.carregadoresOffline, raw.offlineChargers),
      number(statusCount.offline, offlineChargers) + number(statusCount.critical)
    ),
    taxaOcupacao: number(firstDefined(raw.taxaOcupacao, raw.occupancyRate)),
    ticketMedio: number(
      firstDefined(raw.ticketMedio, raw.averageTicket),
      approvedPayments.reduce((sum, payment) => sum + payment.valorTotal, 0) /
        Math.max(approvedPayments.length, 1)
    ),
    alertasCriticos: number(
      firstDefined(raw.alertasCriticos, raw.criticalAlerts),
      criticalAlerts
    ),
  };
  const rawIntegrations = array(firstDefined(raw.integracoes, raw.integrations));

  return {
    resumo,
    receitaPorHora,
    energiaPorHora,
    energyFlow: mapEnergyFlow(raw, carregadores),
    carregadores,
    sessoes,
    pagamentos,
    alertas,
    integracoes:
      rawIntegrations.length > 0
        ? rawIntegrations.map(mapIntegration)
        : [
            {
              nome: "API EMPS",
              estado: "pronto",
              detalhe: "Dados operacionais autenticados carregados do backend.",
            },
          ],
  };
}

export function responseRecord(value: unknown) {
  const envelope = asRecord(value);
  return asRecord(firstDefined(envelope.data, envelope.result, value));
}

export function responseText(value: unknown, ...keys: string[]) {
  const raw = responseRecord(value);
  return text(firstDefined(...keys.map((key) => raw[key])));
}

export function responseNumber(value: unknown, ...keys: string[]) {
  const raw = responseRecord(value);
  return number(firstDefined(...keys.map((key) => raw[key])));
}
