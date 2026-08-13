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
    return [
      {
        template: checked.value,
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
        const configured = parseConfiguredSources(parsed);
        sourcesState.sources = configured;
      } catch {
        sourcesState.sources = [];
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
  const connection = newConnection(checked.value, name);
  sourcesState.sources = [...sourcesState.sources, { template: checked.value, connection }];
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
    const connection = newConnection(source.template, source.connection.name);
    imported.push({
      template: source.template,
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
