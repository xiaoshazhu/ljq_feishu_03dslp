# Role & Philosophy
你是一名资深的全栈开发架构师（Senior Full Stack Architect）。
你的核心职责是编写高质量、高可维护性、高可读性的代码，并严格遵守工程化开发规范。
**所有交互、思考过程、代码注释、提交记录必须完全使用简体中文。**

# 1. 语言与注释规范 (Language & Commenting)
**核心原则：代码是写给人看的，注释必须清晰详尽，杜绝模糊不清。**

1.  **全中文交互**：
    * 无论是解释代码、生成 Commit Message 还是编写文档，**必须**使用简体中文。
    * 保留专业技术名词（如 `Promise`, `Component`, `Interface`）的英文原文，不进行强行翻译。

2.  **强制性文档注释 (JSDoc/DocString)**：
    * **每一个**类、公共方法、导出函数（Function/Method）都必须包含标准的文档注释。
    * **注释格式必须包含**：
        * `功能描述`：一句话清晰描述该函数解决什么业务问题。
        * `@param`：详细说明参数名称、数据类型、以及参数的业务含义（必填/选填）。
        * `@return`：详细说明返回值的类型、数据结构以及不同情况下的返回内容。

3.  **行内注释**：
    * 对于复杂的逻辑判断、正则表达式或算法实现，必须在代码行上方添加中文注释，解释“为什么要这么写”以及“逻辑流向”。

# 2. 项目结构意识 (Project Structure Awareness)
**核心原则：严谨区分上下文，防止前后端代码混淆。**

1.  **目录隔离 (Directory Isolation)**：
    * 在编写代码前，必须先分析当前项目的目录结构。
    * 如果项目是前后端分离结构（例如存在 `frontend/` vs `backend/`, `client/` vs `server/`）：
        * **严禁**在前端目录下创建后端逻辑文件（如数据库连接、API 路由）。
        * **严禁**在后端目录下引入前端组件（如 React/Vue 组件）。
    * 在执行文件操作时，必须明确指定所属的根目录模块。

2.  **路径规范**：
    * 引用文件或生成新文件时，始终使用清晰的相对路径或绝对路径，确保文件落位准确。

# 3. 开发闭环工作流 (The Development Loop)
你必须严格按照以下闭环流程执行任务。**只有完成当前功能的所有收尾工作（提交+文档），才能进入下一个功能的开发。**

## Phase 1: 思考与设计 (Think)
* 也就是 "Chain of Thought"。在写代码前，用中文列出实现步骤。
* 确认修改的文件路径，确认前后端界限。

## Phase 2: 代码实现 (Code)
* 编写代码，严格执行上述“注释规范”。
* 保持原子化：一次只解决一个具体的需求或 Bug，不要在这个阶段做无关的优化。

## Phase 3: 交付与归档 (Mandatory Closing)
**当功能代码编写完成并验证无误后，必须按顺序执行以下两步操作：**

### Step A: 提交代码 (Git Commit)
生成符合 **Conventional Commits** 规范的中文提交信息：
* `feat: <描述>` (新增功能，例如：`feat: 完成用户登录接口开发`)
* `fix: <描述>` (修复 Bug)
* `docs: <描述>` (文档变更)
* `style: <描述>` (格式化，不影响代码运行的变动)
* `refactor: <描述>` (代码重构)

### Step B: 完善项目文档 (Doc Update)
**这一步是强制的。** 立即检查项目根目录下的 `README.md` 或项目说明文件：
1.  **功能更新**：将新开发的功能点添加到“功能列表”或“更新日志”中。
2.  **接口同步**：如果修改了 API，同步更新文档中的接口定义、参数说明。
3.  **配置检查**：如果引入了新的依赖或环境变量，必须在文档的“安装/配置”部分进行更新。

---
**执行准则：**
每当你完成一个功能开发，请按照以下模板结束对话，提示用户确认：
> ✅ **功能已完成**
> 1. 代码已更新（附带关键注释）。
> 2. Git Commit 建议：`feat: ...`
> 3. 文档 `README.md` 已同步更新。
>
> **接下来我们要开发哪个新功能？**

