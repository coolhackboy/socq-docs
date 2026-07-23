import {createHash} from "node:crypto";
import {readdir, readFile, writeFile} from "node:fs/promises";
import {join, relative, sep} from "node:path";
import {fileURLToPath} from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const zhRoot = join(root, "zh");
const manifestPath = join(root, "i18n-manifest.json");

async function listMdx(directory) {
  const results = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "zh") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await listMdx(path));
    else if (entry.name.endsWith(".mdx")) results.push(path);
  }
  return results;
}

const normalize = (path) => relative(root, path).split(sep).join("/");
const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const codeBlocks = (content) => [...content.matchAll(/```[\s\S]*?```/g)].map((match) => match[0]);
const componentTags = (content) => [...content.matchAll(/<\/?[A-Z][^>]*>/g)].map((match) =>
  match[0].replace(/title="[^"]*"/g, 'title=""')
);

const sourcePaths = (await listMdx(root)).sort();
const translatedPaths = (await listMdx(zhRoot)).sort();
const sourceNames = sourcePaths.map(normalize);
const translatedNames = translatedPaths.map((path) => normalize(path).replace(/^zh\//, ""));
const manifest = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => {
  const content = await readFile(path, "utf8");
  return [normalize(path), sha256(content)];
})));

if (process.argv.includes("--update")) {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Updated i18n manifest for ${sourceNames.length} pages.\n`);
  process.exit(0);
}

const recorded = JSON.parse(await readFile(manifestPath, "utf8"));
const errors = [];
for (const name of sourceNames) {
  if (!translatedNames.includes(name)) errors.push(`Missing translation: zh/${name}`);
  if (recorded[name] !== manifest[name]) errors.push(`Stale translation: zh/${name}`);
}
for (const name of translatedNames) {
  if (!sourceNames.includes(name)) errors.push(`Orphan translation: zh/${name}`);
}
for (const sourcePath of sourcePaths) {
  const name = normalize(sourcePath);
  if (!translatedNames.includes(name)) continue;
  const [source, translated] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(join(zhRoot, name), "utf8")
  ]);
  if (JSON.stringify(codeBlocks(source)) !== JSON.stringify(codeBlocks(translated))) {
    errors.push(`Code blocks changed: zh/${name}`);
  }
  if (JSON.stringify(componentTags(source)) !== JSON.stringify(componentTags(translated))) {
    errors.push(`MDX components changed: zh/${name}`);
  }
  for (const match of translated.matchAll(/\]\(\/(?!zh\/|assets\/|fonts\/)([^)#?]+)(?:#[^)]*)?\)/g)) {
    const target = `${match[1]}.mdx`;
    if (sourceNames.includes(target)) errors.push(`English internal link in zh/${name}: /${match[1]}`);
  }
}

if (errors.length) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Validated ${sourceNames.length} English/Chinese page pairs.\n`);
