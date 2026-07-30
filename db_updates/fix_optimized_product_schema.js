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

  const config1694 = {
    method: "GET",
    pageSize: 100,
    listPaths: [
      "data.list",
      "data.records",
      "data.items",
      "data.data",
      "data.rank_list",
      "list",
      "records",
      "items",
      "data.product_list" // 新增可能需要的备选列表路径
    ],
    pageParam: "page_no",
    pageStart: 1,
    contentType: "application/json;charset=UTF-8",
    pageSizeParam: "page_size",
    requiredParams: [
      "date_type",
      "end_date"
    ],
    dateRangeMapping: {
      mode: "natural_day",
      format: "slash_datetime_zero",
      endTime: "end_date",
      startTime: "begin_date",
      daysOffset: -2
    }
  };

  const fields1694 = [
    {
      key: "product_id",
      type: "Text",
      label: "商品 ID",
      isPrimary: true,
      sourcePath: "product_base_info.product_id",
      defaultField: "product_id"
    },
    {
      key: "product",
      type: "Text",
      label: "商品信息",
      isPrimary: false,
      sourcePath: "product_base_info.product_name",
      defaultField: "product"
    },
    {
      key: "field",
      type: "Text",
      label: "引流搜索词",
      isPrimary: false,
      sourcePath: "flow_query_list.query",
      defaultField: "field"
    },
    {
      key: "product_1",
      type: "Text",
      label: "商品标签",
      isPrimary: false,
      sourcePath: "product_label_list",
      defaultField: "product_1"
    },
    {
      key: "search_show_uv",
      type: "Number",
      label: "搜索曝光人数",
      isPrimary: false,
      sourcePath: "compare_optimized.my_product.data.index_map.search_prod_prod_show_ucnt.value.value",
      defaultField: "search_show_uv"
    },
    {
      key: "click_uv",
      type: "Number",
      label: "搜索点击人数",
      isPrimary: false,
      sourcePath: "search_index_map.click_ucnt.value.value",
      defaultField: "click_uv"
    },
    {
      key: "pay_uv",
      type: "Number",
      label: "搜索成交人数",
      isPrimary: false,
      sourcePath: "compare_optimized.my_product.data.index_map.search_prod_pay_ucnt.value.value",
      defaultField: "pay_uv"
    },
    {
      key: "show_pay_ratio",
      type: "Percentage",
      label: "曝光成交转化率",
      isPrimary: false,
      sourcePath: "compare_optimized.my_product.data.index_map.search_prod_prod_show_pay_ucnt_ratio.value.value",
      defaultField: "show_pay_ratio"
    }
  ];

  try {
    const [res] = await pool.query(
      'UPDATE dslp_interfaces SET request_config = ?, fields_schema = ? WHERE id = ?',
      [JSON.stringify(config1694), JSON.stringify(fields1694), 1694]
    );
    console.log(`[ID 1694] 商品优化推荐列表 fields_schema 更新成功，影响行数: ${res.affectedRows}`);
  } catch (err) {
    console.error("更新 ID 1694 错误:", err);
  } finally {
    await pool.end();
  }
}

main();