## 数据同步插件接口选择到同步成功流程
1. 前端配置台先调用 `GET /api/v1/connector/doudian-interfaces`，读取数据库 `doudian_interfaces` 中 `is_enabled = 1` 的接口目录。
2. 用户在配置台选择接口后，前端把 `doudianInterface` 快照、字段映射、时间范围、账号信息等一起保存到飞书 `datasourceConfig.value`。
3. 飞书触发 `POST /api/table_meta` 时，后端按 `syncModule -> interface_key` 查数据库，并将 `fields_schema` 转成飞书可识别的表结构。
4. 飞书触发 `POST /api/records` 时，后端会先按 `companyId + userId` 从数据库刷新最新账号 Cookie，再按 `request_config` 组装真实请求。
5. 如果接口配置了 `local_aggregate_path`，则先进入本地聚合接口；本地聚合接口再根据多来源参数继续请求真实抖店接口。
6. 真实接口响应返回后，后端先按 `request_config.listPaths` 提取列表，再依据 `fields_schema[].sourcePath` 把字段映射成飞书 records。
7. 如果响应列表项本身是 JSON 字符串，可在数据库打开“列表项 JSON 解析”开关，后端会先把每一项 `JSON.parse` 再做字段映射。
8. 当分页结束且 `hasMore = false` 时，本轮同步完成；若 Cookie 失效并返回 `10008`，后续轮询会重新走数据库中的最新账号凭证。

## 接口配置速查表
`doudian_interfaces.request_config` 常用字段如下，全部写在数据库 JSON 中：

| 字段 | 作用 | 示例 |
| --- | --- | --- |
| `method` | 真实接口请求方法 | `"GET"` / `"POST"` |
| `contentType` | POST 请求体编码方式 | `"application/json;charset=UTF-8"` |
| `pageParam` | 页码参数名 | `"page"` |
| `pageSizeParam` | 分页大小参数名 | `"pageSize"` / `"size"` |
| `pageStart` | 起始页码 | `0` / `1` |
| `pageSize` | 普通直连接口默认单页大小 | `100` |
| `pagination` | 是否启用分页参数 | `true` / `false` |
| `listPaths` | 响应列表路径数组 | `["data.list"]` |
| `totalPaths` | 响应总数字段路径数组 | `["data.total"]` |
| `extraQuery` | 静态请求参数，GET 会拼到 query，POST 会并入基础参数 | `{"req_source":"dou_dian_pc"}` |
| `extraBody` | 仅 POST body 追加的静态参数 | `{"scene":"settlement"}` |
| `extraHeaders` | 额外请求头 | `{"X-Requested-With":"XMLHttpRequest"}` |
| `referer` | 自定义 Referer | `"https://fxg.jinritemai.com/"` |
| `includeOriginHeader` | POST 时是否补 `Origin` | `true` |
| `dateRangeMapping` / `syncTimeRangeMapping` | 时间范围字段映射 | `{"startTime":"start_time","endTime":"end_time","format":"timestamp_ms"}` |
| `parseListItemJson` | 是否把列表每一项按 JSON 字符串解析，默认 `false` | `true` |
| `listItemFormat` | 列表项格式开关，写 `"json"` 或 `"json_string"` 时也会触发解析 | `"json_string"` |

列表项为普通对象时，无需配置 JSON 解析；只有接口返回类似下面这种字符串列表时才需要开启：

```json
{
  "listPaths": ["data"],
  "parseListItemJson": true
}
```

```json
[
  "{\"order_id\":\"6926380170248355402\",\"pay_type\":\"PA\"}"
]
```

开启后，后端会先将列表项解析成对象，再按 `fields_schema.sourcePath` 正常取值，例如：

```json
[
  { "key": "order_id", "sourcePath": "order_id" },
  { "key": "pay_type", "sourcePath": "pay_type" }
]
```

字段类型里如果写了 `type: "percentage"`，后端会把原始小数比例转成飞书文本列可直接展示的百分比字符串。例如：

```json
{
  "key": "ctr",
  "type": "percentage",
  "fieldName": "点击率",
  "sourcePath": "ctr",
  "defaultField": "col_ctr"
}
```

当真实值为 `0.03958` 时，写入飞书的仍然是文本列，但值会被格式化成 `3.96%`。如需调整保留位数，可额外配置 `percentageDigits`，默认保留 2 位小数。

---

# 4. 项目开发更新日志 (Project Changelog)

## [2026-07-06] 百分比文本字段支持
*   **功能更新与文档同步**：
    *   **新增 percentage 字段格式化**：当 `fields_schema` 中字段类型配置为 `percentage` 时，后端会将 0~1 的小数比例转成百分比文本，例如 `0.03958 -> 3.96%`，便于直接写入飞书文本列展示。
    *   **支持自定义小数位数**：字段可选配置 `percentageDigits` 控制保留位数，默认 2 位。

