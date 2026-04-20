import { AppError } from "../errors/appError";
import type { Logger } from "../logging/logger";
import type { SharpAuthToken, SharpOAuthToken } from "../sharp/sharpContext";

interface FhirR4ClientConfig {
  timeoutMs: number;
  pageSize: number;
  maxPages: number;
  defaultTokenEndpoint?: string;
  logger: Logger;
}

type FhirResource = Record<string, unknown>;

interface AuthState {
  token: SharpOAuthToken;
  canRefresh: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/$/, "");
}

function isExpired(expiresAt?: string): boolean {
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }

  return Date.now() + 60_000 >= expiresAtMs;
}

function sanitizeTokenForMemory(token: SharpOAuthToken): SharpOAuthToken {
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    tokenEndpoint: token.tokenEndpoint,
    clientId: token.clientId,
    clientSecret: token.clientSecret,
    scope: token.scope,
    tokenType: token.tokenType,
  };
}

/**
 * FHIR R4 client supporting pagination, OAuth refresh, and timeout-safe requests.
 */
export class FhirR4Client {
  private readonly tokenCache = new Map<string, SharpOAuthToken>();

  public constructor(private readonly config: FhirR4ClientConfig) {}

  /**
   * Fetches active MedicationRequest resources for a patient.
   */
  public async fetchPatientMedications(
    patientId: string,
    fhirEndpoint: string,
    authToken: SharpAuthToken,
  ): Promise<FhirResource[]> {
    const query = {
      patient: patientId,
      status: "active",
      _count: String(this.config.pageSize),
    };

    const resources = await this.fetchPagedResources(
      "MedicationRequest",
      patientId,
      fhirEndpoint,
      authToken,
      query,
    );

    return resources.filter((resource) => {
      const statusRaw = resource["status"];
      return typeof statusRaw === "string"
        ? statusRaw.toLowerCase() === "active"
        : true;
    });
  }

  /**
   * Fetches AllergyIntolerance resources for a patient.
   */
  public async fetchPatientAllergies(
    patientId: string,
    fhirEndpoint: string,
    authToken: SharpAuthToken,
  ): Promise<FhirResource[]> {
    const query = {
      patient: patientId,
      _count: String(this.config.pageSize),
    };

    return this.fetchPagedResources(
      "AllergyIntolerance",
      patientId,
      fhirEndpoint,
      authToken,
      query,
    );
  }

