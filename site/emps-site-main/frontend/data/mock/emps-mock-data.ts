import {
  Alert,
  Charger,
  ChargingSession,
  Client,
  DashboardData,
  DashboardSummary,
  IntegrationHealth,
  Payment,
  TelemetryPoint,
} from "@/domain/emps";

const iso = (minutesAgo: number) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();

export const clients: Client[] = [
  {
    usuarioId: "usr_128",
    nome: "Joao Silva",
    email: "joao.silva@exemplo.com",
    telefone: "+55 11 98111-1200",
    veiculo: "BYD Dolphin",
    placa: "ABC1D23",
    status: "ativo",
    totalSessoes: 18,
    totalGasto: 731.42,
    criadoEm: iso(60 * 24 * 48),
  },
  {
    usuarioId: "usr_231",
    nome: "Maria Souza",
    email: "maria.souza@exemplo.com",
    telefone: "+55 11 98222-3400",
    veiculo: "Volvo EX30",
    placa: "XYZ9A88",
    status: "ativo",
    totalSessoes: 11,
    totalGasto: 482.1,
    criadoEm: iso(60 * 24 * 37),
  },
  {
    usuarioId: "usr_315",
    nome: "Carlos Lima",
    email: "carlos.lima@exemplo.com",
    telefone: "+55 11 98333-5500",
    veiculo: "GWM Ora 03",
    placa: "BRA2E45",
    status: "ativo",
    totalSessoes: 7,
    totalGasto: 268.55,
    criadoEm: iso(60 * 24 * 28),
  },
  {
    usuarioId: "usr_402",
    nome: "Ana Costa",
    email: "ana.costa@exemplo.com",
    telefone: "+55 11 98444-9900",
    veiculo: "Tesla Model 3",
    placa: "FIAP202",
    status: "inativo",
    totalSessoes: 4,
    totalGasto: 219.8,
    criadoEm: iso(60 * 24 * 21),
  },
];

export const chargers: Charger[] = [
  {
    carregadorId: "chg_001",
    nome: "Charger Alpha",
    status: "disponivel",
    potenciaMaximaKw: 22,
    potenciaAtualKw: 0,
    tarifaKwh: 3,
    tipoConector: "CCS2",
    estacaoId: "st_001",
    estacaoNome: "Eletroposto Centro",
    localizacao: "Vaga A01",
    serialNumber: "GW-EV-ALPHA-001",
    ultimaComunicacao: iso(2),
    temperaturaC: 31,
    energiaHojeKwh: 0,
    receitaHoje: 0,
    usuarioAtualId: null,
    sessoesHoje: 0,
    ocupacaoHojePercent: 36,
    tempoMedioSessaoMinutos: 42,
    motivoFalha: null,
    motivoAtencao: null,
  },
  {
    carregadorId: "chg_002",
    nome: "Charger Beta",
    status: "em_uso",
    potenciaMaximaKw: 11,
    potenciaAtualKw: 8.4,
    tarifaKwh: 2.8,
    tipoConector: "Tipo 2",
    estacaoId: "st_001",
    estacaoNome: "Eletroposto Centro",
    localizacao: "Vaga A02",
    serialNumber: "GW-EV-BETA-002",
    ultimaComunicacao: iso(1),
    temperaturaC: 43,
    energiaHojeKwh: 0,
    receitaHoje: 0,
    usuarioAtualId: "usr_128",
    sessoesHoje: 0,
    ocupacaoHojePercent: 68,
    tempoMedioSessaoMinutos: 39,
    motivoFalha: null,
    motivoAtencao: "Temperatura acima do ideal durante carga ativa.",
  },
  {
    carregadorId: "chg_003",
    nome: "Charger Gamma",
    status: "offline",
    potenciaMaximaKw: 22,
    potenciaAtualKw: 0,
    tarifaKwh: 3.2,
    tipoConector: "CCS2",
    estacaoId: "st_001",
    estacaoNome: "Eletroposto Centro",
    localizacao: "Vaga B01",
    serialNumber: "GW-EV-GAMMA-003",
    ultimaComunicacao: iso(126),
    temperaturaC: null,
    energiaHojeKwh: 0,
    receitaHoje: 0,
    usuarioAtualId: null,
    sessoesHoje: 0,
    ocupacaoHojePercent: 12,
    tempoMedioSessaoMinutos: 31,
    motivoFalha: "Sem heartbeat ha mais de duas horas.",
    motivoAtencao: null,
  },
  {
    carregadorId: "chg_004",
    nome: "Charger Delta",
    status: "manutencao",
    potenciaMaximaKw: 7.4,
    potenciaAtualKw: 0,
    tarifaKwh: 2.4,
    tipoConector: "Tipo 2",
    estacaoId: "st_001",
    estacaoNome: "Eletroposto Centro",
    localizacao: "Vaga B02",
    serialNumber: "GW-EV-DELTA-004",
    ultimaComunicacao: iso(18),
    temperaturaC: 28,
    energiaHojeKwh: 0,
    receitaHoje: 0,
    usuarioAtualId: null,
    sessoesHoje: 0,
    ocupacaoHojePercent: 0,
    tempoMedioSessaoMinutos: 0,
    motivoFalha: null,
    motivoAtencao: "Inspecao preventiva do conector e do cabo.",
  },
];

