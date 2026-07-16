/**
 * JSDoc 文档注释
 * @module Index
 */

const path = require("path");
const envFile = String(process.env.ENV_FILE || ".env").trim();
require("dotenv").config({
  path: path.isAbsolute(envFile) ? envFile : path.join(__dirname, envFile),
  quiet: true
});
const express = require("express");
const compression = require("compression");
const crypto = require("crypto");
const fs = require("fs");

const { getTableMeta } = require("./table_meta.js");
const { getTableRecords } = require("./table_records.js");
const { fetchRealDoudianData } = require("./dy_helper.js");
const { doudianLocalAggregateRouter } = require("./doudian_local_aggregate.js");
const { validateRequestSignature } = require("./request_sign.js");
const {
  getFrontendPublicOrigin,
  getManagementIdentityAuthMode,
  getManagementIdentityMaxAgeMs,
  getManagementIdentitySecret,
  isProduction,
  readInteger,
  validateRuntimeConfig
} = require("./runtime_config.js");
const {
  verifyManagementIdentityRequest
} = require("./management_identity.js");
const {
  AppError,
  forbiddenError,
  isAppError,
  notFoundError,
  upstreamError,
  validationError
} = require("./app_error.js");
const { createRateLimiter } = require("./rate_limiter.js");
const {
  acquireSyncSlot,
  ConcurrencyLimitError,
  syncConcurrencySettings
} = require("./concurrency_control.js");

// 引入 MySQL 数据库操作
const {
  initDb,
  closeDb,
  pingDb,
  saveAccount,
  updateAccountById,
  getAccounts,
  getSharedAccounts,
  setActiveAccount,
  deleteAccount,
  createCaptureSession,
  consumeCaptureSession,
  saveCapturedBuffer,
  getCapturedBuffer,
  consumeCapturedBuffer,
  clearCapturedBuffer,
  saveTask,
  updateAccountModule,
  getDoudianInterfaces,
  getDoudianInterfaceByKey,
  createSyncLog,
  finishSyncLog,
  listSyncLogs,
  consumeManagementIdentityNonce
} = require("./database.js");

const app = express();
const isProductionRuntime = isProduction();
const frontendDevServer = process.env.FRONTEND_DEV_SERVER || "http://127.0.0.1:5173";
const frontendPublicOrigin = getFrontendPublicOrigin();
const frontendPublicUrl = frontendPublicOrigin;
const frontendDistPath = path.resolve(__dirname, "../data-sync-fe-vue-demo/dist");
const serverPort = readInteger("PORT", 3000, 1, 65535);
const tableMetaDeadlineMs = readInteger("TABLE_META_DEADLINE_MS", 8000, 1000, 9500);
const recordsDeadlineMs = readInteger("RECORDS_DEADLINE_MS", 18000, 5000, 19500);
const managementIdentityAuthMode = getManagementIdentityAuthMode();
const managementIdentitySecret = getManagementIdentitySecret();
const managementIdentityMaxAgeMs = getManagementIdentityMaxAgeMs();
let serviceReady = false;
let server = null;
let shuttingDown = false;

app.disable("x-powered-by");
app.set("trust proxy", readInteger("TRUST_PROXY_HOPS", 1, 0, 16));

// 保存原始 JSON 字节用于飞书签名校验，同时明确限制请求体大小。
app.use(express.json({
  limit: process.env.JSON_BODY_LIMIT || "1mb",
  verify(req, res, buffer) {
    req.rawBodyBuffer = Buffer.from(buffer);
    req.rawBody = buffer.toString("utf8");
  }
}));

