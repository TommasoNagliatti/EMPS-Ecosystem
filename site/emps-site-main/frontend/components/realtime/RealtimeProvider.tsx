"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io, type Socket } from "socket.io-client";
import {
  api,
  EMPS_SESSION_CHANGED_EVENT,
  empsApiUrl,
  frontSession,
  isDemoMode,
  millisecondsUntilSessionRefresh,
} from "@/services/emps-api";
import {
  createRealtimeTopicRevisions,
  parseRealtimeChange,
  REALTIME_CHANGE_EVENT,
  type RealtimeTopicRevisions,
} from "@/services/emps-realtime";

export type RealtimeStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "disconnected";

type RealtimeContextValue = {
  changeRevision: number;
  connectionVersion: number;
  status: RealtimeStatus;
  topicRevisions: RealtimeTopicRevisions;
};

const RealtimeContext = createContext<RealtimeContextValue>({
  changeRevision: 0,
  connectionVersion: 0,
  status: "disabled",
  topicRevisions: createRealtimeTopicRevisions(),
});

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const recentEventsRef = useRef(new Set<string>());
  const [changeRevision, setChangeRevision] = useState(0);
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [topicRevisions, setTopicRevisions] = useState(
    createRealtimeTopicRevisions
  );
  const [status, setStatus] = useState<RealtimeStatus>(
    isDemoMode ? "disabled" : "disconnected"
  );

  const disconnect = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    const socket = socketRef.current;
    socketRef.current = null;
    socket?.removeAllListeners();
    socket?.disconnect();
  }, []);

  const recoverAuthentication = useCallback(() => {
    disconnect();
    void api.refreshSession().catch(() => {
      setStatus("disconnected");
    });
  }, [disconnect]);

  const synchronizeConnection = useCallback(() => {
    disconnect();

    if (isDemoMode) {
      setStatus("disabled");
      return;
    }

    const session = frontSession.get();
    if (session?.modo !== "api" || !session.token) {
      setStatus("disconnected");
      return;
    }

    setStatus("connecting");
    const socket = io(`${empsApiUrl}/realtime`, {
      auth: { token: session.token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
      timeout: 10_000,
      transports: ["websocket"],
    });

    socketRef.current = socket;
    const refreshDelay = millisecondsUntilSessionRefresh(session.token);
    if (refreshDelay !== null) {
      refreshTimerRef.current = window.setTimeout(
        recoverAuthentication,
        refreshDelay
      );
    }
    socket.on("connect", () => setStatus("connecting"));
    socket.on("emps:ready", () => {
      setStatus("connected");
      setConnectionVersion((current) => current + 1);
    });
    socket.on("disconnect", (reason) => {
      setStatus("disconnected");
      if (reason === "io server disconnect") {
        recoverAuthentication();
      }
    });
    socket.on("connect_error", (error) => {
      setStatus("disconnected");
      const code = (
        error as Error & { data?: { code?: unknown } }
      ).data?.code;
      if (code === "UNAUTHORIZED") {
        recoverAuthentication();
      }
    });
    socket.on(REALTIME_CHANGE_EVENT, (payload: unknown) => {
      const change = parseRealtimeChange(payload);
      if (!change || recentEventsRef.current.has(change.eventId)) return;

      recentEventsRef.current.add(change.eventId);
      if (recentEventsRef.current.size > 200) {
        const oldestEventId = recentEventsRef.current.values().next().value;
        if (oldestEventId) recentEventsRef.current.delete(oldestEventId);
      }
      setChangeRevision((current) => current + 1);
      setTopicRevisions((current) => ({
        ...current,
        [change.topic]: current[change.topic] + 1,
      }));
    });
  }, [disconnect, recoverAuthentication]);

  useEffect(() => {
    synchronizeConnection();
    window.addEventListener(
      EMPS_SESSION_CHANGED_EVENT,
      synchronizeConnection
    );

    return () => {
      window.removeEventListener(
        EMPS_SESSION_CHANGED_EVENT,
        synchronizeConnection
      );
      disconnect();
    };
  }, [disconnect, synchronizeConnection]);

  const value = useMemo(
    () => ({
      changeRevision,
      connectionVersion,
      status,
      topicRevisions,
    }),
    [changeRevision, connectionVersion, status, topicRevisions]
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
