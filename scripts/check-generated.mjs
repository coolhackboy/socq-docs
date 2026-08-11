import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const catalog = JSON.parse(await readFile(join(root, "capability-catalog.json"), "utf8"));
const llms = JSON.parse(await readFile(join(root, "llms.json"), "utf8"));
const openapi = JSON.parse(await readFile(join(root, "api-manual", "agent-api", "agent-api.json"), "utf8"));
const zhOpenapi = JSON.parse(
  await readFile(join(root, "zh", "api-manual", "agent-api", "agent-api.json"), "utf8")
);
const ids = catalog.endpoints.map((item) => item.public_id).sort();
const llmsIds = llms.endpoints.map((item) => item.public_id).sort();
const openapiIds = Object.keys(openapi.paths)
  .filter((path) => /^\/v1\/[^/]+\/[^/{]+$/.test(path))
  .map((path) => path.slice(4))
  .sort();

function validateCompletedTaskResponse(source, publicId, locale) {
  const heading = locale === "zh" ? "任务完成响应" : "Completed Task Response";
  const legacyHeading = locale === "zh" ? /^## 结果项\s*$/m : /^## Result Item\s*$/m;
  if (legacyHeading.test(source)) {
    throw new Error(`${locale}: ${publicId} still uses the legacy result-item example format`);
  }
  if (/"status"\s*:\s*"queued"/.test(source)) {
    throw new Error(`${locale}: ${publicId} still includes a queued response example`);
  }
  const match = source.match(
    locale === "zh"
      ? /## 任务完成响应\r?\n\r?\n```json\r?\n([\s\S]*?)\r?\n```/
      : /## Completed Task Response\r?\n\r?\n```json\r?\n([\s\S]*?)\r?\n```/
  );
  if (!match) throw new Error(`${locale}: ${publicId} is missing the ${heading} JSON example`);

  let response;
  try {
    response = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`${locale}: ${publicId} has invalid ${heading} JSON: ${error.message}`);
  }

  const data = response?.data;
  const results = data?.results;
  if (response?.code !== 200) throw new Error(`${locale}: ${publicId} response code must be 200`);
  if (data?.status !== "succeeded") {
    throw new Error(`${locale}: ${publicId} completed response status must be succeeded`);
  }
  if (data?.public_id !== publicId) {
    throw new Error(`${locale}: ${publicId} completed response public_id is out of sync`);
  }
  if (!Number.isFinite(data?.result_count)) {
    throw new Error(`${locale}: ${publicId} completed response result_count must be numeric`);
  }
  if (!Number.isFinite(data?.credits_amount)) {
    throw new Error(`${locale}: ${publicId} completed response credits_amount must be numeric`);
  }
  if (!Number.isFinite(results?.limit)) {
    throw new Error(`${locale}: ${publicId} completed response results.limit must be numeric`);
  }
  if (!("next_cursor" in results)) {
    throw new Error(`${locale}: ${publicId} completed response must include results.next_cursor`);
  }
  if (typeof results?.has_more !== "boolean") {
    throw new Error(`${locale}: ${publicId} completed response results.has_more must be boolean`);
  }
  if (!Array.isArray(results?.items)) {
    throw new Error(`${locale}: ${publicId} completed response results.items must be an array`);
  }
  const endpoint = catalog.endpoints.find((item) => item.public_id === publicId);
  if (!endpoint?.output_schema_id || !endpoint?.output_schema_version) {
    throw new Error(`${publicId} is missing output schema metadata`);
  }
  if (results.view !== "standard") throw new Error(`${locale}: ${publicId} result view must be standard`);
  if (results.schema_id !== endpoint.output_schema_id) throw new Error(`${locale}: ${publicId} schema_id is out of sync`);
  if (results.schema_version !== endpoint.output_schema_version) throw new Error(`${locale}: ${publicId} schema_version is out of sync`);
  if (!source.includes("{/* result-schema:start */}")) {
    throw new Error(`${locale}: ${publicId} is missing the generated result field table`);
  }
  if (/Normalized [^\r\n|]* field\.|标准化的 [^\r\n|]* 字段。/.test(source)) {
    throw new Error(`${locale}: ${publicId} contains a placeholder result-field description`);
  }
  const itemSchema = endpoint.output_schema?.properties?.results?.properties?.items?.items;
  validateSchemaDescriptions(itemSchema, itemSchema, `${publicId}:output_schema`);
  for (const [index, item] of results.items.entries()) {
    validateSchemaValue(item, itemSchema, itemSchema, `${locale}:${publicId}:items[${index}]`);
  }

  return response;
}

