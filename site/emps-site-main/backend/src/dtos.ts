import { ChargerStatus } from "./persistence";
import { PaymentMethod, AlertStatus } from "@prisma/client";
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

export class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}
export class CreateClientDto {
  @IsString() name!: string;
  @IsString() vehicle!: string;
  @IsString() plate!: string;
}
export class UpdateClientDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() vehicle?: string;
  @IsOptional() @IsString() plate?: string;
}
export class CreateChargerDto {
  @IsString() name!: string;
  @IsString() location!: string;
  @IsString() connectorType!: string;
  @IsNumber() @Min(0) powerKw!: number;
  @IsNumber() @Min(0) pricePerKwh!: number;
  @IsOptional() @IsNumber() temperature?: number;
  @IsOptional() @IsEnum(ChargerStatus) status?: ChargerStatus;
}
export class UpdateChargerDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() connectorType?: string;
  @IsOptional() @IsNumber() @Min(0.01) powerKw?: number;
  @IsOptional() @IsNumber() @Min(0) pricePerKwh?: number;
  @IsOptional() @IsNumber() @Min(-50) @Max(150) temperature?: number;
  @IsOptional() @IsEnum(ChargerStatus) status?: ChargerStatus;
}
export class UpdateChargerStatusDto {
  @IsEnum(ChargerStatus) status!: ChargerStatus;
}
export class StartChargingSessionDto {
  @IsString() clientId!: string;
  @IsString() chargerId!: string;
}
export class FinishChargingSessionDto {
  @IsOptional() @IsNumber() durationMinutes?: number;
}
export class SimulatePaymentDto {
  @IsString() sessionId!: string;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
}
export class UpdateAlertStatusDto {
  @IsEnum(AlertStatus) status!: AlertStatus;
}

export const CHARGER_COMMANDS = [
  "encerrar_carga",
  "liberar_conector",
  "sincronizar_status",
  "reiniciar_equipamento",
  "solicitar_manutencao",
  "executar_checklist",
  "agendar_teste",
] as const;

export type AdminChargerCommand = (typeof CHARGER_COMMANDS)[number];

export class ChargerCommandDto {
  @IsIn(CHARGER_COMMANDS)
  command!: AdminChargerCommand;
}

export class ManualReleaseDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.5)
  @Max(10_000)
  valorRecebido!: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.01)
  @Max(1_000)
  tarifaKwh!: number;

  @IsOptional()
  @IsString()
  operadorId?: string;

  @IsIn(["caixa"])
  origem!: "caixa";

  @IsIn(["fallback_qr_code"])
  motivo!: "fallback_qr_code";

  @IsOptional()
  @IsIn(["pre_pago"])
  modo?: "pre_pago";
}

export class PostpaidReleaseDto {
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.01)
  @Max(1_000)
  tarifaKwh!: number;

  @IsOptional()
  @IsString()
  operadorId?: string;

  @IsIn(["caixa"])
  origem!: "caixa";

  @IsIn(["pagamento_no_encerramento"])
  motivo!: "pagamento_no_encerramento";
}

export class CashSettlementDto {
  @IsOptional() @IsString() quoteToken?: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  energiaConsumidaKwh!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  valorCobrado!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  valorRecebido!: number;

  @IsOptional()
  @IsString()
  operadorId?: string;

  @IsIn(["caixa"])
  origem!: "caixa";
}
