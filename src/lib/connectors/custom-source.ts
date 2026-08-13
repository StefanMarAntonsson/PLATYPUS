import type { SourceOperationTemplate, SourceTemplateV1 } from "./contracts.js";
import { validateSourceTemplate } from "./engine.js";

export interface CustomSourceInput {
  name: string;
  description: string;
  baseUrl: string;
  protocol: "rest" | "graphql";
  method: "GET" | "POST";
  searchPath: string;
  queryParameter: string;
  requestBody: string;
  graphqlQuery: string;
  graphqlVariable: string;
  resultsPath: string;
  providerIdPath: string;
  kindPath: string;
  titlePath: string;
  originalTitlePath: string;
  overviewPath: string;
  artworkPath: string;
  artworkHost: string;
  canonicalUrlPath: string;
}

function mappingPath(value: string, fallback?: string): string | undefined {
  const path = value.trim() || fallback;
  if (!path) return undefined;
  return path.startsWith("$") ? path : `$.${path}`;
}

function sourceId(name: string, existingIds: Set<string>): string {
  const base = `custom-${
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "source"
  }`.slice(0, 72);
  let id = base;
  let suffix = 2;
  while (existingIds.has(id)) id = `${base.slice(0, 76 - String(suffix).length)}-${suffix++}`;
  return id;
}

export function createCustomSourceTemplate(
  input: CustomSourceInput,
  existingIds: Iterable<string> = [],
): SourceTemplateV1 {
  const name = input.name.trim();
  if (!name) throw new Error("Source name is required.");
  let url: URL;
  try {
    url = new URL(input.baseUrl.trim());
  } catch {
    throw new Error("Base URL must be a valid URL.");
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
  ) {
    throw new Error("Remote sources must use HTTPS.");
  }
  const enteredPath = input.searchPath.trim();
  if (!enteredPath) throw new Error("Search endpoint path is required.");
  const basePath = url.pathname.replace(/\/$/, "");
  const searchPath =
    `${basePath}${enteredPath.startsWith("/") ? enteredPath : `/${enteredPath}`}` || "/";
  url.pathname = "";
  url.search = "";
  url.hash = "";

  let request: SourceOperationTemplate["request"];
  if (input.protocol === "graphql") {
    const query = input.graphqlQuery.trim();
    if (!query) throw new Error("GraphQL query is required.");
    request = {
      protocol: "graphql",
      method: "POST",
      path: searchPath,
      query,
      variables: { [input.graphqlVariable.trim() || "query"]: "${input.query}" },
    };
  } else if (input.method === "POST") {
    let body: unknown;
    try {
      body = JSON.parse(input.requestBody.trim() || '{"query":"${input.query}"}');
    } catch {
      throw new Error("REST POST body must be valid JSON.");
    }
    request = {
      protocol: "rest",
      method: "POST",
      path: searchPath,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
    };
  } else {
    request = {
      protocol: "rest",
      method: "GET",
      path: searchPath,
      query: { [input.queryParameter.trim() || "q"]: "${input.query}" },
    };
  }

  const mapping = Object.fromEntries(
    [
      ["providerId", mappingPath(input.providerIdPath, "$.id")],
      ["kind", mappingPath(input.kindPath, "$.type")],
      ["title", mappingPath(input.titlePath, "$.title")],
      ["originalTitle", mappingPath(input.originalTitlePath)],
      ["overview", mappingPath(input.overviewPath)],
      ["artwork.poster", mappingPath(input.artworkPath)],
      ["canonicalUrl", mappingPath(input.canonicalUrlPath)],
    ].filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const artworkHost = input.artworkHost.trim();
  const template: SourceTemplateV1 = {
    schemaVersion: 1,
    id: sourceId(name, new Set(existingIds)),
    name,
    ...(input.description.trim() ? { description: input.description.trim() } : {}),
    baseUrl: url.toString().replace(/\/$/, ""),
    allowedHosts: [url.hostname],
    ...(artworkHost ? { assetHosts: [artworkHost] } : {}),
    authentication: { type: "none" },
    operations: {
      search: {
        request,
        response: {
          resultsPath: mappingPath(input.resultsPath, "$"),
          mapping,
        },
        timeoutMs: 30000,
        retry: { maxAttempts: 2, backoffMs: 500, retryStatuses: [429, 502, 503, 504] },
      },
    },
    cache: { defaultTtlSeconds: 900 },
  };
  const checked = validateSourceTemplate(template);
  if (!checked.valid) throw new Error(checked.errors.map((issue) => issue.message).join("; "));
  return checked.value;
}
