import { invoke } from "@tauri-apps/api/core";
import {
  ConnectorEngine,
  validateSourceTemplate,
  type ConnectorResponsePreview,
} from "./connectors/engine.js";
import type {
  CapabilityStatus,
  NormalizedMedia,
  SourceConnection,
  SourceTemplateV1,
  TrackingAuditEntry,
  TrackingMode,
} from "./connectors/contracts.js";
import { createSourceBundle, parseSourceBundle } from "./connectors/source-bundle.js";
import { BUILTIN_TEMPLATES, isBuiltinTemplate } from "./connectors/builtin.js";

export interface ConfiguredSource {
  template: SourceTemplateV1;
  connection: SourceConnection;
}

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

export const sourcesState = $state({
  ready: false,
  sources: [] as ConfiguredSource[],
});

let initialization: Promise<void> | undefined;
const connectorEngine = new ConnectorEngine();

function withAniListCompatibleFields(template: SourceTemplateV1): SourceTemplateV1 {
  if (template.id !== "anilist") return template;
  let changed = false;
  const operations = { ...template.operations };

  for (const name of ["search", "details"] as const) {
    const operation = operations[name];
    if (!operation || operation.request.protocol !== "graphql") continue;
    let query = operation.request.query.replace(
      /title\s*\{([^}]*)\}/,
      (selection, fields: string) => {
        if (/\benglish\b/.test(fields)) return selection;
        changed = true;
        return selection.replace("}", " english }");
      },
    );
    // Streaming platforms let a sync find new ones, and let a title from
    // another source borrow them; the start date confirms such a match.
    const extraFields = [
      "externalLinks { url site type color }",
      ...(name === "search" ? ["startDate { year month day }"] : []),
    ];
    for (const field of extraFields) {
      if (new RegExp(`\\b${field.split(" ")[0]}\\b`).test(query)) continue;
      query = query.replace(/(\b(?:Media|media)\s*(?:\([^)]*\))?\s*\{)/, (opening: string) => {
        changed = true;
        return `${opening} ${field}`;
      });
    }
    // AniList can return a null format for an announced title. Its type is
    // still ANIME, which gives the connector a reliable series identity.
    query = query.replace(
      /(\b(?:Media|media)\s*(?:\([^)]*\))?\s*\{)([^{}]*)/,
      (selection, opening: string, fields: string) => {
        if (/\btype\b/.test(fields)) return selection;
        changed = true;
        return `${opening} type${fields}`;
      },
    );
    const mapping = {
      ...operation.response.mapping,
      streamingLinks: operation.response.mapping.streamingLinks ?? "$.externalLinks",
      ...(name === "search"
        ? { startDateParts: operation.response.mapping.startDateParts ?? "$.startDate" }
        : {}),
      kind: "$.type",
      format: operation.response.mapping.format ?? operation.response.mapping.kind,
      titleRomaji: operation.response.mapping.titleRomaji ?? "$.title.romaji",
      titleEnglish: operation.response.mapping.titleEnglish ?? "$.title.english",
      titleNative:
        operation.response.mapping.titleNative ??
        operation.response.mapping.originalTitle ??
        "$.title.native",
    };
    if (
      mapping.kind !== operation.response.mapping.kind ||
      mapping.format !== operation.response.mapping.format ||
      mapping.titleRomaji !== operation.response.mapping.titleRomaji ||
      mapping.titleEnglish !== operation.response.mapping.titleEnglish ||
      mapping.titleNative !== operation.response.mapping.titleNative ||
      mapping.streamingLinks !== operation.response.mapping.streamingLinks ||
      mapping.startDateParts !== operation.response.mapping.startDateParts
    ) {
      changed = true;
    }
    operations[name] = {
      ...operation,
      request: { ...operation.request, query },
      response: { ...operation.response, mapping },
    };
  }

  const episodes = operations.episodes;
  if (episodes?.request.protocol === "graphql") {
    const query = episodes.request.query.replace(
      /\bairingSchedule\s*\(\s*page\s*:\s*1\s*,\s*perPage\s*:\s*\d+\s*\)\s*\{/,
      "airingSchedule(page: ${page.number}, perPage: 25) { pageInfo { hasNextPage }",
    );
    if (query !== episodes.request.query) {
      changed = true;
      operations.episodes = {
        ...episodes,
        request: { ...episodes.request, query },
        pagination: {
          type: "page",
          parameter: "page",
          hasNextPath: "$.data.Media.airingSchedule.pageInfo.hasNextPage",
        },
      };
    }
  }

  return changed ? { ...template, operations } : template;
}

