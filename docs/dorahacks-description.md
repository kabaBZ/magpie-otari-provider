# Magpie × Otari Provider

> A Magpie provider plugin that turns Otari into an intent-aware, budget-safe provider layer for coding agents.

## The problem

Coding agents are usually tied to one model provider, or need a separate configuration for every provider. Teams want two things at once:

- an upper layer that picks the right tier for the task: a quick question should go to a cheap model, writing tests should go to a strong one;
- a lower layer that owns provider selection, budgets, failover and usage, without every client re-implementing it.

Otari already provides the lower layer, but Magpie users could not see or use it as a first-class provider. There was no model discovery, no pricing, no key budget, no usage, and no routing-policy visibility. A thin "OpenAI-compatible URL" was not enough to build a real two-layer router.

## How it works

The project makes the split explicit:

```text
Claude Code / Codex / OpenCode
            |
            v
Magpie: intent routing
  quick question  -> group/fast
  write tests     -> group/strong
  long context    -> group/long
            |
            v  otari/fast | strong | long
Otari: provider routing
  fast   -> cheap open-weight model + failover
  strong -> strong model + failover
  long   -> 1M-context model
            |
            v
40+ providers / budgets / usage
```

The plugin is an OpenCode v1 provider plugin running in Magpie's Bun plugin host. It:

1. Discovers chat models from `GET /api/v1/models` and maps context, limits, modalities and tool/reasoning capabilities.
2. Maps per-million-token pricing from `/models`, with `/pricing/current` as a fallback. A missing price is treated as unknown, never as free.
3. Reads Otari routing policies through the Dashboard session and exposes each one by its policy name: `otari/fast`, `otari/strong`, `otari/long`. Magpie intent groups can then pick a tier without knowing the real provider.
4. Sends `Otari-Tags: app=magpie,session=<Magpie session>,model=<model>` on every request. Otari records the tags on the usage row, so spend can be filtered per conversation.
5. Optionally reads account balance, key budget, reset time, 30-day usage and routing policies through the Dashboard session. The API key alone still covers models, pricing and chat.

The two layers stay separate: Magpie decides *how hard the task is*; Otari decides *who serves it, whose budget pays, and who takes over when it fails*.

## Key features

- One login, all Otari chat models available in Magpie.
- Dynamic model discovery with real pricing, context windows and capability flags.
- Honest price handling: a missing price is "unknown", not "$0"; a model is only marked free when Otari states zero for both input and output.
- Otari routing policies exposed as models: `otari/fast`, `otari/strong`, `otari/long`.
- `Otari-Tags` on every request for per-conversation cost attribution.
- Dashboard balance, key budget, reset time, 30-day usage and routing-policy visibility.
- Organization provider-key models labelled with the key name (for example `[mydeepseek]`), then the organization name, then `organization Inference providers: <provider>`.
- Global and EU endpoints.
- No runtime npm dependencies.

## Tech stack

- Node.js 20+, plain ESM, no runtime npm dependencies.
- Magpie plugin host (Bun), OpenCode v1 provider plugin.
- `@ai-sdk/openai-compatible` for Chat Completions.
- Otari API: `/models`, `/pricing/current`, `/key/budget`, `/key/usage/summary`, `/auth/session`, `/wallet`, `/organizations/me/*`, `/chat/completions`.
- Magpie `chat.headers` hook for `Otari-Tags`.
- Node's built-in test runner; 41 tests.

## Hackathon requirements

- **Public repository:** https://github.com/kabaBZ/magpie-otari-provider
- **Hackathon branch:** `hackathon/mozilla-devs-wilding`
- **First commit where Otari came in:** https://github.com/kabaBZ/magpie-otari-provider/commit/7bd20bc6db0decd2356a277ee0b964621d05ef66
- **Release:** https://github.com/kabaBZ/magpie-otari-provider/releases/tag/v0.3.0
- **npm:** https://www.npmjs.com/package/magpie-otari-provider

**Otari features used**

- `GET /api/v1/models` for dynamic model discovery.
- `GET /api/v1/pricing/current` for pricing fallback.
- `GET /api/v1/key/budget` for the current key's budget and reset time.
- `GET /api/v1/key/usage/summary` for the current key's 30-day usage.
- `POST /api/v1/auth/session` for browser-free Dashboard session exchange.
- `GET /wallet`, `/organizations/me/keys`, `/organizations/me/budgets`, `/organizations/me/spend-ceilings`, `/organizations/me/usage/summary`, `/organizations/me/routing-policies` for account-level balance, budget, usage and routing visibility.
- `POST /api/v1/chat/completions` for streaming and non-streaming Chat Completions.
- `Otari-Tags` for per-request attribution.
- Global and EU endpoints.

**PRs / issues opened on the Otari repo**

- https://github.com/mozilla-ai/otari/issues/3017 — policy entries in `GET /models` carry no `kind`/`select`/`on_failure` metadata.
- https://github.com/mozilla-ai/otari/issues/3018 — a model id returned by `GET /models` can be uncallable (502) while the same model works through its `provider:model` selector.

**Demo video:** [INSERT 3-5 MIN DEMO VIDEO LINK]

**Feedback video:** [INSERT 3-5 MIN FEEDBACK VIDEO LINK]

**Written feedback:** included in the feedback section of this submission.

**Hosted Otari / open-weight models**

The project uses the hosted `otari.ai` gateway. The `fast` tier uses `openai/gpt-oss-20b`, and the `long` tier uses `DeepSeek V4.1 Flash`, so the demo exercises open-weight models through Otari.

## Verification

```text
magpie provider test otari
  ✓ chat  592 ms · fast

quick question
  x-magpie-model: otari/fast

test-writing prompt
  x-magpie-model: otari/strong

npm test
  41 tests passed
```

## What makes it different

This is not a thin "OpenAI-compatible URL" adapter. It is a two-layer routing bridge:

- Magpie owns intent, tiers and agent UX.
- Otari owns provider routing, budget and observability.
- `Otari-Tags` makes the two layers accountable to each other: a Magpie conversation can be found in Otari usage.

The two upstream issues came directly from building and testing this split, not from reading the docs.

## Try it

```bash
magpie plugin add magpie-otari-provider
magpie plugin login otari
```

Then build a Magpie routing group over `otari/fast`, `otari/strong` and `otari/long`. The full recipe is in `docs/two-layer-routing.md`.
