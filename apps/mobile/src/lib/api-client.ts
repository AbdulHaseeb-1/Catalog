import { VerificationApiClient } from "@verifybridge/verification-sdk";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export const apiClient = new VerificationApiClient({ baseUrl: apiUrl });
