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
      "data.module_data.search_product_rank.compass_general_table_value.data",
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
      "operate_type",
      "account_type",
      "scene",
      "date_type"
    ],
    customQueryFields: [
      {
        name: "operate_type",
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
        name: "account_type",
        label: "账号类型",
        type: "string",
        required: true,
        defaultValue: "1",
        options: [
          { value: "1", label: "全部账号" },
          { value: "2", label: "自营账号" },
          { value: "3", label: "合作达人" }
        ]
      },
      {
        name: "scene",
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
      key: "rank",
      type: "Number",
      label: "排名",
      isPrimary: false,
      sourcePath: "cell_info.rank.index_values.value.value",
      defaultField: "rank"
    },
    {
      key: "product_id",
      type: "Text",
      label: "商品 ID",
      isPrimary: false,
      sourcePath: "cell_info.product.product.product_id",
      defaultField: "product_id"
    },
    {
      key: "shop",
      type: "Text",
      label: "关联词",
      isPrimary: false,
      sourcePath: "cell_info.word.value.value_str",
      defaultField: "shop"
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
      key: "pay_cnt",
      type: "Number",
      label: "名次变动",
      isPrimary: false,
      sourcePath: "cell_info.rank.index_values.last_period_change.value",
      defaultField: "pay_cnt"
    },
    {
      key: "field",
      type: "Text",
      label: "商品链接",
      isPrimary: false,
      sourcePath: "cell_info.product.product.detail_h5_url",
      defaultField: "field"
    },
    {
      key: "field_1",
      type: "Text",
      label: "商品名称",
      isPrimary: false,
      sourcePath: "cell_info.product.product.product_name",
      defaultField: "field_1"
    }
  ];

  try {
    const configJson = JSON.stringify(updatedConfig);
    const fieldsJson = JSON.stringify(newFieldsSchema);
    const [result] = await pool.query(
      'UPDATE dslp_interfaces SET request_config = ?, fields_schema = ? WHERE interface_key = ? AND platform = ?',
      [configJson, fieldsJson, '商品_mall_product_rank_search', 'douyin']
    );

    console.log(`[Update Success] Affected rows: ${result.affectedRows}`);
  } catch (err) {
    console.error('Error updating rank interface:', err);
  } finally {
    await pool.end();
  }
}

main();
