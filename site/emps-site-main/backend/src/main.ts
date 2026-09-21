import { ApiInterceptor } from "./api.interceptor";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { parseRealtimeCorsOrigins } from "./realtime.helpers";

async function bootstrap() {
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
        process.env.NODE_ENV !== "production" &&
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
  await app.listen(Number(process.env.PORT ?? 3001));
}
void bootstrap();
