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
    // 1. 定义 1644 接口的 request_config
    const requestConfig = {
      method: "GET",
      pageSize: 10,
      listPaths: [
        "data"
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
        is_asc: "false",
        sort_field: ""
      },
      customQueryFields: [
        {
          name: "_lid",
          type: "string",
          label: "风控 _lid (若失效请抓包填入)",
          required: false,
          defaultValue: "975550118120"
        },
        {
          name: "msToken",
          type: "string",
          label: "风控 msToken (若失效请抓包填入)",
          required: false,
          defaultValue: "1nECkBIvXN9-yKKBBhVGi46BEMxb2JdMjNIM-Nk-zD-igVMJbCvnCCa5gaYSqT96MuHmPCJNGJ3KWiWiLy_RvKryGeBrgznhAJR6k3Na3viEdpnugJus0X3CU_wbJ93Yh5fNz0Z5xbyli6WD3hes4w6UOjYfWACB4h4lDnvX3FnB9Y6gVzjwOqo="
        },
        {
          name: "a_bogus",
          type: "string",
          label: "风控 a_bogus (若失效请抓包填入)",
          required: false,
          defaultValue: "O60VgtX7dxRnCplSuOQZtlrUOexArsWyyaT2bTnNSoPCPHtcI--WAnCUnxwQ0MHVVuBEpKZ7adslTjxc8GisZZckumkvSiwjytdInUfL8Hksa-JhI3jgCJGEwk-c8/GO/5VaipiX6zUq1IQvNN9BA1OyeCtnBWR0sHr6dn4U9x256GkY1o2YSKy="
        }
      ]
    };

    // 2. 定义 1644 接口的 fields_schema 映射
    const fieldsSchema = [
      {
        key: "customer_id",
        type: "Text",
        label: "客服 ID",
        isPrimary: true,
        sourcePath: "cell_info.customer_id.customer_id_value.value.value_str",
        defaultField: "customer_id"
      },
      {
        key: "customer_name",
        type: "Text",
        label: "客服名称",
        isPrimary: false,
        sourcePath: "cell_info.customer_name.customer_name_value.value.value_str",
        defaultField: "customer_name"
      },
      {
        key: "avg_reply_dur",
        type: "Number",
        label: "平均回复时长 (秒)",
        isPrimary: false,
        sourcePath: "cell_info.avg_reply_dur.avg_reply_dur_value.value.value",
        defaultField: "avg_reply_dur"
      },
      {
        key: "manual_conv_cnt",
        type: "Number",
        label: "人工接待会话数",
        isPrimary: false,
        sourcePath: "cell_info.manual_conv_cnt.manual_conv_cnt_value.value.value",
        defaultField: "manual_conv_cnt"
      },
      {
        key: "online_days",
        type: "Number",
        label: "在线天数",
        isPrimary: false,
        sourcePath: "cell_info.online_days.online_days_value.value.value",
        defaultField: "online_days"
      },
      {
        key: "un_serv_conv_cnt",
        type: "Number",
        label: "未服务会话数",
        isPrimary: false,
        sourcePath: "cell_info.un_serv_conv_cnt.un_serv_conv_cnt_value.value.value",
        defaultField: "un_serv_conv_cnt"
      },
      {
        key: "unsatisfied_convcmnt_cnt",
        type: "Number",
        label: "不满意评价数",
        isPrimary: false,
        sourcePath: "cell_info.unsatisfied_convcmnt_cnt.unsatisfied_convcmnt_cnt_value.value.value",
        defaultField: "unsatisfied_convcmnt_cnt"
      },
      {
        key: "unsatisfied_convcmnt_rate",
        type: "Percentage",
        label: "不满意评价率",
        isPrimary: false,
        sourcePath: "cell_info.unsatisfied_convcmnt_rate.unsatisfied_convcmnt_rate_value.value.value",
        defaultField: "unsatisfied_convcmnt_rate"
      },
      {
        key: "valid_convcmnt_cnt",
        type: "Number",
        label: "有效评价数",
        isPrimary: false,
        sourcePath: "cell_info.valid_convcmnt_cnt.valid_convcmnt_cnt_value.value.value",
        defaultField: "valid_convcmnt_cnt"
      },
      {
        key: "unsatisfied_cmnt_cate1_convcmnt_cnt",
        type: "Number",
        label: "不满意原因1会话数",
        isPrimary: false,
        sourcePath: "cell_info.unsatisfied_cmnt_cate1_convcmnt_cnt.unsatisfied_cmnt_cate1_convcmnt_cnt_value.value.value",
        defaultField: "unsatisfied_cmnt_cate1_convcmnt_cnt"
      },
      {
        key: "unsatisfied_cmnt_cate2_convcmnt_cnt",
        type: "Number",
        label: "不满意原因2会话数",
        isPrimary: false,
        sourcePath: "cell_info.unsatisfied_cmnt_cate2_convcmnt_cnt.unsatisfied_cmnt_cate2_convcmnt_cnt_value.value.value",
        defaultField: "unsatisfied_cmnt_cate2_convcmnt_cnt"
      },
      {
        key: "unsatisfied_cmnt_cate3_convcmnt_cnt",
        type: "Number",
        label: "不满意原因3会话数",
        isPrimary: false,
        sourcePath: "cell_info.unsatisfied_cmnt_cate3_convcmnt_cnt.unsatisfied_cmnt_cate3_convcmnt_cnt_value.value.value",
        defaultField: "unsatisfied_cmnt_cate3_convcmnt_cnt"
      },
      {
        key: "unsatisfied_cmnt_cate4_convcmnt_cnt",
        type: "Number",
        label: "不满意原因4会话数",
        isPrimary: false,
        sourcePath: "cell_info.unsatisfied_cmnt_cate4_convcmnt_cnt.unsatisfied_cmnt_cate4_convcmnt_cnt_value.value.value",
        defaultField: "unsatisfied_cmnt_cate4_convcmnt_cnt"
      },
      {
        key: "unsatisfied_cmnt_cate5_convcmnt_cnt",
        type: "Number",
        label: "不满意原因5会话数",
        isPrimary: false,
        sourcePath: "cell_info.unsatisfied_cmnt_cate5_convcmnt_cnt.unsatisfied_cmnt_cate5_convcmnt_cnt_value.value.value",
        defaultField: "unsatisfied_cmnt_cate5_convcmnt_cnt"
      },
      {
        key: "unsatisfied_cmnt_cate6_convcmnt_cnt",
        type: "Number",
        label: "不满意原因6会话数",
        isPrimary: false,
        sourcePath: "cell_info.unsatisfied_cmnt_cate6_convcmnt_cnt.unsatisfied_cmnt_cate6_convcmnt_cnt_value.value.value",
        defaultField: "unsatisfied_cmnt_cate6_convcmnt_cnt"
      },
      {
        key: "unsatisfied_cmnt_cate7_convcmnt_cnt",
        type: "Number",
        label: "不满意原因7会话数",
        isPrimary: false,
        sourcePath: "cell_info.unsatisfied_cmnt_cate7_convcmnt_cnt.unsatisfied_cmnt_cate7_convcmnt_cnt_value.value.value",
        defaultField: "unsatisfied_cmnt_cate7_convcmnt_cnt"
      }
    ];

    // 3. 执行更新
    await pool.query(
      'UPDATE dslp_interfaces SET request_config = ?, fields_schema = ? WHERE id = 1644',
      [JSON.stringify(requestConfig), JSON.stringify(fieldsSchema)]
    );
    console.log("成功升级 1644 客服明细列表接口！配置及 schema 完美写入！");

  } catch (e) {
    console.error("更新 1644 失败:", e);
  } finally {
    await pool.end();
  }
}

main();