/** Treat persisted source configuration as untrusted, just like imported templates. */
export function parseConfiguredSources(value: unknown): ConfiguredSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const { template, connection } = candidate as Partial<ConfiguredSource>;
    const checked = validateSourceTemplate(template);
    if (!checked.valid || !connection || typeof connection !== "object") return [];
    const configured = connection as SourceConnection;
    if (
      typeof configured.id !== "string" ||
      typeof configured.name !== "string" ||
      configured.templateId !== checked.value.id ||
      typeof configured.baseUrl !== "string"
    )
      return [];
    try {
      if (!checked.value.allowedHosts.includes(new URL(configured.baseUrl).hostname)) return [];
    } catch {
      return [];
    }
    const upgradedTemplate = withAniListCompatibleFields(checked.value);
    return [
      {
        template: upgradedTemplate,
        connection: {
          ...configured,
          tracking: {
            mode: configured.tracking?.mode ?? "import_only",
            cursor: configured.tracking?.cursor,
            lastImportedAt: configured.tracking?.lastImportedAt,
            lastExportedAt: configured.tracking?.lastExportedAt,
            audit: Array.isArray(configured.tracking?.audit)
              ? configured.tracking.audit.slice(-50)
              : [],
          },
        },
      },
    ];
  });
}

/**
 * Give every built-in source a connection and keep its template current.
 * Stored copies of a built-in template are replaced by the app's version; the
 * connection, including whether the user disabled it, is left alone.
 */
export function withBuiltinSources(sources: ConfiguredSource[]): {
  sources: ConfiguredSource[];
  changed: boolean;
} {
  let changed = false;
  const upgraded = sources.map((source) => {
    const builtin = BUILTIN_TEMPLATES.find((template) => template.id === source.template.id);
    if (!builtin || JSON.stringify(builtin) === JSON.stringify(source.template)) return source;
    changed = true;
    return { ...source, template: builtin };
  });
  for (const template of BUILTIN_TEMPLATES) {
    if (upgraded.some((source) => source.template.id === template.id)) continue;
    changed = true;
    upgraded.push({ template, connection: newConnection(template) });
  }
  return { sources: upgraded, changed };
}

async function persist() {
  const serialized = JSON.stringify(sourcesState.sources);
  await invoke("save_sources", { data: serialized });
}

export async function initSources() {
  if (sourcesState.ready) return;
  if (!initialization) {
    initialization = (async () => {
      try {
        const serialized = await invoke<string | null>("load_sources");
        const parsed = serialized ? JSON.parse(serialized) : [];
        const configured = withBuiltinSources(parseConfiguredSources(parsed));
        sourcesState.sources = configured.sources;
        // Built-ins are recreated on every load, so a failed save only
        // means doing this again next time.
        if (configured.changed) await persist().catch(() => undefined);
      } catch {
        sourcesState.sources = withBuiltinSources([]).sources;
      }
      sourcesState.ready = true;
    })();
  }
  await initialization;
}

