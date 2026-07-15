const crypto = require('crypto');
const {
  getFeishuSecretKey,
  isFeishuSignatureRequired,
  readInteger
} = require('./runtime_config.js');

/**
 * 功能描述：校验飞书请求签名，使用原始请求 Body 并通过常量时间比较防止时序攻击。
 * @param {object} req Express 请求对象
 * @return {{valid: boolean, reason: string}} 返回签名校验结果和失败原因
 */
function validateRequestSignature(req) {
  const signatureRequired = isFeishuSignatureRequired();
  if (!signatureRequired) {
    return { valid: true, reason: 'signature_disabled' };
  }

  const nonce = String(req.headers['x-base-request-nonce'] || '');
  const timestamp = String(req.headers['x-base-request-timestamp'] || '');
  const signature = String(req.headers['x-base-signature'] || '').toLowerCase();

  if (!signature || !timestamp || !nonce) {
    return { valid: false, reason: 'signature_headers_missing' };
  }
  if (!/^[a-f0-9]{40}$/i.test(signature)) {
    return { valid: false, reason: 'signature_format_invalid' };
  }

  const maxAgeMs = readInteger(
    'FEISHU_SIGNATURE_MAX_AGE_MS',
    0,
    0,
    3600000
  );
  if (maxAgeMs > 0 && !isTimestampFresh(timestamp, maxAgeMs)) {
    return { valid: false, reason: 'signature_timestamp_expired' };
  }

  const secretKey = getFeishuSecretKey();
  if (!secretKey) {
    return { valid: false, reason: 'signature_secret_missing' };
  }

  const rawBody = typeof req.rawBody === 'string'
    ? req.rawBody
    : JSON.stringify(req.body || {});
  const expected = crypto
    .createHash('sha1')
    .update(`${timestamp}${nonce}${secretKey}${rawBody}`, 'utf8')
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');
  const valid = expectedBuffer.length === actualBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  return {
    valid,
    reason: valid ? 'ok' : 'signature_mismatch'
  };
}

/**
 * 功能描述：校验签名时间戳是否在允许窗口内，兼容秒和毫秒时间戳。
 * @param {string} timestamp 请求头时间戳
 * @param {number} maxAgeMs 最大允许偏差毫秒数
 * @return {boolean} 返回时间戳是否有效
 */
function isTimestampFresh(timestamp, maxAgeMs) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return false;
  const timestampMs = numeric < 100000000000 ? numeric * 1000 : numeric;
  return Math.abs(Date.now() - timestampMs) <= maxAgeMs;
}

/**
 * 功能描述：兼容旧调用方式，仅返回签名是否合法。
 * @param {object} req Express 请求对象
 * @return {boolean} 返回签名校验结果
 */
function judgeEncryptSignValid(req) {
  return validateRequestSignature(req).valid;
}

module.exports = {
  judgeEncryptSignValid,
  validateRequestSignature
};
