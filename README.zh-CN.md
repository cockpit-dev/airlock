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
- **管理 API** — 29 个认证管理端点，覆盖状态、指标、配置、路由健康
  和完整密钥生命周期管理。
- **控制台** — SvelteKit 5 管理界面，包含登录、密钥管理、路由健康、
  配置查看和状态监控。
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
| `apps/dashboard`           | SvelteKit 5 管理控制台（Cloudflare Pages 部署）                               |
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

1. 复制环境变量示例文件并填入 provider 密钥：

```bash
cp apps/gateway/.dev.vars.example apps/gateway/.dev.vars
```

2. 编辑 `apps/gateway/.dev.vars`，至少设置以下变量：

```
AIRLOCK_GATEWAY_API_KEYS=your-secret-key-here
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_DEFAULT_MODEL=gpt-4.1-mini
```

3. 启动网关开发服务器：

```bash
pnpm --filter airlock-gateway dev
```

4. 在另一个终端启动控制台：

```bash
pnpm --filter @airlock/dashboard dev
```

### 验证

```bash
# 运行全部检查
pnpm typecheck && pnpm test && pnpm build

# 或单独运行
pnpm lint          # 所有包的 ESLint 检查
pnpm typecheck     # TypeScript 类型检查
pnpm test          # 所有包的 Vitest 测试
pnpm build         # 构建所有包和应用
```

---

## 配置

所有配置通过 Cloudflare Workers 环境变量驱动。完整配置参考见
`apps/gateway/.dev.vars.example`，包含每个变量的说明和默认值。

### 必需变量

| 变量                       | 说明                                   |
| -------------------------- | -------------------------------------- |
| `AIRLOCK_GATEWAY_API_KEYS` | 调用方认证密钥（逗号分隔或 JSON 数组） |
| `OPENAI_API_KEY`           | OpenAI Provider API 密钥               |
| `OPENAI_BASE_URL`          | OpenAI API 基础 URL                    |
| `OPENAI_DEFAULT_MODEL`     | 路由回退使用的默认模型                 |

### 关键可选变量

| 变量                                   | 说明                        | 默认值  |
| -------------------------------------- | --------------------------- | ------- |
| `AIRLOCK_MODE`                         | 运行模式：`free` 或 `scale` | `free`  |
| `AIRLOCK_MODEL_ALIASES`                | 模型路由配置（JSON）        | —       |
| `AIRLOCK_MODEL_FALLBACKS`              | 故障回退目标（JSON）        | —       |
| `AIRLOCK_PROVIDER_TIMEOUT_MS`          | 上游请求超时（毫秒）        | `30000` |
| `AIRLOCK_PROVIDER_MAX_RETRIES`         | 最大跨 Provider 重试次数    | `0`     |
| `AIRLOCK_CORS_ORIGINS`                 | 允许的 CORS 源              | —       |
| `AIRLOCK_REQUEST_LOGGING`              | 启用结构化请求日志          | `false` |
| `AIRLOCK_INTERNAL_ADMIN_TOKEN`         | 管理 API 认证令牌           | —       |
| `AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED` | 启用动态密钥注册表          | `false` |

---

## API 参考

### 数据面

| 端点                   | 方法 | 说明                         |
| ---------------------- | ---- | ---------------------------- |
| `/v1/chat/completions` | POST | OpenAI Chat Completions 协议 |
| `/v1/responses`        | POST | OpenAI Responses 协议        |
| `/v1/messages`         | POST | Anthropic Messages 协议      |
| `/v1/models`           | GET  | 列出可用模型                 |
| `/v1/models/:model`    | GET  | 获取模型详情                 |
| `/healthz`             | GET  | 存活探针                     |
| `/readyz`              | GET  | 就绪探针（含 Provider 验证） |

所有数据面端点需要通过 `Authorization: Bearer <key>` 头（或传统 `x-api-key` 头）
提供 API 密钥。

### 管理面

| 端点                            | 方法   | 说明                       |
| ------------------------------- | ------ | -------------------------- |
| `/_airlock/status`              | GET    | 网关状态和配置指纹         |
| `/_airlock/metrics`             | GET    | 请求指标（滑动窗口）       |
| `/_airlock/config`              | GET    | 活跃配置（密钥已脱敏）     |
| `/_airlock/routing/health`      | GET    | 按路由健康状态和熔断器状态 |
| `/_airlock/keys`                | GET    | 列出网关密钥               |
| `/_airlock/keys`                | POST   | 创建密钥                   |
| `/_airlock/keys/:id`            | GET    | 获取密钥详情               |
| `/_airlock/keys/:id`            | DELETE | 删除密钥                   |
| `/_airlock/keys/:id/rotate`     | POST   | 轮换密钥                   |
| `/_airlock/keys/:id/archive`    | POST   | 归档密钥                   |
| `/_airlock/keys/:id/restore`    | POST   | 恢复已归档密钥             |
| `/_airlock/keys/:id/revocation` | POST   | 撤销密钥                   |
| `/_airlock/keys/:id/status`     | GET    | 密钥配额状态               |
| `/_airlock/keys/:id/events`     | GET    | 密钥审计事件               |

管理端点需要通过 `Authorization: Bearer <admin-token>` 认证。

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
cd apps/dashboard && pnpm build
# 将 `.svelte-kit/cloudflare/` 目录部署到 Cloudflare Pages
```

### CI/CD

包含两个 GitHub Actions 工作流：

- **CI**（`ci.yml`）— 推送和 PR 触发：lint、typecheck、test、build、audit
- **部署**（`deploy.yml`）— 推送到 main 分支触发：验证 + 部署到
  Cloudflare Workers（支持 production 和 staging 环境）

---

## 模型路由示例

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

客户端可直接使用 `gpt-4` 或 `claude` 作为模型名 — Airlock 自动路由到
配置的 Provider，并在故障时自动回退。

---

## 测试

```bash
pnpm test           # 运行所有测试套件
pnpm typecheck      # 类型检查 (tsgo)
pnpm build          # 构建所有包
```

项目在 48 个测试文件中维护 1850+ 个测试用例，覆盖协议、canonical 管线、
provider、路由、治理、请求整形、遥测和网关集成。

---

## 技术栈

- **运行时**：Cloudflare Workers
- **HTTP 框架**：Hono
- **校验**：Zod
- **语言**：TypeScript（strict，`exactOptionalPropertyTypes`，
  `noUncheckedIndexedAccess`）
- **构建**：tsdown（库）、wrangler（Worker）、Vite（控制台）
- **前端**：SvelteKit 5、TailwindCSS 4、adapter-cloudflare
- **测试**：Vitest
- **工具链**：pnpm workspaces、ESLint、Prettier

---

## 许可证

私有项目，保留所有权利。
