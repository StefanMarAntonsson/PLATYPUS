import type { SourceConnection, SourceTemplateV1, TrackingMode } from "./contracts.js";
import { validateSourceTemplate } from "./engine.js";

export const SOURCE_BUNDLE_FORMAT = "platypus-sources" as const;
export const SOURCE_BUNDLE_VERSION = 1 as const;

export interface PortableSourceConnection {
  name: string;
  baseUrl: string;
  enabled: boolean;
  settings: SourceConnection["settings"];
  trackingMode: TrackingMode;
}

export interface PortableSource {
  template: SourceTemplateV1;
  connection: PortableSourceConnection;
}

export interface SourceBundleV1 {
  format: typeof SOURCE_BUNDLE_FORMAT;
  schemaVersion: typeof SOURCE_BUNDLE_VERSION;
  exportedAt: string;
  sources: PortableSource[];
}

export interface ConfiguredSourceLike {
  template: SourceTemplateV1;
  connection: SourceConnection;
}

function portableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isSettings(value: unknown): value is SourceConnection["settings"] {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(
      (item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean",
    )
  );
}

function isTrackingMode(value: unknown): value is TrackingMode {
  return value === "import_only" || value === "export_only" || value === "bidirectional";
}

export function createSourceBundle(sources: ConfiguredSourceLike[]): SourceBundleV1 {
  return {
    format: SOURCE_BUNDLE_FORMAT,
    schemaVersion: SOURCE_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    sources: sources.map(({ template, connection }) => ({
      template: portableClone(template),
      connection: {
        name: connection.name,
        baseUrl: connection.baseUrl,
        enabled: connection.enabled,
        settings: portableClone(connection.settings),
        trackingMode: connection.tracking.mode,
      },
    })),
  };
}

export function parseSourceBundle(value: unknown): SourceBundleV1 {
  if (!value || typeof value !== "object")
    throw new Error("Sources file must contain a JSON object.");
  const candidate = value as Partial<SourceBundleV1>;
  if (
    candidate.format !== SOURCE_BUNDLE_FORMAT ||
    candidate.schemaVersion !== SOURCE_BUNDLE_VERSION
  ) {
    throw new Error("This is not a supported PLATYPUS sources file.");
  }
  if (!Array.isArray(candidate.sources))
    throw new Error("Sources file is missing its connections.");

  const sources = candidate.sources.map((source, index): PortableSource => {
    if (!source || typeof source !== "object") throw new Error(`Source ${index + 1} is invalid.`);
    const checked = validateSourceTemplate((source as PortableSource).template);
    if (!checked.valid) {
      throw new Error(
        `Source ${index + 1}: ${checked.errors.map((issue) => issue.message).join("; ")}`,
      );
    }
    const connection = (source as PortableSource).connection;
    if (
      !connection ||
      typeof connection !== "object" ||
      typeof connection.name !== "string" ||
      !connection.name.trim()
    ) {
      throw new Error(`Source ${index + 1} has an invalid connection name.`);
    }
    if (typeof connection.baseUrl !== "string" || typeof connection.enabled !== "boolean") {
      throw new Error(`Source ${index + 1} has invalid connection settings.`);
    }
    let host: string;
    try {
      host = new URL(connection.baseUrl).hostname;
    } catch {
      throw new Error(`Source ${index + 1} has an invalid base URL.`);
    }
    if (!checked.value.allowedHosts.includes(host)) {
      throw new Error(`Source ${index + 1} uses a base URL outside its allowed hosts.`);
    }
    if (!isSettings(connection.settings) || !isTrackingMode(connection.trackingMode)) {
      throw new Error(`Source ${index + 1} has invalid portable settings.`);
    }
    return {
      template: checked.value,
      connection: {
        name: connection.name.trim(),
        baseUrl: connection.baseUrl,
        enabled: connection.enabled,
        settings: connection.settings,
        trackingMode: connection.trackingMode,
      },
    };
  });

  return {
    format: SOURCE_BUNDLE_FORMAT,
    schemaVersion: SOURCE_BUNDLE_VERSION,
    exportedAt: typeof candidate.exportedAt === "string" ? candidate.exportedAt : "",
    sources,
  };
}
