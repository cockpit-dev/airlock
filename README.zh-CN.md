# Airlock

基于 [Cloudflare Workers](https://workers.cloudflare.com/) 的生产级 AI 网关。

Airlock 将 OpenAI、Anthropic 和 Google Gemini 的 API 统一为一套标准化请求管线，
原生支持流式传输、智能路由、密钥治理和内置管理控制台。

**[English Documentation](./README.md)**

---

## 功能特性

- **多协议** — 对外暴露 OpenAI Chat Completions（`/v1/chat/completions`）、
  OpenAI Responses（`/v1/responses`）和 Anthropic Messages（`/v1/messages`）
  三个端点。请求经解码后转换为 canonical 格式，路由至最优 provider，
  再重新编码为调用方使用的协议格式。
- **多 Provider** — 支持 OpenAI、Anthropic、Google Gemini 三个上游，
  提供 provider 级故障转移和跨 provider 降级回退。
- **Canonical 数据面** — 三种协议共享统一的标准化请求/响应管线。
  跨协议互转（如 Anthropic 客户端调用 OpenAI 模型）透明工作。
- **流式传输** — 全链路流式支持，包含流重组、空闲超时检测、
  畸形 SSE 帧恢复和协议正确的流中错误事件。
- **智能路由** — 五种目标选择策略（加权、最低成本、健康优先、
  优先级、健康评分），支持按路由配置。SLO 驱动的滑动窗口熔断器
  自动隔离劣化 provider。
- **密钥治理** — 静态 API 密钥与动态密钥注册表，支持完整生命周期管理
  （创建、轮换、归档、恢复、撤销、分阶段轮换）。基于 Durable Objects 的
  每密钥请求配额、token 配额和并发限制。
- **请求整形** — 结构化出站请求修改（headers、query 参数、JSON body 注入），
  支持 HMAC-SHA256 请求签名。
- **可观测性** — 结构化请求日志、遥测事件管线（Queue + Analytics Engine）、
  按路由健康指标和内存级请求统计。
- **管理 API** — 认证管理面覆盖状态、指标、脱敏配置、原始配置存储管理、
  Provider 模型发现、路由健康和完整密钥生命周期管理。
- **控制台** — 基于 React + HeroUI 的管理界面，包含 token 登录、指标、
  密钥管理、Providers、Routes、Accounts、路由健康和 OpenAI Responses
  Playground。
- **生产加固** — 请求体大小限制、Content-Type 校验、CORS、
  时序安全管理认证、按 IP 限流、客户端中断信号转发、空流检测、
  SSE 缓冲区限制和集中化错误码。
- **Cloudflare 免费层兼容** — 默认可在 Workers 免费计划上运行。
  Scale 模式解锁更高吞吐和全量遥测采样。

---

## 架构

```
┌──────────────────────────────────────────────────────┐
│  客户端 (OpenAI / Anthropic / Gemini SDK)             │
└────────────────────┬─────────────────────────────────┘
                     │  /v1/chat/completions
                     │  /v1/responses
                     │  /v1/messages
┌────────────────────▼─────────────────────────────────┐
│  网关 (Cloudflare Workers)                            │
│  ┌─────────┐  ┌───────────┐  ┌──────────┐           │
│  │协议编解码│→│ Canonical  │→│ 路由引擎  │            │
│  │         │  │ 管线      │  │          │            │
│  └─────────┘  └───────────┘  └────┬─────┘           │
│                                    │                  │
│  ┌─────────────────────────────────▼──────────────┐  │
│  │  Provider 适配器 (OpenAI / Anthropic / Gemini)  │  │
│  └────────────────────────────────────────────────┘  │
│  ┌────────┐ ┌────────┐ ┌──────────┐ ┌────────────┐  │
│  │治理模块│ │请求整形│ │ 遥测     │ │ 管理 API   │  │
│  └────────┘ └────────┘ └──────────┘ └────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 包结构

| 包                         | 职责                                                                          |
| -------------------------- | ----------------------------------------------------------------------------- |
| `apps/gateway`             | Cloudflare Worker 入口、HTTP 路由、管理 API                                   |
| `apps/console`             | React 管理控制台（Cloudflare Pages 部署）                                     |
| `packages/protocols`       | 外部协议 schema 与编解码（OpenAI Chat、OpenAI Responses、Anthropic Messages） |
| `packages/canonical`       | Canonical 请求/响应模型、跨协议归一化、流重组                                 |
| `packages/providers`       | Provider 适配器（OpenAI、Anthropic、Gemini）及能力描述符                      |
| `packages/routing`         | 模型路由、目标选择、故障回退、熔断器                                          |
| `packages/governance`      | 密钥认证、配额、撤销、动态注册表、审计                                        |
| `packages/request-shaping` | 结构化出站请求修改与 HMAC 签名                                                |
| `packages/telemetry`       | 请求事件 schema、Queue 消费者、Analytics Engine 集成                          |
| `packages/shared`          | GatewayError、错误码、环境工具                                                |
| `packages/testing`         | 测试工厂与辅助工具                                                            |

---

## 快速开始

### 前置条件

- Node.js >= 24
- pnpm >= 11

### 安装

```bash
git clone <repo-url> airlock && cd airlock
pnpm install
```

### 本地开发

1. 复制网关环境变量示例文件：

```bash
cp apps/gateway/.dev.vars.example apps/gateway/.dev.vars
```

2. 编辑 `apps/gateway/.dev.vars`。
   Console 管理业务配置时的最小启动配置：

```bash
AIRLOCK_INTERNAL_ADMIN_TOKEN=dev-admin-token
```

只要保留 `apps/gateway/wrangler.jsonc` 中的 Durable Object 绑定，这就足够启动
Gateway、从 Console 连接，然后在 UI 里配置 providers、routes、caller keys、
CORS、logging、limits 和 policies。

如果明确不使用 Console 管理业务配置，仍可使用纯环境变量 fallback：

```bash
AIRLOCK_GATEWAY_API_KEYS=your-secret-key-here
AIRLOCK_PROVIDERS='[{"id":"openai-prod","type":"openai","apiKey":"sk-...","baseUrl":"https://api.openai.com/v1","defaultModel":"gpt-4.1-mini"}]'
AIRLOCK_MODEL_ALIASES='gpt-4.1-mini=openai-prod:gpt-4.1-mini'
```

3. 启动网关开发服务器：

```bash
pnpm --filter @airlock/gateway dev
```

4. 在另一个终端启动控制台：

```bash
pnpm --filter @airlock/console dev
```

### 验证

```bash
# 运行全部检查
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e && pnpm run audit

# 或单独运行
pnpm format        # tracked 文件 Prettier 检查
pnpm lint          # 所有包的 ESLint 检查
pnpm typecheck     # TypeScript 类型检查
pnpm test          # 所有包的 Vitest 测试
pnpm build         # 构建所有包和应用
pnpm e2e           # Console Playwright E2E 测试
pnpm run audit     # 生产依赖安全审计
```

---

## 配置

Airlock 现支持两层配置。默认生产路径是最小 bootstrap + Console 管理业务配置：

- bootstrap 环境变量：运行时绑定、管理认证和安全回退值
- `AIRLOCK_CONFIG_STORE` 提供的 Console overlay：providers、routes、
  key_policies、shaping、signing、model_groups、limits、features
- 当 `AIRLOCK_GATEWAY_KEY_REGISTRY` Durable Object 绑定存在时，动态 key registry
  自动启用

未配置 `AIRLOCK_CONFIG_STORE` 时，系统以纯环境变量模式运行。完整配置参考见
`apps/gateway/.dev.vars.example`。

### Bootstrap 必需变量

| 变量                                                                   | 说明                    |
| ---------------------------------------------------------------------- | ----------------------- |
| `AIRLOCK_INTERNAL_ADMIN_TOKEN` 或 `AIRLOCK_INTERNAL_ADMIN_CREDENTIALS` | 管理 API bootstrap 认证 |

### 纯环境变量模式下的业务必需变量

| 变量                       | 说明                                                         |
| -------------------------- | ------------------------------------------------------------ |
| `AIRLOCK_GATEWAY_API_KEYS` | 调用方认证密钥，除非使用 registry 托管 key                   |
| `AIRLOCK_PROVIDERS`        | Provider 实例 JSON 数组（`id`、`type`、`apiKey`、`baseUrl`） |
| `AIRLOCK_MODEL_ALIASES`    | 指向 provider 实例 id 的环境变量侧模型路由                   |

### 关键可选变量

| 变量                               | 说明                                            | 默认值  |
| ---------------------------------- | ----------------------------------------------- | ------- |
| `AIRLOCK_MODE`                     | 运行模式：`free` 或 `scale`                     | `free`  |
| `AIRLOCK_MODEL_ALIASES`            | 环境变量侧模型路由（`external=provider:model`） | —       |
| `AIRLOCK_MODEL_FALLBACKS`          | 环境变量侧故障回退目标（JSON）                  | —       |
| `AIRLOCK_MODEL_TARGET_SELECTION`   | 环境变量侧目标选择策略配置（JSON）              | —       |
| `AIRLOCK_MODEL_KEY_POLICY`         | 环境变量侧路由密钥访问策略（JSON）              | —       |
| `AIRLOCK_MODEL_SHAPING`            | 环境变量侧出站请求整形（JSON）                  | —       |
| `AIRLOCK_MODEL_GROUPS`             | 环境变量侧密钥策略模型组（JSON）                | —       |
| `AIRLOCK_PROVIDER_TIMEOUT_MS`      | 上游请求超时（毫秒）                            | `30000` |
| `AIRLOCK_PROVIDER_MAX_RETRIES`     | 最大跨 Provider 重试次数                        | `0`     |
| `AIRLOCK_CORS_ORIGINS`             | 环境变量回退 CORS 源                            | —       |
| `AIRLOCK_REQUEST_LOGGING`          | 环境变量回退结构化请求日志                      | `false` |
| `AIRLOCK_IP_RATE_LIMIT_POLICY`     | 环境变量回退 IP 限流策略（JSON）                | —       |
| `AIRLOCK_CONFIG_STORE`             | Console overlay 配置存储绑定                    | —       |
| `AIRLOCK_GOOGLE_SUPER_ADMIN_EMAIL` | 将匹配的 Google OAuth 用户映射为 super admin    | —       |

---

## API 参考

### 数据面

| 端点                          | 方法 | 说明                             |
| ----------------------------- | ---- | -------------------------------- |
| `/v1/chat/completions`        | POST | OpenAI Chat Completions 协议     |
| `/v1/responses`               | POST | OpenAI Responses 协议            |
| `/v1/messages`                | POST | Anthropic Messages 协议          |
| `/v1/models`                  | GET  | 列出可用模型                     |
| `/v1/models/:model`           | GET  | 获取模型详情                     |
| `/v1/models/:provider/:model` | GET  | 获取 provider-addressed 模型详情 |

所有 `/v1/*` 数据面端点需要通过 `Authorization: Bearer <key>` 头（或传统 `x-api-key` 头）
提供 API 密钥。

### 探针

| 端点       | 方法 | 说明                         |
| ---------- | ---- | ---------------------------- |
| `/healthz` | GET  | 存活探针                     |
| `/readyz`  | GET  | 就绪探针（含 Provider 验证） |

探针端点不需要认证，便于基础设施健康检查直接调用。

### 管理面

管理端点需要通过 `Authorization: Bearer <admin-token>` 认证。传统
`AIRLOCK_INTERNAL_ADMIN_TOKEN` 是 superuser token；结构化
`AIRLOCK_INTERNAL_ADMIN_CREDENTIALS` 会强制执行下表中的 scope。

| 端点                                            | 方法   | Scope          | 说明                             |
| ----------------------------------------------- | ------ | -------------- | -------------------------------- |
| `/_airlock/status`                              | GET    | `status.read`  | 网关状态和配置指纹               |
| `/_airlock/metrics`                             | GET    | `metrics.read` | 请求指标（滑动窗口）             |
| `/_airlock/config`                              | GET    | `config.read`  | 活跃配置（密钥已脱敏）           |
| `/_airlock/config/manage`                       | GET    | `config.write` | 原始配置存储快照                 |
| `/_airlock/config/manage/:section`              | GET    | `config.write` | 原始配置存储 section             |
| `/_airlock/config/manage/:section`              | PUT    | `config.write` | 写入配置存储 section             |
| `/_airlock/config/manage/:section`              | DELETE | `config.write` | 删除配置存储 section             |
| `/_airlock/providers/fetch-models`              | POST   | `config.write` | 使用提供的凭证发现 provider 模型 |
| `/_airlock/routing/health`                      | GET    | `routing.read` | 按路由健康状态和熔断器状态       |
| `/_airlock/keys`                                | GET    | `keys.read`    | 列出网关密钥                     |
| `/_airlock/keys`                                | POST   | `keys.write`   | 创建密钥                         |
| `/_airlock/keys`                                | PATCH  | `keys.write`   | 批量更新密钥                     |
| `/_airlock/keys/bulk-create`                    | POST   | `keys.write`   | 批量创建密钥                     |
| `/_airlock/keys/bulk-rotate`                    | POST   | `keys.write`   | 批量轮换密钥                     |
| `/_airlock/keys/bulk-delete`                    | POST   | `keys.write`   | 批量删除密钥                     |
| `/_airlock/keys/bulk-archive`                   | POST   | `keys.write`   | 批量归档密钥                     |
| `/_airlock/keys/bulk-restore`                   | POST   | `keys.write`   | 批量恢复密钥                     |
| `/_airlock/keys/bulk-rotate/finalize`           | POST   | `keys.write`   | 完成批量分阶段轮换               |
| `/_airlock/keys/bulk-rotate/cancel`             | POST   | `keys.write`   | 取消批量分阶段轮换               |
| `/_airlock/keys/:id`                            | GET    | `keys.read`    | 获取密钥详情                     |
| `/_airlock/keys/:id`                            | PUT    | `keys.write`   | 更新密钥元数据/策略              |
| `/_airlock/keys/:id`                            | DELETE | `keys.write`   | 删除密钥                         |
| `/_airlock/keys/:id/rotate`                     | POST   | `keys.write`   | 轮换密钥                         |
| `/_airlock/keys/:id/rotate/finalize`            | POST   | `keys.write`   | 完成分阶段密钥轮换               |
| `/_airlock/keys/:id/rotate/cancel`              | POST   | `keys.write`   | 取消分阶段密钥轮换               |
| `/_airlock/keys/:id/archive`                    | POST   | `keys.write`   | 归档密钥                         |
| `/_airlock/keys/:id/restore`                    | POST   | `keys.write`   | 恢复已归档密钥                   |
| `/_airlock/keys/:id/revocation`                 | GET    | `keys.read`    | 读取密钥撤销状态                 |
| `/_airlock/keys/:id/revocation`                 | POST   | `keys.write`   | 撤销密钥                         |
| `/_airlock/keys/:id/revocation`                 | DELETE | `keys.write`   | 清除密钥撤销                     |
| `/_airlock/keys/:id/status`                     | GET    | `keys.read`    | 密钥配额/状态快照                |
| `/_airlock/keys/:id/events`                     | GET    | `keys.read`    | 密钥审计事件                     |
| `/_airlock/keys/operations/:operationId/events` | GET    | `keys.read`    | 操作级密钥审计事件               |
| `/_airlock/keys/:id/registry`                   | GET    | `keys.read`    | 读取 registry override 视图      |
| `/_airlock/keys/:id/registry`                   | PUT    | `keys.write`   | 设置 registry override           |
| `/_airlock/keys/:id/registry`                   | DELETE | `keys.write`   | 清除 registry override           |

---

## 部署

### Cloudflare Workers

网关作为 Cloudflare Worker 部署。需要的绑定：

- **Durable Objects** — 密钥配额、token 配额、并发控制、撤销、
  密钥注册表、熔断器、IP 限流
- **Queue** — 遥测事件管线
- **Analytics Engine** — 遥测数据存储

```bash
# 部署到生产环境
cd apps/gateway && pnpm wrangler deploy

# 或使用 CI 管线（推送到 main 分支时自动部署）
```

### 控制台（Cloudflare Pages）

```bash
cd apps/console && pnpm build
# 将 `dist/` 目录部署到 Cloudflare Pages
```

### CI/CD

包含两个 GitHub Actions 工作流：

- **CI**（`ci.yml`）— 推送和 PR 触发：lint、typecheck、test、build、format、
  生产依赖 audit 和 Playwright E2E
- **部署**（`deploy.yml`）— 推送到 main 分支触发：验证 + 部署到
  Cloudflare Workers（支持 production 和 staging 环境）

---

## 模型路由示例

```bash
AIRLOCK_MODEL_ALIASES='gpt-4=openai-prod:gpt-4.1-mini,claude=anthropic-prod:claude-sonnet-4-5'
AIRLOCK_MODEL_FALLBACKS='{"gpt-4":["openai-compatible-a:gpt-4.1-mini","anthropic-prod:claude-sonnet-4-5"]}'
AIRLOCK_MODEL_TARGET_SELECTION='{"gpt-4":{"strategy":"weighted","weights":{"openai-prod:gpt-4.1-mini":10,"anthropic-prod:claude-sonnet-4-5":1}}}'
AIRLOCK_MODEL_KEY_POLICY='{"gpt-4":{"requiredKeyTier":"premium","requiredKeyTags":["chat"]}}'
```

客户端可直接使用 `gpt-4` 或 `claude` 作为模型名 — Airlock 自动路由到
配置的 Provider 实例，并在故障时自动回退。也可以使用
`openai-prod/gpt-4.1-mini` 这类 provider-addressed 模型 ID。

---

## 测试

```bash
pnpm test           # 运行所有测试套件
pnpm typecheck      # 类型检查 (tsgo)
pnpm build          # 构建所有包
pnpm e2e            # 运行 Console Playwright E2E 测试
pnpm run audit      # 生产依赖安全审计
```

当前验证套件包含 2000+ 个 Vitest 单元/集成测试，并有 Console Playwright E2E
覆盖。覆盖范围包括协议、canonical 管线、provider、路由、治理、请求整形、
遥测、网关集成和 Console 工作流。

---

## 技术栈

- **运行时**：Cloudflare Workers
- **HTTP 框架**：Hono
- **校验**：Zod
- **语言**：TypeScript（strict，`exactOptionalPropertyTypes`，
  `noUncheckedIndexedAccess`）
- **构建**：tsdown（库）、wrangler（Worker）、Vite（控制台）
- **前端**：React 19、TanStack Router、HeroUI、TailwindCSS 4
- **测试**：Vitest
- **工具链**：pnpm workspaces、ESLint、Prettier

---

## 许可证

MIT。见 [LICENSE](./LICENSE)。
