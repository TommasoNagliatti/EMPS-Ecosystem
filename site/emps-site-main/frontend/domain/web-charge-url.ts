function cleanOrigin(value: string | null | undefined) {
  const candidate = value?.trim().replace(/\/$/, '');
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : '';
  } catch {
    return '';
  }
}

const configuredWebChargeOrigin = cleanOrigin(process.env.NEXT_PUBLIC_WEB_CHARGE_ORIGIN);

export function webChargeUrl(publicToken: string, browserOrigin?: string) {
  const origin = configuredWebChargeOrigin || cleanOrigin(browserOrigin);
  const path = `/charge/${encodeURIComponent(publicToken)}`;
  return origin ? `${origin}${path}` : path;
}
