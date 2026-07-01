/**
 * JSDoc 文档注释
 * @module Index
 */

require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const { createProxyMiddleware } = require("http-proxy-middleware");

const { getTableMeta } = require("./table_meta.js");
const { getTableRecords } = require("./table_records.js");
const { fetchRealDoudianData } = require("./dy_helper.js");
const { doudianLocalAggregateRouter } = require("./doudian_local_aggregate.js");
const { judgeEncryptSignValid } = require("./request_sign.js");

// 引入 MySQL 数据库操作
const {
  initDb,
  saveAccount,
  getAccounts,
  setActiveAccount,
  deleteAccount,
  saveCapturedBuffer,
  getCapturedBuffer,
  clearCapturedBuffer,
  saveTask,
  updateAccountModule,
  getDoudianInterfaces
} = require("./database.js");

const app = express();

// 初始化 MySQL 数据库
initDb().then(() => {
  console.log("✅ [MySQL 初始化就绪] 数据表连接创建完毕！");
}).catch(err => {
  console.error("❌ MySQL 初始化失败:", err);
});

// 中间件：支持 Express 解析 JSON 报文
app.use(express.json());

/**
 * 功能描述：从请求中解析企业 ID，优先使用飞书 tenantKey。
 * @param {object} req - Express 请求
 * @return {string} 返回企业 ID
 */
function getCompanyId(req) {
  return (
    req.body?.companyId ||
    req.body?.tenantKey ||
    req.query?.companyId ||
    req.query?.tenantKey ||
    req.headers['x-company-id'] ||
    req.headers['x-tenant-key'] ||
    'default'
  ).toString();
}

/**
 * 功能描述：从请求中解析飞书用户 ID，用于个人私有账号和捕获缓冲隔离。
 * @param {object} req - Express 请求
 * @return {string} 返回用户 ID
 */
function getUserId(req) {
  return (
    req.body?.userId ||
    req.body?.openId ||
    req.query?.userId ||
    req.query?.openId ||
    req.headers['x-user-id'] ||
    req.headers['x-open-id'] ||
    'default'
  ).toString();
}

// 跨域资源共享 (CORS) 拦截器：允许抖音页面上的书签提取助手跨域上报凭据
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-base-request-nonce, x-base-request-timestamp, x-base-signature, x-company-id, x-tenant-key, x-user-id, x-open-id");
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const frontendDevServer = process.env.FRONTEND_DEV_SERVER || "http://127.0.0.1:5173";

/**
 * 功能描述：检查服务状态主入口
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.get("/", (req, res) => {
  res.send("飞书连接器后端服务正在平稳运行中！");
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
        json.extraData.dataSourceConfigUiUri = `${proto}://${host}/index.html`;
        
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
  console.log("table_meta 请求数据", req.body);
  const isValid = judgeEncryptSignValid(req);
  console.log("飞书加密签名验证结果：", isValid);

  let syncModule = '';
  let tableConfig = {};
  if (req.body && req.body.params) {
    try {
      const paramsObj = JSON.parse(req.body.params);
      if (paramsObj.datasourceConfig) {
        const datasourceConfigObj = JSON.parse(paramsObj.datasourceConfig);
        if (datasourceConfigObj.value) {
          const configVal = JSON.parse(datasourceConfigObj.value);
          tableConfig = configVal;
          if (configVal.syncModule) {
            syncModule = configVal.syncModule;
          }
        }
      }
    } catch (e) {
      console.warn("解析 table_meta 中的 syncModule 失败，将交给接口注册表校验:", e.message);
    }
  }

  try {
    const tableMeta = await getTableMeta(syncModule, tableConfig);
    const result = {
      code: 0,
      msg: "",
      message: "POST请求成功",
      data: normalizeTableMetaResponse(filterTableMetaFieldsByConfig(tableMeta, tableConfig))
    };
    res.status(200).json(result);
  } catch (e) {
    res.status(200).json({ code: 1254500, msg: JSON.stringify({ zh: e.message, en: e.message }), message: e.message });
  }
});

/**
 * 功能描述：接收飞书多维表格引擎获取数据的请求
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.post("/api/records", async (req, res) => {
  console.log("table_records 请求数据", req.body);
  const isValid = judgeEncryptSignValid(req);
  console.log("飞书加密签名验证结果：", isValid);

  try {
    const records = await getTableRecords(req.body);
    const result = {
      code: 0,
      msg: "",
      message: "POST请求成功",
      data: normalizeRecordsResponse(records),
    };
    res.status(200).json(result);
  } catch (e) {
    res.status(200).json({ code: 1254500, msg: JSON.stringify({ zh: e.message, en: e.message }), message: e.message });
  }
});

/**
 * 功能描述：兼容飞书数据同步插件表结构协议的字段命名，确保 Base 能识别主键字段。
 * @param {object} tableMeta 业务层返回的表结构
 * @return {object} 返回补齐 fieldID、fieldId、isPrimary 与 is_primary 的表结构
 */
