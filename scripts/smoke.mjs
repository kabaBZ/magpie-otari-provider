import { _internal } from "../index.mjs";

const apiKey = process.env.OTARI_API_KEY?.trim();
if (!apiKey) {
  console.error("OTARI_API_KEY is required.");
  console.error("PowerShell example:");
  console.error('  $env:OTARI_API_KEY = "otk_..."; npm run smoke');
  process.exit(2);
}

const baseURL = _internal.normalizeBaseURL(
  process.env.OTARI_BASE_URL || _internal.DEFAULT_BASE_URL,
);
const auth = {
  type: "api",
  key: apiKey,
  metadata: {
    baseURL,
    managementKey: process.env.OTARI_MANAGEMENT_KEY?.trim() || undefined,
    dashboardSession:
      process.env.OTARI_DASHBOARD_SESSION?.trim() || undefined,
  },
};

const models = await _internal.listProviderModels(
  { models: _internal.bootstrapModels() },
  { auth },
);
const modelIDs = Object.keys(models);
if (modelIDs.length === 0) {
  throw new Error("Otari returned no chat models.");
}

const withPricing = modelIDs.filter((id) => models[id].cost);
console.log(`base:   ${baseURL}`);
console.log(`models: ${modelIDs.length} (${withPricing.length} priced)`);
console.log(`first:  ${modelIDs[0]}`);

const { usage } = await _internal.loadUsage({ auth });
console.log(`usage:  ${JSON.stringify(usage)}`);

const model = process.env.OTARI_SMOKE_MODEL || modelIDs[0];
const response = await fetch(`${baseURL}/chat/completions`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    accept: "application/json",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "Say OK." }],
    max_tokens: 16,
    stream: false,
  }),
});

const text = await response.text();
if (!response.ok) {
  throw new Error(`chat ${response.status}: ${text.slice(0, 500)}`);
}
console.log(`chat:   ${response.status} ${text.slice(0, 500)}`);
