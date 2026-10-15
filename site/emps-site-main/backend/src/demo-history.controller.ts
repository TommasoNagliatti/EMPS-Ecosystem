import {Controller,Get,Param,Query,Req,UseGuards} from '@nestjs/common';
import type {AuthRequest} from './auth';
import {JwtGuard} from './auth';
import {DemoHistoryService} from './demo-history.service';

@UseGuards(JwtGuard)
@Controller('demo-history')
export class DemoHistoryController{
  constructor(private readonly history:DemoHistoryService){}

  @Get('network')
  network(@Req() request:AuthRequest,@Query() filters:{from?:string;to?:string;channel?:string;method?:string;stationId?:string}){
    return this.history.network(request.user,filters);
  }

  @Get('stations/:stationId')
  station(@Req() request:AuthRequest,@Param('stationId') stationId:string,
    @Query() filters:{from?:string;to?:string;channel?:string;method?:string}){
    return this.history.station(request.user,stationId,filters);
  }
}
