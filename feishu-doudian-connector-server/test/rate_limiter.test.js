const test = require('node:test');
const assert = require('node:assert/strict');

const { createRateLimiter } = require('../rate_limiter.js');

/**
 * 功能描述：构造最小 Express 响应替身。
 * @return {object} 返回响应替身
 */
function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test('超过固定窗口配额后返回 429', () => {
  const limiter = createRateLimiter({
    windowMs: 60000,
    max: 2,
    keyGenerator: () => 'same-client'
  });
  const req = {};
  let nextCount = 0;

  limiter(req, createResponse(), () => { nextCount += 1; });
  limiter(req, createResponse(), () => { nextCount += 1; });
  const blockedResponse = createResponse();
  limiter(req, blockedResponse, () => { nextCount += 1; });

  assert.equal(nextCount, 2);
  assert.equal(blockedResponse.statusCode, 429);
  assert.equal(blockedResponse.payload.code, 429);
});

test('来源桶达到上限后拒绝继续分配内存', () => {
  const limiter = createRateLimiter({
    windowMs: 60000,
    max: 2,
    maxBuckets: 100,
    keyGenerator: (req) => req.key
  });

  for (let index = 0; index < 100; index += 1) {
    limiter({ key: `client-${index}` }, createResponse(), () => {});
  }

  const blockedResponse = createResponse();
  limiter({ key: 'client-overflow' }, blockedResponse, () => {
    assert.fail('桶容量达到上限后不应继续执行请求');
  });

  assert.equal(blockedResponse.statusCode, 429);
  assert.equal(blockedResponse.payload.errorCode, 'RATE_LIMIT_CAPACITY_REACHED');
  assert.equal(blockedResponse.payload.retryable, true);
});
