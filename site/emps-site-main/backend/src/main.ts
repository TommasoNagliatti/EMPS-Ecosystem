import { PrismaClient } from '@prisma/client';
import { initializeOfficialDemoRuntime } from './official-demo-runtime';
import { ApiInterceptor } from "./api.interceptor";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { parseRealtimeCorsOrigins } from "./realtime.helpers";
import { assertRemoteConfiguration, remoteDevelopment } from './remote-development';
import {chargeLifecycleStationIds} from './charge-lifecycle';

async function bootstrap() {
  assertRemoteConfiguration();
  chargeLifecycleStationIds();
  if (process.env.EMPS_OFFICIAL_DEMO_RUNTIME && process.env.EMPS_OFFICIAL_DEMO_RUNTIME !== 'OFF') {
    const admission = new PrismaClient();
    try { await initializeOfficialDemoRuntime(admission); } finally { await admission.$disconnect(); }
  }
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const allowedOrigins = parseRealtimeCorsOrigins(
    process.env.CORS_ORIGINS ?? process.env.FRONTEND_URL,
  );

  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.enableCors({
    credentials: true,
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) {
      const isDevelopmentTunnel =
        process.env.NODE_ENV !== "production" && !remoteDevelopment() &&
        typeof origin === "string" &&
        /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(origin);

      if (!origin || allowedOrigins.includes(origin) || isDevelopmentTunnel) {
        return callback(null, true);
      }
      return callback(new Error("Origem não autorizada pela API EMPS"), false);
    },
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.useGlobalInterceptors(new ApiInterceptor());
  app.enableShutdownHooks();
  const host = remoteDevelopment() ? '127.0.0.1' : process.env.HOST ?? '0.0.0.0';
  await app.listen(Number(process.env.PORT ?? 3001), host);
}
void bootstrap();
