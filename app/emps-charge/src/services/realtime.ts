import { io, type Socket } from 'socket.io-client';

export type RealtimeChangePayload = {
  eventId: string;
  topic: string;
  entityId: string;
  occurredAt: string;
  customerId?: string;
};

export type RealtimeInvalidation = {
  chargerIds: string[];
  refreshSessions: boolean;
  refreshHistory: boolean;
  refreshCachedEntities: boolean;
  stationIds: string[];
};

const CONSERVATIVE_INVALIDATION: RealtimeInvalidation = {
  chargerIds: [],
  refreshSessions: true,
  refreshHistory: true,
  refreshCachedEntities: true,
  stationIds: [],
};

export function mergeRealtimeInvalidations(
  current: RealtimeInvalidation | null,
  incoming: RealtimeInvalidation,
): RealtimeInvalidation {
  if (!current) return incoming;
  return {
    chargerIds: [...new Set([...current.chargerIds, ...incoming.chargerIds])],
    refreshSessions: current.refreshSessions || incoming.refreshSessions,
    refreshHistory: current.refreshHistory || incoming.refreshHistory,
    refreshCachedEntities:
      current.refreshCachedEntities || incoming.refreshCachedEntities,
    stationIds: [...new Set([...current.stationIds, ...incoming.stationIds])],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseRealtimeChange(value: unknown): RealtimeChangePayload | null {
  if (!isRecord(value)) return null;
  const { eventId, topic, entityId, occurredAt, customerId } = value;
  if (
    typeof eventId !== 'string' ||
    eventId.trim().length === 0 ||
    typeof topic !== 'string' ||
    topic.trim().length === 0 ||
    typeof entityId !== 'string' ||
    entityId.trim().length === 0 ||
    typeof occurredAt !== 'string' ||
    occurredAt.trim().length === 0 ||
    Number.isNaN(Date.parse(occurredAt)) ||
    (customerId !== undefined &&
      (typeof customerId !== 'string' || customerId.trim().length === 0))
  ) {
    return null;
  }

  return {
    eventId: eventId.trim(),
    topic: topic.trim(),
    entityId: entityId.trim(),
    occurredAt: occurredAt.trim(),
    ...(typeof customerId === 'string' ? { customerId: customerId.trim() } : {}),
  };
}

export function mapRealtimeChangeToInvalidation(value: unknown): RealtimeInvalidation {
  const payload = parseRealtimeChange(value);
  if (!payload) return CONSERVATIVE_INVALIDATION;

  const topicPrefix = payload.topic.trim().toLowerCase().split('.')[0];
  switch (topicPrefix) {
    case 'session':
    case 'payment':
      return {
        chargerIds: [],
        refreshSessions: true,
        refreshHistory: true,
        refreshCachedEntities: false,
        stationIds: [],
      };
    case 'charger':
      return {
        chargerIds: [payload.entityId],
        refreshSessions: false,
        refreshHistory: false,
        refreshCachedEntities: true,
        stationIds: [],
      };
    case 'station':
      return {
        chargerIds: [],
        refreshSessions: false,
        refreshHistory: false,
        refreshCachedEntities: true,
        stationIds: [payload.entityId],
      };
    case 'alert':
    case 'dashboard':
      return CONSERVATIVE_INVALIDATION;
    default:
      return CONSERVATIVE_INVALIDATION;
  }
}

export function createRealtimeSocket(baseUrl: string, accessToken: string): Socket {
  return io(`${baseUrl.trim().replace(/\/$/, '')}/realtime`, {
    auth: { token: accessToken },
    autoConnect: false,
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: Number.POSITIVE_INFINITY,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    timeout: 10_000,
    transports: ['websocket'],
  });
}