function validateSchemaValue(value, schema, root, path) {
  if (!schema) throw new Error(`${path} has no schema`);
  if (schema.$ref) {
    const name = schema.$ref.split("/").at(-1);
    return validateSchemaValue(value, root.$defs?.[name], root, path);
  }
  if (schema.anyOf) {
    if (value === null && schema.anyOf.some((choice) => choice.type === "null")) return;
    const choice = schema.anyOf.find((item) => item.type !== "null");
    return validateSchemaValue(value, choice, root, path);
  }
  if (value === null) {
    const nullable = schema.type === "null" || (Array.isArray(schema.type) && schema.type.includes("null"));
    if (!nullable) throw new Error(`${path} is unexpectedly null`);
    return;
  }
  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== "null") : schema.type;
  if (schema.const !== undefined && value !== schema.const) throw new Error(`${path} must equal ${schema.const}`);
  if (type === "object" || schema.properties) {
    if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
    const expected = Object.keys(schema.properties ?? {}).sort();
    const actual = Object.keys(value).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      throw new Error(`${path} fields differ from schema: expected=${expected}, actual=${actual}`);
    }
    for (const key of expected) validateSchemaValue(value[key], schema.properties[key], root, `${path}.${key}`);
    return;
  }
  if (type === "array") {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    value.forEach((item, index) => validateSchemaValue(item, schema.items, root, `${path}[${index}]`));
    return;
  }
  if (type === "string" && typeof value !== "string") throw new Error(`${path} must be a string`);
  if (type === "boolean" && typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  if (type === "number" && typeof value !== "number") throw new Error(`${path} must be a number`);
  if (type === "integer" && !Number.isInteger(value)) throw new Error(`${path} must be an integer`);
}

function validateSchemaDescriptions(schema, root, path) {
  if (!schema) throw new Error(`${path} has no schema`);
  if (schema.$ref) {
    const name = schema.$ref.split("/").at(-1);
    return validateSchemaDescriptions(root.$defs?.[name], root, path);
  }
  if (schema.anyOf) {
    const choice = schema.anyOf.find((item) => item.type !== "null");
    return validateSchemaDescriptions(choice, root, path);
  }
  if (schema.type === "array") {
    return validateSchemaDescriptions(schema.items, root, `${path}[]`);
  }
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const fieldPath = `${path}.${name}`;
    if (typeof property.description !== "string" || !property.description.trim()) {
      throw new Error(`${fieldPath} is missing an English description`);
    }
    if (typeof property["x-description-zh"] !== "string" || !property["x-description-zh"].trim()) {
      throw new Error(`${fieldPath} is missing a Chinese description`);
    }
    if (/^Normalized .* field\.$/.test(property.description)) {
      throw new Error(`${fieldPath} uses a placeholder English description`);
    }
    if (/^标准化的 .* 字段。$/.test(property["x-description-zh"])) {
      throw new Error(`${fieldPath} uses a placeholder Chinese description`);
    }
    validateSchemaDescriptions(property, root, fieldPath);
  }
}

if (new Set(ids).size !== ids.length) throw new Error("Duplicate public_id in capability-catalog.json");
if (JSON.stringify(ids) !== JSON.stringify(llmsIds)) throw new Error("llms.json endpoint list is out of sync");
if (JSON.stringify(ids) !== JSON.stringify(openapiIds)) throw new Error("OpenAPI endpoint paths are out of sync");
if (catalog.schema_version !== openapi.info.version) throw new Error("Catalog/OpenAPI schema_version mismatch");
if (JSON.stringify(Object.keys(openapi.paths).sort()) !== JSON.stringify(Object.keys(zhOpenapi.paths).sort())) {
  throw new Error("Chinese OpenAPI endpoint paths are out of sync");
}
if (openapi.info.version !== zhOpenapi.info.version) {
  throw new Error("Chinese OpenAPI schema_version mismatch");
}
for (const publicId of ids) {
  const enSource = await readFile(join(root, "api-manual", `${publicId}.mdx`), "utf8");
  const zhSource = await readFile(join(root, "zh", "api-manual", `${publicId}.mdx`), "utf8");
  if (/scrape\s*creators|bright\s*data/i.test(`${enSource}\n${zhSource}`)) {
    throw new Error(`${publicId} public documentation contains a provider name`);
  }
  const enResponse = validateCompletedTaskResponse(enSource, publicId, "en");
  const zhResponse = validateCompletedTaskResponse(zhSource, publicId, "zh");
  if (JSON.stringify(enResponse) !== JSON.stringify(zhResponse)) {
    throw new Error(`${publicId} completed task response differs between English and Chinese docs`);
  }
}

process.stdout.write(
  `Validated ${ids.length} generated SocQ endpoints and completed task responses (${catalog.schema_version}).\n`
);
