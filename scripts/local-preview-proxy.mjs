import { createServer, connect, isIP } from 'node:net';

// A temporary local preview transport. Authentication and all application safety
// checks stay in the loopback Backend. No database or device port is forwarded.
const bindIp = process.env.EMPS_PREVIEW_BIND_IP;
const octets = (bindIp ?? '').split('.').map(Number);
if (isIP(bindIp ?? '') !== 4 || !(octets[0] === 10 ||
    octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 ||
    octets[0] === 192 && octets[1] === 168)) {
  throw new Error('Preview requires one specific private LAN IPv4 address.');
}
const servers = [];
const sockets = new Set();
function close() {
  for (const server of servers) server.close();
  for (const socket of sockets) socket.destroy();
}
for (const port of [3010, 3011]) {
  const server = createServer(client => {
    const upstream = connect({ host: '127.0.0.1', port });
    sockets.add(client); sockets.add(upstream);
    const dispose = () => {
      sockets.delete(client); sockets.delete(upstream);
      client.destroy(); upstream.destroy();
    };
    client.setTimeout(120_000, dispose);
    upstream.setTimeout(120_000, dispose);
    client.on('error', dispose); upstream.on('error', dispose);
    client.on('close', dispose); upstream.on('close', dispose);
    client.pipe(upstream); upstream.pipe(client);
  });
  server.on('error', error => { console.error(error.message); close(); process.exitCode = 1; });
  server.listen(port, bindIp);
  servers.push(server);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
