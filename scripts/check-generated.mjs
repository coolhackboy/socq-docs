import {readFile, access} from "node:fs/promises";
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
for (const publicId of ids) await access(join(root, "api-manual", `${publicId}.mdx`));

process.stdout.write(`Validated ${ids.length} generated SocQ endpoints (${catalog.schema_version}).\n`);
