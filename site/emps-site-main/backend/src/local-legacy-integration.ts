/** Explicit, disposable clone of the audited local emps_db. Never match the original or production DB. */
export function localLegacyIntegrationDatabase(url: URL, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development' &&
    env.EMPS_LOCAL_LEGACY_INTEGRATION === 'true' &&
    env.EMPS_REMOTE_DEVELOPMENT === 'false' &&
    env.EMPS_PHYSICAL_COMMANDS_ENABLED === 'false' &&
    env.EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED === 'false' &&
    env.PAYMENT_PROVIDER === 'sandbox' &&
    env.HOST === '127.0.0.1' &&
    env.DEMO_HISTORY_TEST_DATABASE === 'emps_integration_test' &&
    !env.OCPP_GATEWAY_URL && !env.OCPP_GATEWAY_TOKEN &&
    !env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET &&
    url.protocol === 'mysql:' && url.hostname === '127.0.0.1' &&
    url.port === '3308' && url.pathname === '/emps_integration_test' &&
    decodeURIComponent(url.username) === 'emps_integration_app' && Boolean(url.password);
}

/** The audited clone is the only environment allowed to use local integration exceptions. */
export function localLegacyIntegrationActive(env: NodeJS.ProcessEnv = process.env): boolean {
  try { return localLegacyIntegrationDatabase(new URL(env.DATABASE_URL ?? ''), env); }
  catch { return false; }
}

/** Only the audited local clone may treat an explicit station OWNER staff grant like ownership for demo reads. */
export function localLegacyOwnerStaffAccess(env: NodeJS.ProcessEnv = process.env): boolean {
  return localLegacyIntegrationActive(env);
}
