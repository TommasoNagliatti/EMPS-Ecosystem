import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

export type ChargingGatewayCommand = {
  chargerId: string | number;
  commandId: string | bigint;
  ocppIdentity?: string | null;
  ocppVersion?: string | null;
  sessionId?: string | bigint | null;
  type: "START" | "STOP" | "STATUS" | "RESET" | "UNLOCK";
};

export type ChargingGatewayResult = {
  accepted: boolean;
  correlationId: string;
  mode: "gateway" | "sandbox";
  message?: string;
};

@Injectable()
export class ChargingGatewayService {
  async dispatch(
    command: ChargingGatewayCommand,
  ): Promise<ChargingGatewayResult> {
    const gatewayUrl = process.env.OCPP_GATEWAY_URL?.replace(/\/$/, "");
    if (!gatewayUrl) {
      return {
        accepted: true,
        correlationId: `sandbox_${command.commandId}`,
        mode: "sandbox",
      };
    }

    const token = process.env.OCPP_GATEWAY_TOKEN;
    if (!token) {
      throw new ServiceUnavailableException(
        "OCPP_GATEWAY_TOKEN não configurado",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${gatewayUrl}/commands`, {
        body: JSON.stringify({
          ...command,
          chargerId: String(command.chargerId),
          commandId: String(command.commandId),
          sessionId:
            command.sessionId == null ? null : String(command.sessionId),
        }),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        accepted?: boolean;
        correlationId?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new BadGatewayException("O gateway OCPP recusou o comando");
      }
      return {
        accepted: Boolean(payload.accepted),
        correlationId: payload.correlationId ?? String(command.commandId),
        message: payload.message,
        mode: "gateway",
      };
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException(
        "Não foi possível comunicar com o gateway OCPP",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
