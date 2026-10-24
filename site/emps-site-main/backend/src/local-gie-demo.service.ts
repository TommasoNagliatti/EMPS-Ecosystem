import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthRequest } from './auth';
import type { GieEnvelope } from './gie.service';
import { intId, stationScope } from './persistence';
import { PrismaService } from './prisma.service';
import { assertRemoteConfiguration, remoteDevelopment } from './remote-development';

export const LOCAL_GIE_SOURCE = 'LOCAL_ISOLATED_GIE_DEMO';

export function localGieDemoConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.EMPS_LOCAL_GIE_DEMO;
  if (enabled === undefined || enabled === 'false') return null;
  if (enabled !== 'true' || !remoteDevelopment(env)) throw new Error('Local GIE demo requires explicit remote read-only mode');
  assertRemoteConfiguration(env);
  const station = env.EMPS_LOCAL_GIE_STATION_ID ?? '';
  const port = env.EMPS_LOCAL_GIE_PORT ?? '';
  const token = env.EMPS_LOCAL_GIE_TOKEN ?? '';
  if (!/^[1-9]\d*$/.test(station) || !Number.isSafeInteger(Number(station))) throw new Error('Configure a positive local demo station ID');
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535 ||
      [env.PORT, env.EMPS_REMOTE_SITE_PORT, env.EMPS_REMOTE_TUNNEL_PORT].some(value => Number(value) === Number(port)))
    throw new Error('Configure a distinct unprivileged local GIE port');
  if (!/^[a-zA-Z0-9_-]{32,128}$/.test(token) || token === env.JWT_SECRET) throw new Error('Configure a separate private local GIE demo token');
  return { stationId: Number(station), port: Number(port), token };
}

@Injectable()
export class LocalGieDemoService {
  private readonly config = localGieDemoConfiguration();
  private pending?: Promise<GieEnvelope>;
  constructor(private readonly db: PrismaService) {}

  matches(stationId: string) { return !!this.config && stationId === String(this.config.stationId); }

  async read(user: AuthRequest['user'], stationId: string): Promise<GieEnvelope> {
    if (!this.matches(stationId) || !await this.db.station.findFirst({
      where: { AND: [{ id: intId(stationId) }, stationScope(user)] }, select: { id: true },
    })) throw new NotFoundException('Teste GIE não disponível para esta instalação');
    if (!this.pending) this.pending = this.collect().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async collect(): Promise<GieEnvelope> {
    const config = this.config!;
    try {
      // This path only reads an isolated loopback replay; it never calls GieService.collect/sample.
      const response = await fetch(`http://127.0.0.1:${config.port}/state`, {
        headers: { Authorization: `Bearer ${config.token}` }, redirect: 'error', signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new Error('Local demo unavailable');
      const data = await response.json();
      const age = Date.now() - Date.parse(data.observed_at);
      if (data.source !== LOCAL_GIE_SOURCE || data.isolated !== true || data.hardware_confirmed !== false ||
          String(data.station_id) !== String(config.stationId) || data.mode !== 'PRESENTATION' ||
          !Number.isFinite(age) || age < -5000 || age > 15000 || typeof data.state?.execution_allowed !== 'boolean')
        throw new Error('Invalid local demo envelope');
      return { ...data, online: true };
    } catch {
      return { station_id: String(config.stationId), online: false, mode: 'PRESENTATION', isolated: true,
        source: LOCAL_GIE_SOURCE, hardware_confirmed: false, observed_at: new Date().toISOString(), state: null,
        error: 'Serviço de teste GIE local indisponível; dados oficiais não foram substituídos' };
    }
  }
}
