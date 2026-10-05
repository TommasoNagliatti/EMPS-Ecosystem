import { Type } from "class-transformer";
import {
  IsEmail,
  IsBoolean,
  Equals,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";

export const MOBILE_PAYMENT_METHODS = ["pix", "card", "wallet"] as const;
export type MobilePaymentMethod = (typeof MOBILE_PAYMENT_METHODS)[number];

export class MobileRegisterDto {
  @IsString() @Length(8,72) passwordConfirmation!: string;
  @IsBoolean() @Equals(true) acceptTerms!: boolean;
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsEmail()
  @Length(3, 255)
  email!: string;

  @IsString()
  @Length(8, 72)
  password!: string;
}
export class MobileLoginDto {
  @IsEmail()
  @Length(3, 255)
  email!: string;

  @IsString()
  @Length(6, 72)
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  @Length(32, 512)
  refreshToken!: string;
}

export class NearbyStationsQueryDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(250)
  radiusKm = 25;
}

export class CreatePaymentIntentDto {
  @IsString()
  chargerId!: string;

  @IsIn(MOBILE_PAYMENT_METHODS)
  method!: MobilePaymentMethod;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000)
  spendingLimit!: number | null;
}

export class StartMobileChargingDto {
  @IsString()
  qrBindingId!: string;

  @IsString()
  paymentIntentId!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000)
  spendingLimit!: number | null;

  @IsOptional()
  @IsString()
  @Length(8, 100)
  idempotencyKey?: string;
}
