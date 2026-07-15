const test = require('node:test');
const assert = require('node:assert/strict');

const {
  signManagementIdentityRequest,
  verifyManagementIdentityRequest
} = require('../management_identity.js');

const secret = 'management-identity-test-secret-0123456789';
const timestamp = '1784033000000';
const nonce = 'nonce_0123456789abcdef';
const companyId = 'tenant_company_1';
const userId = 'user_1';
const originalUrl = '/api/v1/connector/accounts?tenantKey=forged';
const rawBody = Buffer.from('{"name":"测试账号"}', 'utf8');

/**
 * 功能描述：构造带可信身份 Header 的模拟 Express 请求。
 * @param {object} overrides 需要覆盖的请求字段
 * @return {object} 返回模拟请求
 */
function buildSignedRequest(overrides = {}) {
  const request = {
    method: overrides.method || 'POST',
    originalUrl: overrides.originalUrl || originalUrl,
    rawBodyBuffer: overrides.rawBody || rawBody,
    headers: {}
  };
  const signedTimestamp = overrides.timestamp || timestamp;
  const signedNonce = overrides.nonce || nonce;
  const signedCompanyId = overrides.companyId || companyId;
  const signedUserId = overrides.userId || userId;
  const signature = signManagementIdentityRequest({
    timestamp: signedTimestamp,
    nonce: signedNonce,
    method: request.method,
    originalUrl: request.originalUrl,
    rawBody: request.rawBodyBuffer,
    companyId: signedCompanyId,
    userId: signedUserId
  }, secret);
  request.headers = {
    'x-connector-company-id': signedCompanyId,
    'x-connector-user-id': signedUserId,
    'x-connector-identity-timestamp': signedTimestamp,
    'x-connector-identity-nonce': signedNonce,
    'x-connector-identity-signature': signature
  };
  return request;
}

test('可信网关签名绑定方法、路径、正文和身份', () => {
  const req = buildSignedRequest();
  const result = verifyManagementIdentityRequest(req, {
    secret,
    maxAgeMs: 30000,
    now: Number(timestamp)
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.identity, { companyId, userId });
});

test('请求正文或路径被篡改后身份签名失效', () => {
  const bodyTampered = buildSignedRequest();
  bodyTampered.rawBodyBuffer = Buffer.from('{"name":"被篡改"}', 'utf8');
  assert.equal(
    verifyManagementIdentityRequest(bodyTampered, {
      secret,
      maxAgeMs: 30000,
      now: Number(timestamp)
    }).reason,
    'signature_mismatch'
  );

  const pathTampered = buildSignedRequest();
  pathTampered.originalUrl = '/api/v1/connector/accounts?tenantKey=other';
  assert.equal(
    verifyManagementIdentityRequest(pathTampered, {
      secret,
      maxAgeMs: 30000,
      now: Number(timestamp)
    }).reason,
    'signature_mismatch'
  );
});

test('过期身份签名被拒绝', () => {
  const req = buildSignedRequest();
  const result = verifyManagementIdentityRequest(req, {
    secret,
    maxAgeMs: 30000,
    now: Number(timestamp) + 30001
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'timestamp_expired');
});
