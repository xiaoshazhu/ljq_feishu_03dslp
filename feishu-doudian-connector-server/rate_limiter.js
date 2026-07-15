/**
 * 功能描述：创建轻量级固定窗口限流中间件，保护凭证和配置接口免受突发滥用。
 * @param {object} options 限流选项
 * @return {Function} 返回 Express 中间件
 */
function createRateLimiter(options = {}) {
  const windowMs = Math.max(1000, Number(options.windowMs) || 60000);
  const max = Math.max(1, Number(options.max) || 60);
  const maxBuckets = Math.max(100, Number(options.maxBuckets) || 10000);
  const buckets = new Map();
  let lastCleanupAt = Date.now();

  return (req, res, next) => {
    const now = Date.now();
    if (now - lastCleanupAt >= windowMs) {
      for (const [key, bucket] of buckets.entries()) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
      lastCleanupAt = now;
    }

    const key = String(
      typeof options.keyGenerator === 'function'
        ? options.keyGenerator(req)
        : req.ip || req.socket?.remoteAddress || 'unknown'
    );
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && buckets.size >= maxBuckets) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(windowMs / 1000))));
        return res.status(429).json({
          code: 429,
          errorCode: 'RATE_LIMIT_CAPACITY_REACHED',
          message: '请求来源过多，请稍后重试',
          requestId: req.requestId || '',
          retryable: true
        });
      }
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({
        code: 429,
        errorCode: 'RATE_LIMITED',
        message: options.message || '请求过于频繁，请稍后重试',
        requestId: req.requestId || '',
        retryable: true
      });
    }
    next();
  };
}

module.exports = {
  createRateLimiter
};
