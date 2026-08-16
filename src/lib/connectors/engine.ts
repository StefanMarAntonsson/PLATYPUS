import Ajv2020 from "ajv/dist/2020.js";
import { invoke } from "@tauri-apps/api/core";
import schema from "./source-template.schema.json";
import type {
  CapabilityStatus,
  NormalizedMedia,
  SourceConnection,
  SourceOperation,
  SourceOperationTemplate,
  SourceTemplateV1,
  ValidationIssue,
  ValidationResult,
} from "./contracts.js";

const MAX_RESULTS = 200;
const MAX_PAGES = 20;
const PATH = /^\$(?:\.[A-Za-z_$][\w$]*|\[\d+\]|\[\*\])*$/;
const validator = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
}).compile<SourceTemplateV1>(schema);

export interface ConnectorRequest {
  input?: Record<string, unknown>;
  signal?: AbortSignal;
}

/** Secret values are deliberately resolved at execution time and never stored in a template or connection. */
export type SecretResolver = (reference: string) => Promise<string | undefined>;
export type ConnectorFetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface ConnectorEngineOptions {
  fetch?: ConnectorFetcher;
  resolveSecret?: SecretResolver;
  now?: () => number;
}

/**
 * A request failure that applies to the connection rather than one media item.
 * Bulk jobs use this signal to stop contacting an unhealthy provider.
 */
export class ConnectorRequestError extends Error {
  constructor(
    message: string,
    readonly connectionUnavailable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ConnectorRequestError";
  }
}

export function isConnectorUnavailableError(error: unknown): boolean {
  return error instanceof ConnectorRequestError && error.connectionUnavailable;
}

function statusMakesConnectionUnavailable(status: number): boolean {
  return [401, 403, 408, 425, 429].includes(status) || status >= 500;
}

interface NativeConnectorResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ConnectorResponsePreview = Json;
interface CacheEntry {
  expiresAt: number;
  value: NormalizedMedia[];
}

function issues(errors: typeof validator.errors): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || "$",
    code: error.keyword,
    message: error.message ?? "Invalid value",
  }));
}

function expressions(template: SourceTemplateV1): string[] {
  return Object.values(template.operations).flatMap((operation) => {
    if (!operation) return [];
    return [
      operation.response.resultsPath,
      ...Object.values(operation.response.mapping),
      operation.pagination?.type === "page" ? operation.pagination.totalPagesPath : undefined,
      operation.pagination?.type === "page" ? operation.pagination.hasNextPath : undefined,
      operation.pagination?.type === "cursor" ? operation.pagination.nextCursorPath : undefined,
    ].filter((value): value is string => value !== undefined);
  });
}

export function validateSourceTemplate(value: unknown): ValidationResult<SourceTemplateV1> {
  if (!validator(value)) return { valid: false, errors: issues(validator.errors), warnings: [] };
  if (!value.allowedHosts.includes(new URL(value.baseUrl).hostname))
    return {
      valid: false,
      errors: [
        {
          path: "$.allowedHosts",
          code: "base_host_not_allowed",
          message: "allowedHosts must include the base URL host",
        },
      ],
      warnings: [],
    };
  const invalid = expressions(value).filter((expression) => !PATH.test(expression));
  if (invalid.length)
    return {
      valid: false,
      errors: invalid.map((expression) => ({
        path: "$.operations",
        code: "unsafe_path",
        message: `Unsupported mapping path: ${expression}`,
      })),
      warnings: [],
    };
  return { valid: true, value, warnings: [] };
}

function readPath(value: unknown, path: string): unknown {
  const tokens = path.slice(1).match(/\.[A-Za-z_$][\w$]*|\[\d+\]|\[\*\]/g) ?? [];
  let values: unknown[] = [value];
  for (const token of tokens) {
    values = values.flatMap((current) => {
      if (token === "[*]") return Array.isArray(current) ? current : [];
      const key = token.startsWith(".") ? token.slice(1) : Number(token.slice(1, -1));
      return current !== null && typeof current === "object" && key in current
        ? [(current as Record<string | number, unknown>)[key]]
        : [];
    });
  }
  return path.includes("[*]") ? values : values[0];
}

function interpolate(value: unknown, context: Record<string, Record<string, unknown>>): unknown {
  const text = (candidate: unknown): string =>
    typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean"
      ? String(candidate)
      : "";
  if (typeof value === "string")
    return value.replace(
      /\$\{(input|connection|secret|page)\.([A-Za-z][\w]*)\}/g,
      (_all, area: string, key: string) => text(context[area]?.[key]),
    );
  if (Array.isArray(value)) return value.map((item) => interpolate(item, context));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolate(item, context)]),
    );
  return value;
}

