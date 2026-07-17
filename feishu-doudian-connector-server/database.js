/**
 * JSDoc 文档注释
 * @module Database
 */

const mysql = require('mysql2/promise');
const crypto = require('crypto');
const {
  conflictError,
  forbiddenError,
  notFoundError,
  validationError
} = require('./app_error.js');
const {
  getDatabaseConfig,
  readInteger
} = require('./runtime_config.js');
const {
  ENCRYPTED_PREFIX,
  decryptCredential,
  encryptCredential,
  isCredentialEncryptionEnabled
} = require('./credential_cipher.js');

const pool = mysql.createPool(getDatabaseConfig());
let lastManagementIdentityNonceCleanupAt = 0;

/**
 * 功能描述：初始化 MySQL 数据库表结构，创建 accounts、captured_buffer、tasks 以及 errors 结构表。
 * @return {Promise<void>} 返回初始化数据库的 Promise
 */
async function initDb() {
  const migrationConnection = await pool.getConnection();
  const databaseName = getDatabaseConfig().database;
  const lockName = `connector_schema_${crypto
    .createHash('sha256')
    .update(databaseName, 'utf8')
    .digest('hex')
    .slice(0, 32)}`;
  const lockTimeoutSeconds = Math.ceil(
    readInteger('MYSQL_MIGRATION_LOCK_TIMEOUT_MS', 30000, 1000, 300000) / 1000
  );
  let lockAcquired = false;

  try {
    const [lockRows] = await migrationConnection.query(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [lockName, lockTimeoutSeconds]
    );
    lockAcquired = Number(lockRows[0]?.acquired) === 1;
    if (!lockAcquired) {
      throw conflictError(
        '数据库结构正在由其他实例升级，请稍后重试启动',
        'DATABASE_MIGRATION_LOCK_TIMEOUT'
      );
    }

    await assertCompatibleDatabaseSchema();

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
      cookie MEDIUMTEXT COMMENT 'AES-GCM 加密后的抖店登录凭证 Cookie',
      shopId VARCHAR(128) COMMENT '抖店店铺 ID',
      is_active TINYINT DEFAULT 0 COMMENT '是否为当前企业启用账号，1 是 0 否',
      is_deleted TINYINT NOT NULL DEFAULT 0 COMMENT '是否已逻辑删除，1 是 0 否',
      deleted_at TIMESTAMP NULL DEFAULT NULL COMMENT '逻辑删除时间',
      deleted_by VARCHAR(128) DEFAULT NULL COMMENT '执行逻辑删除的飞书用户 ID',
      module VARCHAR(255) COMMENT '账号关联的同步模块',
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
    await ensureMediumTextColumn('accounts', 'cookie');
    await ensureVarchar255Column('accounts', 'module', "COMMENT '账号关联的同步模块'");

    await pool.query(`
    CREATE TABLE IF NOT EXISTS captured_buffer (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增主键' PRIMARY KEY,
      company_id VARCHAR(128) NOT NULL COMMENT '企业 ID，用于多租户捕获缓冲隔离',
      user_id VARCHAR(128) NOT NULL DEFAULT 'default' COMMENT '飞书用户 ID，用于隔离个人捕获缓冲',
      captured TINYINT DEFAULT 0 COMMENT '是否已捕获凭证，1 是 0 否',
      cookie MEDIUMTEXT COMMENT 'AES-GCM 加密后的临时抖店 Cookie',
      shopId VARCHAR(128) COMMENT '捕获到的抖店店铺 ID',
      shopName VARCHAR(255) COMMENT '捕获到的店铺名称',
      module VARCHAR(255) COMMENT '捕获时识别到的同步模块',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
      UNIQUE KEY uk_captured_buffer_company_user (company_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='登录凭证捕获缓冲表，每个企业独立一份缓冲'
  `);
    await ensureMediumTextColumn('captured_buffer', 'cookie');
    await ensureVarchar255Column('captured_buffer', 'module', "COMMENT '捕获时识别到的同步模块'");

    await pool.query(`
    CREATE TABLE IF NOT EXISTS account_selections (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增主键' PRIMARY KEY,
      company_id VARCHAR(128) NOT NULL COMMENT '企业 ID',
      user_id VARCHAR(128) NOT NULL COMMENT '飞书用户 ID',
      account_key VARCHAR(128) NOT NULL COMMENT '当前用户选中的账号 key',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
      UNIQUE KEY uk_account_selections_company_user (company_id, user_id),
      KEY idx_account_selections_account (company_id, account_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户级活跃账号选择表，避免共享账号状态相互覆盖'
  `);

    await pool.query(`
    CREATE TABLE IF NOT EXISTS capture_sessions (
      token_hash CHAR(64) NOT NULL COMMENT '捕获令牌 SHA-256' PRIMARY KEY,
      company_id VARCHAR(128) NOT NULL COMMENT '企业 ID',
      user_id VARCHAR(128) NOT NULL COMMENT '飞书用户 ID',
      module VARCHAR(255) DEFAULT NULL COMMENT '创建令牌时选择的同步模块',
      expires_at DATETIME(3) NOT NULL COMMENT '令牌过期时间',
      consumed_at DATETIME(3) DEFAULT NULL COMMENT '令牌消费时间',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
      KEY idx_capture_sessions_expiry (expires_at),
      KEY idx_capture_sessions_identity (company_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='书签 Cookie 捕获短效一次性会话'
  `);
    await ensureVarchar255Column('capture_sessions', 'module', "DEFAULT NULL COMMENT '创建令牌时选择的同步模块'");

    await pool.query(`
    CREATE TABLE IF NOT EXISTS management_identity_nonces (
      nonce_hash CHAR(64) NOT NULL COMMENT '可信网关请求 nonce 的 SHA-256' PRIMARY KEY,
      expires_at DATETIME(3) NOT NULL COMMENT '防重放记录过期时间',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '首次使用时间',
      KEY idx_management_identity_nonces_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理 API 可信身份签名防重放记录'
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

    await migrateLegacyActiveSelections();
    await migrateStoredCredentials();
  } finally {
    if (lockAcquired) {
      await migrationConnection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch((error) => {
        console.error('[Database Migration] 释放结构迁移锁失败', { message: error.message });
      });
    }
    migrationConnection.release();
  }
}

/**
 * 功能描述：把同步模块字段升级为 VARCHAR(255)，避免接口 key 加前缀后被截断。
 * @param {string} table 表名
 * @param {string} column 字段名
 * @param {string} suffix 字段注释等后缀定义
 * @return {Promise<void>} 无返回值
 */
async function ensureVarchar255Column(table, column, suffix = '') {
  const allowedTargets = new Set([
    'accounts.module',
    'captured_buffer.module',
    'capture_sessions.module'
  ]);
  if (!allowedTargets.has(`${table}.${column}`)) {
    throw new Error('VarcharMigrationTargetInvalid: 非法 VARCHAR 迁移字段');
  }
  const [rows] = await pool.query(
    `SELECT CHARACTER_MAXIMUM_LENGTH AS maxLength
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  if (!rows[0]) {
    await pool.query(
      `ALTER TABLE \`${table}\`
       ADD COLUMN \`${column}\` VARCHAR(255) ${suffix}`
    );
    return;
  }
  if (Number(rows[0]?.maxLength || 0) < 255) {
    await pool.query(
      `ALTER TABLE \`${table}\`
       MODIFY COLUMN \`${column}\` VARCHAR(255) ${suffix}`
    );
  }
}



/**
 * 功能描述：检查已存在的核心表是否属于当前可安全升级的 MySQL Schema，禁止启动时自动删表。
 * @return {Promise<void>} 无返回值
 */
async function assertCompatibleDatabaseSchema() {
  const tableChecks = [
    { table: 'accounts', requiredColumns: ['id', 'company_id', 'user_id', 'share_scope'] },
    { table: 'captured_buffer', requiredColumns: ['id', 'company_id', 'user_id'] },
    { table: 'tasks', requiredColumns: ['id', 'task_key', 'company_id'] },
    { table: 'errors', requiredColumns: ['id', 'error_key', 'company_id'] },
    { table: 'sync_logs', requiredColumns: ['id', 'log_key', 'company_id', 'status', 'started_at'] },
    { table: 'doudian_interfaces', requiredColumns: ['id', 'interface_key', 'api_host', 'api_path', 'is_enabled'] }
  ];

  for (const check of tableChecks) {
    const missingColumns = await getMissingColumns(check.table, check.requiredColumns);
    if (missingColumns.length > 0) {
      throw new Error(
        `DatabaseSchemaOutdated: 表 ${check.table} 缺少字段 ${missingColumns.join(', ')}，`
        + '为保护生产数据，服务不会自动删表；请先备份并执行兼容迁移'
      );
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
 * 功能描述：读取已存在表缺少的必备字段；表不存在时返回空数组，由后续 CREATE TABLE 创建。
 * @param {string} table - 数据表名称
 * @param {Array<string>} requiredColumns - 新 Schema 必备字段
 * @return {Promise<Array<string>>} 返回缺失字段列表
 */
async function getMissingColumns(table, requiredColumns) {
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
    return [];
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
  return requiredColumns.filter((column) => !columns.has(column));
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
 * 功能描述：把敏感凭证列升级为 MEDIUMTEXT，避免 AES-GCM 密文膨胀后超过 TEXT 上限。
 * @param {string} table 表名
 * @param {string} column 字段名
 * @return {Promise<void>} 无返回值
 */
async function ensureMediumTextColumn(table, column) {
  const definitions = new Map([
    [
      'accounts.cookie',
      "MEDIUMTEXT COMMENT 'AES-GCM 加密后的抖店登录凭证 Cookie'"
    ],
    [
      'captured_buffer.cookie',
      "MEDIUMTEXT COMMENT 'AES-GCM 加密后的临时抖店 Cookie'"
    ]
  ]);
  const definition = definitions.get(`${table}.${column}`);
  if (!definition) {
    throw new Error('CredentialColumnTargetInvalid: 非法凭证字段');
  }
  const [rows] = await pool.query(
    `SELECT DATA_TYPE AS dataType
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  if (!rows[0]) {
    await pool.query(
      `ALTER TABLE \`${table}\`
       ADD COLUMN \`${column}\` ${definition}`
    );
    return;
  }
  if (String(rows[0]?.dataType || '').toLowerCase() !== 'mediumtext') {
    await pool.query(
      `ALTER TABLE \`${table}\`
       MODIFY COLUMN \`${column}\` ${definition}`
    );
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
    const normalizedAccount = normalizeAccountPayload(account);
    const companyId = normalizeIdentity(account.companyId);
    const userId = normalizeIdentity(account.userId);
    const [existingRows] = await connection.query(
      `SELECT id, user_id
       FROM accounts
       WHERE company_id = ?
         AND \`key\` = ?
       LIMIT 1
       FOR UPDATE`,
      [companyId, normalizedAccount.key]
    );
    const existing = existingRows[0];
    if (existing && String(existing.user_id) !== userId) {
      throw conflictError('该账号 key 已被企业内其他用户占用', 'ACCOUNT_KEY_CONFLICT');
    }

    if (existing) {
      await connection.query(
        `UPDATE accounts
         SET share_scope = ?,
             name = ?,
             mode = ?,
             status = ?,
             cookie = ?,
             shopId = ?,
             module = ?,
             is_deleted = 0,
             deleted_at = NULL,
             deleted_by = NULL
         WHERE id = ?`,
        [
          normalizedAccount.shareScope,
          normalizedAccount.name,
          normalizedAccount.mode,
          normalizedAccount.status,
          encryptCredential(normalizedAccount.cookie),
          normalizedAccount.shopId,
          normalizedAccount.module,
          existing.id
        ]
      );
    } else {
      await connection.query(
        `INSERT INTO accounts (
          \`key\`, company_id, user_id, share_scope, name, mode, status, cookie, shopId, is_active, module
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          normalizedAccount.key,
          companyId,
          userId,
          normalizedAccount.shareScope,
          normalizedAccount.name,
          normalizedAccount.mode,
          normalizedAccount.status,
          encryptCredential(normalizedAccount.cookie),
          normalizedAccount.shopId,
          normalizedAccount.module
        ]
      );
    }

    await cleanupHiddenAccountSelections(
      connection,
      companyId,
      normalizedAccount.key,
      userId,
      normalizedAccount.shareScope
    );
    if (normalizedAccount.isActive === 1) {
      await upsertAccountSelection(connection, companyId, userId, normalizedAccount.key);
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
      throw validationError('账号 ID 非法', 'ACCOUNT_ID_INVALID');
    }

    const normalizedCompanyId = normalizeIdentity(companyId);
    const normalizedUserId = normalizeIdentity(userId);
    const [accountRows] = await connection.query(
      `SELECT id, \`key\`, user_id
       FROM accounts
       WHERE id = ?
         AND company_id = ?
         AND is_deleted = 0
       LIMIT 1
       FOR UPDATE`,
      [normalizedId, normalizedCompanyId]
    );
    const account = accountRows[0];
    if (!account) {
      throw notFoundError('账号不存在或已被删除', 'ACCOUNT_NOT_FOUND');
    }
    if (String(account.user_id) !== normalizedUserId) {
      throw forbiddenError('共享账号仅创建人可以修改', 'ACCOUNT_OWNER_REQUIRED');
    }

    const allowedFields = new Map([
      ['name', 'name'],
      ['mode', 'mode'],
      ['status', 'status'],
      ['cookie', 'cookie'],
      ['shopId', 'shopId'],
      ['module', 'module'],
      ['shareScope', 'share_scope']
    ]);

    const setClauses = [];
    const params = [];

    for (const [payloadKey, columnName] of allowedFields.entries()) {
      if (!Object.prototype.hasOwnProperty.call(updates, payloadKey)) continue;
      setClauses.push(`${columnName} = ?`);
      params.push(normalizeAccountUpdateValue(payloadKey, updates[payloadKey]));
    }

    if (setClauses.length > 0) {
      params.push(normalizedId);
      await connection.query(
        `UPDATE accounts
         SET ${setClauses.join(', ')}
         WHERE id = ?`,
        params
      );
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'shareScope')) {
      await cleanupHiddenAccountSelections(
        connection,
        normalizedCompanyId,
        account.key,
        normalizedUserId,
        String(updates.shareScope)
      );
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'is_active')) {
      if (Number(updates.is_active) === 1) {
        await upsertAccountSelection(connection, normalizedCompanyId, normalizedUserId, account.key);
      } else {
        await connection.query(
          `DELETE FROM account_selections
           WHERE company_id = ?
             AND user_id = ?
             AND account_key = ?`,
          [normalizedCompanyId, normalizedUserId, account.key]
        );
      }
    }
    if (setClauses.length === 0 && !Object.prototype.hasOwnProperty.call(updates, 'is_active')) {
      throw validationError('没有可更新的账号字段', 'ACCOUNT_UPDATE_EMPTY');
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
 * 功能描述：按企业与账号 key 更新账号凭证状态，状态刷新面向当前可见账号，不要求账号创建人。
 * @param {string} key 账号 key
 * @param {'active'|'expired'} status 新状态
 * @param {string} companyId 企业 ID
 * @return {Promise<void>} 无返回值
 */
async function updateAccountStatusByKey(key, status, companyId = 'default') {
  const normalizedStatus = String(status || '');
  if (!['active', 'expired'].includes(normalizedStatus)) {
    throw validationError('账号状态非法', 'ACCOUNT_STATUS_INVALID');
  }
  await pool.query(
    `UPDATE accounts
     SET status = ?
     WHERE company_id = ?
       AND \`key\` = ?
       AND is_deleted = 0`,
    [normalizedStatus, normalizeIdentity(companyId), normalizeAccountKey(key)]
  );
}

/**
 * 功能描述：获取所有已绑定的账号列表。
 * @param {string} companyId - 企业 ID
 * @param {string} userId - 飞书用户 ID
 * @return {Promise<Array>} 返回账号列表数组
 */
async function getAccounts(companyId = 'default', userId = 'default') {
  const normalizedCompanyId = normalizeIdentity(companyId);
  const normalizedUserId = normalizeIdentity(userId);
  const [rows] = await pool.query(
    `SELECT a.id,
            a.\`key\`,
            a.company_id,
            a.user_id,
            a.share_scope,
            a.name,
            a.mode,
            a.status,
            a.cookie,
            a.shopId,
            a.module,
            a.updated_at,
            IF(s.account_key IS NULL, 0, 1) AS is_active
     FROM accounts a
     LEFT JOIN account_selections s
       ON s.company_id = a.company_id
      AND s.user_id = ?
      AND s.account_key = a.\`key\`
     WHERE a.company_id = ?
       AND a.is_deleted = 0
       AND (a.share_scope = 'company' OR a.user_id = ?)
     ORDER BY a.updated_at DESC`,
    [normalizedUserId, normalizedCompanyId, normalizedUserId]
  );
  return rows.map(decryptAccountRow);
}

/**
 * 功能描述：获取企业内允许共享使用的账号列表，不混入当前用户私有账号。
 * @param {string} companyId 企业 ID
 * @param {string} userId 当前飞书用户 ID
 * @return {Promise<Array>} 返回共享账号列表
 */
async function getSharedAccounts(companyId = 'default', userId = 'default') {
  const normalizedCompanyId = normalizeIdentity(companyId);
  const normalizedUserId = normalizeIdentity(userId);
  const [rows] = await pool.query(
    `SELECT a.id,
            a.\`key\`,
            a.company_id,
            a.user_id,
            a.share_scope,
            a.name,
            a.mode,
            a.status,
            a.shopId,
            a.module,
            a.updated_at,
            IF(s.account_key IS NULL, 0, 1) AS is_active
     FROM accounts a
     LEFT JOIN account_selections s
       ON s.company_id = a.company_id
      AND s.user_id = ?
      AND s.account_key = a.\`key\`
     WHERE a.company_id = ?
       AND a.is_deleted = 0
       AND a.share_scope = 'company'
     ORDER BY a.updated_at DESC`,
    [normalizedUserId, normalizedCompanyId]
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
    const normalizedKey = normalizeAccountKey(key);
    const normalizedCompanyId = normalizeIdentity(companyId);
    const normalizedUserId = normalizeIdentity(userId);
    const [rows] = await connection.query(
      `SELECT \`key\`
       FROM accounts
       WHERE \`key\` = ?
         AND company_id = ?
         AND is_deleted = 0
         AND (share_scope = 'company' OR user_id = ?)
       LIMIT 1
       FOR UPDATE`,
      [normalizedKey, normalizedCompanyId, normalizedUserId]
    );
    if (!rows[0]) {
      throw notFoundError('账号不存在或当前用户不可使用', 'ACCOUNT_NOT_AVAILABLE');
    }
    await upsertAccountSelection(
      connection,
      normalizedCompanyId,
      normalizedUserId,
      normalizedKey
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
      [normalizeAccountKey(key), normalizeIdentity(companyId)]
    );
    const account = rows[0];
    if (!account || account.is_deleted === 1) {
      await connection.commit();
      return { action: 'not_found' };
    }

    if (String(account.user_id) === normalizeIdentity(userId)) {
      await connection.query(
        `UPDATE accounts
         SET is_deleted = 1,
             is_active = 0,
             deleted_at = CURRENT_TIMESTAMP,
             deleted_by = ?
         WHERE id = ?`,
        [normalizeIdentity(userId), account.id]
      );
      await connection.query(
        `DELETE FROM account_selections
         WHERE company_id = ?
           AND account_key = ?`,
        [normalizeIdentity(companyId), normalizeAccountKey(key)]
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
  const companyId = normalizeIdentity(buffer.companyId);
  const userId = normalizeIdentity(buffer.userId);
  const normalizedBuffer = normalizeCapturedBuffer(buffer);
  await pool.query(
    `INSERT INTO captured_buffer (company_id, user_id, captured, cookie, shopId, shopName, module)
     VALUES (?, ?, 1, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       captured = VALUES(captured),
       cookie = VALUES(cookie),
       shopId = VALUES(shopId),
       shopName = VALUES(shopName),
       module = VALUES(module)`,
    [
      companyId,
      userId,
      encryptCredential(normalizedBuffer.cookie),
      normalizedBuffer.shopId,
      normalizedBuffer.shopName,
      normalizedBuffer.module
    ]
  );
}

/**
 * 功能描述：创建短效一次性书签捕获会话，数据库只保存令牌哈希。
 * @param {string} companyId 企业 ID
 * @param {string} userId 飞书用户 ID
 * @param {string} module 当前同步模块
 * @return {Promise<object>} 返回仅展示一次的原始令牌和过期时间
 */
async function createCaptureSession(companyId = 'default', userId = 'default', module = '') {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashCaptureToken(token);
  const ttlMs = readInteger('CAPTURE_SESSION_TTL_MS', 15 * 60 * 1000, 60000, 3600000);
  const expiresAt = new Date(Date.now() + ttlMs);
  const normalizedCompanyId = normalizeIdentity(companyId);
  const normalizedUserId = normalizeIdentity(userId);
  const normalizedModule = normalizeText(module, 255);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO captured_buffer (company_id, user_id, captured, cookie, shopId, shopName, module)
       VALUES (?, ?, 0, '', '', '', ?)
       ON DUPLICATE KEY UPDATE
         captured = 0,
         cookie = '',
         shopId = '',
         shopName = '',
         module = VALUES(module)`,
      [normalizedCompanyId, normalizedUserId, normalizedModule]
    );
    await connection.query(
      `DELETE FROM capture_sessions
       WHERE company_id = ?
         AND user_id = ?
         AND consumed_at IS NULL`,
      [normalizedCompanyId, normalizedUserId]
    );
    await connection.query(
      `INSERT INTO capture_sessions (
         token_hash, company_id, user_id, module, expires_at
       ) VALUES (?, ?, ?, ?, ?)`,
      [tokenHash, normalizedCompanyId, normalizedUserId, normalizedModule, expiresAt]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await pool.query(
    `DELETE FROM capture_sessions
     WHERE expires_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)
        OR consumed_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)`
  ).catch((error) => {
    console.warn('[Capture Session] 清理历史会话失败', { message: error.message });
  });
  return {
    token,
    expiresAt
  };
}

/**
 * 功能描述：原子校验并消费捕获令牌，同时把 Cookie 写入令牌绑定的用户缓冲区。
 * @param {string} token 原始捕获令牌
 * @param {object} buffer 书签上报的 Cookie 和店铺信息
 * @return {Promise<object>} 返回令牌绑定的企业和用户上下文
 */
async function consumeCaptureSession(token, buffer = {}) {
  const normalizedToken = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(normalizedToken)) {
    throw validationError('捕获令牌无效，请从配置页重新生成书签脚本', 'CAPTURE_TOKEN_INVALID');
  }
  const normalizedBuffer = normalizeCapturedBuffer(buffer);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT token_hash, company_id, user_id, module, expires_at, consumed_at
       FROM capture_sessions
       WHERE token_hash = ?
         AND consumed_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP(3)
       LIMIT 1
       FOR UPDATE`,
      [hashCaptureToken(normalizedToken)]
    );
    const session = rows[0];
    if (!session) {
      throw forbiddenError('捕获令牌已失效，请从配置页重新生成书签脚本', 'CAPTURE_TOKEN_EXPIRED');
    }

    const sessionCompanyId = normalizeIdentity(session.company_id);
    const sessionUserId = normalizeIdentity(session.user_id);
    await connection.query(
      `INSERT INTO captured_buffer (
         company_id, user_id, captured, cookie, shopId, shopName, module
       ) VALUES (?, ?, 1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         captured = VALUES(captured),
         cookie = VALUES(cookie),
         shopId = VALUES(shopId),
         shopName = VALUES(shopName),
         module = VALUES(module)`,
      [
        sessionCompanyId,
        sessionUserId,
        encryptCredential(normalizedBuffer.cookie),
        normalizedBuffer.shopId,
        normalizedBuffer.shopName,
        session.module || normalizedBuffer.module
      ]
    );
    await connection.query(
      `UPDATE capture_sessions
       SET consumed_at = CURRENT_TIMESTAMP(3)
       WHERE token_hash = ?`,
      [session.token_hash]
    );
    await connection.commit();
    return {
      companyId: sessionCompanyId,
      userId: sessionUserId,
      module: session.module || normalizedBuffer.module
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 功能描述：查询当前数据库中是否有书签回传的捕获凭证与对应模块。
 * @param {string} companyId - 企业 ID
 * @param {string} userId - 飞书用户 ID
 * @return {Promise<object>} 返回捕获缓存对象
 */
async function getCapturedBuffer(companyId = 'default', userId = 'default') {
  const [rows] = await pool.query(
    `SELECT id, company_id, user_id, captured, shopId, shopName, module, updated_at
     FROM captured_buffer
     WHERE company_id = ?
       AND user_id = ?
     LIMIT 1`,
    [normalizeIdentity(companyId), normalizeIdentity(userId)]
  );
  const row = rows[0];
  if (!row) {
    return { company_id: companyId, user_id: userId, captured: 0, cookie: '', shopId: '', shopName: '', module: '' };
  }
  return row;
}

/**
 * 功能描述：原子读取并清空当前用户的临时捕获凭证，避免重复绑定或并发消费。
 * @param {string} companyId 企业 ID
 * @param {string} userId 飞书用户 ID
 * @return {Promise<object|null>} 返回捕获凭证；没有可消费内容时返回 null
 */
async function consumeCapturedBuffer(companyId = 'default', userId = 'default') {
  const normalizedCompanyId = normalizeIdentity(companyId);
  const normalizedUserId = normalizeIdentity(userId);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT *
       FROM captured_buffer
       WHERE company_id = ?
         AND user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [normalizedCompanyId, normalizedUserId]
    );
    const row = rows[0];
    if (!row || Number(row.captured) !== 1 || !row.cookie) {
      await connection.commit();
      return null;
    }

    const decryptedCookie = decryptCredential(row.cookie);
    await connection.query(
      `UPDATE captured_buffer
       SET captured = 0,
           cookie = '',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [row.id]
    );
    await connection.commit();
    return {
      ...row,
      cookie: decryptedCookie
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
    [normalizeIdentity(companyId), normalizeIdentity(userId)]
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
  const taskKey = normalizeText(id, 128);
  if (!taskKey) {
    throw validationError('任务 key 不能为空', 'TASK_KEY_REQUIRED');
  }
  await pool.query(
    `INSERT INTO tasks (task_key, company_id, config)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE config = VALUES(config)`,
    [taskKey, normalizeIdentity(companyId), JSON.stringify(config)]
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
       AND user_id = ?`,
    [
      normalizeText(module, 255),
      normalizeAccountKey(key),
      normalizeIdentity(companyId),
      normalizeIdentity(userId)
    ]
  );
}

/**
 * 功能描述：持久化保存同步故障异常记录。
 * @param {object} error - 异常明细对象
 * @return {Promise<void>} 无返回值
 */
async function saveError(error = {}) {
  const companyId = normalizeIdentity(error.companyId || error.tenantKey || 'default');
  const errorKey = normalizeText(error.id, 128);
  if (!errorKey) {
    throw validationError('异常记录 key 不能为空', 'ERROR_KEY_REQUIRED');
  }
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
    [
      errorKey,
      companyId,
      normalizeText(error.timestamp, 64),
      normalizeText(error.platform, 64),
      normalizeText(error.shopName, 255),
      normalizeText(error.errorType, 128),
      normalizeText(error.errorMessage, 16000),
      normalizeText(error.status, 32)
    ]
  );
}

/**
 * 功能描述：创建一条同步执行日志，记录飞书触发的一次 records 请求开始。
 * @param {object} log 同步日志基础信息
 * @return {Promise<void>} 无返回值
 */
async function createSyncLog(log = {}) {
  const companyId = normalizeIdentity(log.companyId || 'default');
  const logKey = normalizeText(log.logKey, 128);
  const status = String(log.status || 'running');
  if (!logKey) {
    throw validationError('同步日志 key 不能为空', 'SYNC_LOG_KEY_REQUIRED');
  }
  if (!['running', 'success', 'failed'].includes(status)) {
    throw validationError('同步日志状态非法', 'SYNC_LOG_STATUS_INVALID');
  }
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
       status = VALUES(status),
       started_at = VALUES(started_at),
       finished_at = NULL,
       duration_ms = NULL,
       record_count = 0,
       has_more = 0,
       next_page_token = NULL,
       error_message = NULL,
       updated_at = CURRENT_TIMESTAMP`,
    [
      logKey,
      companyId,
      normalizeNullableText(log.taskId, 128),
      normalizeNullableText(log.transactionId, 128),
      normalizeNullableText(log.syncModule, 255),
      normalizeNullableText(log.accountName, 255),
      normalizeNullableText(log.shopId, 128),
      normalizeNullableText(log.pageToken, 255),
      status,
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
  const normalizedLogKey = normalizeText(logKey, 128);
  if (!normalizedLogKey) {
    throw validationError('同步日志 key 不能为空', 'SYNC_LOG_KEY_REQUIRED');
  }
  const setClauses = [];
  const params = [];
  if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
    const status = String(updates.status);
    if (!['running', 'success', 'failed'].includes(status)) {
      throw validationError('同步日志状态非法', 'SYNC_LOG_STATUS_INVALID');
    }
    setClauses.push('status = ?');
    params.push(status);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'errorMessage')) {
    setClauses.push('error_message = ?');
    params.push(normalizeNullableText(updates.errorMessage, 16000));
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'finishedAt')) {
    setClauses.push('finished_at = ?');
    params.push(updates.finishedAt);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'recordCount')) {
    setClauses.push('record_count = ?');
    params.push(Math.max(0, Math.min(Math.floor(Number(updates.recordCount) || 0), 1000000)));
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'hasMore')) {
    setClauses.push('has_more = ?');
    params.push(Number(updates.hasMore) === 1 ? 1 : 0);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'nextPageToken')) {
    setClauses.push('next_page_token = ?');
    params.push(normalizeNullableText(updates.nextPageToken, 255));
  }
  if (updates.durationMs === 'auto' && updates.finishedAt) {
    setClauses.push('duration_ms = ROUND(TIMESTAMPDIFF(MICROSECOND, started_at, ?) / 1000)');
    params.push(updates.finishedAt);
  } else if (Object.prototype.hasOwnProperty.call(updates, 'durationMs')) {
    setClauses.push('duration_ms = ?');
    params.push(Math.max(0, Math.min(Math.floor(Number(updates.durationMs) || 0), 3600000)));
  }

  if (setClauses.length === 0) return;

  params.push(normalizeIdentity(companyId), normalizedLogKey);
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
  const normalizedOptions = options && typeof options === 'object' ? options : {};
  const filters = ['company_id = ?'];
  const params = [normalizeIdentity(companyId)];

  if (normalizedOptions.status) {
    if (!['running', 'success', 'failed'].includes(String(normalizedOptions.status))) {
      throw validationError('同步日志状态筛选值非法', 'SYNC_LOG_STATUS_INVALID');
    }
    filters.push('status = ?');
    params.push(normalizedOptions.status);
  }

  const requestedPageSize = Number(normalizedOptions.pageSize || normalizedOptions.limit || 20);
  const requestedPage = Number(normalizedOptions.page || 1);
  const pageSize = Number.isFinite(requestedPageSize)
    ? Math.min(Math.max(Math.floor(requestedPageSize), 1), 200)
    : 20;
  const normalizedPage = Number.isFinite(requestedPage)
    ? Math.max(Math.floor(requestedPage), 1)
    : 1;
  const maxPage = Math.floor(2147483647 / pageSize) + 1;
  const page = Math.min(normalizedPage, maxPage);
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

/**
 * 功能描述：在 MySQL 中原子登记可信身份 nonce，跨实例拒绝时间窗内的签名重放。
 * @param {string} nonce 网关生成的随机 nonce
 * @param {Date} expiresAt 防重放记录过期时间
 * @return {Promise<boolean>} 返回是否首次消费；重复 nonce 返回 false
 */
async function consumeManagementIdentityNonce(nonce, expiresAt) {
  const normalizedNonce = String(nonce || '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(normalizedNonce)) {
    throw validationError('可信身份 nonce 非法', 'MANAGEMENT_IDENTITY_NONCE_INVALID');
  }
  const normalizedExpiresAt = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(normalizedExpiresAt.getTime())) {
    throw validationError('可信身份 nonce 过期时间非法', 'MANAGEMENT_IDENTITY_EXPIRY_INVALID');
  }

  const now = Date.now();
  if (now - lastManagementIdentityNonceCleanupAt >= 60000) {
    lastManagementIdentityNonceCleanupAt = now;
    await pool.query(
      'DELETE FROM management_identity_nonces WHERE expires_at <= CURRENT_TIMESTAMP(3)'
    ).catch((error) => {
      console.warn('[Management Identity] 清理过期 nonce 失败', { message: error.message });
    });
  }

  const nonceHash = crypto
    .createHash('sha256')
    .update(normalizedNonce, 'utf8')
    .digest('hex');
  try {
    await pool.query(
      `INSERT INTO management_identity_nonces (nonce_hash, expires_at)
       VALUES (?, ?)`,
      [nonceHash, normalizedExpiresAt]
    );
    return true;
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') return false;
    throw error;
  }
}

/**
 * 功能描述：解密账号查询结果中的敏感凭证，业务层可用但不会直接暴露给前端。
 * @param {object} row MySQL 账号记录
 * @return {object} 返回解密后的账号对象
 */
function decryptAccountRow(row) {
  try {
    return {
      ...row,
      cookie: decryptCredential(row.cookie)
    };
  } catch (error) {
    console.error('[Credential Decryption] 账号凭证无法解密', {
      accountId: row.id,
      companyId: row.company_id,
      message: error.message
    });
    return {
      ...row,
      cookie: '',
      status: 'expired',
      credential_error: true
    };
  }
}

/**
 * 功能描述：校验并归一化新增账号字段，避免超长或非法枚举进入数据库。
 * @param {object} account 原始账号载荷
 * @return {object} 返回安全账号字段
 */
function normalizeAccountPayload(account = {}) {
  const key = normalizeAccountKey(account.key);
  const name = normalizeText(account.name, 255);
  if (!name) throw validationError('账号名称不能为空', 'ACCOUNT_NAME_REQUIRED');

  const shareScope = String(account.shareScope || account.share_scope || 'private');
  if (!['company', 'private'].includes(shareScope)) {
    throw validationError('账号共享范围非法', 'ACCOUNT_SHARE_SCOPE_INVALID');
  }
  const status = String(account.status || 'active');
  if (!['active', 'expired'].includes(status)) {
    throw validationError('账号状态非法', 'ACCOUNT_STATUS_INVALID');
  }

  const cookie = String(account.cookie || '');
  if (!cookie) {
    throw validationError('Cookie 凭证为空，无法保存', 'CREDENTIAL_REQUIRED');
  }
  if (Buffer.byteLength(cookie, 'utf8') > getCredentialMaxBytes()) {
    throw validationError('Cookie 凭证长度超过限制', 'CREDENTIAL_TOO_LARGE');
  }

  return {
    key,
    name,
    mode: normalizeText(account.mode || '模拟登录', 64),
    status,
    cookie,
    shopId: normalizeText(account.shopId, 128),
    isActive: Number(account.is_active) === 1 ? 1 : 0,
    module: normalizeText(account.module, 255),
    shareScope
  };
}

/**
 * 功能描述：校验账号局部更新字段并转换为数据库值。
 * @param {string} key 更新字段名
 * @param {unknown} value 原始字段值
 * @return {unknown} 返回安全字段值
 */
function normalizeAccountUpdateValue(key, value) {
  switch (key) {
    case 'name': {
      const name = normalizeText(value, 255);
      if (!name) throw validationError('账号名称不能为空', 'ACCOUNT_NAME_REQUIRED');
      return name;
    }
    case 'mode':
      return normalizeText(value, 64);
    case 'status': {
      const status = String(value || '');
      if (!['active', 'expired'].includes(status)) {
        throw validationError('账号状态非法', 'ACCOUNT_STATUS_INVALID');
      }
      return status;
    }
    case 'cookie': {
      const cookie = String(value || '');
      if (!cookie) {
        throw validationError('Cookie 凭证为空，无法更新', 'CREDENTIAL_REQUIRED');
      }
      if (Buffer.byteLength(cookie, 'utf8') > getCredentialMaxBytes()) {
        throw validationError('Cookie 凭证长度超过限制', 'CREDENTIAL_TOO_LARGE');
      }
      return encryptCredential(cookie);
    }
    case 'shopId':
      return normalizeText(value, 128);
    case 'module':
      return normalizeText(value, 255);
    case 'shareScope': {
      const shareScope = String(value || '');
      if (!['company', 'private'].includes(shareScope)) {
        throw validationError('账号共享范围非法', 'ACCOUNT_SHARE_SCOPE_INVALID');
      }
      return shareScope;
    }
    default:
      return value;
  }
}

/**
 * 功能描述：把任意输入转换为受长度限制的单行文本。
 * @param {unknown} value 原始值
 * @param {number} maxLength 最大字符数
 * @return {string} 返回清洗后的文本
 */
function normalizeText(value, maxLength) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * 功能描述：把可选字段转换为受长度限制的文本，空值统一写入 NULL。
 * @param {unknown} value 原始字段值
 * @param {number} maxLength 最大字符数
 * @return {string|null} 返回清洗后的文本或 NULL
 */
function normalizeNullableText(value, maxLength) {
  const text = normalizeText(value, maxLength);
  return text || null;
}

/**
 * 功能描述：校验账号业务 key，确保可安全用于 URL、索引和日志上下文。
 * @param {unknown} value 原始账号 key
 * @return {string} 返回合法账号 key
 */
function normalizeAccountKey(value) {
  const key = normalizeText(value, 128);
  if (!key) throw validationError('账号 key 不能为空', 'ACCOUNT_KEY_REQUIRED');
  if (!/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw validationError('账号 key 只能包含字母、数字、点、下划线、冒号和短横线', 'ACCOUNT_KEY_INVALID');
  }
  return key;
}

/**
 * 功能描述：校验租户和用户标识，避免非法字符造成租户键碰撞。
 * @param {unknown} value 原始标识
 * @return {string} 返回合法标识
 */
function normalizeIdentity(value) {
  const identity = normalizeText(value || 'default', 128);
  if (!/^[A-Za-z0-9._:@-]+$/.test(identity)) {
    throw validationError('租户或用户标识格式非法', 'IDENTITY_INVALID');
  }
  return identity;
}

/**
 * 功能描述：校验书签捕获载荷中的敏感凭证和展示字段。
 * @param {object} buffer 原始捕获载荷
 * @return {object} 返回归一化捕获载荷
 */
function normalizeCapturedBuffer(buffer = {}) {
  const cookie = String(buffer.cookie || '');
  if (!cookie) {
    throw validationError('Cookie 凭证为空，无法保存', 'CREDENTIAL_REQUIRED');
  }
  if (Buffer.byteLength(cookie, 'utf8') > getCredentialMaxBytes()) {
    throw validationError('Cookie 凭证长度超过限制', 'CREDENTIAL_TOO_LARGE');
  }
  return {
    cookie,
    shopId: normalizeText(buffer.shopId, 128),
    shopName: normalizeText(buffer.shopName || '抖店商家店铺', 255),
    module: normalizeText(buffer.module, 255)
  };
}

/**
 * 功能描述：读取单条 Cookie 凭证允许的最大字节数。
 * @return {number} 返回最大字节数
 */
function getCredentialMaxBytes() {
  return readInteger('CREDENTIAL_MAX_BYTES', 65535, 1024, 1024 * 1024);
}

/**
 * 功能描述：计算捕获令牌哈希，避免数据库泄露后令牌可被直接重放。
 * @param {string} token 原始令牌
 * @return {string} 返回 SHA-256 十六进制哈希
 */
function hashCaptureToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/**
 * 功能描述：写入当前用户选择的活跃账号，每个企业用户始终只有一条选择记录。
 * @param {object} connection MySQL 事务连接
 * @param {string} companyId 企业 ID
 * @param {string} userId 飞书用户 ID
 * @param {string} accountKey 账号 key
 * @return {Promise<void>} 无返回值
 */
async function upsertAccountSelection(connection, companyId, userId, accountKey) {
  await connection.query(
    `INSERT INTO account_selections (company_id, user_id, account_key)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       account_key = VALUES(account_key),
       updated_at = CURRENT_TIMESTAMP`,
    [companyId, userId, accountKey]
  );
}

/**
 * 功能描述：账号转为私有时清理其他用户对该账号的历史选择，防止残留越权引用。
 * @param {object} connection MySQL 事务连接
 * @param {string} companyId 企业 ID
 * @param {string} accountKey 账号 key
 * @param {string} ownerUserId 创建人用户 ID
 * @param {string} shareScope 最新共享范围
 * @return {Promise<void>} 无返回值
 */
async function cleanupHiddenAccountSelections(
  connection,
  companyId,
  accountKey,
  ownerUserId,
  shareScope
) {
  if (shareScope !== 'private') return;
  await connection.query(
    `DELETE FROM account_selections
     WHERE company_id = ?
       AND account_key = ?
       AND user_id <> ?`,
    [companyId, accountKey, ownerUserId]
  );
}

/**
 * 功能描述：将旧版 accounts.is_active 状态一次性迁移到用户级选择表，保持升级后的默认账号。
 * @return {Promise<void>} 无返回值
 */
async function migrateLegacyActiveSelections() {
  await pool.query(
    `INSERT IGNORE INTO account_selections (company_id, user_id, account_key)
     SELECT a.company_id, a.user_id, a.\`key\`
     FROM accounts a
     WHERE a.is_deleted = 0
       AND a.is_active = 1
       AND NOT EXISTS (
         SELECT 1
         FROM accounts newer
         WHERE newer.company_id = a.company_id
           AND newer.user_id = a.user_id
           AND newer.is_deleted = 0
           AND newer.is_active = 1
           AND (
             newer.updated_at > a.updated_at
             OR (newer.updated_at = a.updated_at AND newer.id > a.id)
           )
       )`
  );
}

/**
 * 功能描述：在配置加密密钥后把历史明文 Cookie 迁移为 AES-GCM 密文。
 * @return {Promise<void>} 无返回值
 */
async function migrateStoredCredentials() {
  if (!isCredentialEncryptionEnabled()) return;
  await migrateCredentialColumn('accounts', 'cookie');
  await migrateCredentialColumn('captured_buffer', 'cookie');
}

/**
 * 功能描述：分批迁移指定表中的历史明文凭证，避免一次加载过多数据。
 * @param {string} table 数据表名称
 * @param {string} column 凭证列名称
 * @return {Promise<void>} 无返回值
 */
async function migrateCredentialColumn(table, column) {
  const allowedTables = new Set(['accounts', 'captured_buffer']);
  if (!allowedTables.has(table) || column !== 'cookie') {
    throw new Error('CredentialMigrationTargetInvalid: 非法凭证迁移目标');
  }

  while (true) {
    const [rows] = await pool.query(
      `SELECT id, \`${column}\` AS credential
       FROM \`${table}\`
       WHERE \`${column}\` IS NOT NULL
         AND \`${column}\` <> ''
         AND \`${column}\` NOT LIKE ?
       LIMIT 200`,
      [`${ENCRYPTED_PREFIX}%`]
    );
    if (rows.length === 0) return;

    for (const row of rows) {
      await pool.query(
        `UPDATE \`${table}\`
         SET \`${column}\` = ?
         WHERE id = ?`,
        [encryptCredential(row.credential), row.id]
      );
    }
  }
}

/**
 * 功能描述：检查数据库连接是否可用，供就绪探针使用。
 * @return {Promise<boolean>} 返回数据库是否可访问
 */
async function pingDb() {
  await pool.query({
    sql: 'SELECT 1',
    timeout: readInteger('MYSQL_HEALTH_QUERY_TIMEOUT_MS', 2000, 100, 10000)
  });
  return true;
}

/**
 * 功能描述：关闭 MySQL 连接池，供服务优雅停机使用。
 * @return {Promise<void>} 无返回值
 */
async function closeDb() {
  await pool.end();
}

module.exports = {
  initDb,
  closeDb,
  pingDb,
  saveAccount,
  updateAccountById,
  updateAccountStatusByKey,
  getAccounts,
  getSharedAccounts,
  setActiveAccount,
  deleteAccount,
  createCaptureSession,
  consumeCaptureSession,
  saveCapturedBuffer,
  getCapturedBuffer,
  consumeCapturedBuffer,
  clearCapturedBuffer,
  saveTask,
  updateAccountModule,
  saveError,
  createSyncLog,
  finishSyncLog,
  listSyncLogs,
  consumeManagementIdentityNonce,
  getDoudianInterfaces,
  getDoudianInterfaceByKey
};
