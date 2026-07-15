const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  DeadlineExceededError,
  UpstreamResponseTooLargeError,
  UpstreamTimeoutError,
  assertAllowedUrl,
  fetchTextWithTimeout,
  fetchWithTimeout,
  getRemainingTimeoutMs,
  sanitizeUrl
} = require('../http_client.js');

test('上游请求超过限制后被真实取消', async (context) => {
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    }, 200);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  await assert.rejects(
    fetchWithTimeout(`http://127.0.0.1:${address.port}/slow?token=secret`, {}, 30),
    UpstreamTimeoutError
  );
});

test('上游返回响应头后，慢速响应体仍受总超时保护', async (context) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.flushHeaders();
    setTimeout(() => res.end('{"ok":true}'), 200);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  await assert.rejects(
    fetchTextWithTimeout(`http://127.0.0.1:${address.port}/slow-body`, {}, 30),
    UpstreamTimeoutError
  );
});

test('上游响应体超过限制时提前终止读取', async (context) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('x'.repeat(2048));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  await assert.rejects(
    fetchTextWithTimeout(`http://127.0.0.1:${address.port}/large`, {}, 1000, 1024),
    UpstreamResponseTooLargeError
  );
});

test('总截止时间耗尽后不再发起新的上游请求', () => {
  assert.throws(
    () => getRemainingTimeoutMs(Date.now() - 1, 8000, 500),
    DeadlineExceededError
  );
});

test('日志 URL 会移除敏感查询参数', () => {
  assert.equal(
    sanitizeUrl('https://example.com/path?msToken=secret&a_bogus=value'),
    'https://example.com/path'
  );
});

test('主动请求拒绝未授权 Origin 和非 HTTPS 协议', () => {
  const allowedOrigins = ['https://fxg.jinritemai.com'];
  assert.equal(
    assertAllowedUrl(
      'https://fxg.jinritemai.com/api/orders?page=1',
      allowedOrigins
    ).pathname,
    '/api/orders'
  );
  assert.throws(
    () => assertAllowedUrl('http://169.254.169.254/latest/meta-data', allowedOrigins),
    /OutboundProtocolForbidden/
  );
  assert.throws(
    () => assertAllowedUrl('https://example.com/private', allowedOrigins),
    /OutboundOriginForbidden/
  );
});
