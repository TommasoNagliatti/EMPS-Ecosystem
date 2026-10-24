'use client';

import { BatteryCharging, ChevronDown, PlugZap, Plus, Sun, Trash2 } from 'lucide-react';
import type { AssetRow, Draft } from './station-types';
import { connectorLabels, connectorOptions, newBattery, newCharger, newSolar, type DraftChange } from './station-wizard-model';
import { WizardDisclosure, WizardField } from './StationWizardField';
import styles from './station-wizard.module.css';

type AssetKey = 'batteries' | 'solarAssets' | 'chargers';
type FieldDefinition = [key: string, label: string, type?: string, suffix?: string];

export function StationEquipmentFields({ draft, onChange, issuePath }: {
  draft: Draft; onChange: DraftChange; issuePath?: string;
}) {
  function change(key: AssetKey, index: number, field: string, value: unknown) {
    onChange(key, draft[key].map((row, i) => i === index ? { ...row, [field]: value } : row));
  }
  function fields(key: AssetKey, index: number, definitions: FieldDefinition[], optional = false) {
    return <div className={styles.fields}>{definitions.map(([field, label, type = 'text', suffix]) => <WizardField key={field} label={label} type={type} suffix={suffix}
      value={draft[key][index][field]} onChange={value => change(key, index, field, value)} optional={optional} maxLength={type === 'text' ? (field === 'integrationRef' ? 150 : field === 'firmwareVersion' ? 50 : 100) : undefined} />)}</div>;
  }
  function remove(key: AssetKey, index: number) { onChange(key, draft[key].filter((_, i) => i !== index)); }
  function add(key: AssetKey, row: AssetRow) { onChange(key, [...draft[key], row]); }
  function assetState(key: 'batteries' | 'solarAssets', index: number) {
    return <label className={styles.field}><span>Estado do equipamento</span><select value={draft[key][index].status ?? 'CONFIGURED'} onChange={event => change(key, index, 'status', event.target.value)}>
      {Object.entries({ CONFIGURED: 'Configurado', ACTIVE: 'Ativo', INACTIVE: 'Inativo', FAULTED: 'Com falha' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>;
  }

  return <>
    <section className={styles.section}>
      <div className={styles.sectionHeading}><h2>Carregadores <span className={styles.count}>{draft.chargers.length}</span></h2>
        <button type="button" className={styles.secondary} disabled={draft.chargers.length >= 100} onClick={() => add('chargers', newCharger(draft.chargers.length + 1, `EMPS-${crypto.randomUUID()}`))}><Plus size={16} aria-hidden="true" />Adicionar carregador</button>
      </div>
      {!draft.chargers.length && <div className={styles.emptyEquipment}><PlugZap size={28} aria-hidden="true" /><span>Nenhum carregador cadastrado</span></div>}
      {draft.chargers.map((charger, index) => <details className={styles.equipment} key={String(charger.id ?? index)} open={index === draft.chargers.length - 1 || issuePath === `chargers.${index}` || undefined}>
        <summary><PlugZap size={18} aria-hidden="true" /><span>{charger.name || `Carregador ${index + 1}`}</span><small>{charger.powerKw ? `${charger.powerKw} kW` : 'Potência não informada'}</small><ChevronDown size={16} aria-hidden="true" /></summary>
        <div className={styles.equipmentBody}>
          {fields('chargers', index, [['name', 'Nome do carregador'], ['powerKw', 'Potência máxima', 'number', 'kW']])}
          <div className={styles.fields}>
            <label className={styles.field}><span>Conector</span><select value={String(charger.connectorType)} onChange={event => change('chargers', index, 'connectorType', event.target.value)}>
              {!connectorOptions.includes(String(charger.connectorType)) && <option value={String(charger.connectorType)}>{charger.connectorType}</option>}
              {connectorOptions.map(connector => <option key={connector} value={connector}>{connectorLabels[connector]}</option>)}
            </select></label>
            <WizardField label="Preço da recarga" type="number" suffix="R$/kWh" optional min={.01} max={10_000} step="0.0001" value={charger.pricePerKwh} onChange={value => change('chargers', index, 'pricePerKwh', value)} />
          </div>
          <WizardDisclosure title="Identificação e integração" open={issuePath === `chargers.${index}`}>
            {fields('chargers', index, [['manufacturer', 'Fabricante'], ['model', 'Modelo'], ['serialNumber', 'Número de série'], ['firmwareVersion', 'Firmware']], true)}
            {fields('chargers', index, [['ocppIdentity', 'Identificação OCPP']])}
            <label className={styles.field}><span>Estado administrativo</span><select value={charger.administrativeStatus ?? 'PENDING'} onChange={event => change('chargers', index, 'administrativeStatus', event.target.value)}>{Object.entries({ PENDING: 'Pendente de ativação', ENABLED: 'Habilitado', MAINTENANCE: 'Manutenção', DISABLED: 'Desabilitado' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </WizardDisclosure>
          <button type="button" className={styles.removeButton} onClick={() => remove('chargers', index)}><Trash2 size={15} aria-hidden="true" />Retirar carregador</button>
        </div>
      </details>)}
    </section>

    <section className={styles.section}>
      <h2>Energia disponível</h2>
      <div className={styles.narrowField}><WizardField label="Potência disponível do eletroposto" value={draft.powerLimitKw} onChange={value => onChange('powerLimitKw', value)} type="number" min={.1} max={1_000_000} suffix="kW" /></div>
      <WizardDisclosure title="Energia solar e baterias" open={!!issuePath?.match(/^(solarAssets|batteries)/)}>
        <div className={styles.energyChoices}>
          <label className={styles.check}><input type="checkbox" checked={draft.solarAssets.length > 0} onChange={event => onChange('solarAssets', event.target.checked ? [newSolar(1)] : [])} /><Sun size={17} aria-hidden="true" />Energia solar</label>
          <label className={styles.check}><input type="checkbox" checked={draft.batteries.length > 0} onChange={event => onChange('batteries', event.target.checked ? [newBattery(1)] : [])} /><BatteryCharging size={17} aria-hidden="true" />Baterias</label>
        </div>
        {draft.solarAssets.map((asset, index) => <div className={styles.asset} key={String(asset.id ?? index)}>
          <div className={styles.sectionHeading}><h3>{asset.name || `Solar ${index + 1}`}</h3><button type="button" className={styles.iconButton} aria-label={`Retirar conjunto solar ${index + 1}`} title="Retirar conjunto solar" onClick={() => remove('solarAssets', index)}><Trash2 size={16} aria-hidden="true" /></button></div>
          {fields('solarAssets', index, [['name', 'Nome'], ['installedKwp', 'Potência instalada', 'number', 'kWp']])}
          <WizardDisclosure title="Dados técnicos do conjunto solar" open={issuePath === `solarAssets.${index}`}>
            {fields('solarAssets', index, [['acPowerKw', 'Potência do inversor', 'number', 'kW'], ['inverter', 'Inversor'], ['manufacturer', 'Fabricante'], ['model', 'Modelo'], ['integrationRef', 'Referência de integração']], true)}
            {assetState('solarAssets', index)}
          </WizardDisclosure>
        </div>)}
        {draft.solarAssets.length > 0 && <button type="button" className={styles.secondary} disabled={draft.solarAssets.length >= 100} onClick={() => add('solarAssets', newSolar(draft.solarAssets.length + 1))}><Plus size={16} aria-hidden="true" />Adicionar conjunto solar</button>}
        {draft.batteries.map((asset, index) => <div className={styles.asset} key={String(asset.id ?? index)}>
          <div className={styles.sectionHeading}><h3>{asset.name || `Bateria ${index + 1}`}</h3><button type="button" className={styles.iconButton} aria-label={`Retirar bateria ${index + 1}`} title="Retirar bateria" onClick={() => remove('batteries', index)}><Trash2 size={16} aria-hidden="true" /></button></div>
          {fields('batteries', index, [['name', 'Nome'], ['capacityKwh', 'Capacidade de armazenamento', 'number', 'kWh']])}
          <WizardDisclosure title="Limites e dados técnicos da bateria" open={issuePath === `batteries.${index}`}>
            {fields('batteries', index, [['maxChargeKw', 'Potência máxima de carga', 'number', 'kW'], ['maxDischargeKw', 'Potência máxima de descarga', 'number', 'kW'], ['minSocPercent', 'Nível mínimo', 'number', '%'], ['maxSocPercent', 'Nível máximo', 'number', '%'], ['efficiency', 'Eficiência (0 a 1)', 'number']])}
            {fields('batteries', index, [['socPercent', 'Nível informado', 'number', '%'], ['manufacturer', 'Fabricante'], ['model', 'Modelo'], ['integrationRef', 'Referência de integração']], true)}
            {assetState('batteries', index)}
          </WizardDisclosure>
        </div>)}
        {draft.batteries.length > 0 && <button type="button" className={styles.secondary} disabled={draft.batteries.length >= 100} onClick={() => add('batteries', newBattery(draft.batteries.length + 1))}><Plus size={16} aria-hidden="true" />Adicionar bateria</button>}
      </WizardDisclosure>
    </section>
  </>;
}
