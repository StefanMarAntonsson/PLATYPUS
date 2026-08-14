import type { ArtworkReference, IsoDate, MediaKind, MediaLifecycle } from "../domain/contracts.js";

export const SOURCE_TEMPLATE_SCHEMA_VERSION = 1 as const;

export type SourceOperation =
  | "search"
  | "details"
  | "seasons"
  | "episodes"
  | "external_ids"
  | "images"
  | "release_dates"
  | "availability"
  | "history";
export type CapabilityState = "unsupported" | "configured" | "verified" | "degraded" | "failing";

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type ValidationResult<T> =
  | { valid: true; value: T; warnings: ValidationIssue[] }
  | { valid: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

export interface CapabilityStatus {
  operation: SourceOperation;
  declared: boolean;
  state: CapabilityState;
  lastTestedAt?: string;
  lastSuccessfulAt?: string;
  lastError?: ValidationIssue;
  authenticationValid?: boolean;
}

/** Local connection state is never serialized into a portable source template. */
export interface SourceConnection {
  id: string;
  templateId: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  settings: Record<string, string | number | boolean>;
  secretReferences: Record<string, string>;
  capabilities: Partial<Record<SourceOperation, CapabilityStatus>>;
  tracking: TrackingConnectionState;
  createdAt: string;
  updatedAt: string;
}

export type TrackingMode = "import_only" | "export_only" | "bidirectional";

export interface TrackingAuditEntry {
  at: string;
  direction: "import" | "export";
  outcome: "success" | "partial" | "failed";
  processed: number;
  message?: string;
}

/** Durable, non-secret state for a connection's watch-history synchronization. */
export interface TrackingConnectionState {
  mode: TrackingMode;
  cursor?: string;
  lastImportedAt?: string;
  lastExportedAt?: string;
  audit: TrackingAuditEntry[];
}

export interface NormalizedMedia {
  providerId: string;
  kind: MediaKind;
  title: string;
  titleEnglish?: string;
  titleRomaji?: string;
  titleNative?: string;
  originalTitle?: string;
  overview?: string;
  originalLanguage?: string;
  releaseDate?: IsoDate;
  startDate?: IsoDate;
  endDate?: IsoDate;
  runtimeMinutes?: number;
  lifecycle?: MediaLifecycle;
  genres?: string[];
  artwork?: ArtworkReference[];
  canonicalUrl?: string;
  externalIds?: Record<string, string>;
}

export interface SourceTemplateV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  baseUrl: string;
  allowedHosts: string[];
  assetHosts?: string[];
  attribution?: { name: string; url?: string; license?: string };
  authentication: SourceAuthentication;
  operations: Partial<Record<SourceOperation, SourceOperationTemplate>>;
  cache?: { defaultTtlSeconds: number };
}

export type SourceAuthentication =
  | { type: "none" }
  | { type: "apiKey"; secretName: string; location: "header" | "query"; parameter: string }
  | { type: "bearer"; secretName: string }
  | { type: "basic"; usernameSecretName: string; passwordSecretName: string };

export interface SourceOperationTemplate {
  request: RestRequestTemplate | GraphqlRequestTemplate;
  response: {
    resultsPath?: string;
    mapping: Record<string, string>;
    schema?: Record<string, unknown>;
  };
  pagination?:
    | {
        type: "page";
        parameter: string;
        start?: number;
        totalPagesPath?: string;
        hasNextPath?: string;
      }
    | { type: "cursor"; parameter: string; nextCursorPath: string };
  timeoutMs?: number;
  retry?: { maxAttempts: number; backoffMs: number; retryStatuses?: number[] };
}

export interface RestRequestTemplate {
  protocol: "rest";
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface GraphqlRequestTemplate {
  protocol: "graphql";
  method: "POST";
  path: string;
  query: string;
  variables?: Record<string, unknown>;
  headers?: Record<string, string>;
}
