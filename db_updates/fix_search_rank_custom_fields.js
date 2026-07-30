const path = require('path');
const backendDir = 'd:/高原安/代码/doudianfeishu/feishu-doudian-connector-server';
module.paths.push(path.join(backendDir, 'node_modules'));

const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({
  path: path.join(backendDir, '.env')
});

async function main() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  });

  try {
    // 1. 读取 1695 接口的原始配置
    const [rows] = await pool.query('SELECT request_config FROM dslp_interfaces WHERE id = 1695');
    if (!rows.length) {
      console.log("未找到 1695 接口");
      return;
    }

    const requestConfig = typeof rows[0].request_config === 'string' 
      ? JSON.parse(rows[0].request_config) 
      : rows[0].request_config;

    // 2. 写入 customQueryFields，暴露出风控参数输入框
    requestConfig.customQueryFields = [
      {
        name: "_lid",
        type: "string",
        label: "风控 _lid (若失效请抓包填入)",
        required: false,
        defaultValue: "114825009466"
      },
      {
        name: "msToken",
        type: "string",
        label: "风控 msToken (若失效请抓包填入)",
        required: false,
        defaultValue: "rWq1Z0oMMckul7kTw_7bKcKT6H99vfmWdPV8uA8amxBLpBokYicETWQQsTcrORpx4JOftVAVrVHkIZaJkWOTy9zutuU_PBUa5-ERlBlkRxBmYMzzML4UO3RsvRrWHZbvyf_GT7zzQ4IFgHkGyZQFkC_gb3sq6t4D8jgRQ4-jNZNVQ5q8Nm0cOk0="
      },
      {
        name: "a_bogus",
        type: "string",
        label: "风控 a_bogus (若失效请抓包填入)",
        required: false,
        defaultValue: "Ov0nDtWEYpRnapAGuCQptRpU3oo/rs8yc-TxbFli9KOfa7lczM36cxCbbxz-5tP9XuZmZvAHbdB/0fxcmtTTZZpkomZfSzTyrTQI9hsohqhVYskhnZjDCGtELk4aWuTOOQV1iQLX6zlqZIQvqq9NAlFyyCerBWb0zHajdaWU7xgB64kY9d2cCBgy"
      }
    ];

    // 3. 更新 1695 接口配置
    await pool.query('UPDATE dslp_interfaces SET request_config = ? WHERE id = 1695', [JSON.stringify(requestConfig)]);
    console.log("成功升级 1695 接口，已为其开通风控参数配置输入项！");

    // 4. 同步升级 1693 接口（它是同类接口），也开启相同的配置
    const [rows1693] = await pool.query('SELECT request_config FROM dslp_interfaces WHERE id = 1693');
    if (rows1693.length) {
      const config1693 = typeof rows1693[0].request_config === 'string'
        ? JSON.parse(rows1693[0].request_config)
        : rows1693[0].request_config;
      config1693.customQueryFields = requestConfig.customQueryFields;
      await pool.query('UPDATE dslp_interfaces SET request_config = ? WHERE id = 1693', [JSON.stringify(config1693)]);
      console.log("成功升级 1693 接口的风控参数配置项！");
    }

  } catch (e) {
    console.error("更新出错:", e);
  } finally {
    await pool.end();
  }
}

main();
