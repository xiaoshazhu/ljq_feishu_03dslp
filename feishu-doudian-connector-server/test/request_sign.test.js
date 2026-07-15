const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.REQUIRE_FEISHU_SIGNATURE = 'true';
process.env.SECRET_KEY = 'test-secret-key';
process.env.FEISHU_SIGNATURE_MAX_AGE_MS = '300000';

const { validateRequestSignature } = require('../request_sign.js');

/**
 * 功能描述：构造带飞书签名请求对象。
 * @param {string} rawBody 原始请求体
 * @param {object} overrides 请求头覆盖项
 * @return {object} 返回模拟请求
 */
function createSignedRequest(rawBody, overrides = {}) {
  const timestamp = String(Date.now());
  const nonce = 'nonce-123';
  const signature = crypto
    .createHash('sha1')
    .update(`${timestamp}${nonce}${process.env.SECRET_KEY}${rawBody}`, 'utf8')
    .digest('hex');
  return {
    rawBody,
    body: JSON.parse(rawBody),
    headers: {
      'x-base-request-timestamp': timestamp,
      'x-base-request-nonce': nonce,
      'x-base-signature': signature,
      ...overrides
    }
  };
}

test('使用原始请求体校验合法飞书签名', () => {
  const request = createSignedRequest('{"params":"value"}');
  assert.deepEqual(validateRequestSignature(request), {
    valid: true,
    reason: 'ok'
  });
});

test('请求体被篡改后拒绝签名', () => {
  const request = createSignedRequest('{"params":"value"}');
  request.rawBody = '{"params":"changed"}';
  assert.equal(validateRequestSignature(request).valid, false);
  assert.equal(validateRequestSignature(request).reason, 'signature_mismatch');
});

test('生产签名模式拒绝缺失签名头', () => {
  const request = {
    rawBody: '{}',
    body: {},
    headers: {}
  };
  assert.deepEqual(validateRequestSignature(request), {
    valid: false,
    reason: 'signature_headers_missing'
  });
});

test('关闭飞书签名校验后直接放行带签名头的请求', () => {
  const request = createSignedRequest('{"params":"value"}', {
    'x-base-signature': 'invalid-signature'
  });
  process.env.REQUIRE_FEISHU_SIGNATURE = 'false';
  try {
    assert.deepEqual(validateRequestSignature(request), {
      valid: true,
      reason: 'signature_disabled'
    });
  } finally {
    process.env.REQUIRE_FEISHU_SIGNATURE = 'true';
  }
});