function mapMedia(
  item: unknown,
  operation: SourceOperationTemplate,
  assetHosts: string[] = [],
): NormalizedMedia {
  const mapped = Object.fromEntries(
    Object.entries(operation.response.mapping).map(([field, path]) => [
      field,
      readPath(item, path),
    ]),
  );
  const artwork = Object.entries(mapped).flatMap(([field, url]) => {
    if (!field.startsWith("artwork.") || typeof url !== "string") return [];
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && assetHosts.includes(parsed.hostname)
        ? [{ kind: field.slice(8), url }]
        : [];
    } catch {
      return [];
    }
  });
  const providerId =
    typeof mapped.providerId === "string" || typeof mapped.providerId === "number"
      ? String(mapped.providerId)
      : undefined;
  const title = mapped.title;
  const rawKind = typeof mapped.kind === "string" ? mapped.kind.trim().toLowerCase() : "";
  const kind =
    rawKind === "movie" || rawKind === "film"
      ? "movie"
      : [
            "series",
            "anime",
            "tv",
            "tv_short",
            "tv short",
            "tv special",
            "tv series",
            "show",
            "ova",
            "ona",
            "special",
            "music",
            "cm",
            "pv",
            "scripted",
            "animation",
            "reality",
            "documentary",
            "game show",
            "news",
            "sports",
            "variety",
            "talk show",
            "panel show",
            "award show",
          ].includes(rawKind)
        ? "series"
        : undefined;
  if (!providerId || typeof title !== "string" || !title || !kind) {
    throw new Error("Response mapping must produce providerId, title, and kind (movie or series)");
  }
  const rawLifecycle =
    typeof mapped.lifecycle === "string" ? mapped.lifecycle.trim().toLowerCase() : "";
  const lifecycle: NormalizedMedia["lifecycle"] = [
    "running",
    "releasing",
    "currently airing",
  ].includes(rawLifecycle)
    ? "releasing"
    : ["ended", "finished", "finished airing"].includes(rawLifecycle)
      ? "ended"
      : ["cancelled", "canceled"].includes(rawLifecycle)
        ? "cancelled"
        : ["in development", "in production"].includes(rawLifecycle)
          ? "in_production"
          : ["announced", "to be determined", "not yet aired", "not yet released"].includes(
                rawLifecycle,
              )
            ? "announced"
            : rawLifecycle
              ? "unknown"
              : undefined;
  return {
    providerId,
    title,
    kind,
    artwork: artwork.length ? (artwork as NormalizedMedia["artwork"]) : undefined,
    ...(lifecycle ? { lifecycle } : {}),
    ...Object.fromEntries(
      Object.entries(mapped).filter(
        ([field, fieldValue]) =>
          !["providerId", "title", "kind", "lifecycle"].includes(field) &&
          !field.startsWith("artwork.") &&
          fieldValue !== undefined,
      ),
    ),
  } as NormalizedMedia;
}

function mapRecord(item: unknown, operation: SourceOperationTemplate): Record<string, unknown> {
  if (item === null || typeof item !== "object") {
    throw new Error("Response mapping requires each result to be an object");
  }
  return Object.fromEntries(
    Object.entries(operation.response.mapping).map(([field, path]) => [
      field,
      readPath(item, path),
    ]),
  );
}

export class ConnectorEngine {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly fetcher: ConnectorFetcher;
  private readonly resolveSecret: SecretResolver;
  private readonly now: () => number;
  private readonly useNativeFetcher: boolean;

  constructor(options: ConnectorEngineOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.resolveSecret = options.resolveSecret ?? (async () => undefined);
    this.now = options.now ?? Date.now;
    this.useNativeFetcher = options.fetch === undefined;
  }

