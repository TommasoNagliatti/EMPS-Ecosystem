/** The optional uplink requires an explicit preview or official HTTPS target.
 * The ESP32 LAN credential never leaves the computer; HTTPS uses a separate key.
 * No redirects, arbitrary origins or automatic local/remote failover are allowed.
 */
export function maqueteUpstream({ backendPort = 3011, backendUrl, upstreamToken, token, remotePreview = false, remoteOfficial = false }) {
  if (!backendUrl) {
    if (remotePreview || remoteOfficial || upstreamToken) throw Error('Incomplete remote configuration');
    return { base: `http://127.0.0.1:${backendPort}`, token, remote: false };
  }
  let url;
  try { url = new URL(backendUrl); } catch { throw Error('Invalid approved API URL'); }
  const official = remoteOfficial && !remotePreview && url.hostname === 'api.emps-charge.tech' && url.pathname === '/';
  const preview = remotePreview && !remoteOfficial && url.hostname === 'preview.emps-charge.tech' && url.pathname.replace(/\/$/, '') === '/api';
  if ((!official && !preview) || url.protocol !== 'https:' ||
      url.port || url.username || url.password || url.search || url.hash ||
      typeof upstreamToken !== 'string' || upstreamToken.length < 32 || upstreamToken === token)
    throw Error('Explicit approved HTTPS target and a distinct upstream credential are required');
  return { base: `${url.origin}${preview ? '/api' : ''}`, token: upstreamToken, remote: true };
}
