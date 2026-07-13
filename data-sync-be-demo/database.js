/**
 * JSDoc 文档注释
 * @module Database
 */

const mysql = require('mysql2/promise');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || '172.20.0.31',
  port: Number(process.env.MYSQL_PORT || 9934),
  user: process.env.MYSQL_USER || 'yiknet',
  password: process.env.MYSQL_PASSWORD || 'yiknetYYW770!',
  database: process.env.MYSQL_DATABASE || 'feishu_connector_dd',
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: Number(process.env.MYSQL_QUEUE_LIMIT || 200),
  connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT_MS || 5000),
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4'
});

/**
 * 功能描述：初始化 MySQL 数据库表结构，创建 accounts、captured_buffer、tasks 以及 errors 结构表。
 * @return {Promise<void>} 返回初始化数据库的 Promise
 */
async function initDb() {
  await dropLegacyTables();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增主键' PRIMARY KEY,
      \`key\` VARCHAR(128) NOT NULL COMMENT '账号业务唯一标识',
      company_id VARCHAR(128) NOT NULL DEFAULT 'default' COMMENT '企业 ID，用于多租户数据隔离',
      user_id VARCHAR(128) NOT NULL DEFAULT 'default' COMMENT '飞书用户 ID，私有账号仅该用户可见',
      share_scope VARCHAR(32) NOT NULL DEFAULT 'private' COMMENT '共享范围，company 企业共享，private 个人私有',
      name VARCHAR(255) COMMENT '账号展示名称',
      mode VARCHAR(64) COMMENT '账号绑定模式，如模拟登录或企业共享',
      status VARCHAR(32) COMMENT '账号状态',
      cookie TEXT COMMENT '抖店登录凭证 Cookie',
      shopId VARCHAR(128) COMMENT '抖店店铺 ID',
      is_active TINYINT DEFAULT 0 COMMENT '是否为当前企业启用账号，1 是 0 否',
      is_deleted TINYINT NOT NULL DEFAULT 0 COMMENT '是否已逻辑删除，1 是 0 否',
      deleted_at TIMESTAMP NULL DEFAULT NULL COMMENT '逻辑删除时间',
      deleted_by VARCHAR(128) DEFAULT NULL COMMENT '执行逻辑删除的飞书用户 ID',
      module VARCHAR(128) COMMENT '账号关联的同步模块',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
      UNIQUE KEY uk_accounts_company_key (company_id, \`key\`),
      KEY idx_accounts_company_user (company_id, user_id),
      KEY idx_accounts_company_scope (company_id, share_scope),
      KEY idx_accounts_company_active (company_id, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='企业账号表，按 company_id 隔离不同企业账号'
  `);

  await ensureColumn('accounts', 'is_deleted', "TINYINT NOT NULL DEFAULT 0 COMMENT '是否已逻辑删除，1 是 0 否'");
  await ensureColumn('accounts', 'deleted_at', "TIMESTAMP NULL DEFAULT NULL COMMENT '逻辑删除时间'");
  await ensureColumn('accounts', 'deleted_by', "VARCHAR(128) DEFAULT NULL COMMENT '执行逻辑删除的飞书用户 ID'");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS captured_buffer (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增主键' PRIMARY KEY,
      company_id VARCHAR(128) NOT NULL COMMENT '企业 ID，用于多租户捕获缓冲隔离',
      user_id VARCHAR(128) NOT NULL DEFAULT 'default' COMMENT '飞书用户 ID，用于隔离个人捕获缓冲',
      captured TINYINT DEFAULT 0 COMMENT '是否已捕获凭证，1 是 0 否',
      cookie TEXT COMMENT '临时捕获的抖店 Cookie',
      shopId VARCHAR(128) COMMENT '捕获到的抖店店铺 ID',
      shopName VARCHAR(255) COMMENT '捕获到的店铺名称',
      module VARCHAR(128) COMMENT '捕获时识别到的同步模块',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
      UNIQUE KEY uk_captured_buffer_company_user (company_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='登录凭证捕获缓冲表，每个企业独立一份缓冲'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增主键' PRIMARY KEY,
      task_key VARCHAR(128) NOT NULL COMMENT '同步任务业务标识',
      company_id VARCHAR(128) NOT NULL DEFAULT 'default' COMMENT '企业 ID，用于多租户任务隔离',
      config JSON COMMENT '同步任务配置 JSON',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
      UNIQUE KEY uk_tasks_company_key (company_id, task_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='同步任务配置表，按 company_id 隔离企业任务'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS errors (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增主键' PRIMARY KEY,
      error_key VARCHAR(128) NOT NULL COMMENT '异常业务唯一标识',
      company_id VARCHAR(128) NOT NULL DEFAULT 'default' COMMENT '企业 ID，用于多租户异常数据隔离',
      timestamp VARCHAR(64) COMMENT '异常发生时间',
      platform VARCHAR(64) COMMENT '异常所属平台',
      shop_name VARCHAR(255) COMMENT '异常关联店铺名称',
      error_type VARCHAR(128) COMMENT '异常类型',
      error_message TEXT COMMENT '异常详细信息',
      status VARCHAR(32) COMMENT '异常处理状态',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
      UNIQUE KEY uk_errors_company_key (company_id, error_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='同步异常记录表，按 company_id 隔离企业异常'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增主键' PRIMARY KEY,
      log_key VARCHAR(128) NOT NULL COMMENT '同步执行日志唯一标识',
      company_id VARCHAR(128) NOT NULL DEFAULT 'default' COMMENT '企业 ID',
      task_id VARCHAR(128) DEFAULT NULL COMMENT '飞书同步任务 ID',
      transaction_id VARCHAR(128) DEFAULT NULL COMMENT '飞书事务 ID',
      sync_module VARCHAR(255) DEFAULT NULL COMMENT '同步模块标识',
      account_name VARCHAR(255) DEFAULT NULL COMMENT '同步账号名称',
      shop_id VARCHAR(128) DEFAULT NULL COMMENT '店铺 ID',
      page_token VARCHAR(255) DEFAULT NULL COMMENT '本次请求分页 token',
      next_page_token VARCHAR(255) DEFAULT NULL COMMENT '返回给飞书的下一页 token',
      record_count INT NOT NULL DEFAULT 0 COMMENT '本次返回记录数',
      has_more TINYINT NOT NULL DEFAULT 0 COMMENT '是否还有下一页',
      status VARCHAR(32) NOT NULL DEFAULT 'running' COMMENT '执行状态 running/success/failed',
      error_message TEXT COMMENT '失败错误信息',
      started_at DATETIME NOT NULL COMMENT '开始时间',
      finished_at DATETIME DEFAULT NULL COMMENT '结束时间',
      duration_ms INT DEFAULT NULL COMMENT '耗时毫秒',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
      UNIQUE KEY uk_sync_logs_key (company_id, log_key),
      KEY idx_sync_logs_company_status (company_id, status),
      KEY idx_sync_logs_company_started (company_id, started_at),
      KEY idx_sync_logs_task (company_id, task_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='飞书同步执行日志表'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS doudian_interfaces (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增主键' PRIMARY KEY,
      interface_key VARCHAR(128) NOT NULL COMMENT '接口业务唯一标识',
      platform VARCHAR(64) NOT NULL DEFAULT 'douyin' COMMENT '平台标识',
      module_group VARCHAR(128) NOT NULL COMMENT '接口所属业务模块',
      interface_name VARCHAR(255) NOT NULL COMMENT '接口展示名称',
      api_host VARCHAR(255) NOT NULL DEFAULT 'https://fxg.jinritemai.com' COMMENT '接口域名前缀',
      api_path VARCHAR(512) NOT NULL COMMENT '接口路径',
      local_aggregate_path VARCHAR(512) DEFAULT NULL COMMENT '本地聚合接口路径，非空时优先调用本地聚合接口',
      is_enabled TINYINT DEFAULT 0 COMMENT '是否接入同步，1 是 0 否',
      description VARCHAR(512) COMMENT '接口说明',
      request_config JSON COMMENT '接口请求、分页和响应解析配置',
      fields_schema JSON COMMENT '飞书通用字段配置',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
      UNIQUE KEY uk_doudian_interfaces_key (interface_key),
      KEY idx_doudian_interfaces_enabled (platform, is_enabled),
      KEY idx_doudian_interfaces_group (module_group)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='抖店后台接口注册表，控制哪些接口可被用户选择同步'
  `);

  await ensureColumn('doudian_interfaces', 'local_aggregate_path', "VARCHAR(512) DEFAULT NULL COMMENT '本地聚合接口路径，非空时优先调用本地聚合接口' AFTER api_path");

}



/**
 * 功能描述：当前开发库无数据时，自动清理旧版无自增主键的表，便于按新 Schema 重建。
 * @return {Promise<void>} 无返回值
 */
async function dropLegacyTables() {
  const tableChecks = [
    { table: 'accounts', requiredColumns: ['id', 'company_id', 'user_id', 'share_scope'] },
    { table: 'captured_buffer', requiredColumns: ['id', 'company_id', 'user_id'] },
    { table: 'tasks', requiredColumns: ['id', 'task_key', 'company_id'] },
    { table: 'errors', requiredColumns: ['id', 'error_key', 'company_id'] },
    { table: 'sync_logs', requiredColumns: ['id', 'log_key', 'company_id', 'status', 'started_at'] },
    { table: 'doudian_interfaces', requiredColumns: ['id', 'interface_key', 'api_host', 'api_path', 'is_enabled'] }
  ];

  for (const check of tableChecks) {
    if (await shouldDropLegacyTable(check.table, check.requiredColumns)) {
      await pool.query(`DROP TABLE \`${check.table}\``);
    }
  }
}

/**
 * 功能描述：读取当前允许用户选择同步的抖店接口目录。
 * @param {boolean} enabledOnly 是否只返回“是否接入=是”的接口
 * @return {Promise<Array>} 返回接口目录数组
 */
async function getDoudianInterfaces(enabledOnly = true, includeSchema = false) {
  const whereSql = enabledOnly ? 'WHERE platform = ? AND is_enabled = 1' : 'WHERE platform = ?';
  const schemaColumns = includeSchema
    ? `,
            request_config AS requestConfig,
            fields_schema AS fieldsSchema`
    : '';
  const [rows] = await pool.query(
    `SELECT interface_key AS interfaceKey,
            platform,
            module_group AS moduleGroup,
            interface_name AS interfaceName,
            api_host AS apiHost,
            api_path AS apiPath,
            local_aggregate_path AS localAggregatePath,
            is_enabled AS isEnabled,
            description
            ${schemaColumns}
     FROM doudian_interfaces
     ${whereSql}
     ORDER BY module_group ASC, id ASC`,
    ['douyin']
  );
  return rows.map(normalizeDoudianInterfaceRow);
}

/**
 * 功能描述：按接口主键读取单个抖店接口配置。
 * @param {string} interfaceKey 接口注册表主键
 * @return {Promise<object|null>} 返回接口配置，未命中时返回 null
 */
async function getDoudianInterfaceByKey(interfaceKey) {
  const [rows] = await pool.query(
    `SELECT interface_key AS interfaceKey,
            platform,
            module_group AS moduleGroup,
            interface_name AS interfaceName,
            api_host AS apiHost,
            api_path AS apiPath,
            local_aggregate_path AS localAggregatePath,
            is_enabled AS isEnabled,
            description,
            request_config AS requestConfig,
            fields_schema AS fieldsSchema
     FROM doudian_interfaces
     WHERE platform = ?
       AND interface_key = ?
       AND is_enabled = 1
     LIMIT 1`,
    ['douyin', interfaceKey]
  );
  return rows[0] ? normalizeDoudianInterfaceRow(rows[0]) : null;
}

/**
 * 功能描述：统一解析 MySQL JSON 字段，兼容驱动返回字符串或对象两种形式。
 * @param {object} row MySQL 查询返回的接口记录
 * @return {object} 返回前后端可直接使用的接口配置对象
 */
function normalizeDoudianInterfaceRow(row) {
  const fieldsSchema = parseJsonColumn(row.fieldsSchema, []);
  const requestConfig = parseJsonColumn(row.requestConfig, {});
  return {
    ...row,
    isEnabled: row.isEnabled === 1 || row.isEnabled === true,
    localAggregatePath: normalizeNullablePath(row.localAggregatePath),
    requestConfig: Object.keys(requestConfig || {}).length > 0 ? requestConfig : {},
    fieldsSchema: Array.isArray(fieldsSchema) ? fieldsSchema : []
  };
}

/**
 * 功能描述：统一清洗本地聚合接口路径，空字符串按不存在处理。
 * @param {unknown} value 原始路径值
 * @return {string|null} 返回有效路径或 null
 */
function normalizeNullablePath(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/**
 * 功能描述：安全解析数据库 JSON 字段。
 * @param {unknown} value 数据库字段值
 * @param {unknown} fallback 解析失败时的兜底值
 * @return {unknown} 返回解析后的 JSON 对象或兜底值
 */
function parseJsonColumn(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

/**
 * 功能描述：判断表是否缺少新 Schema 必备字段。
 * @param {string} table - 数据表名称
 * @param {Array<string>} requiredColumns - 新 Schema 必备字段
 * @return {Promise<boolean>} 是否需要删除重建
 */
async function shouldDropLegacyTable(table, requiredColumns) {
  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `,
    [table]
  );
  if (Number(rows[0].count) === 0) {
    return false;
  }

  const [columnRows] = await pool.query(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `,
    [table]
  );
  const columns = new Set(columnRows.map((row) => row.COLUMN_NAME));
  return requiredColumns.some((column) => !columns.has(column));
}

/**
 * 功能描述：为已存在的数据表补齐新增字段，避免 CREATE TABLE IF NOT EXISTS 无法升级旧表结构。
 * @param {string} table - 数据表名称
 * @param {string} column - 字段名称
 * @param {string} definition - ALTER TABLE ADD COLUMN 后的字段定义
 * @return {Promise<void>} 无返回值
 */
async function ensureColumn(table, column, definition) {
  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
    `,
    [table, column]
  );
  if (Number(rows[0].count) === 0) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

/**
 * 功能描述：保存或更新自建新账号，并在需要时将其设置为当前活跃账号。
 * @param {object} account - 账号对象
 * @return {Promise<void>} 无返回值
 */
async function saveAccount(account) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const companyId = account.companyId || 'default';
    const userId = account.userId || 'default';
    const shareScope = account.shareScope || account.share_scope || 'private';
    if (account.is_active === 1) {
      await connection.query(
        `UPDATE accounts
         SET is_active = 0
         WHERE company_id = ?
           AND (share_scope = 'company' OR user_id = ?)`,
        [companyId, userId]
      );
    }
    await connection.query(
      `INSERT INTO accounts (\`key\`, company_id, user_id, share_scope, name, mode, status, cookie, shopId, is_active, module)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         company_id = VALUES(company_id),
         user_id = IF(user_id = VALUES(user_id), VALUES(user_id), user_id),
         share_scope = IF(user_id = VALUES(user_id), VALUES(share_scope), share_scope),
         name = IF(user_id = VALUES(user_id), VALUES(name), name),
         mode = IF(user_id = VALUES(user_id), VALUES(mode), mode),
         status = IF(user_id = VALUES(user_id), VALUES(status), status),
         cookie = IF(user_id = VALUES(user_id), VALUES(cookie), cookie),
         shopId = IF(user_id = VALUES(user_id), VALUES(shopId), shopId),
         is_active = VALUES(is_active),
         module = IF(user_id = VALUES(user_id), VALUES(module), module),
         is_deleted = IF(user_id = VALUES(user_id), 0, is_deleted),
         deleted_at = IF(user_id = VALUES(user_id), NULL, deleted_at),
         deleted_by = IF(user_id = VALUES(user_id), NULL, deleted_by)`,
      [
        account.key,
        companyId,
        userId,
        shareScope,
        account.name,
        account.mode,
        account.status,
        account.cookie || '',
        account.shopId || '',
        account.is_active || 0,
        account.module || ''
      ]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 功能描述：按账号 ID 局部更新账号信息，只修改请求中明确传入的字段。
 * @param {number|string} id - 账号自增主键 ID
 * @param {object} updates - 需要更新的字段集合
 * @param {string} companyId - 企业 ID
 * @param {string} userId - 飞书用户 ID
 * @return {Promise<void>} 无返回值
 */
async function updateAccountById(id, updates, companyId = 'default', userId = 'default') {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const normalizedId = Number(id);
    if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
      throw new Error('账号 ID 非法');
    }

    const allowedFields = new Map([
      ['name', 'name'],
      ['mode', 'mode'],
      ['status', 'status'],
      ['cookie', 'cookie'],
      ['shopId', 'shopId'],
      ['module', 'module'],
      ['shareScope', 'share_scope'],
      ['is_active', 'is_active']
    ]);

    const setClauses = [];
    const params = [];

    for (const [payloadKey, columnName] of allowedFields.entries()) {
      if (!Object.prototype.hasOwnProperty.call(updates, payloadKey)) continue;
      setClauses.push(`${columnName} = ?`);
      params.push(updates[payloadKey]);
    }

    if (setClauses.length === 0) {
      await connection.rollback();
      return;
    }

    if (updates.is_active === 1) {
      await connection.query(
        `UPDATE accounts
         SET is_active = 0
         WHERE company_id = ?
           AND is_deleted = 0
           AND (share_scope = 'company' OR user_id = ?)`,
        [companyId, userId]
      );
    }

    params.push(normalizedId, companyId, userId);
    const [result] = await connection.query(
      `UPDATE accounts
       SET ${setClauses.join(', ')}
       WHERE id = ?
         AND company_id = ?
         AND is_deleted = 0
         AND (share_scope = 'company' OR user_id = ?)`,
      params
    );

    if (!result.affectedRows) {
      throw new Error('账号不存在或当前用户不可修改');
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 功能描述：获取所有已绑定的账号列表。
 * @param {string} companyId - 企业 ID
 * @param {string} userId - 飞书用户 ID
 * @return {Promise<Array>} 返回账号列表数组
 */
async function getAccounts(companyId = 'default', userId = 'default') {
  const [rows] = await pool.query(
    `SELECT *
     FROM accounts
     WHERE company_id = ?
       AND is_deleted = 0
       AND (share_scope = 'company' OR user_id = ?)
     ORDER BY updated_at DESC`,
    [companyId, userId]
  );
  return rows;
}

/**
 * 功能描述：设置当前启用的活跃账号，将指定的 key 设为活跃，其余设为非活跃。
 * @param {string} key - 启用的账号主键
 * @param {string} companyId - 企业 ID
 * @param {string} userId - 飞书用户 ID
 * @return {Promise<void>} 无返回值
 */
async function setActiveAccount(key, companyId = 'default', userId = 'default') {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `UPDATE accounts
       SET is_active = 0
       WHERE company_id = ?
         AND is_deleted = 0
         AND (share_scope = 'company' OR user_id = ?)`,
      [companyId, userId]
    );
    await connection.query(
      `UPDATE accounts
       SET is_active = 1
       WHERE \`key\` = ?
         AND company_id = ?
         AND is_deleted = 0
         AND (share_scope = 'company' OR user_id = ?)`,
      [key, companyId, userId]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 功能描述：删除某个账号。本人创建的账号做逻辑删除，非本人账号不改数据库。
 * @param {string} key - 账号主键
 * @param {string} companyId - 企业 ID
 * @param {string} userId - 飞书用户 ID
 * @return {Promise<object>} 返回删除动作类型
 */
async function deleteAccount(key, companyId = 'default', userId = 'default') {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT id, user_id, is_deleted
       FROM accounts
       WHERE \`key\` = ?
         AND company_id = ?
       LIMIT 1`,
      [key, companyId]
    );
    const account = rows[0];
    if (!account || account.is_deleted === 1) {
      await connection.commit();
      return { action: 'not_found' };
    }

    if (String(account.user_id) === String(userId)) {
      await connection.query(
        `UPDATE accounts
         SET is_deleted = 1,
             is_active = 0,
             deleted_at = CURRENT_TIMESTAMP,
             deleted_by = ?
         WHERE id = ?`,
        [userId, account.id]
      );
      await connection.commit();
      return { action: 'soft_deleted' };
    }

    await connection.commit();
    return { action: 'not_owner' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 功能描述：将书签捕获上报的凭证和识别模块暂存写入捕获数据库。
 * @param {object} buffer - 捕获对象，包含 cookie、shopId、shopName、module 等
 * @return {Promise<void>} 无返回值
 */
async function saveCapturedBuffer(buffer) {
  const companyId = buffer.companyId || 'default';
  const userId = buffer.userId || 'default';
  await pool.query(
    `INSERT INTO captured_buffer (company_id, user_id, captured, cookie, shopId, shopName, module)
     VALUES (?, ?, 1, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       captured = VALUES(captured),
       cookie = VALUES(cookie),
       shopId = VALUES(shopId),
       shopName = VALUES(shopName),
       module = VALUES(module)`,
    [companyId, userId, buffer.cookie, buffer.shopId || '', buffer.shopName || '', buffer.module || '']
  );
}

/**
 * 功能描述：查询当前数据库中是否有书签回传的捕获凭证与对应模块。
 * @param {string} companyId - 企业 ID
 * @param {string} userId - 飞书用户 ID
 * @return {Promise<object>} 返回捕获缓存对象
 */
async function getCapturedBuffer(companyId = 'default', userId = 'default') {
  const [rows] = await pool.query(
    'SELECT * FROM captured_buffer WHERE company_id = ? AND user_id = ? LIMIT 1',
    [companyId, userId]
  );
  return rows[0] || { company_id: companyId, user_id: userId, captured: 0, cookie: '', shopId: '', shopName: '', module: '' };
}

/**
 * 功能描述：清空捕获凭证缓冲区，重置状态。
 * @param {string} companyId - 企业 ID
 * @param {string} userId - 飞书用户 ID
 * @return {Promise<void>} 无返回值
 */
async function clearCapturedBuffer(companyId = 'default', userId = 'default') {
  await pool.query(
    `INSERT INTO captured_buffer (company_id, user_id, captured, cookie, shopId, shopName, module)
     VALUES (?, ?, 0, '', '', '', '')
     ON DUPLICATE KEY UPDATE
       captured = VALUES(captured),
       cookie = VALUES(cookie),
       shopId = VALUES(shopId),
       shopName = VALUES(shopName),
       module = VALUES(module)`,
    [companyId, userId]
  );
}

/**
 * 功能描述：保存同步任务配置。
 * @param {string} id - 任务主键 ID
 * @param {object} config - 配置参数对象
 * @param {string} companyId - 企业 ID
 * @return {Promise<void>} 无返回值
 */
async function saveTask(id, config, companyId = 'default') {
  await pool.query(
    `INSERT INTO tasks (task_key, company_id, config)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE config = VALUES(config)`,
    [id, companyId, JSON.stringify(config)]
  );
}

/**
 * 功能描述：更新指定账号关联的同步动作模块。
 * @param {string} key - 账号主键
 * @param {string} module - 模块标识
 * @param {string} companyId - 企业 ID
 * @return {Promise<void>} 无返回值
 */
async function updateAccountModule(key, module, companyId = 'default', userId = 'default') {
  await pool.query(
    `UPDATE accounts
     SET module = ?
     WHERE \`key\` = ?
       AND company_id = ?
       AND is_deleted = 0
       AND (share_scope = 'company' OR user_id = ?)`,
    [module, key, companyId, userId]
  );
}

/**
 * 功能描述：持久化保存同步故障异常记录。
 * @param {object} error - 异常明细对象
 * @return {Promise<void>} 无返回值
 */
async function saveError(error) {
  const companyId = error.companyId || error.tenantKey || 'default';
  await pool.query(
    `INSERT INTO errors (error_key, company_id, timestamp, platform, shop_name, error_type, error_message, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       timestamp = VALUES(timestamp),
       platform = VALUES(platform),
       shop_name = VALUES(shop_name),
       error_type = VALUES(error_type),
       error_message = VALUES(error_message),
       status = VALUES(status)`,
    [error.id, companyId, error.timestamp, error.platform, error.shopName, error.errorType, error.errorMessage, error.status]
  );
}

/**
 * 功能描述：创建一条同步执行日志，记录飞书触发的一次 records 请求开始。
 * @param {object} log 同步日志基础信息
 * @return {Promise<void>} 无返回值
 */
async function createSyncLog(log) {
  const companyId = log.companyId || 'default';
  await pool.query(
    `INSERT INTO sync_logs (
      log_key, company_id, task_id, transaction_id, sync_module, account_name, shop_id,
      page_token, status, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       task_id = VALUES(task_id),
       transaction_id = VALUES(transaction_id),
       sync_module = VALUES(sync_module),
       account_name = VALUES(account_name),
       shop_id = VALUES(shop_id),
       page_token = VALUES(page_token),
       status = IF(status = 'failed', status, VALUES(status)),
       finished_at = IF(status = 'failed', finished_at, NULL),
       error_message = IF(status = 'failed', error_message, NULL),
       updated_at = CURRENT_TIMESTAMP`,
    [
      log.logKey,
      companyId,
      log.taskId || null,
      log.transactionId || null,
      log.syncModule || null,
      log.accountName || null,
      log.shopId || null,
      log.pageToken || null,
      log.status || 'running',
      log.startedAt || new Date()
    ]
  );
}

/**
 * 功能描述：更新同步执行日志结果，补齐成功/失败状态及统计信息。
 * @param {string} logKey 同步日志唯一标识
 * @param {object} updates 需要更新的日志字段
 * @param {string} companyId 企业 ID
 * @return {Promise<void>} 无返回值
 */
async function finishSyncLog(logKey, updates = {}, companyId = 'default') {
  const setClauses = [];
  const params = [];
  if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
    setClauses.push('status = ?');
    params.push(updates.status);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'errorMessage')) {
    setClauses.push('error_message = ?');
    params.push(updates.errorMessage);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'finishedAt')) {
    setClauses.push('finished_at = ?');
    params.push(updates.finishedAt);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'recordCount')) {
    setClauses.push('record_count = ?');
    params.push(updates.recordCount);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'hasMore')) {
    setClauses.push('has_more = ?');
    params.push(updates.hasMore);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'nextPageToken')) {
    setClauses.push('next_page_token = ?');
    params.push(updates.nextPageToken);
  }
  if (updates.durationMs === 'auto' && updates.finishedAt) {
    setClauses.push('duration_ms = ROUND(TIMESTAMPDIFF(MICROSECOND, started_at, ?) / 1000)');
    params.push(updates.finishedAt);
  } else if (Object.prototype.hasOwnProperty.call(updates, 'durationMs')) {
    setClauses.push('duration_ms = ?');
    params.push(updates.durationMs);
  }

  if (setClauses.length === 0) return;

  params.push(companyId, logKey);
  await pool.query(
    `UPDATE sync_logs
     SET ${setClauses.join(', ')}
     WHERE company_id = ?
       AND log_key = ?`,
    params
  );
}

/**
 * 功能描述：读取同步执行日志，支持按状态过滤和分页。
 * @param {string} companyId 企业 ID
 * @param {object} options 查询选项
 * @return {Promise<object>} 返回同步日志列表和总数
 */
async function listSyncLogs(companyId = 'default', options = {}) {
  const filters = ['company_id = ?'];
  const params = [companyId];

  if (options.status) {
    filters.push('status = ?');
    params.push(options.status);
  }

  const pageSize = Math.min(Math.max(Number(options.pageSize || options.limit || 20), 1), 200);
  const page = Math.max(Number(options.page || 1), 1);
  const offset = (page - 1) * pageSize;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM sync_logs
     WHERE ${filters.join(' AND ')}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT id,
            log_key AS logKey,
            company_id AS companyId,
            task_id AS taskId,
            transaction_id AS transactionId,
            sync_module AS syncModule,
            account_name AS accountName,
            shop_id AS shopId,
            page_token AS pageToken,
            next_page_token AS nextPageToken,
            record_count AS recordCount,
            has_more AS hasMore,
            status,
            error_message AS errorMessage,
            started_at AS startedAt,
            finished_at AS finishedAt,
            duration_ms AS durationMs,
            updated_at AS updatedAt
     FROM sync_logs
     WHERE ${filters.join(' AND ')}
     ORDER BY started_at DESC
     LIMIT ?
     OFFSET ?`,
    [...params, pageSize, offset]
  );
  return {
    list: rows,
    total: Number(countRows[0]?.total || 0),
    page,
    pageSize
  };
}

module.exports = {
  initDb,
  saveAccount,
  updateAccountById,
  getAccounts,
  setActiveAccount,
  deleteAccount,
  saveCapturedBuffer,
  getCapturedBuffer,
  clearCapturedBuffer,
  saveTask,
  updateAccountModule,
  saveError,
  createSyncLog,
  finishSyncLog,
  listSyncLogs,
  getDoudianInterfaces,
  getDoudianInterfaceByKey
};