  async execute(
    template: SourceTemplateV1,
    connection: SourceConnection,
    operationName: SourceOperation,
    request: ConnectorRequest = {},
  ): Promise<NormalizedMedia[]> {
    const checked = validateSourceTemplate(template);
    if (!checked.valid) throw new Error(checked.errors.map((error) => error.message).join("; "));
    const operation = template.operations[operationName];
    if (!operation) throw new Error(`${template.name} does not support ${operationName}`);
    const cacheKey = JSON.stringify([connection.id, operationName, request.input]);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const secret = await this.authentication(template, connection);
    const collected: NormalizedMedia[] = [];
    let page: Record<string, unknown> = {
      number: operation.pagination?.type === "page" ? (operation.pagination.start ?? 1) : undefined,
      cursor: undefined,
    };
    for (let pageIndex = 0; pageIndex < MAX_PAGES && collected.length < MAX_RESULTS; pageIndex++) {
      const payload = await this.request(
        template,
        connection.baseUrl,
        operation,
        request.input ?? {},
        connection.settings,
        page,
        secret,
        request.signal,
      );
      if (operation.response.schema) {
        const responseValidator = new Ajv2020({ allErrors: true, strict: false }).compile(
          operation.response.schema,
        );
        if (!responseValidator(payload))
          throw new Error(
            `Response does not match declared schema: ${issues(responseValidator.errors)
              .map((error) => error.message)
              .join(", ")}`,
          );
      }
      const resultItems = operation.response.resultsPath
        ? readPath(payload, operation.response.resultsPath)
        : payload;
      const items = Array.isArray(resultItems) ? resultItems : [resultItems];
      collected.push(
        ...items
          .filter((item) => item !== undefined)
          .map((item) => mapMedia(item, operation, template.assetHosts ?? [])),
      );
      if (!operation.pagination) break;
      if (operation.pagination.type === "page") {
        const total = operation.pagination.totalPagesPath
          ? Number(readPath(payload, operation.pagination.totalPagesPath))
          : undefined;
        const hasNext = operation.pagination.hasNextPath
          ? readPath(payload, operation.pagination.hasNextPath) === true
          : undefined;
        if (hasNext !== true && !(Number.isFinite(total) && Number(page.number) < total!)) break;
        page = { number: Number(page.number) + 1 };
      } else {
        const cursor = readPath(payload, operation.pagination.nextCursorPath);
        if (typeof cursor !== "string" || !cursor) break;
        page = { cursor };
      }
    }
    const value = collected.slice(0, MAX_RESULTS);
    const ttl = (template.cache?.defaultTtlSeconds ?? 0) * 1000;
    if (ttl) this.cache.set(cacheKey, { value, expiresAt: this.now() + ttl });
    return value;
  }

  /**
   * Run exactly one operation request and return its unmodified JSON payload.
   * This is intentionally separate from execute(): the source builder needs to
   * show authors what their mapping is operating on, without following pages
   * or transforming the response.
   */
  async preview(
    template: SourceTemplateV1,
    connection: SourceConnection,
    operationName: SourceOperation,
    request: ConnectorRequest = {},
  ): Promise<ConnectorResponsePreview> {
    const checked = validateSourceTemplate(template);
    if (!checked.valid) throw new Error(checked.errors.map((error) => error.message).join("; "));
    const operation = template.operations[operationName];
    if (!operation) throw new Error(`${template.name} does not support ${operationName}`);
    const secret = await this.authentication(template, connection);
    return this.request(
      template,
      connection.baseUrl,
      operation,
      request.input ?? {},
      connection.settings,
      {
        number:
          operation.pagination?.type === "page" ? (operation.pagination.start ?? 1) : undefined,
      },
      secret,
      request.signal,
    );
  }

  /**
   * Execute a declarative operation that returns records other than media, such
   * as a connection's watch-history feed. Mapping remains path-only and has
   * the same host, authentication, retry, and redirect safeguards as search.
   */
  async executeRecords(
    template: SourceTemplateV1,
    connection: SourceConnection,
    operationName: SourceOperation,
    request: ConnectorRequest = {},
  ): Promise<Record<string, unknown>[]> {
    const checked = validateSourceTemplate(template);
    if (!checked.valid) throw new Error(checked.errors.map((error) => error.message).join("; "));
    const operation = template.operations[operationName];
    if (!operation) throw new Error(`${template.name} does not support ${operationName}`);
    const secret = await this.authentication(template, connection);
    const payload = await this.request(
      template,
      connection.baseUrl,
      operation,
      request.input ?? {},
      connection.settings,
      {
        number:
          operation.pagination?.type === "page" ? (operation.pagination.start ?? 1) : undefined,
      },
      secret,
      request.signal,
    );
    const resultItems = operation.response.resultsPath
      ? readPath(payload, operation.response.resultsPath)
      : payload;
    return (Array.isArray(resultItems) ? resultItems : [resultItems])
      .filter((item) => item !== undefined)
      .map((item) => mapRecord(item, operation));
  }

  capability(
    template: SourceTemplateV1,
    operation: SourceOperation,
    error?: unknown,
  ): CapabilityStatus {
    return {
      operation,
      declared: Boolean(template.operations[operation]),
      state: error ? "failing" : template.operations[operation] ? "verified" : "unsupported",
      lastTestedAt: new Date(this.now()).toISOString(),
      ...(error
        ? {
            lastError: {
              path: "$",
              code: "request_failed",
              message: error instanceof Error ? error.message : "Unknown connector error",
            },
          }
        : {}),
    };
  }

