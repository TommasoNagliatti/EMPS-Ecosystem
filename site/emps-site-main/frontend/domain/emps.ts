export type ChargerStatus =
  | "disponivel"
  | "em_uso"
  | "offline"
  | "manutencao"
  | "erro";

export type SessionStatus =
  | "ativa"
  | "finalizada"
  | "cancelada"
  | "aguardando_pagamento";

export type PaymentStatus = "pendente" | "aprovado" | "recusado" | "estornado";
export type AlertStatus = "aberto" | "verificando" | "resolvido";
export type AlertSeverity = "baixa" | "media" | "alta" | "critica";
export type ManualReleaseMode = "pre_pago" | "pos_pago";
export type ChargerCommand =
  | "encerrar_carga"
  | "liberar_conector"
  | "sincronizar_status"
  | "reiniciar_equipamento"
  | "solicitar_manutencao"
  | "executar_checklist"
  | "agendar_teste";

export type UserRole = "admin" | "goodwe" | "operador" | "proprietario";

export type ChargerProvisioningStatus =
  | "PENDING_CONNECTION"
  | "PENDING_APPROVAL"
  | "ENABLED"
  | "REJECTED"
  | "CANCELED"
  | "EXPIRED";

export type ChargerProvisioningStation = {
  id: string;
  code: string;
  name: string;
  city: string;
  state: string;
  status: "PENDING" | "ACTIVE" | "INACTIVE" | "MAINTENANCE";
};

export type ChargerProvisioningStationOption = ChargerProvisioningStation & {
  _count: { chargers: number; provisionings: number };
};

export type ChargerProvisioning = {
  id: string;
  stationId: string;
  status: ChargerProvisioningStatus;
  name: string;
  location: string;
  connectorType: string;
  powerType: "AC" | "DC";
  phaseCount: number | null;
  powerKw: number;
  pricePerKwh: number;
  manufacturer: string;
  model: string;
  serialNumber: string;
  ocppIdentity: string;
  ocppVersion: "1.6J" | "2.0.1";
  firmwareVersion: string | null;
  activationTokenLastFour: string;
  activationExpiresAt: string;
  connectionVerifiedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
  station: ChargerProvisioningStation;
  requestedBy: { id: string; name: string; email: string };
  reviewedBy: { id: string; name: string; email: string } | null;
  charger: {
    id: string;
    publicCode: string | null;
    status: string;
    administrativeStatus: string;
    qrBindings: Array<{ code: string; publicToken: string; createdAt: string }>;
  } | null;
};

export type CreateChargerProvisioningRequest = {
  stationId: string;
  name: string;
  location: string;
  connectorType: string;
  powerType: "AC" | "DC";
  phaseCount?: 1 | 3;
  powerKw: number;
  pricePerKwh: number;
  manufacturer: string;
  model: string;
  serialNumber: string;
  ocppIdentity: string;
  ocppVersion: "1.6J" | "2.0.1";
};

export type ClaimChargerProvisioningRequest = {
  activationCode: string;
  serialNumber: string;
  ocppIdentity: string;
  firmwareVersion?: string;
};

export type Client = {
  usuarioId: string;
  nome: string;
  email: string;
  telefone: string;
  veiculo: string;
  placa: string;
  status: "ativo" | "inativo";
  totalSessoes: number;
  totalGasto: number;
  criadoEm: string;
};

export type Charger = {
  carregadorId: string;
  nome: string;
  status: ChargerStatus;
  potenciaMaximaKw: number;
  potenciaAtualKw: number;
  tarifaKwh: number;
  tipoConector: string;
  estacaoId: string;
  estacaoNome: string;
  localizacao: string;
  serialNumber: string;
  ultimaComunicacao: string;
  temperaturaC: number | null;
  energiaHojeKwh: number;
  receitaHoje: number;
  usuarioAtualId: string | null;
  sessoesHoje: number;
  ocupacaoHojePercent: number;
  tempoMedioSessaoMinutos: number;
  motivoFalha: string | null;
  motivoAtencao: string | null;
};

export type ChargingSession = {
  sessaoId: string;
  usuarioId: string;
  usuarioNome: string;
  carregadorId: string;
  carregadorNome: string;
  status: SessionStatus;
  dataInicio: string;
  dataFim: string | null;
  duracaoMinutos: number;
  energiaKwh: number;
  valorTotal: number;
  statusPagamento: PaymentStatus;
};

