import { localLegacyIntegrationActive } from './local-legacy-integration';
import { officialDemoRuntimeActive } from './official-demo-runtime';
import type { LabConfig } from './lab-maquete-domain';

export const USB_RELAY_CAPABILITY = 'emps.usb-relay.v1';
/** Explicit user-approved USB bench test only; never authorizes OCPP or mains power. */
export function usbRelayApproval(config: LabConfig, capable: boolean, now = Date.now(), env: NodeJS.ProcessEnv = process.env,
  deviceActiveLevel: unknown = null) {
  const until = Date.parse(env.EMPS_MAQUETE_USB_APPROVED_UNTIL ?? '');
  const activeLevel = ['LOW','HIGH'].includes(env.EMPS_MAQUETE_USB_RELAY_ACTIVE_LEVEL ?? '')
    ? env.EMPS_MAQUETE_USB_RELAY_ACTIVE_LEVEL! : null;
  const reportedLevel = deviceActiveLevel === 'LOW' || deviceActiveLevel === 'HIGH' ? deviceActiveLevel : null;
  const polarityMatched = activeLevel !== null && activeLevel === reportedLevel;
  const runtimeApproved = localLegacyIntegrationActive(env) || (officialDemoRuntimeActive(env) &&
    env.EMPS_OFFICIAL_DEMO_RUNTIME === 'OFFICIAL' && env.EMPS_OFFICIAL_USB_RELAY_SCOPE === 'LOW_VOLTAGE_USB_ONLY');
  const approved = capable && runtimeApproved && config.deviceId === 'maquete-01' &&
    config.energyStationId === 13 && env.EMPS_MAQUETE_USB_HARDWARE_APPROVED === 'true' &&
    env.EMPS_MAQUETE_USB_ELECTRICAL_SAFE === 'true' && polarityMatched &&
    Number.isFinite(until) && until > now && until - now <= 8 * 60 * 60 * 1000;
  return { hardwareApproved: approved, electricalSafe: approved,
    mode: approved ? 'USB_RELAY_TEST' : 'SERIAL_ONLY',
    approval: { scope: 'LOW_VOLTAGE_USB_ONLY', source: 'USER_CONFIRMED',
      activeLevel, deviceActiveLevel:reportedLevel, polarityMatched,
      expiresAt: approved ? new Date(until).toISOString() : null,
      expiresAtMs: approved ? until : null } };
}
