import type { AssetRow, Draft } from './station-types';

export type WizardStep = 0 | 1 | 2;
export type WizardIssue = { step: WizardStep; path: string; message: string };
export type DraftChange = (key: string, value: unknown) => void;

export const wizardSteps = ['Localização', 'Equipamentos', 'Finalização'] as const;
export const weekdays = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const connectorOptions = ['TYPE2', 'CCS2', 'CHADEMO', 'TYPE1', 'CCS1', 'GBT'];
export const connectorLabels: Record<string, string> = {
  TYPE2: 'Tipo 2', TYPE1: 'Tipo 1', CCS2: 'CCS 2', CCS1: 'CCS 1', CHAdeMO: 'CHAdeMO', CHAdeMO2: 'CHAdeMO', CHADEMO: 'CHAdeMO', GBT: 'GB/T',
};

export function newSolar(index: number): AssetRow {
  return { name: `Solar ${index}`, status: 'CONFIGURED' };
}

export function newBattery(index: number): AssetRow {
  return { name: `Bateria ${index}`, minSocPercent: 10, maxSocPercent: 95, efficiency: .95, status: 'CONFIGURED' };
}

export function newCharger(index: number, identity: string): AssetRow {
  return { name: `Carregador ${index}`, connectorType: 'TYPE2', administrativeStatus: 'PENDING', ocppIdentity: identity };
}

export function hasPosition(draft: Record<string, unknown>): boolean {
  return typeof draft.latitude === 'number' && Number.isFinite(draft.latitude) && Math.abs(draft.latitude) <= 90
    && typeof draft.longitude === 'number' && Number.isFinite(draft.longitude) && Math.abs(draft.longitude) <= 180;
}

export function positionFromMapsLink(value: string): { latitude: number; longitude: number } | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !/^(www\.)?google\.(com|com\.br)$|^maps\.google\.(com|com\.br)$/.test(url.hostname)) return null;
    const query = url.searchParams.get('query') ?? url.searchParams.get('q');
    const pair = query?.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
      ?? url.pathname.match(/\/\@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|\/|$)/)
      ?? url.pathname.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (!pair) return null;
    const position = { latitude: Number(pair[1]), longitude: Number(pair[2]) };
    return hasPosition(position) ? position : null;
  } catch { return null; }
}

function present(value: unknown): boolean { return value !== undefined && value !== null && value !== ''; }
function inRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

export function validateWizardDraft(draft: Draft, submit = false): WizardIssue | null {
  const issue = (step: WizardStep, path: string, message: string): WizardIssue => ({ step, path, message });
  if (text(draft.name).length > 50) return issue(0, 'name', 'O nome pode ter até 50 caracteres.');
  if (present(draft.postalCode) && !/^\d{8}$/.test(text(draft.postalCode))) return issue(0, 'postalCode', 'Informe um CEP com 8 dígitos.');
  if (present(draft.state) && !/^[A-Z]{2}$/.test(text(draft.state))) return issue(0, 'state', 'Informe a UF com duas letras.');
  if (!/^[A-Z]{2}$/.test(text(draft.countryCode))) return issue(0, 'position', 'Informe o país com duas letras.');
  if (present(draft.latitude) && !inRange(draft.latitude, -90, 90)) return issue(0, 'position', 'A latitude deve estar entre -90 e 90.');
  if (present(draft.longitude) && !inRange(draft.longitude, -180, 180)) return issue(0, 'position', 'A longitude deve estar entre -180 e 180.');
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: String(draft.timezone) }); }
  catch { return issue(0, 'position', 'Selecione um fuso horário válido.'); }
  if (present(draft.powerLimitKw) && !inRange(draft.powerLimitKw, .1, 1_000_000)) return issue(1, 'powerLimitKw', 'Informe uma potência disponível maior que zero.');
  if (!draft.availability.alwaysOpen && !draft.availability.windows.length && submit) return issue(0, 'availability', 'Adicione pelo menos um horário de atendimento.');
  if (draft.availability.windows.length > 28 || draft.availability.windows.some(window => !inRange(window.day, 0, 6) || !Number.isInteger(window.day)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.end))) {
    return issue(0, 'availability', 'Confira os dias e horários de atendimento.');
  }
  for (const [key, rows] of [['solarAssets', draft.solarAssets], ['batteries', draft.batteries], ['chargers', draft.chargers]] as const) {
    if (rows.length > 100) return issue(1, key, 'Cada tipo de equipamento pode ter até 100 registros.');
    for (const [index, row] of rows.entries()) {
      const path = `${key}.${index}`;
      const label = key === 'solarAssets' ? 'conjunto solar' : key === 'batteries' ? 'bateria' : 'carregador';
      if (!text(row.name) || text(row.name).length > 100) return issue(1, path, `Informe um nome para o ${label} ${index + 1}.`);
      if (key === 'solarAssets' && (!inRange(row.installedKwp, .01, 1_000_000)
        || (present(row.acPowerKw) && !inRange(row.acPowerKw, .01, 1_000_000)))) return issue(1, path, `Confira a potência do conjunto solar ${index + 1}.`);
      if (key === 'batteries' && (!inRange(row.capacityKwh, .01, 1_000_000)
        || !inRange(row.maxChargeKw, .01, 1_000_000) || !inRange(row.maxDischargeKw, .01, 1_000_000)
        || !inRange(row.minSocPercent, 0, 100) || !inRange(row.maxSocPercent, 0, 100)
        || Number(row.minSocPercent) >= Number(row.maxSocPercent)
        || !inRange(row.efficiency, .01, 1) || (present(row.socPercent) && !inRange(row.socPercent, 0, 100)))) return issue(1, path, `Confira a capacidade e os limites da bateria ${index + 1}.`);
      if (key === 'chargers' && (!inRange(row.powerKw, .1, 2_000) || !text(row.connectorType)
        || !text(row.ocppIdentity) || (present(row.pricePerKwh) && !inRange(row.pricePerKwh, .01, 10_000)))) return issue(1, path, `Confira potência, conector, identificação e tarifa do carregador ${index + 1}.`);
    }
  }
  if (submit) {
    if (!text(draft.name) || !text(draft.street) || !text(draft.city) || !text(draft.state) || !text(draft.postalCode)) return issue(0, 'address', 'Preencha o nome, CEP, rua, cidade e estado antes de enviar.');
    if (!hasPosition(draft)) return issue(0, 'position', 'Defina a posição do eletroposto antes de enviar para análise.');
    if (!inRange(draft.powerLimitKw, .1, 1_000_000)) return issue(1, 'powerLimitKw', 'Informe a potência disponível do eletroposto.');
    if (!draft.chargers.some(charger => charger.administrativeStatus !== 'DISABLED')) return issue(1, 'chargers', 'Adicione pelo menos um carregador antes de enviar.');
  }
  return null;
}

export function wizardPayload(draft: Draft, baseline: Draft | null, active: boolean): Partial<Draft> {
  if (!active || !baseline) return draft;
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(baseline[key])));
}

export function photoIssue(file: Pick<File, 'type' | 'size'>): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Selecione uma foto JPEG, PNG ou WebP.';
  if (file.size > 8 * 1024 * 1024) return 'Cada foto pode ter até 8 MB.';
  return null;
}
