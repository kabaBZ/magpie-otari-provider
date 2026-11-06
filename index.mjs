const PROVIDER = "otari";
const DEFAULT_BASE_URL = "https://api.otari.ai/api/v1";
const EU_BASE_URL = "https://eu.api.otari.ai/api/v1";
const FALLBACK_MODEL_ID = "deepseek/deepseek-v4-pro-0813";
const ICON_URL = "https://otari.ai/apple-touch-icon-v2.png";
const NPM_PACKAGE = "@ai-sdk/openai-compatible";
const PRICING_PAGE_SIZE = 200;
const MAX_PRICING_PAGES = 20;
const USAGE_WINDOW_DAYS = 30;
const FALLBACK_SYMBOL = Symbol.for("magpie.fellBack");

class OtariHttpError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "OtariHttpError";
    if (status !== undefined) this.status = status;
    if (body !== undefined) this.body = body;
  }
}

function normalizeBaseURL(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  const input = raw || DEFAULT_BASE_URL;

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Otari base URL 必须是有效的 http(s) 地址");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Otari base URL 只支持 http 或 https");
  }
  if (url.username || url.password) {
    throw new Error("Otari base URL 不能包含用户名或密码");
  }
  if (url.search || url.hash) {
    throw new Error("Otari base URL 不能包含查询参数或片段");
  }

  const path = url.pathname.replace(/\/+$/, "") || "/api/v1";
  return new URL(url.origin + path).toString().replace(/\/+$/, "");
}

function baseURLFromAuth(auth) {
  const metadata = auth?.metadata ?? {};
  const stored = metadata.baseURL ?? auth?.baseURL;
  if (typeof stored === "string" && stored.trim()) {
    return normalizeBaseURL(stored);
  }
  if (metadata.region === "eu") return EU_BASE_URL;
  return DEFAULT_BASE_URL;
}

function normalizeProviderID(value) {
  if (typeof value !== "string") return PROVIDER;
  const id = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]*$/.test(id) ? id : PROVIDER;
}

function managementKeyFromAuth(auth) {
  const metadata = auth?.metadata ?? {};
  const explicit = metadata.masterKey ?? metadata.adminKey ?? auth?.managementKey;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();

  const candidate = metadata.managementKey;
  if (typeof candidate !== "string" || !candidate.trim()) return "";
  const key = candidate.trim();
  // A workspace token is not a management key; ignore it rather than
  // sending it to /wallet or /organizations/me/usage and collecting 401s.
  return key.startsWith("otk_") ? "" : key;
}

function dashboardSessionFromAuth(auth) {
  const metadata = auth?.metadata ?? {};
  const raw =
    metadata.dashboardSession ??
    metadata.sessionCookie ??
    metadata.otariDashboardSession ??
    auth?.dashboardSession;
  if (typeof raw !== "string" || !raw.trim()) return "";
  const value = raw.trim();
  const match = value.match(/(?:^|;\s*)otari_dashboard_session=([^;]+)/);
  return match ? match[1] : value;
}

function dashboardBaseURL(auth) {
  const base = baseURLFromAuth(auth);
  const url = new URL(base);
  if (url.hostname === "api.otari.ai") return "https://otari.ai/api/v1";
  if (url.hostname === "eu.api.otari.ai") return "https://eu.otari.ai/api/v1";
  return base;
}

function sessionHeaders(session) {
  return {
    cookie: `otari_dashboard_session=${session}`,
    accept: "application/json",
  };
}

function responseSetCookies(headers) {
  try {
    if (typeof headers?.getSetCookie === "function") {
      const all = headers.getSetCookie();
      if (Array.isArray(all) && all.length) return all;
    }
  } catch {
    // Older fetch implementations expose only the combined header.
  }
  const combined = headers?.get?.("set-cookie");
  return combined ? [combined] : [];
}

async function loginDashboardSession({
  email,
  password,
  region = "global",
  signal,
  fetchImpl = fetch,
}) {
  const base =
    region === "eu"
      ? "https://eu.otari.ai/api/v1"
      : "https://otari.ai/api/v1";
  const origin = new URL(base).origin;
  const response = await fetchImpl(`${base}/auth/session`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin,
      referer: `${origin}/dashboard/`,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0",
    },
    body: JSON.stringify({ email, password }),
    signal,
  });
  const payload = await readJSON(response, "账号登录", {
    expireOn401: false,
  });
  const cookies = responseSetCookies(response.headers);
  let session = "";
  for (const cookie of cookies) {
    const match = String(cookie).match(
      /(?:^|;\s*)otari_dashboard_session=([^;]+)/,
    );
    if (match) {
      session = match[1];
      break;
    }
  }
  if (!session) {
    throw new OtariHttpError("登录成功但没有返回 Dashboard session", {
      status: response.status,
    });
  }
  return {
    session,
    expiresAt: payload?.expires_at ?? null,
    userId: payload?.user_id ?? null,
    organizationId: payload?.active_organization_id ?? null,
  };
}