  private async authentication(
    template: SourceTemplateV1,
    connection: SourceConnection,
  ): Promise<Record<string, unknown>> {
    const auth = template.authentication;
    const get = async (name: string) => {
      const reference = connection.secretReferences[name];
      const value = reference ? await this.resolveSecret(reference) : undefined;
      if (!value) throw new Error(`Missing secret for ${name}`);
      return value;
    };
    if (auth.type === "none") return {};
    if (auth.type === "apiKey") return { [auth.secretName]: await get(auth.secretName) };
    if (auth.type === "bearer") return { [auth.secretName]: await get(auth.secretName) };
    return {
      [auth.usernameSecretName]: await get(auth.usernameSecretName),
      [auth.passwordSecretName]: await get(auth.passwordSecretName),
    };
  }

  private async request(
    template: SourceTemplateV1,
    baseUrl: string,
    operation: SourceOperationTemplate,
    input: Record<string, unknown>,
    settings: Record<string, string | number | boolean>,
    page: Record<string, unknown>,
    secret: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Json> {
    const context = { input, connection: settings, secret, page };
    const request = operation.request;
    const url = new URL(interpolate(request.path, context) as string, baseUrl);
    if (!template.allowedHosts.includes(url.hostname))
      throw new Error(`Request host is not approved: ${url.hostname}`);
    const headers = new Headers(
      interpolate(request.headers ?? {}, context) as Record<string, string>,
    );
    const query = new URLSearchParams(
      interpolate(request.protocol === "rest" ? (request.query ?? {}) : {}, context) as Record<
        string,
        string
      >,
    );
    if (request.protocol === "graphql") {
      headers.set("Content-Type", "application/json");
    }
    const auth = template.authentication;
    if (auth.type === "apiKey") {
      if (auth.location === "header") headers.set(auth.parameter, String(secret[auth.secretName]));
      else query.set(auth.parameter, String(secret[auth.secretName]));
    }
    if (auth.type === "bearer")
      headers.set("Authorization", `Bearer ${String(secret[auth.secretName])}`);
    if (auth.type === "basic")
      headers.set(
        "Authorization",
        `Basic ${btoa(`${String(secret[auth.usernameSecretName])}:${String(secret[auth.passwordSecretName])}`)}`,
      );
    url.search = query.toString();
    const body =
      request.protocol === "graphql"
        ? JSON.stringify({
            query: interpolate(request.query, context),
            variables: interpolate(request.variables ?? {}, context),
          })
        : request.method === "POST"
          ? JSON.stringify(interpolate(request.body, context))
          : undefined;
    const attempts = operation.retry?.maxAttempts ?? 1;
    let response: Response | undefined;
    for (let attempt = 0; attempt < attempts; attempt++) {
      // A source may only send a request (and therefore credentials) to a host
      // explicitly approved by its template.  Do not let fetch follow a server
      // redirect around that boundary.
      const timeoutMs = operation.timeoutMs ?? 30_000;
      const requestInit: RequestInit = {
        method: request.method,
        headers,
        body,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
        redirect: "manual",
      };
      try {
        if (this.useNativeFetcher) {
          const native = await invoke<NativeConnectorResponse>("connector_request", {
            url: url.toString(),
            method: request.method,
            headers: Object.fromEntries(headers.entries()),
            body,
            allowedHosts: template.allowedHosts,
            timeoutMs,
          });
          response = new Response(native.body, {
            status: native.status,
            headers: native.headers,
          });
        } else {
          response = await this.fetcher(url.toString(), requestInit);
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        const message =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "Source request failed (network)";
        throw new ConnectorRequestError(timedOut ? "Source request timed out" : message, true);
      }
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400))
        throw new Error("Source request was redirected; redirects are not permitted");
      if (
        response.ok ||
        !(operation.retry?.retryStatuses ?? [429, 502, 503, 504]).includes(response.status) ||
        attempt === attempts - 1
      )
        break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(operation.retry?.backoffMs ?? 0, 60_000) * 2 ** attempt),
      );
    }
    if (!response?.ok) {
      const status = response?.status;
      throw new ConnectorRequestError(
        `Request failed (${status ?? "network"})`,
        status === undefined || statusMakesConnectionUnavailable(status),
        status,
      );
    }
    return (await response.json()) as Json;
  }
}
