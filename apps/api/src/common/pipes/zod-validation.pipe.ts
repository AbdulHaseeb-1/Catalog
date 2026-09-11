import type { PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";
import { ValidationFailedError } from "../../verification/errors.js";

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const message = result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new ValidationFailedError(message);
    }
    return result.data;
  }
}
