/**
 * JSDoc 文档注释
 * @module DoudianLocalAggregate
 */

const express = require('express');
const { runDoudianAggregate } = require('./doudian_aggregate_runner.js');

const doudianLocalAggregateRouter = express.Router();

/**
 * 功能描述：本地聚合接口 demo。
 * 数据库 local_aggregate_path 可配置为：
 * /demo
 */
doudianLocalAggregateRouter.post('/demo', handleDemoAggregateRequest);

/**
 * 功能描述：账户流水聚合接口 demo。后续 queryAccountFlows 三种参数聚合逻辑就在这个方法里替换。
 * 数据库 local_aggregate_path 可配置为：
 * /account-flows
 */
doudianLocalAggregateRouter.post('/account-flows', handleAccountFlowsAggregateRequest);

/**
 * 品牌资质列表
 * https://fxg.jinritemai.com/center/qualification/brand/list
 * brand_status
 * 0 生效中
 * 4 即将失效
 * 3 已失效
 * 1 审核中
 * 2 审核不通过
 *
 * 数据库 local_aggregate_path 可配置为：
 * /local/center/qualification/brand/list
 */
doudianLocalAggregateRouter.post('/local/center/qualification/brand/list', handleBrandQualificationBrandListAggregateRequest);

/**
 * 功能描述：处理本地聚合 demo 请求。
 * @param {object} req Express 请求
 * @param {object} res Express 响应
 */
async function handleDemoAggregateRequest(req, res) {
  await sendAggregateResponse(res, () => handleDemoAggregate(req.body));
}

/**
 * 功能描述：处理账户流水本地聚合请求，目前先复用 demo 聚合游标逻辑。
 * @param {object} req Express 请求
 * @param {object} res Express 响应
 */
async function handleAccountFlowsAggregateRequest(req, res) {
  await sendAggregateResponse(res, () => handleDemoAggregate(req.body));
}

/**
 * 功能描述：处理品牌资质列表本地聚合请求，按 brand_status 五种状态依次分页调用真实抖店接口。
 * @param {object} req Express 请求
 * @param {object} res Express 响应
 */
async function handleBrandQualificationBrandListAggregateRequest(req, res) {
  await sendAggregateResponse(res, () => runDoudianAggregate(req, {
    tokenPrefix: 'brand',
    apiPath: 'https://fxg.jinritemai.com/center/qualification/brand/list',
    method: 'GET',
    pageParam: 'page',
    pageSizeParam: 'size',
    pageStart: 0,
    defaultPageSize: 100,
    defaultApiPageSize: 100,
    maxApiPageSize: 200,
    minDelayMs: 1500,
    maxDelayMs: 3000,
    // 自定义备注
    // baseParams: {
    //   req_source: 'dou_dian_pc',
    //   qualification_type: 1
    // },
    listPaths: [
      'data.list',
      'data.brand_list',
      'data.brand_qual_list',
      'data.qualification_list',
      'data.data',
      'list'
    ],
    sources: [
      { key: 'brand_status_0', label: '生效中', params: { brand_status: 0 } },
      { key: 'brand_status_4', label: '即将失效', params: { brand_status: 4 } },
      { key: 'brand_status_3', label: '已失效', params: { brand_status: 3 } },
      { key: 'brand_status_1', label: '审核中', params: { brand_status: 1 } },
      { key: 'brand_status_2', label: '审核不通过', params: { brand_status: 2 } }
    ],
    decorateItem(item, source) {
      return {
        ...item,
        brand_status: source.params.brand_status,
        brand_status_label: source.label
      };
    }
  }));
}

/**
 * 功能描述：统一包装聚合接口响应格式。
 * @param {object} res Express 响应
 * @param {Function} loader 聚合数据加载函数
 */
async function sendAggregateResponse(res, loader) {
  try {
    const data = await loader();
    res.status(200).json({
      code: 0,
      message: '本地聚合接口调用成功',
      data
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: `本地聚合接口调用失败: ${error.message}`
    });
  }
}

/**
 * 功能描述：本地聚合接口 demo。它模拟“一个飞书分页请求内，跨多个子接口/参数组继续取数”的游标推进。
 * 飞书只认识 /api/records 的 pageToken；这里把 pageToken 当 aggregatePageToken 接收，并返回新的 nextPageToken。
 * @param {object} body 聚合请求体
 * @return {object} 返回聚合后的列表与下一次游标
 */
