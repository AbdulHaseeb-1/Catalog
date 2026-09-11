import { InvalidVerificationTokenError } from "../../verification/errors.js";

export function extractBearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new InvalidVerificationTokenError();
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) throw new InvalidVerificationTokenError();
  return token;
}
