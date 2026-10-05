import { StationScoped } from './auth';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Role } from "@prisma/client";
import { AuthRequest, JwtGuard, Roles, RolesGuard } from "./auth";
import {
  ClaimChargerProvisioningDto,
  CreateChargerProvisioningDto,
  RejectChargerProvisioningDto,
} from "./charger-provisioning.dtos";
import { ChargerProvisioningService } from "./charger-provisioning.service";

@StationScoped()
@UseGuards(JwtGuard, RolesGuard)
@Roles(Role.ADMIN, Role.OPERATOR)
@Controller("charger-provisionings")
export class ChargerProvisioningController {
  constructor(private readonly provisioning: ChargerProvisioningService) {}

  @Get("stations")
  stations(@Req() request: AuthRequest) {
    return this.provisioning.stationOptions(request.user);
  }

  @Get()
  list(@Req() request: AuthRequest) {
    return this.provisioning.list(request.user);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(
    @Req() request: AuthRequest,
    @Body() dto: CreateChargerProvisioningDto,
  ) {
    return this.provisioning.create(request.user, dto);
  }

  @Post(":id/cancel")
  @Roles(Role.ADMIN)
  cancel(@Req() request: AuthRequest, @Param("id") id: string) {
    return this.provisioning.cancel(request.user, id);
  }

  @Delete(":id")
  @Roles(Role.ADMIN)
  remove(@Req() request: AuthRequest, @Param("id") id: string) {
    return this.provisioning.remove(request.user, id);
  }

  @Post(":id/approve")
  @Roles(Role.ADMIN)
  approve(@Req() request: AuthRequest, @Param("id") id: string) {
    return this.provisioning.approve(request.user, id);
  }

  @Post(":id/reject")
  @Roles(Role.ADMIN)
  reject(
    @Req() request: AuthRequest,
    @Param("id") id: string,
    @Body() dto: RejectChargerProvisioningDto,
  ) {
    return this.provisioning.reject(request.user, id, dto);
  }
}

@Controller("device/v1/charger-provisionings")
export class ChargerProvisioningDeviceController {
  constructor(private readonly provisioning: ChargerProvisioningService) {}

  @Post("claim")
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  claim(@Body() dto: ClaimChargerProvisioningDto) {
    return this.provisioning.claim(dto);
  }
}
