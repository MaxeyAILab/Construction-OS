import "reflect-metadata";
import helmet from "@fastify/helmet";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";
import { HttpExceptionFilter } from "./platform/http-exception.filter";
import { ResponseEnvelopeInterceptor } from "./platform/response-envelope.interceptor";

async function bootstrap() {
  const env = loadEnv();

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

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
