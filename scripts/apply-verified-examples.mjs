import {readFile, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const examples = JSON.parse(
  await readFile(join(root, "scripts", "verified-examples.json"), "utf8"),
);

for (const filename of ["capability-catalog.json", "llms.json"]) {
  const path = join(root, filename);
  const catalog = JSON.parse(await readFile(path, "utf8"));
  for (const endpoint of catalog.endpoints) {
    if (!(endpoint.public_id in examples)) continue;
    if (examples[endpoint.public_id] === null) delete endpoint.examples;
    else endpoint.examples = [examples[endpoint.public_id]];
  }
  await writeFile(path, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

for (const [publicId, example] of Object.entries(examples)) {
  if (example === null) continue;
  for (const prefix of ["", "zh"]) {
    const path = join(root, prefix, "api-manual", `${publicId}.mdx`);
    const source = await readFile(path, "utf8");
    const requestBlock = `\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\``;
    if (!/```json\r?\n[\s\S]*?\r?\n```/.test(source)) {
      throw new Error(`No JSON request block found in ${path}`);
    }
    const updated = source.replace(/```json\r?\n[\s\S]*?\r?\n```/, requestBlock);
    await writeFile(path, updated, "utf8");
  }
}

const applied = Object.values(examples).filter((example) => example !== null).length;
const removed = Object.values(examples).filter((example) => example === null).length;
process.stdout.write(`Applied ${applied} verified request examples; removed ${removed} invalid examples.\n`);
