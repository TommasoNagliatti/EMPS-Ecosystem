import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

type Environment = NodeJS.ProcessEnv;
const safetyFlags = ['EMPS_BACKGROUND_JOBS_ENABLED', 'EMPS_PHYSICAL_COMMANDS_ENABLED', 'EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED'] as const;

export function remoteDevelopment(env: Environment = process.env) {
  const value = env.EMPS_REMOTE_DEVELOPMENT;
  if (value === undefined || value === 'false') return false;
  if (value !== 'true') throw new Error('EMPS_REMOTE_DEVELOPMENT must be true or false');
  return true;
}

export function assertRemoteConfiguration(env: Environment = process.env) {
  if (!remoteDevelopment(env)) return;
  if (env.NODE_ENV !== 'development' || env.EMPS_REMOTE_ACCESS_MODE !== 'READ_ONLY')
    throw new Error('Remote development requires NODE_ENV=development and READ_ONLY access');
  for (const flag of safetyFlags) if (env[flag] !== 'false') throw new Error(`${flag} must explicitly be false`);
  if (env.HOST !== '127.0.0.1') throw new Error('Remote backend must bind to 127.0.0.1');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || /GENERATE|REPLACE/i.test(env.JWT_SECRET))
    throw new Error('Configure a private local JWT_SECRET of at least 32 characters, distinct from production');
  if (!env.EMPS_REMOTE_ALLOWED_EMAILS?.split(',').some(value => value.trim()))
    throw new Error('Configure explicitly authorized test accounts');
  if (!env.EMPS_REMOTE_ENVIRONMENT || !/^[a-zA-Z0-9_-]{1,60}$/.test(env.EMPS_REMOTE_ENVIRONMENT))
    throw new Error('Configure EMPS_REMOTE_ENVIRONMENT');
  if (!env.EMPS_REMOTE_EXPECTED_DATABASE || !/^[a-zA-Z0-9_]+$/.test(env.EMPS_REMOTE_EXPECTED_DATABASE))
    throw new Error('Pin the database name confirmed through SSH');
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.EMPS_REMOTE_EXPECTED_SERVER_UUID ?? ''))
    throw new Error('Pin the MySQL server UUID confirmed through SSH');
  let url: URL;
  try { url = new URL(env.DATABASE_URL ?? ''); } catch { throw new Error('Invalid private DATABASE_URL'); }
  const username = decodeURIComponent(url.username);
  if (url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' || !url.password ||
      !url.port || Number(url.port) < 1024 || Number(url.port) > 65535 ||
      url.port !== env.EMPS_REMOTE_TUNNEL_PORT ||
      decodeURIComponent(url.pathname.slice(1)) !== env.EMPS_REMOTE_EXPECTED_DATABASE ||
      !username || username.toLowerCase() === 'root')
    throw new Error('DATABASE_URL must match the loopback tunnel and the pinned database, using a non-root account');
  if (env.PAYMENT_PROVIDER !== 'sandbox' || env.STRIPE_SECRET_KEY || env.STRIPE_WEBHOOK_SECRET ||
      env.OCPP_GATEWAY_URL || env.OCPP_GATEWAY_TOKEN || env.GIE_SERVICE_URL || env.GIE_SERVICE_TOKEN)
    throw new Error('Remote read-only mode must not receive payment, OCPP or GIE integration credentials');
  const allowedOrigins = new Set([`http://localhost:${env.EMPS_REMOTE_SITE_PORT}`, `http://127.0.0.1:${env.EMPS_REMOTE_SITE_PORT}`]);
  if (!env.CORS_ORIGINS || env.CORS_ORIGINS.split(',').some(origin => !allowedOrigins.has(origin.trim())))
    throw new Error('Remote CORS must contain only the configured local site origins');
}

export function backgroundJobsEnabled() {
  return !remoteDevelopment() && process.env.EMPS_BACKGROUND_JOBS_ENABLED !== 'false';
}

export function assertPhysicalCommandsEnabled() {
  if (remoteDevelopment() || process.env.EMPS_PHYSICAL_COMMANDS_ENABLED === 'false')
    throw new ForbiddenException('Physical commands are disabled in this environment');
}

export function assertExternalSideEffectsEnabled() {
  if (remoteDevelopment() || process.env.EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED === 'false')
    throw new ForbiddenException('External side effects are disabled in this environment');
}

