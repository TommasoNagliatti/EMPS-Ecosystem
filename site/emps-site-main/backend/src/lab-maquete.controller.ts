import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthRequest, JwtGuard } from './auth';
import { LabMaqueteService } from './lab-maquete.service';

@Controller('v2/stations/:stationId/lab-device')
@UseGuards(JwtGuard)
export class LabMaqueteController {
  constructor(private readonly lab: LabMaqueteService) {}
  @Get('energy-json')
  @Header('Cache-Control', 'no-store')
  energyJson(@Req() req: AuthRequest, @Param('stationId') stationId:string) {
    return this.lab.energyJson(req.user, stationId);
  }
  @Get()
  state(@Req() req: AuthRequest, @Param('stationId') stationId: string) {
    return this.lab.state(req.user, stationId);
  }
  @Post('commands')
  command(@Req() req: AuthRequest, @Param('stationId') stationId: string, @Body() body: unknown) {
    return this.lab.issue(req.user, stationId, body);
  }
  @Post('rfid-tags')
  enrollTag(@Req() req: AuthRequest, @Param('stationId') stationId: string, @Body() body: unknown) {
    return this.lab.enrollTag(req.user, stationId, body);
  }
  @Post('rfid-tags/:tagId/revoke')
  revokeTag(@Req() req: AuthRequest, @Param('stationId') stationId: string, @Param('tagId') tagId: string) {
    return this.lab.revokeTag(req.user, stationId, tagId);
  }
}

@Controller('devices/:deviceId')
export class LabMaqueteDeviceController {
  constructor(private readonly lab: LabMaqueteService) {}
  private authorize(deviceId: string, req: { headers: Record<string, unknown> }) {
    return this.lab.authenticate(deviceId, req.headers['x-device-token']);
  }
  @Post('energy/connect')
  @HttpCode(200)
  async energyConnect(@Param('deviceId') id: string, @Req() req: {headers:Record<string,unknown>}, @Body() body:unknown) {
    return this.lab.openEnergyStream(await this.authorize(id,req),body);
  }
  @Get('energy/snapshot')
  @Header('Cache-Control','no-store')
  async energySnapshot(@Param('deviceId') id:string, @Req() req:{headers:Record<string,unknown>}, @Query('channelId') channel:string) {
    return this.lab.energyFrame(await this.authorize(id,req),channel);
  }
  @Post('energy/report')
  @HttpCode(200)
  async energyReport(@Param('deviceId') id:string, @Req() req:{headers:Record<string,unknown>}, @Body() body:unknown) {
    return this.lab.energyReport(await this.authorize(id,req),body);
  }
  @Get('commands/next')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async next(@Param('deviceId') deviceId: string, @Req() req: { headers: Record<string, unknown> }, @Res({ passthrough: true }) response: Response) {
    const config = await this.authorize(deviceId, req);
    const command = await this.lab.next(config);
    if (!command) { response.status(204); return; }
    return command;
  }
  @Post('commands/ack')
  @HttpCode(200)
  async ack(@Param('deviceId') deviceId: string, @Req() req: { headers: Record<string, unknown> }, @Body() body: unknown) {
    return this.lab.ack(await this.authorize(deviceId, req), body);
  }
  @Post('heartbeat')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @HttpCode(200)
  async heartbeat(@Param('deviceId') deviceId: string, @Req() req: { headers: Record<string, unknown> }, @Body() body: unknown) {
    return this.lab.heartbeat(await this.authorize(deviceId, req), body);
  }
  @Post('rfid')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @HttpCode(200)
  async rfid(@Param('deviceId') deviceId: string, @Req() req: { headers: Record<string, unknown> }, @Body() body: unknown) {
    return this.lab.rfid(await this.authorize(deviceId, req), body);
  }
}