async function handleDemoAggregate(body = {}) {
  const pageSize = clampNumber(body.pageSize || body.maxPageSize, 1, 1000, 100);
  const sources = normalizeAggregateSources(body);
  let cursor = parseAggregateToken(body.aggregatePageToken);
  const list = [];
  const total = sources.reduce((sum, source) => sum + source.total, 0);

  if (cursor.sourceIndex >= sources.length) {
    cursor = { sourceIndex: 0, offset: 0, loaded: 0 };
  }

  while (cursor.sourceIndex < sources.length && list.length < pageSize) {
    const source = sources[cursor.sourceIndex];
    const remaining = Math.max(0, source.total - cursor.offset);

    if (remaining <= 0) {
      cursor.sourceIndex += 1;
      cursor.offset = 0;
      continue;
    }

    const take = Math.min(pageSize - list.length, remaining);
    for (let index = 0; index < take; index += 1) {
      list.push(buildDemoAggregateRecord(source, cursor.offset + index, body));
    }

    cursor.offset += take;
    cursor.loaded += take;

    if (cursor.offset >= source.total) {
      cursor.sourceIndex += 1;
      cursor.offset = 0;
    }
  }

  while (cursor.sourceIndex < sources.length && sources[cursor.sourceIndex].total <= cursor.offset) {
    cursor.sourceIndex += 1;
    cursor.offset = 0;
  }

  const hasMore = cursor.sourceIndex < sources.length;
  return {
    list,
    total,
    pageSize,
    loadedCount: cursor.loaded,
    hasMore,
    nextPageToken: hasMore ? buildAggregateToken(cursor) : '',
    sources: sources.map((source) => ({
      key: source.key,
      label: source.label,
      total: source.total
    }))
  };
}

/**
 * 功能描述：聚合来源归一化。正式实现时可以把 sources 换成真实的三组抖店参数。
 * @param {object} body 聚合请求体
 * @return {Array<object>} 返回来源列表
 */
function normalizeAggregateSources(body = {}) {
  const configuredSources = Array.isArray(body.sources)
    ? body.sources
    : Array.isArray(body.aggregateSources)
      ? body.aggregateSources
      : [];

  const sources = configuredSources.length > 0 ? configuredSources : [
    {
      key: 'alliance_pay',
      label: '聚合支付',
      total: 7,
      params: { uid_type: 1, member_type: 1 }
    },
    {
      key: 'wechat_pay',
      label: '微信支付',
      total: 4,
      params: { uid_type: 2, member_type: 2 }
    },
    {
      key: 'douyin_pay',
      label: '抖音支付',
      total: 0,
      params: { uid_type: 3, member_type: 3 }
    }
  ];

  return sources.map((source, index) => ({
    key: String(source.key || source.name || `source_${index + 1}`),
    label: String(source.label || source.name || source.key || `来源 ${index + 1}`),
    total: clampNumber(source.total ?? source.mockTotal ?? source.mock_total, 0, 100000, 0),
    params: source.params && typeof source.params === 'object' ? source.params : {}
  }));
}

/**
 * 功能描述：生成一条 demo 聚合记录，字段保持扁平，便于当前通用字段 schema 映射。
 * @param {object} source 当前来源
 * @param {number} offset 来源内偏移
 * @param {object} body 请求体
 * @return {object} 返回模拟记录
 */
function buildDemoAggregateRecord(source, offset, body = {}) {
  const sequence = offset + 1;
  const now = Date.now() - sequence * 60000;
  return {
    id: `${source.key}_${String(sequence).padStart(6, '0')}`,
    flow_id: `${source.key}_${String(sequence).padStart(6, '0')}`,
    aggregate_source_key: source.key,
    aggregate_source_label: source.label,
    aggregate_params: source.params,
    source_api_host: body.sourceApiHost || '',
    source_api_path: body.sourceApiPath || '',
    shop_id: body.shopId || '',
    amount: Number((100 + sequence / 10).toFixed(2)),
    balance: Number((10000 - sequence).toFixed(2)),
    created_time: now,
    update_time: now,
    raw_json: JSON.stringify({
      source: source.key,
      offset,
      requestParams: body.params || {}
    })
  };
}

/**
 * 功能描述：解析飞书透传的聚合分页 token，格式需满足飞书只允许英文数字下划线且不超过 100 字符。
 * @param {string} token 聚合 token
 * @return {object} 返回游标
 */
function parseAggregateToken(token) {
  if (!token) return { sourceIndex: 0, offset: 0, loaded: 0 };
  const match = String(token).match(/^agg_(\d+)_(\d+)_(\d+)$/);
  if (!match) return { sourceIndex: 0, offset: 0, loaded: 0 };
  return {
    sourceIndex: Number(match[1]),
    offset: Number(match[2]),
    loaded: Number(match[3])
  };
}

/**
 * 功能描述：构造下一次飞书 /api/records 请求会带回来的聚合 token。
 * @param {object} cursor 当前游标
 * @return {string} 返回 token
 */
function buildAggregateToken(cursor) {
  return `agg_${cursor.sourceIndex}_${cursor.offset}_${cursor.loaded}`;
}

/**
 * 功能描述：把数字限制到指定范围。
 * @param {unknown} value 原始值
 * @param {number} min 最小值
 * @param {number} max 最大值
 * @param {number} fallback 兜底值
 * @return {number} 返回安全数字
 */
function clampNumber(value, min, max, fallback) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numberValue)));
}

module.exports = {
  doudianLocalAggregateRouter
};