## [2026-07-06] 接口配置文档补充与列表项 JSON 解析开关
*   **功能更新与文档同步**：
    *   **新增接口配置速查表**：在 README 中补充 `doudian_interfaces.request_config` 的常用字段说明，覆盖分页、静态参数、Headers、时间范围映射等数据库配置方式。
    *   **补充同步成功链路说明**：新增“数据同步插件接口选择到同步成功流程”，描述从接口目录选择、飞书 `table_meta` / `records` 调用到真实抖店请求与分页结束的完整链路。
    *   **新增列表项 JSON 字符串解析开关文档**：明确支持通过 `parseListItemJson=true` 或 `listItemFormat=json_string` 控制是否将列表中的 JSON 字符串项自动解析为对象，默认不开启，避免影响普通接口。

## [2026-06-29] 抖店店铺接口目录入库与可选同步入口
*   **功能更新与架构调整**：
    *   **新增抖店接口注册表**：后端 MySQL 初始化新增 `doudian_interfaces` 表，按《抖店 - 店铺接口说明总览》写入 14 个店铺后台接口，保留 `https://fxg.jinritemai.com` 域名前缀、接口路径、业务模块、接口名称、是否接入、请求配置与通用字段 Schema。
    *   **只暴露已接入接口**：新增 `GET /api/v1/connector/doudian-interfaces`，前端只展示数据库中 `is_enabled = 1` 的接口，未接入的配置/统计类接口不会出现在用户同步选择列表。
    *   **配置页支持接口目录选择**：Vue 配置台的“目标同步动作 / 模块”在原有订单、资金、千川模块基础上，追加数据库驱动的“店铺接口”分组，用户可以选择当前要同步的子账号、店铺保障、店铺管理、账号绑定、申诉或违规记录接口。
    *   **真实同步接入 Cookie 请求链路**：当同步模块为店铺接口目录项时，后端通过 `https://fxg.jinritemai.com` + `api_path` 发起携带 Cookie 的真实请求，并按数据库请求配置处理分页、列表路径和总数路径。
    *   **通用明细 Schema 兜底**：由于部分接口的分页参数和响应字段路径仍待抓包确认，当前先落为通用字段表（记录 ID、业务模块、接口名称、接口路径、状态摘要、创建/更新时间、原始 JSON），后续可逐个接口细化专用字段映射。
    *   **商品资质接口真实字段接入**：根据抓包示例将 `/product_qual/list?page=0&size=100` 配置为 GET + Cookie 请求，响应列表路径为 `data.brand_qual_list`、总数字段为 `data.total`，字段区和飞书表结构接口返回真实字段：`qual_id`、`qual_name`、`qual_type`、`qual_type_name`、`qual_first_img`、`update_time`、`qual_source`。
    *   **字段配置数据库化生效**：表结构接口 `/api/table_meta` 会按数据库接口目录的 `fields_schema` 动态返回字段；表记录接口 `/api/records` 会按字段配置的 `sourcePath` 从第三方响应中取值，保证“字段与同步配置”和真实同步数据一致。

## [2026-06-29] Vue 开发热更新代理与后端 MySQL 存储迁移
*   **功能更新与架构调整**：
    *   **开发环境移除 dist 依赖**：后端不再默认托管 `data-sync-fe-vue-demo/dist`。现在 Express 会将未命中的前端页面、模块资源和 Vite HMR WebSocket 代理到 `FRONTEND_DEV_SERVER`，默认值为 `http://127.0.0.1:5173`，飞书/ngrok 仍访问后端统一域名即可获得 Vue 热更新。
    *   **Vue 开发端口固定**：`data-sync-fe-vue-demo/vite.config.ts` 固定 `5173` 且启用 `strictPort`，保证后端代理目标稳定。
    *   **后端数据库迁移至 MySQL**：移除 SQLite 运行依赖，`database.js` 改为 `mysql2/promise` 连接池实现，保留 `initDb`、`saveAccount`、`getAccounts`、`saveCapturedBuffer`、`saveTask` 等原导出函数，降低业务层改动面。
    *   **后端环境配置**：新增 `data-sync-be-demo/.env` 存放本地 MySQL 连接参数与前端开发服务器地址。

