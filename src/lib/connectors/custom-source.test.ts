import { describe, expect, test } from "vite-plus/test";
import { createCustomSourceTemplate, type CustomSourceInput } from "./custom-source.js";

const input: CustomSourceInput = {
  name: "Example Catalog",
  description: "A public catalog",
  baseUrl: "https://api.example.com/v2",
  protocol: "rest",
  method: "GET",
  searchPath: "/search",
  queryParameter: "query",
  requestBody: "",
  graphqlQuery: "",
  graphqlVariable: "query",
  resultsPath: "$.items",
  providerIdPath: "$.key",
  kindPath: "$.media_type",
  titlePath: "$.name",
  originalTitlePath: "",
  overviewPath: "$.summary",
  artworkPath: "$.poster",
  artworkHost: "images.example.com",
  canonicalUrlPath: "$.url",
};

describe("custom REST source builder", () => {
  test("builds a validated search template from form fields", () => {
    const template = createCustomSourceTemplate(input);

    expect(template).toMatchObject({
      id: "custom-example-catalog",
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      assetHosts: ["images.example.com"],
      operations: {
        search: {
          request: {
            path: "/v2/search",
            query: { query: "${input.query}" },
          },
          response: {
            resultsPath: "$.items",
            mapping: { providerId: "$.key", kind: "$.media_type", title: "$.name" },
          },
        },
      },
    });
  });

  test("creates a unique template id and rejects insecure remote APIs", () => {
    expect(createCustomSourceTemplate(input, ["custom-example-catalog"]).id).toBe(
      "custom-example-catalog-2",
    );
    expect(() =>
      createCustomSourceTemplate({ ...input, baseUrl: "http://api.example.com" }),
    ).toThrow(/must use HTTPS/);
  });

  test("builds REST POST and GraphQL search requests", () => {
    const post = createCustomSourceTemplate({
      ...input,
      method: "POST",
      requestBody: '{"search":"${input.query}"}',
    });
    expect(post.operations.search?.request).toMatchObject({
      protocol: "rest",
      method: "POST",
      body: { search: "${input.query}" },
    });

    const graphql = createCustomSourceTemplate({
      ...input,
      protocol: "graphql",
      graphqlQuery: "query Search($term: String!) { search(term: $term) { id type title } }",
      graphqlVariable: "term",
    });
    expect(graphql.operations.search?.request).toMatchObject({
      protocol: "graphql",
      method: "POST",
      variables: { term: "${input.query}" },
    });
  });
});
