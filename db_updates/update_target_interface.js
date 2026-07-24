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
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 1,
    queueLimit: 0
  });

  const updatedConfig = {
    method: "GET",
    pageSize: 10,
    listPaths: [
      "data",
      "data.list",
      "data.records",
      "data.items",
      "data.data",
      "data.rank_list",
      "list",
      "records",
      "items"
    ],
    pageParam: "page_no",
    pageStart: 1,
    pagination: true,
    contentType: "application/json;charset=UTF-8",
    pageSizeParam: "page_size",
    requiredParams: [
      "sale_type",
      "content_type",
      "date_type"
    ],
    extraQuery: {
      index_selected: "receive_amt,pay_amt_exclude_refund,trans_amt,pay_amt,pay_cnt,ad_costed_amt,ad_cost_ratio,qc_ad_cost,pay_refund_success_amt,product_show_ucnt,product_click_ucnt,pay_ucnt,net_trans_amt,product_show_pay_converse_uv_rate",
      is_activity: "false",
      activity_id: "",
      key_word: "",
      cate_ids: "",
      cate_ids_original: "0",
      product_tab: "0",
      only_abnormal: "false",
      only_drop_gmv: "false",
      only_drop_product_show: "false",
      use_customize_gmv: "false",
      use_customize_product_show: "false",
      abnormal_threshold_gmv: "20",
      abnormal_threshold_product_show: "0",
      new_version: "true"
    },
    customQueryFields: [
      {
        name: "sale_type",
        label: "操作类型",
        type: "string",
        required: true,
        defaultValue: "1",
        options: [
          { value: "1", label: "店铺自营" },
          { value: "2", label: "达人带货" },
          { value: "3", label: "全盘" }
        ]
      },
      {
        name: "content_type",
        label: "流量场景",
        type: "string",
        required: true,
        defaultValue: "1",
        options: [
          { value: "1", label: "全部场景" },
          { value: "2", label: "直播" },
          { value: "3", label: "短视频" },
          { value: "4", label: "商品卡" }
        ]
      },
      {
        name: "date_type",
        label: "分析维度",
        type: "string",
        required: true,
        defaultValue: "21",
        options: [
          { value: "21", label: "日度" },
          { value: "22", label: "周度" },
          { value: "23", label: "月度" }
        ]
      },
      {
        name: "begin_date",
        label: "开始时间 (格式如 YYYY-MM-DD，留空则默认拉取最新)",
        type: "string",
        required: false,
        placeholder: "留空自动查询最优区间"
      },
      {
        name: "end_date",
        label: "结束时间 (格式如 YYYY-MM-DD，留空则默认拉取最新)",
        type: "string",
        required: false,
        placeholder: "留空自动查询最优区间"
      }
    ]
  };

  try {
    const newConfigJson = JSON.stringify(updatedConfig);
    const [result] = await pool.query(
      'UPDATE dslp_interfaces SET request_config = ? WHERE interface_key = ? AND platform = ?',
      [newConfigJson, '商品_product_product_product_list', 'douyin']
    );

    console.log(`[Update Success] Rows affected: ${result.affectedRows}`);
  } catch (err) {
    console.error('Error updating target interface:', err);
  } finally {
    await pool.end();
  }
}

main();