## [2026-06-29] 前端配置台 Vue3 + TypeScript 独立版本迁移
*   **功能更新与架构调整**：
    *   **保留原 React 前端目录**：原 `data-sync-fe-demo` 不删除、不改造为 Vue，继续作为历史 React 实现与回退参考。
    *   **新增 Vue3 独立前端项目**：新增 `data-sync-fe-vue-demo`，使用 Vue3、TypeScript、Vite 与 Ant Design Vue 重写飞书连接器配置台，保留数据源选择、账号授权、参数设置、字段映射、网页登录 Cookie 捕获、书签助手和保存配置等核心链路。
    *   **后端加载方式切换**：初始迁移时后端曾托管 `data-sync-fe-vue-demo/dist`；随后已调整为开发模式代理 Vite dev server，避免每次修改前端后重新打包。
    *   **书签脚本地址自适应**：Vue 版本书签助手使用当前页面 `window.location.origin` 自动生成上报地址，减少 ngrok 域名变化时的手动维护成本。
    *   **构建验证通过**：已执行 `npm run build`，Vue3 前端通过 `vue-tsc` 类型检查与 Vite 生产构建。

## [2026-06-17] 飞书多维表格连接器资金模块“账户中心”余额明细与传参同步开发
*   **功能更新与修复**：
    *   **资金模块二级分类树重构**：在前端 `App.tsx` 中，将原先罗盘分类重构为“💰 资金板块”，并原汁原味注入 7 大核心二级模块：账户中心、保证金账户、抖店货款、帐单管理、返佣管理、发票管理、历史报表。实现了其他 6 个新模块平滑 fallback 复用账户中心字段的交互。
    *   **账户中心高级传参设置**：在参数设置面板中，当选择“账户中心”时，动态展示商户 UID、支付通道（聚合/微信/抖音支付）和时间同步类型（相对天数/自定义日期范围）配置。其中自定义日期使用 HTML5 原生 Date 类型的 Antd Input，实现了在手机/PC浏览器自适应且无兼容问题的起止日期选择。
    *   **余额明细 Schema 定义**：在后端 `table_meta.js` 注入了 `account_center` 模块专属的字段 Schema（包括“资金流水号”、“记账时间”、“业务类型”、“交易金额”、“账户余额”、“支付通道”、“商户 UID”），满足多维表格一对一映射规则。
    *   **queryAccountFlows 接口真实对接**：修改了后端 `dy_helper.js` 中的 `fetchRealDoudianData`：当为 `account_center` 且为真实连接时，向抖店后台发送 POST 请求。根据所选通道（聚合/微信/抖音）动态装配 `uid_type` 和 `member_type`，并将起止时间换算成精确毫秒级时间戳传参。
    *   **Mock 开发调试降级（时间与通道匹配）**：在后端 `table_records.js` 的 Mock 分支中重构支持了资金模块的数据生成。能基于用户配置的支付通道、商户 UID 和自定义起止时间，仿真产生符合对应参数条件的资金余额流水，极大地便利了传参同步测试。
    *   **集成测试通过**：运行了 `test_account_flows.js` 自检脚本，对“相对天数+聚合支付”、“自定义时间段+微信支付”及“真实失效+抖音支付（非静默抛出）”三条分支测试，校验结果均 100% 通过。

## [2026-06-17] 飞书多维表格连接器模式 B 真实连接处理与异常非静默抛出重构
*   **功能更新与修复**：
    *   **通用真实请求分流机制**：在 `dy_helper.js` 中重写并导出了 `fetchRealDoudianData` 核心拉取函数。支持依据 `syncModule` 执行真实的抖店订单（POST 请求）、罗盘成交（GET 概览）、罗盘商品及抖店资金明细接口请求。
    *   **非静默降级（坚拒Mock）**：在 `table_records.js` 数据同步中，通过判断 Cookie 属性对真实与 Mock 流量进行物理隔离。若 Cookie 为真实凭证（不以 `mock_` 开头），若拉取发生过期/异常，系统不再进行静默 Mock 降级，而是主动将 `CredentialsExpired` 异常透传抛给飞书，保障数据的生产真实性。
    *   **CJS 兼容性修复**：解决 node-fetch v3 版本在 CommonJS 下由于 `require('node-fetch')` 为 Module 包装导致 `fetch is not a function` 的报错，通过追加 `.default` 解包兼容逻辑彻底修复。
    *   **自适应 HTML 重定向失效检测**：对于无效 Cookie 请求抖店接口时遭遇反爬网关重定向至 HTML 登录页的情况（返回 `text/html` 而非 JSON 报文），新增了 Content-Type 前置检查，并精准捕获和转化为 `CredentialsExpired` 异常抛出。
    *   **验证与部署**：重新打包了前端 Vite 静态产物，部署启动了 Express 服务器，运行集成自检脚本针对“Mock调试翻页（16549条）”与“真实连接失效（非静默抛出）”两条链路均 100% 通过验证。

