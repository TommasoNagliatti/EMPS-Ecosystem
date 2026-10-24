import type { Charger, ChargerStatus } from './models';

/** A sandbox offer never changes the physical charger status or authorizes a relay. */
export function chargerAvailability(charger: Charger): {canStart:boolean;status:ChargerStatus;message:string} {
  if (charger.sandboxAvailable || charger.sandbox) {
    const sandbox = charger.sandbox;
    const trusted = charger.sandboxAvailable === true && charger.provenance === 'SANDBOX_ESTIMATE' &&
      sandbox?.mode === 'SANDBOX' && sandbox.physicalMeasurement === false;
    const canStart = trusted && sandbox.status === 'AVAILABLE' && sandbox.canStart === true;
    return {canStart,status:canStart ? 'available' : trusted && sandbox.status === 'IN_USE' ? 'in_use' : 'offline',
      message:canStart ? 'SANDBOX disponível · energia estimada, sem medição física.' :
        trusted && sandbox.reason ? sandbox.reason : 'Disponibilidade SANDBOX não confirmada. Escaneie o QR novamente.'};
  }
  return {canStart:charger.status === 'available',status:charger.status,
    message:charger.status === 'available' ? 'Status confirmado agora' : 'Este carregador está indisponível agora. Volte ao eletroposto para escolher outra vaga.'};
}
