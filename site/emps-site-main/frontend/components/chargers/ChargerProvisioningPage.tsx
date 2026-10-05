"use client";
import { StationRegistration } from './StationRegistration';
import { CanonicalChargers } from './CanonicalChargers';


import {
  BadgeCheck,
  Ban,
  CheckCircle2,
  Clipboard,
  Download,
  KeyRound,
  LoaderCircle,
  PlugZap,
  Plus,
  RefreshCw,
  Router,
  ShieldCheck,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AppShell } from "@/components/shell/AppShell";
import type {
  ChargerProvisioning,
  ChargerProvisioningStationOption,
  CreateChargerProvisioningRequest,
  UserRole,
} from "@/domain/emps";
import { api, frontSession } from "@/services/emps-api";

const statusLabels: Record<ChargerProvisioning["status"], string> = {
  CANCELED: "Cancelada",
  ENABLED: "Ativa no app",
  EXPIRED: "Código expirado",
  PENDING_APPROVAL: "Aguardando EMPS",
  PENDING_CONNECTION: "Aguardando instalação",
  REJECTED: "Rejeitada",
};

const statusTones: Record<ChargerProvisioning["status"], string> = {
  CANCELED: "neutral",
  ENABLED: "success",
  EXPIRED: "warning",
  PENDING_APPROVAL: "info",
  PENDING_CONNECTION: "warning",
  REJECTED: "danger",
};

const initialForm: CreateChargerProvisioningRequest = {
  connectorType: "CCS2",
  location: "",
  manufacturer: "",
  model: "",
  name: "",
  ocppIdentity: "",
  ocppVersion: "1.6J",
  phaseCount: 3,
  powerKw: 60,
  powerType: "DC",
  pricePerKwh: 1.89,
  serialNumber: "",
  stationId: "",
};