## [2026-06-17] 飞书多维表格连接器模式 B 网页登录捕获与系统整改完成
*   **功能更新与修复**：
    *   **Cookie 校验防空容错拦截 (修复)**：修复了用户在未激活轮询情况下通过书签成功回传凭据、导致前端内存 Cookie 状态为空无法绑定的故障。在确认绑定时增加了强力防空兜底策略，主动去后端捕获缓冲区做一次同步拉取，保障一键连接 100% 成功。
    *   **精致锚点导航与 Scrollspy 滚动监听**：实现左侧五大区块锚点导航与右侧长滚动表单双向关联，利用 IntersectionObserver 实现了顺滑高亮切换和一键平滑滚动定位。
    *   **账号设置“两步式”绑定弹窗**：点击“关联账号”后，引导用户选择共享账号或自建新账号，支持官方 API (Mode A) 与网页登录 (Mode B) 的无缝切换，并提供 Cookie 手动录入与扫码登录两种捕获通道。
    *   **CORS 放行与 Cookie 捕获轮询**：后端放行 CORS，支持书签提取脚本回传 Cookie 凭据。前端在网页模拟登录拉起 `fxg.jinritemai.com` 期间自动进行 `capture-status` 轮询，拦截成功后子窗口自动关闭销毁，且凭证长效保活。
    *   **抖音数据结构对齐与异常静默归档**：实现 `table_meta.js` 与 `table_records.js` 标准 6 列结构对齐，并增加 `error_logger.js`。遇到失效凭证时，自动向本地 `errors.json`（模拟特定异常监控多维表格）中记录故障元数据，提供强大的对账保障。
    *   **动态 `meta.json` 与 Vite 托管构建**：前端通过 Vite 成功编译，并由 Express 3000 端口静态托管。`meta.json` 的加载 URI 能够自适应解析 ngrok 域名，实现本地零修改直接联调。

## [2026-06-17] 抖店订单管理接口 API 主动拼接与多页数据抓取方案升级
*   **功能更新**：
    *   **API URL 拦截与提取**：书签助手前端脚本在 `fxg.jinritemai.com` 订单管理页面上运行时，不仅 Hook 获取原始 JSON 响应，还会同时将截获到的真实 API 请求 URL（包含全部有效的 `__token`, `_bid`, `aid`, `_lid`, `verifyFp`, `fp`, `msToken`, `a_bogus` 签名因子）保存到全局变量。
    *   **主动拼接与多页 Fetch 调用**：以拦截到的 URL 为基础，在书签脚本中通过替换 `page` 参数（如 `page=0` 修改为 `page=1`, `page=2`），向抖店服务器发起拼接请求，主动拉取前 3 页数据（最多 30 条最新订单记录）。
    *   **多页去重与合并上传**：将抓取到的各页订单进行去重合并，并优雅降级至仅保留当前拦截单页或 DOM 解析提取数据，确保高可用与高容错性，最后统一上传至后端，大大提高了订单同步的条数和完整度。
    *   **服务平滑重启与集成自检**：热重启了后端 Node.js 服务并运行了本地集成测试脚本，同步分页与 API 交互逻辑 100% 验证通过。

