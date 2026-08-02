import "./infrastructure/observability/tracing";
import "reflect-metadata";
import formbody from "@fastify/formbody";
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

  // bodyParser: false — Nest's own FastifyAdapter otherwise registers its
  // default json/urlencoded content-type parsers during app.init(), which
  // collides with @fastify/formbody's urlencoded parser below
  // (FST_ERR_CTP_ALREADY_PRESENT). Fastify parses application/json out of
  // the box regardless, so JSON bodies are unaffected.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ loggerInstance: createLogger(env.LOG_LEVEL) }),
    { bodyParser: false },
  );

  // Runs before every other hook/guard/handler — establishes the
  // trace-correlated async-local-storage context (request-context.ts) that
  // downstream logging and AccessTokenGuard's tenant/user attribution rely
  // on for the rest of the request's async chain.
  app.getHttpAdapter().getInstance().addHook("onRequest", async () => {
    beginRequestContext();
  });

  await app.register(helmet);
  // api.md §2.1: the SAML ACS endpoint receives an
  // application/x-www-form-urlencoded POST (SAMLResponse + RelayState) per
  // the HTTP-POST binding — Fastify only parses JSON out of the box.
  await app.register(formbody);
  // @fastify/cors's default Access-Control-Allow-Methods (GET,HEAD,POST)
  // fails every PATCH/PUT/DELETE preflight from a browser — this API uses
  // all five verbs (e.g. PATCH /projects/{id}, PUT /custom-fields/values).
  app.enableCors({ methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] });

  // api.md: Base URL is path-versioned (/v1); every response follows the
  // { data } / { error } envelope (§1.2, §1.8).
  app.setGlobalPrefix("v1");
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(env.PORT, "0.0.0.0");
}

void bootstrap();
