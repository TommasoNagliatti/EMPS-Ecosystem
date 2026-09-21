import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Role } from "@prisma/client";
import type { Request } from "express";
import { AuthRequest, JwtGuard, Roles, RolesGuard } from "./auth";
import {
  CreatePaymentIntentDto,
  MobileLoginDto,
  MobileRegisterDto,
  NearbyStationsQueryDto,
  RefreshTokenDto,
  StartMobileChargingDto,
} from "./mobile.dtos";
import { MobileService } from "./mobile.service";
import { PaymentGatewayService } from "./payment-gateway.service";

@Controller("mobile/v1/auth")
export class MobileAuthController {
  constructor(private readonly mobile: MobileService) {}

  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post("register")
  register(@Body() dto: MobileRegisterDto) {
    return this.mobile.register(dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("login")
  login(@Body() dto: MobileLoginDto) {
    return this.mobile.login(dto);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("refresh")
  refresh(@Body() dto: RefreshTokenDto) {
    return this.mobile.refresh(dto.refreshToken);
  }

  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post("logout")
  async logout(@Req() request: AuthRequest, @Body() dto: RefreshTokenDto) {
    await this.mobile.logout(request.user.sub, dto.refreshToken);
  }

  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  @Get("me")
  me(@Req() request: AuthRequest) {
    return this.mobile.me(request.user.sub);
  }
}

@UseGuards(JwtGuard, RolesGuard)
@Roles(Role.CUSTOMER)
@Controller("mobile/v1")
export class MobileController {
  constructor(private readonly mobile: MobileService) {}

  @Get("stations/nearby")
  nearbyStations(@Query() query: NearbyStationsQueryDto) {
    return this.mobile.nearbyStations(query);
  }

  @Get("stations/:id")
  station(@Param("id") stationId: string) {
    return this.mobile.station(stationId);
  }

  @Get("chargers/:id")
  charger(@Param("id") chargerId: string) {
    return this.mobile.charger(chargerId);
  }

  @Get("qr/:publicToken")
  resolveQr(@Param("publicToken") publicToken: string) {
    return this.mobile.resolveQr(publicToken);
  }

  @Post("payment-intents")
  createPaymentIntent(
    @Req() request: AuthRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CreatePaymentIntentDto,
  ) {
    return this.mobile.createPaymentIntent(request.user.sub, dto, idempotencyKey);
  }

  @Get("payment-intents/:id")
  paymentIntent(@Req() request: AuthRequest, @Param("id") intentId: string) {
    return this.mobile.paymentIntent(request.user.sub, intentId);
  }

  @Post("charging-sessions/start")
  startCharging(
    @Req() request: AuthRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: StartMobileChargingDto,
  ) {
    return this.mobile.startCharging(request.user.sub, dto, idempotencyKey);
  }

  @Get("charging-sessions/active")
  activeSession(@Req() request: AuthRequest) {
    return this.mobile.activeSession(request.user.sub);
  }

  @Get("charging-sessions")
  sessionHistory(@Req() request: AuthRequest) {
    return this.mobile.sessionHistory(request.user.sub);
  }

  @Get("charging-sessions/:id")
  session(@Req() request: AuthRequest, @Param("id") sessionId: string) {
    return this.mobile.session(request.user.sub, sessionId);
  }

  @Post("charging-sessions/:id/stop")
  stopCharging(
    @Req() request: AuthRequest,
    @Param("id") sessionId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    return this.mobile.stopCharging(request.user.sub, sessionId, idempotencyKey);
  }
}

@Controller(["webhooks", "payments/stripe"])
export class PaymentWebhookController {
  constructor(
    private readonly gateway: PaymentGatewayService,
    private readonly mobile: MobileService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post(["stripe", "webhook"])
  stripe(
    @Req() request: RawBodyRequest<Request>,
    @Headers("stripe-signature") signature: string | undefined,
  ) {
    if (!signature || !request.rawBody) {
      throw new BadRequestException("Assinatura Stripe ausente");
    }
    const event = this.gateway.constructWebhookEvent(request.rawBody, signature);
    return this.mobile.processStripeWebhook(event);
  }
}
