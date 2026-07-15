# 飞书多维表格抖店数据连接器

Node.js + Vue 3 实现的飞书多维表格数据连接器。后端从 MySQL 读取接口目录和加密账号凭证，受控请求抖店后台接口，并按飞书数据连接协议返回表结构和分页记录。

## 项目结构

| 目录 | 作用 |
| --- | --- |
| `feishu-doudian-connector-server` | Express 后端、MySQL 存储、飞书协议、抖店请求与聚合接口 |
| `data-sync-fe-vue-demo` | Vue 3 + TypeScript 配置台 |
| `生产化整改记录.md` | 问题、修复、配置、容量、部署、回滚和验证记录 |
| `数据库以及功能分布.md` | 当前 MySQL 表结构、权限边界和数据流 |
| `历史开发记录.md` | 早期开发规范和历史更新记录，仅供追溯 |

## 核心能力

- 飞书 `table_meta`、`records` 原始 Body 签名校验。
- 管理 API 可信网关 HMAC 身份认证和 MySQL 跨实例防重放。
- 企业、用户、私有账号和共享账号数据隔离。
- 抖店 Cookie AES-256-GCM 加密存储。
- 短效一次性 Cookie 捕获 token 和严格 CSP 同源中转。
- 抖店主动请求 HTTPS Origin 白名单和非 2xx 检查。
- 实例、企业、账号三级并发背压和热点账号公平调度。
- 请求、响应体和飞书协议截止时间保护。
- 数据库驱动的接口目录、字段 Schema、分页和本地聚合。
- 同步日志、稳定错误码、请求 ID、健康检查和优雅停机。

## 本地开发

要求 Node.js 20+ 和可访问的 MySQL。

```bash
cd feishu-doudian-connector-server
cp .env.example .env
npm ci
npm start
```

另一个终端启动前端：

```bash
cd data-sync-fe-vue-demo
npm ci
npm run dev
```

开发模式下后端默认把未命中的页面和 Vite HMR 请求代理到 `http://127.0.0.1:5173`。

## 生产构建

先完成前端构建：

```bash
cd data-sync-fe-vue-demo
npm ci
npm run build
```

再安装并启动后端：

```bash
cd ../feishu-doudian-connector-server
npm ci --omit=dev
npm run start:prod
```

生产启动会读取 `.env.production`，并依次校验环境变量、前端产物、MySQL 结构和加密配置。完整变量说明见 [生产化整改记录](./生产化整改记录.md) 和后端 [.env.production.example](./feishu-doudian-connector-server/.env.production.example)。

## 线上临时测试

本地 `.env` 仍用于开发联调；线上临时测试建议复制独立配置文件：

```bash
cd feishu-doudian-connector-server
cp .env.staging.example .env.staging
npm run start:staging
```

当前域名约定：前端 `https://dd.feishu.anhuishuzhi.com`，后端 `https://dd.hd.feishu.anhuishuzhi.com`。临时测试配置使用 `NODE_ENV=staging`，暂不强制飞书签名、管理网关 HMAC 和生产密钥；正式上线时改用 `.env.production.example` 生成 `.env.production`，并通过 `npm run start:prod:file` 启动。

## 主要接口

| 方法与路径 | 用途 | 保护 |
| --- | --- | --- |
| `POST /api/table_meta` | 返回飞书表结构 | 飞书签名 |
| `POST /api/records` | 返回分页同步记录 | 飞书签名、并发背压、截止时间 |
| `GET /api/v1/connector/doudian-interfaces` | 查询已启用接口目录 | 同源、可信网关身份、限流 |
| `POST /api/v1/connector/sources/capture-session` | 创建一次性捕获会话 | 同源、可信网关身份、限流 |
| `POST /api/v1/connector/sources/login-capture` | 书签上报 Cookie | 抖店 Origin、一次性 token、限流 |
| `/api/v1/connector/accounts/*` | 账号管理 | 同源、可信网关身份、限流 |
| `GET /api/v1/sync/logs` | 查询同步日志 | 同源、可信网关身份、限流 |
| `GET /healthz` | 进程存活检查 | 无 |
| `GET /readyz` | 数据库就绪检查 | 无 |

## 验证

```bash
cd feishu-doudian-connector-server
npm test
npm run check

cd ../data-sync-fe-vue-demo
npm run build
```

2026-07-14 的验收结果：后端 28 项测试通过（含 100 请求突发背压回归），前端生产构建通过，前后端 npm 官方 Registry 审计均为 0 个已知漏洞。

## 上线前提

以下事项未完成前，不应直接暴露为公网生产服务：

1. 部署可信认证网关，按本文档的 HMAC 规范签名管理 API，并禁止绕过网关直连后端。
2. 轮换历史中出现过的 Cookie、MySQL 密码和飞书签名密钥。
3. 配置相互独立的 `MANAGEMENT_IDENTITY_SECRET`、`CREDENTIAL_ENCRYPTION_KEY` 与 `LOCAL_AGGREGATE_TOKEN`。
4. 在预发布环境验证真实 MySQL 迁移、真实抖店接口和多页同步。

完整上线步骤、容量参数、监控与回滚方案见 [生产化整改记录](./生产化整改记录.md)。
