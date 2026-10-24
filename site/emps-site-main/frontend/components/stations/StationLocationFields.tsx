'use client';

import { Check, LocateFixed, MapPin, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Draft } from './station-types';
import { hasPosition, positionFromMapsLink, weekdays, type DraftChange } from './station-wizard-model';
import { WizardDisclosure, WizardField } from './StationWizardField';
import { StationLocationMap } from './StationLocationMap';
import { createStationGeolocation, locationFailureMessages } from './station-geolocation';
import styles from './station-wizard.module.css';

export function StationLocationFields({ draft, onChange, issuePath, disabled = false }: {
  draft: Draft; onChange: DraftChange; issuePath?: string; disabled?: boolean;
}) {
  const [mapsLink, setMapsLink] = useState('');
  const [positionError, setPositionError] = useState('');
  const [locating, setLocating] = useState(false);
  const locationRequest = useRef<ReturnType<typeof createStationGeolocation> | null>(null);
  const latestChange = useRef(onChange);
  useEffect(() => { latestChange.current = onChange; }, [onChange]);
  useEffect(() => {
    const request = createStationGeolocation({
      onPosition: position => {
        latestChange.current('latitude', position.latitude);
        latestChange.current('longitude', position.longitude);
      },
      onFailure: failure => setPositionError(failure ? locationFailureMessages[failure] : ''),
      onPending: setLocating,
    });
    locationRequest.current = request;
    return () => { request.dispose(); locationRequest.current = null; };
  }, []);
  useEffect(() => { if (disabled) locationRequest.current?.cancel(); }, [disabled]);
  const positionReady = hasPosition(draft);

  function cancelLocation() { locationRequest.current?.cancel(); setPositionError(''); }
  function changeCoordinate(key: 'latitude' | 'longitude', value: number | string | undefined) {
    cancelLocation();
    onChange(key, value);
  }

  function applyLink() {
    if (!mapsLink.trim()) { setPositionError(''); return; }
    const position = positionFromMapsLink(mapsLink);
    if (!position) { setPositionError('Este link não contém uma posição. Use o link completo do Google Maps ou ajuste as coordenadas.'); return; }
    cancelLocation();
    onChange('latitude', position.latitude);
    onChange('longitude', position.longitude);
    setPositionError('');
  }

  function locate() {
    if (disabled) return;
    locationRequest.current?.locate({ geolocation: navigator.geolocation, secureContext: window.isSecureContext });
  }

  return <div className={styles.locationLayout}><div className={styles.locationFields}>
    <section className={styles.section}>
      <h2>Dados do eletroposto</h2>
      <div className={styles.fields}>
        <WizardField label="Nome da instalação" value={draft.name}
          maxLength={50} onChange={value => onChange('name', value ?? '')} autoComplete="organization" />
        <label className={styles.field}><span>Tipo de local</span><select value={String(draft.venueType)} onChange={event => onChange('venueType', event.target.value)}>
          {Object.entries({ posto: 'Posto', shopping: 'Shopping', condominio: 'Condomínio', empresa: 'Empresa', residencial: 'Residência / pequeno negócio', hotel: 'Hotel', estacionamento: 'Estacionamento', concessionaria: 'Concessionária', outro: 'Outro' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>
    </section>

    <section className={styles.section}>
      <h2>Endereço</h2>
      <div className={styles.addressFields}>
        <WizardField label="CEP" value={draft.postalCode} onChange={value => onChange('postalCode', String(value ?? '').replace(/\D/g, '').slice(0, 8))} inputMode="numeric" autoComplete="postal-code" maxLength={9} />
        <WizardField label="Rua / avenida" value={draft.street} onChange={value => onChange('street', value)} maxLength={80} autoComplete="address-line1" />
        <WizardField label="Número" value={draft.addressNumber} onChange={value => onChange('addressNumber', value)} maxLength={20} />
        <WizardField label="Cidade" value={draft.city} onChange={value => onChange('city', value)} maxLength={80} autoComplete="address-level2" />
        <WizardField label="UF" value={draft.state} onChange={value => onChange('state', String(value ?? '').replace(/[^a-z]/gi, '').toUpperCase().slice(0, 2))} maxLength={2} autoComplete="address-level1" />
      </div>
      <WizardDisclosure title="Complemento e bairro">
        <div className={styles.fields}>
          <WizardField label="Complemento" value={draft.complement} onChange={value => onChange('complement', value)} optional maxLength={80} autoComplete="address-line2" />
          <WizardField label="Bairro" value={draft.neighborhood} onChange={value => onChange('neighborhood', value)} optional maxLength={80} autoComplete="address-level3" />
        </div>
      </WizardDisclosure>
      <div className={styles.positionRow}>
        <span className={styles.positionState}><MapPin size={16} aria-hidden="true" />{positionReady ? 'Posição definida' : 'Posição não definida'}{positionReady && <Check size={15} aria-hidden="true" />}</span>
        <button type="button" className={styles.secondary} onClick={locate} disabled={disabled || locating} aria-busy={locating}><LocateFixed size={16} aria-hidden="true" />{locating ? 'Localizando…' : 'Usar localização atual'}</button>
        {locating && <button type="button" className={styles.secondary} onClick={cancelLocation} disabled={disabled}>Cancelar</button>}
        <span className={styles.srOnly} role="status">{locating ? 'Buscando sua localização' : ''}</span>
        {positionReady && <a className={styles.textLink} target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${draft.latitude},${draft.longitude}`}>Ver no mapa</a>}
      </div>
      {positionError && <p className={styles.inlineError} role="alert">{positionError}</p>}
      <WizardDisclosure title="Posição e região" open={issuePath === 'position'}>
        <WizardField label="Link do Google Maps" value={mapsLink} onChange={value => { cancelLocation(); setMapsLink(String(value ?? '')); }} onBlur={applyLink}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyLink(); } }} type="url" optional />
        <div className={styles.fields}>
          <WizardField label="Latitude" value={draft.latitude} onChange={value => changeCoordinate('latitude', value)} type="number" min={-90} max={90} />
          <WizardField label="Longitude" value={draft.longitude} onChange={value => changeCoordinate('longitude', value)} type="number" min={-180} max={180} />
          <WizardField label="País (código)" value={draft.countryCode} onChange={value => onChange('countryCode', String(value ?? '').toUpperCase())} minLength={2} maxLength={2} />
          <WizardField label="Fuso horário" value={draft.timezone} onChange={value => onChange('timezone', value)} maxLength={50} />
        </div>
      </WizardDisclosure>
    </section>

    <section className={styles.section}>
      <WizardDisclosure title={`Acesso e atendimento · ${draft.visibility === 'PUBLIC' ? 'Pública' : 'Privada'} · ${draft.availability.alwaysOpen ? '24 horas' : 'Horários definidos'}`} open={issuePath === 'availability'}>
      <div className={styles.fields}>
        <label className={styles.field}><span>Visibilidade no aplicativo</span><select value={draft.visibility} onChange={event => onChange('visibility', event.target.value)}><option value="PRIVATE">Privada</option><option value="PUBLIC">Pública após aprovação</option></select></label>
        <label className={styles.check}><input type="checkbox" checked={draft.availability.alwaysOpen} onChange={event => onChange('availability', { ...draft.availability, alwaysOpen: event.target.checked })} />Atendimento 24 horas</label>
      </div>
      {!draft.availability.alwaysOpen && <div className={styles.schedule}>
        {draft.availability.windows.map((window, index) => <div className={styles.scheduleRow} key={index}>
          <label className={styles.field}><span>Dia</span><select value={window.day} onChange={event => onChange('availability', { ...draft.availability, windows: draft.availability.windows.map((row, i) => i === index ? { ...row, day: Number(event.target.value) } : row) })}>{weekdays.map((day, value) => <option key={day} value={value}>{day}</option>)}</select></label>
          {(['start', 'end'] as const).map(key => <label className={styles.field} key={key}><span>{key === 'start' ? 'Abre às' : 'Fecha às'}</span><input type="time" value={window[key]} onChange={event => onChange('availability', { ...draft.availability, windows: draft.availability.windows.map((row, i) => i === index ? { ...row, [key]: event.target.value } : row) })} /></label>)}
          <button type="button" className={styles.iconButton} aria-label={`Remover horário ${index + 1}`} title="Remover horário" onClick={() => onChange('availability', { ...draft.availability, windows: draft.availability.windows.filter((_, i) => i !== index) })}><Trash2 size={16} aria-hidden="true" /></button>
        </div>)}
        <button type="button" className={styles.secondary} disabled={draft.availability.windows.length >= 28} onClick={() => onChange('availability', { ...draft.availability, windows: [...draft.availability.windows, { day: 1, start: '08:00', end: '18:00' }] })}><Plus size={16} aria-hidden="true" />Adicionar horário</button>
      </div>}
      <WizardDisclosure title="Preferências adicionais" open={issuePath === 'availability'}>
        <div className={styles.fields}>
          <WizardField label="Horário exibido ao cliente" value={draft.openingHours} onChange={value => onChange('openingHours', value)} optional maxLength={100} />
          <label className={styles.field}><span>Descrição do local <small>Opcional</small></span><textarea value={String(draft.description ?? '')} onChange={event => onChange('description', event.target.value)} maxLength={500} rows={3} /></label>
        </div>
        <label className={styles.check}><input type="checkbox" checked={!!draft.guestAllowed} onChange={event => onChange('guestAllowed', event.target.checked)} />Permitir recarga como visitante em instalações públicas</label>
      </WizardDisclosure>
      </WizardDisclosure>
    </section>
  </div><StationLocationMap latitude={draft.latitude} longitude={draft.longitude} disabled={disabled} onPosition={position => {
    cancelLocation();
    onChange('latitude', position.latitude);
    onChange('longitude', position.longitude);
    setPositionError('');
  }} /></div>;
}
