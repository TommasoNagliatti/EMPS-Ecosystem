import { chargers } from '@/data/mock-data';

const ALLOWED_HOSTS = new Set(['app.emps.com.br', 'emps.com.br', 'www.emps.com.br']);

export type QrResolution =
  | { ok: true; chargerId: string }
  | { ok: false; message: string };

export type QrTokenResolution =
  | { ok: true; publicToken: string }
  | { ok: false; message: string };

const INVALID_MESSAGE = 'Código inválido, expirado ou ainda não cadastrado. Confira o adesivo da vaga.';

export function parseEmpsQrPublicToken(rawValue: string): QrTokenResolution {
  const value = rawValue.trim();

  if (!value) return { ok: false, message: 'Digite ou escaneie um código EMPS.' };

  try {
    const url = new URL(value);
    if (url.protocol.startsWith('exp')) {
      return {
        ok: false,
        message:
          'Esse é o QR do Expo, usado apenas para abrir o aplicativo. Escaneie o QR EMPS da vaga.',
      };
    }

    const isEmpsScheme = url.protocol === 'emps:';
    const isTrustedWebLink = url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname);
    if (!isEmpsScheme && !isTrustedWebLink) {
      return { ok: false, message: 'Este QR code não pertence à rede EMPS.' };
    }

    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const publicToken =
      url.searchParams.get('token') ??
      url.searchParams.get('charger') ??
      segments.at(-1) ??
      (isEmpsScheme ? url.hostname : '');

    return publicToken ? { ok: true, publicToken } : { ok: false, message: INVALID_MESSAGE };
  } catch {
    if (/^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(value)) {
      return { ok: true, publicToken: value };
    }
    return { ok: false, message: INVALID_MESSAGE };
  }
}

export function resolveEmpsQr(rawValue: string): QrResolution {
  const parsed = parseEmpsQrPublicToken(rawValue);
  if (!parsed.ok) return parsed;

  const candidate = parsed.publicToken.toLowerCase();
  const charger = chargers.find(
    (item) =>
      item.id.toLowerCase() === candidate ||
      item.publicCode.toLowerCase() === candidate ||
      item.qrToken.toLowerCase() === candidate,
  );

  return charger ? { ok: true, chargerId: charger.id } : { ok: false, message: INVALID_MESSAGE };
}
