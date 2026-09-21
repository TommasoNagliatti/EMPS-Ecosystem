import { ChargerPowerType } from "@prisma/client";
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreateChargerProvisioningDto {
  @IsString()
  @Length(1, 120)
  stationId!: string;

  @IsString()
  @Length(2, 100)
  name!: string;

  @IsString()
  @Length(2, 50)
  location!: string;

  @IsString()
  @Length(2, 50)
  connectorType!: string;

  @IsEnum(ChargerPowerType)
  powerType!: ChargerPowerType;

  @IsOptional()
  @IsInt()
  @IsIn([1, 3])
  phaseCount?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(10_000)
  powerKw!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000)
  pricePerKwh!: number;

  @IsString()
  @Length(2, 100)
  manufacturer!: string;

  @IsString()
  @Length(1, 100)
  model!: string;

  @IsString()
  @Length(3, 100)
  serialNumber!: string;

  @IsString()
  @Length(3, 100)
  ocppIdentity!: string;

  @IsString()
  @IsIn(["1.6J", "2.0.1"])
  ocppVersion!: string;
}

export class ClaimChargerProvisioningDto {
  @IsString()
  @Length(8, 80)
  activationCode!: string;

  @IsString()
  @Length(3, 100)
  serialNumber!: string;

  @IsString()
  @Length(3, 100)
  ocppIdentity!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  firmwareVersion?: string;
}

export class RejectChargerProvisioningDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
