import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

// CLAUDE.md: zod schemas in packages/schemas are the single source of truth
// for validation, shared by client and server — no duplicate (e.g.
// class-validator DTO) validation logic.
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return result.data;
  }
}