export function newConnection(template: SourceTemplateV1, name = template.name): SourceConnection {
  const timestamp = now();
  return {
    id: id(),
    templateId: template.id,
    name,
    baseUrl: template.baseUrl,
    enabled: true,
    settings: {},
    secretReferences: {},
    capabilities: {},
    tracking: { mode: "import_only", audit: [] },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function addSource(template: SourceTemplateV1, name?: string) {
  const checked = validateSourceTemplate(template);
  if (!checked.valid) throw new Error(checked.errors.map((issue) => issue.message).join("; "));
  const configuredTemplate = withAniListCompatibleFields(checked.value);
  const connection = newConnection(configuredTemplate, name);
  sourcesState.sources = [...sourcesState.sources, { template: configuredTemplate, connection }];
  await persist();
  return connection;
}

export function serializeSourcesBundle(): string {
  return JSON.stringify(createSourceBundle(sourcesState.sources), null, 2);
}

export function saveSourcesBundle(path: string): Promise<string> {
  return invoke<string>("save_sources_bundle", { path, data: serializeSourcesBundle() });
}

export async function importSourcesBundle(
  serialized: string,
): Promise<{ added: number; skipped: number }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Sources file is not valid JSON.");
  }
  const bundle = parseSourceBundle(parsed);
  const existing = new Set(
    sourcesState.sources.map(
      (source) =>
        `${source.template.id}\u0000${source.connection.baseUrl}\u0000${source.connection.name.toLocaleLowerCase()}`,
    ),
  );
  const imported: ConfiguredSource[] = [];
  let skipped = 0;

  for (const source of bundle.sources) {
    const key = `${source.template.id}\u0000${source.connection.baseUrl}\u0000${source.connection.name.toLocaleLowerCase()}`;
    if (existing.has(key)) {
      skipped++;
      continue;
    }
    existing.add(key);
    const configuredTemplate = withAniListCompatibleFields(source.template);
    const connection = newConnection(configuredTemplate, source.connection.name);
    imported.push({
      template: configuredTemplate,
      connection: {
        ...connection,
        baseUrl: source.connection.baseUrl,
        enabled: source.connection.enabled,
        settings: source.connection.settings,
        tracking: { ...connection.tracking, mode: source.connection.trackingMode },
      },
    });
  }
  sourcesState.sources = [...sourcesState.sources, ...imported];
  await persist();
  return { added: imported.length, skipped };
}

export async function updateSource(
  connectionId: string,
  changes: Partial<
    Pick<SourceConnection, "name" | "baseUrl" | "enabled" | "settings" | "tracking">
  >,
) {
  if (changes.baseUrl) {
    let host: string;
    try {
      host = new URL(changes.baseUrl).hostname;
    } catch {
      throw new Error("Base URL must be a valid URL.");
    }
    const source = sourcesState.sources.find((item) => item.connection.id === connectionId);
    if (!source) throw new Error("Source connection not found");
    if (!source.template.allowedHosts.includes(host))
      throw new Error("Base URL host is not approved by this source template.");
  }
  sourcesState.sources = sourcesState.sources.map((source) =>
    source.connection.id === connectionId
      ? { ...source, connection: { ...source.connection, ...changes, updatedAt: now() } }
      : source,
  );
  await persist();
}

export async function setTrackingMode(connectionId: string, mode: TrackingMode) {
  await updateSource(connectionId, {
    tracking: {
      ...sourcesState.sources.find((source) => source.connection.id === connectionId)?.connection
        .tracking,
      mode,
      audit:
        sourcesState.sources.find((source) => source.connection.id === connectionId)?.connection
          .tracking.audit ?? [],
    },
  });
}

/** Keep a small, credential-free audit trail with the connection configuration. */
export async function recordTrackingAudit(connectionId: string, entry: TrackingAuditEntry) {
  const source = sourcesState.sources.find((item) => item.connection.id === connectionId);
  if (!source) throw new Error("Source connection not found");
  await updateSource(connectionId, {
    tracking: {
      ...source.connection.tracking,
      ...(entry.direction === "import"
        ? { lastImportedAt: entry.at }
        : { lastExportedAt: entry.at }),
      audit: [...source.connection.tracking.audit, entry].slice(-50),
    },
  });
}

export async function removeSource(connectionId: string) {
  const source = sourcesState.sources.find((item) => item.connection.id === connectionId);
  if (source && isBuiltinTemplate(source.template.id)) {
    throw new Error("Built-in sources can be disabled but not removed.");
  }
  sourcesState.sources = sourcesState.sources.filter(
    (source) => source.connection.id !== connectionId,
  );
  await persist();
}

export interface SourceTestResult {
  status: CapabilityStatus;
  response?: ConnectorResponsePreview;
}

async function persistSearchCapability(connectionId: string, status: CapabilityStatus) {
  sourcesState.sources = sourcesState.sources.map((item) =>
    item.connection.id === connectionId
      ? {
          ...item,
          connection: {
            ...item.connection,
            capabilities: { ...item.connection.capabilities, search: status },
            updatedAt: now(),
          },
        }
      : item,
  );
  await persist();
}