export function assertRemoteAccount(email: string) {
  if (!remoteDevelopment()) return;
  const allowed = process.env.EMPS_REMOTE_ALLOWED_EMAILS?.split(',').map(value => value.trim().toLowerCase()) ?? [];
  if (!allowed.includes(email.trim().toLowerCase())) throw new ForbiddenException('Account not authorized for remote development');
}

export function assertRemoteHttpRequest(method: string, path: string) {
  if (!remoteDevelopment()) return;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return;
  if (method === 'POST' && /^\/auth\/(login|refresh|logout)\/?$/.test(path)) return;
  throw new ForbiddenException('Remote development is read-only; operational changes and webhooks are blocked');
}

@Injectable()
export class RemoteDevelopmentGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<{method: string; path: string}>();
    assertRemoteHttpRequest(request.method, request.path);
    return true;
  }
}

// Query-level protection also covers calls outside HTTP and interactive transactions.
export function protectRemoteClient<T extends object>(client: T): T {
  const reads = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);
  const cache = new Map<PropertyKey, unknown>();
  return new Proxy(client, {
    get(target, key) {
      const value: any = Reflect.get(target, key);
      if (key === '$transaction') return (input: unknown, ...options: unknown[]) =>
        value.call(target, typeof input === 'function' ? (tx: object) => input(protectRemoteClient(tx)) : input, ...options);
      if (key === '$queryRaw') return (sql: {strings?: readonly string[]} | readonly string[], ...parameters: unknown[]) => {
        const strings = Array.isArray(sql) ? sql : (sql as {strings?: readonly string[]}).strings;
        if (!strings || strings.length !== 1 || strings[0].trim() !== 'SELECT 1' || parameters.length)
          throw new ForbiddenException('Raw queries are restricted to the health check in remote mode');
        return value.call(target, sql, ...parameters);
      };
      if (typeof key === 'string' && ['$executeRaw', '$executeRawUnsafe', '$queryRawUnsafe', '$queryRawTyped', '$extends'].includes(key))
        return () => { throw new ForbiddenException('Raw writes and unreviewed extensions are blocked'); };
      if (value && typeof value === 'object' && typeof value.findMany === 'function') {
        if (!cache.has(key)) cache.set(key, new Proxy(value, {
          get(delegate, operation) {
            const method = Reflect.get(delegate, operation);
            if (typeof method !== 'function') return method;
            if (!reads.has(String(operation))) return () => { throw new ForbiddenException('Database writes are blocked in remote mode'); };
            return method.bind(delegate);
          },
        }));
        return cache.get(key);
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export async function verifyRemoteDatabase(db: {
  $queryRaw: (strings: TemplateStringsArray) => Promise<Array<Record<string, unknown>>>;
  $queryRawUnsafe: (sql: string) => Promise<Array<Record<string, unknown>>>;
}, env: Environment = process.env) {
  assertRemoteConfiguration(env);
  const [identity] = await db.$queryRaw`SELECT DATABASE() AS databaseName, @@server_uuid AS serverUuid, VERSION() AS version`;
  if (!identity || identity.databaseName !== env.EMPS_REMOTE_EXPECTED_DATABASE ||
      String(identity.serverUuid).toLowerCase() !== env.EMPS_REMOTE_EXPECTED_SERVER_UUID?.toLowerCase() ||
      !String(identity.version).startsWith('8.')) throw new Error('MySQL identity does not match the SSH-verified target');
  const grants = await db.$queryRawUnsafe('SHOW GRANTS');
  const scope = `\`${env.EMPS_REMOTE_EXPECTED_DATABASE}\`.*`;
  let selected = false;
  for (const row of grants) {
    const grant = String(Object.values(row)[0]);
    if (/^GRANT USAGE ON \*\.\* TO /.test(grant) && !/WITH GRANT OPTION/.test(grant)) continue;
    if (grant.startsWith(`GRANT SELECT ON ${scope} TO `) && !/WITH GRANT OPTION/.test(grant)) { selected = true; continue; }
    throw new Error('Remote MySQL account must have only SELECT on the pinned database, without roles or GRANT OPTION');
  }
  if (!selected) throw new Error('No explicit read-only grant for the pinned database');
  return {database: String(identity.databaseName), version: String(identity.version), serverIdentityMatched: true, readOnlyGrants: true};
}
