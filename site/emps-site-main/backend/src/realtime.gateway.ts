import { Inject, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Namespace, Socket } from "socket.io";
import {
  REALTIME_NAMESPACE,
  REALTIME_READY_EVENT,
} from "./realtime.contract";
import {
  authenticateRealtimeHandshake,
  realtimeCorsOrigin,
  roomsForRealtimeUser,
  type RealtimeAuthUser,
} from "./realtime.helpers";
import { RealtimeService } from "./realtime.service";

type AuthenticatedSocket = Socket & {
  data: Socket["data"] & {
    authorizationExpiryTimer?: ReturnType<typeof setTimeout>;
    user?: RealtimeAuthUser;
  };
};

type RealtimeConnectionError = Error & {
  data?: { code: string };
};

const MAX_TIMER_DELAY_MS = 2_147_483_647;

@WebSocketGateway({
  namespace: REALTIME_NAMESPACE,
  cors: {
    credentials: true,
    origin: realtimeCorsOrigin,
  },
  transports: ["websocket", "polling"],
})
export class RealtimeGateway
implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    @Inject(JwtService)
    private readonly jwt: JwtService,
    @Inject(RealtimeService)
    private readonly realtime: RealtimeService,
  ) {}

  private scheduleAuthorizationExpiry(client: AuthenticatedSocket): boolean {
    const user = client.data.user;
    if (!user || client.connected === false) return false;

    const expiresInMs = user.exp * 1_000 - Date.now();
    if (expiresInMs <= 0) {
      client.disconnect(true);
      return false;
    }

    client.data.authorizationExpiryTimer = setTimeout(() => {
      this.scheduleAuthorizationExpiry(client);
    }, Math.min(expiresInMs, MAX_TIMER_DELAY_MS));
    client.data.authorizationExpiryTimer.unref?.();
    return true;
  }

  afterInit(server: Namespace): void {
    this.realtime.attachEmitter(server);
    server.use((socket: AuthenticatedSocket, next) => {
      try {
        socket.data.user = authenticateRealtimeHandshake(
          this.jwt,
          socket.handshake,
        );
        next();
      } catch {
        const error = new Error("Não autorizado") as RealtimeConnectionError;
        error.data = { code: "UNAUTHORIZED" };
        next(error);
      }
    });
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    const user = client.data.user;
    if (!user) {
      client.disconnect(true);
      return;
    }
    await client.join(roomsForRealtimeUser(user));
    if (!this.scheduleAuthorizationExpiry(client)) return;
    client.emit(REALTIME_READY_EVENT, {
      ready: true,
      occurredAt: new Date().toISOString(),
    });
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    if (client.data.authorizationExpiryTimer) {
      clearTimeout(client.data.authorizationExpiryTimer);
      delete client.data.authorizationExpiryTimer;
    }
    this.logger.debug(`Cliente realtime desconectado: ${client.id}`);
  }

}
