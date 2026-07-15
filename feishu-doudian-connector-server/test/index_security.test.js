const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.MYSQL_HOST = '127.0.0.1';
process.env.MYSQL_USER = 'test';
process.env.MYSQL_PASSWORD = 'test';
process.env.MYSQL_DATABASE = 'test';
process.env.FRONTEND_PUBLIC_URL = 'https://connector.example.com';
process.env.DOUDIAN_CAPTURE_ALLOWED_ORIGINS = 'https://fxg.jinritemai.com';

const {
  app,
  shutdown
} = require('../index.js');

/**
 * 功能描述：启动只用于 HTTP 中间件验证的临时服务。
 * @return {Promise<object>} 返回临时 HTTP Server
 */
function listenApp() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('Cookie 捕获接口拒绝缺失 Origin 的跨站上报', async (context) => {
  const server = await listenApp();
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await shutdown('test');
  });
  const address = server.address();
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/v1/connector/sources/login-capture`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid', cookie: 'invalid' })
    }
  );
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.errorCode, 'CAPTURE_ORIGIN_FORBIDDEN');
  assert.equal(typeof body.requestId, 'string');
});

test('允许白名单抖店 Origin 完成捕获预检', async () => {
  const server = await listenApp();
  const address = server.address();
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/connector/sources/login-capture`,
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://fxg.jinritemai.com',
          'Access-Control-Request-Method': 'POST'
        }
      }
    );

    assert.equal(response.status, 204);
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      'https://fxg.jinritemai.com'
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('允许后端捕获中转页同源提交预检', async () => {
  const server = await listenApp();
  const address = server.address();
  const sameOrigin = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(
      `${sameOrigin}/api/v1/connector/sources/login-capture`,
      {
        method: 'OPTIONS',
        headers: {
          Origin: sameOrigin,
          'Access-Control-Request-Method': 'POST'
        }
      }
    );

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), sameOrigin);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('捕获中转页启用严格 CSP 且不在 URL 中承载令牌', async () => {
  const server = await listenApp();
  const address = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/capture-relay.html`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') || '', /connect-src 'self'/);
    assert.match(body, /doudian-capture-credential/);
    assert.doesNotMatch(body, /tenantKey|userId/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
