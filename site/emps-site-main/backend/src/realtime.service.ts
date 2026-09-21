import { Injectable } from "@nestjs/common";
import type { Namespace } from "socket.io";
import {
  REALTIME_CHANGE_EVENT,
  type RealtimeChange,
  type RealtimeChangeInput,
  type RealtimeCustomerChangeInput,
  type RealtimeOperationsChangeInput,
} from "./realtime.contract";
import { createRealtimeChange, routeRealtimeChange } from "./realtime.helpers";

type RealtimeEmitter = Pick<Namespace, "to">;

@Injectable()
export class RealtimeService {
  private emitter?: RealtimeEmitter;

  attachEmitter(emitter: RealtimeEmitter): void {
    this.emitter = emitter;
  }

  isReady(): boolean {
    return this.emitter !== undefined;
  }

  publish(
    input: Omit<RealtimeChangeInput, "entityId" | "customerId"> & {
      entityId: string | number | bigint;
      customerId?: string | number;
    },
  ): RealtimeChange {
    const normalized = {
      ...input,
      entityId: String(input.entityId),
      customerId:
        input.customerId === undefined ? undefined : String(input.customerId),
    };
    const change = createRealtimeChange(normalized);
    const rooms = routeRealtimeChange(normalized);
    this.emitter?.to(rooms).emit(REALTIME_CHANGE_EVENT, change);
    return change;
  }

  publishToOperations(
    input: Omit<RealtimeOperationsChangeInput, "entityId"> & {
      entityId: string | number | bigint;
    },
  ): RealtimeChange {
    return this.publish({ ...input, operational: true });
  }

  publishToCustomer(
    customerId: string,
    input: RealtimeCustomerChangeInput,
  ): RealtimeChange {
    return this.publish({ ...input, customerId });
  }
}
