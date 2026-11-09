# 两层模型路由：Magpie 管意图，Otari 管 provider

一句话：

> **Magpie 决定“这活有多难”，Otari 决定“谁接、花谁的钱、挂了谁顶”。**

```text
Claude Code / Codex / OpenCode
            │
            ▼
┌───────────────────────────────┐
│ Magpie：意图路由              │
│  快问快答   → group/fast       │
│  写代码/测试 → group/strong    │
│  长上下文   → group/long       │
└───────────────┬───────────────┘
                │  otari/fast | strong | long
                ▼
┌───────────────────────────────┐
│ Otari：provider 路由           │
│  fast   → 低价小模型 + 故障转移 │
│  strong → 强模型 + 故障转移     │
│  long   → 1M 上下文模型         │
└───────────────┬───────────────┘
                ▼
        40+ providers / 预算 / 用量
```

## 插件做了什么

1. **把 Otari 的 routing policy 变成 Magpie 模型**
   `GET /organizations/me/routing-policies` 里的每条策略，都会以
   `otari/<name>` 出现在 Magpie 的模型选择器里；发给 Otari 的
   `model` 就是策略名 `<name>`。
2. **给每个请求打 `Otari-Tags`**
   `app=magpie,session=<Magpie 会话 id>,model=<模型 id>`。
   Otari 会把这些标签写进 usage 行，之后可以按 `tag=session:<id>` 过滤。

## 一、建 Otari 策略

```bash
export OTARI_API_KEY="otk_..."
export OTARI_DASHBOARD_SESSION="otari_dashboard_session 的值"
node scripts/setup-two-layer.mjs
```

脚本会在 API key 所属的 workspace 里 upsert 三条策略：

| 策略 | 首选 | 故障转移 |
|---|---|---|
| `fast` | `deepinfra:openai/gpt-oss-20b` | `ovhcloud:gpt-oss-20b` |
| `strong` | `deepinfra:deepseek-ai/DeepSeek-V4-Pro` | `nebius:deepseek-ai/DeepSeek-V4-Pro` |
| `long` | `nebius:deepseek-ai/DeepSeek-V4.1-Flash` | `deepinfra:deepseek-ai/DeepSeek-V4.1-Flash` |

## 二、在 Magpie 里建意图路由组

```bash
magpie group add otari-two-layer \
  models=otari/fast,otari/strong,otari/long

magpie group rule add otari-two-layer \
  use=otari/fast \
  intent="a quick question or explanation, with no code to write or change" \
  classifier=otari/fast

magpie group rule add otari-two-layer \
  use=otari/strong \
  intent="writing or fixing tests, implementing a feature, or changing code"

magpie group rule add otari-two-layer \
  use=otari/long \
  tokens=128000
```

Agent 里选 `group/otari-two-layer` 即可。

## 三、实测

用同一个 API key 直接打三条策略：

| 策略 | `otari-provider` | `otari-model` |
|---|---|---|
| `fast` | `deepinfra` | `openai/gpt-oss-20b` |
| `strong` | `deepinfra` | `deepseek-ai/DeepSeek-V4-Pro` |
| `long` | `nebius` | `deepseek-ai/DeepSeek-V4.1-Flash` |

带 `Otari-Tags: app=magpie,session=codex-probe,model=policy` 发出后，
`GET /organizations/me/usage?tag=session:codex-probe` 能查到对应行。

## 四、Demo 视频怎么讲

1. **0:00–0:40**：两层分工——Magpie 按意图选档，Otari 按 provider / 预算 / 故障转移选谁。
2. **0:40–1:40**：`magpie groups` 展示 `otari-two-layer` 的三条规则。
3. **1:40–2:40**：发一个快问 → 命中 `fast`；发一个“写测试” → 命中 `strong`。
4. **2:40–3:40**：打开 Otari Usage，按 `session:` 标签过滤，展示两层账对得上。
5. **3:40–4:30**：讲反馈：policy 元数据、API key 可读的预算、标准 tag 约定。

## 五、给 Otari 的反馈

- `/models` 不返回 selector，只返回 catalog id，上层要自己猜 `provider:model`。
- routing policy 只有 Dashboard session 能读，API key 读不到。
- `pricing_source: "organization"` 是识别自配 provider key 的唯一线索，建议直接返回 key 名。
- `Otari-Tags` 很好用，建议在 `/models` 或 docs 里把 tag 约定标准化。
