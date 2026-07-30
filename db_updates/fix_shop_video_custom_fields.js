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
    // 1. 读取 1696 (看后搜视频列表) 接口的原始配置
    const [rows] = await pool.query('SELECT request_config FROM dslp_interfaces WHERE id = 1696');
    if (!rows.length) {
      console.log("未找到 1696 接口");
      return;
    }

    const requestConfig = typeof rows[0].request_config === 'string' 
      ? JSON.parse(rows[0].request_config) 
      : rows[0].request_config;

    // 2. 将 scene_type 移出 extraQuery，放入 customQueryFields 变成用户可配置项，并默认选 1 (自营视频)
    if (requestConfig.extraQuery && 'scene_type' in requestConfig.extraQuery) {
      delete requestConfig.extraQuery.scene_type;
    }
    
    // 同时也将 audit_status 移出 extraQuery 变成可选配置，默认选 -1 (全部配置状态)，这样用户就能把“全部/已优化/待配置”等所有视频全拉下来！
    if (requestConfig.extraQuery && 'audit_status' in requestConfig.extraQuery) {
      delete requestConfig.extraQuery.audit_status;
    }

    requestConfig.customQueryFields = [
      {
        name: "scene_type",
        type: "string",
        label: "视频视角",
        required: true,
        defaultValue: "1",
        options: [
          { value: "1", label: "自营视频" },
          { value: "2", label: "非自营视频 (达人视频)" }
        ]
      },
      {
        name: "audit_status",
        type: "string",
        label: "看后搜配置状态",
        required: true,
        defaultValue: "0",
        options: [
          { value: "0", label: "待配置" },
          { value: "1", label: "审核中" },
          { value: "2", label: "已优化" }
        ]
      },
      {
        name: "_lid",
        type: "string",
        label: "风控 _lid (若失效请抓包填入)",
        required: false,
        defaultValue: "820180434678"
      },
      {
        name: "msToken",
        type: "string",
        label: "风控 msToken (若失效请抓包填入)",
        required: false,
        defaultValue: "3Ps2ssWVxdes9Xl6ME2Xx8NAfsJuM58i03gOFsrkMaWu9SamHhZBs9Bu2b2SUswnAj5688UantjuGg4SJf1BybUMG4p41GNOa6D57PsG65U9ZAxsdPFeVDk2exTJr-VBoerl7qQoRPEbwTdTXrPaAHmdLyTPLSYwHtXUMMcEe_cToiUXoICHKuU="
      },
      {
        name: "a_bogus",
        type: "string",
        label: "风控 a_bogus (若失效请抓包填入)",
        required: false,
        defaultValue: "D705Det7domVCpCtmcdPtUqU/SdMNP8yElTdSHIiyoThPXeOlM-y5ntKboz"
      }
    ];

    // 3. 更新数据库
    await pool.query('UPDATE dslp_interfaces SET request_config = ? WHERE id = 1696', [JSON.stringify(requestConfig)]);
    console.log("成功升级 1696 看后搜视频接口：已将视频视角(scene_type)与配置状态(audit_status)作为前端自定义参数暴露！");

  } catch (e) {
    console.error("更新 1746 出错:", e);
  } finally {
    await pool.end();
  }
}

main();
