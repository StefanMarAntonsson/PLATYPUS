import { ConnectorEngine } from "./connectors/engine.js";
import type { SourceConnection, SourceTemplateV1 } from "./connectors/contracts.js";
import { appData, persist } from "./store.svelte.js";
import { recordTrackingAudit } from "./sources.svelte.js";

const now = () => new Date().toISOString();

function watchedAt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/** Import an idempotent, declaratively mapped remote history feed. */
export async function importTrackingHistory(
  template: SourceTemplateV1,
  connection: SourceConnection,
  engine = new ConnectorEngine(),
): Promise<{ imported: number; skipped: number }> {
  if (connection.tracking.mode === "export_only") {
    throw new Error("This connection is configured for export only.");
  }
  if (!template.operations.history)
    throw new Error(`${template.name} does not provide history import.`);

  let imported = 0;
  let skipped = 0;
  try {
    const records = await engine.executeRecords(template, connection, "history", {
      input: connection.tracking.cursor ? { cursor: connection.tracking.cursor } : {},
    });
    let nextId = appData.watchEvents.reduce((maximum, event) => Math.max(maximum, event.id), 0) + 1;
    for (const record of records) {
      const providerId = record.providerId;
      const remoteEventId = record.remoteEventId;
      if (
        typeof providerId !== "string" ||
        !providerId ||
        typeof remoteEventId !== "string" ||
        !remoteEventId
      ) {
        skipped++;
        continue;
      }
      if (
        appData.watchEvents.some(
          (event) =>
            event.originatingConnectionId === connection.id &&
            event.remoteEventId === remoteEventId,
        )
      ) {
        skipped++;
        continue;
      }
      const media = appData.media.find((item) =>
        item.providerLinks?.some(
          (link) => link.connectionId === connection.id && link.providerId === providerId,
        ),
      );
      if (!media) {
        skipped++;
        continue;
      }
      const episodeProviderId = record.episodeProviderId;
      const episode =
        typeof episodeProviderId === "string"
          ? appData.episodes.find(
              (item) => item.mediaId === media.id && String(item.id) === episodeProviderId,
            )
          : undefined;
      if (typeof episodeProviderId === "string" && !episode) {
        skipped++;
        continue;
      }
      appData.watchEvents.push({
        id: nextId++,
        mediaId: media.id,
        episodeId: episode?.id ?? null,
        watchedAt: watchedAt(record.watchedAt),
        progress:
          typeof record.completion === "number" && record.completion >= 0 && record.completion <= 1
            ? record.completion
            : 1,
        origin: "source",
        remoteEventId,
        originatingConnectionId: connection.id,
      });
      if (episode) {
        episode.watched = true;
        episode.watchedAt = watchedAt(record.watchedAt);
      }
      imported++;
    }
    if (imported) persist();
    await recordTrackingAudit(connection.id, {
      at: now(),
      direction: "import",
      outcome: skipped ? "partial" : "success",
      processed: imported,
      ...(skipped ? { message: `${skipped} records could not be linked locally.` } : {}),
    });
    return { imported, skipped };
  } catch (error) {
    await recordTrackingAudit(connection.id, {
      at: now(),
      direction: "import",
      outcome: "failed",
      processed: imported,
      message: error instanceof Error ? error.message : "Unknown history import failure",
    });
    throw error;
  }
}
