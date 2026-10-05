import { PlatformStationsService } from './platform-stations.service';
import { StationScoped } from './auth';
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsLatitude, IsLongitude, IsString, Length, IsOptional } from 'class-validator';
import { Role } from '@prisma/client';
import { AuthRequest, JwtGuard, Roles, RolesGuard } from './auth';
import { PrismaService } from './prisma.service';
import { RealtimeService } from './realtime.service';
import { stationScope } from './persistence';


export class CreateStationDto {
  @IsString() @Length(2, 50) name!: string;
  @IsString() @Length(1, 80) street!: string;
  @IsString() @Length(1, 20) addressNumber!: string;
  @IsString() @Length(1, 80) neighborhood!: string;
  @IsString() @Length(1, 80) city!: string;
  @IsString() @Length(2, 2) state!: string;
  @IsString() @Length(8, 8) postalCode!: string;
  @IsLatitude() latitude!: number;
  @IsLongitude() longitude!: number;
  @IsOptional() @IsString() @Length(1, 80) openingHours?: string;
}

@Controller('stations')
@StationScoped()
@UseGuards(JwtGuard, RolesGuard)
@Roles(Role.ADMIN, Role.OPERATOR)
export class StationsController {
  constructor(private readonly db: PrismaService, private readonly realtime: RealtimeService, private readonly platform: PlatformStationsService) {}
  @Get()
  async list(@Req() req: AuthRequest) {
    const rows=await this.db.station.findMany({where: stationScope(req.user), orderBy: {id: 'asc'}});
    return rows.map(s=>({...s,giePrimary:String(s.id)===process.env.GIE_STATION_ID}));
  }
  @Post() @Roles()
  async create(@Req() req: AuthRequest, @Body() dto: CreateStationDto) {
    const station=await this.platform.create(req.user);
    return this.platform.save(req.user,String(station.id),dto);
  }
}
