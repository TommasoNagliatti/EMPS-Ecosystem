export type LabEvseId = 'EV1' | 'EV2';
export type LabCommandStatus = 'PENDING' | 'DELIVERED' | 'ACKED' | 'EXPIRED' | 'FAILED';

export type LabEvse = {
  state: 'OFFLINE' | 'AVAILABLE' | 'CHARGING' | 'PENDING' | 'FAULT';
  relayActive: boolean;
  pendingCommandId: string | null;
  lastCommandId?: string | null;
  lastCommandStatus?: LabCommandStatus | null;
  lastAckAt: string | null;
};

export type LabDeviceStatus = {
  available: boolean;
  bound: boolean;
  stationId: number;
  deviceId: string | null;
  connectionSource: 'SIMULATOR' | 'FIRMWARE' | 'UNKNOWN';
  connected: boolean;
  lastHeartbeatAt: string | null;
  evses: Record<LabEvseId, LabEvse>;
  gie: {
    valid: boolean;
    scenarioAt: string | null;
    gridKw: number | null;
    solarKw: number | null;
    bat01Soc: number | null;
    bat02Soc: number | null;
  };
  error?: string;
};

export type LabCommand = {
  id: string;
  evse: LabEvseId;
  enabled: boolean;
  status: LabCommandStatus;
  expiresAt: string;
};

export type LabCommandResponse = LabDeviceStatus & { command: LabCommand };

export function labEvsePresentation(device: LabDeviceStatus, id: LabEvseId, fresh: boolean) {
  const evse = device.evses[id];
  if (!device.available || !device.bound || !device.connected || !fresh || !evse || evse.state === 'OFFLINE') {
    return { label: 'Sem conexão com ESP32', canStart: false, canStop: true, relay: 'Estado físico desconhecido · parada permitida' };
  }
  if (evse.state === 'FAULT') return { label: 'Falha reportada pelo ESP32', canStart: false, canStop: true, relay: 'Parada de segurança permitida' };
  if (evse.state === 'PENDING' || evse.pendingCommandId) return { label: 'Aguardando confirmação do ESP32', canStart: false, canStop: true, relay: 'Parada de segurança permitida' };
  if (evse.state === 'CHARGING' && evse.relayActive) return { label: 'Recarga USB de teste autorizada', canStart: false, canStop: true, relay: 'Relé ativo · nível baixo' };
  if (evse.state === 'AVAILABLE' && !evse.relayActive) return { label: 'Disponível para teste', canStart: true, canStop: false, relay: 'Relé desligado · nível alto' };
  return { label: 'Estado divergente · verificar ESP32', canStart: false, canStop: true, relay: 'Parada de segurança permitida' };
}

export function labCommandFeedback(device: LabDeviceStatus, command: LabCommand, fresh: boolean) {
  const evse = device.evses[command.evse];
  const source = device.connectionSource === 'SIMULATOR' ? 'simulador local (sem GPIO)'
    : device.connectionSource === 'FIRMWARE' ? 'firmware ESP32 (nível lógico do GPIO)'
    : 'cliente conectado';
  if (!device.connected || !fresh) return command.enabled
    ? 'Sem conexão; comando ainda não confirmado pelo ESP32.'
    : 'Parada solicitada ao Backend; autorização revogada. Aguardando confirmação do ESP32.';
  if (evse?.lastCommandId !== command.id) return Date.parse(command.expiresAt) <= Date.now()
    ? 'Comando expirado sem confirmação do ESP32.' : 'Aguardando confirmação deste comando pelo ESP32.';
  if (evse.lastCommandStatus === 'EXPIRED') return 'Comando expirado sem confirmação do ESP32.';
  if (evse.lastCommandStatus === 'FAILED') return 'O cliente da maquete reportou falha neste comando.';
  if (evse.lastCommandStatus === 'ACKED') {
    const expected = command.enabled ? evse.state === 'CHARGING' && evse.relayActive : evse.state === 'AVAILABLE' && !evse.relayActive;
    return expected ? `Comando ${command.evse}=${command.enabled ? '1' : '0'} confirmado pelo ${source}.` : 'ACK recebido, mas o estado do relé não corresponde ao comando.';
  }
  if (Date.parse(command.expiresAt) <= Date.now()) return 'Comando expirado sem confirmação do ESP32.';
  return 'Comando enviado à fila; aguardando ACK do ESP32.';
}

export function labCommandAwaiting(device: LabDeviceStatus, command: LabCommand | null, id: LabEvseId, now: number) {
  if (!command || command.evse !== id || Date.parse(command.expiresAt) <= now) return false;
  const evse = device.evses[id];
  if (evse?.lastCommandId !== command.id) return true;
  return evse.lastCommandStatus !== 'ACKED' && evse.lastCommandStatus !== 'FAILED' && evse.lastCommandStatus !== 'EXPIRED';
}
