const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getDatabaseConfig,
  getDoudianAllowedApiOrigins,
  getManagementIdentityAuthMode,
  getManagementIdentitySecret
} = require('../runtime_config.js');

/**
 * 功能描述：临时覆盖环境变量并在测试结束后恢复，避免测试之间相互污染。
 * @param {Record<string,string|undefined>} values 临时环境变量
 * @param {Function} callback 测试回调
 * @return {Promise<unknown>} 返回回调执行结果
 */
async function withEnvironment(values, callback) {
  const previous = {};
  Object.entries(values).forEach(([key, value]) => {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  try {
    return await callback();
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

test('MySQL 空闲连接数不会超过连接池总上限', async () => {
  await withEnvironment({
    MYSQL_HOST: '127.0.0.1',
    MYSQL_USER: 'test',
    MYSQL_PASSWORD: 'test',
    MYSQL_DATABASE: 'test',
    MYSQL_CONNECTION_LIMIT: '5',
    MYSQL_MAX_IDLE_CONNECTIONS: '20'
  }, () => {
    const config = getDatabaseConfig();
    assert.equal(config.connectionLimit, 5);
    assert.equal(config.maxIdle, 5);
  });
});

test('抖店主动请求 Origin 只接受 HTTPS 并自动去重', async () => {
  await withEnvironment({
    DOUDIAN_ALLOWED_API_ORIGINS: 'https://fxg.jinritemai.com/path,https://fxg.jinritemai.com'
  }, () => {
    assert.deepEqual(getDoudianAllowedApiOrigins(), ['https://fxg.jinritemai.com']);
  });
  await withEnvironment({
    DOUDIAN_ALLOWED_API_ORIGINS: 'http://127.0.0.1'
  }, () => {
    assert.throws(() => getDoudianAllowedApiOrigins(), /InvalidEnvironmentVariable/);
  });
});

test('生产环境强制启用独立的可信网关身份密钥', async () => {
  await withEnvironment({
    NODE_ENV: 'production',
    SECRET_KEY: 'feishu-signature-secret',
    CREDENTIAL_ENCRYPTION_KEY: 'credential-encryption-key-0123456789',
    MANAGEMENT_IDENTITY_AUTH_MODE: 'none',
    MANAGEMENT_IDENTITY_SECRET: undefined
  }, () => {
    assert.throws(() => getManagementIdentityAuthMode(), /gateway_hmac/);
  });

  await withEnvironment({
    NODE_ENV: 'production',
    SECRET_KEY: 'feishu-signature-secret-012345678901',
    CREDENTIAL_ENCRYPTION_KEY: 'credential-encryption-key-0123456789',
    MANAGEMENT_IDENTITY_AUTH_MODE: 'gateway_hmac',
    MANAGEMENT_IDENTITY_SECRET: 'feishu-signature-secret-012345678901'
  }, () => {
    assert.throws(() => getManagementIdentitySecret(), /独立密钥/);
  });

  await withEnvironment({
    NODE_ENV: 'production',
    SECRET_KEY: 'feishu-signature-secret',
    CREDENTIAL_ENCRYPTION_KEY: 'credential-encryption-key-0123456789',
    MANAGEMENT_IDENTITY_AUTH_MODE: 'gateway_hmac',
    MANAGEMENT_IDENTITY_SECRET: 'management-identity-secret-0123456789'
  }, () => {
    assert.equal(
      getManagementIdentitySecret(),
      'management-identity-secret-0123456789'
    );
  });
});
