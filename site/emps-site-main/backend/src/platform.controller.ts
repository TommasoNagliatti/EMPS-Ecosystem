import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthRequest, JwtGuard } from './auth';
import { PlatformStationsService } from './platform-stations.service';
import { StationMembersService } from './station-members.service';
import { InviteAcceptDto, MemberDto, MemberRoleDto, ReviewDto, StationDraftDto } from './platform.dtos';

@Controller('v2') @UseGuards(JwtGuard)
export class PlatformController {
  constructor(private stations:PlatformStationsService,private members:StationMembersService){}
  @Get('chargers') chargers(@Req() r:AuthRequest){return this.stations.chargers(r.user)}
  @Post('chargers/:id/qr') chargerQr(@Req() r:AuthRequest,@Param('id') id:string){return this.stations.chargerQr(r.user,id)}
  @Get('stations') list(@Req() r:AuthRequest){return this.stations.list(r.user)}
  @Post('stations') create(@Req() r:AuthRequest){return this.stations.create(r.user)}
  @Get('stations/:id') get(@Req() r:AuthRequest,@Param('id') id:string){return this.stations.get(r.user,id)}
  @Patch('stations/:id') save(@Req() r:AuthRequest,@Param('id') id:string,@Body() dto:StationDraftDto){return this.stations.save(r.user,id,dto)}
  @Post('stations/:id/submit') submit(@Req() r:AuthRequest,@Param('id') id:string){return this.stations.submit(r.user,id)}
  @Get('reviews') reviews(@Req() r:AuthRequest){return this.stations.reviews(r.user)}
  @Post('reviews/:id') review(@Req() r:AuthRequest,@Param('id') id:string,@Body() dto:ReviewDto){return this.stations.review(r.user,id,dto)}
  @Get('stations/:id/members') listMembers(@Req() r:AuthRequest,@Param('id') id:string){return this.members.list(r.user,id)}
  @Post('stations/:id/members') invite(@Req() r:AuthRequest,@Param('id') id:string,@Body() dto:MemberDto){return this.members.invite(r.user,id,dto)}
  @Patch('stations/:id/members/:memberId') role(@Req() r:AuthRequest,@Param('id') id:string,@Param('memberId') memberId:string,@Body() dto:MemberRoleDto){return this.members.change(r.user,id,memberId,dto)}
  @Delete('stations/:id/members/:memberId') remove(@Req() r:AuthRequest,@Param('id') id:string,@Param('memberId') memberId:string){return this.members.change(r.user,id,memberId,null)}
  @Post('invites/accept') accept(@Req() r:AuthRequest,@Body() dto:InviteAcceptDto){return this.members.accept(r.user,dto.token)}
}
