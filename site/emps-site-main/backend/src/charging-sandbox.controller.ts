import { Throttle } from '@nestjs/throttler';
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthRequest, JwtGuard } from './auth';
import { ChargingSandboxService } from './charging-sandbox.service';

/** Authenticated station-manager facade over the same local sandbox charging ledger. */
@Controller('v2/stations/:stationId/charging-sandbox')
@UseGuards(JwtGuard)
export class ChargingSandboxController {
  constructor(private readonly sandbox: ChargingSandboxService) {}

  // LAN preview shares one IP across tabs/devices. Budget only this authenticated poll.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Get()
  state(@Req() request: AuthRequest, @Param('stationId') stationId: string) {
    return this.sandbox.state(request.user, stationId);
  }
  @Get('chargers/:chargerId/qr')
  qr(@Req() request: AuthRequest, @Param('stationId') stationId: string, @Param('chargerId') chargerId: string) {
    return this.sandbox.qrForManager(request.user, stationId, chargerId);
  }
  @Post('chargers/:chargerId/start')
  start(@Req() request: AuthRequest, @Param('stationId') stationId: string,
    @Param('chargerId') chargerId: string, @Body() body: {method?:unknown;spendingLimit?:unknown;idempotencyKey?:unknown}) {
    return this.sandbox.start(request.user, stationId, chargerId, body?.method, body?.spendingLimit, body?.idempotencyKey);
  }
  @Post('chargers/:chargerId/cashier-start')
  cashierStart(@Req() request: AuthRequest, @Param('stationId') stationId: string,
    @Param('chargerId') chargerId: string,
    @Body() body: {method?:unknown;amountReceived?:unknown;operatorConfirmed?:unknown;idempotencyKey?:unknown}) {
    return this.sandbox.startCashier(request.user, stationId, chargerId, body?.method,
      body?.amountReceived, body?.operatorConfirmed, body?.idempotencyKey);
  }
  @Post('sessions/:sessionId/stop')
  stop(@Req() request: AuthRequest, @Param('stationId') stationId: string,
    @Param('sessionId') sessionId: string, @Body() body: {idempotencyKey?:unknown}) {
    return this.sandbox.stop(request.user, stationId, sessionId, body?.idempotencyKey, 'OPERATE', true);
  }
}
