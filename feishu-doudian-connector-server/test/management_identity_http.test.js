const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'production';
process.env.MYSQL_HOST = '127.0.0.1';
process.env.MYSQL_USER = 'test';
process.env.MYSQL_PASSWORD = 'test';
process.env.MYSQL_DATABASE = 'test';
process.env.FRONTEND_PUBLIC_URL = 'https://connector.example.com';
process.env.SECRET_KEY = 'feishu-signature-secret-test';
process.env.CREDENTIAL_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.MANAGEMENT_IDENTITY_AUTH_MODE = 'gateway_hmac';
process.env.MANAGEMENT_IDENTITY_SECRET = 'management-identity-http-test-0123456789';
process.env.MANAGEMENT_IDENTITY_MAX_AGE_MS = '30000';
process.env.DOUDIAN_ALLOWED_API_ORIGINS = 'https://fxg.jinritemai.com';
process.env.ALLOW_MOCK_DATA = 'false';

const database = require('../database.js');
const consumedNonces = new Set();
const consumedNonceExpirations = new Map();
let queriedIdentity = null;
database.consumeManagementIdentityNonce = async (nonce, expiresAt) => {
  if (consumedNonces.has(nonce)) return false;
  consumedNonces.add(nonce);
  consumedNonceExpirations.set(nonce, expiresAt);
  return true;
};
database.getAccounts = async (companyId, userId) => {
  queriedIdentity = { companyId, userId };
  return [];
};

const {
  signManagementIdentityRequest
} = require('../management_identity.js');
const {
  app,
  shutdown
} = require('../index.js');

/**
 * 功能描述：启动管理 API 身份验证使用的临时 HTTP 服务。
 * @return {Promise<object>} 返回临时 HTTP Server
 */
function listenApp() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('生产管理 API 拒绝无签名请求、信任网关身份并阻止 nonce 重放', async () => {
  const server = await listenApp();
  const address = server.address();
  const originalUrl = '/api/v1/connector/accounts?tenantKey=forged&userId=forged';
  const requestUrl = `http://127.0.0.1:${address.port}${originalUrl}`;
  const commonHeaders = {
    Origin: 'https://connector.example.com'
  };

  try {
    const unsignedResponse = await fetch(requestUrl, { headers: commonHeaders });
    const unsignedBody = await unsignedResponse.json();
    assert.equal(unsignedResponse.status, 403);
    assert.equal(unsignedBody.errorCode, 'MANAGEMENT_IDENTITY_INVALID');

    const timestamp = String(Date.now() + 10000);
    const nonce = 'nonce_http_0123456789abcdef';
    const companyId = 'trusted_company';
    const userId = 'trusted_user';
    const signature = signManagementIdentityRequest({
      timestamp,
      nonce,
      method: 'GET',
      originalUrl,
      rawBody: '',
      companyId,
      userId
    }, process.env.MANAGEMENT_IDENTITY_SECRET);
    const signedHeaders = {
      ...commonHeaders,
      'X-Connector-Company-Id': companyId,
      'X-Connector-User-Id': userId,
      'X-Connector-Identity-Timestamp': timestamp,
      'X-Connector-Identity-Nonce': nonce,
      'X-Connector-Identity-Signature': signature
    };

    const signedResponse = await fetch(requestUrl, { headers: signedHeaders });
    assert.equal(signedResponse.status, 200);
    assert.deepEqual(await signedResponse.json(), []);
    assert.deepEqual(queriedIdentity, { companyId, userId });
    assert.equal(
      consumedNonceExpirations.get(nonce).getTime(),
      Number(timestamp) + Number(process.env.MANAGEMENT_IDENTITY_MAX_AGE_MS)
    );

    const replayResponse = await fetch(requestUrl, { headers: signedHeaders });
    const replayBody = await replayResponse.json();
    assert.equal(replayResponse.status, 403);
    assert.equal(replayBody.errorCode, 'MANAGEMENT_IDENTITY_REPLAYED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await shutdown('test');
  }
});
