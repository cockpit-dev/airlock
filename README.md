# Airlock

A production-grade AI gateway built on [Cloudflare Workers](https://workers.cloudflare.com/).

Airlock normalizes OpenAI, Anthropic, and Google Gemini APIs behind a unified
request pipeline with first-class support for streaming, intelligent routing,
key governance, and a built-in admin console.

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
- **Admin API** — Authenticated admin surface covering status, metrics,
  redacted config, raw config-store management, provider model discovery,
  routing health, and full key lifecycle management.
- **Console** — React + HeroUI control plane UI with token login, metrics, key
  management, providers, routes, accounts, routing health, and an OpenAI
  Responses playground.
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
| `apps/console`             | React admin console (Cloudflare Pages)                                                   |
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
   Minimal console-managed startup:

```bash
AIRLOCK_INTERNAL_ADMIN_TOKEN=dev-admin-token
```

With the Durable Object bindings from `apps/gateway/wrangler.jsonc`, this is
enough to boot the gateway, connect from the console, and then configure
providers, routes, caller keys, CORS, logging, limits, and policies in the UI.

Env-only fallback is still supported for deployments that intentionally avoid
console-managed business config:

```bash
AIRLOCK_GATEWAY_API_KEYS=your-secret-key-here
AIRLOCK_PROVIDERS='[{"id":"openai-prod","type":"openai","apiKey":"sk-...","baseUrl":"https://api.openai.com/v1","defaultModel":"gpt-4.1-mini"}]'
AIRLOCK_MODEL_ALIASES='gpt-4.1-mini=openai-prod:gpt-4.1-mini'
```

3. Start the gateway dev server:

```bash
pnpm --filter @airlock/gateway dev
```

4. In a separate terminal, start the console:

```bash
pnpm --filter @airlock/console dev
```

### Verify

```bash
# Run all checks
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e && pnpm run audit

# Or individually
pnpm format        # Prettier check for tracked files
pnpm lint          # ESLint across all packages
pnpm typecheck     # TypeScript type checking
pnpm test          # Vitest across all packages
pnpm build         # Build all packages and apps
pnpm e2e           # Playwright console E2E tests
pnpm run audit     # Production dependency audit
```

---

## Configuration

Airlock supports two configuration layers. The default production path is a
minimal bootstrap plus console-managed business config:

- Bootstrap env config for runtime bindings, admin auth, and safe fallbacks
- Console overlay config from `AIRLOCK_CONFIG_STORE` for providers, routes,
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

| Variable                           | Description                                        | Default |
| ---------------------------------- | -------------------------------------------------- | ------- |
| `AIRLOCK_MODE`                     | Operating mode: `free` or `scale`                  | `free`  |
| `AIRLOCK_MODEL_ALIASES`            | Env-side model routing (`external=provider:model`) | —       |
| `AIRLOCK_MODEL_FALLBACKS`          | Env-side fallback targets (JSON)                   | —       |
| `AIRLOCK_MODEL_TARGET_SELECTION`   | Env-side target selection strategy config (JSON)   | —       |
| `AIRLOCK_MODEL_KEY_POLICY`         | Env-side route key access policy (JSON)            | —       |
| `AIRLOCK_MODEL_SHAPING`            | Env-side outbound request shaping (JSON)           | —       |
| `AIRLOCK_MODEL_GROUPS`             | Env-side model groups for key policies (JSON)      | —       |
| `AIRLOCK_PROVIDER_TIMEOUT_MS`      | Upstream request timeout                           | `30000` |
| `AIRLOCK_PROVIDER_MAX_RETRIES`     | Max cross-provider retries                         | `0`     |
| `AIRLOCK_CORS_ORIGINS`             | Env fallback CORS origins                          | —       |
| `AIRLOCK_REQUEST_LOGGING`          | Env fallback structured logging                    | `false` |
| `AIRLOCK_IP_RATE_LIMIT_POLICY`     | Env fallback IP rate limit policy (JSON)           | —       |
| `AIRLOCK_CONFIG_STORE`             | Console overlay config store binding               | —       |
| `AIRLOCK_GOOGLE_SUPER_ADMIN_EMAIL` | Map matching Google OAuth user to super admin      | —       |

---

## API Reference

### Data Plane

| Endpoint                      | Method | Description                          |
| ----------------------------- | ------ | ------------------------------------ |
| `/v1/chat/completions`        | POST   | OpenAI Chat Completions protocol     |
| `/v1/responses`               | POST   | OpenAI Responses protocol            |
| `/v1/messages`                | POST   | Anthropic Messages protocol          |
| `/v1/models`                  | GET    | List available models                |
| `/v1/models/:model`           | GET    | Get model details                    |
| `/v1/models/:provider/:model` | GET    | Get provider-addressed model details |

All `/v1/*` data plane endpoints require an API key via the
`Authorization: Bearer <key>` header (or legacy `x-api-key` header).

### Probes

| Endpoint   | Method | Description                             |
| ---------- | ------ | --------------------------------------- |
| `/healthz` | GET    | Liveness probe                          |
| `/readyz`  | GET    | Readiness probe (provider verification) |

Probe endpoints are unauthenticated so infrastructure health checks can call
them directly.

### Admin Plane

Admin endpoints require `Authorization: Bearer <admin-token>`. Legacy
`AIRLOCK_INTERNAL_ADMIN_TOKEN` acts as a superuser token. Structured
`AIRLOCK_INTERNAL_ADMIN_CREDENTIALS` enforce the scopes shown below.

| Endpoint                                        | Method | Scope          | Description                                        |
| ----------------------------------------------- | ------ | -------------- | -------------------------------------------------- |
| `/_airlock/status`                              | GET    | `status.read`  | Gateway status and config fingerprint              |
| `/_airlock/metrics`                             | GET    | `metrics.read` | Request metrics (sliding window)                   |
| `/_airlock/config`                              | GET    | `config.read`  | Active configuration (secrets redacted)            |
| `/_airlock/config/manage`                       | GET    | `config.write` | Raw config-store snapshot                          |
| `/_airlock/config/manage/:section`              | GET    | `config.write` | Raw config-store section                           |
| `/_airlock/config/manage/:section`              | PUT    | `config.write` | Write config-store section                         |
| `/_airlock/config/manage/:section`              | DELETE | `config.write` | Delete config-store section                        |
| `/_airlock/providers/fetch-models`              | POST   | `config.write` | Discover provider models with supplied credentials |
| `/_airlock/routing/health`                      | GET    | `routing.read` | Per-route health and circuit breaker state         |
| `/_airlock/keys`                                | GET    | `keys.read`    | List gateway keys                                  |
| `/_airlock/keys`                                | POST   | `keys.write`   | Create a key                                       |
| `/_airlock/keys`                                | PATCH  | `keys.write`   | Bulk update keys                                   |
| `/_airlock/keys/bulk-create`                    | POST   | `keys.write`   | Bulk create keys                                   |
| `/_airlock/keys/bulk-rotate`                    | POST   | `keys.write`   | Bulk rotate keys                                   |
| `/_airlock/keys/bulk-delete`                    | POST   | `keys.write`   | Bulk delete keys                                   |
| `/_airlock/keys/bulk-archive`                   | POST   | `keys.write`   | Bulk archive keys                                  |
| `/_airlock/keys/bulk-restore`                   | POST   | `keys.write`   | Bulk restore keys                                  |
| `/_airlock/keys/bulk-rotate/finalize`           | POST   | `keys.write`   | Finalize bulk staged rotations                     |
| `/_airlock/keys/bulk-rotate/cancel`             | POST   | `keys.write`   | Cancel bulk staged rotations                       |
| `/_airlock/keys/:id`                            | GET    | `keys.read`    | Get key details                                    |
| `/_airlock/keys/:id`                            | PUT    | `keys.write`   | Update key metadata/policy                         |
| `/_airlock/keys/:id`                            | DELETE | `keys.write`   | Delete a key                                       |
| `/_airlock/keys/:id/rotate`                     | POST   | `keys.write`   | Rotate a key                                       |
| `/_airlock/keys/:id/rotate/finalize`            | POST   | `keys.write`   | Finalize staged key rotation                       |
| `/_airlock/keys/:id/rotate/cancel`              | POST   | `keys.write`   | Cancel staged key rotation                         |
| `/_airlock/keys/:id/archive`                    | POST   | `keys.write`   | Archive a key                                      |
| `/_airlock/keys/:id/restore`                    | POST   | `keys.write`   | Restore an archived key                            |
| `/_airlock/keys/:id/revocation`                 | GET    | `keys.read`    | Read key revocation status                         |
| `/_airlock/keys/:id/revocation`                 | POST   | `keys.write`   | Revoke a key                                       |
| `/_airlock/keys/:id/revocation`                 | DELETE | `keys.write`   | Clear key revocation                               |
| `/_airlock/keys/:id/status`                     | GET    | `keys.read`    | Key quota/status snapshot                          |
| `/_airlock/keys/:id/events`                     | GET    | `keys.read`    | Key audit events                                   |
| `/_airlock/keys/operations/:operationId/events` | GET    | `keys.read`    | Operation-level key audit events                   |
| `/_airlock/keys/:id/registry`                   | GET    | `keys.read`    | Read registry override view                        |
| `/_airlock/keys/:id/registry`                   | PUT    | `keys.write`   | Set registry override                              |
| `/_airlock/keys/:id/registry`                   | DELETE | `keys.write`   | Clear registry override                            |

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

### Console (Cloudflare Pages)

```bash
cd apps/console && pnpm build
# Deploy the `dist/` directory to Cloudflare Pages
```

### CI/CD

Two GitHub Actions workflows are included:

- **CI** (`ci.yml`) — Runs on push and PR: lint, typecheck, test, build, format,
  production audit, and Playwright E2E
- **Deploy** (`deploy.yml`) — Runs on push to main: verify + deploy to
  Cloudflare Workers (supports production and staging environments)

---

## Model Routing Example

```bash
AIRLOCK_MODEL_ALIASES='gpt-4=openai-prod:gpt-4.1-mini,claude=anthropic-prod:claude-sonnet-4-5'
AIRLOCK_MODEL_FALLBACKS='{"gpt-4":["openai-compatible-a:gpt-4.1-mini","anthropic-prod:claude-sonnet-4-5"]}'
AIRLOCK_MODEL_TARGET_SELECTION='{"gpt-4":{"strategy":"weighted","weights":{"openai-prod:gpt-4.1-mini":10,"anthropic-prod:claude-sonnet-4-5":1}}}'
AIRLOCK_MODEL_KEY_POLICY='{"gpt-4":{"requiredKeyTier":"premium","requiredKeyTags":["chat"]}}'
```

Clients can then use `gpt-4` or `claude` as model names — Airlock routes to
the configured provider instance and falls back automatically on failures.
Provider-addressed model IDs like `openai-prod/gpt-4.1-mini` are also accepted.

---

## Testing

```bash
pnpm test           # Run all test suites
pnpm typecheck      # Type checking (tsgo)
pnpm build          # Build all packages
pnpm e2e            # Run console Playwright E2E tests
pnpm run audit      # Production dependency audit
```

The current verification suite covers 2000+ Vitest unit/integration tests plus
Playwright E2E coverage for the console. Coverage spans protocols, canonical
pipeline, providers, routing, governance, request shaping, telemetry, gateway
integration, and console workflows.

---

## Tech Stack

- **Runtime**: Cloudflare Workers
- **HTTP**: Hono
- **Validation**: Zod
- **Language**: TypeScript (strict, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`)
- **Build**: tsdown (libraries), wrangler (Worker), Vite (Console)
- **Frontend**: React 19, TanStack Router, HeroUI, TailwindCSS 4
- **Testing**: Vitest
- **Tooling**: pnpm workspaces, ESLint, Prettier

---

## License

MIT. See [LICENSE](./LICENSE).
