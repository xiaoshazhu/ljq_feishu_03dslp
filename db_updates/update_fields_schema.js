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

  // 精心构造的 15 个字段映射配置，全部更正为 cell_info.xxxx 点分嵌套路径
  const newFieldsSchema = [
    {
      key: "product_id",
      type: "Text",
      label: "商品信息与 ID",
      isPrimary: false,
      sourcePath: "cell_info.product_info.product_id_value.value.value_str",
      defaultField: "product_id"
    },
    {
      key: "refund_pay_amt",
      type: "Number",
      label: "退款后用户支付金额",
      isPrimary: false,
      sourcePath: "cell_info.net_trans_amt.net_trans_amt_index_values.index_values.value.value",
      defaultField: "refund_pay_amt"
    },
    {
      key: "field",
      type: "Text",
      label: "含波动拆解入口",
      isPrimary: false,
      sourcePath: "cell_info.fluctuation_analysis.fluctuation_analysis_index_values.index_values.value.value_str",
      defaultField: "field"
    },
    {
      key: "amt",
      type: "Number",
      label: "结算金额",
      isPrimary: false,
      sourcePath: "cell_info.receive_amt.receive_amt_index_values.index_values.value.value",
      defaultField: "amt"
    },
    {
      key: "pay_amt",
      type: "Number",
      label: "成交金额",
      isPrimary: false,
      sourcePath: "cell_info.pay_amt.pay_amt_index_values.index_values.value.value",
      defaultField: "pay_amt"
    },
    {
      key: "pay_amt_1",
      type: "Number",
      label: "用户支付金额",
      isPrimary: false,
      sourcePath: "cell_info.pay_amt_exclude_refund.pay_amt_exclude_refund_index_values.index_values.value.value",
      defaultField: "pay_amt_1"
    },
    {
      key: "pay_cnt",
      type: "Number",
      label: "成交订单数",
      isPrimary: false,
      sourcePath: "cell_info.pay_cnt.pay_cnt_index_values.index_values.value.value",
      defaultField: "pay_cnt"
    },
    {
      key: "cost",
      type: "Number",
      label: "投放消耗",
      isPrimary: false,
      sourcePath: "cell_info.ad_costed_amt.ad_costed_amt_index_values.index_values.value.value",
      defaultField: "cost"
    },
    {
      key: "field_1",
      type: "Number",
      label: "费比",
      isPrimary: false,
      sourcePath: "cell_info.ad_cost_ratio.ad_cost_ratio_index_values.index_values.value.value",
      defaultField: "field_1"
    },
    {
      key: "refund_amt",
      type: "Number",
      label: "退款金额",
      isPrimary: false,
      sourcePath: "cell_info.pay_refund_success_amt.pay_refund_success_amt_index_values.index_values.value.value",
      defaultField: "refund_amt"
    },
    {
      key: "product_show",
      type: "Text",
      label: "商品曝光",
      isPrimary: false,
      sourcePath: "cell_info.product_show_ucnt.product_show_ucnt_index_values.index_values.value.value",
      defaultField: "product_show"
    },
    {
      key: "click_uv",
      type: "Number",
      label: "点击人数",
      isPrimary: false,
      sourcePath: "cell_info.product_click_ucnt.product_click_ucnt_index_values.index_values.value.value",
      defaultField: "click_uv"
    },
    {
      key: "pay_uv",
      type: "Number",
      label: "成交人数",
      isPrimary: false,
      sourcePath: "cell_info.pay_ucnt.pay_ucnt_index_values.index_values.value.value",
      defaultField: "pay_uv"
    },
    {
      key: "pay_amt_2",
      type: "Number",
      label: "净成交金额",
      isPrimary: false,
      sourcePath: "cell_info.net_trans_amt.net_trans_amt_index_values.index_values.value.value",
      defaultField: "pay_amt_2"
    },
    {
      key: "show_pay",
      type: "Number",
      label: "曝光支付率。",
      isPrimary: false,
      sourcePath: "cell_info.product_show_pay_converse_uv_rate.product_show_pay_converse_uv_rate_index_values.index_values.value.value",
      defaultField: "show_pay"
    }
  ];

  try {
    const fieldsSchemaJson = JSON.stringify(newFieldsSchema);
    const [result] = await pool.query(
      'UPDATE dslp_interfaces SET fields_schema = ? WHERE interface_key = ? AND platform = ?',
      [fieldsSchemaJson, '商品_product_product_product_list', 'douyin']
    );

    console.log(`[Fields Update Success] Rows affected: ${result.affectedRows}`);
  } catch (err) {
    console.error('Error updating fields_schema:', err);
  } finally {
    await pool.end();
  }
}

main();
