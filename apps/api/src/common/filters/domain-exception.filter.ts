import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { Catch, HttpException } from "@nestjs/common";
import { ERROR_CODE_HTTP_STATUS, ERROR_CODES } from "@verifybridge/shared";
import type { Response } from "express";
import { PinoLogger } from "nestjs-pino";
import { DomainError } from "../../verification/errors.js";

/**
 * Maps our typed domain errors to `{ error: { code, message } }` responses.
 * Anything unexpected is logged (server-side only, never with request
 * bodies - see LoggerModule's redaction) and returned as a sanitized 500 so
 * internal details never leak to clients.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(DomainExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      const status = ERROR_CODE_HTTP_STATUS[exception.code];
      response.status(status).json({ error: { code: exception.code, message: exception.message } });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message = typeof body === "string" ? body : ((body as { message?: string }).message ?? exception.message);
      response.status(status).json({ error: { code: ERROR_CODES.VALIDATION_ERROR, message } });
      return;
    }

    this.logger.error({ err: exception }, "Unhandled exception");
    response
      .status(500)
      .json({ error: { code: ERROR_CODES.INTERNAL_ERROR, message: "An unexpected error occurred." } });
  }
}
