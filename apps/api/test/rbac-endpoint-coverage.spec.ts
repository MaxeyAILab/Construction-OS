import "reflect-metadata";
import { PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { AuthController } from "../src/modules/auth/api/auth.controller";
import { RbacController } from "../src/modules/rbac/api/rbac.controller";
import { HealthController } from "../src/platform/health/health.controller";
import { IS_AUTHENTICATED_ONLY_KEY } from "../src/platform/decorators/authenticated.decorator";
import { IS_PUBLIC_KEY } from "../src/platform/decorators/public.decorator";
import { REQUIRED_PERMISSION_KEY } from "../src/modules/rbac/api/require-permission.decorator";

// Roadmap Phase 1A success metric for the RBAC row: "100% endpoints
// permission-gated (CI check)". Statically scans every controller's route
// handlers and asserts each declares exactly one of @Public(),
// @Authenticated(), or @RequirePermission(key) — PermissionGuard denies by
// default at runtime too (FR-RBAC-1), but this catches a missing marker at
// PR time instead of via a manual probe.
const controllers = [HealthController, AuthController, RbacController];

describe("every endpoint declares exactly one access marker", () => {
  for (const ControllerClass of controllers) {
    const prototype = ControllerClass.prototype as Record<string, unknown>;
    const methodNames = Object.getOwnPropertyNames(prototype).filter(
      (name) => name !== "constructor",
    );

    for (const methodName of methodNames) {
      const handler = prototype[methodName];
      const isRouteHandler =
        typeof handler === "function" && Reflect.hasMetadata(PATH_METADATA, handler);
      if (!isRouteHandler) continue;

      it(`${ControllerClass.name}.${methodName}`, () => {
        const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler as object);
        const isAuthenticatedOnly = Reflect.getMetadata(
          IS_AUTHENTICATED_ONLY_KEY,
          handler as object,
        );
        const requiredPermission = Reflect.getMetadata(REQUIRED_PERMISSION_KEY, handler as object);

        const markers = [isPublic, isAuthenticatedOnly, requiredPermission].filter(
          (v) => v !== undefined,
        );
        expect(
          markers.length,
          `expected exactly one of @Public()/@Authenticated()/@RequirePermission() on ` +
            `${ControllerClass.name}.${methodName}, found ${markers.length}`,
        ).toBe(1);
      });
    }
  }
});
