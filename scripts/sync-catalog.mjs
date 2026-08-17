import {writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {buildZhOpenApi} from "./localize-openapi-zh.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baseUrl = (process.env.SOCQ_BASE_URL ?? "https://api.socq.ai").replace(/\/$/, "");

const BLUESKY_INPUT_OVERRIDES = {
  "bluesky/posts": {
    url: {
      description:
        "A non-empty post reference with an authority component whose parsed hostname is bsky.app or a bsky.app subdomain. Any scheme is accepted when an authority and hostname are present; protocol-relative references are also accepted.",
    },
  },
  "bluesky/profiles": {
    username: {
      maxLength: 253,
      pattern: "^[A-Za-z0-9.-]{1,253}$",
      description:
        "A Bluesky username containing 1 to 253 ASCII letters, digits, periods, or hyphens, without a leading @.",
    },
  },
  "bluesky/user-posts": {
    user_id: {
      pattern: "^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$",
      description: "A Bluesky decentralized identifier in did:method:identifier form.",
    },
    username: {
      maxLength: 253,
      pattern: "^[A-Za-z0-9.-]{1,253}$",
      description:
        "A Bluesky handle containing 1 to 253 ASCII letters, digits, periods, or hyphens, without a leading @.",
    },
  },
};

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

    endpoints.push(...items.map(buildPublicEndpoint));
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
const openapi = buildPublicOpenApi(await fetchJson("/v1/catalog/openapi.json"));
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

function buildPublicOpenApi(source) {
  const openapi = structuredClone(source);
  const taskOperation = openapi.paths?.["/v1/tasks/{task_id}"]?.get;
  if (taskOperation) {
    taskOperation.parameters = (taskOperation.parameters ?? []).filter(
      (parameter) => parameter?.name !== "view"
    );
    const fields = taskOperation.parameters.find((parameter) => parameter?.name === "fields");
    if (fields) fields.description = "Up to 50 comma-separated fields or dot paths.";
  }

  for (const publicId of Object.keys(BLUESKY_INPUT_OVERRIDES)) {
    const schema = openapi.paths?.[`/v1/${publicId}`]?.post?.requestBody?.content?.["application/json"]?.schema;
    applyInputOverrides(publicId, schema);
  }
  return openapi;
}

function buildPublicEndpoint(source) {
  const endpoint = structuredClone(source);
  applyInputOverrides(endpoint.public_id, endpoint.input_schema);
  const results = endpoint.output_schema?.properties?.results;
  if (!results) return endpoint;

  if (results.properties) delete results.properties.view;
  if (Array.isArray(results.required)) {
    results.required = results.required.filter((name) => name !== "view");
  }
  return endpoint;
}

function applyInputOverrides(publicId, schema) {
  const overrides = BLUESKY_INPUT_OVERRIDES[publicId];
  if (!overrides || !schema?.properties) return;
  for (const [name, values] of Object.entries(overrides)) {
    if (schema.properties[name]) Object.assign(schema.properties[name], values);
  }
}
