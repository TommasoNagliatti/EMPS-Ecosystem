import {RfidController} from './rfid.controller';
import {TelemetryController,DeviceTelemetryController} from './telemetry.controller';
import {TelemetryService} from './telemetry.service';
import {ReservationsController} from './reservations.controller';
import {ReservationsService} from './reservations.service';
import {RfidService} from './rfid.service';
import {PrepaidBudgetService} from './prepaid-budget.service';
import {PublicWebChargeController,WebChargeController,WebChargeGuard} from './web-charge.controller';
import { SessionBillingController, SessionBillingService } from './session-billing.service';
import { StationsController } from './stations.controller';
import { GieController, GieService } from './gie.service';
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule, type JwtSignOptions } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthController, JwtGuard, RolesGuard } from "./auth";
import { AdminOperationsService } from "./admin-operations.service";
import { ChargingGatewayService } from "./charging-gateway.service";
import {
  ChargerProvisioningController,
  ChargerProvisioningDeviceController,
} from "./charger-provisioning.controller";
import { ChargerProvisioningService } from "./charger-provisioning.service";
import { DashboardController } from "./dashboard.controller";
import {
  MobileAuthController,
  MobileController,
  PaymentWebhookController,
} from "./mobile.controller";
import { MobileService } from "./mobile.service";
import { OperationsController } from "./operations.controller";
import { PaymentGatewayService } from "./payment-gateway.service";
import { PrismaService } from "./prisma.service";
import { RealtimeModule } from "./realtime.module";
import { UsersController } from "./users.controller";
import { WebAuthService } from "./web-auth.service";
import { PlatformController } from './platform.controller';
import { PlatformAccessService } from './platform-access.service';
import { PlatformStationsService } from './platform-stations.service';
import { StationMembersService } from './station-members.service';
import { NotificationGateway } from './notification.gateway';
import { PersistenceModule } from './persistence.module';
import { PhotoStorage, StationPhotosService, StationPhotosController, PublicStationPhotosController } from './station-photos';

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET é obrigatório em produção");
  }
  return "emps-development-only-secret-change-before-deploying";
}

@Module({
  imports: [
    PersistenceModule,
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    JwtModule.register({
      global: true,
      secret: jwtSecret(),
      signOptions: {
        audience: "emps-clients",
        expiresIn: (process.env.JWT_EXPIRES_IN ?? "15m") as JwtSignOptions["expiresIn"],
        issuer: "emps-api",
      },
      verifyOptions: {
        audience: "emps-clients",
        issuer: "emps-api",
      },
    }),
    RealtimeModule,
  ],
  controllers: [TelemetryController,DeviceTelemetryController,ReservationsController,RfidController,PublicWebChargeController,WebChargeController,StationPhotosController, PublicStationPhotosController, PlatformController, SessionBillingController, StationsController, GieController,
    AuthController,
    MobileAuthController,
    MobileController,
    PaymentWebhookController,
    UsersController,
    OperationsController,
    ChargerProvisioningController,
    ChargerProvisioningDeviceController,
    DashboardController,
  ],
  providers: [TelemetryService,ReservationsService,RfidService,PrepaidBudgetService,WebChargeGuard,PhotoStorage, StationPhotosService, PlatformAccessService, PlatformStationsService, StationMembersService, NotificationGateway, SessionBillingService, GieService,
    AdminOperationsService,
    MobileService,
    PaymentGatewayService,
    ChargingGatewayService,
    ChargerProvisioningService,
    WebAuthService,
    JwtGuard,
    RolesGuard,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
