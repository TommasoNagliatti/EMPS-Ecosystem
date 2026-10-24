/** The optional uplink is scoped to the explicitly approved isolated preview.
 * The ESP32 LAN credential never leaves the computer; HTTPS uses a separate key.
 * No redirects, arbitrary origins or automatic local/remote failover are allowed.
 */
export function maqueteUpstream({ backendPort = 3011, backendUrl, upstreamToken, token, remotePreview = false }) {
  if (!backendUrl) {
    if (remotePreview || upstreamToken) throw Error('Incomplete remote preview configuration');
    return { base: `http://127.0.0.1:${backendPort}`, token, remote: false };
  }
  let url;
  try { url = new URL(backendUrl); } catch { throw Error('Invalid preview API URL'); }
  if (!remotePreview || url.protocol !== 'https:' || url.hostname !== 'preview.emps-charge.tech' ||
      url.port || url.username || url.password || url.search || url.hash ||
      url.pathname.replace(/\/$/, '') !== '/api' ||
      typeof upstreamToken !== 'string' || upstreamToken.length < 32 || upstreamToken === token)
    throw Error('Approved HTTPS preview and a distinct upstream credential are required');
  return { base: `${url.origin}/api`, token: upstreamToken, remote: true };
}