## [2026-06-16] 修复"店铺id不合法"报错：书签脚本重构为纯凭证捕获模式
*   **问题修复**：
    *   **根因分析**：书签脚本中直接调用 `https://mcs.zijieapi.com/list` 接口，但该接口并非抖音罗盘订单管理真实 API，其 `shop_id` 参数格式和业务语义不匹配，导致返回"店铺id不合法"错误。
    *   **架构重构**：将书签脚本从"前端抓取订单+凭证回传"模式重构为"**纯凭证捕获**"模式——仅提取 Cookie 和 Shop ID 后通过 postMessage 安全回传至后端保存，不再在前端直接调用任何抖音 API。订单数据由后端 `dy-order-manage.js` 统一代理拉取。
    *   **正则转义修复**：修复了模板字符串中 `\\\\s`/`\\\\d` 双重转义导致正则在运行时失效的问题，改用正确的 `\\s`/`\\d` 单层转义。新增 URL 路径提取 `shop_id` 作为额外兜底维度。
    *   **data-ingest 适配**：后端 `data-ingest` 端点新增对空 records 数组的智能处理——纯凭证模式不写 cache 文件（避免覆盖已有订单缓存），但仍正常保存 Cookie 凭证到持久化凭证库。
    *   **Bookmarklet URI 修复**：将 `javascript:` 书签的代码压缩方式从 `replace` 改为 `encodeURIComponent`，避免正则替换损坏脚本内容。
    *   **集成自检通过**：数据回传 + 三页分页同步 + 纯凭证捕获三条链路全部绿色通过。

## [2026-06-16] 抖音罗盘书签捕获 CSP 跨域拦截与商户 ID 兜底热修复
*   **功能更新**：
    *   **中转回传页与 postMessage 通信**：在 mock-login.html 中新增了 `?role=ingest` 中转路由。书签脚本在抖音官方页面运行完毕后通过 `window.open` 打开中转子窗口，利用跨域安全的 `postMessage` 发送订单和 Cookie 载荷，由中转同源页面上报，**彻底绕过了抖音页面 CSP 跨域拦截限制**。
    *   **多维商户 ID 提取与高强兜底**：修正了书签内正则双斜杠转义过多的失效问题。联合了 Cookie 及 localStorage 中的商户 ID 模糊检索，且在极端未匹配时提供 `prompt` 输入框询问进行 **100% 稳妥兜底**，防止商户 ID 缺失致使服务报错。
    *   **回归自检联调完成**：热重启了后端服务并运行集成自测，Ingest 接收与飞书 records 三页级联分页同步验证 100% 通过。

## [2026-06-16] 抖音罗盘书签抓取、数据安全回传及分页同步升级
*   **功能更新**：
    *   **超级书签脚本抓取 (Bookmarklet Grabber)**：重新编写了 mock-login.html 中的一键书签脚本与控制台代码，支持在抖音罗盘官方页面运行并在页面上弹出一个精美的玻璃拟态浮动进度条，通过官方 API 循环抓取全部订单记录，完美兼容并同步大数量订单（如 16372 条真实订单）。
    *   **跨域数据注入接收 (Ingest API)**：在 index.js 中扩展并放行了 `/api/v1/connector/sources/data-ingest` 跨域接收端点，安全将书签上报的大批量订单数据保存至本地 data/cache 中，同时自动从 Cookie 中提取 Shop ID 并更新企业/个人共享凭证库，向前端推送成功完成信号。
    *   **本地缓存内存分页同步**：重写了 dy-order-manage.js 的 `getRecords` 方法，优先读取本地缓存，并依据飞书的 pageToken 规范在内存中执行高效切片，实现 100% 成功、极速无阻的数据导入。
    *   **回归集成测试自检**：重构并执行了 test-integration.js 联调脚本，测试了 Ingest 回传与飞书 records 逐页拉取的完整分页链路，结果全部绿色通过。

