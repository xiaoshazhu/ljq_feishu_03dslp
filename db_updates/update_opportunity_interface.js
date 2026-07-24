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
  const yesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const yesterdayStr = formatDate(yesterday, '23:59:59');
  const threeDaysAgoStr = formatDate(threeDaysAgo, '00:00:00');
  const sevenDaysAgoStr = formatDate(sevenDaysAgo, '00:00:00');

  const updatedConfig = {
    method: "GET",
    pageSize: 10,
    listPaths: [
      "data.module_data.core_data_0.compass_general_table_value.data",
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
      "content_type",
      "date_type",
      "first_cate_id"
    ],
    extraQuery: {
      cate_tag_list: "2",
      source_biz_type: "1",
      sort_field: "pay_amt_incr_rate",
      is_asc: "false"
    },
    customQueryFields: [
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
        name: "first_cate_id",
        label: "一级类目 ID",
        type: "string",
        required: true,
        defaultValue: "1000001823",
        options: [
          { value: "1000001823", label: "食品饮料 (1000001823)" },
          { value: "1000001714", label: "美妆个护 (1000001714)" }
        ]
      },
      {
        name: "begin_date",
        label: "同步时间范围 (开始日期)",
        type: "string",
        required: true,
        defaultValue: sevenDaysAgoStr,
        options: [
          { value: sevenDaysAgoStr, label: `回溯近 7 天 (${sevenDaysAgoStr.slice(0, 10)})` },
          { value: threeDaysAgoStr, label: `回溯近 3 天 (${threeDaysAgoStr.slice(0, 10)})` }
        ]
      },
      {
        name: "end_date",
        label: "结束日期",
        type: "string",
        required: true,
        defaultValue: yesterdayStr,
        options: [
          { value: yesterdayStr, label: `截止昨日 (${yesterdayStr.slice(0, 10)})` }
        ]
      }
    ]
  };

  const newFieldsSchema = [
    {
      key: "category",
      type: "Text",
      label: "类目",
      isPrimary: false,
      sourcePath: "cell_info.cate_info.category.category_name",
      defaultField: "category"
    },
    {
      key: "field",
      type: "Text",
      label: "机会标签",
      isPrimary: false,
      sourcePath: "cell_info.cate_info.category.tags.0.tag_name",
      defaultField: "field"
    },
    {
      key: "pay_amt",
      type: "Number",
      label: "用户支付金额 (区间下限)",
      isPrimary: false,
      sourcePath: "cell_info.pay_amt.index_values.extra_value.lower.value",
      defaultField: "pay_amt"
    },
    {
      key: "field_1",
      type: "Number",
      label: "增长率",
      isPrimary: false,
      sourcePath: "cell_info.pay_amt_incr_rate.index_values.value.value",
      defaultField: "field_1"
    },
    {
      key: "product",
      type: "Number",
      label: "需求供给比",
      isPrimary: false,
      sourcePath: "cell_info.demand_supply_rate.index_values.value.value",
      defaultField: "product"
    },
    {
      key: "field_2",
      type: "Text",
      label: "最高成交价格带",
      isPrimary: false,
      sourcePath: "cell_info.top_pay_price_bin.index_values.value.value_str",
      defaultField: "field_2"
    }
  ];

  try {
    const configJson = JSON.stringify(updatedConfig);
    const fieldsJson = JSON.stringify(newFieldsSchema);
    
    // 更新 request_config, fields_schema 以及修正真实的 api_path 路径
    const [result] = await pool.query(
      'UPDATE dslp_interfaces SET request_config = ?, fields_schema = ?, api_path = ? WHERE interface_key = ? AND platform = ?',
      [configJson, fieldsJson, '/compass_api/shop/product/product_chance_market/dig_cate_list', '商品_product_chance_market_dig_cate_list', 'douyin']
    );

    console.log(`[Update Success] Affected rows: ${result.affectedRows}`);
  } catch (err) {
    console.error('Error updating opportunity interface:', err);
  } finally {
    await pool.end();
  }
}

main();
