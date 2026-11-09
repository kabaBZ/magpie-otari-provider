#!/usr/bin/env node
/**
 * Create the Otari half of the two-layer routing demo.
 *
 *   Magpie (intent)  ->  Otari policy (provider / budget / failover)
 *
 * Reads OTARI_API_KEY and OTARI_DASHBOARD_SESSION from the environment, finds
 * the workspace the API key belongs to, and upserts three routing policies:
 * fast, strong, and long. It prints the Magpie commands that put those
 * policies behind one intent-routing group.
 */

const base = (process.env.OTARI_BASE_URL || "https://api.otari.ai/api/v1").replace(
  /\/+$/,
  "",
);
const apiKey = process.env.OTARI_API_KEY?.trim();
const session = process.env.OTARI_DASHBOARD_SESSION?.trim();

if (!apiKey || !session) {
  console.error("OTARI_API_KEY and OTARI_DASHBOARD_SESSION are required.");
  process.exit(2);
}

const policies = [
  {
    name: "fast",
    spec: {
      select: [{ default: "deepinfra:openai/gpt-oss-20b" }],
      on_failure: ["ovhcloud:gpt-oss-20b"],
    },
  },
  {
    name: "strong",
    spec: {
      select: [{ default: "deepinfra:deepseek-ai/DeepSeek-V4-Pro" }],
      on_failure: ["nebius:deepseek-ai/DeepSeek-V4-Pro"],
    },
  },
  {
    name: "long",
    spec: {
      select: [{ default: "nebius:deepseek-ai/DeepSeek-V4.1-Flash" }],
      on_failure: ["deepinfra:deepseek-ai/DeepSeek-V4.1-Flash"],
    },
  },
];

async function call(path, { method = "GET", body, sessionAuth = true } = {}) {
  const headers = { accept: "application/json" };
  if (sessionAuth) {
    headers.cookie = `otari_dashboard_session=${session}`;
  } else {
    headers.authorization = `Bearer ${apiKey}`;
  }
  if (body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

const keys = await call("/organizations/me/keys");
const key = (Array.isArray(keys) ? keys : keys?.data ?? []).find(
  (item) =>
    typeof item?.key_prefix === "string" &&
    typeof item?.key_suffix === "string" &&
    apiKey.startsWith(item.key_prefix) &&
    apiKey.endsWith(item.key_suffix),
);
const workspaceId = process.env.OTARI_WORKSPACE_ID?.trim() || key?.workspace_id;
if (!workspaceId) {
  throw new Error("Could not tell which workspace this API key belongs to.");
}

console.log(`workspace: ${workspaceId}`);
for (const policy of policies) {
  const saved = await call("/organizations/me/routing-policies", {
    method: "POST",
    body: {
      name: policy.name,
      workspace_id: workspaceId,
      spec: policy.spec,
    },
  });
  console.log(
    `policy: ${saved?.name ?? policy.name} -> ${policy.spec.select[0].default}`,
  );
}

console.log("\nMagpie commands:");
console.log(
  "  magpie group add otari-two-layer models=otari/fast,otari/strong,otari/long",
);
console.log(
  '  magpie group rule add otari-two-layer use=otari/fast intent="a quick question or explanation, with no code to write or change" classifier=otari/fast',
);
console.log(
  '  magpie group rule add otari-two-layer use=otari/strong intent="writing or fixing tests, implementing a feature, or changing code"',
);
console.log(
  '  magpie group rule add otari-two-layer use=otari/long tokens=128000',
);
console.log(
  "\nAgents then use the group as group/otari-two-layer.",
);
