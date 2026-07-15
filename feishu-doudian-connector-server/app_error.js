/**
 * 功能描述：表示可以安全映射为 HTTP 响应的业务异常。
 */
class AppError extends Error {
  /**
   * 功能描述：创建带状态码和稳定错误码的业务异常。
   * @param {number} statusCode HTTP 状态码
   * @param {string} errorCode 稳定错误码
   * @param {string} message 可向调用方展示的消息
   * @param {object} options 额外错误选项
   */
  constructor(statusCode, errorCode, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.expose = options.expose !== false;
    this.retryable = options.retryable === true;
  }
}

/**
 * 功能描述：创建请求参数校验异常。
 * @param {string} message 参数错误提示
 * @param {string} errorCode 稳定错误码
 * @return {AppError} 返回 400 业务异常
 */
function validationError(message, errorCode = 'VALIDATION_ERROR') {
  return new AppError(400, errorCode, message);
}

/**
 * 功能描述：创建无权限操作异常。
 * @param {string} message 权限错误提示
 * @param {string} errorCode 稳定错误码
 * @return {AppError} 返回 403 业务异常
 */
function forbiddenError(message, errorCode = 'FORBIDDEN') {
  return new AppError(403, errorCode, message);
}

/**
 * 功能描述：创建资源不存在异常。
 * @param {string} message 资源不存在提示
 * @param {string} errorCode 稳定错误码
 * @return {AppError} 返回 404 业务异常
 */
function notFoundError(message, errorCode = 'NOT_FOUND') {
  return new AppError(404, errorCode, message);
}

/**
 * 功能描述：创建资源冲突异常。
 * @param {string} message 冲突提示
 * @param {string} errorCode 稳定错误码
 * @return {AppError} 返回 409 业务异常
 */
function conflictError(message, errorCode = 'CONFLICT') {
  return new AppError(409, errorCode, message);
}

/**
 * 功能描述：创建上游服务不可用异常。
 * @param {string} message 可向用户展示的上游错误提示
 * @param {string} errorCode 稳定错误码
 * @param {object} options 额外错误选项
 * @return {AppError} 返回 502 业务异常
 */
function upstreamError(message, errorCode = 'UPSTREAM_ERROR', options = {}) {
  return new AppError(502, errorCode, message, {
    ...options,
    retryable: options.retryable !== false
  });
}

/**
 * 功能描述：判断异常是否为可安全展示的业务异常。
 * @param {unknown} error 原始异常
 * @return {boolean} 返回是否为 AppError
 */
function isAppError(error) {
  return error instanceof AppError;
}

module.exports = {
  AppError,
  conflictError,
  forbiddenError,
  isAppError,
  notFoundError,
  upstreamError,
  validationError
};
