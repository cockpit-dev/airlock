# Airlock

A production-grade AI gateway built on [Cloudflare Workers](https://workers.cloudflare.com/).

Airlock normalizes OpenAI, Anthropic, and Google Gemini APIs behind a unified
request pipeline with first-class support for streaming, intelligent routing,
key governance, and a built-in admin dashboard.

**[中文文档](./README.zh-CN.md)**

---

## Features

- **Multi-protocol** — Exposes OpenAI Chat Completions (`/v1/chat/completions`),
  OpenAI Responses (`/v1/responses`), and Anthropic Messages (`/v1/messages`)
  endpoints. Incoming requests are decoded into a canonical format, routed to the
  best provider, and re-encoded into the caller's protocol.
- **Multi-provider** — Routes to OpenAI, Anthropic, and Google Gemini with
  provider-aware failover and cross-provider fallback.
- **Canonical data plane** — All three protocols share a single normalized
  request/response pipeline. Cross-protocol translation (e.g. Anthropic client
  hitting an OpenAI model) works transparently.
- **Streaming** — Full streaming support across all protocols and providers with
  stream reassembly, idle timeout detection, malformed SSE recovery, and
  protocol-correct mid-stream error events.
- **Intelligent routing** — Five target selection strategies (weighted,
  lowest-cost, health-priority, priority, health-score) with per-route
  configuration. SLO-driven sliding-window circuit breakers protect against
  degraded providers.
- **Key governance** — Static API keys and a dynamic key registry with full
  lifecycle management (create, rotate, archive, restore, revoke, staged
  rotation). Per-key request quotas, token quotas, and concurrency limits backed
  by Durable Objects.
- **Request shaping** — Structured outbound request modification (headers,
  query params, JSON body injection) with HMAC-SHA256 request signing.
- **Observability** — Structured request logging, telemetry event pipeline
  (Queue + Analytics Engine), per-route health metrics, and in-memory request
  statistics.
- **Admin API** — 29 authenticated admin endpoints covering status, metrics,
  configuration, routing health, and full key lifecycle management.
- **Dashboard** — SvelteKit 5 control plane UI with login, key management,
  routing health, configuration viewer, and status monitoring.
- **Production hardening** — Request body size limits, Content-Type validation,
  CORS, timing-safe admin auth, per-IP rate limiting, client abort signal
  forwarding, empty stream detection, SSE buffer limits, and centralized error
  codes.
- **Cloudflare free-tier compatible** — Runs on the Workers free plan by default.
  Scale mode unlocks higher throughput and full telemetry sampling.

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Client (OpenAI / Anthropic / Gemini SDK)            │
└────────────────────┬─────────────────────────────────┘
                     │  /v1/chat/completions
                     │  /v1/responses
                     │  /v1/messages
┌────────────────────▼─────────────────────────────────┐
│  Gateway (Cloudflare Workers)                         │
│  ┌─────────┐  ┌───────────┐  ┌──────────┐           │
│  │Protocol │→│ Canonical  │→│ Routing  │            │
│  │Codec    │  │ Pipeline  │  │ Engine   │            │
│  └─────────┘  └───────────┘  └────┬─────┘           │
│                                    │                  │
│  ┌─────────────────────────────────▼──────────────┐  │
│  │  Provider Adapters (OpenAI / Anthropic / Gemini)│ │
│  └────────────────────────────────────────────────┘  │
│  ┌────────┐ ┌────────┐ ┌──────────┐ ┌────────────┐  │
│  │Govern. │ │Shaping │ │Telemetry │ │Admin API   │  │
│  └────────┘ └────────┘ └──────────┘ └────────────┘  │
└──────────────────────────────────────────────────────┘
```

### Package Structure

| Package                    | Purpose                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/gateway`             | Cloudflare Worker entry point, HTTP routing, admin API                                   |
| `apps/dashboard`           | SvelteKit 5 admin dashboard (Cloudflare Pages)                                           |
| `packages/protocols`       | External protocol schemas and codecs (OpenAI Chat, OpenAI Responses, Anthropic Messages) |
| `packages/canonical`       | Canonical request/response model, cross-protocol normalization, stream reassembly        |
| `packages/providers`       | Provider adapters (OpenAI, Anthropic, Gemini) with capability descriptors                |
| `packages/routing`         | Model routing, target selection, fallback, circuit breakers                              |
| `packages/governance`      | Key authentication, quotas, revocation, dynamic registry, audit                          |
| `packages/request-shaping` | Structured outbound request modification and HMAC signing                                |
| `packages/telemetry`       | Request event schema, queue consumer, Analytics Engine integration                       |
| `packages/shared`          | GatewayError, error codes, environment utilities                                         |
| `packages/testing`         | Test factories and helpers                                                               |

---

## Quick Start

### Prerequisites

- Node.js >= 24
- pnpm >= 11

### Install

```bash
git clone <repo-url> airlock && cd airlock
pnpm install
```

### Local Development

1. Copy the gateway environment file:

```bash
cp apps/gateway/.dev.vars.example apps/gateway/.dev.vars
```

2. Edit `apps/gateway/.dev.vars`.
   Minimal dashboard-managed startup:

```bash
AIRLOCK_INTERNAL_ADMIN_TOKEN=dev-admin-token
```

With the Durable Object bindings from `apps/gateway/wrangler.jsonc`, this is
enough to boot the gateway, connect from the dashboard, and then configure
providers, routes, caller keys, CORS, logging, limits, and policies in the UI.

Env-only fallback is still supported for deployments that intentionally avoid
dashboard-managed business config:

```bash
AIRLOCK_GATEWAY_API_KEYS=your-secret-key-here
AIRLOCK_PROVIDERS='[{"id":"openai-prod","type":"openai","apiKey":"sk-...","baseUrl":"https://api.openai.com/v1","defaultModel":"gpt-4.1-mini"}]'
AIRLOCK_MODEL_ALIASES='gpt-4.1-mini=openai-prod:gpt-4.1-mini'
```

3. Start the gateway dev server:

```bash
pnpm --filter @airlock/gateway dev
```

4. In a separate terminal, start the dashboard:

```bash
pnpm --filter @airlock/dashboard dev
```

### Verify

```bash
# Run all checks
pnpm typecheck && pnpm test && pnpm build

# Or individually
pnpm lint          # ESLint across all packages
pnpm typecheck     # TypeScript type checking
pnpm test          # Vitest across all packages
pnpm build         # Build all packages and apps
```

---

## Configuration

Airlock supports two configuration layers. The default production path is a
minimal bootstrap plus dashboard-managed business config:

- Bootstrap env config for runtime bindings, admin auth, and safe fallbacks
- Dashboard overlay config from `AIRLOCK_CONFIG_STORE` for providers, routes,
  key policies, shaping, signing, model groups, limits, and feature flags
- The dynamic key registry is enabled automatically when the
  `AIRLOCK_GATEWAY_KEY_REGISTRY` Durable Object binding exists

If `AIRLOCK_CONFIG_STORE` is absent, Airlock runs in env-only mode. See
`apps/gateway/.dev.vars.example` for the full reference with descriptions and
defaults.

### Bootstrap Required

| Variable                                                               | Description              |
| ---------------------------------------------------------------------- | ------------------------ |
| `AIRLOCK_INTERNAL_ADMIN_TOKEN` or `AIRLOCK_INTERNAL_ADMIN_CREDENTIALS` | Admin API bootstrap auth |

### Business Config Required In Env-Only Mode

| Variable                   | Description                                                          |
| -------------------------- | -------------------------------------------------------------------- |
| `AIRLOCK_GATEWAY_API_KEYS` | API keys for caller auth unless registry-backed keys are used        |
| `AIRLOCK_PROVIDERS`        | JSON array of provider instances (`id`, `type`, `apiKey`, `baseUrl`) |
| `AIRLOCK_MODEL_ALIASES`    | Env-side model routes targeting provider instance ids                |

### Key Optional Variables

| Variable                           | Description                                   | Default |
| ---------------------------------- | --------------------------------------------- | ------- |
| `AIRLOCK_MODE`                     | Operating mode: `free` or `scale`             | `free`  |
| `AIRLOCK_MODEL_ALIASES`            | Env-side model routing (JSON)                 | —       |
| `AIRLOCK_MODEL_FALLBACKS`          | Env-side fallback targets (JSON)              | —       |
| `AIRLOCK_PROVIDER_TIMEOUT_MS`      | Upstream request timeout                      | `30000` |
| `AIRLOCK_PROVIDER_MAX_RETRIES`     | Max cross-provider retries                    | `0`     |
| `AIRLOCK_CORS_ORIGINS`             | Env fallback CORS origins                     | —       |
| `AIRLOCK_REQUEST_LOGGING`          | Env fallback structured logging               | `false` |
| `AIRLOCK_CONFIG_STORE`             | Dashboard overlay config store binding        | —       |
| `AIRLOCK_GOOGLE_SUPER_ADMIN_EMAIL` | Map matching Google OAuth user to super admin | —       |

---

## API Reference

### Data Plane

| Endpoint               | Method | Description                             |
| ---------------------- | ------ | --------------------------------------- |
| `/v1/chat/completions` | POST   | OpenAI Chat Completions protocol        |
| `/v1/responses`        | POST   | OpenAI Responses protocol               |
| `/v1/messages`         | POST   | Anthropic Messages protocol             |
| `/v1/models`           | GET    | List available models                   |
| `/v1/models/:model`    | GET    | Get model details                       |
| `/healthz`             | GET    | Liveness probe                          |
| `/readyz`              | GET    | Readiness probe (provider verification) |

All data plane endpoints require an API key via the `Authorization: Bearer <key>`
header (or legacy `x-api-key` header).

### Admin Plane

| Endpoint                        | Method | Description                                |
| ------------------------------- | ------ | ------------------------------------------ |
| `/_airlock/status`              | GET    | Gateway status and config fingerprint      |
| `/_airlock/metrics`             | GET    | Request metrics (sliding window)           |
| `/_airlock/config`              | GET    | Active configuration (secrets redacted)    |
| `/_airlock/routing/health`      | GET    | Per-route health and circuit breaker state |
| `/_airlock/keys`                | GET    | List gateway keys                          |
| `/_airlock/keys`                | POST   | Create a key                               |
| `/_airlock/keys/:id`            | GET    | Get key details                            |
| `/_airlock/keys/:id`            | DELETE | Delete a key                               |
| `/_airlock/keys/:id/rotate`     | POST   | Rotate a key                               |
| `/_airlock/keys/:id/archive`    | POST   | Archive a key                              |
| `/_airlock/keys/:id/restore`    | POST   | Restore an archived key                    |
| `/_airlock/keys/:id/revocation` | POST   | Revoke a key                               |
| `/_airlock/keys/:id/status`     | GET    | Key quota status                           |
| `/_airlock/keys/:id/events`     | GET    | Key audit events                           |

Admin endpoints require authentication via `Authorization: Bearer <admin-token>`.

---

## Deployment

### Cloudflare Workers

The gateway deploys as a Cloudflare Worker. Required bindings:

- **Durable Objects** — Key quota, token quota, concurrency, revocation, key
  registry, circuit breaker, IP rate limit
- **Queue** — Telemetry event pipeline
- **Analytics Engine** — Telemetry data storage

```bash
# Deploy to production
cd apps/gateway && pnpm wrangler deploy

# Or use the CI pipeline (pushes to main trigger automatic deployment)
```

### Dashboard (Cloudflare Pages)

```bash
cd apps/dashboard && pnpm build
# Deploy the `.svelte-kit/cloudflare/` directory to Cloudflare Pages
```

### CI/CD

Two GitHub Actions workflows are included:

- **CI** (`ci.yml`) — Runs on push and PR: lint, typecheck, test, build, audit
- **Deploy** (`deploy.yml`) — Runs on push to main: verify + deploy to
  Cloudflare Workers (supports production and staging environments)

---

## Model Routing Example

```jsonc
// AIRLOCK_MODEL_ALIASES
[
  {
    "external": "gpt-4",
    "target": { "provider": "openai", "model": "gpt-4.1-mini" },
    "fallbacks": [{ "provider": "anthropic", "model": "claude-sonnet-4-5" }]
  },
  {
    "external": "claude",
    "target": { "provider": "anthropic", "model": "claude-sonnet-4-5" }
  }
]
```

Clients can then use `gpt-4` or `claude` as model names — Airlock routes to
the configured provider and falls back automatically on failures.

---

## Testing

```bash
pnpm test           # Run all test suites
pnpm typecheck      # Type checking (tsgo)
pnpm build          # Build all packages
```

The project maintains 1850+ tests across 48 test files covering protocols,
canonical pipeline, providers, routing, governance, request shaping, telemetry,
and gateway integration.

---

## Tech Stack

- **Runtime**: Cloudflare Workers
- **HTTP**: Hono
- **Validation**: Zod
- **Language**: TypeScript (strict, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`)
- **Build**: tsdown (libraries), wrangler (Worker), Vite (Dashboard)
- **Frontend**: SvelteKit 5, TailwindCSS 4, adapter-cloudflare
- **Testing**: Vitest
- **Tooling**: pnpm workspaces, ESLint, Prettier

---

## License

Private. All rights reserved.
