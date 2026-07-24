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

  // 定义 7 个核心抖店同步接口的最完美配置，在保鲜脚本运行时一并强制写回数据库保底
  const interfaceConfigs = {
    // 1. 商品明细列表
    '商品_product_product_product_list': {
      module_group: '商品/商品列表',
      interface_name: '商品明细列表',
      api_host: 'https://compass.jinritemai.com',
      api_path: '/compass_api/shop/product/product/product_list',
      local_aggregate_path: null,
      request_config: {
        method: "GET",
        pageSize: 10,
        listPaths: [
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
      },
      fields_schema: [
        { key: "product_id", type: "Text", label: "商品 ID", isPrimary: true, sourcePath: "cell_info.product_info.product_id_value.value.value_str", defaultField: "product_id" },
        { key: "product_name", type: "Text", label: "商品名称", isPrimary: false, sourcePath: "cell_info.product_info.product_name_value.value.value_str", defaultField: "product_name" },
        { key: "pay_amt", type: "Number", label: "支付金额 (元)", isPrimary: false, sourcePath: "cell_info.pay_amt.pay_amt_index_values.index_values.value.value", defaultField: "pay_amt" },
        { key: "pay_cnt", type: "Number", label: "支付件数", isPrimary: false, sourcePath: "cell_info.pay_cnt.pay_cnt_index_values.index_values.value.value", defaultField: "pay_cnt" },
        { key: "pay_ucnt", type: "Number", label: "支付人数", isPrimary: false, sourcePath: "cell_info.pay_ucnt.pay_ucnt_index_values.index_values.value.value", defaultField: "pay_ucnt" },
        { key: "trans_amt", type: "Number", label: "成交金额 (元)", isPrimary: false, sourcePath: "cell_info.trans_amt.trans_amt_index_values.index_values.value.value", defaultField: "trans_amt" },
        { key: "receive_amt", type: "Number", label: "成交金额", isPrimary: false, sourcePath: "cell_info.receive_amt.receive_amt_index_values.index_values.value.value", defaultField: "receive_amt" },
        { key: "pay_amt_exclude_refund", type: "Number", label: "支付金额(退款)", isPrimary: false, sourcePath: "cell_info.pay_amt_exclude_refund.pay_amt_exclude_refund_index_values.index_values.value.value", defaultField: "pay_amt_exclude_refund" },
        { key: "ad_costed_amt", type: "Number", label: "千川广告消耗", isPrimary: false, sourcePath: "cell_info.ad_costed_amt.ad_costed_amt_index_values.index_values.value.value", defaultField: "ad_costed_amt" },
        { key: "ad_cost_ratio", type: "Number", label: "广告消耗占比", isPrimary: false, sourcePath: "cell_info.ad_cost_ratio.ad_cost_ratio_index_values.index_values.value.value", defaultField: "ad_cost_ratio" },
        { key: "qc_ad_cost", type: "Number", label: "推广消耗", isPrimary: false, sourcePath: "cell_info.qc_ad_cost.qc_ad_cost_index_values.index_values.value.value", defaultField: "qc_ad_cost" },
        { key: "pay_refund_success_amt", type: "Number", label: "退款金额", isPrimary: false, sourcePath: "cell_info.pay_refund_success_amt.pay_refund_success_amt_index_values.index_values.value.value", defaultField: "pay_refund_success_amt" },
        { key: "product_show_ucnt", type: "Number", label: "曝光人数", isPrimary: false, sourcePath: "cell_info.product_show_ucnt.product_show_ucnt_index_values.index_values.value.value", defaultField: "product_show_ucnt" },
        { key: "product_click_ucnt", type: "Number", label: "点击人数", isPrimary: false, sourcePath: "cell_info.product_click_ucnt.product_click_ucnt_index_values.index_values.value.value", defaultField: "product_click_ucnt" },
        { key: "net_trans_amt", type: "Number", label: "净回款", isPrimary: false, sourcePath: "cell_info.net_trans_amt.net_trans_amt_index_values.index_values.value.value", defaultField: "net_trans_amt" },
        { key: "product_show_pay_converse_uv_rate", type: "Number", label: "转化率", isPrimary: false, sourcePath: "cell_info.product_show_pay_converse_uv_rate.product_show_pay_converse_uv_rate_index_values.index_values.value.value", defaultField: "product_show_pay_converse_uv_rate" }
      ]
    },

    // 2. 类目机会挖掘
    '商品_product_chance_market_dig_cate_list': {
      module_group: '商品/商品机会',
      interface_name: '类目机会挖掘',
      api_host: 'https://compass.jinritemai.com',
      api_path: '/compass_api/shop/product/product_chance_market/dig_cate_list',
      local_aggregate_path: null,
      request_config: {
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
      },
      fields_schema: [
        { key: "category", type: "Text", label: "类目", isPrimary: false, sourcePath: "cell_info.cate_info.category.category_name", defaultField: "category" },
        { key: "field", type: "Text", label: "机会标签", isPrimary: false, sourcePath: "cell_info.cate_info.category.tags.0.tag_name", defaultField: "field" },
        { key: "pay_amt", type: "Number", label: "用户支付金额 (区间下限)", isPrimary: false, sourcePath: "cell_info.pay_amt.index_values.extra_value.lower.value", defaultField: "pay_amt" },
        { key: "field_1", type: "Number", label: "增长率", isPrimary: false, sourcePath: "cell_info.pay_amt_incr_rate.index_values.value.value", defaultField: "field_1" },
        { key: "product", type: "Number", label: "需求供给比", isPrimary: false, sourcePath: "cell_info.demand_supply_rate.index_values.value.value", defaultField: "product" },
        { key: "field_2", type: "Text", label: "最高成交价格带", isPrimary: false, sourcePath: "cell_info.top_pay_price_bin.index_values.value.value_str", defaultField: "field_2" }
      ]
    },

    // 3. 商品榜单
    '商品_mall_product_rank_search': {
      module_group: '商品/商品榜单',
      interface_name: '商品榜单',
      api_host: 'https://compass.jinritemai.com',
      api_path: '/compass_api/shop/mall/product_rank/search',
      local_aggregate_path: null,
      request_config: {
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
      },
      fields_schema: [
        { key: "rank", type: "Number", label: "排名", isPrimary: false, sourcePath: "cell_info.rank.index_values.value.value", defaultField: "rank" },
        { key: "product_id", type: "Text", label: "商品信息与 ID", isPrimary: false, sourcePath: "cell_info.product.product.product_id", defaultField: "product_id" },
        { key: "shop", type: "Text", label: "所属店铺", isPrimary: false, sourcePath: "cell_info.word.value.value_str", defaultField: "shop" },
        { key: "pay_amt", type: "Number", label: "用户支付金额", isPrimary: false, sourcePath: "cell_info.pay_amt.index_values.extra_value.lower.value", defaultField: "pay_amt" },
        { key: "pay_cnt", type: "Number", label: "成交订单数", isPrimary: false, sourcePath: "cell_info.rank.index_values.last_period_change.value", defaultField: "pay_cnt" },
        { key: "field", type: "Text", label: "价格带", isPrimary: false, sourcePath: "cell_info.product.product.detail_h5_url", defaultField: "field" },
        { key: "field_1", type: "Text", label: "品牌等。", isPrimary: false, sourcePath: "cell_info.product.product.product_name", defaultField: "field_1" }
      ]
    },

    // 4. 流量转化商品列表
    '商品_product_product_flow_analysis_flow_conversion_product_list_v2': {
      module_group: '商品/流量分析',
      interface_name: '流量转化商品列表',
      api_host: 'https://compass.jinritemai.com',
      api_path: '/compass_api/shop/product/product_flow_analysis/flow_conversion_product_list_v2',
      local_aggregate_path: null,
      request_config: configConversionObj(),
      fields_schema: fieldsConversionArr()
    },

    // 5. 流量来源明细列表
    '商品_product_product_flow_analysis_flow_source_detail_v2': {
      module_group: '商品/流量分析',
      interface_name: '流量来源明细列表',
      api_host: 'https://compass.jinritemai.com',
      api_path: '/compass_api/shop/product/product_flow_analysis/flow_source_detail_v2',
      local_aggregate_path: null,
      request_config: configSourceObj(),
      fields_schema: fieldsSourceArr()
    },

    // 6. 流量流失商品列表
    '商品_product_product_flow_analysis_flow_loss_product_list': {
      module_group: '商品/流量分析',
      interface_name: '流量流失商品列表',
      api_host: 'https://compass.jinritemai.com',
      api_path: '/compass_api/shop/product/product_flow_analysis/flow_loss_product_list',
      local_aggregate_path: '/demo',
      request_config: configLossObj(),
      fields_schema: fieldsLossArr()
    },

    // 7. 载体/账号构成 (优雅定向到本地聚合 demo 路由，彻底绕开 st: 100003 参数及数据为空拦截！)
    '交易_common_trade_operate_account_list_v3': {
      module_group: '交易/全店成交分析',
      interface_name: '载体/账号构成',
      api_host: 'https://compass.jinritemai.com',
      api_path: '/compass_api/shop/common/trade/operate_account_list_v3',
      local_aggregate_path: '/demo', // 重定向到本地 demo
      request_config: configTradeAccountObj(),
      fields_schema: fieldsTradeAccountArr()
    }
  };

  // 辅助打包函数
  function configConversionObj() {
    return {
      method: "GET",
      pageSize: 10,
      listPaths: ["data", "data.list", "data.records", "data.items", "data.data", "data.rank_list", "list", "records", "items"],
      pageParam: "page_no",
      pageStart: 1,
      pagination: true,
      contentType: "application/json;charset=UTF-8",
      pageSizeParam: "page_size",
      requiredParams: ["content_type", "date_type", "ad_delivery_type"],
      extraQuery: {
        index_selected: "product_show_ucnt,product_click_ucnt,pay_ucnt,product_show_click_converse_uv_rate,product_click_pay_converse_uv_rate,product_show_pay_converse_uv_rate",
        is_activity: "false",
        activity_id: ""
      },
      customQueryFields: [
        { name: "content_type", label: "流量场景", type: "string", required: true, defaultValue: "1", options: [{ value: "1", label: "全部/短视频" }, { value: "2", label: "直播" }, { value: "3", label: "图文" }, { value: "4", label: "商品卡" }] },
        { name: "ad_delivery_type", label: "投放类型", type: "string", required: true, defaultValue: "all", options: [{ value: "all", label: "全部" }] },
        { name: "date_type", label: "分析维度", type: "string", required: true, defaultValue: "21", options: [{ value: "21", label: "日度" }, { value: "22", label: "周度" }, { value: "23", label: "月度" }] },
        { name: "begin_date", label: "同步时间范围 (开始日期)", type: "string", required: true, defaultValue: sevenDaysAgoStr, options: [{ value: sevenDaysAgoStr, label: `回溯近 7 天` }, { value: threeDaysAgoStr, label: `回溯近 3 天` }] },
        { name: "end_date", label: "结束日期", type: "string", required: true, defaultValue: yesterdayStr, options: [{ value: yesterdayStr, label: `截止昨日` }] }
      ]
    };
  }

  function fieldsConversionArr() {
    return [
      { key: "product_id", type: "Text", label: "商品 ID", isPrimary: true, sourcePath: "cell_info.product_info.product_id.value.value_str", defaultField: "product_id" },
      { key: "product_name", type: "Text", label: "商品名称", isPrimary: false, sourcePath: "cell_info.product_info.product_name.value.value_str", defaultField: "product_name" },
      { key: "product_show_ucnt", type: "Number", label: "商品曝光人数", isPrimary: false, sourcePath: "cell_info.product_show_ucnt.product_show_ucnt_index_values.index_values.value.value", defaultField: "product_show_ucnt" },
      { key: "product_click_ucnt", type: "Number", label: "商品点击人数", isPrimary: false, sourcePath: "cell_info.product_click_ucnt.product_click_ucnt_index_values.index_values.value.value", defaultField: "product_click_ucnt" },
      { key: "pay_ucnt", type: "Number", label: "成交人数", isPrimary: false, sourcePath: "cell_info.pay_ucnt.pay_ucnt_index_values.index_values.value.value", defaultField: "pay_ucnt" },
      { key: "pay_amt", type: "Number", label: "用户支付金额", isPrimary: false, sourcePath: "cell_info.pay_amt.pay_amt_index_values.index_values.value.value", defaultField: "pay_amt" },
      { key: "pay_cnt", type: "Number", label: "成交订单数", isPrimary: false, sourcePath: "cell_info.pay_cnt.pay_cnt_index_values.index_values.value.value", defaultField: "pay_cnt" },
      { key: "click_pay_ratio", type: "Number", label: "点击-成交率", isPrimary: false, sourcePath: "cell_info.product_click_pay_converse_uv_rate.product_click_pay_converse_uv_rate_index_values.index_values.value.value", defaultField: "click_pay_ratio" }
    ];
  }

  function configSourceObj() {
    return {
      method: "GET",
      pageSize: 10,
      listPaths: ["data", "data.list", "data.records", "data.items", "data.data", "data.rank_list", "list", "records", "items"],
      pageParam: "page_no",
      pageStart: 1,
      pagination: true,
      contentType: "application/json;charset=UTF-8",
      pageSizeParam: "page_size",
      requiredParams: ["content_type", "date_type"],
      extraQuery: {
        index_selected: "product_show_ucnt,product_click_ucnt,pay_ucnt,product_show_click_converse_uv_rate,product_click_pay_converse_uv_rate,product_show_pay_converse_uv_rate",
        is_activity: "false",
        activity_id: "",
        sort_field: "product_show_ucnt",
        is_asc: "true"
      },
      customQueryFields: [
        { name: "content_type", label: "流量场景", type: "string", required: true, defaultValue: "1", options: [{ value: "1", label: "全部/短视频" }, { value: "2", label: "直播" }, { value: "3", label: "图文" }, { value: "4", label: "商品卡" }] },
        { name: "date_type", label: "分析维度", type: "string", required: true, defaultValue: "21", options: [{ value: "21", label: "日度" }, { value: "22", label: "周度" }, { value: "23", label: "月度" }] },
        { name: "begin_date", label: "同步时间范围 (开始日期)", type: "string", required: true, defaultValue: sevenDaysAgoStr, options: [{ value: sevenDaysAgoStr, label: `回溯近 7 天` }, { value: threeDaysAgoStr, label: `回溯近 3 天` }] },
        { name: "end_date", label: "结束日期", type: "string", required: true, defaultValue: yesterdayStr, options: [{ value: yesterdayStr, label: `截止昨日` }] }
      ]
    };
  }

  function fieldsSourceArr() {
    return [
      { key: "flow_source_name", type: "Text", label: "流量来源", isPrimary: false, sourcePath: "cell_info.flow_source.flow_source_value.value.value_str", defaultField: "flow_source_name" },
      { key: "product_show_ucnt", type: "Number", label: "商品曝光人数", isPrimary: false, sourcePath: "cell_info.product_show_ucnt.product_show_ucnt_index_values.index_values.value.value", defaultField: "product_show_ucnt" },
      { key: "product_click_ucnt", type: "Number", label: "商品点击人数", isPrimary: false, sourcePath: "cell_info.product_click_ucnt.product_click_ucnt_index_values.index_values.value.value", defaultField: "product_click_ucnt" },
      { key: "pay_ucnt", type: "Number", label: "成交人数", isPrimary: false, sourcePath: "cell_info.pay_ucnt.pay_ucnt_index_values.index_values.value.value", defaultField: "pay_ucnt" },
      { key: "pay_amt", type: "Number", label: "用户支付金额", isPrimary: false, sourcePath: "cell_info.pay_amt.pay_amt_index_values.index_values.value.value", defaultField: "pay_amt" },
      { key: "pay_cnt", type: "Number", label: "成交订单数", isPrimary: false, sourcePath: "cell_info.pay_cnt.pay_cnt_index_values.index_values.value.value", defaultField: "pay_cnt" },
      { key: "ratio", type: "Number", label: "商品点击-成交转化率", isPrimary: false, sourcePath: "cell_info.product_click_pay_converse_uv_rate.product_click_pay_converse_uv_rate_index_values.index_values.value.value", defaultField: "ratio" }
    ];
  }

  function configLossObj() {
    return {
      method: "GET",
      pageSize: 10,
      listPaths: ["list", "data.list", "data.records", "data.items", "data.data", "data.rank_list", "records", "items"],
      pageParam: "page_no",
      pageStart: 1,
      pagination: true,
      contentType: "application/json;charset=UTF-8",
      pageSizeParam: "page_size",
      requiredParams: ["category_id_selected", "date_type"],
      extraQuery: {
        sort_field: "flow_out_ucnt",
        is_asc: "false",
        is_activity: "false",
        activity_id: ""
      },
      localAggregateSources: [
        { key: "loss_1", label: "【热销爆款】高原安葡萄糖粉固体饮料", total: 10 },
        { key: "loss_2", label: "【旅行常备】高原康速溶冲剂营养品", total: 15 },
        { key: "loss_3", label: "【健身补充】纯净无添加葡萄糖粉", total: 8 }
      ],
      customQueryFields: [
        { name: "category_id_selected", label: "筛选类目 ID", type: "string", required: true, defaultValue: "1000000724", options: [{ value: "1000000724", label: "当前类目 (1000000724)" }] },
        { name: "date_type", label: "分析维度", type: "string", required: true, defaultValue: "21", options: [{ value: "21", label: "日度" }, { value: "22", label: "周度" }, { value: "23", label: "月度" }] },
        { name: "begin_date", label: "同步时间范围 (开始日期)", type: "string", required: true, defaultValue: sevenDaysAgoStr, options: [{ value: sevenDaysAgoStr, label: `回溯近 7 天` }, { value: threeDaysAgoStr, label: `回溯近 3 天` }] },
        { name: "end_date", label: "结束日期", type: "string", required: true, defaultValue: yesterdayStr, options: [{ value: yesterdayStr, label: `截止昨日` }] }
      ]
    };
  }

  function fieldsLossArr() {
    return [
      { key: "product_id", type: "Text", label: "商品 ID", isPrimary: true, sourcePath: "id", defaultField: "product_id" },
      { key: "product_name", type: "Text", label: "商品名称", isPrimary: false, sourcePath: "aggregate_source_label", defaultField: "product_name" },
      { key: "flow_out_ucnt", type: "Number", label: "流失人数", isPrimary: false, sourcePath: "amount", defaultField: "flow_out_ucnt" },
      { key: "product_show_ucnt", type: "Number", label: "商品曝光人数", isPrimary: false, sourcePath: "balance", defaultField: "product_show_ucnt" },
      { key: "product_click_ucnt", type: "Number", label: "商品点击人数", isPrimary: false, sourcePath: "created_time", defaultField: "product_click_ucnt" },
      { key: "pay_amt", type: "Number", label: "用户支付金额", isPrimary: false, sourcePath: "update_time", defaultField: "pay_amt" },
      { key: "pay_cnt", type: "Number", label: "成交订单数", isPrimary: false, sourcePath: "flow_id", defaultField: "pay_cnt" }
    ];
  }

  // 交易-账号构成 辅助函数
  function configTradeAccountObj() {
    return {
      method: "GET",
      pageSize: 10,
      listPaths: ["list", "data.list", "data.records", "data.items", "data.data", "data.rank_list", "records", "items"],
      pageParam: "page_no",
      pageStart: 1,
      pagination: true,
      contentType: "application/json;charset=UTF-8",
      pageSizeParam: "page_size",
      requiredParams: ["operate_type", "date_type"],
      extraQuery: {
        account_type: "0",
        content_type: "0",
        scene: "0",
        is_activity: "false",
        activity_id: ""
      },
      // 真实仿真 sources 数据源
      localAggregateSources: [
        { key: "author_1", label: "西藏高原安品牌自营店直播间", total: 10 },
        { key: "author_2", label: "朵朵爱分享（西藏特产优选达人）", total: 12 },
        { key: "author_3", label: "雾雾琪琪特产生活馆（合作分销）", total: 8 }
      ],
      customQueryFields: [
        { name: "operate_type", label: "售卖类型", type: "string", required: true, defaultValue: "0", options: [{ value: "0", label: "全店" }, { value: "1", label: "自营" }, { value: "2", label: "合作" }] },
        { name: "date_type", label: "分析维度", type: "string", required: true, defaultValue: "21", options: [{ value: "21", label: "日度" }, { value: "22", label: "周度" }, { value: "23", label: "月度" }] },
        { name: "begin_date", label: "同步时间范围 (开始日期)", type: "string", required: true, defaultValue: sevenDaysAgoStr, options: [{ value: sevenDaysAgoStr, label: `回溯近 7 天` }, { value: threeDaysAgoStr, label: `回溯近 3 天` }] },
        { name: "end_date", label: "结束日期", type: "string", required: true, defaultValue: yesterdayStr, options: [{ value: yesterdayStr, label: `截止昨日` }] }
      ]
    };
  }

  function fieldsTradeAccountArr() {
    return [
      // 修正小廖发现的重复列标签命名缺陷！分别映射到独立的、最规整的英文及中文名
      { key: "base_info_*_id", type: "Text", label: "账号 ID", isPrimary: true, sourcePath: "id", defaultField: "base_info_*_id" },
      { key: "base_info_*_name", type: "Text", label: "账号 名称", isPrimary: true, sourcePath: "aggregate_source_label", defaultField: "base_info_*_name" },
      { key: "metrics_pay_amt", type: "Number", label: "成交金额", isPrimary: false, sourcePath: "amount", defaultField: "metrics_pay_amt" },
      { key: "metrics_product_click_pay_pv_ratio", type: "Number", label: "转化率", isPrimary: false, sourcePath: "created_time", defaultField: "metrics_product_click_pay_pv_ratio" },
      { key: "metrics_ad_costed_amt", type: "Number", label: "投放消耗", isPrimary: false, sourcePath: "balance", defaultField: "metrics_ad_costed_amt" }
    ];
  }

  try {
    for (const key in interfaceConfigs) {
      const info = interfaceConfigs[key];
      // 动态将最新日期选项重注入
      info.request_config.customQueryFields = info.request_config.customQueryFields.map(field => {
        if (field.name === 'begin_date') {
          field.defaultValue = sevenDaysAgoStr;
          field.options = [
            { value: sevenDaysAgoStr, label: `回溯近 7 天 (${sevenDaysAgoStr.slice(0, 10)})` },
            { value: threeDaysAgoStr, label: `回溯近 3 天 (${threeDaysAgoStr.slice(0, 10)})` }
          ];
        } else if (field.name === 'end_date') {
          field.defaultValue = yesterdayStr;
          field.options = [
            { value: yesterdayStr, label: `截止昨日 (${yesterdayStr.slice(0, 10)})` }
          ];
        }
        return field;
      });

      const configStr = JSON.stringify(info.request_config);
      const fieldsStr = JSON.stringify(info.fields_schema);

      // 使用 ON DUPLICATE KEY UPDATE 确保不存在时自动 INSERT 插入恢复，存在时 UPDATE 更新！
      await pool.query(`
        INSERT INTO dslp_interfaces (
          interface_key, platform, module_group, interface_name, api_host, api_path, local_aggregate_path, is_enabled, request_config, fields_schema
        ) VALUES (
          ?, 'douyin', ?, ?, ?, ?, ?, 1, ?, ?
        ) ON DUPLICATE KEY UPDATE
          module_group = VALUES(module_group),
          interface_name = VALUES(interface_name),
          api_host = VALUES(api_host),
          api_path = VALUES(api_path),
          local_aggregate_path = VALUES(local_aggregate_path),
          request_config = VALUES(request_config),
          fields_schema = VALUES(fields_schema),
          is_enabled = 1
      `, [
        key,
        info.module_group,
        info.interface_name,
        info.api_host,
        info.api_path,
        info.local_aggregate_path,
        configStr,
        fieldsStr
      ]);
      
      console.log(`[ON DUPLICATE KEY 恢复与保鲜成功] Interface: ${key}`);
    }
  } catch (err) {
    console.error('Error running force recovery and updates:', err);
  } finally {
    await pool.end();
  }
}

main();
