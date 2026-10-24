"use client";
import { requestId } from "@/domain/request-id";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { QRCodeSVG } from 'qrcode.react';
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Banknote,
  Cable,
  CalendarClock,
  ClipboardCheck,
  Clock3,
  Gauge,
  Info,
  Loader2,
  Power,
  QrCode,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Unplug,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { Charger, ChargerCommand } from "@/domain/emps";
import {
  formatCurrency,
  formatDateTime,
  formatKwh,
  formatKw,
} from "@/utils/formatters";
import { StatusBadge } from "@/components/status/StatusBadge";
import { chargerVisualStates } from "@/components/chargers/charger-visual-state";
import { api, isDemoMode } from "@/services/emps-api";
import { webChargeUrl } from '@/domain/web-charge-url';
import {ChargeLifecyclePanel} from './ChargeLifecyclePanel';
import type {CashSessionRow} from '@/domain/charge-lifecycle';
import { sandboxCanStart, sandboxCanStop, sandboxCashierCredit, sandboxSessionMatches, sandboxStatusLabel, sandboxVisualStatus, validateChargingSandbox,
  type ChargingSandbox, type SandboxCashierMethod, type SandboxSession } from '@/domain/charging-sandbox';

type CashReleaseMode = "prepaid" | "postpaid";

type ManualReleaseDraft = {
  chargerId: string;
  mode: CashReleaseMode;
  value: string;
};

type PostpaidCashSession = {
  chargerId: string;
  sessionId: string;
  startedAt: string;
  tariffKwh: number;
};

type PostpaidSettlementDraft = {
  chargerId: string;
  value: string;
};

type ManualReleaseMessage = {
  chargerId: string;
  text: string;
};

type SandboxStartDraft = {
  chargerId: string;
  method: SandboxCashierMethod;
  amountReceived: string;
  operatorConfirmed: boolean;
  idempotencyKey: string;
};
type SandboxFeedback = ManualReleaseMessage & { error: boolean };

type ChargerCardAction = {
  className?: string;
  disabled?: boolean;
  icon: LucideIcon;
  isActive?: boolean;
  key: string;
  label: string;
  loading?: boolean;
  onClick: () => void;
  title: string;
};

function parseMoneyInput(value: string) {
  const cleanValue = value.trim().replace(/\s/g, "");
  const normalizedValue = cleanValue.includes(",")
    ? cleanValue.replace(/\./g, "").replace(",", ".")
    : cleanValue;

  return Number(normalizedValue);
}