app.use((req, res, next) => {
  const requestId = String(req.headers["x-request-id"] || crypto.randomUUID()).slice(0, 128);
  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (isProductionRuntime) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (req.path.startsWith("/api/v1/connector/") || req.path.startsWith("/api/v1/sync/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

app.use(compression({
  threshold: readInteger("HTTP_COMPRESSION_THRESHOLD_BYTES", 1024, 0, 1024 * 1024)
}));

const captureRateLimiter = createRateLimiter({
  windowMs: 60000,
  max: readInteger("CAPTURE_RATE_LIMIT_PER_MINUTE", 20, 1, 1000),
  maxBuckets: readInteger("RATE_LIMIT_MAX_BUCKETS", 10000, 100, 100000),
  keyGenerator(req) {
    const tokenHash = crypto
      .createHash("sha256")
      .update(String(req.body?.token || ""), "utf8")
      .digest("hex")
      .slice(0, 16);
    return `${req.ip}:${tokenHash}`;
  },
  message: "凭证上报过于频繁，请稍后重试"
});

const managementRateLimiter = createRateLimiter({
  windowMs: 60000,
  max: readInteger("MANAGEMENT_RATE_LIMIT_PER_MINUTE", 120, 1, 5000),
  maxBuckets: readInteger("RATE_LIMIT_MAX_BUCKETS", 10000, 100, 100000),
  keyGenerator(req) {
    return `${req.ip}:${getCompanyId(req)}:${getUserId(req)}`;
  }
});

const managementApiGuards = [
  requireSameOrigin,
  requireManagementIdentity,
  requireIdentityContext,
  managementRateLimiter
];
app.use(allowFrontendManagementCors);
app.use("/api/v1/connector/accounts", ...managementApiGuards);
app.use("/api/v1/connector/shared-accounts", ...managementApiGuards);
app.use("/api/v1/connector/sources/capture-session", ...managementApiGuards);
app.use("/api/v1/connector/sources/capture-status", ...managementApiGuards);
app.use("/api/v1/connector/sources/capture-clear", ...managementApiGuards);
app.use("/api/v1/connector/doudian-interfaces", ...managementApiGuards);
app.use("/api/v1/connector/doudian/test-connection", ...managementApiGuards);
app.use("/api/v1/sync", ...managementApiGuards);

/**
 * 功能描述：从请求中解析企业 ID，优先使用飞书 tenantKey。
 * @param {object} req - Express 请求
 * @return {string} 返回企业 ID
 */
function getCompanyId(req) {
  if (req.authenticatedIdentity?.companyId) {
    return normalizeIdentity(req.authenticatedIdentity.companyId);
  }
  const embeddedConfig = extractEmbeddedConnectorConfig(req);
  return normalizeIdentity(
    req.body?.companyId ||
    req.body?.tenantKey ||
    embeddedConfig.companyId ||
    embeddedConfig.tenantKey ||
    req.query?.companyId ||
    req.query?.tenantKey ||
    req.headers['x-company-id'] ||
    req.headers['x-tenant-key'] ||
    'default'
  );
}

/**
 * 功能描述：从请求中解析飞书用户 ID，用于个人私有账号和捕获缓冲隔离。
 * @param {object} req - Express 请求
 * @return {string} 返回用户 ID
 */
function getUserId(req) {
  if (req.authenticatedIdentity?.userId) {
    return normalizeIdentity(req.authenticatedIdentity.userId);
  }
  const embeddedConfig = extractEmbeddedConnectorConfig(req);
  return normalizeIdentity(
    req.body?.userId ||
    req.body?.openId ||
    embeddedConfig.userId ||
    embeddedConfig.openId ||
    req.query?.userId ||
    req.query?.openId ||
    req.headers['x-user-id'] ||
    req.headers['x-open-id'] ||
    'default'
  );
}

/**
 * 功能描述：清洗租户和用户标识，限制长度并移除控制字符。
 * @param {unknown} value 原始标识
 * @return {string} 返回安全标识
 */
function normalizeIdentity(value) {
  const normalized = String(value || 'default')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 128);
  return normalized || 'default';
}

/**
 * 功能描述：从飞书回调的 params.datasourceConfig.value 中解析连接器保存的配置。
 * @param {object} req - Express 请求
 * @return {object} 返回已保存的连接器配置对象
 */
function extractEmbeddedConnectorConfig(req) {
  const paramsObj = parseMaybeJsonObject(req.body?.params, {});
  const datasourceConfigObj = parseMaybeJsonObject(
    paramsObj.datasourceConfig || req.body?.datasourceConfig || req.body?.config,
    {}
  );
  const rawConfigValue = datasourceConfigObj.value || req.body?.config?.value;
  return parseMaybeJsonObject(rawConfigValue, {});
}

/**
 * 功能描述：分域部署时允许配置台页面跨域访问后端管理 API。
 * @param {object} req Express 请求
 * @param {object} res Express 响应
 * @param {Function} next Express 后续中间件
 * @return {void} 无返回值
 */
function allowFrontendManagementCors(req, res, next) {
  if (req.path === "/api/v1/connector/sources/login-capture") {
    return next();
  }
  const isManagementPath = (
    req.path.startsWith("/api/v1/connector/")
    || req.path.startsWith("/api/v1/sync/")
  );
  if (!isManagementPath || !frontendPublicOrigin) return next();

  const origin = String(req.headers.origin || "");
  if (origin === frontendPublicOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Pragma");
  }
  if (req.method === "OPTIONS") {
    return origin === frontendPublicOrigin ? res.sendStatus(204) : res.sendStatus(403);
  }
  next();
}

// 只有书签捕获端点允许来自抖店页面的跨域写入，其他敏感接口保持同源。
app.use((req, res, next) => {
  const isCapturePath = req.path === "/api/v1/connector/sources/login-capture";
  if (!isCapturePath) {
    return next();
  }

  const origin = String(req.headers.origin || "");
  const allowedOrigin = isAllowedCaptureOrigin(origin) || isCurrentRequestOrigin(req, origin);
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    return allowedOrigin
      ? res.sendStatus(204)
      : res.sendStatus(403);
  }
  if (!allowedOrigin) {
    return sendApiError(
      res,
      req,
      forbiddenError("不允许的凭证上报来源", "CAPTURE_ORIGIN_FORBIDDEN")
    );
  }
  next();
});

/**
 * 功能描述：浏览器直接访问根路径时跳转到前端页面；非页面探活请求仍返回纯文本状态。
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.get("/", (req, res) => {
  const accept = req.headers.accept || "";
  if (accept.includes("text/html")) {
    return res.redirect("/index.html");
  }
  res.send("飞书连接器后端服务正在平稳运行中！");
});

/**
 * 功能描述：提供稳定的后端健康检查接口。
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.get("/healthz", (req, res) => {
  res.status(200).json({
    status: "ok",
    ready: serviceReady,
    shuttingDown
  });
});

/**
 * 功能描述：提供包含数据库连通性的就绪检查，供负载均衡器决定是否接收流量。
 * @param {object} req Express 请求
 * @param {object} res Express 响应
 */
app.get("/readyz", async (req, res) => {
  if (!serviceReady || shuttingDown) {
    return res.status(503).json({ status: "not_ready" });
  }
  try {
    await pingDb();
    res.status(200).json({ status: "ready" });
  } catch (error) {
    res.status(503).json({ status: "database_unavailable" });
  }
});

/**
 * 功能描述：提供同源 Cookie 捕获中转页，通过 postMessage 绕过抖店页面的跨域 CSP 限制。
 * @param {object} req Express 请求
 * @param {object} res Express 响应
 * @return {void} 无返回值
 */
app.get("/capture-relay.html", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader("X-Frame-Options", "DENY");
  res.type("html").send(buildCaptureRelayHtml());
});

/**
 * 功能描述：动态解析并返回 meta.json 元数据，将界面加载 URI 动态替换为当前的 ngrok 外部穿透地址
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.get("/meta.json", (req, res) => {
  const host = req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  
  fs.readFile(
    path.join(__dirname, "./public/meta.json"),
    "utf8",
    (err, data) => {
      if (err) {
        return res.status(500).send("读取配置文件错误");
      }
      try {
        const json = JSON.parse(data);
        json.extraData.dataSourceConfigUiUri = frontendPublicUrl
          ? `${frontendPublicUrl}/index.html`
          : `${proto}://${host}/index.html`;
        
        res.set("Content-Type", "application/json");
        res.status(200).send(JSON.stringify(json, null, 2));
      } catch (e) {
        res.status(500).send("解析配置文件 JSON 失败");
      }
    }
  );
});

/**
 * 功能描述：接收飞书多维表格引擎关于字段 Schema 配置的请求
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.post("/api/table_meta", async (req, res) => {
  const signatureValidation = validateRequestSignature(req);
  if (!signatureValidation.valid) {
    return sendSignatureError(res, signatureValidation.reason, req.requestId);
  }

  const tableConfig = extractEmbeddedConnectorConfig(req);
  const syncModule = String(tableConfig.syncModule || "");

  try {
    const tableMeta = await withDeadline(
      getTableMeta(syncModule, tableConfig),
      Date.now() + tableMetaDeadlineMs,
      "TableMetaDeadlineExceeded: 表结构接口接近飞书 10 秒超时限制"
    );
    const result = {
      code: 0,
      msg: "",
      message: "POST请求成功",
      data: normalizeTableMetaResponse(tableMeta)
    };
    res.status(200).json(result);
  } catch (e) {
    const safeError = normalizeFeishuProtocolError(e, req.requestId);
    console.error("[Table Meta Error]", {
      requestId: req.requestId,
      message: e.message,
      stack: isProductionRuntime ? undefined : e.stack
    });
    res.status(200).json({
      code: 1254500,
      msg: JSON.stringify({ zh: safeError.message, en: safeError.englishMessage }),
      message: safeError.message,
      requestId: req.requestId,
      retryable: safeError.retryable
    });
  }
});

/**
 * 功能描述：接收飞书多维表格引擎获取数据的请求
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.post("/api/records", async (req, res) => {
  const signatureValidation = validateRequestSignature(req);
  if (!signatureValidation.valid) {
    return sendSignatureError(res, signatureValidation.reason, req.requestId);
  }

  const syncContext = extractSyncLogContext(req.body, getCompanyId(req));
  const deadlineAt = Date.now() + recordsDeadlineMs;
  console.log('[Sync Request]', {
    requestId: req.requestId,
    companyId: syncContext.companyId,
    transactionId: syncContext.transactionId,
    pageToken: syncContext.pageToken,
    accountKey: syncContext.accountKey,
    syncModule: syncContext.syncModule,
    signatureValid: true
  });
  let releaseSyncSlot = null;

  try {
    releaseSyncSlot = await acquireSyncSlot(syncContext);
  } catch (error) {
    if (error instanceof ConcurrencyLimitError) {
      console.warn('[Sync Concurrency] 拒绝过载请求', {
        companyId: syncContext.companyId,
        accountKey: syncContext.accountKey,
        transactionId: syncContext.transactionId,
        pageToken: syncContext.pageToken,
        scope: error.scope
      });
      return res.status(200).json({
        code: 1254500,
        msg: JSON.stringify({
          zh: '当前同步请求较多，请稍后重试',
          en: 'The sync service is busy. Please retry shortly.'
        }),
        message: '当前同步请求较多，请稍后重试',
        requestId: req.requestId,
        retryable: true
      });
    }
    console.error('[Sync Concurrency] 获取执行槽位失败', {
      requestId: req.requestId,
      message: error.message
    });
    return res.status(200).json({
      code: 1254500,
      msg: JSON.stringify({
        zh: '同步调度失败，请稍后重试',
        en: 'Sync scheduling failed. Please retry later.'
      }),
      message: '同步调度失败，请稍后重试',
      requestId: req.requestId,
      retryable: true
    });
  }

  await createSyncLog({
    ...syncContext,
    status: 'running',
    startedAt: new Date()
  }).catch((error) => console.error("创建同步日志失败", {
    requestId: req.requestId,
    message: error.message
  }));

  try {
    const records = await withDeadline(
      getTableRecords(req.body, {
        companyId: getCompanyId(req),
        userId: getUserId(req),
        deadlineAt
      }),
      deadlineAt,
      "RecordsDeadlineExceeded: 表记录接口接近飞书 20 秒超时限制"
    );
    const result = {
      code: 0,
      msg: "",
      message: "POST请求成功",
      data: normalizeRecordsResponse(records),
    };
    await finishSyncLog(syncContext.logKey, {
      status: 'success',
      finishedAt: new Date(),
      recordCount: Array.isArray(records.records) ? records.records.length : 0,
      hasMore: records.hasMore ? 1 : 0,
      nextPageToken: records.nextPageToken || '',
      durationMs: 'auto'
    }, syncContext.companyId).catch((error) => {
      console.error("更新同步成功日志失败:", {
        requestId: req.requestId,
        message: error.message
      });
    });
    res.status(200).json(result);
  } catch (e) {
    await finishSyncLog(syncContext.logKey, {
      status: 'failed',
      finishedAt: new Date(),
      durationMs: 'auto',
      errorMessage: e.message || String(e)
    }, syncContext.companyId).catch((error) => console.error("更新同步失败日志失败:", error));
    const safeError = normalizeFeishuProtocolError(e, req.requestId);
    console.error("[Records Error]", {
      requestId: req.requestId,
      companyId: syncContext.companyId,
      transactionId: syncContext.transactionId,
      pageToken: syncContext.pageToken,
      message: e.message,
      stack: isProductionRuntime ? undefined : e.stack
    });
    res.status(200).json({
      code: 1254500,
      msg: JSON.stringify({ zh: safeError.message, en: safeError.englishMessage }),
      message: safeError.message,
      requestId: req.requestId,
      retryable: safeError.retryable
    });
  } finally {
    if (releaseSyncSlot) releaseSyncSlot();
  }
});

/**
 * 功能描述：读取同步执行日志列表，支持按状态筛选。
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.get("/api/v1/sync/logs", async (req, res) => {
  try {
    const logs = await listSyncLogs(getCompanyId(req), {
      status: req.query.status,
      limit: req.query.limit,
      page: req.query.page,
      pageSize: req.query.pageSize
    });
    res.status(200).json(logs);
  } catch (e) {
    sendApiError(res, req, e, "读取同步日志失败");
  }
});

/**
 * 功能描述：兼容飞书数据同步插件表结构协议的字段命名，确保 Base 能识别主键字段。
 * @param {object} tableMeta 业务层返回的表结构
 * @return {object} 返回补齐 fieldID、fieldId、isPrimary 与 is_primary 的表结构
 */
function normalizeTableMetaResponse(tableMeta) {
  const fields = Array.isArray(tableMeta?.fields) ? tableMeta.fields : [];
  const primaryCount = fields.filter(
    (field) => field.isPrimary === true || field.is_primary === true
  ).length;
  if (primaryCount !== 1) {
    throw new Error(
      `DoudianPrimaryFieldInvalid: 飞书表结构必须且只能包含一个主键字段，当前为 ${primaryCount} 个`
    );
  }
  return {
    ...tableMeta,
    fields: fields.map((field) => {
      const fieldID = field.fieldID || field.fieldId || field.field_id;
      const isPrimary = field.isPrimary === true || field.is_primary === true;
      return {
        ...field,
        fieldID,
        fieldId: fieldID,
        field_id: fieldID,
        fieldType: field.fieldType || field.type,
        type: field.type || field.fieldType,
        isPrimary,
        is_primary: isPrimary
      };
    })
  };
}

/**
 * 功能描述：兼容飞书数据同步插件表记录协议的主键字段命名。
 * @param {object} recordsResult 业务层返回的分页记录结果
 * @return {object} 返回补齐 primaryID 与 primaryId 的记录结果
 */
function normalizeRecordsResponse(recordsResult) {
  const records = Array.isArray(recordsResult?.records) ? recordsResult.records : [];
  return {
    ...recordsResult,
    records: records.map((record) => {
      const primaryID = record.primaryID || record.primaryId || record.primary_id;
      return {
        ...record,
        primaryID,
        primaryId: primaryID,
        primary_id: primaryID
      };
    })
  };
}

/**
 * 功能描述：从飞书 /api/records 请求中提取同步执行日志所需上下文。
 * @param {object} reqBody 飞书请求体
 * @param {string} companyId 企业 ID
 * @return {object} 返回日志上下文
 */
function extractSyncLogContext(reqBody = {}, companyId = 'default') {
  const paramsObj = parseMaybeJsonObject(reqBody.params, {});
  const datasourceConfigObj = parseMaybeJsonObject(
    paramsObj.datasourceConfig || reqBody.datasourceConfig || reqBody.config,
    {}
  );
  const rawConfigValue = datasourceConfigObj.value || reqBody.config?.value;
  const config = parseMaybeJsonObject(rawConfigValue, {});
  const transactionId = reqBody.transactionID || reqBody.transactionId || paramsObj.transactionID || paramsObj.transactionId || '';
  const taskId = reqBody.taskId || reqBody.task_id || transactionId || `TASK_${Date.now().toString().substring(0, 8)}`;
  const pageToken = paramsObj.pageToken
    || paramsObj.page_token
    || paramsObj.nextPageToken
    || paramsObj.next_page_token
    || paramsObj.pagination?.pageToken
    || paramsObj.pagination?.page_token
    || reqBody.pageToken
    || reqBody.page_token
    || reqBody.nextPageToken
    || reqBody.next_page_token
    || reqBody.pagination?.pageToken
    || reqBody.pagination?.page_token
    || '';
  const syncModule = config.syncModule || '';
  const accountName = config.accountInfo?.name || '';
  const shopId = config.shopIdParam || config.accountInfo?.shopId || '';
  const accountKey = config.accountInfo?.key || config.accountInfo?.id || shopId || accountName || 'unknown';
  const logIdentity = JSON.stringify({
    companyId,
    transactionId: transactionId || taskId,
    pageToken: String(pageToken || '__first_page__')
  });
  return {
    companyId,
    taskId,
    transactionId,
    syncModule,
    accountName,
    accountKey,
    shopId,
    pageToken,
    logKey: `SYNC_${crypto.createHash('sha256').update(logIdentity).digest('hex').slice(0, 48)}`
  };
}

function parseMaybeJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

/**
 * 功能描述：判断书签凭证上报请求是否来自允许的抖店页面或当前连接器同源页面。
 * @param {string} origin 请求 Origin
 * @return {boolean} 返回来源是否允许
 */
function isAllowedCaptureOrigin(origin) {
  if (!origin) return false;
  return getAllowedCaptureOrigins().includes(origin);
}

/**
 * 功能描述：判断请求 Origin 是否为当前后端自身 Origin，允许捕获中转页同源提交凭证。
 * @param {object} req Express 请求
 * @param {string} origin 请求 Origin
 * @return {boolean} 返回是否为当前后端 Origin
 */
function isCurrentRequestOrigin(req, origin) {
  if (!origin) return false;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  if (!host || !proto) return false;
  return origin === `${proto}://${host}`;
}

/**
 * 功能描述：读取并规范化允许执行 Cookie 捕获的页面 Origin 白名单。
 * @return {Array<string>} 返回不含路径的 Origin 数组
 */
function getAllowedCaptureOrigins() {
  const rawOrigins = String(
    process.env.DOUDIAN_CAPTURE_ALLOWED_ORIGINS ||
    "https://fxg.jinritemai.com,https://compass.jinritemai.com"
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (frontendPublicOrigin) rawOrigins.push(frontendPublicOrigin);

  return [...new Set(rawOrigins.map((item) => {
    try {
      return new URL(item).origin;
    } catch (error) {
      return "";
    }
  }).filter(Boolean))];
}

/**
 * 功能描述：生成 Cookie 捕获同源中转页，限制消息来源并将凭证提交到一次性令牌端点。
 * @return {string} 返回完整 HTML 文本
 */
function buildCaptureRelayHtml() {
  const allowedOriginsJson = JSON.stringify(getAllowedCaptureOrigins()).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>抖店凭证捕获</title>
  <style>
    body{margin:0;display:grid;place-items:center;min-height:100vh;font:14px system-ui,sans-serif;background:#f7f8fa;color:#1f2329}
    main{width:min(420px,calc(100vw - 40px));padding:24px;border:1px solid #dfe3e8;background:#fff;border-radius:8px;text-align:center}
    #status{line-height:1.7;word-break:break-word}
  </style>
</head>
<body>
  <main><div id="status">正在建立安全捕获通道...</div></main>
  <script>
    (function () {
      var allowedOrigins = ${allowedOriginsJson};
      var status = document.getElementById('status');
      var completed = false;
      function notify(payload, targetOrigin) {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, targetOrigin);
        }
      }
      window.addEventListener('message', function (event) {
        if (completed || event.source !== window.opener || allowedOrigins.indexOf(event.origin) < 0) return;
        var message = event.data || {};
        if (message.type !== 'doudian-capture-credential' || !message.payload) return;
        completed = true;
        status.textContent = '正在安全保存凭证...';
        fetch('/api/v1/connector/sources/login-capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message.payload)
        }).then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            if (!response.ok || body.code !== 0) {
              throw new Error(body.message || '凭证保存失败');
            }
            return body;
          });
        }).then(function (body) {
          status.textContent = '凭证保存成功，可以关闭此窗口。';
          notify({ type: 'doudian-capture-result', ok: true, message: body.message || '存储成功' }, event.origin);
          window.setTimeout(function () { window.close(); }, 800);
        }).catch(function (error) {
          completed = false;
          status.textContent = error.message || '凭证保存失败，请返回配置页重新生成脚本。';
          notify({ type: 'doudian-capture-result', ok: false, message: status.textContent }, event.origin);
        });
      });
      notify({ type: 'doudian-capture-relay-ready' }, '*');
    })();
  </script>
