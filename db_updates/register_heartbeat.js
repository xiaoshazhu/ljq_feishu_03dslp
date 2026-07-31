const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({ path: path.join(__dirname, '../feishu-doudian-connector-server/.env') });

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
    const interfaceKey = 'account_center_getaccountlist_49e457f4';
    const requestConfig = {
      method: 'GET',
      pagination: false,
      contentType: 'application/json;charset=UTF-8',
      extraQuery: {
        req_source: 'dou_dian_pc'
      }
    };
    
    // 检查是否已经存在
    const [existing] = await pool.query("SELECT id FROM dslp_interfaces WHERE interface_key = ?", [interfaceKey]);
    if (!existing.length) {
      await pool.query(
        "INSERT INTO dslp_interfaces (interface_key, interface_name, api_path, api_host, module_group, request_config, fields_schema) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          interfaceKey,
          '系统-账号中心-子账号列表(心跳探测)',
          '/account/center/getAccountList',
          'https://fxg.jinritemai.com',
          '系统/心跳探测',
          JSON.stringify(requestConfig),
          '[]'
        ]
      );
      console.log('✅ 心跳探测接口注册成功！');
    } else {
      console.log('💡 心跳探测接口已存在，跳过。');
    }
  } catch (err) {
    console.error('注册错误:', err);
  } finally {
    await pool.end();
  }
}

main();