function formatMoneyInput(value: number) {
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function calculatePostpaidUsage(
  session: PostpaidCashSession,
  charger: Charger,
  nowMs: number
) {
  const startedAtMs = Date.parse(session.startedAt);
  const elapsedMinutes = Number.isFinite(startedAtMs)
    ? Math.max(1, Math.ceil((nowMs - startedAtMs) / 60_000))
    : 1;
  const activePowerKw =
    charger.potenciaAtualKw > 0
      ? charger.potenciaAtualKw
      : Math.min(charger.potenciaMaximaKw, Math.max(3.7, charger.potenciaMaximaKw * 0.7));
  const energiaConsumidaKwh = Number(
    Math.max(0.1, (activePowerKw * elapsedMinutes) / 60).toFixed(2)
  );
  const valorCobrado = Number(
    (energiaConsumidaKwh * session.tariffKwh).toFixed(2)
  );

  return {
    elapsedMinutes,
    energiaConsumidaKwh,
    valorCobrado,
  };
}

function chargerDetailReason(charger: Charger) {
  if (charger.status === "offline") {
    return {
      label: "Conexão",
      value: charger.motivoFalha ?? "Sem comunicação recente com o equipamento; nenhuma falha física foi confirmada.",
    };
  }

  if (charger.status === "erro") {
    return {
      label: "Motivo da falha",
      value: charger.motivoFalha ?? "Falha operacional em verificacao.",
    };
  }

  if (charger.status === "manutencao") {
    return {
      label: "Motivo da atencao",
      value: charger.motivoAtencao ?? "Manutencao preventiva em andamento.",
    };
  }

  if (charger.motivoAtencao) {
    return {
      label: "Observacao",
      value: charger.motivoAtencao,
    };
  }

  return {
    label: "Operacao",
    value: "Sem ocorrencia operacional ativa.",
  };
}

function chargerOperationalLine(charger: Charger) {
  if (charger.status === "em_uso") return "Em progresso...";
  if (charger.status === "offline") return "Sem comunicação...";
  if (charger.status === "erro") return "Inoperante...";
  if (charger.status === "manutencao") return "Em espera...";
  return "Pronto para uso...";
}

function chargerRecommendedAction(charger: Charger) {
  if (charger.status === "em_uso") {
    return "Acompanhar potencia e encerramento da sessao.";
  }

  if (charger.status === "manutencao") {
    return "Concluir o checklist antes de uma nova liberacao.";
  }

  if (charger.status === "offline") {
    return "Verificar a conexão e aguardar telemetria antes de liberar o conector.";
  }

  if (charger.status === "erro") {
    return "Isolar o conector e encaminhar para manutencao.";
  }

  return "Disponivel para iniciar uma nova sessao.";
}

function chargerMetricFallback(value: number | null, suffix = "") {
  if (value === null) return "--";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}${suffix}`;
}

function ChargerScene({ visual }: { visual: (typeof chargerVisualStates)[Charger["status"]] }) {
  return (
    <div
      className={`charger-scene charger-scene--${visual.tone}`}
      aria-hidden="true"
    >
      <div className="status-orbit">
        <span className="status-light status-light--free" />
        <span className="status-light status-light--busy" />
        <span className="status-light status-light--warning" />
        <span className="status-light status-light--danger" />
      </div>
      <Image
        alt=""
        className={visual.asset.className}
        draggable={false}
        height={visual.asset.height}
        loading="eager"
        sizes="(max-width: 620px) 45vw, 240px"
        src={visual.asset.src}
        width={visual.asset.width}
      />
    </div>
  );
}

export function ChargerVisualBoard({
  chargers,
  compact = false,
  onChargersChange,
  scrollAfter,
  readOnly = false,
  historical,
  sandboxStationId,
  sandboxState,
  sandboxStateError,
  onSandboxRefresh,
}: {
  chargers: Charger[];
  compact?: boolean;
  onChargersChange?: Dispatch<SetStateAction<Charger[]>>;
  scrollAfter?: number;
  readOnly?: boolean;
  historical?: Record<string, { sessions: number; deliveredKwh: number; revenueSimulated: number; utilizationPct: number | null }>;
  sandboxStationId?: string;
  sandboxState?: ChargingSandbox | null;
  sandboxStateError?: string;
  onSandboxRefresh?: () => void;
}) {
  const [localChargers, setLocalChargers] = useState<Charger[]>(chargers);
  const visibleChargers = onChargersChange ? chargers : localChargers;
  const setVisibleChargers = onChargersChange ?? setLocalChargers;
  const [manualReleaseDraft, setManualReleaseDraft] =
    useState<ManualReleaseDraft | null>(null);
  const [postpaidSettlementDraft, setPostpaidSettlementDraft] =
    useState<PostpaidSettlementDraft | null>(null);
  const [manualReleaseMessage, setManualReleaseMessage] =
    useState<ManualReleaseMessage | null>(null);
  const [manualReleaseLoadingId, setManualReleaseLoadingId] = useState<
    string | null
  >(null);
  const [postpaidSessions, setPostpaidSessions] = useState<
    Record<string, PostpaidCashSession>
  >({});
  const [chargerCommandLoadingKey, setChargerCommandLoadingKey] = useState<
    string | null
  >(null);
  const [quotes, setQuotes] = useState<Record<string, Awaited<ReturnType<typeof api.cashQuote>>>>({});
  const [lifecycleRows,setLifecycleRows]=useState<CashSessionRow[]>([]);
  const [lifecycleReadAt,setLifecycleReadAt]=useState(()=>Date.now());
  const [lifecycleRefresh,setLifecycleRefresh]=useState(0);
  const [sandbox, setSandbox] = useState<ChargingSandbox | null>(null);
  const [sandboxError, setSandboxError] = useState('');
  const [sandboxMessage, setSandboxMessage] = useState<SandboxFeedback | null>(null);
  const [sandboxStartDraft, setSandboxStartDraft] = useState<SandboxStartDraft | null>(null);
  const [sandboxBusyId, setSandboxBusyId] = useState<string | null>(null);
  const [sandboxTransition, setSandboxTransition] = useState<{ chargerId: string; status: 'STARTING' | 'FINISHING' } | null>(null);
  const [sandboxRefresh, setSandboxRefresh] = useState(0);
  const [sandboxQr, setSandboxQr] = useState<{ chargerId: string; code: string; publicToken: string } | null>(null);
  const sandboxStopKeys = useRef(new Map<string, string>());
  const sandboxSending = useRef(false);
  const sandboxChargerIds = chargers.filter(charger => charger.estacaoId === sandboxStationId)
    .map(charger => charger.carregadorId).sort().join(',');
  useEffect(() => {
    if (sandboxState !== undefined) return;
    if (isDemoMode || readOnly || !['13', '46', '47'].includes(sandboxStationId ?? '') || !sandboxChargerIds) {
      setSandbox(null); setSandboxError(''); setSandboxStartDraft(null); setSandboxQr(null);
      return;
    }
    const stationId = sandboxStationId!;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    setSandbox(current => String(current?.stationId) === sandboxStationId ? current : null);
    async function poll() {
      if (!active) return;
      if (document.visibilityState === 'hidden') { timer = setTimeout(() => void poll(), 3_000); return; }
      let nextPollMs = 3_000;
      const current = new AbortController();
      controller = current;
      const timeout = setTimeout(() => current.abort(), 8_000);
      try {
        const next = await api.platform<ChargingSandbox>(`/v2/stations/${stationId}/charging-sandbox`,
          { signal: current.signal }, { force: true });
        if (!active || controller !== current) return;
        setSandbox(validateChargingSandbox(next, stationId, chargers));
        setSandboxError('');
      } catch (cause) {
        if (cause && typeof cause === 'object' && 'status' in cause && cause.status === 429) nextPollMs = 60_000;
        if (!active || controller !== current) return;
        setSandbox(null);
        setSandboxError(cause instanceof Error ? cause.message : 'Operação sandbox indisponível.');
      } finally {
        clearTimeout(timeout);
        if (active && controller === current) timer = setTimeout(() => void poll(), nextPollMs);
      }
    }
    void poll();
    return () => { active = false; controller?.abort(); clearTimeout(timer); };
  }, [sandboxStationId, sandboxChargerIds, readOnly, sandboxRefresh, sandboxState]);
  const activeSandbox = sandboxState === undefined ? sandbox : sandboxState;
  const activeSandboxError = sandboxStateError === undefined ? sandboxError : sandboxStateError;
  const refreshSandbox = () => { setSandboxRefresh(value => value + 1); onSandboxRefresh?.(); };
  useEffect(() => {
    if(isDemoMode || readOnly) return;
    let active=true;
    const load=()=>api.openCashSessions().then(rows=>{if(active){setLifecycleRows(rows);setLifecycleReadAt(performance.now());setPostpaidSessions(Object.fromEntries(rows.filter(s=>s.status==='ACTIVE'&&s.billingMode==='POSTPAID'&&s.sessionOrigin==='ADMIN_SITE').map(s=>[s.chargerId,{chargerId:s.chargerId,sessionId:s.id,startedAt:s.startTime,tariffKwh:Number(s.pricePerKwhSnapshot)}])));}}).catch(()=>undefined);
    void load(); const timer=setInterval(()=>{void load();},15000);return()=>{active=false;clearInterval(timer);};
  },[lifecycleRefresh,readOnly]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const hasInternalScroll =
    typeof scrollAfter === "number" && visibleChargers.length > scrollAfter;

  useEffect(() => {
    if (!onChargersChange) setLocalChargers(chargers);
  }, [chargers, onChargersChange]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 15_000);

    return () => window.clearInterval(intervalId);
  }, []);

  function openManualRelease(charger: Charger) {
    if (readOnly) return;
    if (charger.status !== "disponivel") return;

    setManualReleaseMessage(null);
    setPostpaidSettlementDraft(null);
    setManualReleaseDraft({
      chargerId: charger.carregadorId,
      mode: "prepaid",
      value: "",
    });
  }

  function closeManualRelease() {
    setManualReleaseDraft(null);
  }

  function setManualReleaseMode(mode: CashReleaseMode, charger: Charger) {
    setManualReleaseDraft({
      chargerId: charger.carregadorId,
      mode,
      value: "",
    });
    setManualReleaseMessage(null);
  }

  function getPostpaidUsage(charger: Charger) {
    const session = postpaidSessions[charger.carregadorId];

    if (!session) return null;

    if(isDemoMode) return {...calculatePostpaidUsage(session, charger, nowMs),fixedFee:0,overstayFee:0,energyAmount:0,pricePerKwh:session.tariffKwh,quoteToken:undefined};
    const q=quotes[charger.carregadorId];
    return q ? {elapsedMinutes:q.elapsedMinutes,energiaConsumidaKwh:q.energyKwh,valorCobrado:q.total,fixedFee:q.fixedFee,overstayFee:q.overstayFee??0,energyAmount:q.energyAmount,pricePerKwh:q.pricePerKwh,quoteToken:q.quoteToken} : null;
  }

  async function openPostpaidSettlement(charger: Charger) {
    if (readOnly) return;
    const session=postpaidSessions[charger.carregadorId];if(!session)return;
    setManualReleaseDraft(null);setManualReleaseMessage(null);
    try {
      const quote=isDemoMode?null:await api.cashQuote(session.sessionId);
      if(quote)setQuotes(current=>({...current,[charger.carregadorId]:quote}));
      const total=quote?.total ?? calculatePostpaidUsage(session,charger,nowMs).valorCobrado;
      setPostpaidSettlementDraft({chargerId:charger.carregadorId,value:formatMoneyInput(total)});
    } catch(e){setManualReleaseMessage({chargerId:charger.carregadorId,text:e instanceof Error?e.message:'Falha ao obter total'});}
  }

  function closePostpaidSettlement() {
    setPostpaidSettlementDraft(null);
  }

  async function submitManualRelease(
    event: FormEvent<HTMLFormElement>,
    charger: Charger
  ) {
    event.preventDefault();
    if (readOnly) return;

    if (!manualReleaseDraft || manualReleaseDraft.chargerId !== charger.carregadorId) {
      return;
    }

    if (manualReleaseDraft.mode === "postpaid") {
      try {
        setManualReleaseLoadingId(charger.carregadorId);
        const result = await api.startPostpaidCashSession({
          carregadorId: charger.carregadorId,
          motivo: "pagamento_no_encerramento",
          operadorId: "usr_admin_front",
          origem: "caixa",
          tarifaKwh: charger.tarifaKwh,
        });

        setPostpaidSessions((currentSessions) => ({
          ...currentSessions,
          [charger.carregadorId]: {
            chargerId: charger.carregadorId,
            sessionId: result.sessaoId,
            startedAt: result.startedAt,
            tariffKwh: result.tarifaKwh,
          },
        }));

        if (isDemoMode) setVisibleChargers((currentChargers) =>
          currentChargers.map((currentCharger) => {
            if (currentCharger.carregadorId !== charger.carregadorId) {
              return currentCharger;
            }

            return {
              ...currentCharger,
              motivoAtencao: "Conta aberta em caixa para acerto no encerramento.",
              potenciaAtualKw: Math.min(
                currentCharger.potenciaMaximaKw,
                Math.max(3.7, currentCharger.potenciaMaximaKw * 0.72)
              ),
              status: result.chargerStatus,
              ultimaComunicacao: result.startedAt,
              usuarioAtualId: "usr_caixa_pos_pago",
            };
          })
        );

        setManualReleaseMessage(null);
        setManualReleaseDraft(null);
      } catch (error) {
        setManualReleaseMessage({
          chargerId: charger.carregadorId,
          text:
            error instanceof Error
              ? error.message
              : "Nao foi possivel iniciar a conta aberta.",
        });
      } finally {
        if(!isDemoMode) await api.dashboard().then(d=>setVisibleChargers(d.carregadores)).catch(()=>undefined);
      setManualReleaseLoadingId(null);
      }

      return;
    }

    const receivedValue = parseMoneyInput(manualReleaseDraft.value);

    if (!Number.isFinite(receivedValue) || receivedValue <= 0) {
      setManualReleaseMessage({
        chargerId: charger.carregadorId,
        text: "Informe um valor recebido valido.",
      });
      return;
    }

    try {
      setManualReleaseLoadingId(charger.carregadorId);
      const result = await api.releaseChargerManually({
        carregadorId: charger.carregadorId,
        motivo: "fallback_qr_code",
        modo: "pre_pago",
        operadorId: "usr_admin_front",
        origem: "caixa",
        tarifaKwh: charger.tarifaKwh,
        valorRecebido: receivedValue,
      });

      if (isDemoMode) setVisibleChargers((currentChargers) =>
        currentChargers.map((currentCharger) => {
          if (currentCharger.carregadorId !== charger.carregadorId) {
            return currentCharger;
          }

          return {
            ...currentCharger,
            energiaHojeKwh:
              currentCharger.energiaHojeKwh + result.energiaLiberadaKwh,
            potenciaAtualKw: Math.min(
              currentCharger.potenciaMaximaKw,
              Math.max(3.7, currentCharger.potenciaMaximaKw * 0.72)
            ),
            receitaHoje: currentCharger.receitaHoje + result.valorRecebido,
            status: result.chargerStatus,
            ultimaComunicacao: new Date().toISOString(),
            usuarioAtualId: "usr_caixa_manual",
          };
        })
      );

      setManualReleaseMessage(null);
      setManualReleaseDraft(null);
    } catch (error) {
      setManualReleaseMessage({
        chargerId: charger.carregadorId,
        text:
          error instanceof Error
            ? error.message
            : "Nao foi possivel liberar o carregador.",
      });
    } finally {
      if(!isDemoMode) await api.dashboard().then(d=>setVisibleChargers(d.carregadores)).catch(()=>undefined);
      setManualReleaseLoadingId(null);
    }
  }

  async function submitPostpaidSettlement(
    event: FormEvent<HTMLFormElement>,
    charger: Charger
  ) {
    event.preventDefault();
    if (readOnly) return;

    const session = postpaidSessions[charger.carregadorId];
    const usage = getPostpaidUsage(charger);

    if (!session || !usage || postpaidSettlementDraft?.chargerId !== charger.carregadorId) {
      return;
    }

    const receivedValue = parseMoneyInput(postpaidSettlementDraft.value);

    if (!Number.isFinite(receivedValue) || receivedValue < usage.valorCobrado) {
      setManualReleaseMessage({
        chargerId: charger.carregadorId,
        text: "Valor recebido menor que o total da sessao.",
      });
      return;
    }

    try {
      setManualReleaseLoadingId(charger.carregadorId);
      const result = await api.settlePostpaidCashSession({
        carregadorId: charger.carregadorId,
        energiaConsumidaKwh: usage.energiaConsumidaKwh,
        operadorId: "usr_admin_front",
        origem: "caixa",
        sessaoId: session.sessionId,
        quoteToken: usage.quoteToken,
        valorCobrado: usage.valorCobrado,
        valorRecebido: receivedValue,
      });

      if (isDemoMode) setVisibleChargers((currentChargers) =>
        currentChargers.map((currentCharger) => {
          if (currentCharger.carregadorId !== charger.carregadorId) {
            return currentCharger;
          }

          return {
            ...currentCharger,
            energiaHojeKwh:
              currentCharger.energiaHojeKwh + result.energiaConsumidaKwh,
            motivoAtencao: null,
            potenciaAtualKw: 0,
            receitaHoje: currentCharger.receitaHoje + result.valorCobrado,
            sessoesHoje: currentCharger.sessoesHoje + 1,
            status: result.chargerStatus,
            ultimaComunicacao: result.processedAt,
            usuarioAtualId: null,
          };
        })
      );

      setPostpaidSessions((currentSessions) => {
        const nextSessions = { ...currentSessions };
        delete nextSessions[charger.carregadorId];
        return nextSessions;
      });
      setManualReleaseMessage(null);
      setPostpaidSettlementDraft(null);
    } catch (error) {
      setManualReleaseMessage({
        chargerId: charger.carregadorId,
        text:
          error instanceof Error
            ? error.message
            : "Nao foi possivel concluir o acerto.",
      });
    } finally {
      if(!isDemoMode) await api.dashboard().then(d=>setVisibleChargers(d.carregadores)).catch(()=>undefined);
      setManualReleaseLoadingId(null);
    }
  }

  async function handleChargerCommand(charger: Charger, command: ChargerCommand) {
    if (readOnly) return;
    const loadingKey = `${charger.carregadorId}:${command}`;

    if (
      postpaidSessions[charger.carregadorId] &&
      (command === "encerrar_carga" || command === "liberar_conector")
    ) {
      openPostpaidSettlement(charger);
      return;
    }

    try {
      setChargerCommandLoadingKey(loadingKey);
      const result = await api.sendChargerCommand(charger.carregadorId, command);

      if (isDemoMode) setVisibleChargers((currentChargers) =>
        currentChargers.map((currentCharger) => {
          if (currentCharger.carregadorId !== charger.carregadorId) {
            return currentCharger;
          }

          if (command === "encerrar_carga" || command === "liberar_conector") {
            return {
              ...currentCharger,
              motivoAtencao: null,
              potenciaAtualKw: 0,
              status: "disponivel",
              ultimaComunicacao: result.processedAt,
              usuarioAtualId: null,
            };
          }

          if (command === "sincronizar_status") {
            return {
              ...currentCharger,
              ultimaComunicacao: result.processedAt,
            };
          }

          if (command === "solicitar_manutencao") {
            return {
              ...currentCharger,
              motivoAtencao: "Manutencao solicitada para equipe tecnica.",
              potenciaAtualKw: 0,
              status: "manutencao",
              ultimaComunicacao: result.processedAt,
              usuarioAtualId: null,
            };
          }

          if (command === "executar_checklist") {
            return {
              ...currentCharger,
              motivoAtencao: "Checklist operacional executado.",
              ultimaComunicacao: result.processedAt,
            };
          }

          if (command === "agendar_teste") {
            return {
              ...currentCharger,
              motivoAtencao: "Teste operacional agendado.",
              ultimaComunicacao: result.processedAt,
            };
          }

          return {
            ...currentCharger,
            motivoAtencao:
              currentCharger.status === "manutencao"
                ? null
                : "Reinicio remoto em andamento.",
            potenciaAtualKw: 0,
            status:
              currentCharger.status === "manutencao" ? "disponivel" : "manutencao",
            ultimaComunicacao: result.processedAt,
            usuarioAtualId: null,
          };
        })
      );
      setManualReleaseMessage(null);
    } catch (error) {
      setManualReleaseMessage({
        chargerId: charger.carregadorId,
        text:
          error instanceof Error
            ? error.message
            : "Nao foi possivel executar o comando do carregador.",
      });
    } finally {
      if(!isDemoMode) await api.dashboard().then(d=>setVisibleChargers(d.carregadores)).catch(()=>undefined);
      setChargerCommandLoadingKey(null);
    }
  }

  function openSandboxStart(charger: Charger) {
    const row = activeSandbox?.chargers.find(item => String(item.chargerId) === charger.carregadorId);
    if (!row || !sandboxCanStart(row) || sandboxSending.current) return;
    setSandboxQr(null);
    setSandboxMessage(null);
    setSandboxStartDraft({ chargerId: charger.carregadorId, method: 'cash',
      amountReceived: '', operatorConfirmed: false, idempotencyKey: requestId() });
  }

  async function startSandbox(event: FormEvent<HTMLFormElement>, charger: Charger) {
    event.preventDefault();
    const draft = sandboxStartDraft;
    const row = activeSandbox?.chargers.find(item => String(item.chargerId) === charger.carregadorId);
    const amountReceived = draft ? parseMoneyInput(draft.amountReceived) : NaN;
    if (!['13', '46', '47'].includes(sandboxStationId ?? '') || !draft || draft.chargerId !== charger.carregadorId ||
        !row || !sandboxCanStart(row) || !draft.operatorConfirmed ||
        !Number.isFinite(amountReceived) || amountReceived <= 0 || sandboxSending.current) return;
    sandboxSending.current = true;
    setSandboxBusyId(charger.carregadorId); setSandboxTransition({ chargerId: charger.carregadorId, status: 'STARTING' }); setSandboxMessage(null);
    try {
      const created = await api.platform<SandboxSession>(
        `/v2/stations/${sandboxStationId}/charging-sandbox/chargers/${encodeURIComponent(charger.carregadorId)}/cashier-start`,
        { method: 'POST', body: JSON.stringify({ method: draft.method, amountReceived,
          operatorConfirmed: true,
          idempotencyKey: draft.idempotencyKey }) });
      if (!sandboxSessionMatches(created, Number(sandboxStationId), row.chargerId)) throw new Error('Sessão sandbox retornada para outro carregador.');
      const credit = sandboxCashierCredit(created);
      if (!credit || created.paymentMethod !== draft.method ||
          Math.round(credit.amountReceived * 100) !== Math.round(amountReceived * 100))
        throw new Error('Confirmação de caixa inválida na resposta sandbox.');
      setSandboxStartDraft(null);
      setSandboxMessage({ chargerId: charger.carregadorId,
        text: `Sessão ${created.id} iniciada em SANDBOX. Recebido ${formatCurrency(credit.amountReceived)} no caixa; estimativa inicial ${formatKwh(credit.estimatedKwhAtStart)}. Nenhum provedor online acionado.`, error: false });
      refreshSandbox();
    } catch (cause) {
      setSandboxMessage({ chargerId: charger.carregadorId,
        text: cause instanceof Error ? cause.message : 'Não foi possível iniciar a recarga sandbox.', error: true });
    } finally { sandboxSending.current = false; setSandboxBusyId(null); setSandboxTransition(null); }
  }

  async function stopSandbox(charger: Charger) {
    const row = activeSandbox?.chargers.find(item => String(item.chargerId) === charger.carregadorId);
    const session = row?.session;
    if (!['13', '46', '47'].includes(sandboxStationId ?? '') || !row || !session || !sandboxCanStop(row) ||
        !sandboxSessionMatches(session, Number(sandboxStationId), row.chargerId) || sandboxSending.current) return;
    const idempotencyKey = sandboxStopKeys.current.get(session.id) ?? requestId();
    sandboxStopKeys.current.set(session.id, idempotencyKey);
    sandboxSending.current = true;
    setSandboxBusyId(charger.carregadorId); setSandboxTransition({ chargerId: charger.carregadorId, status: 'FINISHING' }); setSandboxMessage(null);
    try {
      const stopped = await api.platform<SandboxSession>(
        `/v2/stations/${sandboxStationId}/charging-sandbox/sessions/${encodeURIComponent(session.id)}/stop`,
        { method: 'POST', body: JSON.stringify({ idempotencyKey }) });
      if (!sandboxSessionMatches(stopped, Number(sandboxStationId), row.chargerId) || stopped.id !== session.id)
        throw new Error('Encerramento sandbox retornado para outra sessão.');
      sandboxStopKeys.current.delete(session.id);
      setSandboxMessage({ chargerId: charger.carregadorId,
        text: `Sessão ${stopped.id} finalizada: ${formatKwh(stopped.energyKwh)} · ${formatCurrency(stopped.totalCost)} em SANDBOX.`, error: false });
      refreshSandbox();
    } catch (cause) {
      setSandboxMessage({ chargerId: charger.carregadorId,
        text: cause instanceof Error ? cause.message : 'Não foi possível encerrar a recarga sandbox.', error: true });
    } finally { sandboxSending.current = false; setSandboxBusyId(null); setSandboxTransition(null); }
  }

  async function showSandboxQr(charger: Charger) {
    const row = activeSandbox?.chargers.find(item => String(item.chargerId) === charger.carregadorId);
    if (!['13', '46', '47'].includes(sandboxStationId ?? '') || !row || sandboxSending.current) return;
    sandboxSending.current = true;
    setSandboxBusyId(charger.carregadorId); setSandboxMessage(null);
    try {
      const code = await api.platform<{ mode: 'SANDBOX'; stationId: number; chargerId: number;
        code: string; publicToken: string }>(
        `/v2/stations/${sandboxStationId}/charging-sandbox/chargers/${encodeURIComponent(charger.carregadorId)}/qr`,
        {}, { force: true });
      if (code.mode !== 'SANDBOX' || String(code.stationId) !== sandboxStationId || String(code.chargerId) !== charger.carregadorId ||
          !code.code || !code.publicToken) throw new Error('QR sandbox retornado para outro carregador.');
      setSandboxStartDraft(null);
      setSandboxQr({ chargerId: charger.carregadorId, code: code.code, publicToken: code.publicToken });
    } catch (cause) {
      setSandboxMessage({ chargerId: charger.carregadorId,
        text: cause instanceof Error ? cause.message : 'Código sandbox indisponível.', error: true });
    } finally { sandboxSending.current = false; setSandboxBusyId(null); }
  }

  return (
    <div
      className={`charger-visual-board${
        compact ? " charger-visual-board--compact" : ""
      }${
        hasInternalScroll ? " charger-visual-board--scrollable" : ""
      }`}
    >
      {['13', '46', '47'].includes(sandboxStationId ?? '') && activeSandboxError && <p className="charge-lifecycle-error" role="alert">Operação SANDBOX indisponível: {activeSandboxError}</p>}
      <div
        aria-label={
          hasInternalScroll
            ? `Lista com ${visibleChargers.length} carregadores. Role para ver todos.`
            : undefined
        }
        className="charger-map"
        role={hasInternalScroll ? "region" : undefined}
        tabIndex={hasInternalScroll ? 0 : undefined}
      >
        {visibleChargers.map((charger) => {
          const historic = historical?.[charger.carregadorId];
          const sandboxScope = !readOnly && ['13', '46', '47'].includes(sandboxStationId ?? '') && charger.estacaoId === sandboxStationId;
          const sandboxRow = sandboxScope ? activeSandbox?.chargers.find(item => String(item.chargerId) === charger.carregadorId) : undefined;
          const cashierCredit = sandboxCashierCredit(sandboxRow?.session ?? null);
          const sandboxShownStatus = sandboxRow ? sandboxTransition?.chargerId === charger.carregadorId
            ? sandboxTransition.status : sandboxRow.sandboxStatus : null;
          const sandboxLabel = sandboxShownStatus ? `${sandboxStatusLabel(sandboxShownStatus)} · SANDBOX` : null;
          const pendingDemo = readOnly && charger.administrativeStatus === 'PENDING';
          const pendingWithoutFault = pendingDemo && charger.status !== 'erro' && !charger.motivoFalha?.trim();
          const visual = pendingWithoutFault
            ? { ...chargerVisualStates.disponivel, tone: 'warning' as const }
            : chargerVisualStates[sandboxShownStatus ? sandboxVisualStatus(sandboxShownStatus) : charger.status];
          const awaitingRemoval=lifecycleRows.some(s=>s.chargerId===charger.carregadorId&&s.lifecycle?.stoppedAt&&!s.lifecycle.disconnectedAt);
          const postpaidSession = postpaidSessions[charger.carregadorId] ?? null;
          const postpaidUsage = postpaidSession
            ? getPostpaidUsage(charger)
            : null;
          const detailReason = readOnly
            ? { label: 'Origem', value: 'Histórico demonstrativo · SIMULATED; equipamento sem comando físico.' }
            : cashierCredit
            ? { label: 'Crédito SANDBOX', value: `Recebido ${formatCurrency(cashierCredit.amountReceived)}; consumido estimado ${formatCurrency(cashierCredit.consumedAmount)}; saldo ${formatCurrency(cashierCredit.remainingCredit)}. Estimativa inicial ${formatKwh(cashierCredit.estimatedKwhAtStart)} à tarifa ${formatCurrency(cashierCredit.pricePerKwh)}/kWh.${cashierCredit.returnStatus === 'PENDING' ? ' Acerto pendente no caixa.' : ''}` }
            : sandboxRow
            ? { label: 'Operação SANDBOX', value: `Simulador local; estado físico separado: ${sandboxRow.physicalStatus}. Nenhuma cobrança real.` }
            : postpaidSession
            ? {
                label: "Pagamento",
                value: "Conta aberta em caixa, cobrar no encerramento.",
              }
            : chargerDetailReason(charger);
          const canManualRelease = !readOnly && !sandboxScope && charger.status === "disponivel";
          const isManualReleaseOpen =
            !readOnly && !sandboxScope && manualReleaseDraft?.chargerId === charger.carregadorId;
          const isPostpaidSettlementOpen =
            !readOnly && !sandboxScope && postpaidSettlementDraft?.chargerId === charger.carregadorId;
          const isSandboxStartOpen = !!sandboxRow && sandboxStartDraft?.chargerId === charger.carregadorId;
          const isSandboxBusy = sandboxBusyId === charger.carregadorId;
          const manualReleaseValue = isManualReleaseOpen
            ? manualReleaseDraft.value
            : "";
          const manualReleaseMode = isManualReleaseOpen
            ? manualReleaseDraft.mode
            : "prepaid";
          const manualReleaseAmount = parseMoneyInput(manualReleaseValue);
          const manualReleaseKwh =
            Number.isFinite(manualReleaseAmount) && manualReleaseAmount > 0
              ? manualReleaseAmount / charger.tarifaKwh
              : 0;
          const postpaidSettlementValue = isPostpaidSettlementOpen
            ? postpaidSettlementDraft.value
            : "";
          const postpaidSettlementReceived = parseMoneyInput(postpaidSettlementValue);
          const isManualReleaseLoading =
            manualReleaseLoadingId === charger.carregadorId;
          const currentManualReleaseMessage =
            manualReleaseMessage?.chargerId === charger.carregadorId
              ? manualReleaseMessage
              : null;
          const isAnyChargerCommandLoading =
            chargerCommandLoadingKey?.startsWith(`${charger.carregadorId}:`) ??
            false;
          const commandKey = (command: ChargerCommand) =>
            `${charger.carregadorId}:${command}`;
          const displayedEnergyToday = sandboxRow ? sandboxRow.estimatedEnergyKwh ?? sandboxRow.session?.energyKwh ?? 0
            : readOnly ? historic?.deliveredKwh ?? 0
            : charger.energiaHojeKwh + (postpaidUsage?.energiaConsumidaKwh ?? 0);
          const displayedRevenue = sandboxRow ? cashierCredit?.consumedAmount ?? sandboxRow.estimatedCost ?? sandboxRow.session?.totalCost ?? 0
            : readOnly ? historic?.revenueSimulated ?? 0
            : charger.receitaHoje + (postpaidUsage?.valorCobrado ?? 0);
          const occupancyAngle = Math.min(
            360,
            Math.max(0, (readOnly ? historic?.utilizationPct ?? 0 : charger.ocupacaoHojePercent) * 3.6)
          );
          const detailAction: ChargerCardAction = {
            className: "charger-card-action--details",
            icon: Info,
            key: "detalhes",
            label: "Detalhes",
            onClick: () => undefined,
            title: "Mostrar detalhes do carregador",
          };
          const cardActions: ChargerCardAction[] = sandboxRow
            ? [sandboxCanStart(sandboxRow) ? {
                icon: Power, key: 'sandbox-iniciar', label: sandboxShownStatus === 'STARTING' ? 'Iniciando' : 'Iniciar',
                disabled: isSandboxBusy, loading: isSandboxBusy && sandboxShownStatus === 'STARTING', isActive: isSandboxStartOpen,
                onClick: () => openSandboxStart(charger), title: 'Iniciar recarga e pagamento fictícios em SANDBOX',
              } : sandboxCanStop(sandboxRow) ? {
                className: 'charger-card-action--danger', icon: Power, key: 'sandbox-parar', label: sandboxShownStatus === 'FINISHING' ? 'Finalizando' : 'Parar',
                disabled: isSandboxBusy, loading: isSandboxBusy,
                onClick: () => void stopSandbox(charger), title: 'Encerrar a sessão SANDBOX deste carregador',
              } : {
                icon: Clock3, key: 'sandbox-aguardar', label: sandboxStatusLabel(sandboxRow.sandboxStatus),
                disabled: true, onClick: () => undefined, title: 'Aguardando atualização da sessão SANDBOX',
              }, {
                icon: QrCode, key: 'sandbox-qr', label: 'QR', disabled: isSandboxBusy,
                onClick: () => void showSandboxQr(charger), title: 'Mostrar QR SANDBOX para App ou Web Charge autenticado',
              }, detailAction]
            : sandboxScope
            ? [{ icon: Power, key: 'sandbox-indisponivel', label: 'Iniciar', disabled: true,
                onClick: () => undefined, title: 'Aguardando estado SANDBOX válido para esta instalação' },
              { icon: RefreshCw, key: 'sandbox-atualizar', label: 'Atualizar',
                onClick: refreshSandbox, title: 'Consultar novamente a API SANDBOX' }, detailAction]
            : awaitingRemoval
            ? [{...detailAction,title:'Energia encerrada; retirada pendente'}, {icon:Clock3,key:'retirada',label:'Retirada pendente',disabled:true,onClick:()=>undefined,title:'Confirme a retirada na lista abaixo'}]
            :
            charger.status === "disponivel"
              ? [
                  {
                    disabled: !canManualRelease || isManualReleaseLoading,
                    icon: Banknote,
                    isActive: isManualReleaseOpen,
                    key: "caixa",
                    label: "Caixa",
                    loading: isManualReleaseLoading,
                    onClick: () => openManualRelease(charger),
                    title: "Liberar energia com pagamento recebido no caixa",
                  },
                  {
                    disabled: isAnyChargerCommandLoading,
                    icon: RefreshCw,
                    key: "sincronizar",
                    label: "Sincronizar",
                    loading:
                      chargerCommandLoadingKey ===
                      commandKey("sincronizar_status"),
                    onClick: () =>
                      void handleChargerCommand(charger, "sincronizar_status"),
                    title: "Atualizar status do carregador",
                  },
                  detailAction,
                ]
              : charger.status === "em_uso"
                ? postpaidSession
                  ? [
                      {
                        disabled: isManualReleaseLoading,
                        icon: Banknote,
                        isActive: isPostpaidSettlementOpen,
                        key: "cobrar",
                        label: "Cobrar",
                        loading: isManualReleaseLoading,
                        onClick: () => openPostpaidSettlement(charger),
                        title: "Cobrar a conta aberta no caixa",
                      },
                      {
                        disabled: isManualReleaseLoading,
                        icon: Unplug,
                        isActive: isPostpaidSettlementOpen,
                        key: "desplugar",
                        label: "Desplugar",
                        loading: isManualReleaseLoading,
                        onClick: () => openPostpaidSettlement(charger),
                        title: "Abrir acerto antes de liberar o conector",
                      },
                      detailAction,
                    ]
                  : [
                      {
                        className: "charger-card-action--danger",
                        disabled: isAnyChargerCommandLoading,
                        icon: Power,
                        key: "parar",
                        label: "Parar",
                        loading:
                          chargerCommandLoadingKey === commandKey("encerrar_carga"),
                        onClick: () =>
                          void handleChargerCommand(charger, "encerrar_carga"),
                        title: "Finalizar a carga em andamento",
                      },
                      {
                        disabled: isAnyChargerCommandLoading,
                        icon: Unplug,
                        key: "desplugar",
                        label: "Desplugar",
                        loading:
                          chargerCommandLoadingKey === commandKey("liberar_conector"),
                        onClick: () =>
                          void handleChargerCommand(charger, "liberar_conector"),
                        title: "Liberar o conector para retirada do cabo",
                      },
                      detailAction,
                    ]
                : charger.status === "manutencao"
                  ? [
                      {
                        disabled: isAnyChargerCommandLoading,
                        icon: ClipboardCheck,
                        key: "checklist",
                        label: "Checklist",
                        loading:
                          chargerCommandLoadingKey ===
                          commandKey("executar_checklist"),
                        onClick: () =>
                          void handleChargerCommand(charger, "executar_checklist"),
                        title: "Executar checklist operacional",
                      },
                      {
                        disabled: isAnyChargerCommandLoading,
                        icon: CalendarClock,
                        key: "teste",
                        label: "Teste",
                        loading:
                          chargerCommandLoadingKey === commandKey("agendar_teste"),
                        onClick: () =>
                          void handleChargerCommand(charger, "agendar_teste"),
                        title: "Agendar teste do carregador",
                      },
                      detailAction,
                    ]
                  : [
                      {
                        disabled: isAnyChargerCommandLoading,
                        icon: RotateCcw,
                        key: "reiniciar",
                        label: "Reiniciar",
                        loading:
                          chargerCommandLoadingKey ===
                          commandKey("reiniciar_equipamento"),
                        onClick: () =>
                          void handleChargerCommand(
                            charger,
                            "reiniciar_equipamento"
                          ),
                        title: "Reiniciar equipamento remotamente",
                      },
                      {
                        disabled: isAnyChargerCommandLoading,
                        icon: Wrench,
                        key: "manutencao",
                        label: "Manutencao",
                        loading:
                          chargerCommandLoadingKey ===
                          commandKey("solicitar_manutencao"),
                        onClick: () =>
                          void handleChargerCommand(
                            charger,
                            "solicitar_manutencao"
                          ),
                        title: "Solicitar manutencao tecnica",
                      },
                      detailAction,
                    ];
          const visibleActions = readOnly ? cardActions.map(action => action.key === 'detalhes' ? action : {
            ...action, disabled: true, title: 'Indisponível no histórico demonstrativo; nenhum comando ou pagamento é enviado.',
          }) : cardActions;
          return (
            <article
              className={`charger-bay charger-bay--${visual.tone}${
                isManualReleaseOpen || isPostpaidSettlementOpen
                || isSandboxStartOpen
                  ? " charger-bay--manual-open"
                  : ""
              }`}
              key={charger.carregadorId}
            >
              <div className="charger-bay__top">
                <div>
                  <strong>
                    {charger.nome} <span>({charger.localizacao})</span>
                  </strong>
                </div>
                <StatusBadge
                  status={sandboxShownStatus ? sandboxVisualStatus(sandboxShownStatus) : pendingWithoutFault ? 'pendente' : charger.status}
                  label={sandboxLabel ?? (pendingWithoutFault ? 'Pendente · sem conexão física' : pendingDemo ? 'Pendente · falha registrada' : visual.label)}
                />
              </div>

              <div className="charger-card-main">
                <div className="charger-bay__metrics">
                  <div className="charger-metric charger-metric--power">
                    <Zap size={13} aria-hidden="true" />
                    <span>
                      <strong>{sandboxRow ? sandboxRow.simulatedPowerKw == null ? '--' : formatKw(sandboxRow.simulatedPowerKw) : formatKw(readOnly ? charger.potenciaMaximaKw : charger.potenciaAtualKw)}</strong>
                      <small>{sandboxRow ? 'Potência simulada' : readOnly ? 'Potência cadastrada' : 'Potencia'}</small>
                    </span>
                  </div>
                  <div className="charger-metric">
                    <Gauge size={13} aria-hidden="true" />
                    <span>
                      <strong>{sandboxRow ? sandboxRow.session ? `#${sandboxRow.session.id.slice(-6)}` : '--' : readOnly ? historic?.sessions ?? 0 : chargerMetricFallback(charger.temperaturaC, " °C")}</strong>
                      <small>
                        {sandboxRow ? 'Sessão SANDBOX' : readOnly ? 'Recargas no período' : charger.temperaturaC === null ? "Sem dados" : "Temperatura"}
                      </small>
                    </span>
                  </div>
                  <div className="charger-metric charger-metric--energy">
                    <Zap size={13} aria-hidden="true" />
                    <span>
                      <strong>{formatKwh(displayedEnergyToday)}</strong>
                      <small>{sandboxRow ? 'Energia SANDBOX' : readOnly ? 'Energia no período' : 'Total'}</small>
                    </span>
                  </div>
                  <div className="charger-metric">
                    <Info size={13} aria-hidden="true" />
                    <span>
                      <strong>
                        {sandboxRow ? sandboxRow.session ? `${Math.max(0, Math.floor((nowMs - Date.parse(sandboxRow.session.startedAt)) / 60_000))} min` : '--' : readOnly ? historic?.utilizationPct == null ? '--' : `${historic.utilizationPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : charger.status === "em_uso"
                          ? `${charger.tempoMedioSessaoMinutos} min`
                          : "--"}
                      </strong>
                      <small>
                        {sandboxRow ? 'Duração SANDBOX' : readOnly ? 'Utilização histórica' : charger.status === "em_uso" ? "Media" : "Sessao"}
                      </small>
                    </span>
                  </div>
                </div>
                <ChargerScene visual={visual} />
              </div>

              <div className="charger-state-line">
                <span>{cashierCredit ? `Recebido ${formatCurrency(cashierCredit.amountReceived)} · saldo ${formatCurrency(cashierCredit.remainingCredit)}${cashierCredit.returnStatus === 'PENDING' ? ' · acerto pendente' : ''}` : sandboxLabel ?? (readOnly ? pendingDemo ? 'Pendente · histórico SIMULATED' : 'Histórico SIMULATED' : chargerOperationalLine(charger))}</span>
                <strong title={sandboxRow ? 'Consumo estimado SANDBOX; fora do financeiro real' : readOnly ? 'Receita simulada no período' : undefined}>{cashierCredit ? `Consumido ${formatCurrency(displayedRevenue)}` : formatCurrency(displayedRevenue)}</strong>
              </div>
              <div className="charger-card-actions">
                {visibleActions.map((action) => {
                  const ActionIcon = action.icon;

                  return (
                    <button
                      aria-describedby={
                        action.key === "detalhes"
                          ? `charger-details-${charger.carregadorId}`
                          : undefined
                      }
                      aria-expanded={action.isActive}
                      className={`charger-card-action${
                        action.className ? ` ${action.className}` : ""
                      }`}
                      disabled={action.disabled || action.loading}
                      key={action.key}
                      onClick={action.onClick}
                      title={action.title}
                      type="button"
                    >
                      {action.loading ? (
                        <Loader2 className="spin-icon" size={13} aria-hidden="true" />
                      ) : (
                        <ActionIcon size={13} aria-hidden="true" />
                      )}
                      {action.label}
                    </button>
                  );
                })}
              </div>
              {isSandboxStartOpen && sandboxStartDraft && (
                <form className="manual-release-panel" onSubmit={event => void startSandbox(event, charger)}>
                  <div className="manual-release-panel__head">
                    <Power size={16} aria-hidden="true" />
                    <div><strong>Iniciar recarga · SANDBOX</strong><small>Pagamento presencial no caixa; equipamento físico sem conexão.</small></div>
                    <button aria-label="Fechar início sandbox" className="manual-release-close"
                      disabled={isSandboxBusy} onClick={() => setSandboxStartDraft(null)} type="button"><X size={13} aria-hidden="true" /></button>
                  </div>
                  <div className="manual-release-mode" aria-label="Pagamento presencial">
                    {([['cash', 'Dinheiro no caixa'], ['pos', 'Recebimento externo · confirmação manual']] as const).map(([method, label]) =>
                      <button key={method} type="button" disabled={isSandboxBusy} aria-pressed={sandboxStartDraft.method === method}
                        className={sandboxStartDraft.method === method ? 'active' : ''}
                        onClick={() => setSandboxStartDraft({ ...sandboxStartDraft, method, operatorConfirmed: false })}>{label}</button>)}
                  </div>
                  <label className="manual-release-field" htmlFor={`sandbox-amount-${charger.carregadorId}`}>
                    Valor pré-pago recebido
                    <span className="manual-release-input"><span>R$</span><input id={`sandbox-amount-${charger.carregadorId}`}
                      autoComplete="off" inputMode="decimal" disabled={isSandboxBusy} value={sandboxStartDraft.amountReceived}
                      onChange={event => setSandboxStartDraft({ ...sandboxStartDraft, amountReceived: event.currentTarget.value, operatorConfirmed: false })} /></span>
                  </label>
                  <div className="manual-release-summary"><span>{sandboxRow.pricePerKwh == null ? 'Tarifa SANDBOX indisponível' : `Tarifa SANDBOX ${formatCurrency(sandboxRow.pricePerKwh)}/kWh`}</span><strong>Sem cobrança online</strong></div>
                  <label className="manual-release-field">
                    <input type="checkbox" checked={sandboxStartDraft.operatorConfirmed} disabled={isSandboxBusy}
                      onChange={event => setSandboxStartDraft({ ...sandboxStartDraft, operatorConfirmed: event.currentTarget.checked })} />{' '}
                    Recebi {Number.isFinite(parseMoneyInput(sandboxStartDraft.amountReceived)) && parseMoneyInput(sandboxStartDraft.amountReceived) > 0
                      ? formatCurrency(parseMoneyInput(sandboxStartDraft.amountReceived)) : 'o valor informado'} antes de iniciar
                  </label>
                  <div className="manual-release-actions">
                    <button className="manual-release-secondary" type="button" disabled={isSandboxBusy} onClick={() => setSandboxStartDraft(null)}>Cancelar</button>
                    <button className="manual-release-primary" type="submit" disabled={isSandboxBusy ||
                      !sandboxStartDraft.operatorConfirmed || !Number.isFinite(parseMoneyInput(sandboxStartDraft.amountReceived)) ||
                      parseMoneyInput(sandboxStartDraft.amountReceived) <= 0}>{isSandboxBusy ? 'Iniciando…' : 'Iniciar'}</button>
                  </div>
                </form>
              )}
              {sandboxQr?.chargerId === charger.carregadorId && (
                <div className="manual-release-panel" role="region" aria-label={`QR sandbox ${charger.nome}`}>
                  <div className="manual-release-panel__head"><QrCode size={16} aria-hidden="true" />
                    <div><strong>QR do carregador · SANDBOX</strong><small>App ou Web Charge autenticado na API local.</small></div>
                    <button aria-label="Fechar QR sandbox" className="manual-release-close" type="button"
                      onClick={() => setSandboxQr(null)}><X size={13} aria-hidden="true" /></button></div>
                  <div className="manual-release-summary"><QRCodeSVG value={webChargeUrl(sandboxQr.publicToken, typeof window === 'undefined' ? undefined : window.location.origin)} size={132}
                    bgColor="#ffffff" fgColor="#000000" marginSize={4} />
                    <strong>Código {sandboxQr.code}</strong><a href={webChargeUrl(sandboxQr.publicToken, typeof window === 'undefined' ? undefined : window.location.origin)} target="_blank" rel="noreferrer">Abrir Web Charge autenticado</a></div>
                </div>
              )}
              {isManualReleaseOpen && (
                <form
                  className="manual-release-panel"
                  onSubmit={(event) => submitManualRelease(event, charger)}
                >
                  <div className="manual-release-panel__head">
                    <Banknote size={16} aria-hidden="true" />
                    <div>
                      <strong>Pagamento em caixa</strong>
                      <small>Escolha limite por valor ou conta aberta.</small>
                    </div>
                    <button
                      aria-label="Fechar liberacao por caixa"
                      className="manual-release-close"
                      onClick={closeManualRelease}
                      type="button"
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="manual-release-mode" aria-label="Modo de caixa">
                    <button
                      aria-pressed={manualReleaseMode === "prepaid"}
                      className={manualReleaseMode === "prepaid" ? "active" : ""}
                      onClick={() => setManualReleaseMode("prepaid", charger)}
                      type="button"
                    >
                      Valor definido
                    </button>
                    <button
                      aria-pressed={manualReleaseMode === "postpaid"}
                      className={manualReleaseMode === "postpaid" ? "active" : ""}
                      onClick={() => setManualReleaseMode("postpaid", charger)}
                      type="button"
                    >
                      Conta aberta
                    </button>
                  </div>
                  {manualReleaseMode === "prepaid" ? (
                    <>
                      <label
                        className="manual-release-field"
                        htmlFor={`manual-release-${charger.carregadorId}`}
                      >
                        Valor recebido
                        <span className="manual-release-input">
                          <span>R$</span>
                          <input
                            autoComplete="off"
                            id={`manual-release-${charger.carregadorId}`}
                            inputMode="decimal"
                            onChange={(event) => {
                              setManualReleaseDraft({
                                chargerId: charger.carregadorId,
                                mode: "prepaid",
                                value: event.currentTarget.value,
                              });
                              setManualReleaseMessage(null);
                            }}
                            placeholder="0,00"
                            value={manualReleaseValue}
                          />
                        </span>
                      </label>
                      <div className="manual-release-summary">
                        <span>
                          Tarifa {formatCurrency(charger.tarifaKwh)}/kWh
                        </span>
                        <strong>{formatKwh(manualReleaseKwh)} liberados</strong>
                      </div>
                    </>
                  ) : (
                    <div className="manual-release-summary manual-release-summary--open">
                      <span>Sem limite pre-definido</span>
                      <strong>Pagamento no encerramento</strong>
                    </div>
                  )}
                  <div className="manual-release-actions">
                    <button
                      className="manual-release-secondary"
                      onClick={closeManualRelease}
                      type="button"
                    >
                      Cancelar
                    </button>
                    <button
                      className="manual-release-primary"
                      disabled={
                        (manualReleaseMode === "prepaid" && manualReleaseKwh <= 0) ||
                        isManualReleaseLoading
                      }
                      type="submit"
                    >
                      {isManualReleaseLoading
                        ? "Processando"
                        : manualReleaseMode === "prepaid"
                          ? "Liberar"
                          : "Iniciar"}
                    </button>
                  </div>
                </form>
              )}
              {isPostpaidSettlementOpen && postpaidUsage && postpaidSession && (
                <form
                  className="manual-release-panel manual-release-panel--settlement"
                  onSubmit={(event) => submitPostpaidSettlement(event, charger)}
                >
                  <div className="manual-release-panel__head">
                    <Banknote size={16} aria-hidden="true" />
                    <div>
                      <strong>Acerto no caixa</strong>
                      <small>Conta aberta desde {formatDateTime(postpaidSession.startedAt)}.</small>
                    </div>
                    <button
                      aria-label="Fechar acerto no caixa"
                      className="manual-release-close"
                      onClick={closePostpaidSettlement}
                      type="button"
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="manual-release-summary manual-release-summary--split">
                    <span>
                      Energia <strong>{postpaidUsage.energiaConsumidaKwh.toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2})} kWh</strong>
                    </span>
                    <span>
                      Tarifa <strong>{postpaidUsage.pricePerKwh.toLocaleString('pt-BR', {style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2})}/kWh</strong> · Energia <strong>{formatCurrency(postpaidUsage.energyAmount)}</strong> · Permanência <strong>{formatCurrency(postpaidUsage.overstayFee)}</strong> · Taxa fixa <strong>{formatCurrency(postpaidUsage.fixedFee)}</strong> · Total <strong>{formatCurrency(postpaidUsage.valorCobrado)}</strong>
                    </span>
                  </div>
                  <label
                    className="manual-release-field"
                    htmlFor={`postpaid-settlement-${charger.carregadorId}`}
                  >
                    Valor recebido
                    <span className="manual-release-input">
                      <span>R$</span>
                      <input
                        autoComplete="off"
                        id={`postpaid-settlement-${charger.carregadorId}`}
                        inputMode="decimal"
                        onChange={(event) => {
                          setPostpaidSettlementDraft({
                            chargerId: charger.carregadorId,
                            value: event.currentTarget.value,
                          });
                          setManualReleaseMessage(null);
                        }}
                        value={postpaidSettlementValue}
                      />
                    </span>
                  </label>
                  <div className="manual-release-actions">
                    <button
                      className="manual-release-secondary"
                      onClick={closePostpaidSettlement}
                      type="button"
                    >
                      Cancelar
                    </button>
                    <button
                      className="manual-release-primary"
                      disabled={
                        !Number.isFinite(postpaidSettlementReceived) ||
                        postpaidSettlementReceived < postpaidUsage.valorCobrado ||
                        isManualReleaseLoading
                      }
                      type="submit"
                    >
                      {isManualReleaseLoading ? "Recebendo" : "Confirmar retirada e receber"}
                    </button>
                  </div>
                </form>
              )}
              {sandboxMessage?.error && sandboxMessage.chargerId === charger.carregadorId && (
                <p className={`manual-release-message${sandboxMessage.error ? ' manual-release-message--error' : ''}`}
                  role={sandboxMessage.error ? 'alert' : 'status'}><Info size={14} aria-hidden="true" />{sandboxMessage.text}</p>
              )}
              {currentManualReleaseMessage && (
                <p
                  className="manual-release-message manual-release-message--error"
                >
                  <Info size={14} aria-hidden="true" />
                  {currentManualReleaseMessage.text}
                </p>
              )}
              <div
                className="charger-detail-panel"
                id={`charger-details-${charger.carregadorId}`}
                role="tooltip"
              >
                <div className="charger-detail-panel__head">
                  <span>
                    <Radio size={12} aria-hidden="true" />
                    <i aria-hidden="true" />
                    {readOnly ? 'Histórico SIMULATED' : sandboxRow ? 'Recarga SANDBOX' : 'Inspetor operacional'}
                  </span>
                  <strong>{sandboxLabel ?? (pendingDemo ? 'Pendente · sem conexão física' : visual.label)}</strong>
                </div>
                <div className="charger-detail-panel__body">
                  <div
                    className="charger-detail-occupancy"
                    style={{
                      background: `conic-gradient(var(--bay-color) ${occupancyAngle}deg, #ffffff12 0deg)`,
                    }}
                  >
                    <span>
                      <strong>{readOnly ? historic?.utilizationPct == null ? '--' : `${historic.utilizationPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : `${charger.ocupacaoHojePercent}%`}</strong>
                      <small>{readOnly ? 'Utilização histórica' : sandboxRow ? 'Ocupação física' : 'Ocupacao'}</small>
                    </span>
                  </div>
                  <dl>
                    <div className="charger-detail-metric">
                      <dt>
                        <Zap size={12} aria-hidden="true" />
                        {readOnly ? 'Potência cadastrada' : sandboxRow ? 'Potência simulada' : 'Potencia atual'}
                      </dt>
                      <dd>
                        {sandboxRow ? sandboxRow.simulatedPowerKw == null ? '--' : formatKw(sandboxRow.simulatedPowerKw) : formatKw(readOnly ? charger.potenciaMaximaKw : charger.potenciaAtualKw)}
                        <small>Max. {formatKw(charger.potenciaMaximaKw)}</small>
                      </dd>
                    </div>
                    <div className="charger-detail-metric">
                      <dt>
                        <Activity size={12} aria-hidden="true" />
                        {readOnly ? 'Recargas no período' : sandboxRow ? 'Sessões SANDBOX recentes' : 'Sessoes hoje'}
                      </dt>
                      <dd>{sandboxRow ? activeSandbox?.sessions.filter(session => String(session.chargerId) === charger.carregadorId).length ?? 0 : readOnly ? historic?.sessions ?? 0 : charger.sessoesHoje}</dd>
                    </div>
                    <div className="charger-detail-metric">
                      <dt>
                        <Zap size={12} aria-hidden="true" />
                        {readOnly ? 'Energia no período' : sandboxRow ? 'Energia SANDBOX' : 'Energia hoje'}
                      </dt>
                      <dd>{formatKwh(displayedEnergyToday)}</dd>
                    </div>
                    <div className="charger-detail-metric">
                      <dt>
                        <Cable size={12} aria-hidden="true" />
                        Conector
                      </dt>
                      <dd>{charger.tipoConector}</dd>
                    </div>
                  </dl>
                </div>
                <div className="charger-detail-panel__session">
                  <span>
                    <Clock3 size={12} aria-hidden="true" />
                    {sandboxRow ? 'Estado da sessão' : 'Media por sessao'}
                  </span>
                  <strong>{readOnly ? 'Histórico SIMULATED' : sandboxRow ? sandboxLabel : `${charger.tempoMedioSessaoMinutos} min`}</strong>
                  <i aria-hidden="true">
                    <b
                      style={{
                          width: `${Math.min(
                          100,
                          Math.max(8, readOnly ? historic?.utilizationPct ?? 0 : charger.ocupacaoHojePercent)
                        )}%`,
                      }}
                    />
                  </i>
                </div>
                <div className="charger-detail-panel__insights">
                  <div>
                    <Info size={14} aria-hidden="true" />
                    <span>
                      <small>{detailReason.label}</small>
                      <strong>{detailReason.value}</strong>
                    </span>
                  </div>
                  <div>
                    <ShieldCheck size={14} aria-hidden="true" />
                    <span>
                      <small>Proxima acao</small>
                      <strong>{readOnly ? 'Sem comando físico' : sandboxRow ? 'Recarga fictícia; comando físico separado e bloqueado.' : chargerRecommendedAction(charger)}</strong>
                    </span>
                  </div>
                </div>
                <footer className="charger-detail-panel__footer">
                  <span>{readOnly ? 'Origem' : sandboxRow ? 'Estado físico' : 'Ultimo sinal'}</span>
                  <time dateTime={sandboxRow ? undefined : charger.ultimaComunicacao}>
                    {readOnly ? 'SIMULATED · sem sinal físico' : sandboxRow ? sandboxRow.physicalStatus : formatDateTime(charger.ultimaComunicacao)}
                  </time>
                </footer>
              </div>
              <small className="charger-bay__sync">
                {readOnly ? 'Sem conexão física' : sandboxRow ? `SANDBOX · físico ${sandboxRow.physicalStatus}` : `Sync ${formatDateTime(charger.ultimaComunicacao)}`}
              </small>
            </article>
          );
        })}
      </div>
      <ChargeLifecyclePanel sessions={readOnly ? [] : lifecycleRows.filter(s=>visibleChargers.some(c=>c.carregadorId===s.chargerId))} readAt={lifecycleReadAt} onRefresh={()=>setLifecycleRefresh(n=>n+1)}/>
      {activeSandbox && <section className="charge-lifecycle-panel" aria-label="Sessões recentes SANDBOX">
        <h3>Sessões recentes · SANDBOX <small>Estimativas locais, fora do financeiro real</small></h3>
        {activeSandbox.sessions.length ? activeSandbox.sessions.map(session => {
          const credit = sandboxCashierCredit(session);
          const method = session.paymentMethod === 'cash' ? 'Dinheiro no caixa'
            : session.paymentMethod === 'pos' ? 'Recebimento externo · confirmação manual'
            : session.paymentMethod === 'pix' ? 'Pix' : session.paymentMethod === 'card' ? 'Cartão' : 'Carteira';
          return <div className="charge-lifecycle-row" key={session.id}>
          <div><strong>{session.evse} · #{session.id.slice(-8)}</strong><span>{formatDateTime(session.startedAt)}</span></div>
          <div><strong>{session.status === 'completed' ? 'Finalizada' : session.status === 'stopping' ? 'Finalizando' : session.status === 'starting' ? 'Iniciando' : 'Carregando'}</strong><span>{method} · {credit ? 'recebimento confirmado no caixa' : 'pagamento fictício'}</span></div>
          <div><strong>{formatKwh(session.energyKwh)}</strong><span>Energia SANDBOX</span></div>
          <div><strong>{formatCurrency(credit?.consumedAmount ?? session.totalCost)}</strong><span>{credit ? `Recebido ${formatCurrency(credit.amountReceived)} · saldo ${formatCurrency(credit.remainingCredit)}${credit.returnStatus === 'PENDING' ? ' · acerto pendente' : ''}` : session.status === 'completed' ? 'Valor final SANDBOX' : 'Valor estimado SANDBOX'}</span></div>
        </div>}) : <p>Nenhuma recarga SANDBOX iniciada.</p>}
      </section>}
    </div>
  );
}

