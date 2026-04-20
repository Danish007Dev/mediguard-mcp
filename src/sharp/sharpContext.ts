import { z } from "zod";

export interface SharpOAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  tokenType?: string;
}

export type SharpAuthToken = string | SharpOAuthToken;

export interface SharpContext {
  patientId: string;
  fhirEndpoint: string;
  authToken: SharpAuthToken;
  workflowId?: string;
  encounterId?: string;
}

export const sharpOAuthTokenSchema = z
  .object({
    access_token: z.string().trim().min(1),
    refresh_token: z.string().trim().min(1).optional(),
    expires_at: z.string().trim().min(1).optional(),
    token_endpoint: z.string().url().optional(),
    client_id: z.string().trim().min(1).optional(),
    client_secret: z.string().trim().min(1).optional(),
    scope: z.string().trim().min(1).optional(),
    token_type: z.string().trim().min(1).optional(),
  })
  .passthrough();

export const sharpContextSchema = z
  .object({
    patient_id: z.string().trim().min(1),
    fhir_endpoint: z.string().url(),
    auth_token: z.union([z.string().trim().min(1), sharpOAuthTokenSchema]),
    workflow_id: z.string().trim().min(1).optional(),
    encounter_id: z.string().trim().min(1).optional(),
  })
  .passthrough();

export type SharpContextInput = z.infer<typeof sharpContextSchema>;

/**
 * Maps SHARP wire-format input into normalized internal context shape.
 */
export function toSharpContext(input: SharpContextInput): SharpContext {
  const authToken =
    typeof input.auth_token === "string"
      ? input.auth_token
      : {
          accessToken: input.auth_token.access_token,
          refreshToken: input.auth_token.refresh_token,
          expiresAt: input.auth_token.expires_at,
          tokenEndpoint: input.auth_token.token_endpoint,
          clientId: input.auth_token.client_id,
          clientSecret: input.auth_token.client_secret,
          scope: input.auth_token.scope,
          tokenType: input.auth_token.token_type,
        };

  return {
    patientId: input.patient_id,
    fhirEndpoint: input.fhir_endpoint,
    authToken,
    workflowId: input.workflow_id,
    encounterId: input.encounter_id,
  };
}

/**
 * Returns a defensive deep clone suitable for downstream propagation.
 */
export function cloneSharpContext(context: SharpContext): SharpContext {
  const clonedAuthToken =
    typeof context.authToken === "string"
      ? context.authToken
      : {
          accessToken: context.authToken.accessToken,
          refreshToken: context.authToken.refreshToken,
          expiresAt: context.authToken.expiresAt,
          tokenEndpoint: context.authToken.tokenEndpoint,
          clientId: context.authToken.clientId,
          clientSecret: context.authToken.clientSecret,
          scope: context.authToken.scope,
          tokenType: context.authToken.tokenType,
        };

  return {
    patientId: context.patientId,
    fhirEndpoint: context.fhirEndpoint,
    authToken: clonedAuthToken,
    workflowId: context.workflowId,
    encounterId: context.encounterId,
  };
}
