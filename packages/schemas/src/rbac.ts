import { z } from "zod";
import { uuidSchema } from "./common";

export const createRoleSchema = z.object({
  name: z.string().min(1),
});

export const grantPermissionSchema = z.object({
  permissionKey: z.string().min(1),
});

export const inviteUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
});

export const assignRoleSchema = z.object({
  userId: uuidSchema,
  roleId: uuidSchema,
  scopeType: z.enum(["company", "project"]),
  projectId: uuidSchema.optional(),
});
