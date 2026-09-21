import type { ApiResource } from "@/domain/emps";

export const REALTIME_CHANGE_EVENT = "emps:change";

export const realtimeTopics = [
  "session.created",
  "session.updated",
  "payment.updated",
  "charger.updated",
  "station.updated",
  "alert.updated",
  "customer.updated",
  "dashboard.updated",
] as const;

export type RealtimeTopic = (typeof realtimeTopics)[number];
export type RealtimeTopicRevisions = Record<RealtimeTopic, number>;

export type RealtimeChange = {
  eventId: string;
  topic: RealtimeTopic;
  entityId: string;
  occurredAt: string;
  customerId?: string;
};

const topicSet = new Set<string>(realtimeTopics);

const resourceTopics: Record<ApiResource, ReadonlySet<RealtimeTopic>> = {
  carregadores: new Set([
    "charger.updated",
    "station.updated",
    "session.created",
    "session.updated",
    "dashboard.updated",
  ]),
  sessoes: new Set([
    "session.created",
    "session.updated",
    "payment.updated",
    "charger.updated",
    "dashboard.updated",
  ]),
  pagamentos: new Set([
    "payment.updated",
    "session.created",
    "session.updated",
    "dashboard.updated",
  ]),
  alertas: new Set([
    "alert.updated",
    "charger.updated",
    "station.updated",
    "dashboard.updated",
  ]),
  clientes: new Set([
    "customer.updated",
    "session.created",
    "session.updated",
    "payment.updated",
    "dashboard.updated",
  ]),
};

export function createRealtimeTopicRevisions(): RealtimeTopicRevisions {
  return Object.fromEntries(
    realtimeTopics.map((topic) => [topic, 0])
  ) as RealtimeTopicRevisions;
}

export function parseRealtimeChange(value: unknown): RealtimeChange | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.eventId !== "string" ||
    !candidate.eventId.trim() ||
    typeof candidate.topic !== "string" ||
    !topicSet.has(candidate.topic) ||
    typeof candidate.entityId !== "string" ||
    !candidate.entityId.trim() ||
    typeof candidate.occurredAt !== "string" ||
    Number.isNaN(Date.parse(candidate.occurredAt)) ||
    (candidate.customerId !== undefined &&
      (typeof candidate.customerId !== "string" ||
        !candidate.customerId.trim()))
  ) {
    return null;
  }

  return candidate as RealtimeChange;
}

export function resourceUsesRealtimeTopic(
  resource: ApiResource,
  topic: RealtimeTopic
) {
  return resourceTopics[resource].has(topic);
}

export function resourceRealtimeRevision(
  resource: ApiResource,
  revisions: RealtimeTopicRevisions
) {
  let revision = 0;
  for (const topic of resourceTopics[resource]) revision += revisions[topic];
  return revision;
}