export async function testSource(connectionId: string): Promise<SourceTestResult> {
  const source = sourcesState.sources.find((item) => item.connection.id === connectionId);
  if (!source) throw new Error("Source connection not found");
  const query = "test";
  try {
    const response = await connectorEngine.preview(source.template, source.connection, "search", {
      input: { query },
    });
    // A successful HTTP response is not enough: verification also proves that
    // the declared mapping can produce normalized media records.
    await connectorEngine.execute(source.template, source.connection, "search", {
      input: { query },
    });
    const status = connectorEngine.capability(source.template, "search");
    await persistSearchCapability(connectionId, status);
    return { status, response };
  } catch (error) {
    const status = connectorEngine.capability(source.template, "search", error);
    await persistSearchCapability(connectionId, status);
    return { status };
  }
}

export interface UnifiedSearchGroup {
  connection: SourceConnection;
  results: NormalizedMedia[];
  error?: string;
}

export interface SourceMediaUpdate {
  source: ConfiguredSource;
  details?: NormalizedMedia;
  episodes?: Record<string, unknown>[];
}

export async function fetchSourceMediaUpdate(
  connectionId: string,
  providerId: string,
  signal?: AbortSignal,
): Promise<SourceMediaUpdate> {
  await initSources();
  let source = sourcesState.sources.find((configured) => configured.connection.id === connectionId);
  if (!source) throw new Error("The media source connection is no longer configured");
  if (!source.connection.enabled) throw new Error(`${source.connection.name} is disabled`);
  source = { ...source, template: withAniListCompatibleFields(source.template) };

  const input = { providerId };
  const details = source.template.operations.details
    ? (
        await connectorEngine.execute(source.template, source.connection, "details", {
          input,
          signal,
        })
      )[0]
    : undefined;
  const episodes = source.template.operations.episodes
    ? await connectorEngine.executeRecords(source.template, source.connection, "episodes", {
        input,
        signal,
      })
    : undefined;

  if (!details && !episodes) {
    throw new Error(`${source.connection.name} does not support details or episode sync`);
  }
  return { source, details, episodes };
}

export function canRefreshFromSource(connectionId: string): boolean {
  const source = sourcesState.sources.find(
    (configured) => configured.connection.id === connectionId,
  );
  return !!(
    source?.connection.enabled &&
    (source.template.operations.details || source.template.operations.episodes)
  );
}

/** Resolve a legacy provider kind through an explicitly configured refresh-capable source. */
export function refreshConnectionForTemplate(templateId: string): SourceConnection | undefined {
  return sourcesState.sources.find(
    (source) =>
      source.template.id === templateId &&
      source.connection.enabled &&
      !!(source.template.operations.details || source.template.operations.episodes),
  )?.connection;
}

export async function searchSources(
  query: string,
  signal?: AbortSignal,
): Promise<UnifiedSearchGroup[]> {
  await initSources();
  return Promise.all(
    sourcesState.sources
      .filter((source) => source.connection.enabled && source.template.operations.search)
      .map(async (source) => {
        try {
          return {
            connection: source.connection,
            results: await connectorEngine.execute(source.template, source.connection, "search", {
              input: { query },
              signal,
            }),
          };
        } catch (error) {
          return {
            connection: source.connection,
            results: [],
            error: error instanceof Error ? error.message : "Search failed",
          };
        }
      }),
  );
}

/** The enabled connection for a template that supports the given operations. */
export function enabledSourceForTemplate(
  templateId: string,
  operations: Array<keyof SourceTemplateV1["operations"]>,
): ConfiguredSource | undefined {
  return sourcesState.sources.find(
    (source) =>
      source.template.id === templateId &&
      source.connection.enabled &&
      operations.every((operation) => !!source.template.operations[operation]),
  );
}

/** Search one configured source. */
export async function searchSource(
  source: ConfiguredSource,
  query: string,
  signal?: AbortSignal,
): Promise<NormalizedMedia[]> {
  return connectorEngine.execute(source.template, source.connection, "search", {
    input: { query },
    signal,
  });
}

/** Fetch one configured source's details for a provider item. */
export async function fetchSourceDetails(
  source: ConfiguredSource,
  providerId: string,
  signal?: AbortSignal,
): Promise<NormalizedMedia | undefined> {
  const [details] = await connectorEngine.execute(source.template, source.connection, "details", {
    input: { providerId },
    signal,
  });
  return details;
}

/** Fetch one configured source's raw episode records for a provider item. */
export async function fetchEpisodeRecords(
  source: ConfiguredSource,
  providerId: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  return connectorEngine.executeRecords(source.template, source.connection, "episodes", {
    input: { providerId },
    signal,
  });
}
