import {readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const catalog = JSON.parse(await readFile(join(root, "capability-catalog.json"), "utf8"));
const baseUrl = (process.env.SOCQ_BASE_URL ?? "https://api.socq.ai").replace(/\/$/, "");
const apiKey = process.env.SOCQ_API_KEY;
const concurrency = Number(process.env.SOCQ_VERIFY_CONCURRENCY ?? 4);
const timeoutMs = Number(process.env.SOCQ_VERIFY_TIMEOUT_MS ?? 10 * 60_000);
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;

if (!apiKey) throw new Error("SOCQ_API_KEY is required");

const headers = {
  Accept: "application/json",
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
};
const endpoints = catalog.endpoints.filter((endpoint) => !filter || filter.test(endpoint.public_id));
const results = [];
let nextIndex = 0;

await Promise.all(Array.from({length: concurrency}, () => worker()));

results.sort((a, b) => a.public_id.localeCompare(b.public_id));
for (const result of results) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const passed = results.filter((result) => result.outcome === "passed").length;
const failed = results.length - passed;
process.stderr.write(`Verified ${results.length} examples: ${passed} passed, ${failed} failed.\n`);
if (failed) process.exitCode = 1;

async function worker() {
  while (nextIndex < endpoints.length) {
    const endpoint = endpoints[nextIndex++];
    results.push(await verify(endpoint));
  }
}

async function verify(endpoint) {
  const input = structuredClone(endpoint.examples?.[0] ?? {});

  try {
    const submitted = await request(`/v1/${endpoint.public_id}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    const taskId = submitted.data?.task_id;
    if (!taskId) {
      return failure(endpoint, input, "submit_error", submitted);
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await delay(2_500);
      const response = await request(`/v1/tasks/${taskId}?limit=1`);
      const task = response.data ?? response;
      if (task.status === "succeeded") {
        return task.result_count > 0
          ? {public_id: endpoint.public_id, outcome: "passed", result_count: task.result_count, input}
          : failure(endpoint, input, "empty_result", task.error_message);
      }
      if (["failed", "cancelled"].includes(task.status)) {
        return failure(endpoint, input, task.status, task.error_message);
      }
    }
    return failure(endpoint, input, "timeout", `Exceeded ${timeoutMs}ms`);
  } catch (error) {
    return failure(endpoint, input, "request_error", error.message);
  }
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {...init, headers});
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 500);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function failure(endpoint, input, outcome, detail) {
  return {public_id: endpoint.public_id, outcome, detail: detail ?? null, input};
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
