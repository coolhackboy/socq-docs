import {writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {buildZhOpenApi} from "./localize-openapi-zh.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baseUrl = (process.env.SOCQ_BASE_URL ?? "https://api.socq.ai").replace(/\/$/, "");

async function fetchJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {headers: {Accept: "application/json"}});
  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return response.json();
}

async function fetchCatalog() {
  const endpoints = [];
  const seenCursors = new Set();
  let cursor;
  let schemaVersion;
  let platforms = [];
  let pageCount = 0;

  while (true) {
    const params = new URLSearchParams({limit: "100"});
    if (cursor) params.set("cursor", cursor);

    const catalogEnvelope = await fetchJson(`/v1/catalog?${params}`);
    const catalogData = catalogEnvelope.data ?? catalogEnvelope;
    const paginatedEndpoints = !Array.isArray(catalogData.endpoints);
    const page = paginatedEndpoints ? catalogData.endpoints : undefined;
    const items = paginatedEndpoints ? page?.items : catalogData.endpoints;
    if (!Array.isArray(items)) throw new Error("Capability Catalog response has no endpoint list");

    if (schemaVersion === undefined) {
      schemaVersion = catalogData.schema_version;
      platforms = catalogData.platforms ?? [];
    } else if (catalogData.schema_version !== schemaVersion) {
      throw new Error("Capability Catalog schema_version changed during pagination");
    }

    endpoints.push(...items);
    pageCount += 1;

    if (!paginatedEndpoints) break;
    const nextCursor = page?.next_cursor;
    const hasMore = Boolean(page?.has_more);
    if (hasMore !== Boolean(nextCursor)) {
      throw new Error("Capability Catalog pagination metadata is inconsistent");
    }
    if (!hasMore) break;
    if (seenCursors.has(nextCursor)) {
      throw new Error(`Capability Catalog repeated pagination cursor: ${nextCursor}`);
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  const seenIds = new Set();
  for (const endpoint of endpoints) {
    const publicId = endpoint?.public_id;
    if (typeof publicId !== "string" || !publicId) {
      throw new Error("Capability Catalog endpoint has no public_id");
    }
    if (seenIds.has(publicId)) {
      throw new Error(`Capability Catalog contains duplicate public_id: ${publicId}`);
    }
    seenIds.add(publicId);
  }

  return {schemaVersion, platforms, endpoints, pageCount};
}

const {schemaVersion, platforms, endpoints, pageCount} = await fetchCatalog();

const catalog = {
  schema_version: schemaVersion,
  platforms,
  endpoints,
};
const openapi = await fetchJson("/v1/catalog/openapi.json");
const zhOpenapi = await buildZhOpenApi(openapi, root);

await Promise.all([
  writeJson(join(root, "capability-catalog.json"), catalog),
  writeJson(join(root, "llms.json"), catalog),
  writeJson(join(root, "api-manual", "agent-api", "agent-api.json"), openapi),
  writeJson(join(root, "zh", "api-manual", "agent-api", "agent-api.json"), zhOpenapi),
]);
process.stdout.write(
  `Synchronized ${endpoints.length} endpoints across ${pageCount} page(s) from ${baseUrl} (${catalog.schema_version}).\n`
);

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
