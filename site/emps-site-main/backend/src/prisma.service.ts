import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { protectRemoteClient, remoteDevelopment, verifyRemoteDatabase } from './remote-development';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    if (remoteDevelopment()) return protectRemoteClient(this);
  }
  async onModuleInit() {
    await this.$connect();
    if (remoteDevelopment()) await verifyRemoteDatabase(this as unknown as Parameters<typeof verifyRemoteDatabase>[0]);
  }
  async onModuleDestroy() { await this.$disconnect(); }
}
