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
    // 1. 定义 1709 接口的正确 request_config
    const requestConfig = {
      method: "GET",
      pageSize: 10,
      listPaths: [
        "data.module_data.core_data_0.compass_general_table_value.data"
      ],
      pageParam: "page_no",
      pageStart: 1,
      pagination: true,
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
        daysOffset: -1
      },
      extraQuery: {
        activity_id: "",
        account_type: "2",
        author_id: "",
        range_type: "0",
        cart_type: "1",
        ad_type: "0",
        index_selected: "watch_cnt,pay_amt,refund_amt,live_pay_amt,search_pay_amt,lead_shop_pay_amt",
        sort_field: ""
      },
      customQueryFields: [
        {
          name: "_lid",
          type: "string",
          label: "风控 _lid (若失效请抓包填入)",
          required: false,
          defaultValue: "960903104903"
        },
        {
          name: "msToken",
          type: "string",
          label: "风控 msToken (若失效请抓包填入)",
          required: false,
          defaultValue: "kGn0QoefLTCJEmBEv1Ap-jPerf75FR2WqIS7njzdpiEgni-PV9ul4uKqxFcjYnsaYnOvDpbEpk6sGPpekrscrMs0ziviiYfyLx-EMeJKwTLica_jbIImTG9Vm86Pp6tl_nKbZT6-Tbbp-kzdBdIAA_1CYJ_XZ4jCNgMYn7QKcCtYJ_ZF1u4SeJ0="
        },
        {
          name: "a_bogus",
          type: "string",
          label: "风控 a_bogus (若失效请抓包填入)",
          required: false,
          defaultValue: "xJUfkeUjYZRVO3Ct8CQqt4AUB2E/rBSyElTxSHaNyoFIP70OuF36crCZjxzBaWeRISBmpF5HrdM/YDVbYzisZ2npumhDSBvy6TdnnW0LZHhsPakhn3jgCbGxuk4O8/GO//VlipiXAzl91ycvqHCpAIFytCexBCY0sHrbdnUlexg-6GJYVnQCeagy"
        }
      ]
    };

    // 2. 定义 1709 接口的正确 fields_schema 映射
    const fieldsSchema = [
      {
        key: "video_id",
        type: "Text",
        label: "视频 ID",
        isPrimary: true,
        sourcePath: "cell_info.video.video.video_id",
        defaultField: "video_id"
      },
      {
        key: "video_title",
        type: "Text",
        label: "视频标题",
        isPrimary: false,
        sourcePath: "cell_info.video.video.video_title",
        defaultField: "video_title"
      },
      {
        key: "video_url",
        type: "Text",
        label: "视频 URL",
        isPrimary: false,
        sourcePath: "cell_info.video.video.video_url",
        defaultField: "video_url"
      },
      {
        key: "author_name",
        type: "Text",
        label: "作者昵称",
        isPrimary: false,
        sourcePath: "cell_info.video.video.author.nick_name",
        defaultField: "author_name"
      },
      {
        key: "author_fans",
        type: "Number",
        label: "作者粉丝数",
        isPrimary: false,
        sourcePath: "cell_info.video.video.author.fans_cnt",
        defaultField: "author_fans"
      },
      {
        key: "publish_time",
        type: "DateTime",
        label: "发布时间",
        isPrimary: false,
        sourcePath: "cell_info.publish_ts.index_values.value.value",
        formatType: "timestamp",
        defaultField: "publish_time"
      },
      {
        key: "watch_cnt",
        type: "Number",
        label: "视频观看次数",
        isPrimary: false,
        sourcePath: "cell_info.watch_cnt.index_values.value.value",
        defaultField: "watch_cnt"
      },
      {
        key: "pay_amt",
        type: "Text",
        label: "用户支付金额",
        isPrimary: false,
        sourcePath: "cell_info.pay_amt.index_values.value.value",
        formatType: "price",
        defaultField: "pay_amt"
      },
      {
        key: "refund_amt",
        type: "Text",
        label: "退款金额",
        isPrimary: false,
        sourcePath: "cell_info.refund_amt.index_values.value.value",
        formatType: "price",
        defaultField: "refund_amt"
      },
      {
        key: "live_pay_amt",
        type: "Text",
        label: "引流直播间支付金额",
        isPrimary: false,
        sourcePath: "cell_info.live_pay_amt.index_values.value.value",
        formatType: "price",
        defaultField: "live_pay_amt"
      },
      {
        key: "search_pay_amt",
        type: "Text",
        label: "看后搜支付金额",
        isPrimary: false,
        sourcePath: "cell_info.search_pay_amt.index_values.value.value",
        formatType: "price",
        defaultField: "search_pay_amt"
      },
      {
        key: "lead_shop_pay_amt",
        type: "Text",
        label: "引流店铺页支付金额",
        isPrimary: false,
        sourcePath: "cell_info.lead_shop_pay_amt.index_values.value.value",
        formatType: "price",
        defaultField: "lead_shop_pay_amt"
      },
      {
        key: "product_id",
        type: "Text",
        label: "带货商品 ID",
        isPrimary: false,
        sourcePath: "cell_info.product.product.product_id",
        defaultField: "product_id"
      },
      {
        key: "product_name",
        type: "Text",
        label: "带货商品名称",
        isPrimary: false,
        sourcePath: "cell_info.product.product.product_name",
        defaultField: "product_name"
      },
      {
        key: "product_price",
        type: "Text",
        label: "带货商品售价",
        isPrimary: false,
        sourcePath: "cell_info.product.product.sale_price",
        formatType: "price",
        defaultField: "product_price"
      }
    ];

    // 3. 执行更新
    await pool.query(
      'UPDATE dslp_interfaces SET request_config = ?, fields_schema = ? WHERE id = 1709',
      [JSON.stringify(requestConfig), JSON.stringify(fieldsSchema)]
    );
    console.log("成功升级 1709 短视频概览/合作视频明细列表接口！配置及 schema 完美写入！");

  } catch (e) {
    console.error("更新 1709 失败:", e);
  } finally {
    await pool.end();
  }
}

main();
