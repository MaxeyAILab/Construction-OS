import type { ZodType } from "zod";

// ai-spec.md §6: "tools are declared wrappers over application-layer
// use-cases: {name, description, params_schema (zod→JSON-schema),
// permission_key, consequence_class, module}."
export type AiToolConsequenceClass = "read" | "draft" | "act" | "restricted";

export interface AiToolContext {
  tenantId: string;
  actorId: string;
}

export interface AiTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  permissionKey: string;
  consequenceClass: AiToolConsequenceClass;
  module: string;
  execute(ctx: AiToolContext, input: TInput): Promise<TOutput>;
}
