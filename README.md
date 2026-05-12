# Airlock

Airlock is a Cloudflare Workers AI gateway focused on protocol normalization,
governance, and production-friendly operator ergonomics.

The current milestone delivers:

- a `pnpm` workspace monorepo baseline
- strict TypeScript, `tsdown`, and CI foundations
- the first thin-slice gateway implementation target

The thin slice intentionally starts with authenticated non-streaming OpenAI Chat
Completions over a canonical request/response pipeline before broader provider
and control-plane expansion.
