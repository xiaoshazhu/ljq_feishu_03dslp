class UpstreamTimeoutError extends Error {
  constructor(url, timeoutMs) {
    super(`UpstreamTimeout: 上游请求在 ${timeoutMs}ms 内未完成 (${sanitizeUrl(url)})`);
    this.name = 'UpstreamTimeoutError';
    this.code = 'UPSTREAM_TIMEOUT';
    this.retryable = true;
    this.timeoutMs = timeoutMs;
  }
}

class UpstreamResponseTooLargeError extends Error {
  constructor(url, maxBytes) {
    super(`UpstreamResponseTooLarge: 上游响应超过 ${maxBytes} 字节限制 (${sanitizeUrl(url)})`);
    this.name = 'UpstreamResponseTooLargeError';
    this.code = 'UPSTREAM_RESPONSE_TOO_LARGE';
    this.retryable = false;
    this.maxBytes = maxBytes;
  }
}

class DeadlineExceededError extends Error {
  constructor() {
    super('SyncDeadlineExceeded: 同步请求剩余时间不足，已停止发起上游请求');
    this.name = 'DeadlineExceededError';
    this.code = 'SYNC_DEADLINE_EXCEEDED';
    this.retryable = true;
  }
}

/**
 * 功能描述：使用 AbortController 为原生 fetch 提供真实超时和外部取消能力。
 * @param {string|URL} url 请求地址
 * @param {object} options fetch 请求选项
 * @param {number} timeoutMs 超时时间
 * @return {Promise<Response>} 返回 fetch 响应
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  return executeFetchWithTimeout(
    url,
    options,
    timeoutMs,
    async (response) => response
  );
}

/**
 * 功能描述：在同一截止时间内完成上游请求和响应体读取，并限制响应体最大字节数。
 * @param {string|URL} url 请求地址
 * @param {object} options fetch 请求选项
 * @param {number} timeoutMs 请求和响应体读取共享的超时时间
 * @param {number} maxResponseBytes 允许读取的最大响应体字节数
 * @return {Promise<{response:Response,responseText:string}>} 返回响应对象和文本正文
 */
async function fetchTextWithTimeout(
  url,
  options = {},
  timeoutMs = 8000,
  maxResponseBytes = getDefaultMaxResponseBytes()
) {
  const safeMaxResponseBytes = normalizeMaxResponseBytes(maxResponseBytes);
  return executeFetchWithTimeout(
    url,
    options,
    timeoutMs,
    async (response) => ({
      response,
      responseText: await readResponseText(response, url, safeMaxResponseBytes)
    })
  );
}

/**
 * 功能描述：在统一 AbortController 下执行请求及可选响应消费逻辑。
 * @param {string|URL} url 请求地址
 * @param {object} options fetch 请求选项
 * @param {number} timeoutMs 总超时时间
 * @param {Function} consumeResponse 响应消费函数
 * @return {Promise<unknown>} 返回响应消费结果
 */
async function executeFetchWithTimeout(url, options, timeoutMs, consumeResponse) {
  const safeTimeoutMs = Math.max(100, Math.floor(Number(timeoutMs) || 8000));
  const controller = new AbortController();
  const externalSignal = options.signal;
  let externalAbortHandler = null;

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalAbortHandler = () => controller.abort(externalSignal.reason);
      externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
    }
  }

  const timer = setTimeout(() => {
    controller.abort(new UpstreamTimeoutError(url, safeTimeoutMs));
  }, safeTimeoutMs);
  if (typeof timer.unref === 'function') timer.unref();

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return await consumeResponse(response);
  } catch (error) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw controller.signal.reason instanceof UpstreamTimeoutError
        ? controller.signal.reason
        : new UpstreamTimeoutError(url, safeTimeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (externalSignal && externalAbortHandler) {
      externalSignal.removeEventListener('abort', externalAbortHandler);
    }
  }
}

/**
 * 功能描述：按字节流读取响应正文，在拼接到内存前拒绝异常大的上游响应。
 * @param {Response} response fetch 响应对象
 * @param {string|URL} url 请求地址
 * @param {number} maxResponseBytes 最大响应体字节数
 * @return {Promise<string>} 返回 UTF-8 文本正文
 */
