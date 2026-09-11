import { VerificationApiClient } from "@verifybridge/verification-sdk";

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

export const apiClient = new VerificationApiClient({ baseUrl: apiUrl });
