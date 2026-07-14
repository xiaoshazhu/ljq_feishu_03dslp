const { saveError } = require('./database.js');

/**
 * 功能描述：静默归档同步异常数据，写入 MySQL 数据库中。
 * @param {string} taskId - 异常任务 ID
 * @param {string} platform - 异常关联的第三方平台名称
 * @param {string} shopName - 报错的账号或店铺名称
 * @param {string} errorType - 错误大类，如 "凭证失效(Cookie过期)"
 * @param {string} errorMessage - 报错信息明细
 * @return {void} 无返回值
 */
function logSyncError(taskId, platform, shopName, errorType, errorMessage) {
  const errorRecord = {
    id: `ERR_${Date.now()}`,
    taskId: taskId || `TASK_${Date.now().toString().substring(0, 8)}`,
    timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    platform: platform || '抖音电商罗盘',
    shopName: shopName || '测试小店',
    errorType: errorType || '接口500报错',
    errorMessage: errorMessage || '未知同步故障',
    status: '待处理'
  };

  console.error(`[🚨 异常告警写入特定监控多维表格]`, errorRecord);

  saveError(errorRecord).catch(e => console.error("MySQL 写入错误异常:", e));
}

module.exports = { logSyncError };
