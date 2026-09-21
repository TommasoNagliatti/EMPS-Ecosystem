export const REALTIME_NAMESPACE = "/realtime";
export const REALTIME_CHANGE_EVENT = "emps:change";
export const REALTIME_READY_EVENT = "emps:ready";

export const REALTIME_TOPICS = [
  "session.created",
  "session.updated",
  "payment.updated",
  "charger.updated",
  "station.updated",
  "alert.updated",
  "customer.updated",
  "dashboard.updated",
] as const;

export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];

/**
 * The complete event sent over the wire. Keep this contract deliberately
 * small: identifiers and change metadata only, never names, e-mails, payment
 * data, tokens, or arbitrary database records.
 */
export type RealtimeChange = Readonly<{
  eventId: string;
  topic: RealtimeTopic;
  entityId: string;
  occurredAt: string;
  customerId?: string;
}>;

/**
 * Internal publication input. `operational` controls routing and is never
 * exposed to clients.
 */
export type RealtimeChangeInput = Readonly<{
  topic: RealtimeTopic;
  entityId: string;
  customerId?: string;
  operational?: boolean;
}>;

export type RealtimeOperationsChangeInput = Omit<
  RealtimeChangeInput,
  "customerId" | "operational"
>;

export type RealtimeCustomerChangeInput = Omit<
  RealtimeChangeInput,
  "customerId"
>;

export const REALTIME_ROOMS = {
  authenticated: "authenticated",
  operations: "operations",
  customer(customerId: string) {
    return `customer:${customerId}`;
  },
} as const;
