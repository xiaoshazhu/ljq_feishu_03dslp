const path = require('path');
const backendDir = 'd:/高原安/代码/doudianfeishu/feishu-doudian-connector-server';
module.paths.push(path.join(backendDir, 'node_modules'));

const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({
  path: path.join(backendDir, '.env')
});

function formatDate(date, timeSuffix = '00:00:00') {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d} ${timeSuffix}`;
}

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

  const now = new Date();
  
  // 计算今天之前的日期
  const yesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const yesterdayStr = formatDate(yesterday, '23:59:59');
  const threeDaysAgoStr = formatDate(threeDaysAgo, '00:00:00');
  const sevenDaysAgoStr = formatDate(sevenDaysAgo, '00:00:00');

  const targets = [
    '商品_product_product_product_list',
    '商品_product_chance_market_dig_cate_list',
    '商品_mall_product_rank_search'
  ];

  try {
    for (const key of targets) {
      const [rows] = await pool.query(
        'SELECT request_config FROM dslp_interfaces WHERE interface_key = ? AND platform = ? LIMIT 1',
        [key, 'douyin']
      );
      if (rows[0]) {
        const config = rows[0].request_config;
        config.customQueryFields = config.customQueryFields.map(field => {
          if (field.name === 'begin_date') {
            field.defaultValue = sevenDaysAgoStr;
            field.options = [
              { value: sevenDaysAgoStr, label: `回溯近 7 天 (${sevenDaysAgoStr.slice(0, 10)})` },
              { value: threeDaysAgoStr, label: `回溯近 3 天 (${threeDaysAgoStr.slice(0, 10)})` }
            ];
          } else if (field.name === 'end_date') {
            field.defaultValue = yesterdayStr;
            field.options = [
              { value: yesterdayStr, label: `截止昨日 (${yesterdayStr.slice(0, 10)})` }
            ];
          }
          return field;
        });
        await pool.query(
          'UPDATE dslp_interfaces SET request_config = ? WHERE interface_key = ? AND platform = ?',
          [JSON.stringify(config), key, 'douyin']
        );
        console.log(`[Update Success] Interface: ${key} date options updated.`);
      }
    }
  } catch (err) {
    console.error('Error running dynamic updates:', err);
  } finally {
    await pool.end();
  }
}

main();