async function readResponseText(response, url, maxResponseBytes) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    await response.body?.cancel().catch(() => {});
    throw new UpstreamResponseTooLargeError(url, maxResponseBytes);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) {
        await reader.cancel().catch(() => {});
        throw new UpstreamResponseTooLargeError(url, maxResponseBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

/**
 * 功能描述：根据整条请求的截止时间计算本次上游调用还能使用的时间。
 * @param {number|string|undefined} deadlineAt 绝对截止时间戳
 * @param {number} fallbackMs 未配置截止时间时的默认超时
 * @param {number} reserveMs 给后续 JSON 解析与响应预留的时间
 * @return {number} 返回本次请求可用毫秒数
 */
function getRemainingTimeoutMs(deadlineAt, fallbackMs = 8000, reserveMs = 500) {
  const deadline = Number(deadlineAt);
  if (!Number.isFinite(deadline) || deadline <= 0) return fallbackMs;
  const remainingMs = deadline - Date.now() - Math.max(0, Number(reserveMs) || 0);
  if (remainingMs <= 0) {
    throw new DeadlineExceededError();
  }
  return Math.max(100, Math.min(fallbackMs, remainingMs));
}

/**
 * 功能描述：读取上游响应体默认字节上限，避免异常配置导致内存无界增长。
 * @return {number} 返回默认最大响应体字节数
 */
function getDefaultMaxResponseBytes() {
  return normalizeMaxResponseBytes(process.env.UPSTREAM_RESPONSE_MAX_BYTES);
}

/**
 * 功能描述：把响应体上限约束在 1 KB 到 100 MB 之间。
 * @param {unknown} value 原始字节数
 * @return {number} 返回安全的响应体字节上限
 */
function normalizeMaxResponseBytes(value) {
  const fallback = 10 * 1024 * 1024;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1024, Math.min(Math.floor(parsed), 100 * 1024 * 1024));
}

/**
 * 功能描述：清洗日志中的 URL 查询参数，避免输出令牌和风控参数。
 * @param {string|URL} value 原始 URL
 * @return {string} 返回仅含协议、域名和路径的地址
 */
function sanitizeUrl(value) {
  try {
    const url = new URL(String(value));
    return `${url.origin}${url.pathname}`;
  } catch (error) {
    return String(value || '').split('?')[0];
  }
}

/**
 * 功能描述：校验主动请求 URL 的 Origin 必须命中显式白名单，防止 SSRF 访问内网或云元数据。
 * @param {string|URL} value 原始请求 URL
 * @param {Array<string>} allowedOrigins 允许访问的 Origin 白名单
 * @param {object} options 校验选项
 * @return {URL} 返回解析后的安全 URL
 */
function assertAllowedUrl(value, allowedOrigins, options = {}) {
  let url;
  try {
    url = new URL(String(value));
  } catch (error) {
    throw new Error('OutboundUrlInvalid: 上游请求地址格式非法');
  }
  const allowedProtocols = options.allowHttp === true ? new Set(['https:', 'http:']) : new Set(['https:']);
  if (!allowedProtocols.has(url.protocol)) {
    throw new Error(`OutboundProtocolForbidden: 禁止使用 ${url.protocol} 协议请求上游`);
  }
  const normalizedOrigins = new Set(
    (allowedOrigins || []).map((origin) => {
      try {
        return new URL(String(origin)).origin;
      } catch (error) {
        return '';
      }
    }).filter(Boolean)
  );
  if (!normalizedOrigins.has(url.origin)) {
    throw new Error(`OutboundOriginForbidden: 禁止请求未授权的上游 Origin (${url.origin})`);
  }
  return url;
}

module.exports = {
  DeadlineExceededError,
  UpstreamResponseTooLargeError,
  UpstreamTimeoutError,
  assertAllowedUrl,
  fetchTextWithTimeout,
  fetchWithTimeout,
  getRemainingTimeoutMs,
  sanitizeUrl
};
