### Problem or use case

I maintain a provider plugin for an upper-layer router (Magpie). It treats Otari as the provider layer of a two-layer design: the upper layer picks an intent tier (`fast`, `strong`, `long`), and Otari picks the real provider, enforces budget, and handles failover.

`GET /api/v1/models` is API-key-readable and does list routing policies. But an entry looks exactly like a normal chat model:

```json
{
  "id": "fast",
  "object": "model",
  "owned_by": "otari",
  "pricing": {
    "input_price_per_million": 0.03,
    "output_price_per_million": 0.14,
    "pricing_tiers": [],
    "unit": "token"
  },
  "pricing_source": "configured",
  "context_window": 131072,
  "max_output_tokens": 16384,
  "type": "chat",
  "deployment_managed": false
}
```

There is no `kind`, `is_dynamic`, `select`, `on_failure`, `candidates`, or `default_model`. A client cannot tell:

- whether `fast` is a routing policy or a real model;
- which model it routes to first;
- what its fallback chain is;
- whether it is static, conditional, weighted, or priority-based;
- whether the price and context window shown belong to the policy or to one candidate.

For a policy with `select: [{default: "deepinfra:openai/gpt-oss-20b"}]` and `on_failure: ["ovhcloud:gpt-oss-20b"]`, `/models` shows the first candidate's price. A request may settle on the fallback at a different rate. The listing does not say that.

`GET /api/v1/organizations/me/routing-policies` returns the spec, but an API key gets `401` (see #2986). A provider plugin therefore has to keep a Dashboard session just to label the tiers it can already call.

### Proposed solution

Preferred: make policies first-class entries in `GET /api/v1/models`.

```json
{
  "id": "fast",
  "object": "model",
  "kind": "policy",
  "owned_by": "otari",
  "type": "chat",
  "policy": {
    "is_dynamic": false,
    "select": [{ "default": "deepinfra:openai/gpt-oss-20b" }],
    "on_failure": ["ovhcloud:gpt-oss-20b"],
    "candidates": [
      "deepinfra:openai/gpt-oss-20b",
      "ovhcloud:gpt-oss-20b"
    ],
    "guardrails": []
  },
  "pricing": null,
  "pricing_source": "none",
  "price_range": {
    "input_min": 0.03,
    "input_max": 0.05,
    "output_min": 0.14,
    "output_max": 0.18
  },
  "context_window": 131072,
  "max_output_tokens": 16384
}
```

At minimum:

- `kind: "policy"` (or `type: "policy"`) so clients can separate tiers from real models;
- `policy.select`, `policy.on_failure`, `policy.candidates`, `policy.is_dynamic`;
- `pricing: null` + `price_range` for any policy with more than one price; never present one candidate's price as the policy's price.

Alternative: add a read-only, API-key-scoped endpoint:

```text
GET /api/v1/key/routing-policies
```

It would return the same `PolicyResponse` shape, scoped to the API key's workspace, and require no Dashboard session. It exposes no secrets — only the policy names and specs that the key can already call.

### Does this belong in Otari?

Yes. This is about Otari's own routing-policy and model-listing API, not about which providers or provider params any-llm supports. Dispatch already works; what is missing is the control-plane metadata that lets a caller treat a policy as a first-class model tier.

### Alternatives considered

- **Keep using the Dashboard session.** This is what the plugin does today. It works, but it means every headless client needs a second credential, a refresh story, and a way to recover when the session expires. That is disproportionate for read-only metadata.
- **Hard-code policy names in the client.** Breaks when a workspace adds or renames a policy, and does not work for per-workspace policies.
- **Infer "is a policy" from `owned_by: "otari"` or from an id without `/`.** Both are heuristics. They collide with aliases, with deployment-hosted models, and with real model ids that have no slash.
- **Reconstruct the route from usage rows.** That is after the fact. It does not help a model picker discover tiers before the first request.

### Additional context

Observed on otari.ai on 2026-11-09. Related: #2986 covers the `401` and the `invalid_model` hint; this is about the successful `/models` path.