</body>
</html>`;
}

/**
 * 功能描述：按飞书连接器协议返回签名校验失败信息。
 * @param {object} res Express 响应
 * @param {string} reason 校验失败原因
 * @param {string} requestId 请求追踪 ID
 * @return {object} 返回 Express 响应
 */
function sendSignatureError(res, reason, requestId = "") {
  console.warn("[Feishu Signature] 请求签名校验失败", { reason, requestId });
  return res.status(200).json({
    code: 1254500,
    msg: JSON.stringify({
      zh: "请求签名校验失败",
      en: "Request signature validation failed."
    }),
    message: "Request signature validation failed.",
    requestId,
    retryable: false
  });
}

/**
 * 功能描述：把内部异常转换为飞书同步协议可安全展示的双语错误信息。
 * @param {unknown} error 原始异常
 * @param {string} requestId 请求追踪 ID
 * @return {{message:string,englishMessage:string,retryable:boolean}} 返回安全协议错误
 */
function normalizeFeishuProtocolError(error, requestId) {
  const rawMessage = String(error?.message || error || "");
  if (isAppError(error) && error.expose !== false) {
    return {
      message: error.message,
      englishMessage: error.message,
      retryable: error.retryable === true
    };
  }
  if (/CredentialsExpired|凭证失效|Cookie过期/i.test(rawMessage)) {
    return {
      message: "抖店登录凭证已失效，请重新绑定账号",
      englishMessage: "The Doudian login credential has expired. Please reconnect the account.",
      retryable: false
    };
  }
  if (/DeadlineExceeded|SyncDeadlineExceeded|UpstreamTimeout/i.test(rawMessage)) {
    return {
      message: "同步请求超时，请稍后重试",
      englishMessage: "The sync request timed out. Please retry later.",
      retryable: true
    };
  }
  if (/UpstreamResponseTooLarge/i.test(rawMessage)) {
    return {
      message: "抖店接口响应过大，请缩小同步范围或单页数量",
      englishMessage: "The Doudian response is too large. Reduce the sync range or page size.",
      retryable: false
    };
  }
  if (/DoudianInterfaceRequired|DoudianInterfaceNotFound|DoudianFieldsSchemaMissing|DoudianPrimaryFieldInvalid|DoudianPrimaryValueMissing|DoudianPrimaryValueDuplicate|DoudianFieldSchemaInvalid|DoudianFieldMappingDuplicate/i.test(rawMessage)) {
    const message = rawMessage.replace(/^[A-Za-z0-9_]+:\s*/, "");
    return {
      message,
      englishMessage: message,
      retryable: false
    };
  }
  if (/Doudian|抖店接口/i.test(rawMessage)) {
    return {
      message: "抖店接口请求失败，请检查账号凭证和接口参数",
      englishMessage: "The Doudian API request failed. Check the account credential and request parameters.",
      retryable: true
    };
  }
  return {
    message: `服务内部错误，请稍后重试（请求 ID：${requestId}）`,
    englishMessage: `Internal service error. Please retry later. Request ID: ${requestId}`,
    retryable: false
  };
}

/**
 * 功能描述：把账号数据库记录转换为前端可展示对象，明确剔除 Cookie 等敏感凭证。
 * @param {object} account 数据库账号记录
 * @return {object} 返回安全账号对象
 */
function toPublicAccount(account) {
  return {
    id: account.id,
    key: account.key,
    name: account.name,
    mode: account.mode,
    status: account.status,
    shopId: account.shopId,
    is_active: account.is_active,
    isActive: account.is_active === 1,
    module: account.module,
    user_id: account.user_id,
    userId: account.user_id,
    share_scope: account.share_scope,
    shareScope: account.share_scope,
    updated_at: account.updated_at
  };
}

/**
 * 功能描述：保存任务配置前剔除 Cookie，避免敏感凭证被复制到 tasks JSON。
 * @param {object} config 原始任务配置
 * @return {object} 返回去除敏感字段后的配置副本
 */
function sanitizeTaskConfig(config = {}) {
  const safeConfig = JSON.parse(JSON.stringify(config || {}));
  if (safeConfig.accountInfo && typeof safeConfig.accountInfo === "object") {
    delete safeConfig.accountInfo.cookie;
  }
  delete safeConfig.cookie;
  return safeConfig;
}

/**
 * 功能描述：将数据库、上游和未知异常归一化为可安全返回的 AppError。
 * @param {unknown} error 原始异常
 * @param {string} fallbackMessage 日志中的业务上下文
 * @return {AppError} 返回带稳定状态码和错误码的业务异常
 */
function normalizeApiError(error, fallbackMessage = "请求处理失败") {
  if (isAppError(error)) return error;

  const rawMessage = String(error?.message || error || "");
  const rawCode = String(error?.code || "");
  if (rawCode === "ER_DUP_ENTRY") {
    return new AppError(409, "RESOURCE_CONFLICT", "数据已存在，请刷新后重试", {
      cause: error
    });
  }
  if (
    rawCode === "ECONNREFUSED" ||
    rawCode === "PROTOCOL_CONNECTION_LOST" ||
    rawCode === "ER_CON_COUNT_ERROR" ||
    rawCode === "ETIMEDOUT"
  ) {
    return new AppError(503, "DATABASE_UNAVAILABLE", "数据库暂时不可用，请稍后重试", {
      cause: error,
      retryable: true
    });
  }
  if (rawCode === "UPSTREAM_TIMEOUT" || /DeadlineExceeded|SyncDeadlineExceeded/i.test(rawMessage)) {
    return new AppError(504, "UPSTREAM_TIMEOUT", "上游请求超时，请稍后重试", {
      cause: error,
      retryable: true
    });
  }
  if (rawCode === "UPSTREAM_RESPONSE_TOO_LARGE" || /UpstreamResponseTooLarge/i.test(rawMessage)) {
    return new AppError(502, "UPSTREAM_RESPONSE_TOO_LARGE", "上游响应超过安全大小限制", {
      cause: error
    });
  }
  if (/CredentialsExpired|凭证失效|Cookie过期/i.test(rawMessage)) {
    return new AppError(401, "CREDENTIALS_EXPIRED", "抖店登录凭证已失效，请重新绑定账号", {
      cause: error
    });
  }

  return new AppError(500, "INTERNAL_ERROR", fallbackMessage, {
    cause: error,
    expose: false
  });
}

/**
 * 功能描述：统一发送管理 API 错误响应，500 级异常不向前端暴露 SQL、堆栈或内部地址。
 * @param {object} res Express 响应
 * @param {object} req Express 请求
 * @param {unknown} error 原始异常
 * @param {string} fallbackMessage 日志中的业务上下文
 * @return {object} 返回 Express 响应
 */
function sendApiError(res, req, error, fallbackMessage = "请求处理失败") {
  const appError = normalizeApiError(error, fallbackMessage);
  const status = Number(appError.statusCode || 500);
  const logPayload = {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    status,
    errorCode: appError.errorCode,
    message: error?.message || appError.message,
    context: fallbackMessage
  };
  if (status >= 500) {
    console.error("[HTTP Error]", logPayload);
  } else {
    console.warn("[HTTP Rejected]", logPayload);
  }

  return res.status(status).json({
    code: status,
    errorCode: appError.errorCode,
    message: appError.expose === false ? "服务内部错误，请稍后重试" : appError.message,
    requestId: req.requestId || "",
    retryable: appError.retryable === true
  });
}

/**
 * 功能描述：为异步任务增加整条接口截止时间保护，避免响应越过飞书平台限制。
 * @param {Promise<unknown>} promise 业务 Promise
 * @param {number} deadlineAt 绝对截止时间戳
 * @param {string} message 超时错误消息
 * @return {Promise<unknown>} 返回带截止时间的 Promise
 */
function withDeadline(promise, deadlineAt, message) {
  const timeoutMs = Math.max(1, Number(deadlineAt) - Date.now());
  let timer = null;
  const timeoutPromise = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

/**
 * 功能描述：校验配置管理请求来自连接器页面同源，降低 CSRF 和第三方网页滥用风险。
 * @param {object} req Express 请求
 * @param {object} res Express 响应
 * @param {Function} next Express 后续中间件
 * @return {void} 无返回值
 */
function requireSameOrigin(req, res, next) {
  if (!isProductionRuntime) return next();
  const origin = String(req.headers.origin || "");
  const referer = String(req.headers.referer || "");
  let refererOrigin = "";
  try {
    refererOrigin = referer ? new URL(referer).origin : "";
  } catch (error) {
    refererOrigin = "";
  }
  if (
    frontendPublicOrigin &&
    (origin === frontendPublicOrigin || (!origin && refererOrigin === frontendPublicOrigin))
  ) {
    return next();
  }
  return sendApiError(
    res,
    req,
    forbiddenError("配置管理请求来源校验失败", "MANAGEMENT_ORIGIN_FORBIDDEN")
  );
}

/**
 * 功能描述：校验可信网关注入的管理身份签名，并使用 MySQL nonce 表跨实例阻止重放。
 * @param {object} req Express 请求
 * @param {object} res Express 响应
 * @param {Function} next Express 后续中间件
 * @return {Promise<void>} 无返回值
 */
async function requireManagementIdentity(req, res, next) {
  if (managementIdentityAuthMode === 'none') return next();

  const verification = verifyManagementIdentityRequest(req, {
    secret: managementIdentitySecret,
    maxAgeMs: managementIdentityMaxAgeMs
  });
  if (!verification.valid) {
    const expired = verification.reason === 'timestamp_expired';
    return sendApiError(
      res,
      req,
      forbiddenError(
        expired ? '管理身份签名已过期' : '管理身份签名校验失败',
        expired ? 'MANAGEMENT_IDENTITY_EXPIRED' : 'MANAGEMENT_IDENTITY_INVALID'
      )
    );
  }

  try {
    const consumed = await consumeManagementIdentityNonce(
      verification.nonce,
      new Date(verification.timestampMs + managementIdentityMaxAgeMs)
    );
    if (!consumed) {
      return sendApiError(
        res,
        req,
        forbiddenError('管理身份签名已被使用', 'MANAGEMENT_IDENTITY_REPLAYED')
      );
    }
    req.authenticatedIdentity = verification.identity;
    next();
  } catch (error) {
    sendApiError(res, req, error, '校验管理身份防重放状态失败');
  }
}

/**
 * 功能描述：生产环境拒绝缺失租户或用户上下文的管理请求，避免数据落入共享 default 分区。
 * @param {object} req Express 请求
 * @param {object} res Express 响应
 * @param {Function} next Express 后续中间件
 * @return {void} 无返回值
 */
function requireIdentityContext(req, res, next) {
  if (!isProductionRuntime) return next();
  const companyId = getCompanyId(req);
  const userId = getUserId(req);
  if (["default", "unknown"].includes(companyId) || ["default", "unknown"].includes(userId)) {
    return sendApiError(
      res,
      req,
      validationError("缺少有效的飞书租户或用户标识", "IDENTITY_CONTEXT_REQUIRED")
    );
  }
  next();
}

/**
 * 功能描述：为当前配置页创建短效一次性 Cookie 捕获令牌，令牌只在本次书签操作中使用。
 * @param {object} req Express 请求
 * @param {object} res Express 响应
 * @return {Promise<void>} 无返回值
 */
app.post("/api/v1/connector/sources/capture-session", async (req, res) => {
  try {
    const session = await createCaptureSession(
      getCompanyId(req),
      getUserId(req),
      req.body?.module || ""
    );
    res.status(200).json({
      code: 0,
      message: "捕获会话已创建",
      token: session.token,
      expiresAt: session.expiresAt,
      requestId: req.requestId
    });
  } catch (error) {
    sendApiError(res, req, error, "创建捕获会话失败");
  }
});

/**
 * 功能描述：接收由浏览器一键捕获书签回传的 Cookie 凭据，并使用一次性令牌绑定真实用户上下文。
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.post("/api/v1/connector/sources/login-capture", captureRateLimiter, async (req, res) => {
  const { token, cookie, shopId, shopName } = req.body || {};

  try {
    const sessionContext = await consumeCaptureSession(token, {
      cookie,
      shopId: shopId || "",
      shopName: shopName || "抖店商家店铺"
    });
    console.log("[Cookie Capture] 凭证已写入服务端缓冲区", {
      companyId: sessionContext.companyId,
      userId: sessionContext.userId,
      shopId: shopId || "",
      cookieLength: String(cookie).length
    });
    res.status(200).json({
      code: 0,
      message: "存储成功",
      requestId: req.requestId
    });
  } catch (e) {
    sendApiError(res, req, e, "写入捕获凭证失败");
  }
});

/**
 * 功能描述：提供给前端 H5 弹窗轮询以查看当前是否成功捕获了 Cookie 凭证与关联模块
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.get("/api/v1/connector/sources/capture-status", async (req, res) => {
  try {
    const data = await getCapturedBuffer(getCompanyId(req), getUserId(req));
    res.status(200).json({
      captured: Number(data.captured) === 1,
      shopId: data.shopId || "",
      shopName: data.shopName || "",
      module: data.module || "",
      updatedAt: data.updated_at || null
    });
  } catch (e) {
    sendApiError(res, req, e, "读取捕获状态失败");
  }
});

/**
 * 功能描述：清空捕获凭证数据库缓冲区
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.post("/api/v1/connector/sources/capture-clear", async (req, res) => {
  try {
    await clearCapturedBuffer(getCompanyId(req), getUserId(req));
    res.status(200).json({ code: 0, message: "捕获缓冲区已清空" });
  } catch (e) {
    sendApiError(res, req, e, "清空捕获状态失败");
  }
});

/**
 * 功能描述：提供当前用户可免密关联的账号列表，包含同企业共享账号与当前用户私有账号。
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.get("/api/v1/connector/shared-accounts", async (req, res) => {
  try {
    const list = await getSharedAccounts(getCompanyId(req), getUserId(req));
    const visibleList = list.map((account) => ({
      ...toPublicAccount(account),
      id: account.key
    }));
    res.status(200).json(visibleList);
  } catch (e) {
    sendApiError(res, req, e, "获取共享账号列表失败");
  }
});

/**
 * 功能描述：获取所有已绑定/关联的本地新账号列表
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.get("/api/v1/connector/accounts", async (req, res) => {
  try {
    const list = await getAccounts(getCompanyId(req), getUserId(req));
    res.status(200).json(list.map(toPublicAccount));
  } catch (e) {
    sendApiError(res, req, e, "获取账号列表失败");
  }
});

/**
 * 功能描述：提供当前可被用户选择同步的抖店后台接口目录，接口来源于数据库 doudian_interfaces。
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.get("/api/v1/connector/doudian-interfaces", async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const list = await getDoudianInterfaces(true);
    res.status(200).json(list);
  } catch (e) {
    sendApiError(res, req, e, "获取抖店接口目录失败");
  }
});

/**
 * 功能描述：按接口 key 读取单个抖店接口完整配置，包含字段 Schema 与请求配置。
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.get("/api/v1/connector/doudian-interfaces/:interfaceKey", async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const detail = await getDoudianInterfaceByKey(req.params.interfaceKey);
    if (!detail) {
      return sendApiError(
        res,
        req,
        notFoundError("抖店接口不存在或未启用", "DOUDIAN_INTERFACE_NOT_FOUND")
      );
    }
    res.status(200).json(detail);
  } catch (e) {
    sendApiError(res, req, e, "获取抖店接口详情失败");
  }
});

/**
 * 功能描述：测试当前抖店 Cookie 与所选接口是否可连通，供配置页在保存前快速验证。
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.post("/api/v1/connector/doudian/test-connection", async (req, res) => {
  const companyId = getCompanyId(req);
  const userId = getUserId(req);
  const {
    syncModule,
    shopIdParam,
    doudianExtraQuery,
    doudianInterface,
    dateRange
  } = req.body || {};

  if (!syncModule) {
    return sendApiError(
      res,
      req,
      validationError("请选择需要测试的抖店同步接口", "SYNC_MODULE_REQUIRED")
    );
  }
  try {
    const accountsList = await getAccounts(companyId, userId);
    const activeAccount = accountsList.find((account) => account.is_active === 1) || accountsList[0];
    if (!activeAccount?.cookie) {
      return sendApiError(
        res,
        req,
        validationError("请先关联并启用一个抖店网页登录账号", "ACTIVE_ACCOUNT_REQUIRED")
      );
    }
    const resolvedShopId = String(shopIdParam || activeAccount.shopId || "").trim();
    if (!/^\d+$/.test(resolvedShopId)) {
      return sendApiError(
        res,
        req,
        validationError("请输入正确的数字格式抖音店铺 ID", "SHOP_ID_INVALID")
      );
    }

    const config = {
      syncModule,
      doudianInterface: doudianInterface || null,
      shopIdParam: resolvedShopId,
      doudianExtraQuery: doudianExtraQuery || {},
      dateRange: dateRange || "all",
      accountInfo: {
        name: activeAccount.name,
        mode: activeAccount.mode,
        cookie: activeAccount.cookie,
        shopId: activeAccount.shopId
      },
      maxPageSize: 100
    };
    const list = await fetchRealDoudianData(activeAccount.cookie, config.shopIdParam, syncModule, config, null, `TEST_${Date.now()}`, 1);
    const interfaceMeta = list.interfaceMeta || null;
    res.status(200).json({
      code: 0,
      message: "测试连接成功",
      data: {
        accountName: activeAccount.name,
        shopId: config.shopIdParam,
        interfaceName: interfaceMeta?.interfaceName || syncModule,
        apiPath: interfaceMeta?.apiPath || "",
        count: Array.isArray(list) ? list.length : 0,
        total: Number(list.total || 0),
        pageSize: Number(list.pageSize || list.length || 0)
      }
    });
  } catch (e) {
    sendApiError(
      res,
      req,
      upstreamError("测试连接失败，请检查账号凭证与接口参数", "DOUDIAN_TEST_FAILED", {
        cause: e,
        retryable: true
      })
    );
  }
});

/**
 * 功能描述：向 MySQL 数据库中添加绑定自己的全新账号
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.post("/api/v1/connector/accounts/add", async (req, res) => {
  const companyId = getCompanyId(req);
  const userId = getUserId(req);
  let consumedCredential = null;
  try {
    const account = { ...req.body, companyId, userId };
    if (req.body?.useCapturedCredential === true) {
      consumedCredential = await consumeCapturedBuffer(companyId, userId);
      if (!consumedCredential?.cookie) {
        return sendApiError(
          res,
          req,
          validationError("未找到可用的捕获凭证，请重新运行书签助手", "CAPTURED_CREDENTIAL_NOT_FOUND")
        );
      }
      account.cookie = consumedCredential.cookie;
      account.shopId = account.shopId || consumedCredential.shopId || "";
      account.status = "active";
    }
    if (!account.cookie) {
      return sendApiError(
        res,
        req,
        validationError("缺少账号 Cookie 凭证", "CREDENTIAL_REQUIRED")
      );
    }
    delete account.useCapturedCredential;
    await saveAccount(account);
    res.status(200).json({ code: 0, message: "账号已保存至数据库" });
  } catch (e) {
    if (consumedCredential?.cookie) {
      await saveCapturedBuffer({
        ...consumedCredential,
        companyId,
        userId
      }).catch((restoreError) => {
        console.error("[Credential Restore] 添加账号失败后恢复捕获凭证失败", {
          requestId: req.requestId,
          message: restoreError.message
        });
      });
    }
    sendApiError(res, req, e, "添加账号失败");
  }
});

/**
 * 功能描述：按账号 ID 局部修改账号信息，未传字段保持不变。
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.patch("/api/v1/connector/accounts/update", async (req, res) => {
  const { id, useCapturedCredential, tenantKey, userId: payloadUserId, ...updates } = req.body || {};
  if (!id) {
    return sendApiError(
      res,
      req,
      validationError("缺少账号 id", "ACCOUNT_ID_REQUIRED")
    );
  }
  let consumedCredential = null;
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    if (useCapturedCredential === true) {
      consumedCredential = await consumeCapturedBuffer(companyId, userId);
      if (!consumedCredential?.cookie) {
        return sendApiError(
          res,
          req,
          validationError("未找到可用的捕获凭证，请重新运行书签助手", "CAPTURED_CREDENTIAL_NOT_FOUND")
        );
      }
      updates.cookie = consumedCredential.cookie;
      updates.shopId = updates.shopId || consumedCredential.shopId || "";
      updates.status = "active";
    }
    await updateAccountById(id, updates, companyId, userId);
    res.status(200).json({ code: 0, message: "账号已更新" });
  } catch (e) {
    if (consumedCredential?.cookie) {
      await saveCapturedBuffer({
        ...consumedCredential,
        companyId: getCompanyId(req),
        userId: getUserId(req)
      }).catch((restoreError) => {
        console.error("[Credential Restore] 更新账号失败后恢复捕获凭证失败", {
          requestId: req.requestId,
          message: restoreError.message
        });
      });
    }
    sendApiError(res, req, e, "更新账号失败");
  }
});

/**
 * 功能描述：将指定账号设为活跃账号，并将其他账号设为非活跃
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.post("/api/v1/connector/accounts/active", async (req, res) => {
  const { key } = req.body || {};
  if (!key) {
    return sendApiError(
      res,
      req,
      validationError("缺少账号 key", "ACCOUNT_KEY_REQUIRED")
    );
  }
  try {
    await setActiveAccount(key, getCompanyId(req), getUserId(req));
    res.status(200).json({ code: 0, message: "活跃账号已更新" });
  } catch (e) {
    sendApiError(res, req, e, "更新活跃账号失败");
  }
});

/**
 * 功能描述：在本地数据库中解除某个关联的账号
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.delete("/api/v1/connector/accounts/:key", async (req, res) => {
  const { key } = req.params;
  try {
    const result = await deleteAccount(key, getCompanyId(req), getUserId(req));
    if (result.action === "not_owner") {
      return sendApiError(
        res,
        req,
        forbiddenError("只有账号创建人可以删除该账号", "ACCOUNT_OWNER_REQUIRED")
      );
    }
    const message = result.action === 'soft_deleted'
      ? "该账号已逻辑删除"
      : "账号不存在或已被移除";
    res.status(200).json({ code: 0, message, action: result.action });
  } catch (e) {
    sendApiError(res, req, e, "删除账号失败");
  }
});

/**
 * 功能描述：保存从前端提交的任务配置，用于后端心跳保活和后续定时增量同步任务
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.post("/api/v1/sync/tasks/save", async (req, res) => {
  const body = req.body || {};
  const { syncModule } = body;
  const companyId = getCompanyId(req);
  const userId = getUserId(req);

  try {
    const accountsList = await getAccounts(companyId, userId);
    const activeAccount = accountsList.find(a => a.is_active === 1);
    if (activeAccount && syncModule) {
      await updateAccountModule(activeAccount.key, syncModule, companyId, userId);
      console.log("[Task Save] 已更新当前活跃账号模块", {
        companyId,
        accountKey: activeAccount.key,
        syncModule
      });
    }

    const connectorConfigId = String(body.connectorConfigId || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '');
    const taskKey = connectorConfigId
      ? `bitable_task_${connectorConfigId}`.slice(0, 128)
      : 'bitable_task';
    await saveTask(taskKey, sanitizeTaskConfig(body), companyId);
    res.status(200).json({
      code: 0,
      message: "同步任务配置在后台存储成功",
      requestId: req.requestId
    });
  } catch (e) {
    sendApiError(res, req, e, "保存同步任务配置失败");
  }
});

app.use(doudianLocalAggregateRouter);

app.use("/api", (req, res) => {
  sendApiError(res, req, notFoundError("接口不存在", "API_NOT_FOUND"));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === "entity.too.large") {
    return sendApiError(
      res,
      req,
      new AppError(413, "REQUEST_BODY_TOO_LARGE", "请求体超过大小限制")
    );
  }
  if (error instanceof SyntaxError && error.status === 400) {
    return sendApiError(
      res,
      req,
      validationError("请求 JSON 格式非法", "INVALID_JSON_BODY")
    );
  }
  sendApiError(res, req, error);
});

let frontendProxy = null;
let frontendProxyReady = Promise.resolve();

if (isProductionRuntime) {
  const frontendIndexPath = path.join(frontendDistPath, "index.html");

  if (!fs.existsSync(frontendIndexPath)) {
    console.warn(`⚠️ 前端构建产物不存在，请先在 data-sync-fe-vue-demo 执行 npm run build: ${frontendIndexPath}`);
  }

  app.use(express.static(frontendDistPath));
  app.get("/index.html", (req, res) => {
    res.sendFile(frontendIndexPath);
  });

  // 生产环境中，刷新前端路由或直接访问页面路径时统一回落到 Vue 入口。
  app.use((req, res, next) => {
    const accept = req.headers.accept || "";
    const shouldServeFrontend = (
      (req.method === "GET" || req.method === "HEAD") &&
      accept.includes("text/html") &&
      !req.path.startsWith("/api/") &&
      req.path !== "/meta.json" &&
      req.path !== "/healthz" &&
      req.path !== "/readyz"
    );
    if (!shouldServeFrontend) return next();
    res.sendFile(frontendIndexPath);
  });
} else {
  frontendProxyReady = import("http-proxy-middleware").then(({ createProxyMiddleware }) => {
    frontendProxy = createProxyMiddleware({
      target: frontendDevServer,
      changeOrigin: true,
      ws: true,
      logLevel: "warn"
    });

    // 开发模式下不托管 dist，所有未命中的前端页面与 HMR 资源请求均代理给 Vue Vite dev server。
    app.use(frontendProxy);
  });
}

/**
 * 功能描述：完成配置和数据库初始化后再监听端口，避免未就绪实例接收流量。
 * @return {Promise<object>} 返回 Node HTTP Server
 */
async function startServer() {
  if (server) return server;
  validateRuntimeConfig();
  await frontendProxyReady;
  if (isProductionRuntime && !fs.existsSync(path.join(frontendDistPath, "index.html"))) {
    throw new Error(`FrontendBuildMissing: 前端生产构建不存在 (${frontendDistPath})`);
  }
  await initDb();
  serviceReady = true;

  server = await new Promise((resolve, reject) => {
    const nextServer = app.listen(serverPort, () => resolve(nextServer));
    nextServer.once("error", reject);
  });
  server.requestTimeout = readInteger("HTTP_REQUEST_TIMEOUT_MS", 25000, 5000, 120000);
  server.headersTimeout = readInteger("HTTP_HEADERS_TIMEOUT_MS", 10000, 1000, 60000);
  server.keepAliveTimeout = readInteger("HTTP_KEEP_ALIVE_TIMEOUT_MS", 5000, 1000, 60000);
  server.maxRequestsPerSocket = readInteger("HTTP_MAX_REQUESTS_PER_SOCKET", 1000, 1, 100000);

  if (frontendProxy) {
    server.on("upgrade", frontendProxy.upgrade);
  }

  console.log(`[Server] 飞书连接器后端已监听端口 ${serverPort}`);
  console.log("[Server] 同步并发配置:", syncConcurrencySettings);
  return server;
}

/**
 * 功能描述：停止接收新请求并关闭数据库连接池，确保发布重启时不丢失在途响应。
 * @param {string} signal 触发停机的信号名称
 * @return {Promise<void>} 无返回值
 */
async function shutdown(signal = "manual") {
  if (shuttingDown) return;
  shuttingDown = true;
  serviceReady = false;
  console.log(`[Shutdown] 收到 ${signal}，开始优雅停机`);

  const currentServer = server;
  server = null;
  if (currentServer) {
    await new Promise((resolve) => {
      const forceTimer = setTimeout(() => {
        if (typeof currentServer.closeAllConnections === "function") {
          currentServer.closeAllConnections();
        }
        resolve();
      }, readInteger("SHUTDOWN_TIMEOUT_MS", 10000, 1000, 60000));
      if (typeof forceTimer.unref === "function") forceTimer.unref();
      currentServer.close(() => {
        clearTimeout(forceTimer);
        resolve();
      });
    });
  }
  await closeDb();
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("[Startup] 服务启动失败:", buildProcessDiagnosticLog({
      message: error?.message || String(error),
      stack: error?.stack
    }));
    process.exitCode = 1;
  });

  ["SIGTERM", "SIGINT"].forEach((signal) => {
    process.once(signal, () => {
      console.warn("[Process] 收到退出信号", buildProcessDiagnosticLog({ signal }));
      shutdown(signal)
        .then(() => {
          console.warn("[Shutdown] 优雅停机完成", buildProcessDiagnosticLog({ signal }));
          process.exitCode = 0;
        })
        .catch((error) => {
          console.error("[Shutdown] 优雅停机失败:", buildProcessDiagnosticLog({
            signal,
            message: error?.message || String(error),
            stack: error?.stack
          }));
          process.exitCode = 1;
        });
    });
  });

  ["uncaughtException", "unhandledRejection"].forEach((eventName) => {
    process.on(eventName, (error) => {
      console.error(`[Process] 捕获 ${eventName}，服务继续运行`, buildProcessDiagnosticLog({
        eventName,
        message: error?.message || String(error),
        stack: error?.stack
      }));
    });
  });

  process.on("warning", (warning) => {
    console.warn("[Process] 运行时告警", buildProcessDiagnosticLog({
      name: warning?.name,
      message: warning?.message || String(warning),
      stack: warning?.stack
    }));
  });

  process.on("beforeExit", (code) => {
    console.warn("[Process] beforeExit", buildProcessDiagnosticLog({ code }));
  });

  process.on("exit", (code) => {
    console.warn("[Process] exit", buildProcessDiagnosticLog({ code }));
  });
}

/**
 * 功能描述：构造进程级诊断日志，便于排查服务退出、异常和资源状态。
 * @param {object} extra 附加信息
 * @return {object} 返回诊断信息
 */
function buildProcessDiagnosticLog(extra = {}) {
  const memory = process.memoryUsage();
  return {
    ...extra,
    pid: process.pid,
    nodeEnv: process.env.NODE_ENV || '',
    envFile: process.env.ENV_FILE || '.env',
    uptimeSec: Number(process.uptime().toFixed(3)),
    memory: {
      rssMb: bytesToMb(memory.rss),
      heapUsedMb: bytesToMb(memory.heapUsed),
      heapTotalMb: bytesToMb(memory.heapTotal),
      externalMb: bytesToMb(memory.external)
    }
  };
}

/**
 * 功能描述：将字节数转换为 MB，保留两位小数。
 * @param {number} value 字节数
 * @return {number} MB 数值
 */
function bytesToMb(value) {
  return Number((Number(value || 0) / 1024 / 1024).toFixed(2));
}

module.exports = {
  app,
  shutdown,
  startServer
};