  /**
   * Fetches active/relevant Condition resources for a patient.
   */
  public async fetchPatientConditions(
    patientId: string,
    fhirEndpoint: string,
    authToken: SharpAuthToken,
  ): Promise<FhirResource[]> {
    const query = {
      patient: patientId,
      "clinical-status": "active",
      category: "problem-list-item",
      _count: String(this.config.pageSize),
    };

    const resources = await this.fetchPagedResources(
      "Condition",
      patientId,
      fhirEndpoint,
      authToken,
      query,
    );

    return resources.filter((resource) => {
      const clinicalStatus = asRecord(resource["clinicalStatus"]);
      const coding = asArray(clinicalStatus?.["coding"])
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null);

      if (coding.length === 0) {
        return true;
      }

      return coding.some((entry) => {
        const code = entry["code"];
        return typeof code === "string"
          ? ["active", "recurrence", "relapse"].includes(code.toLowerCase())
          : false;
      });
    });
  }

  private async fetchPagedResources(
    resourceType: string,
    patientId: string,
    fhirEndpoint: string,
    authToken: SharpAuthToken,
    query: Record<string, string>,
  ): Promise<FhirResource[]> {
    const endpoint = normalizeEndpoint(fhirEndpoint);
    const endpointHost = this.safeHost(endpoint);

    const authState = await this.initializeAuthState(endpoint, authToken);
    let nextUrl: string | null = this.buildInitialSearchUrl(
      endpoint,
      resourceType,
      query,
    );
    const resources: FhirResource[] = [];

    let page = 0;
    while (nextUrl && page < this.config.maxPages) {
      page += 1;
      const bundle = await this.requestBundle(nextUrl, endpoint, authState);

      const pageResources = this.extractResources(bundle, resourceType);
      resources.push(...pageResources);

      this.config.logger.info("FHIR page fetched", {
        component: "fhir-r4-client",
        resourceType,
        page,
        pageResourceCount: pageResources.length,
        totalResourceCount: resources.length,
        endpointHost,
        hasAuthRefresh: authState.canRefresh,
      });

      nextUrl = this.extractNextUrl(bundle, endpoint);
    }

    if (page >= this.config.maxPages && nextUrl) {
      this.config.logger.warn("FHIR pagination stopped at max page limit", {
        component: "fhir-r4-client",
        resourceType,
        maxPages: this.config.maxPages,
        endpointHost,
      });
    }

    this.config.logger.info("FHIR resource fetch completed", {
      component: "fhir-r4-client",
      resourceType,
      totalResourceCount: resources.length,
      endpointHost,
      patientReferencePresent: Boolean(patientId),
    });

    return resources;
  }

  private async initializeAuthState(
    endpoint: string,
    authToken: SharpAuthToken,
  ): Promise<AuthState> {
    if (typeof authToken === "string") {
      return {
        token: {
          accessToken: authToken,
          tokenType: "Bearer",
        },
        canRefresh: false,
      };
    }

    const cacheKey = endpoint;
    const cached = this.tokenCache.get(cacheKey);
    const selected = cached ?? authToken;
    let token = sanitizeTokenForMemory(selected);

    if (isExpired(token.expiresAt)) {
      token = await this.refreshToken(token, endpoint);
      this.tokenCache.set(cacheKey, sanitizeTokenForMemory(token));
    }

    return {
      token,
      canRefresh: Boolean(
        token.refreshToken &&
        (token.tokenEndpoint || this.config.defaultTokenEndpoint),
      ),
    };
  }

  private async requestBundle(
    url: string,
    endpoint: string,
    authState: AuthState,
  ): Promise<Record<string, unknown>> {
    const response = await this.performAuthenticatedRequest(
      url,
      authState.token.accessToken,
    );

    if (response.status === 401 && authState.canRefresh) {
      authState.token = await this.refreshToken(authState.token, endpoint);
      this.tokenCache.set(endpoint, sanitizeTokenForMemory(authState.token));

      const retry = await this.performAuthenticatedRequest(
        url,
        authState.token.accessToken,
      );
      return this.parseBundleResponse(retry);
    }

    return this.parseBundleResponse(response);
  }

  private async performAuthenticatedRequest(
    url: string,
    accessToken: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    try {
      return await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/fhir+json, application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("FHIR request timed out.", "FHIR_TIMEOUT", {
          timeoutMs: this.config.timeoutMs,
        });
      }

      throw new AppError("FHIR request failed.", "FHIR_API_ERROR", {
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async refreshToken(
    token: SharpOAuthToken,
    endpoint: string,
  ): Promise<SharpOAuthToken> {
    if (!token.refreshToken) {
      throw new AppError(
        "OAuth refresh token is not available.",
        "FHIR_AUTH_REFRESH_ERROR",
      );
    }

    const tokenEndpoint =
      token.tokenEndpoint ?? this.config.defaultTokenEndpoint;
    if (!tokenEndpoint) {
      throw new AppError(
        "OAuth token endpoint is not configured for refresh.",
        "FHIR_AUTH_REFRESH_ERROR",
      );
    }

    const params = new URLSearchParams();
    params.set("grant_type", "refresh_token");
    params.set("refresh_token", token.refreshToken);

    if (token.clientId) {
      params.set("client_id", token.clientId);
    }

    if (token.clientSecret) {
      params.set("client_secret", token.clientSecret);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    try {
      const response = await fetch(tokenEndpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        throw new AppError(
          "OAuth refresh request failed.",
          "FHIR_AUTH_REFRESH_ERROR",
          {
            status: response.status,
            endpointHost: this.safeHost(endpoint),
          },
        );
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const accessTokenRaw = payload["access_token"];
      const refreshTokenRaw = payload["refresh_token"];
      const expiresInRaw = payload["expires_in"];
      const scopeRaw = payload["scope"];
      const tokenTypeRaw = payload["token_type"];

      if (typeof accessTokenRaw !== "string" || !accessTokenRaw.trim()) {
        throw new AppError(
          "OAuth refresh payload did not include access_token.",
          "FHIR_AUTH_REFRESH_ERROR",
        );
      }

      let expiresAt = token.expiresAt;
      if (typeof expiresInRaw === "number" && Number.isFinite(expiresInRaw)) {
        expiresAt = new Date(Date.now() + expiresInRaw * 1000).toISOString();
      }

      return {
        accessToken: accessTokenRaw,
        refreshToken:
          typeof refreshTokenRaw === "string"
            ? refreshTokenRaw
            : token.refreshToken,
        expiresAt,
        tokenEndpoint,
        clientId: token.clientId,
        clientSecret: token.clientSecret,
        scope: typeof scopeRaw === "string" ? scopeRaw : token.scope,
        tokenType:
          typeof tokenTypeRaw === "string" ? tokenTypeRaw : token.tokenType,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError(
          "OAuth refresh request timed out.",
          "FHIR_AUTH_REFRESH_ERROR",
          {
            timeoutMs: this.config.timeoutMs,
            endpointHost: this.safeHost(endpoint),
          },
        );
      }

      throw new AppError(
        "OAuth refresh request failed.",
        "FHIR_AUTH_REFRESH_ERROR",
        {
          cause: error instanceof Error ? error.message : String(error),
          endpointHost: this.safeHost(endpoint),
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseBundleResponse(
    response: Response,
  ): Promise<Record<string, unknown>> {
    if (!response.ok) {
      throw new AppError(
        `FHIR request failed: ${response.status} ${response.statusText}`,
        "FHIR_API_ERROR",
        {
          status: response.status,
        },
      );
    }

    try {
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      throw new AppError(
        "Unable to parse FHIR JSON response.",
        "FHIR_PARSE_ERROR",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private buildInitialSearchUrl(
    endpoint: string,
    resourceType: string,
    query: Record<string, string>,
  ): string {
    const url = new URL(`${endpoint}/${resourceType}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  }

  private extractResources(
    bundle: Record<string, unknown>,
    resourceType: string,
  ): FhirResource[] {
    const entries = asArray(bundle["entry"])
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null);

    return entries
      .map((entry) => asRecord(entry["resource"]))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .filter((resource) => {
        const typeRaw = resource["resourceType"];
        return typeof typeRaw === "string" ? typeRaw === resourceType : false;
      });
  }

  private extractNextUrl(
    bundle: Record<string, unknown>,
    endpoint: string,
  ): string | null {
    const links = asArray(bundle["link"])
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null);

    const next = links.find((link) => {
      const relation = link["relation"];
      return typeof relation === "string" ? relation === "next" : false;
    });

    if (!next) {
      return null;
    }

    const urlRaw = next["url"];
    if (typeof urlRaw !== "string" || !urlRaw.trim()) {
      return null;
    }

    if (/^https?:\/\//i.test(urlRaw)) {
      return urlRaw;
    }

    return new URL(urlRaw, endpoint).toString();
  }

  private safeHost(endpoint: string): string {
    try {
      return new URL(endpoint).host;
    } catch {
      return "unknown-host";
    }
  }
}
