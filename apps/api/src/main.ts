import "./infrastructure/observability/tracing";
import "reflect-metadata";
import helmet from "@fastify/helmet";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";
import { createLogger } from "./infrastructure/observability/logger";
import { beginRequestContext } from "./infrastructure/observability/request-context";
import { HttpExceptionFilter } from "./platform/http-exception.filter";
import { ResponseEnvelopeInterceptor } from "./platform/response-envelope.interceptor";

async function bootstrap() {
  const env = loadEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ loggerInstance: createLogger(env.LOG_LEVEL) }),
  );

  // Runs before every other hook/guard/handler — establishes the
  // trace-correlated async-local-storage context (request-context.ts) that
  // downstream logging and AccessTokenGuard's tenant/user attribution rely
  // on for the rest of the request's async chain.
  app.getHttpAdapter().getInstance().addHook("onRequest", async () => {
    beginRequestContext();
  });

  await app.register(helmet);
  app.enableCors();

  // api.md: Base URL is path-versioned (/v1); every response follows the
  // { data } / { error } envelope (§1.2, §1.8).
  app.setGlobalPrefix("v1");
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(env.PORT, "0.0.0.0");
}

void bootstrap();
