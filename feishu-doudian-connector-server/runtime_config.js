const path = require('path');

const envFile = String(process.env.ENV_FILE || '.env').trim();
require('dotenv').config({
  path: path.isAbsolute(envFile) ? envFile : path.join(__dirname, envFile),
  quiet: true
});

/**
 * 功能描述：读取布尔型环境变量，兼容常见的 true/false 表达方式。
 * @param {string} name 环境变量名称
 * @param {boolean} fallback 未配置时的默认值
 * @return {boolean} 返回解析后的布尔值
 */
function readBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

/**
 * 功能描述：读取正整数环境变量，并限制在业务允许范围内。
 * @param {string} name 环境变量名称
 * @param {number} fallback 未配置时的默认值
 * @param {number} min 最小值
 * @param {number} max 最大值
 * @return {number} 返回安全的整数
 */
function readInteger(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/**
 * 功能描述：读取必填环境变量，缺失时抛出可定位的启动错误。
 * @param {string} name 环境变量名称
 * @return {string} 返回去除首尾空格后的配置值
 */
function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`MissingEnvironmentVariable: 缺少必填环境变量 ${name}`);
  }
  return value;
}

/**
 * 功能描述：生成 MySQL 连接池配置，禁止在源码中回退到真实账号密码。
 * @return {object} 返回 mysql2 createPool 配置
 */
function getDatabaseConfig() {
  const connectionLimit = readInteger('MYSQL_CONNECTION_LIMIT', 20, 1, 500);
  return {
    host: requireEnv('MYSQL_HOST'),
    port: readInteger('MYSQL_PORT', 3306, 1, 65535),
    user: requireEnv('MYSQL_USER'),
    password: requireEnv('MYSQL_PASSWORD'),
    database: requireEnv('MYSQL_DATABASE'),
    waitForConnections: true,
    connectionLimit,
    queueLimit: readInteger('MYSQL_QUEUE_LIMIT', 500, 0, 100000),
    connectTimeout: readInteger('MYSQL_CONNECT_TIMEOUT_MS', 5000, 500, 60000),
    maxIdle: Math.min(
      connectionLimit,
      readInteger('MYSQL_MAX_IDLE_CONNECTIONS', connectionLimit, 1, 500)
    ),
    idleTimeout: readInteger('MYSQL_IDLE_TIMEOUT_MS', 60000, 1000, 3600000),
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    charset: 'utf8mb4'
  };
}

/**
 * 功能描述：判断当前是否为生产运行环境。
 * @return {boolean} 返回是否为 production
 */
function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * 功能描述：判断飞书回调是否必须携带有效签名，生产环境默认强制。
 * @return {boolean} 返回是否强制签名
 */
function isFeishuSignatureRequired() {
  return readBoolean('REQUIRE_FEISHU_SIGNATURE', isProduction());
}

/**
 * 功能描述：读取飞书请求签名密钥；强制验签时不允许使用内置默认值。
 * @return {string} 返回签名密钥，非强制模式下可为空
 */
function getFeishuSecretKey() {
  if (isFeishuSignatureRequired()) {
    return requireEnv('SECRET_KEY');
  }
  return String(process.env.SECRET_KEY || '').trim();
}

/**
 * 功能描述：读取管理 API 身份认证模式，生产环境只允许可信网关 HMAC。
 * @return {'none'|'gateway_hmac'} 返回身份认证模式
 */
function getManagementIdentityAuthMode() {
  const fallback = isProduction() ? 'gateway_hmac' : 'none';
  const mode = String(process.env.MANAGEMENT_IDENTITY_AUTH_MODE || fallback)
    .trim()
    .toLowerCase();
  if (!['none', 'gateway_hmac'].includes(mode)) {
    throw new Error('InvalidEnvironmentVariable: MANAGEMENT_IDENTITY_AUTH_MODE 仅支持 none 或 gateway_hmac');
  }
  if (isProduction() && mode !== 'gateway_hmac') {
    throw new Error('InvalidEnvironmentVariable: 生产环境必须启用 MANAGEMENT_IDENTITY_AUTH_MODE=gateway_hmac');
  }
  return mode;
}

/**
 * 功能描述：读取可信身份网关 HMAC 密钥，并禁止与其他业务密钥复用。
 * @return {string} 返回身份签名密钥；关闭认证时返回空字符串
 */
