const crypto = require('crypto');

/**
 * 功能描述：生成可信网关身份签名使用的规范字符串，绑定请求方法、路径、正文和身份。
 * @param {object} input 签名输入
 * @return {string} 返回规范签名字符串
 */
function buildManagementIdentityCanonicalRequest(input = {}) {
  const method = String(input.method || 'GET').toUpperCase();
  const originalUrl = String(input.originalUrl || input.url || '/');
  const timestamp = String(input.timestamp || '');
  const nonce = String(input.nonce || '');
  const companyId = normalizeSignedIdentity(input.companyId);
  const userId = normalizeSignedIdentity(input.userId);
  const rawBody = normalizeRawBody(input.rawBody);
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  return [
    timestamp,
    nonce,
    method,
    originalUrl,
    bodyHash,
    companyId,
    userId
  ].join('\n');
}

/**
 * 功能描述：为可信网关生成管理 API 身份 HMAC 签名。
 * @param {object} input 请求与身份签名输入
 * @param {string} secret 独立身份签名密钥
 * @return {string} 返回 SHA-256 HMAC 十六进制签名
 */
function signManagementIdentityRequest(input, secret) {
  return crypto
    .createHmac('sha256', String(secret || ''))
    .update(buildManagementIdentityCanonicalRequest(input), 'utf8')
    .digest('hex');
}

/**
 * 功能描述：校验管理 API 请求中的可信网关身份头，不信任普通 Body、Query 或客户端身份 Header。
 * @param {object} req Express 请求
 * @param {object} options 校验配置
 * @return {{valid:boolean,reason:string,identity?:object,timestampMs?:number,nonce?:string}} 返回校验结果
 */
function verifyManagementIdentityRequest(req, options = {}) {
  const secret = String(options.secret || '');
  const maxAgeMs = Math.max(1000, Number(options.maxAgeMs) || 30000);
  const now = Number(options.now || Date.now());
  const companyId = normalizeSignedIdentity(getRequestHeader(req, 'x-connector-company-id'));
  const userId = normalizeSignedIdentity(getRequestHeader(req, 'x-connector-user-id'));
  const timestamp = String(getRequestHeader(req, 'x-connector-identity-timestamp') || '');
  const nonce = String(getRequestHeader(req, 'x-connector-identity-nonce') || '');
  const signature = String(getRequestHeader(req, 'x-connector-identity-signature') || '').toLowerCase();

  if (!companyId || !userId || !timestamp || !nonce || !signature) {
    return { valid: false, reason: 'headers_missing' };
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    return { valid: false, reason: 'nonce_invalid' };
  }
  if (!/^[a-f0-9]{64}$/.test(signature)) {
    return { valid: false, reason: 'signature_format_invalid' };
  }

  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp) || numericTimestamp <= 0) {
    return { valid: false, reason: 'timestamp_invalid' };
  }
  const timestampMs = numericTimestamp < 100000000000
    ? numericTimestamp * 1000
    : numericTimestamp;
  if (Math.abs(now - timestampMs) > maxAgeMs) {
    return { valid: false, reason: 'timestamp_expired' };
  }
  if (!secret) {
    return { valid: false, reason: 'secret_missing' };
  }

  const expected = signManagementIdentityRequest({
    timestamp,
    nonce,
    method: req.method,
    originalUrl: req.originalUrl || req.url || req.path,
    rawBody: req.rawBodyBuffer || req.rawBody || '',
    companyId,
    userId
  }, secret);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');
  const valid = expectedBuffer.length === actualBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  if (!valid) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  return {
    valid: true,
    reason: 'ok',
    identity: { companyId, userId },
    timestampMs,
    nonce
  };
}

/**
 * 功能描述：从 Express 请求中读取不区分大小写的 Header。
 * @param {object} req Express 请求
 * @param {string} name Header 名称
 * @return {string} 返回 Header 文本
 */
function getRequestHeader(req, name) {
  if (typeof req.get === 'function') return String(req.get(name) || '');
  return String(req.headers?.[name.toLowerCase()] || '');
}

/**
 * 功能描述：校验可信网关注入的租户或用户标识，避免规范串歧义和数据库分区碰撞。
 * @param {unknown} value 原始身份值
 * @return {string} 返回合法身份；非法时返回空字符串
 */
function normalizeSignedIdentity(value) {
  const identity = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!identity || identity.length > 128) return '';
  return /^[A-Za-z0-9._:@-]+$/.test(identity) ? identity : '';
}

/**
 * 功能描述：把原始请求体转换为签名所需的字节序列。
 * @param {unknown} rawBody 原始请求体
 * @return {Buffer} 返回请求体 Buffer
 */
function normalizeRawBody(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  return Buffer.from(String(rawBody || ''), 'utf8');
}

module.exports = {
  buildManagementIdentityCanonicalRequest,
  signManagementIdentityRequest,
  verifyManagementIdentityRequest
};