const initialClaim = {
  activationCode: "",
  firmwareVersion: "",
  ocppIdentity: "",
  serialNumber: "",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusStep(status: ChargerProvisioning["status"]) {
  if (status === "ENABLED") return 4;
  if (status === "PENDING_APPROVAL") return 3;
  if (status === "PENDING_CONNECTION") return 2;
  return 1;
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function downloadQr(id: string, code: string) {
  const svg = document.getElementById(`provisioning-qr-${id}`);
  if (!(svg instanceof SVGElement)) return;
  const source = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${code}.svg`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Progress({ item }: { item: ChargerProvisioning }) {
  const current = statusStep(item.status);
  const terminal = ["CANCELED", "EXPIRED", "REJECTED"].includes(item.status);
  const steps = ["Solicitada", "Instalada", "Homologada", "Liberada"];
  return (
    <ol className={`provisioning-progress ${terminal ? "is-terminal" : ""}`}>
      {steps.map((label, index) => (
        <li className={index + 1 <= current ? "is-complete" : ""} key={label}>
          <span>{index + 1 <= current ? <CheckCircle2 size={13} /> : index + 1}</span>
          <small>{label}</small>
        </li>
      ))}
    </ol>
  );
}

export function ChargerProvisioningPage() {
  const [items, setItems] = useState<ChargerProvisioning[]>([]);
  const [stations, setStations] = useState<ChargerProvisioningStationOption[]>([]);
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showInstaller, setShowInstaller] = useState(false);
  const [activationCode, setActivationCode] = useState("");
  const [form, setForm] = useState(initialForm);
  const [claim, setClaim] = useState(initialClaim);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  const load = useCallback(async (visible = true) => {
    if (visible) setLoading(true);
    setError("");
    try {
      const [nextItems, nextStations] = await Promise.all([
        api.listProvisionings(),
        api.provisioningStations(),
      ]);
      setItems(nextItems);
      setStations(nextStations);
      setForm((current) => ({
        ...current,
        stationId: current.stationId || nextStations[0]?.id || "",
      }));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar os cadastros de bombas."
      );
    } finally {
      if (visible) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setRole(frontSession.get()?.role ?? null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const counts = useMemo(
    () => ({
      active: items.filter((item) => item.status === "ENABLED").length,
      approval: items.filter((item) => item.status === "PENDING_APPROVAL").length,
      installation: items.filter((item) => item.status === "PENDING_CONNECTION").length,
    }),
    [items]
  );
  const canRequest = role === "admin" || role === "proprietario";

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    setError("");
    try {
      const created = await api.createProvisioning(form);
      setActivationCode(created.activationCode);
      setClaim({
        activationCode: created.activationCode,
        firmwareVersion: "",
        ocppIdentity: created.ocppIdentity,
        serialNumber: created.serialNumber,
      });
      setForm((current) => ({ ...initialForm, stationId: current.stationId }));
      setShowCreate(false);
      setShowInstaller(true);
      setNotice("Solicitação criada. Entregue o código único ao instalador da bomba.");
      await load(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Falha ao solicitar cadastro.");
    } finally {
      setBusy("");
    }
  }

  async function submitClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("claim");
    setError("");
    try {
      await api.claimProvisioning({
        ...claim,
        firmwareVersion: claim.firmwareVersion || undefined,
      });
      setClaim(initialClaim);
      setActivationCode("");
      setShowInstaller(false);
      setNotice("Bomba física validada. A equipe GoodWe já pode aprovar o equipamento.");
      await load(false);
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Falha na validação física.");
    } finally {
      setBusy("");
    }
  }

  async function runAction(
    id: string,
    action: "approve" | "reject" | "cancel" | "delete"
  ) {
    if (
      action === "delete" &&
      !window.confirm(
        "Excluir este registro definitivamente? Essa ação não pode ser desfeita."
      )
    ) {
      return;
    }
    setBusy(`${action}:${id}`);
    setError("");
    try {
      if (action === "approve") {
        await api.approveProvisioning(id);
        setNotice("Bomba aprovada pela GoodWe: carregador e QR Code liberados para o aplicativo.");
      } else if (action === "reject") {
        await api.rejectProvisioning(id, rejectReasons[id] ?? "");
        setNotice("Solicitação rejeitada e registrada no histórico.");
      } else if (action === "cancel") {
        await api.cancelProvisioning(id);
        setNotice("Solicitação cancelada.");
      } else {
        await api.deleteProvisioning(id);
        setNotice("Registro da bomba excluído.");
      }
      await load(false);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Não foi possível concluir a ação.");
    } finally {
      setBusy("");
    }
  }

  return (
    <AppShell
      eyebrow={role === "goodwe" ? "SEMS+ / GoodWe" : "EMPS / Infraestrutura"}
      title={role === "goodwe" ? "Aprovação de eletropostos" : "Cadastro de carregadores"}
      description={
        role === "goodwe"
          ? "Análise final dos equipamentos conectados e liberação segura do QR Code."
          : "Solicitação e ativação física antes da aprovação independente pela GoodWe."
      }
      showEmpsHeaderLogo
    >
      <CanonicalChargers />
      {role === "admin" && <StationRegistration onCreated={() => void load()} />}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={16} />
          {notice}
        </div>
      )}

      <section className="provisioning-hero panel">
        <div>
          <span className="provisioning-kicker">
            <ShieldCheck size={15} /> Cadastro físico controlado
          </span>
          <h2>Nenhuma bomba entra no aplicativo sem existir e ser homologada.</h2>
          <p>
            O dono solicita, o instalador prova a identidade do equipamento e a GoodWe
            libera o carregador com QR Code único.
          </p>
        </div>
        <div className="provisioning-hero__actions">
          <button
            className="provisioning-button provisioning-button--ghost"
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw size={16} /> Atualizar
          </button>
          {canRequest && (
            <button
              className="provisioning-button"
              onClick={() => setShowCreate(true)}
              type="button"
            >
              <Plus size={17} /> Solicitar nova bomba
            </button>
          )}
        </div>
      </section>

      <section className="provisioning-metrics" aria-label="Resumo do provisionamento">
        <article>
          <Unplug size={18} />
          <span><strong>{counts.installation}</strong><small>Aguardando instalação</small></span>
        </article>
        <article>
          <BadgeCheck size={18} />
          <span><strong>{counts.approval}</strong><small>Aguardando aprovação GoodWe</small></span>
        </article>
        <article>
          <PlugZap size={18} />
          <span><strong>{counts.active}</strong><small>Liberadas no aplicativo</small></span>
        </article>
      </section>

      {error && (
        <div className="provisioning-error" role="alert">
          <Ban size={17} /> {error}
        </div>
      )}

      {canRequest && (
        <section className="installer-strip panel">
          <div>
            <KeyRound size={20} />
            <span>
              <strong>Área de ativação do instalador</strong>
              <small>
                Use o código temporário junto do número de série e da identidade OCPP da
                bomba física.
              </small>
            </span>
          </div>
          <button
            className="provisioning-button provisioning-button--ghost"
            onClick={() => setShowInstaller((open) => !open)}
            type="button"
          >
            {showInstaller ? "Fechar ativação" : "Validar equipamento"}
          </button>
        </section>
      )}

      {showInstaller && canRequest && (
        <form className="provisioning-form panel" onSubmit={submitClaim}>
          <div className="provisioning-section-title">
            <div>
              <KeyRound size={18} />
              <span><strong>Validação da bomba física</strong><small>Etapa executada uma única vez durante a instalação.</small></span>
            </div>
            <button aria-label="Fechar" className="icon-button" onClick={() => setShowInstaller(false)} type="button"><X size={17} /></button>
          </div>
          {activationCode && (
            <div className="activation-code">
              <span><small>Código gerado — aparece somente agora</small><strong>{activationCode}</strong></span>
              <button onClick={() => void copyText(activationCode).then(() => setNotice("Código copiado."))} type="button"><Clipboard size={15} /> Copiar</button>
            </div>
          )}
          <div className="provisioning-form-grid">
            <label><span>Código de ativação</span><input required value={claim.activationCode} onChange={(event) => setClaim({ ...claim, activationCode: event.target.value })} placeholder="EMPS-AB12-CD34-EF56-7890" /></label>
            <label><span>Número de série</span><input required value={claim.serialNumber} onChange={(event) => setClaim({ ...claim, serialNumber: event.target.value })} /></label>
            <label><span>Identidade OCPP</span><input required value={claim.ocppIdentity} onChange={(event) => setClaim({ ...claim, ocppIdentity: event.target.value })} /></label>
            <label><span>Firmware instalado</span><input value={claim.firmwareVersion} onChange={(event) => setClaim({ ...claim, firmwareVersion: event.target.value })} placeholder="Opcional" /></label>
          </div>
          <div className="provisioning-form-actions">
            <button className="provisioning-button" disabled={busy === "claim"} type="submit">
              {busy === "claim" ? <LoaderCircle className="spin" size={16} /> : <Router size={16} />}
              Confirmar conexão física
            </button>
          </div>
        </form>
      )}

      {showCreate && canRequest && (
        <form className="provisioning-form panel" onSubmit={submitCreate}>
          <div className="provisioning-section-title">
            <div><Plus size={18} /><span><strong>Nova solicitação</strong><small>Cadastre quantas bombas físicas o eletroposto precisar, uma por vez.</small></span></div>
            <button aria-label="Fechar" className="icon-button" onClick={() => setShowCreate(false)} type="button"><X size={17} /></button>
          </div>
          <div className="provisioning-form-grid provisioning-form-grid--wide">
            <label><span>Eletroposto</span><select required value={form.stationId} onChange={(event) => setForm({ ...form, stationId: event.target.value })}><option value="">Selecione</option>{stations.map((station) => <option key={station.id} value={station.id}>{station.name} — {station.city}/{station.state}</option>)}</select></label>
            <label><span>Nome da bomba</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Carregador A02" /></label>
            <label><span>Local físico</span><input required value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Vaga A02" /></label>
            <label><span>Fabricante</span><input required value={form.manufacturer} onChange={(event) => setForm({ ...form, manufacturer: event.target.value })} /></label>
            <label><span>Modelo</span><input required value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} /></label>
            <label><span>Número de série</span><input required value={form.serialNumber} onChange={(event) => setForm({ ...form, serialNumber: event.target.value })} /></label>
            <label><span>Identidade OCPP</span><input required value={form.ocppIdentity} onChange={(event) => setForm({ ...form, ocppIdentity: event.target.value })} /></label>
            <label><span>Versão OCPP</span><select value={form.ocppVersion} onChange={(event) => setForm({ ...form, ocppVersion: event.target.value as "1.6J" | "2.0.1" })}><option value="1.6J">1.6J</option><option value="2.0.1">2.0.1</option></select></label>
            <label><span>Conector</span><select value={form.connectorType} onChange={(event) => setForm({ ...form, connectorType: event.target.value })}><option>CCS2</option><option>Type 2</option><option>CHAdeMO</option><option>GB/T</option></select></label>
            <label><span>Tipo de potência</span><select value={form.powerType} onChange={(event) => setForm({ ...form, powerType: event.target.value as "AC" | "DC" })}><option value="DC">DC</option><option value="AC">AC</option></select></label>
            <label><span>Fases</span><select value={form.phaseCount} onChange={(event) => setForm({ ...form, phaseCount: Number(event.target.value) as 1 | 3 })}><option value={1}>Monofásica</option><option value={3}>Trifásica</option></select></label>
            <label><span>Potência (kW)</span><input min="0.1" required step="0.1" type="number" value={form.powerKw} onChange={(event) => setForm({ ...form, powerKw: Number(event.target.value) })} /></label>
            <label><span>Tarifa (R$/kWh)</span><input min="0.01" required step="0.01" type="number" value={form.pricePerKwh} onChange={(event) => setForm({ ...form, pricePerKwh: Number(event.target.value) })} /></label>
          </div>
          <div className="provisioning-form-actions">
            <button className="provisioning-button" disabled={busy === "create" || !stations.length} type="submit">
              {busy === "create" ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
              Gerar solicitação e código
            </button>
          </div>
        </form>
      )}

      <section className="provisioning-list">
        <div className="provisioning-list__heading">
          <div>
            <h2>
              {role === "goodwe"
                ? "Fila de aprovação GoodWe"
                : role === "admin"
                  ? "Solicitações de instalação"
                  : "Solicitações de instalação"}
            </h2>
            <p>{items.length} solicitação(ões) no histórico, sem limite artificial de quantidade.</p>
          </div>
        </div>
        {loading ? (
          <div className="loading-panel panel"><LoaderCircle className="spin" size={20} /> Carregando cadastros</div>
        ) : items.length === 0 ? (
          <div className="empty-state panel"><PlugZap size={23} /><strong>Nenhuma solicitação cadastrada</strong><small>Os carregadores já cadastrados aparecem na lista acima. Solicite aqui somente uma nova instalação física.</small></div>
        ) : (
          <div className="provisioning-card-grid">
            {items.map((item) => {
              const qr = item.charger?.qrBindings[0];
              const chargeUrl=qr ? window.location.origin+"/charge/"+encodeURIComponent(qr.publicToken || qr.code) : "";
              const actionBusy = busy.endsWith(`:${item.id}`);
              return (
                <article className="provisioning-card panel" key={item.id}>
                  <div className="provisioning-card__head">
                    <div><small>{item.station.name}</small><h3>{item.name}</h3><p>{item.location} · {item.connectorType} · {item.powerKw} kW</p></div>
                    <span className={`status-badge status-badge--${statusTones[item.status]}`}><i />{statusLabels[item.status]}</span>
                  </div>
                  <Progress item={item} />
                  <dl className="provisioning-details">
                    <div><dt>Fabricante / modelo</dt><dd>{item.manufacturer} {item.model}</dd></div>
                    <div><dt>Número de série</dt><dd>{item.serialNumber}</dd></div>
                    <div><dt>Identidade OCPP</dt><dd>{item.ocppIdentity}</dd></div>
                    <div><dt>Solicitada em</dt><dd>{formatDate(item.createdAt)}</dd></div>
                    {item.connectionVerifiedAt && <div><dt>Conexão validada</dt><dd>{formatDate(item.connectionVerifiedAt)}</dd></div>}
                    {item.reviewedBy && <div><dt>Analisada por</dt><dd>{item.reviewedBy.name}</dd></div>}
                  </dl>

                  {item.status === "PENDING_CONNECTION" && (
                    <p className="provisioning-callout"><KeyRound size={15} />Código de ativação termina em <strong>{item.activationTokenLastFour}</strong> e expira em {formatDate(item.activationExpiresAt)}.</p>
                  )}
                  {item.rejectionReason && (
                    <p className="provisioning-callout provisioning-callout--danger"><Ban size={15} /><strong>Motivo:</strong> {item.rejectionReason}</p>
                  )}

                  {qr && item.charger && (
                    <div className="provisioning-qr">
                      <div className="provisioning-qr__image">
                        <QRCodeSVG bgColor="#ffffff" fgColor="#111318" id={`provisioning-qr-${item.id}`} level="M" marginSize={2} size={132} value={chargeUrl} />
                      </div>
                      <div>
                        <small>QR Code oficial da bomba</small><strong>{qr.code}</strong><p>Abra a recarga no navegador ou leia pelo App EMPS.</p>
                        <div className="provisioning-inline-actions">
                          <button onClick={() => void copyText(chargeUrl).then(() => setNotice("Código do QR copiado."))} type="button"><Clipboard size={14} />Copiar</button>
                          <button onClick={() => downloadQr(item.id, qr.code)} type="button"><Download size={14} />Baixar SVG</button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="provisioning-card__actions">
                    {canRequest && ["PENDING_CONNECTION", "PENDING_APPROVAL"].includes(item.status) && (
                      <button className="provisioning-button provisioning-button--danger" disabled={actionBusy} onClick={() => void runAction(item.id, "cancel")} type="button"><X size={15} />Cancelar</button>
                    )}
                    {canRequest && ["CANCELED", "EXPIRED", "REJECTED"].includes(item.status) && !item.charger && (
                      <button className="provisioning-button provisioning-button--danger" disabled={actionBusy} onClick={() => void runAction(item.id, "delete")} type="button">{busy === `delete:${item.id}` ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}Excluir registro</button>
                    )}
                    {(role === "admin" || role === "goodwe") && item.status === "PENDING_APPROVAL" && (
                      <div className="provisioning-review">
                        <input onChange={(event) => setRejectReasons({ ...rejectReasons, [item.id]: event.target.value })} placeholder="Motivo, se for rejeitar" value={rejectReasons[item.id] ?? ""} />
                        <button className="provisioning-button provisioning-button--danger" disabled={actionBusy || (rejectReasons[item.id]?.trim().length ?? 0) < 5} onClick={() => void runAction(item.id, "reject")} type="button"><Ban size={15} />Rejeitar</button>
                        <button className="provisioning-button" disabled={actionBusy} onClick={() => void runAction(item.id, "approve")} type="button">{actionBusy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}Aprovar e gerar QR</button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}
