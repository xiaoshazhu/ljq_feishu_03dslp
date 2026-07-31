const path = require('path');
const backendDir = 'd:/高原安/代码/doudianfeishu/feishu-doudian-connector-server';
module.paths.push(path.join(backendDir, 'node_modules'));

const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({ path: path.join(backendDir, '.env') });

/**
 * 修复接口 1694（搜索-搜索概况-商品优化推荐列表）的 dateRangeMapping.daysOffset
 * 从 -2 改为 -1，使后端生成的时间范围与电商罗盘"近7天"（结束于昨天）保持一致。
 *
 * 根因分析：
 * - daysOffset=-2 → end_date = today-2days = 07/29
 * - 电商罗盘"近7天"默认 end_date = yesterday = 07/30
 * - 导致飞书表格拉取到的是 07/23~07/29 而非 07/24~07/30 的数据
 */
async function main() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 1,
    queueLimit: 0
  });

  try {
    const [rows] = await pool.query(
      "SELECT id, request_config FROM dslp_interfaces WHERE id = 1694"
    );
    if (!rows.length) { console.log('Not found: ID 1694'); return; }

    const cfg = rows[0].request_config;
    if (!cfg.dateRangeMapping) {
      console.log('dateRangeMapping not found'); return;
    }

    const oldOffset = cfg.dateRangeMapping.daysOffset;
    cfg.dateRangeMapping.daysOffset = -1;

    await pool.query(
      "UPDATE dslp_interfaces SET request_config = ? WHERE id = 1694",
      [JSON.stringify(cfg)]
    );
    console.log(`✅ ID 1694 dateRangeMapping.daysOffset: ${oldOffset} → -1`);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