function apiURL(baseURL, path, query) {
  const base = baseURL.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(base + suffix);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function authHeaders(key) {
  return {
    authorization: `Bearer ${key}`,
    accept: "application/json",
  };
}

function finiteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatUSD(value) {
  const number = finiteNumber(value) ?? 0;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(number);
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(finiteNumber(value) ?? 0);
}

async function responseDetail(response) {
  try {
    const text = await response.text();
    return text.replace(/\s+/g, " ").trim().slice(0, 500);
  } catch {
    return "";
  }
}

async function readJSON(response, label, { expireOn401 = true } = {}) {
  if (response.status === 401) {
    const detail = await responseDetail(response);
    const error = new OtariHttpError(
      `Otari 拒绝了 API key（401）${detail ? `：${detail}` : ""}`,
      { status: 401, body: detail },
    );
    if (expireOn401) error.signIn = "expired";
    throw error;
  }

  if (!response.ok) {
    const detail = await responseDetail(response);
    throw new OtariHttpError(
      `Otari ${label} 返回 ${response.status}${detail ? `：${detail}` : ""}`,
      { status: response.status, body: detail },
    );
  }

  try {
    return await response.json();
  } catch {
    throw new OtariHttpError(`Otari ${label} 返回了无效 JSON`, {
      status: response.status,
    });
  }
}

function isChatModel(model) {
  if (!model || typeof model.id !== "string" || !model.id.trim()) return false;
  return model.type == null || model.type === "chat";
}

function normalizeModalities(list) {
  const known = ["text", "image", "audio", "video", "pdf"];
  const values = new Set(
    (Array.isArray(list) ? list : [])
      .map((value) => String(value).toLowerCase())
      .filter(Boolean),
  );
  if (values.has("file") || values.has("document")) values.add("pdf");

  const output = { text: true, image: false, audio: false, video: false, pdf: false };
  for (const kind of known) {
    if (values.has(kind)) output[kind] = true;
  }
  return output;
}

function pricingCost(pricing) {
  if (!pricing || typeof pricing !== "object") return undefined;
  return {
    input: finiteNumber(pricing.input_price_per_million) ?? 0,
    output: finiteNumber(pricing.output_price_per_million) ?? 0,
    cache: {
      read: finiteNumber(pricing.cache_read_price_per_million) ?? 0,
      write: finiteNumber(pricing.cache_write_price_per_million) ?? 0,
    },
  };
}

function isFreePricing(pricing) {
  const cost = pricingCost(pricing);
  if (!cost) return false;
  return (
    cost.input === 0 &&
    cost.output === 0 &&
    cost.cache.read === 0 &&
    cost.cache.write === 0
  );
}

function positiveInteger(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? Math.round(number) : 0;
}

function mapModel(
  model,
  { baseURL = DEFAULT_BASE_URL, pricing, providerID = PROVIDER } = {},
) {
  const price = pricing ?? model.pricing ?? null;
  const cost = pricingCost(price);
  const parameters = Array.isArray(model.supported_parameters)
    ? model.supported_parameters.map((value) => String(value).toLowerCase())
    : null;
  const hasAny = (...names) =>
    parameters ? names.some((name) => parameters.includes(name)) : null;

  const temperature = hasAny("temperature");
  const reasoning = hasAny(
    "reasoning",
    "reasoning_effort",
    "reasoning_content",
    "include_reasoning",
    "thinking",
  );
  const toolcall = hasAny(
    "tools",
    "tool_call",
    "tool_choice",
    "function_calling",
    "functions",
  );
  const input = normalizeModalities(model.architecture?.input_modalities);
  const output = normalizeModalities(model.architecture?.output_modalities);

  const mapped = {
    id: model.id,
    providerID,
    name:
      typeof model.name === "string" && model.name.trim()
        ? model.name.trim()
        : model.id,
    api: {
      id: model.id,
      url: normalizeBaseURL(baseURL),
      npm: NPM_PACKAGE,
    },
    limit: {
      context: positiveInteger(model.context_window),
      output: positiveInteger(model.max_output_tokens),
    },
    capabilities: {
      temperature: temperature ?? true,
      reasoning: reasoning ?? false,
      attachment: input.image || input.audio || input.video || input.pdf,
      toolcall: toolcall ?? true,
      input,
      output,
    },
    variants: {},
  };

  if (temperature !== null) mapped.temperature = temperature;
  if (cost) mapped.cost = cost;
  if (price && isFreePricing(price)) mapped.free = true;
  return mapped;
}

function bootstrapModels() {
  return {
    [FALLBACK_MODEL_ID]: {
      name: "DeepSeek V4 Pro (Otari)",
      limit: { context: 0, output: 0 },
      tool_call: true,
      modalities: { input: ["text"], output: ["text"] },
    },
  };
}

function makeFallbackList(provider) {
  const source =
    provider?.models && Object.keys(provider.models).length
      ? provider.models
      : bootstrapModels();
  const list = { ...source };
  Object.defineProperty(list, FALLBACK_SYMBOL, {
    value: true,
    enumerable: false,
  });
  return list;
}

async function fetchModels({ auth, signal, fetchImpl = fetch }) {
  const baseURL = baseURLFromAuth(auth);
  const response = await fetchImpl(apiURL(baseURL, "/models"), {
    method: "GET",
    headers: authHeaders(auth.key),
    signal,
  });
  const payload = await readJSON(response, "模型列表");
  if (!Array.isArray(payload?.data)) {
    throw new OtariHttpError("Otari 模型列表格式无效", { status: response.status });
  }
  return payload.data.filter(isChatModel);
}

async function fetchCurrentPricing({ auth, signal, fetchImpl = fetch }) {
  const baseURL = baseURLFromAuth(auth);
  const prices = {};
  let skip = 0;

  for (let page = 0; page < MAX_PRICING_PAGES; page += 1) {
    const response = await fetchImpl(
      apiURL(baseURL, "/pricing/current", {
        skip,
        limit: PRICING_PAGE_SIZE,
      }),
      {
        method: "GET",
        headers: authHeaders(auth.key),
        signal,
      },
    );
    const payload = await readJSON(response, "价格列表", {
      expireOn401: false,
    });
    if (!Array.isArray(payload?.data)) {
      throw new OtariHttpError("Otari 价格列表格式无效", {
        status: response.status,
      });
    }

    for (const row of payload.data) {
      if (!row || typeof row.model_key !== "string") continue;
      if (row.kind && row.kind !== "model") continue;
      prices[row.model_key] = row;
    }

    skip += payload.data.length;
    const total = finiteNumber(payload.count);
    if (
      payload.data.length === 0 ||
      payload.data.length < PRICING_PAGE_SIZE ||
      (total !== null && skip >= total)
    ) {
      break;
    }
  }

  return prices;
}

async function listProviderModels(
  provider,
  { auth, signal, fetchImpl = fetch, providerID = PROVIDER } = {},
) {
  const baseURL = baseURLFromAuth(auth);
  const models = await fetchModels({ auth, signal, fetchImpl });
  let prices = {};

  if (models.some((model) => !model.pricing)) {
    try {
      prices = await fetchCurrentPricing({ auth, signal, fetchImpl });
    } catch (error) {
      if (error?.signIn === "expired") throw error;
    }
  }

  const listed = {};
  for (const model of models) {
    const mapped = mapModel(model, {
      baseURL,
      pricing: model.pricing ?? prices[model.id] ?? null,
      providerID,
    });
    listed[mapped.id] = mapped;
  }
  return listed;
}

function makeAuthorizedFetch(key, fetchImpl = fetch) {
  return async function otariFetch(input, init = {}) {
    const baseHeaders =
      input instanceof Request ? new Headers(input.headers) : new Headers();
    if (init?.headers) {
      for (const [name, value] of new Headers(init.headers)) {
        baseHeaders.set(name, value);
      }
    }
    if (!baseHeaders.has("authorization")) {
      baseHeaders.set("authorization", `Bearer ${key}`);
    }
    if (!baseHeaders.has("accept")) baseHeaders.set("accept", "application/json");
    return fetchImpl(input, { ...init, headers: baseHeaders });
  };
}

async function fetchUsageSummary({ auth, signal, fetchImpl = fetch, now = Date.now() }) {
  const baseURL = baseURLFromAuth(auth);
  const endDate = new Date(now);
  const startDate = new Date(now - USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const response = await fetchImpl(
    apiURL(baseURL, "/key/usage/summary", {
      dimensions: "none",
      bucket: "day",
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
    }),
    {
      method: "GET",
      headers: authHeaders(auth.key),
      signal,
    },
  );
  return readJSON(response, "用量摘要", { expireOn401: false });
}

async function fetchBudget({ auth, signal, fetchImpl = fetch }) {
  const baseURL = baseURLFromAuth(auth);
  const response = await fetchImpl(apiURL(baseURL, "/key/budget"), {
    method: "GET",
    headers: authHeaders(auth.key),
    signal,
  });
  return readJSON(response, "预算", { expireOn401: false });
}

async function fetchSessionJSON({
  auth,
  path,
  query,
  signal,
  fetchImpl = fetch,
  label,
}) {
  const session = dashboardSessionFromAuth(auth);
  if (!session) {
    throw new OtariHttpError("缺少 Otari Dashboard session", { status: 403 });
  }
  const response = await fetchImpl(
    apiURL(dashboardBaseURL(auth), path, query),
    {
      method: "GET",
      headers: sessionHeaders(session),
      signal,
    },
  );
  return readJSON(response, label, { expireOn401: false });
}

function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function fetchSessionOrganizationKeys({
  auth,
  signal,
  fetchImpl = fetch,
}) {
  const payload = await fetchSessionJSON({
    auth,
    path: "/organizations/me/keys",
    query: { limit: 1000 },
    signal,
    fetchImpl,
    label: "组织 Key 列表",
  });
  return listFromPayload(payload);
}

async function fetchSessionBudgets({ auth, signal, fetchImpl = fetch }) {
  const payload = await fetchSessionJSON({
    auth,
    path: "/organizations/me/budgets",
    query: { skip: 0, limit: 1000 },
    signal,
    fetchImpl,
    label: "组织预算",
  });
  return listFromPayload(payload);
}

async function fetchSessionSpendCeilings({
  auth,
  signal,
  fetchImpl = fetch,
}) {
  const payload = await fetchSessionJSON({
    auth,
    path: "/organizations/me/spend-ceilings",
    query: { skip: 0, limit: 1000 },
    signal,
    fetchImpl,
    label: "组织预算上限",
  });
  return listFromPayload(payload);
}

async function fetchSessionOrganizationUsageSummary({
  auth,
  signal,
  fetchImpl = fetch,
  now = Date.now(),
}) {
  const endDate = new Date(now);
  const startDate = new Date(now - USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return fetchSessionJSON({
    auth,
    path: "/organizations/me/usage/summary",
    query: {
      dimensions: "none",
      bucket: "day",
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
    },
    signal,
    fetchImpl,
    label: "组织用量摘要",
  });
}

async function fetchSessionWallet({ auth, signal, fetchImpl = fetch }) {
  const session = dashboardSessionFromAuth(auth);
  if (!session) return null;
  return fetchSessionJSON({
    auth,
    path: "/wallet",
    signal,
    fetchImpl,
    label: "账号钱包",
  });
}

async function fetchSessionRoutingPolicies({
  auth,
  workspaceId,
  signal,
  fetchImpl = fetch,
}) {
  const payload = await fetchSessionJSON({
    auth,
    path: "/organizations/me/routing-policies",
    query: workspaceId ? { workspace_id: workspaceId } : undefined,
    signal,
    fetchImpl,
    label: "路由策略",
  });
  return listFromPayload(payload);
}

async function fetchDashboardKeyBudget({
  auth,
  signal,
  fetchImpl = fetch,
}) {
  const session = dashboardSessionFromAuth(auth);
  if (!session) return null;

  const keys = await fetchSessionOrganizationKeys({ auth, signal, fetchImpl });
  const key = keys.find(
    (item) =>
      typeof item?.key_prefix === "string" &&
      typeof item?.key_suffix === "string" &&
      auth.key.startsWith(item.key_prefix) &&
      auth.key.endsWith(item.key_suffix),
  );
  if (!key) return null;

  const [ceilings, budgets] = await Promise.all([
    fetchSessionSpendCeilings({ auth, signal, fetchImpl }),
    fetchSessionBudgets({ auth, signal, fetchImpl }),
  ]);
  const ceiling = ceilings.find(
    (item) =>
      item?.scope_type === "api_token" && item?.scope_id === key.id,
  );
  if (!ceiling) return null;
  const budget = budgets.find(
    (item) => item?.budget_id === ceiling.budget_id,
  );

  const maxBudget =
    finiteNumber(ceiling.max_budget) ?? finiteNumber(budget?.max_budget);
  const currentSpend = finiteNumber(ceiling.current_spend) ?? 0;
  const reservedSpend = finiteNumber(ceiling.reserved_spend) ?? 0;

  return {
    keyId: key.id,
    keyName: key.key_name,
    workspaceId: key.workspace_id ?? null,
    budgetName: budget?.name ?? ceiling.name,
    maxBudget,
    currentSpend,
    reservedSpend,
    remaining:
      maxBudget === null
        ? null
        : Math.max(0, maxBudget - currentSpend - reservedSpend),
    tokenLimit: finiteNumber(ceiling.token_limit),
    currentTokens: finiteNumber(ceiling.current_tokens),
    requestLimit: finiteNumber(ceiling.request_limit),
    currentRequests: finiteNumber(ceiling.current_requests),
    periodStart: ceiling.period_start ?? null,
    periodEnd: ceiling.period_end ?? null,
    resetAlignment:
      ceiling.reset_alignment ?? budget?.reset_alignment ?? null,
  };
}

async function fetchWallet({ auth, signal, fetchImpl = fetch }) {
  const managementKey = managementKeyFromAuth(auth);
  if (!managementKey) {
    throw new OtariHttpError("缺少 Otari 管理密钥", { status: 403 });
  }
  const baseURL = baseURLFromAuth(auth);
  const response = await fetchImpl(apiURL(baseURL, "/wallet"), {
    method: "GET",
    headers: authHeaders(managementKey),
    signal,
  });
  return readJSON(response, "钱包", { expireOn401: false });
}

async function fetchOrganizationUsageSummary({
  auth,
  signal,
  fetchImpl = fetch,
  now = Date.now(),
}) {
  const managementKey = managementKeyFromAuth(auth);
  if (!managementKey) {
    throw new OtariHttpError("缺少 Otari 管理密钥", { status: 403 });
  }
  const baseURL = baseURLFromAuth(auth);
  const endDate = new Date(now);
  const startDate = new Date(now - USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const response = await fetchImpl(
    apiURL(baseURL, "/organizations/me/usage/summary", {
      dimensions: "none",
      bucket: "day",
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
    }),
    {
      method: "GET",
      headers: authHeaders(managementKey),
      signal,
    },
  );
  return readJSON(response, "组织用量摘要", { expireOn401: false });
}

function pickBudgetLimit(budget) {
  const limits = Array.isArray(budget?.limits) ? budget.limits : [];
  const candidates = limits.filter((limit) => {
    if (!limit || typeof limit !== "object") return false;
    return (
      finiteNumber(limit.limit_usd) !== null ||
      finiteNumber(limit.remaining_usd) !== null
    );
  });

  candidates.sort((a, b) => {
    const left = finiteNumber(a.remaining_usd);
    const right = finiteNumber(b.remaining_usd);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  });
  return candidates[0] ?? null;
}

function scopeLabel(scope) {
  switch (scope) {
    case "api_token":
      return "API Key";
    case "workspace_member":
      return "工作区成员";
    case "org_member":
      return "组织成员";
    case "workspace":
      return "工作区";
    case "organization":
      return "组织";
    case "user":
      return "用户";
    default:
      return typeof scope === "string" && scope ? scope : "Otari";
  }
}

function walletAmount(wallet) {
  return (
    finiteNumber(wallet?.available) ??
    finiteNumber(wallet?.balance) ??
    finiteNumber(wallet?.offered_balance)
  );
}

function summarizePolicySpec(policy) {
  if (!policy?.spec || typeof policy.spec !== "object") {
    return typeof policy?.source === "string" ? policy.source : "";
  }
  try {
    const spec = JSON.stringify(policy.spec);
    return spec.length > 500 ? `${spec.slice(0, 500)}…` : spec;
  } catch {
    return "";
  }
}

function buildUsage({
  summary,
  budget,
  wallet,
  keyBudget,
  routingPolicies,
  errors = [],
  management = false,
  dashboard = false,
} = {}) {
  const windows = [];
  const walletRemaining = walletAmount(wallet);
  const remaining =
    walletRemaining ??
    finiteNumber(budget?.remaining_usd) ??
    finiteNumber(keyBudget?.remaining);
  const walletCurrency = wallet?.currency || "USD";
  const limit = pickBudgetLimit(budget);

  if (keyBudget && finiteNumber(keyBudget.maxBudget) > 0) {
    const maxBudget = finiteNumber(keyBudget.maxBudget);
    const currentSpend = finiteNumber(keyBudget.currentSpend) ?? 0;
    const reservedSpend = finiteNumber(keyBudget.reservedSpend) ?? 0;
    const window = {
      name: keyBudget.budgetName
        ? `Key 预算 (${keyBudget.budgetName})`
        : "Key 预算",
      used: round((currentSpend / maxBudget) * 100, 2),
      amount: round(currentSpend, 6),
      limit: round(maxBudget, 6),
      unit: "USD",
      display:
        `$${formatUSD(currentSpend)} / $${formatUSD(maxBudget)}` +
        (reservedSpend > 0
          ? ` · $${formatUSD(reservedSpend)} 预留`
          : ""),
    };
    if (keyBudget.periodEnd) window.resetsAt = keyBudget.periodEnd;
    windows.push(window);
  } else if (limit) {
    const limitUSD = finiteNumber(limit.limit_usd);
    const usedUSD = finiteNumber(limit.used_usd);
    const name = `预算 (${scopeLabel(limit.scope)})`;

    if (limitUSD !== null && limitUSD > 0 && usedUSD !== null) {
      const window = {
        name,
        used: round((usedUSD / limitUSD) * 100, 2),
        amount: round(usedUSD, 6),
        limit: round(limitUSD, 6),
        unit: "USD",
        display: `$${formatUSD(usedUSD)} / $${formatUSD(limitUSD)}`,
      };
      if (typeof limit.resets_at === "string" && limit.resets_at) {
        window.resetsAt = limit.resets_at;
      }
      windows.push(window);
    } else if (limitUSD !== null && limitUSD > 0 && remaining !== null) {
      windows.push({
        name,
        limit: round(limitUSD, 6),
        unit: "USD",
        display: `$${formatUSD(remaining)} 剩余 / $${formatUSD(limitUSD)}`,
      });
    }
  }

  if (remaining !== null) {
    windows.push({
      name: "余额",
      balance: round(remaining, 6),
      unit: walletCurrency,
      aside: true,
    });
  }

  if (summary?.totals) {
    const totals = summary.totals;
    const cost = finiteNumber(totals.cost) ?? 0;
    const requests = finiteNumber(totals.request_count) ?? 0;
    const tokens = finiteNumber(totals.total_tokens) ?? 0;
    const failures = finiteNumber(totals.error_count) ?? 0;
    let display =
      `$${formatUSD(cost)} · ${formatCount(requests)} 次请求 · ` +
      `${formatCount(tokens)} tokens`;
    if (failures > 0) display += ` · ${formatCount(failures)} 错误`;
    windows.push({ name: "最近 30 天", display, aside: true });
  }

  if (Array.isArray(routingPolicies)) {
    if (routingPolicies.length === 0) {
      windows.push({ name: "Otari 路由", display: "未配置路由策略", aside: true });
    } else {
      for (const policy of routingPolicies.slice(0, 8)) {
        const name =
          typeof policy?.name === "string" && policy.name
            ? policy.name
            : "未命名策略";
        const source =
          typeof policy?.source === "string" && policy.source
            ? `[${policy.source}] `
            : "";
        windows.push({
          name: `路由：${name}`,
          display: `${source}${summarizePolicySpec(policy)}`,
          aside: true,
        });
      }
      if (routingPolicies.length > 8) {
        windows.push({
          name: "Otari 路由",
          display: `还有 ${routingPolicies.length - 8} 条策略未显示`,
          aside: true,
        });
      }
    }
  }

  const usage = { windows };
  if (windows.length === 0) {
    usage.error = dashboard
      ? "Otari Dashboard session 无法匹配当前 Key 的预算"
      : management
      ? "Otari 管理密钥无法读取用量或余额"
      : "Otari 托管 API 的用量和余额需要管理密钥；请在插件登录时填写管理密钥。";
    if (!management && !dashboard && errors.length > 0) {
      usage.error += "（自托管可继续使用 /key/usage/summary 与 /key/budget）";
    }
  }
  return usage;
}

async function loadUsage({
  auth,
  signal,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  const errors = [];
  let summary;
  let budget;
  let wallet;
  let keyBudget;
  let routingPolicies;
  const dashboardSession = dashboardSessionFromAuth(auth);
  const dashboard = Boolean(dashboardSession);
  const managementKey = managementKeyFromAuth(auth);
  const management = Boolean(managementKey);

  const attempt = async (label, run) => {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      const quiet404 =
        label === "用量" || label === "预算" || label === "钱包";
      if (!(error?.status === 404 && quiet404)) {
        errors.push(`${label}：${error?.message ?? error}`);
      }
      return { ok: false, error };
    }
  };

  if (dashboardSession) {
    const result = await attempt("Dashboard 预算", () =>
      fetchDashboardKeyBudget({ auth, signal, fetchImpl }),
    );
    if (result.ok) keyBudget = result.value;
    if (!summary) {
      const summaryResult = await attempt("Dashboard 用量", () =>
        fetchSessionOrganizationUsageSummary({ auth, signal, fetchImpl, now }),
      );
      if (summaryResult.ok) summary = summaryResult.value;
    }
    if (!wallet) {
      const walletResult = await attempt("Dashboard 钱包", () =>
        fetchSessionWallet({ auth, signal, fetchImpl }),
      );
      if (walletResult.ok) wallet = walletResult.value;
    }
    if (keyBudget?.workspaceId) {
      const policiesResult = await attempt("Dashboard 路由", () =>
        fetchSessionRoutingPolicies({
          auth,
          workspaceId: keyBudget.workspaceId,
          signal,
          fetchImpl,
        }),
      );
      if (policiesResult.ok) routingPolicies = policiesResult.value;
    }
  }

  if (managementKey) {
    if (!wallet) {
      const walletResult = await attempt("钱包", () =>
        fetchWallet({ auth, signal, fetchImpl }),
      );
      if (walletResult.ok) wallet = walletResult.value;
    }
    if (!summary) {
      const summaryResult = await attempt("组织用量", () =>
        fetchOrganizationUsageSummary({ auth, signal, fetchImpl, now }),
      );
      if (summaryResult.ok) summary = summaryResult.value;
    }
  }

  if (!summary) {
    const result = await attempt("用量", () =>
      fetchUsageSummary({ auth, signal, fetchImpl, now }),
    );
    if (result.ok) summary = result.value;
  }

  if (!wallet && !keyBudget) {
    const result = await attempt("预算", () =>
      fetchBudget({ auth, signal, fetchImpl }),
    );
    if (result.ok) budget = result.value;
  }

  const usage = buildUsage({
    summary,
    budget,
    wallet,
    keyBudget,
    routingPolicies,
    errors,
    management,
    dashboard,
  });
  return {
    usage,
    errors,
    management,
    dashboard,
    keyBudget,
    routingPolicies,
  };
}

async function log(client, level, message) {
  try {
    await client?.app?.log?.({
      body: {
        service: "otari",
        level,
        message: String(message ?? "").slice(0, 2000),
      },
    });
  } catch {
    // A logging failure must not break a provider or quota read.
  }
}

function validateCustomBaseURL(value) {
  if (!value || !String(value).trim()) return "请输入自托管地址";
  try {
    normalizeBaseURL(value);
    return undefined;
  } catch (error) {
    return error?.message ?? "无效的 Otari base URL";
  }
}

export const OtariPlugin = async ({ client } = {}, options = {}) => {
  const providerID = normalizeProviderID(options?.providerID);

  return {
  config: async (cfg) => {
    cfg.provider ??= {};
    const provider = (cfg.provider[providerID] ??= {});
    provider.name ??= "Otari";
    provider.npm ??= NPM_PACKAGE;
    provider.api ??= DEFAULT_BASE_URL;
    if (!provider.models || Object.keys(provider.models).length === 0) {
      provider.models = bootstrapModels();
    }
  },

  auth: {
    provider: providerID,
    icon: ICON_URL,
    methods: [
      {
        type: "api",
        label: "Otari API Key",
        keyless: true,
        prompts: [
          {
            type: "select",
            key: "region",
            message: "Otari 接入区域",
            options: [
              { label: "全球 (api.otari.ai)", value: "global" },
              { label: "欧洲 (eu.api.otari.ai)", value: "eu" },
            ],
          },
          {
            type: "password",
            key: "apiKey",
            message: "Otari API Key（必填）",
            placeholder: "otk_…",
          },
          {
            type: "select",
            key: "authMode",
            message: "Dashboard 登录方式（二选一，也可跳过）",
            options: [
              {
                label: "使用 Dashboard session cookie",
                value: "cookie",
                hint: "手动粘贴 otari_dashboard_session",
              },
              {
                label: "使用邮箱/密码登录（自动获取 session）",
                value: "account",
                hint: "密码只用于本次登录，不保存",
              },
              {
                label: "跳过（只能读取模型和价格）",
                value: "skip",
                hint: "无法获取余额、Key 预算、刷新时间和路由",
              },
            ],
          },
          {
            type: "password",
            key: "dashboardSession",
            when: { key: "authMode", op: "eq", value: "cookie" },
            message:
              "Otari Dashboard session（必填；不填无法获取账号余额、Key 预算、刷新时间和路由策略）",
            placeholder:
              "只填 otari_dashboard_session 的值",
            validate: (value) =>
              String(value ?? "").trim()
                ? undefined
                : "请输入 otari_dashboard_session 的值",
          },
          {
            type: "text",
            key: "email",
            when: { key: "authMode", op: "eq", value: "account" },
            message: "Otari 账号（仅用于本次登录，不保存密码）",
            placeholder: "请输入账号",
          },
          {
            type: "password",
            key: "password",
            when: { key: "authMode", op: "eq", value: "account" },
            message: "Otari 密码（仅用于本次登录，不保存）",
            placeholder: "请输入密码",
          },
        ],
        async authorize(inputs = {}, { signal } = {}) {
          const region = inputs?.region === "eu" ? "eu" : "global";
          const apiKey = String(inputs?.apiKey ?? "").trim();
          if (!apiKey) {
            return { type: "failed", error: "Otari API Key 必填" };
          }
          const mode = inputs?.authMode;
          const verifyApiKey = async () => {
            try {
              await fetchModels({
                auth: { type: "api", key: apiKey, metadata: { region } },
                signal,
              });
              return null;
            } catch (error) {
              return `Otari API Key 验证失败：${error?.message ?? error}`;
            }
          };

          if (mode === "skip") {
            const keyError = await verifyApiKey();
            if (keyError) return { type: "failed", error: keyError };
            if (inputs) delete inputs.apiKey;
            return {
              type: "success",
              key: apiKey,
              metadata: { region },
            };
          }

          if (mode === "cookie") {
            const session = String(inputs?.dashboardSession ?? "").trim();
            if (!session) {
              return {
                type: "failed",
                error: "请填写 Otari Dashboard session，或选择账密登录/跳过",
              };
            }
            const keyError = await verifyApiKey();
            if (keyError) return { type: "failed", error: keyError };
            try {
              await fetchSessionWallet({
                auth: {
                  type: "api",
                  key: apiKey,
                  metadata: { region, dashboardSession: session },
                },
                signal,
              });
            } catch (error) {
              return {
                type: "failed",
                error: `Otari Dashboard session 无效或已过期：${error?.message ?? error}`,
              };
            }
            if (inputs) delete inputs.apiKey;
            return {
              type: "success",
              key: apiKey,
              metadata: { region, dashboardSession: session },
            };
          }

          if (mode !== "account") {
            return {
              type: "failed",
              error: "请选择 Dashboard 登录方式：cookie、account 或 skip",
            };
          }

          const email = String(inputs?.email ?? "").trim();
          const password = String(inputs?.password ?? "");
          if (!email) {
            return { type: "failed", error: "Otari 账号邮箱必填" };
          }
          if (!password) {
            return { type: "failed", error: "Otari 账号密码必填" };
          }
          const keyError = await verifyApiKey();
          if (keyError) return { type: "failed", error: keyError };
          let login;
          try {
            login = await loginDashboardSession({
              email,
              password,
              region,
              signal,
            });
          } catch (error) {
            return {
              type: "failed",
              error: `Otari 账号登录失败：${error?.message ?? error}`,
            };
          }

          if (inputs) {
            delete inputs.apiKey;
            delete inputs.password;
          }
          return {
            type: "success",
            key: apiKey,
            metadata: {
              region,
              dashboardSession: login.session,
              dashboardExpiresAt: login.expiresAt,
              dashboardUserId: login.userId,
              dashboardOrganizationId: login.organizationId,
              accountEmail: email,
            },
          };
        },
      },
    ],

    async loader(getAuth) {
      const auth = await getAuth();
      if (auth?.type !== "api" || !auth.key) return {};
      return {
        baseURL: baseURLFromAuth(auth),
        apiKey: auth.key,
        fetch: makeAuthorizedFetch(auth.key),
      };
    },

    async usage(getAuth, _provider, options = {}) {
      const auth = await getAuth();
      if (auth?.type !== "api" || !auth.key) {
        return { error: "Otari 未登录", windows: [] };
      }

      try {
        const { usage, errors } = await loadUsage({
          auth,
          signal: options?.signal,
        });
        for (const message of errors) {
          await log(client, "warn", message);
        }
        return usage;
      } catch (error) {
        if (error?.signIn === "expired") {
          return {
            signIn: "expired",
            error: "Otari API key 已失效，请重新登录",
            windows: [],
          };
        }
        await log(client, "warn", `Otari usage failed: ${error?.message ?? error}`);
        return { error: "无法读取 Otari 用量", windows: [] };
      }
    },
  },

  provider: {
    id: providerID,
    async models(provider, context = {}) {
      const { auth, signal } = context;
      if (auth?.type !== "api" || !auth.key) {
        return provider?.models ?? bootstrapModels();
      }

      try {
        return await listProviderModels(provider ?? { models: bootstrapModels() }, {
          auth,
          signal,
          providerID,
        });
      } catch (error) {
        if (error?.status === 401 || error?.signIn === "expired") throw error;
        await log(
          client,
          "warn",
          `Otari model list failed: ${error?.message ?? error}`,
        );
        return makeFallbackList(provider);
      }
    },
  },
  };
};

export const _internal = {
  PROVIDER,
  DEFAULT_BASE_URL,
  EU_BASE_URL,
  FALLBACK_MODEL_ID,
  ICON_URL,
  FALLBACK_SYMBOL,
  OtariHttpError,
  normalizeBaseURL,
  normalizeProviderID,
  baseURLFromAuth,
  managementKeyFromAuth,
  dashboardSessionFromAuth,
  dashboardBaseURL,
  sessionHeaders,
  responseSetCookies,
  loginDashboardSession,
  bootstrapModels,
  mapModel,
  isChatModel,
  fetchModels,
  fetchCurrentPricing,
  listProviderModels,
  makeAuthorizedFetch,
  makeFallbackList,
  fetchWallet,
  fetchOrganizationUsageSummary,
  fetchSessionOrganizationUsageSummary,
  fetchSessionOrganizationKeys,
  fetchSessionBudgets,
  fetchSessionSpendCeilings,
  fetchSessionWallet,
  fetchSessionRoutingPolicies,
  fetchDashboardKeyBudget,
  fetchUsageSummary,
  fetchBudget,
  buildUsage,
  loadUsage,
  formatUSD,
  formatCount,
  pickBudgetLimit,
};
