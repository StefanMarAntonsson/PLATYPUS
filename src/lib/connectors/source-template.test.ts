import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vite-plus/test";
import graphqlFixture from "./fixtures/graphql-source.platypus-source.json";
import restFixture from "./fixtures/rest-source.platypus-source.json";
import schema from "./source-template.schema.json";
import type { SourceTemplateV1 } from "./contracts.js";

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
const validate = ajv.compile<SourceTemplateV1>(schema);

describe("source template schema v1", () => {
  test.each([
    ["REST", restFixture],
    ["GraphQL", graphqlFixture],
  ])("accepts the representative %s fixture", (_name, fixture) => {
    expect(validate(fixture), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  test("rejects secrets embedded as authentication values", () => {
    const invalid = structuredClone(restFixture) as Record<string, unknown>;
    invalid.authentication = { type: "bearer", token: "do-not-store-me" };
    expect(validate(invalid)).toBe(false);
  });

  test("rejects executable and unknown operations", () => {
    const invalid = structuredClone(restFixture) as typeof restFixture & {
      operations: Record<string, unknown>;
    };
    invalid.operations.execute = { script: "return process.env" };
    expect(validate(invalid)).toBe(false);
  });

  test("rejects insecure remote base URLs", () => {
    const invalid = { ...restFixture, baseUrl: "http://api.catalog.example" };
    expect(validate(invalid)).toBe(false);
  });
});
