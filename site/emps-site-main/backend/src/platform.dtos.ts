import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested, Matches } from 'class-validator';

export const AMENITIES = ['Café','Restaurante','Banheiro','Wi-Fi','Área infantil','Shopping','Hotel','Parque','Loja','Conveniência','24h','Acessibilidade'];
export class HoursWindowDto {
  @IsInt() @Min(0) @Max(6) day!: number;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) start!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) end!: string;
}
export class AvailabilityDto {
  @IsBoolean() alwaysOpen!: boolean;
  @IsArray() @ArrayMaxSize(28) @ValidateNested({each:true}) @Type(()=>HoursWindowDto) windows!: HoursWindowDto[];
}
export class BatteryDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @Length(1,100) name!: string;
  @IsNumber() @Min(0.01) @Max(1000000) capacityKwh!: number;
  @IsNumber() @Min(0.01) @Max(1000000) maxChargeKw!: number;
  @IsNumber() @Min(0.01) @Max(1000000) maxDischargeKw!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) socPercent?: number;
  @IsNumber() @Min(0) @Max(100) minSocPercent = 10;
  @IsNumber() @Min(0) @Max(100) maxSocPercent = 95;
  @IsNumber() @Min(0.01) @Max(1) efficiency = 0.95;
  @IsOptional() @IsString() @Length(0,100) manufacturer?: string;
  @IsOptional() @IsString() @Length(0,100) model?: string;
  @IsIn(['CONFIGURED','ACTIVE','INACTIVE','FAULTED']) status = 'CONFIGURED';
  @IsOptional() @IsString() @Length(0,150) integrationRef?: string;
}
export class SolarDto {
  @IsIn(['CONFIGURED','ACTIVE','INACTIVE','FAULTED']) status = 'CONFIGURED';
  @IsOptional() @IsUUID() id?: string;
  @IsString() @Length(1,100) name!: string;
  @IsNumber() @Min(0.01) @Max(1000000) installedKwp!: number;
  @IsOptional() @IsNumber() @Min(0.01) @Max(1000000) acPowerKw?: number;
  @IsOptional() @IsString() @Length(0,100) inverter?: string;
  @IsOptional() @IsString() @Length(0,100) manufacturer?: string;
  @IsOptional() @IsString() @Length(0,100) model?: string;
  @IsOptional() @IsString() @Length(0,150) integrationRef?: string;
}
export class DraftChargerDto {
  @IsOptional() @IsNumber({maxDecimalPlaces:4}) @Min(0.01) @Max(10000) pricePerKwh?:number;
  @IsOptional() @IsInt() @Min(1) id?: number;
  @IsString() @Length(1,100) name!: string;
  @IsString() @Length(1,100) ocppIdentity!: string;
  @IsOptional() @IsString() @Length(0,100) serialNumber?: string;
  @IsOptional() @IsString() @Length(0,100) manufacturer?: string;
  @IsOptional() @IsString() @Length(0,100) model?: string;
  @IsOptional() @IsString() @Length(0,50) firmwareVersion?: string;
  @IsString() @Length(1,50) connectorType!: string;
  @IsNumber() @Min(0.1) @Max(2000) powerKw!: number;
  @IsIn(['PENDING','ENABLED','DISABLED','MAINTENANCE']) administrativeStatus: 'PENDING'|'ENABLED'|'DISABLED'|'MAINTENANCE' = 'PENDING';
}
export class StationDraftDto {
  @IsOptional() @IsString() @Length(0,50) name?: string;
  @IsOptional() @IsString() @Length(0,500) description?: string;
  @IsOptional() @IsIn(['posto','shopping','condominio','empresa','residencial','hotel','estacionamento','concessionaria','outro']) venueType?: string;
  @IsOptional() @IsIn(['PUBLIC','PRIVATE']) visibility?: 'PUBLIC'|'PRIVATE';
  @IsOptional() @IsString() @Length(2,2) countryCode?: string;
  @IsOptional() @Matches(/^(\d{8})?$/) postalCode?: string;
  @IsOptional() @IsString() @Length(0,2) state?: string;
  @IsOptional() @IsString() @Length(0,80) city?: string;
  @IsOptional() @IsString() @Length(0,80) neighborhood?: string;
  @IsOptional() @IsString() @Length(0,80) street?: string;
  @IsOptional() @IsString() @Length(0,20) addressNumber?: string;
  @IsOptional() @IsString() @Length(0,80) complement?: string;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
  @IsOptional() @IsString() @Length(1,50) timezone?: string;
  @IsOptional() @IsString() @Length(0,100) openingHours?: string;
  @IsOptional() @ValidateNested() @Type(()=>AvailabilityDto) availability?: AvailabilityDto;
  @IsOptional() @IsBoolean() guestAllowed?: boolean;
  @IsOptional() @IsNumber() @Min(0.1) @Max(1000000) powerLimitKw?: number;
  @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) @Max(10000) reservationRatePerHour?: number;
  @IsOptional() @IsString() @Length(10,1000) reservationPolicyText?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>BatteryDto) batteries?: BatteryDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>SolarDto) solarAssets?: SolarDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>DraftChargerDto) chargers?: DraftChargerDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsIn(AMENITIES,{each:true}) amenities?: string[];
}
export class MemberDto {
  @IsEmail() email!: string;
  @IsIn(['MANAGER','OPERATOR','COLLECTOR','VIEWER']) role!: 'MANAGER'|'OPERATOR'|'COLLECTOR'|'VIEWER';
}
export class MemberRoleDto {
  @IsIn(['MANAGER','OPERATOR','COLLECTOR','VIEWER']) role!: 'MANAGER'|'OPERATOR'|'COLLECTOR'|'VIEWER';
}
export class InviteAcceptDto { @IsString() @Length(32,200) token!: string; }
export class ReviewDto {
  @IsOptional() @IsBoolean() activateDemoChargers?:boolean;
  @IsIn(['APPROVED','CHANGES_REQUESTED','REJECTED']) decision!: 'APPROVED'|'CHANGES_REQUESTED'|'REJECTED';
  @IsString() @Length(3,1000) reason!: string;
}
