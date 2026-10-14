import { hasPosition } from './station-wizard-model';

export type LocationFailure = 'permission-denied' | 'unavailable' | 'timeout' | 'unsupported' | 'insecure';

export const locationFailureMessages: Record<LocationFailure, string> = {
  'permission-denied': 'A localização está bloqueada. Permita o acesso nas configurações do navegador e confira a localização do sistema, ou escolha o ponto no mapa.',
  unavailable: 'O navegador não conseguiu determinar sua localização. Confira a localização do sistema ou tente abrir esta página no Chrome. Você também pode escolher o ponto no mapa.',
  timeout: 'A busca por localização demorou demais. Tente novamente ou escolha o ponto no mapa.',
  unsupported: 'Este navegador não oferece localização. Abra esta página no Chrome ou escolha o ponto no mapa.',
  insecure: 'A localização exige HTTPS ou localhost. Abra o site por um endereço seguro ou escolha o ponto no mapa.',
};

export function createStationGeolocation({ onPosition, onFailure, onPending }: {
  onPosition: (position: { latitude: number; longitude: number }) => void;
  onFailure: (failure: LocationFailure | null) => void;
  onPending: (pending: boolean) => void;
}) {
  let generation = 0;
  let pending = false;
  let disposed = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  function cancel() {
    generation += 1;
    clearTimeout(deadline);
    deadline = undefined;
    if (pending) { pending = false; if (!disposed) onPending(false); }
  }

  function locate({ geolocation, secureContext }: {
    geolocation?: Pick<Geolocation, 'getCurrentPosition'>;
    secureContext: boolean;
  }) {
    if (disposed || pending) return;
    onFailure(null);
    if (!secureContext) { onFailure('insecure'); return; }
    if (!geolocation) { onFailure('unsupported'); return; }
    const request = ++generation;
    pending = true;
    onPending(true);

    function finish(action: () => void) {
      if (disposed || !pending || request !== generation) return;
      clearTimeout(deadline);
      deadline = undefined;
      pending = false;
      onPending(false);
      action();
    }

    // The browser timeout can exclude permission prompts; also bound the UI wait.
    deadline = setTimeout(() => finish(() => onFailure('timeout')), 30_000);
    try {
      geolocation.getCurrentPosition(position => {
        const point = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        finish(() => { if (hasPosition(point)) onPosition(point); else onFailure('unavailable'); });
      }, error => {
        finish(() => onFailure(error.code === 1 ? 'permission-denied' : error.code === 3 ? 'timeout' : 'unavailable'));
      }, { enableHighAccuracy: false, timeout: 20_000, maximumAge: 60_000 });
    } catch (error) {
      const denied = error instanceof Error && (error.name === 'SecurityError' || error.name === 'NotAllowedError');
      finish(() => onFailure(denied ? 'permission-denied' : 'unavailable'));
    }
  }

  return { locate, cancel, dispose() { disposed = true; cancel(); } };
}
