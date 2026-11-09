**Otari version:** hosted otari.ai (2026-11-09)
**How you're running Otari:** hosted, workspace API key
**Provider and model:** an organization provider key for DeepSeek
**Reproduces with a direct any-llm call?** no (hosted gateway dispatch)

### What happened

`GET /api/v1/models` returned a chat model whose id cannot serve a request:

```json
{
  "id": "deepseek/deepseek-flash",
  "owned_by": "deepseek",
  "pricing_source": "configured",
  "deployment_managed": false,
  "context_window": 1048576,
  "type": "chat"
}
```

`GET /api/v1/models?provider=<key-prefix>` also returns the same id, with `pricing_source: "organization"`.

`POST /api/v1/chat/completions` with that id:

```json
{
  "model": "deepseek/deepseek-flash",
  "messages": [{ "role": "user", "content": "hello" }]
}
```

answers:

```text
502 {"detail":"All upstream providers failed"}
```

The same model works when addressed through the organization key's selector, or through the catalog id:

```text
<key-prefix>:deepseek-flash              -> 200, Otari-Provider: <key-prefix>, Otari-Model: deepseek-flash
deepseek/deepseek-v4.1-flash-1017        -> 200, Otari-Provider: <key-prefix>, Otari-Model: deepseek-flash
```

### Steps to reproduce

1. Add an organization provider key for DeepSeek with a request prefix (redacted here as `<key-prefix>`).
2. `GET /api/v1/models` with a workspace API key.
3. Find the entry `deepseek/deepseek-flash`.
4. `POST /api/v1/chat/completions` with `model: "deepseek/deepseek-flash"`.
5. It answers `502 All upstream providers failed`.
6. Send `model: "<key-prefix>:deepseek-flash"`; it answers `200`.

### What you expected

A model returned by `GET /models` should be callable with the id it returns, or the listing should say which selector is required. Either:

- return the callable selector as `id`, or add a `selector` field;
- omit entries that only an organization provider key can serve under a different spelling;
- or make the 502 name the candidates it tried and why each failed.

### Relevant config (redacted)

- Hosted otari.ai, workspace API key.
- One organization provider key for DeepSeek, request prefix `<key-prefix>`, one model serving (`deepseek-flash`).
- No deployment config access.

### Additional context

The same listing also contains `deepseek/deepseek-v4.1-flash-1017`, which is callable and resolves to the organization key. So two ids for the same model exist, and only one is callable. This breaks any client that iterates `/models` and treats every id as callable.
