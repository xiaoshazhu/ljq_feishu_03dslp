const { saveError } = require('./database.js');
const crypto = require('crypto');

/**
 * 功能描述：静默归档同步异常数据，写入 MySQL 数据库中。
 * @param {string} taskId - 异常任务 ID
 * @param {string} platform - 异常关联的第三方平台名称
 * @param {string} shopName - 报错的账号或店铺名称
 * @param {string} errorType - 错误大类，如 "凭证失效(Cookie过期)"
 * @param {string} errorMessage - 报错信息明细
 * @param {string} companyId - 异常所属企业 ID
 * @return {void} 无返回值
 */
function logSyncError(taskId, platform, shopName, errorType, errorMessage, companyId = 'default') {
  const errorRecord = {
    id: `ERR_${crypto.randomUUID()}`,
    taskId: taskId || `TASK_${Date.now().toString().substring(0, 8)}`,
    companyId,
    timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    platform: platform || '抖音电商罗盘',
    shopName: shopName || '测试小店',
    errorType: errorType || '接口500报错',
    errorMessage: errorMessage || '未知同步故障',
    status: '待处理'
  };

  console.error('[Sync Error Archive]', {
    id: errorRecord.id,
    taskId: errorRecord.taskId,
    companyId: errorRecord.companyId,
    errorType: errorRecord.errorType,
    errorMessage: errorRecord.errorMessage
  });

  saveError(errorRecord).catch(e => console.error("MySQL 写入错误异常:", e));
}

module.exports = { logSyncError };