export type Payment = {
  pagamentoId: string;
  sessaoId: string;
  usuarioId: string;
  usuarioNome: string;
  carregadorId: string;
  valorTotal: number;
  status: PaymentStatus;
  metodo: "PIX" | "cartao" | "carteira" | "caixa" | "simulado";
  dataPagamento: string | null;
  transactionId: string | null;
};

export type ManualReleaseRequest = {
  carregadorId: string;
  valorRecebido: number;
  tarifaKwh: number;
  operadorId: string;
  origem: "caixa";
  motivo: "fallback_qr_code";
  modo?: "pre_pago";
};

export type ManualReleaseResult = {
  ok: true;
  liberacaoId: string;
  sessaoId: string;
  carregadorId: string;
  chargerStatus: "em_uso";
  valorRecebido: number;
  energiaLiberadaKwh: number;
  status: "liberacao_manual_confirmada";
};

export type PostpaidReleaseRequest = {
  carregadorId: string;
  tarifaKwh: number;
  operadorId: string;
  origem: "caixa";
  motivo: "pagamento_no_encerramento";
};

export type PostpaidReleaseResult = {
  ok: true;
  liberacaoId: string;
  sessaoId: string;
  carregadorId: string;
  chargerStatus: "em_uso";
  tarifaKwh: number;
  startedAt: string;
  status: "sessao_pos_paga_iniciada";
};

export type PostpaidSettlementRequest = {
  quoteToken?: string;
  carregadorId: string;
  sessaoId: string;
  energiaConsumidaKwh: number;
  valorCobrado: number;
  valorRecebido: number;
  operadorId: string;
  origem: "caixa";
};

export type PostpaidSettlementResult = {
  ok: true;
  sessaoId: string;
  carregadorId: string;
  chargerStatus: "disponivel";
  energiaConsumidaKwh: number;
  valorCobrado: number;
  valorRecebido: number;
  troco: number;
  processedAt: string;
  status: "sessao_pos_paga_finalizada";
};

export type Alert = {
  alertaId: string;
  carregadorId: string | null;
  carregadorNome: string | null;
  titulo: string;
  descricao: string;
  severidade: AlertSeverity;
  status: AlertStatus;
  origem: "EMPS" | "SEMS+" | "regra interna";
  dataCriacao: string;
};

export type TelemetryPoint = {
  hora: string;
  receita: number;
  energiaKwh: number;
  sessoes: number;
};

export type ChargerEnergySource = "grid" | "solar" | "battery";

export type EnergyFlowTelemetry = {
  buildingPowerKw?: number | null;
  gieVisual?: Record<string, unknown>;
  batteryMode: "charging" | "discharging" | "idle" | "unknown";
  batteryPowerKw: number | null;
  batterySocPercent: number | null;
  chargerPowerKw: number | null;
  chargerSources: ChargerEnergySource[];
  gridPowerKw: number | null;
  solarChargingBattery: boolean;
  solarPowerKw: number | null;
  updatedAt: string | null;
};

export type DashboardSummary = {
  receitaHoje: number;
  receitaMes: number;
  energiaHojeKwh: number;
  sessoesHoje: number;
  sessoesAtivas: number;
  carregadoresDisponiveis: number;
  carregadoresOffline: number;
  taxaOcupacao: number;
  ticketMedio: number;
  alertasCriticos: number;
};

export type IntegrationHealth = {
  nome: string;
  estado: "pronto" | "pendente" | "bloqueado";
  detalhe: string;
};

export type DashboardData = {
  resumo: DashboardSummary;
  receitaPorHora: TelemetryPoint[];
  energiaPorHora: TelemetryPoint[];
  energyFlow: EnergyFlowTelemetry;
  carregadores: Charger[];
  sessoes: ChargingSession[];
  pagamentos: Payment[];
  alertas: Alert[];
  integracoes: IntegrationHealth[];
};

export type ApiResource =
  | "carregadores"
  | "sessoes"
  | "pagamentos"
  | "alertas"
  | "clientes";

export type ResourceRow = Charger | ChargingSession | Payment | Alert | Client;

export type FrontSession = {
  usuarioId: string;
  nome: string;
  email: string;
  role: UserRole;
  token: string | null;
  modo: "api" | "front-only";
};