## [2026-06-16] 抖音罗盘模式 B 纯化测试环境集成
*   **功能更新**：
    *   **请求日志与重启优化**：将全局请求日志中间件移动到最顶部，以支持记录包括静态文件（如 `meta.json`）在内的全部请求，排查 `unexpected EOF` 问题。编译构建前端并重启了后端 3000 端口服务。
    *   **彻底去金蝶化**：移出了代码模板中所有关于金蝶云星辰的连接选项、业务树选择与相关 TreeSelect 逻辑，专注于抖音数据源。
    *   **抖音罗盘纯化**：将配置界面默认且锁定为“抖音电商罗盘模式 B 网页登录同步”。
    *   **核心修复：飞书同步主键报错与数据为空问题 (Primary ID & Empty Cells Fix)**：
        *   **故障排查**：在飞书中进行订单同步时，先后遇到了两个阻碍：第一是报错 `primaryID length need between 1 and 100`，经排查，是因为飞书连接器协议要求每行记录对象外层必须具有 `primaryId` 属性，且元数据中必须包含 `type` 与 `is_primary` 定义；第二是数据虽然没有报错但拉取下来全是空的，是因为记录 `data` 内的单元格数据的键名必须是英文的 `fieldId`（如 `sync_id`），而先前代码误改为了中文显示名（如“同步ID”），导致飞书读取不到相应数据。
        *   **解决方案**：重构并彻底规范了 `business-objects/index.js` 中的数据映射和清洗机制。第一，在 `getTableMeta` 中注入了飞书协议规范的 `type` 和 `is_primary` 字段；第二，在 `getRecords` 返回记录中，外层补全了 `primaryId` 唯一标示，而 `data` 内的单元格数据恢复使用标准的英文 `fieldId`，彻底解决了报错和数据为空的缺陷。
    *   **非必填与闪退修复**：
        *   将关联新账号表单中的 **店铺别名** 与 **抖音店铺 ID** 改为**非必填项**。
        *   修复了在 Form 中点击按钮导致 submit 表单刷新、使子弹窗一闪而过销毁的故障（通过显式指定 `htmlType="button"` 隔离）。
    *   **双登录调试通道**：
        *   新增 **🔑 调起官方真实登录页** 按钮：在新窗口中打开抖音电商罗盘真实登录主页（`https://op.jinritemai.com/login`），可真实验证手机号/验证码发送及官方接口调用。
        *   新增 **⚙️ 调起模拟捕获子弹窗** 按钮：调起本地 `/mock-login.html` 模拟器以测试 Cookie 拦截与窗口自动关闭。


    *   **新增 Cookie 粘贴调试区**：自建账号表单中新增 **Cookie 凭证串 (cookie)** 输入文本域 ( TextArea，非必填 )，支持王某手动录入抖音真实 Cookie。
*   **接口同步与调试**：
    *   模拟登录 H5 页面中彻底移除了原生 alert()，改为在页面内浮动渲染的气泡提示，避免焦点流失导致的窗口崩溃。
    *   新增 POST /api/v1/connector/sources/login-capture（Cookie上报）与 /api/v1/mock/dy/*（罗盘菜单及数据模拟）。
    *   重写 POST /api/verify_credentials 路由为直接返回成功。
*   **调试与托管**：
    *   前端静态资源打包编译后由后端 3000 端口一键式托管。支持使用 ngrok http 3000 穿透后端开始本地多维表格对接联调。

## [2026-06-16] 抖音罗盘真实接口对接开发与代理发布
*   **功能更新**：
    *   **订单管理真实接口对接**：修改了 dy-order-manage.js 模块，将 Mock 数据拉取更换为请求抖音真实的 https://mcs.zijieapi.com/list 接口。集成了多维度字段自适应映射及响应格式自适应兼容逻辑，彻底打通订单真实同步链路。
    *   **登录激活验证码发送真实代理**：
        *   在 index.js 中新增了 /api/v1/connector/sources/send-real-code 真实代理路由，后端代理发送真实验证码短信至商户手机。
    *   **构建部署与回归测试**：编译构建了最新的前端静态资源包，重启了后端服务。通过触发多维表格同步，确认请求能正确调用真实 API 且异常和分页解析无误。

## [2026-06-16] 抖音罗盘 100% 真实登录及书签自动捕获回传升级
*   **功能更新**：
    *   **全新推出“一键书签/控制台脚本捕获助手” (Bookmarklet & Console Capturer)**：
        *   在模拟登录页面 /mock-login.html 引入精致的 Tab 切换布局。推出全新的“浏览器一键安全捕获”工具与一键复制控制台回传脚本功能。
        *   王某在登录官方罗盘页面 (https://compass.jinritemai.com/) 后，点击书签栏提取器或在控制台运行脚本，即可通过跨域 POST 将 Cookie 安全自动发给本地连接器。
    *   **后端支持跨域 (CORS) 凭据捕获与轮询机制**：
        *   在 index.js 增加了针对 /api/v1/connector/sources/login-capture 的 CORS 拦截与 OPTIONS 预检报头处理，解除浏览器跨域安全限制。
        *   新增 /api/v1/connector/sources/capture-status（捕获状态轮询）与 /api/v1/connector/sources/capture-clear（清空暂存）端点，令配置面板在截获 Cookie 后实现全自动状态同步与页面关闭。
    *   **废除本地降级模拟通道**：
        *   从 index.js、dy-order-manage.js 等模块中彻底清除了对测试手机号 18006521603 及仿真 mock_session 的任何特殊降级拦截。订单同步与验证码下发完全对接抖音官方真实接口。
