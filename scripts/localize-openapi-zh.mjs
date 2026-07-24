import {readFile, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = dirname(dirname(scriptPath));

const FIELD_DESCRIPTIONS = {
  ad_type: "广告类型筛选条件。",
  audio_ids: "公开的 Instagram 音频 ID。每个 ID 分别应用结果数量上限。",
  availability: "商品可用状态筛选条件。",
  callback_url: "可选的任务完成回调 URL。",
  comment_id: "公开评论的 ID。",
  condition: "商品成色筛选条件。",
  content_type: "内容类型筛选条件。",
  continuation_token: "用于继续采集评论回复的令牌。",
  country: "国家或地区筛选条件。",
  date_listed: "发布时间筛选条件。",
  delivery_method: "配送方式筛选条件。",
  duration: "内容时长筛选条件。",
  end_date: "筛选结束日期，格式为 YYYY-MM-DD。",
  expansion_token: "用于读取 Facebook 评论回复的扩展令牌。",
  feedback_id: "Facebook 父评论的反馈 ID。",
  has_captions: "是否仅返回带字幕的内容。",
  hashtags: "话题标签，可带或不带 # 前缀。",
  highlight_ids: "公开的 Instagram 精选内容 ID。",
  language: "语言代码或语言筛选条件。",
  latitude: "搜索中心点纬度，范围为 -90 到 90。",
  longitude: "搜索中心点经度，范围为 -180 到 180。",
  max_price: "最高价格筛选条件。",
  media_type: "媒体类型筛选条件。",
  min_price: "最低价格筛选条件。",
  page_id: "公开主页的 ID。",
  published_within: "内容发布时间范围。",
  query: "搜索关键词。",
  radius_km: "以公里为单位的搜索半径。",
  region: "地区代码。",
  results_limit: "最多保存的结果数，实际结果可能少于该值。",
  room_id: "公开直播间的 ID。",
  search_type: "搜索类型。",
  sort_by: "结果排序方式。",
  start_date: "筛选开始日期，格式为 YYYY-MM-DD。",
  status: "状态筛选条件。",
  url: "公开内容、主页或商品 URL。",
  urls: "公开内容、主页或商品 URL 列表。每个 URL 分别应用结果数量上限。",
  user_id: "公开账号的 ID。",
  username: "公开账号用户名。",
  usernames: "公开账号用户名列表。每个用户名分别应用结果数量上限。",
  woeids: "X 地区数字标识符，使用字符串数组传入。",
};

const COMMON_OPERATIONS = {
  "/v1/tasks/{task_id}": {
    summary: "获取任务状态和分页结果",
    responses: {"200": "任务详情"},
  },
  "/v1/tasks/{task_id}/files": {
    summary: "获取任务结果文件列表",
    responses: {"200": "任务文件列表"},
  },
  "/v1/catalog": {
    summary: "获取机器可读的能力目录",
    responses: {"200": "能力目录"},
  },
  "/v1/account": {
    summary: "获取当前账号和积分余额",
    responses: {"200": "账号摘要"},
  },
};

const PARAMETER_DESCRIPTIONS = {
  task_id: "任务 ID。",
  cursor: "分页游标。",
  limit: "本次返回的最大记录数。",
};

export async function buildZhOpenApi(openapi, root = defaultRoot) {
  const localized = structuredClone(openapi);
  localized.info.title = "SocQ Agent API 中文版";
  localized.info.description = "根据 SocQ 能力目录生成的异步社交数据 API。";

  for (const [path, pathItem] of Object.entries(localized.paths ?? {})) {
    const publicId = path.match(/^\/v1\/([^{}]+\/[^{}]+)$/)?.[1];
    for (const operation of Object.values(pathItem)) {
      if (!operation || typeof operation !== "object") continue;

      if (publicId) {
        const metadata = await readPageMetadata(root, publicId);
        operation.summary = metadata.title;
        operation.description = metadata.description;
        if (operation.responses?.["200"]) {
          operation.responses["200"].description = "任务已受理";
        }
        localizeInputSchema(operation.requestBody?.content?.["application/json"]?.schema);
      } else {
        localizeCommonOperation(path, operation);
      }
    }
  }

  const securitySchemes = localized.components?.securitySchemes ?? {};
  if (securitySchemes.bearerAuth) {
    securitySchemes.bearerAuth.description =
      "使用 `Authorization: Bearer <token>` 请求头进行身份验证。";
  }
  if (securitySchemes.apiKeyAuth) {
    securitySchemes.apiKeyAuth.description = "也可以通过 `x-api-key` 请求头提供 API Key。";
  }

  localizeSubmitResponse(localized.components?.schemas?.AgentSubmitResponse);
  return localized;
}

async function readPageMetadata(root, publicId) {
  const content = await readFile(join(root, "zh", "api-manual", `${publicId}.mdx`), "utf8");
  return {
    title: frontmatterValue(content, "title"),
    description: frontmatterValue(content, "description"),
  };
}

function frontmatterValue(content, key) {
  const match = content.match(new RegExp(`^${key}:\\s*"([^"]*)"`, "m"));
  if (!match) throw new Error(`Missing ${key} frontmatter`);
  return match[1];
}

function localizeInputSchema(schema) {
  if (!schema?.properties) return;
  for (const [name, property] of Object.entries(schema.properties)) {
    const constraints = [];
    if (property.minItems != null) constraints.push(`至少提供 ${property.minItems} 项`);
    if (property.maxItems != null) constraints.push(`最多提供 ${property.maxItems} 项`);
    const description = FIELD_DESCRIPTIONS[name] ?? property.description ?? "请求参数。";
    property.description = constraints.length
      ? `${description.replace(/[。.]$/, "")}，${constraints.join("，")}。`
      : description;

    // The localized reference is display-only. Keep constraints in Chinese prose
    // because the renderer does not localize its minItems/maxItems labels.
    delete property.minItems;
    delete property.maxItems;
  }
}

function localizeCommonOperation(path, operation) {
  const metadata = COMMON_OPERATIONS[path];
  if (metadata) {
    operation.summary = metadata.summary;
    for (const [status, description] of Object.entries(metadata.responses)) {
      if (operation.responses?.[status]) operation.responses[status].description = description;
    }
  }
  for (const parameter of operation.parameters ?? []) {
    parameter.description = PARAMETER_DESCRIPTIONS[parameter.name] ?? "请求参数。";
  }
}

function localizeSubmitResponse(schema) {
  const properties = schema?.properties;
  if (!properties) return;
  if (properties.code) properties.code.description = "HTTP 业务状态码。";
  const data = properties.data?.properties;
  if (!data) return;
  if (data.task_id) data.task_id.description = "任务 ID，用于查询任务状态和结果。";
  if (data.status) data.status.description = "任务当前状态。";
  if (data.created_time) data.created_time.description = "任务创建时间。";
  if (data.idempotent_replay) {
    data.idempotent_replay.description =
      "是否复用了由相同 Idempotency-Key 创建的已有任务。false 表示新任务，true 表示重复提交返回原任务。";
  }
}

async function main() {
  const sourcePath = join(defaultRoot, "api-manual", "agent-api", "agent-api.json");
  const outputPath = join(defaultRoot, "zh", "api-manual", "agent-api", "agent-api.json");
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const localized = await buildZhOpenApi(source);
  await writeFile(outputPath, `${JSON.stringify(localized, null, 2)}\n`, "utf8");
  process.stdout.write(`Generated Chinese OpenAPI ${localized.info.version}.\n`);
}

if (process.argv[1] && fileURLToPath(new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`)) === scriptPath) {
  await main();
}
