import {writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baseUrl = (process.env.SOCQ_BASE_URL ?? "https://api.socq.ai").replace(/\/$/, "");

async function fetchJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {headers: {Accept: "application/json"}});
  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return response.json();
}

const catalogEnvelope = await fetchJson("/v1/catalog?limit=100");
const catalogData = catalogEnvelope.data ?? catalogEnvelope;
const endpoints = Array.isArray(catalogData.endpoints)
  ? catalogData.endpoints
  : catalogData.endpoints?.items;
if (!Array.isArray(endpoints)) throw new Error("Capability Catalog response has no endpoint list");

const catalog = {
  schema_version: catalogData.schema_version,
  platforms: catalogData.platforms ?? [],
  endpoints,
};
const openapi = await fetchJson("/v1/catalog/openapi.json");

await Promise.all([
  writeJson(join(root, "capability-catalog.json"), catalog),
  writeJson(join(root, "llms.json"), catalog),
  writeJson(join(root, "api-manual", "agent-api", "agent-api.json"), openapi),
]);
process.stdout.write(`Synchronized ${endpoints.length} endpoints from ${baseUrl} (${catalog.schema_version}).\n`);

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