function getManagementIdentitySecret() {
  if (getManagementIdentityAuthMode() !== 'gateway_hmac') return '';
  const secret = requireEnv('MANAGEMENT_IDENTITY_SECRET');
  if (secret.length < 32) {
    throw new Error('InvalidEnvironmentVariable: MANAGEMENT_IDENTITY_SECRET 至少需要 32 个字符');
  }
  const reusedSecrets = [
    process.env.SECRET_KEY,
    process.env.CREDENTIAL_ENCRYPTION_KEY
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (reusedSecrets.includes(secret)) {
    throw new Error('InvalidEnvironmentVariable: MANAGEMENT_IDENTITY_SECRET 必须使用独立密钥');
  }
  return secret;
}

/**
 * 功能描述：读取可信身份签名允许的最大时间偏差。
 * @return {number} 返回毫秒时间窗
 */
function getManagementIdentityMaxAgeMs() {
  return readInteger('MANAGEMENT_IDENTITY_MAX_AGE_MS', 30000, 1000, 300000);
}

/**
 * 功能描述：读取本地聚合服务地址，默认仅通过本机回环地址调用。
 * @return {string} 返回不带尾部斜杠的服务地址
 */
function getLocalAggregateBaseUrl() {
  const port = readInteger('PORT', 3000, 1, 65535);
  return String(process.env.LOCAL_AGGREGATE_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, '');
}

/**
 * 功能描述：读取前端公开地址的 Origin，供同源写请求校验和 CORS 白名单复用。
 * @return {string} 返回协议、域名和端口组成的 Origin
 */
function getFrontendPublicOrigin() {
  const rawUrl = String(process.env.FRONTEND_PUBLIC_URL || '').trim();
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl).origin;
  } catch (error) {
    throw new Error('InvalidEnvironmentVariable: FRONTEND_PUBLIC_URL 必须是完整 URL');
  }
}

/**
 * 功能描述：读取允许后端主动请求的抖店 API Origin 白名单，阻止数据库误配置引发 SSRF。
 * @return {Array<string>} 返回规范化后的 HTTPS Origin 数组
 */
function getDoudianAllowedApiOrigins() {
  const rawOrigins = String(
    process.env.DOUDIAN_ALLOWED_API_ORIGINS
    || 'https://fxg.jinritemai.com,https://compass.jinritemai.com'
  )
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const origins = rawOrigins.map((item) => {
    try {
      const url = new URL(item);
      if (url.protocol !== 'https:') {
        throw new Error('仅允许 HTTPS');
      }
      return url.origin;
    } catch (error) {
      throw new Error(`InvalidEnvironmentVariable: DOUDIAN_ALLOWED_API_ORIGINS 包含非法地址 ${item}`);
    }
  });
  if (origins.length === 0) {
    throw new Error('InvalidEnvironmentVariable: DOUDIAN_ALLOWED_API_ORIGINS 不能为空');
  }
  return [...new Set(origins)];
}

/**
 * 功能描述：读取是否允许开发环境显式使用 Mock 数据。
 * @return {boolean} 返回是否允许 Mock 数据
 */
function isMockDataAllowed() {
  return readBoolean('ALLOW_MOCK_DATA', false);
}

/**
 * 功能描述：校验生产环境凭证加密密钥具有足够长度，避免弱口令被静默派生为密钥。
 * @return {void} 无返回值
 */
function validateCredentialEncryptionKey() {
  const rawKey = String(process.env.CREDENTIAL_ENCRYPTION_KEY || '').trim();
  if (!rawKey) {
    throw new Error('MissingEnvironmentVariable: 生产环境必须配置 CREDENTIAL_ENCRYPTION_KEY');
  }
  const isHexKey = /^[a-f0-9]{64}$/i.test(rawKey);
  let isBase64Key = false;
  try {
    const decoded = Buffer.from(rawKey, 'base64');
    isBase64Key = decoded.length === 32
      && decoded.toString('base64').replace(/=+$/, '') === rawKey.replace(/=+$/, '');
  } catch (error) {
    isBase64Key = false;
  }
  if (!isHexKey && !isBase64Key && rawKey.length < 32) {
    throw new Error('InvalidEnvironmentVariable: CREDENTIAL_ENCRYPTION_KEY 至少需要 32 个字符');
  }
}

/**
 * 功能描述：在服务启动前检查生产环境关键安全配置。
 * @return {void} 无返回值
 */
function validateRuntimeConfig() {
  getDatabaseConfig();
  getDoudianAllowedApiOrigins();
  getFeishuSecretKey();
  getManagementIdentityAuthMode();
  getManagementIdentitySecret();
  if (isProduction()) {
    validateCredentialEncryptionKey();
    const publicOrigin = getFrontendPublicOrigin();
    if (!publicOrigin.startsWith('https://')) {
      throw new Error('InvalidEnvironmentVariable: 生产环境 FRONTEND_PUBLIC_URL 必须使用 HTTPS');
    }
    if (isMockDataAllowed()) {
      throw new Error('InvalidEnvironmentVariable: 生产环境禁止启用 ALLOW_MOCK_DATA');
    }
    const aggregateUrl = new URL(getLocalAggregateBaseUrl());
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
    if (
      !loopbackHosts.has(aggregateUrl.hostname)
      && !readBoolean('ALLOW_REMOTE_LOCAL_AGGREGATE', false)
    ) {
      throw new Error(
        'InvalidEnvironmentVariable: LOCAL_AGGREGATE_BASE_URL 默认只允许本机回环地址；'
        + '如确需独立内网服务，请显式配置 ALLOW_REMOTE_LOCAL_AGGREGATE=true'
      );
    }
  }
}

module.exports = {
  getDatabaseConfig,
  getDoudianAllowedApiOrigins,
  getFeishuSecretKey,
  getFrontendPublicOrigin,
  getLocalAggregateBaseUrl,
  getManagementIdentityAuthMode,
  getManagementIdentityMaxAgeMs,
  getManagementIdentitySecret,
  isFeishuSignatureRequired,
  isMockDataAllowed,
  isProduction,
  readBoolean,
  readInteger,
  requireEnv,
  validateRuntimeConfig
};
