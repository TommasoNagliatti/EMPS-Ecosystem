'use client';

import { ArrowLeft, ArrowRight, Check, Save } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { api } from '@/services/emps-api';
import { draftFrom, emptyDraft, reviewLabels, type Draft, type Station } from './station-types';
import { photoIssue, validateWizardDraft, wizardSteps, type WizardIssue, type WizardStep } from './station-wizard-model';
import { persistWizardDraft } from './station-wizard-save';
import { StationLocationFields } from './StationLocationFields';
import { StationEquipmentFields } from './StationEquipmentFields';
import { StationFinishFields, type WizardPhotos } from './StationFinishFields';
import { StationTeam } from './StationTeam';
import { WizardDisclosure } from './StationWizardField';
import styles from './station-wizard.module.css';

export function StationWizard({ id }: { id?: string }) {
  const [station, setStation] = useState<Station | null>(null);
  const [draft, setDraft] = useState<Draft>(() => ({ ...emptyDraft(), name: '' }));
  const [stationId, setStationId] = useState(id);
  const [step, setStep] = useState<WizardStep>(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issue, setIssue] = useState<WizardIssue | null>(null);
  const [photos, setPhotos] = useState<WizardPhotos>({});
  const creating = useRef<Promise<Station> | null>(null);
  const saving = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true); setStation(null); setStationId(id); setPhotos({});
    void api.platform<Station>(`/v2/stations/${id}`).then(row => {
      if (alive) { setStation(row); setDraft(draftFrom(row)); }
    }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a instalação.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);
  useEffect(() => { if (error) alert.current?.focus(); }, [error, issue]);

  const owner = !id && !station || station?.membershipRole === 'OWNER';
  const canEdit = !id && !station || !!station && ['OWNER', 'MANAGER'].includes(station.membershipRole);
  const pending = station?.reviewState === 'PENDING_REVIEW' || !!station?.technicalReviewRequired;
  const disabled = busy || loading || !canEdit || pending;
  const canSubmit = owner && station?.status !== 'ACTIVE' && ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(station?.reviewState ?? 'DRAFT');

  function change(key: string, value: unknown) {
    setDraft(current => ({ ...current, [key]: value }));
    setNotice('');
  }
  function goTo(next: WizardStep) {
    setStep(next);
    requestAnimationFrame(() => heading.current?.focus());
  }
  async function ensureId() {
    if (stationId) return stationId;
    if (!creating.current) creating.current = api.platform<Station>('/v2/stations', { method: 'POST' });
    try {
      const row = await creating.current;
      setStationId(row.id); setStation(row);
      return row.id;
    } catch (cause) { creating.current = null; throw cause; }
  }
  async function save(submit = false) {
    if (saving.current || disabled || submit && !canSubmit) return;
    const validation = validateWizardDraft(draft, submit);
    if (validation) { setIssue(validation); setError(validation.message); setStep(validation.step); return; }
    saving.current = true;
    setBusy(true); setError(''); setIssue(null); setNotice('');
    try {
      const sid = await ensureId();
      const row = await persistWizardDraft({ stationId: sid, station, draft, photos, submit, request: api.platform,
        onPhotoSaved: position => setPhotos(current => { const next = { ...current }; delete next[position]; return next; }) });
      setStation(row); setDraft(draftFrom(row));
      setNotice(submit ? 'Instalação enviada para análise.' : row.technicalReviewRequired ? 'Alterações técnicas enviadas para revisão.' : 'Alterações salvas.');
      history.replaceState(null, '', `/stations/${sid}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a instalação.'); }
    finally { setBusy(false); saving.current = false; }
  }
  function selectPhoto(position: number, file?: File) {
    const validation = file && photoIssue(file);
    if (validation) { setError(validation); return; }
    setError(''); setNotice('');
    setPhotos(current => { const next = { ...current }; if (file) next[position] = file; else delete next[position]; return next; });
  }

  return <AppShell eyebrow="EMPS / Instalações" title={id ? 'Editar instalação' : 'Nova instalação'} hideEyebrow showRealtimeStatus={false} className={styles.shell}>
    <div className={styles.page}>
      <div className={styles.pageHeading}><Link href="/stations" className={styles.backLink}><ArrowLeft size={17} aria-hidden="true" />Minhas instalações</Link><span className={styles.reviewState}>{reviewLabels[station?.reviewState ?? 'DRAFT']}</span></div>
      {loading ? <p className={styles.loading} role="status">Carregando instalação…</p> : <>
        <nav className={styles.steps} aria-label="Etapas do cadastro"><ol>{wizardSteps.map((name, index) => <li key={name} className={index === step ? styles.currentStep : index < step ? styles.previousStep : ''}>
          <button type="button" aria-current={index === step ? 'step' : undefined} disabled={busy} onClick={() => goTo(index as WizardStep)}><span className={styles.stepNumber}>{index < step ? <Check size={15} aria-hidden="true" /> : index + 1}</span><span>{name}</span></button>
        </li>)}</ol></nav>
        <div className={`${styles.body} ${step === 0 ? styles.locationBody : ''}`}>
          {error && <div ref={alert} tabIndex={-1} className={styles.alert} role="alert">{error}</div>}
          {notice && <p className={styles.notice} role="status">{notice}</p>}
          {pending && <p className={styles.notice}>{station?.status === 'ACTIVE' ? 'Alteração em análise. A configuração aprovada continua ativa.' : 'Instalação em análise. O cadastro ficará privado até a aprovação.'}</p>}
          {station?.reviews?.[0]?.reason && <p className={styles.notice}>Última revisão: {station.reviews[0].reason}</p>}
          {id && !station ? <p className={styles.notice}>Cadastro indisponível. Volte à lista para tentar novamente.</p> : <>
            <h2 className={styles.srOnly} tabIndex={-1} ref={heading}>{wizardSteps[step]}</h2>
            <fieldset disabled={disabled} className={styles.form} aria-label={wizardSteps[step]}>
              {step === 0 && <StationLocationFields draft={draft} onChange={change} issuePath={issue?.path} disabled={disabled} />}
              {step === 1 && <StationEquipmentFields draft={draft} onChange={change} issuePath={issue?.path} />}
              {step === 2 && <StationFinishFields draft={draft} station={station} photos={photos} onPhotoChange={selectPhoto} onChange={change} onEdit={goTo} />}
            </fieldset>
          </>}
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.secondary} disabled={disabled} onClick={() => void save()}><Save size={16} aria-hidden="true" />{busy ? 'Salvando…' : station?.status === 'ACTIVE' ? 'Salvar alterações' : 'Salvar rascunho'}</button>
          <div className={styles.footerNavigation}>
            {step > 0 && <button type="button" className={styles.secondary} disabled={busy} onClick={() => goTo((step - 1) as WizardStep)}><ArrowLeft size={16} aria-hidden="true" />Voltar</button>}
            {step < 2 ? <button type="button" className={styles.primary} disabled={busy || !!id && !station} onClick={() => goTo((step + 1) as WizardStep)}>Continuar<ArrowRight size={16} aria-hidden="true" /></button> : canSubmit && <button type="button" className={styles.primary} disabled={disabled} onClick={() => void save(true)}>Enviar para análise<ArrowRight size={16} aria-hidden="true" /></button>}
          </div>
        </footer>
        {step === 2 && stationId && station && <div className={styles.administration}>
          {canEdit && <StationTeam stationId={stationId} owner={owner} />}
          <WizardDisclosure title="Gestão da instalação"><div className={styles.managementLinks}>
            <Link href={`/stations/${stationId}/telemetry`}>Telemetria e histórico</Link>
            {['OWNER', 'MANAGER', 'OPERATOR', 'COLLECTOR'].includes(station.membershipRole) && <Link href={`/stations/${stationId}/rfid`}>RFID e rateio mensal</Link>}
          </div></WizardDisclosure>
        </div>}
      </>}
    </div>
  </AppShell>;
}
