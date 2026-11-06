# Magpie Otari Provider

给 [Magpie](https://usemagpie.ai/) 用的 Otari 供应商插件。它把 Otari 的模型、价格、用量、余额和 Chat Completions 接到 Magpie 里。

模型引用格式：

```text
otari/<Otari 模型 ID>
```

例如：

```text
otari/deepseek/deepseek-v4.1-flash
```

Otari 的模型 ID 本身可以带斜杠。Magpie 按第一个斜杠分隔供应商和模型，后面的斜杠属于模型 ID。

## 功能

- 从 `GET /models` 动态读取当前 API Key 可用的 Chat 模型。
- 把 Otari 的每百万 Token 价格映射到 Magpie 的模型价格。
- 模型缺少价格时，回退到 `GET /pricing/current` 合并。
- 通过 `POST /chat/completions` 调用模型，支持流式和非流式响应。
- 当前登录只开放托管全球站；EU 和自托管登录暂时隐藏。
- 插件图标直接使用 Otari 官网的 `apple-touch-icon-v2.png`。
- 账号余额读取 `GET /wallet`。
- Key 预算和刷新时间读取 `GET /organizations/me/spend-ceilings`。
- 配置路由读取 `GET /organizations/me/routing-policies`。

## 重要：供应商 ID 冲突

Magpie 里如果已经有一个手建的 `otari` 供应商，插件不能再用 `otari` 这个 ID。Magpie 会把插件自动改名成 `otari-plugin`，并可能把它放到隐藏状态。

有两种处理方式：

1. 在 Magpie 里删除旧的 `otari` 手建供应商，插件继续使用 `otari`。
2. 给插件设置一个不冲突的 ID，例如 `otari-provider`：

```bash
magpie plugin options otari-provider '{"providerID":"otari-provider"}'
```

设置后模型前缀是：

```text
otari-provider/deepseek/deepseek-v4.1-flash
```

## 安装

在本目录运行：

```bash
magpie plugin add .
```

如果要用独立供应商 ID，先设置插件选项，再重新登录：

```bash
magpie plugin options otari-provider '{"providerID":"otari-provider"}'
magpie plugin login otari-provider
```

在 Magpie 的插件页面登录也可以。插件提供两种登录方式。

### 方式一：API Key + 可选 Dashboard session

登录顺序固定为：

### 1. Otari 接入区域

先选：

- `全球 (api.otari.ai)`
- `欧洲 (eu.api.otari.ai)`

自托管和自定义 base URL 暂时隐藏。

### 2. Otari API Key（必填）

填写 Otari API Key，通常以 `otk_` 开头。插件会先用它验证 `/models`。

### 3. Otari Dashboard session（可选）

填写：

```text
Otari Dashboard session（可选；不填将无法获取账号余额、Key 预算、刷新时间和路由策略）
```

只填 `otari_dashboard_session` 的值，不是 API Key。

不填也能正常登录、读取模型和价格、调用模型，但不会显示：

- 账号余额
- Key 预算
- 预算刷新时间
- Otari 配置的路由策略

填写后，插件会读取：

```text
GET /wallet
GET /organizations/me/keys
GET /organizations/me/budgets
GET /organizations/me/spend-ceilings
GET /organizations/me/usage/summary
GET /organizations/me/routing-policies
```

用 `key_prefix + key_suffix` 匹配当前 Key，再用 `scope_type=api_token, scope_id=<key.id>` 找到预算，显示 `current_spend / max_budget` 和 `period_end` 刷新时间。

Dashboard session 是敏感凭据，会过期。不要把整段 Cookie 发给别人；插件只把它保存在 Magpie 的 `plugin-auth.json`。

### 方式二：账号邮箱/密码自动换 Dashboard session

这个方式会直接调用：

```text
POST /api/v1/auth/session
```

登录顺序：

1. Otari 接入区域
2. Otari API Key（必填，用于模型调用）
3. Otari 账号邮箱
4. Otari 账号密码

邮箱和密码只用于本次登录换取 `otari_dashboard_session`：

- 密码会当场清空，不写入 `plugin-auth.json`
- 只保存 Dashboard session、邮箱和 session 到期时间
- 仍然需要 API Key 才能调用模型

如果账号密码已经在聊天或其他地方暴露，请立即修改 Otari 账号密码，并重新登录生成新的 session。

自托管和自定义 base URL 登录入口暂时隐藏，底层兼容代码保留。

## 使用

登录后先看模型列表：

```bash
magpie plugin
magpie provider test otari
magpie quota
```

使用独立 ID 时：

```bash
magpie provider test otari-provider
magpie quota otari-provider
```

## 价格口径

- 优先使用 `/models` 返回的 `pricing`，这是当前调用者在 Otari 的实际价格。
- `pricing` 缺失时才请求 `/pricing/current`，按 `model_key` 精确合并。
- 价格字段按每百万 Token 的美元价格写入：输入、输出、缓存读、缓存写。
- Otari 的分层价格不会伪造为 Magpie 不支持的结构；插件使用模型首选 offering 的基础价。

## 余额口径

账号余额：

```text
GET /api/v1/wallet -> available / balance / currency
```

`available` 是扣除运行中请求预留后的可用余额，优先显示它。它通过可选的 Dashboard session 读取。

Key 预算和刷新时间：

```text
GET /api/v1/organizations/me/spend-ceilings
GET /api/v1/organizations/me/budgets
```

当前 Key 的 `current_spend / max_budget` 来自 spend ceiling，`period_end` 就是刷新时间。

没有 Dashboard session 时，插件不会把普通工作区 Key 的 401 当成登录失效，只会显示一条说明，不影响模型调用。

## 本地测试

```bash
npm run check
npm test
```

测试使用 Node 内置测试框架和 mock fetch，不会访问真实网络。

### 真实联调

```powershell
$env:OTARI_API_KEY = "otk_..."
$env:OTARI_BASE_URL = "https://api.otari.ai/api/v1" # 可选
$env:OTARI_DASHBOARD_SESSION = "otari_dashboard_session 的值" # 可选，读取 Key 预算/刷新时间
$env:OTARI_SMOKE_MODEL = "deepseek/deepseek-v4.1-flash" # 可选
npm run smoke
```

`smoke` 会读取模型、价格、用量和预算，并发送一条很小的 Chat 请求。会产生真实调用和费用，只在明确需要时运行。

## 安全

- API Key 和 Dashboard session 由 Magpie 的 `plugin-auth.json` 保存，插件不会写入或打印它们。
- Dashboard session 会过期；过期后余额、预算和路由会消失，重新登录时填新的 session 即可。
- 插件不会打印请求体、响应体或密钥；错误日志只保留状态码和截断后的错误信息。

## 兼容性

- 只列出 Otari `type` 为 `chat` 或未标注类型的模型。
- 嵌入、图像、语音、重排等非 Chat 模型不会进入 Magpie 模型列表。
- 插件不依赖第三方 npm 包，入口是纯 ESM，Magpie 的 Bun 宿主可直接加载。