export const sessions: ChargingSession[] = [];

export const payments: Payment[] = [];

export const alerts: Alert[] = [
  {
    alertaId: "alt_301",
    carregadorId: "chg_003",
    carregadorNome: "Charger Gamma",
    titulo: "Carregador offline",
    descricao: "Sem heartbeat ha mais de duas horas.",
    severidade: "critica",
    status: "aberto",
    origem: "SEMS+",
    dataCriacao: iso(124),
  },
  {
    alertaId: "alt_302",
    carregadorId: "chg_002",
    carregadorNome: "Charger Beta",
    titulo: "Temperatura elevada",
    descricao: "Temperatura acima da media operacional.",
    severidade: "alta",
    status: "verificando",
    origem: "regra interna",
    dataCriacao: iso(22),
  },
  {
    alertaId: "alt_303",
    carregadorId: null,
    carregadorNome: null,
    titulo: "Pagamento pendente",
    descricao: "Sessao ses_1038 aguardando confirmacao de pagamento.",
    severidade: "media",
    status: "aberto",
    origem: "EMPS",
    dataCriacao: iso(54),
  },
  {
    alertaId: "alt_304",
    carregadorId: null,
    carregadorNome: null,
    titulo: "Pico de uso previsto",
    descricao: "Maior demanda esperada entre 18h e 20h.",
    severidade: "baixa",
    status: "aberto",
    origem: "regra interna",
    dataCriacao: iso(12),
  },
];

export const receitaPorHora: TelemetryPoint[] = [];

export const integrationHealth: IntegrationHealth[] = [
  {
    nome: "Contrato de dados",
    estado: "pronto",
    detalhe: "IDs, numeros puros, datas ISO e status canonicos.",
  },
  {
    nome: "Autenticacao",
    estado: "pendente",
    detalhe: "Tela pronta para trocar sessao local por JWT da API.",
  },
  {
    nome: "SEMS+ Adapter",
    estado: "bloqueado",
    detalhe: "Somente backend podera guardar credenciais e assinatura.",
  },
];

const approvedPayments = payments.filter((payment) => payment.status === "aprovado");
const activeSessions = sessions.filter((session) => session.status === "ativa");
const availableChargers = chargers.filter(
  (charger) => charger.status === "disponivel"
);
const offlineChargers = chargers.filter((charger) =>
  ["offline", "erro"].includes(charger.status)
);
const criticalAlerts = alerts.filter(
  (alert) => alert.severidade === "critica" && alert.status !== "resolvido"
);

export const dashboardSummary: DashboardSummary = {
  receitaHoje: chargers.reduce((sum, charger) => sum + charger.receitaHoje, 0),
  receitaMes: 0,
  energiaHojeKwh: chargers.reduce((sum, charger) => sum + charger.energiaHojeKwh, 0),
  sessoesHoje: sessions.length,
  sessoesAtivas: activeSessions.length,
  carregadoresDisponiveis: availableChargers.length,
  carregadoresOffline: offlineChargers.length,
  taxaOcupacao: Math.round((activeSessions.length / chargers.length) * 100),
  ticketMedio:
    approvedPayments.reduce((sum, payment) => sum + payment.valorTotal, 0) /
    Math.max(approvedPayments.length, 1),
  alertasCriticos: criticalAlerts.length,
};

export const dashboardData: DashboardData = {
  resumo: dashboardSummary,
  receitaPorHora,
  energiaPorHora: receitaPorHora,
  energyFlow: {
    batteryMode: "discharging",
    batteryPowerKw: 8.4,
    batterySocPercent: 68,
    chargerPowerKw: 8.4,
    chargerSources: ["battery"],
    gridPowerKw: 0,
    solarChargingBattery: false,
    solarPowerKw: 0,
    updatedAt: iso(1),
  },
  carregadores: chargers,
  sessoes: sessions,
  pagamentos: payments,
  alertas: alerts,
  integracoes: integrationHealth,
};