function normalizeTableMetaResponse(tableMeta) {
  const fields = Array.isArray(tableMeta?.fields) ? tableMeta.fields : [];
  let hasPrimary = fields.some((field) => field.isPrimary === true || field.is_primary === true);
  return {
    ...tableMeta,
    fields: fields.map((field, index) => {
      const fieldID = field.fieldID || field.fieldId || field.field_id;
      const isPrimary = hasPrimary
        ? (field.isPrimary === true || field.is_primary === true)
        : index === 0;
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
 * 功能描述：按前端保存的字段选择裁剪 table_meta 返回列，保证表结构和 records 写入字段一致。
 * @param {object} tableMeta 原始表结构
 * @param {object} config 前端保存的同步配置
 * @return {object} 返回裁剪后的表结构
 */
function filterTableMetaFieldsByConfig(tableMeta, config = {}) {
  const fields = Array.isArray(tableMeta?.fields) ? tableMeta.fields : [];
  const mappings = config.fieldMappings && typeof config.fieldMappings === 'object' ? config.fieldMappings : {};
  let selectedFieldIds = null;

  if (Array.isArray(config.selectedFieldKeys)) {
    selectedFieldIds = new Set(
      config.selectedFieldKeys
        .map((key) => mappings[String(key)])
        .filter((fieldId) => typeof fieldId === 'string' && fieldId.trim())
        .map((fieldId) => fieldId.trim())
    );
  } else {
    const mappedFieldIds = Object.values(mappings)
      .filter((fieldId) => typeof fieldId === 'string' && fieldId.trim())
      .map((fieldId) => fieldId.trim());
    if (mappedFieldIds.length > 0) {
      selectedFieldIds = new Set(mappedFieldIds);
    }
  }

  if (!selectedFieldIds || selectedFieldIds.size === 0) return tableMeta;

  return {
    ...tableMeta,
    fields: fields.filter((field) => selectedFieldIds.has(field.fieldId || field.fieldID || field.field_id))
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
 * 功能描述：接收由浏览器一键捕获书签回传的 Cookie 凭据、商户 ID 与被访问的模块标识
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.post("/api/v1/connector/sources/login-capture", async (req, res) => {
  const { cookie, shopId, shopName, module } = req.body;
  const companyId = getCompanyId(req);
  const userId = getUserId(req);
  if (!cookie) {
    return res.status(400).json({ code: 400, message: "Cookie 凭证为空，无法保存" });
  }

  const payload = {
    companyId,
    userId,
    cookie: cookie,
    shopId: shopId || "",
    shopName: shopName || "抖音电商罗盘店铺",
    module: module || ""
  };

  try {
    await saveCapturedBuffer(payload);
    console.log("✅ [Cookie 拦截成功] 抖音登录凭证已注入 MySQL 暂存数据库:", payload);
    res.status(200).json({ code: 0, message: "存储成功" });
  } catch (e) {
    res.status(500).json({ code: 500, message: `写入暂存数据库出错: ${e.message}` });
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
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

/**
 * 功能描述：提供当前用户可免密关联的账号列表，包含同企业共享账号与当前用户私有账号。
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.get("/api/v1/connector/shared-accounts", async (req, res) => {
  try {
    const list = await getAccounts(getCompanyId(req), getUserId(req));
    const visibleList = list.map((account) => ({
      id: account.key,
      key: account.key,
      name: account.name,
      mode: account.mode,
      status: account.status,
      cookie: account.cookie,
      shopId: account.shopId,
      module: account.module,
      shareScope: account.share_scope,
      isActive: account.is_active === 1
    }));
    res.status(200).json(visibleList);
  } catch (e) {
    res.status(500).json({ code: 500, message: `获取可关联账号列表出错: ${e.message}` });
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
    res.status(200).json(list);
  } catch (e) {
    res.status(500).json({ code: 500, message: `获取账号列表出错: ${e.message}` });
  }
});

/**
 * 功能描述：提供当前可被用户选择同步的抖店后台接口目录，接口来源于数据库 doudian_interfaces。
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.get("/api/v1/connector/doudian-interfaces", async (req, res) => {
  try {
    const list = await getDoudianInterfaces(true);
    res.status(200).json(list);
  } catch (e) {
    res.status(500).json({ code: 500, message: `获取抖店接口目录出错: ${e.message}` });
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
  const { syncModule, shopIdParam, doudianExtraQuery, doudianInterface } = req.body || {};

  if (!syncModule) {
    return res.status(400).json({ code: 400, message: "请选择需要测试的抖店同步接口" });
  }

  try {
    const accountsList = await getAccounts(companyId, userId);
    const activeAccount = accountsList.find((account) => account.is_active === 1) || accountsList[0];
    if (!activeAccount?.cookie) {
      return res.status(400).json({ code: 400, message: "请先关联并启用一个抖店网页登录账号" });
    }

    const config = {
      syncModule,
      doudianInterface: doudianInterface || null,
      shopIdParam: shopIdParam || activeAccount.shopId || "",
      doudianExtraQuery: doudianExtraQuery || {},
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
    res.status(500).json({
      code: 500,
      message: `测试连接失败: ${e.message}`
    });
  }
});

/**
 * 功能描述：向 MySQL 数据库中添加绑定自己的全新账号
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.post("/api/v1/connector/accounts/add", async (req, res) => {
  try {
    await saveAccount({ ...req.body, companyId: getCompanyId(req), userId: getUserId(req) });
    res.status(200).json({ code: 0, message: "账号已保存至数据库" });
  } catch (e) {
    res.status(500).json({ code: 500, message: `添加账号出错: ${e.message}` });
  }
});

/**
 * 功能描述：将指定账号设为活跃账号，并将其他账号设为非活跃
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.post("/api/v1/connector/accounts/active", async (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ code: 400, message: "缺乏 key 关键字段" });
  }
  try {
    await setActiveAccount(key, getCompanyId(req), getUserId(req));
    res.status(200).json({ code: 0, message: "活跃账号已更新" });
  } catch (e) {
    res.status(500).json({ code: 500, message: `更新活跃状态出错: ${e.message}` });
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
    const message = result.action === 'soft_deleted'
      ? "该账号已逻辑删除"
      : result.action === 'not_owner'
        ? "非本人创建账号不会删除"
        : "账号不存在或已被移除";
    res.status(200).json({ code: 0, message, action: result.action });
  } catch (e) {
    res.status(500).json({ code: 500, message: `移除账号出错: ${e.message}` });
  }
});

/**
 * 功能描述：保存从前端提交的任务配置，用于后端心跳保活和后续定时增量同步任务
 * @param {object} req - Express 请求
 * @param {object} res - Express 响应
 */
app.post("/api/v1/sync/tasks/save", async (req, res) => {
  console.log("保存同步任务配置", req.body);
  const { syncModule } = req.body;
  const companyId = getCompanyId(req);
  const userId = getUserId(req);

  // 1. 获取当前活跃账号并更新其绑定的模块
  try {
    const accountsList = await getAccounts(companyId, userId);
    const activeAccount = accountsList.find(a => a.is_active === 1);
    if (activeAccount && syncModule) {
      await updateAccountModule(activeAccount.key, syncModule, companyId, userId);
      console.log(`✅ 已同步更新当前活跃账号 [${activeAccount.name}] 对应的模块为: ${syncModule}`);
    }
  } catch (e) {
    console.error("更新活跃账号模块出错:", e);
  }

  // 2. 保存到 MySQL tasks 中
  try {
    await saveTask('bitable_task', req.body, companyId);
  } catch (e) {
    console.error("写入 MySQL 任务配置出错:", e);
  }

  // 3. 依然保留一份任务文件 (兼容性支持)
  const taskDir = path.join(__dirname, 'data');
  if (!fs.existsSync(taskDir)) {
    fs.mkdirSync(taskDir, { recursive: true });
  }
  try {
    fs.writeFileSync(
      path.join(taskDir, 'tasks.json'),
      JSON.stringify(req.body, null, 2),
      'utf8'
    );
    res.status(200).json({ code: 0, message: "同步任务配置在后台存储成功" });
  } catch (e) {
    res.status(500).json({ code: 500, message: `保存任务配置出错: ${e.message}` });
  }
});

app.use(doudianLocalAggregateRouter);

const frontendProxy = createProxyMiddleware({
  target: frontendDevServer,
  changeOrigin: true,
  ws: true,
  logLevel: "warn"
});

// 开发模式下不再托管 dist，所有未命中的前端页面与 HMR 资源请求均代理给 Vue Vite dev server。
app.use(frontendProxy);

// 监听 3000 端口
const server = app.listen(3000, () => {
  console.log("🚀 Express 飞书连接器后端服务器在端口 3000 上启动运行！");
  console.log(`🧩 Vue 开发服务器代理目标: ${frontendDevServer}`);
});

server.on("upgrade", frontendProxy.upgrade);
