/**
 * JSDoc 文档注释
 * @module DoudianLocalAggregate
 */

const express = require('express');
const { runDoudianAggregate } = require('./doudian_aggregate_runner.js');
const { decryptCredential } = require('./credential_cipher.js');
const {
  fetchTextWithTimeout,
  getRemainingTimeoutMs
} = require('./http_client.js');

const doudianLocalAggregateRouter = express.Router();

/**
 * 功能描述：本地聚合接口 demo。
 * 数据库 local_aggregate_path 可配置为：
 * /demo
 */
doudianLocalAggregateRouter.post('/demo', handleDemoAggregateRequest);

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
 * 功能描述：账户流水聚合接口 demo。后续 queryAccountFlows 三种参数聚合逻辑就在这个方法里替换。
 * 数据库 local_aggregate_path 可配置为：
 * member_type、merchant_uid、uid_type、都需要从 https://fxg.jinritemai.com/account/center/getAccountList?req_source=dou_dian_pc的配置里拿到
 */
doudianLocalAggregateRouter.post('/local/settlement/account/queryAccountFlows', handleAccountFlowsAggregateRequest);

/**
 * 本地聚合接口  因为需要调用前置接口 https://fxg.jinritemai.com/api/ecomfinance/subject/list 拿到
 * {
 *    "ret_code": "0000",
 *    "ret_message": "查询成功",
 *    "ret_data": {
 *        "subject_list": [
 *            {
 *                "CreditCode": "91540000710914616Q",
 *                "CompanyName": "西藏高原安生物科技开发有限公司",
 *                "ExpireTimeUnix": 0,
 *                "IsNewSubject": true,
 *                "HasPendingPlatformInvoiceBill": false,
 *                "HasPendingMerchantInvoiceBill": true
 *            }
 *        ]
 *    },
 *    "BaseResp": {
 *        "StatusMessage": "",
 *        "StatusCode": 0
 *    }
 * } 里的CreditCode 然后当作参数发送过去 credit_code
 */
doudianLocalAggregateRouter.post('/local/api/ecomfinance/platform/invoice/record/list', handlePlatformInvoiceRecordAggregateRequest);

/**
 * 商品成长优化+新潮新品专项成长
 * /local/api/business_product/strategy/query_product_page_v2
 * scene 6   scene2
 */
doudianLocalAggregateRouter.post('/local/api/business_product/strategy/query_product_page_v2', handleQueryProductStrategyV2);

/**
 * 购买类目分析列表 本地聚合接口
 */
doudianLocalAggregateRouter.post('/local/commop/business_chance_center/user_select/cate_trade', handleCateTradeAggregateRequest);

/**
 * 功能描述：处理本地聚合 demo 请求。
 * @param {object} req Express 请求
 * @param {object} res Express 响应
 */
async function handleDemoAggregateRequest(req, res) {
  await sendAggregateResponse(res, () => handleDemoAggregate(req.body));
}

/**
 * 功能描述：处理余额明细  （聚合、微信、抖音）
 * @param {object} req Express 请求
 * @param {object} res Express 响应
 * member_type、merchant_uid、uid_type、都需要从 https://fxg.jinritemai.com/account/center/getAccountList?req_source=dou_dian_pc的配置里拿到
 * https://fxg.jinritemai.com/account/center/getAccountList?req_source=dou_dian_pc 里放在 data.account_list
 *
 *
 */
async function handleAccountFlowsAggregateRequest(req, res) {
  await sendAggregateResponse(res, async () => {
    const accountSources = await loadAccountFlowsAggregateSources(req);
    console.log('[AccountFlows Aggregate Sources]', {
      sourceCount: accountSources.length
    });
    return runDoudianAggregate(req, {
      tokenPrefix: 'accountflows',
      apiPath: 'https://fxg.jinritemai.com/settlement/account/queryAccountFlows?req_source=dou_dian_pc',
      method: 'POST',
      pageParam: 'page',
      pageSizeParam: 'pageSize',
      pageStart: 1,
      defaultPageSize: 1000,
      defaultApiPageSize: 1000,
      maxApiPageSize: 1000,
      minDelayMs: 1500,
      maxDelayMs: 3000,
      contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
      listPaths: [
        'data',
      ],
      sources: accountSources,
      decorateItem(item, source) {
        return {
          ...item,
          merchant_uid: source.params.merchant_uid,
          uid_type: source.params.uid_type,
          member_type: source.params.member_type,
        };
      }
    });
  });
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

      'data.brand_qual_list',
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
 * 功能描述：处理平台开票记录聚合请求，先调用主体列表接口拿 CreditCode，再逐主体请求真实开票记录接口。
 * @param {object} req Express 请求
 * @param {object} res Express 响应
 */
async function handlePlatformInvoiceRecordAggregateRequest(req, res) {
  await sendAggregateResponse(res, async () => {
    const subjectSources = await loadPlatformInvoiceRecordAggregateSources(req);
    console.log('[PlatformInvoice Aggregate Sources]', {
      sourceCount: subjectSources.length
    });
    return runDoudianAggregate(req, {
      tokenPrefix: 'platforminvoice',
      apiPath: 'https://fxg.jinritemai.com/api/ecomfinance/platform/invoice/record/list',
      method: 'GET',
      pageParam: 'page_number',
      pageSizeParam: 'page_size',
      pageStart: 1,
      defaultPageSize: 100,
      defaultApiPageSize: 100,
      maxApiPageSize: 1000,
      minDelayMs: 1500,
      maxDelayMs: 3000,
      contentType: 'application/json;charset=UTF-8',
      responseCodePaths: ['ret_code', 'BaseResp.StatusCode', 'code', 'errorCode'],
      responseMessagePaths: ['ret_message', 'BaseResp.StatusMessage', 'message', 'msg'],
      successCodes: ['0000', '0', '200', '100000'],
      listPaths: [
        'ret_data',
      ],
      sources: subjectSources,
      decorateItem(item, source) {
        return {
          ...item,
          credit_code: source.params.credit_code,
        };
      }
    });
  });
}

/**
 * 功能描述：处理商品优化成长
 * @param {object} req Express 请求
 * @param {object} res Express 响应
 */
async function handleQueryProductStrategyV2(req, res) {
  await sendAggregateResponse(res, async () => {

    return runDoudianAggregate(req, {
      tokenPrefix: 'platforminvoice',
      apiPath: 'https://fxg.jinritemai.com/api/business_product/strategy/query_product_page_v2',
      method: 'POST',
      pageParam: 'page_index',
      pageSizeParam: 'page_size',
      pageStart: 1,
      defaultPageSize: 10,
      defaultApiPageSize: 10,
      maxApiPageSize: 10,
      minDelayMs: 1500,
      maxDelayMs: 3000,
      contentType: 'application/json;charset=UTF-8',
      responseCodePaths: ['code'],
      responseMessagePaths: ['ret_message', 'BaseResp.StatusMessage', 'message', 'msg'],
      successCodes: ['0000', '0', '200', '100000'],
      listPaths: [
        'data.product_list',
      ],
      sources: [
        { key: 'brand_scene_0', label: '新潮', params: { scene: 2,filter:{flow_task:7} } },
        { key: 'brand_scene_4', label: '商品优化成长', params: { scene: 6,filter:{flow_task:0}} },

      ],
      decorateItem(item, source) {
        return {
          ...item,
          scene: source.params.scene,
          filter: source.params.filter,
        };
      }
    });
  });
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

  if (body.aggregatePageToken && cursor.sourceIndex >= sources.length) {
    throw new Error('AggregatePageTokenInvalid: 聚合分页令牌来源下标超出范围');
  }
  if (
    body.aggregatePageToken
    && cursor.sourceIndex < sources.length
    && cursor.offset > sources[cursor.sourceIndex].total
  ) {
    throw new Error('AggregatePageTokenInvalid: 聚合分页令牌偏移量超出来源数据范围');
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
  const defaultCursor = { sourceIndex: 0, offset: 0, loaded: 0 };
  if (!token) return defaultCursor;

  const match = String(token).match(/^agg_(\d+)_(\d+)_(\d+)$/);
  if (!match) return defaultCursor;

  const cursor = {
    sourceIndex: Number(match[1]),
    offset: Number(match[2]),
    loaded: Number(match[3])
  };
  if (
    !Number.isSafeInteger(cursor.sourceIndex) ||
    !Number.isSafeInteger(cursor.offset) ||
    !Number.isSafeInteger(cursor.loaded) ||
    cursor.sourceIndex < 0 ||
    cursor.offset < 0 ||
    cursor.loaded < 0 ||
    cursor.sourceIndex > 100000 ||
    cursor.offset > 1000000 ||
    cursor.loaded > 100000000
  ) {
    return defaultCursor;
  }
  return cursor;
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

/**
 * 功能描述：先查询抖店账户列表，再把每个支付账户转成 queryAccountFlows 的聚合来源。
 * @param {object} req Express 请求
 * @return {Promise<Array<object>>} 返回聚合来源配置
 */
async function loadAccountFlowsAggregateSources(req) {
  const accountList = await fetchAccountList(req);
  const filteredList = filterAccountFlowsByRequest(accountList, req.body || {});

  if (filteredList.length === 0) {
    throw new Error('AccountListEmpty: getAccountList 未返回可用支付账户，无法聚合 queryAccountFlows');
  }

  return filteredList.map((account, index) => ({

    key: buildAccountSourceKey(account, index),
    label: String(account.account_desc || account.channel_type || `账户_${index + 1}`),
    params: {
      merchant_uid: String(account.merchant_uid || ''),
      uid_type: Number(account.uid_type),
      member_type: Number(account.member_type),
    }
  }));
}

/**
 * 功能描述：先查询电商财务主体列表，再把每个主体转成 platform invoice record 的聚合来源。
 * @param {object} req Express 请求
 * @return {Promise<Array<object>>} 返回聚合来源配置
 */
async function loadPlatformInvoiceRecordAggregateSources(req) {
  const subjectList = await fetchEcomfinanceSubjectList(req);
  if (!Array.isArray(subjectList) || subjectList.length === 0) {
    throw new Error('SubjectListEmpty: subject/list 未返回可用主体，无法聚合 platform/invoice/record/list');
  }

  return subjectList
    .filter((subject) => subject && String(subject.CreditCode || '').trim())
    .map((subject, index) => ({
      key: `credit_${String(subject.CreditCode).trim() || index + 1}`,
      label: String(subject.CompanyName || subject.CreditCode || `主体_${index + 1}`),
      companyName: String(subject.CompanyName || ''),
      params: {
        credit_code: String(subject.CreditCode || '').trim()
      }
    }));
}

/**
 * 功能描述：调用主体列表前置接口，读取 ret_data.subject_list。
 * @param {object} req Express 请求
 * @return {Promise<Array<object>>} 返回主体数组
 */
async function fetchEcomfinanceSubjectList(req) {
  const requestUrl = 'https://fxg.jinritemai.com/api/ecomfinance/subject/list';
  const cookie = resolveAggregateRequestCookie(req);
  const { response, responseText } = await fetchTextWithTimeout(
    requestUrl,
    {
      method: 'GET',
      headers: {
        Cookie: cookie,
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json;charset=UTF-8',
        Referer: 'https://fxg.jinritemai.com/',
        Origin: 'https://fxg.jinritemai.com'
      }
    },
    getRemainingTimeoutMs(req.headers['x-request-deadline'], 4000, 500)
  );
  let resJson;
  try {
    resJson = JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `SubjectListNonJson: HTTP ${response.status}, `
      + `bodyBytes=${Buffer.byteLength(responseText, 'utf8')}`
    );
  }

  const retCode = String(resJson.ret_code ?? resJson.BaseResp?.StatusCode ?? resJson.code ?? '');
  if (!response.ok) {
    throw new Error(
      `SubjectListHTTPError: HTTP ${response.status} ${resJson.ret_message || resJson.BaseResp?.StatusMessage || resJson.message || response.statusText || '请求失败'}`
    );
  }
  if (retCode && !['0000', '0', '200'].includes(retCode)) {
    throw new Error(`SubjectListAPIError: [code=${retCode}] ${resJson.ret_message || resJson.BaseResp?.StatusMessage || resJson.message || '接口返回错误'}`);
  }

  return extractFirstArrayByPaths(resJson, [
    'ret_data.subject_list',
    'data.subject_list',
    'subject_list',
    'ret_data.list',
    'list'
  ]);
}

/**
 * 功能描述：调用抖店账户列表接口，读取 data.account_list。
 * @param {object} req Express 请求
 * @return {Promise<Array<object>>} 返回账户数组
 */
async function fetchAccountList(req) {
  const requestUrl = 'https://fxg.jinritemai.com/account/center/getAccountList?req_source=dou_dian_pc';
  const cookie = resolveAggregateRequestCookie(req);
  const { response, responseText } = await fetchTextWithTimeout(
    requestUrl,
    {
      method: 'GET',
      headers: {
        Cookie: cookie,
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://fxg.jinritemai.com/',
        Origin: 'https://fxg.jinritemai.com'
      }
    },
    getRemainingTimeoutMs(req.headers['x-request-deadline'], 4000, 500)
  );
  let resJson;
  try {
    resJson = JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `AccountListNonJson: HTTP ${response.status}, `
      + `bodyBytes=${Buffer.byteLength(responseText, 'utf8')}`
    );
  }

  const errCode = String(resJson.code ?? resJson.errorCode ?? '');
  if (!response.ok) {
    throw new Error(
      `AccountListHTTPError: HTTP ${response.status} ${resJson.message || resJson.msg || response.statusText || '请求失败'}`
    );
  }
  if (errCode && errCode !== '0' && errCode !== '200') {
    throw new Error(`AccountListAPIError: [code=${errCode}] ${resJson.message || resJson.msg || '接口返回错误'}`);
  }

  return extractFirstArrayByPaths(resJson, [
    'data.account_list',
    'account_list',
    'data.list',
    'list'
  ]);
}

/**
 * 功能描述：按请求里的可选商户 UID / 支付通道做过滤；默认聚合全部账户。
 * @param {Array<object>} accountList 账户列表
 * @param {object} body 聚合请求体
 * @return {Array<object>} 返回过滤结果
 */
function filterAccountFlowsByRequest(accountList, body = {}) {
  const requestedMerchantUid = String(
    body.merchantUid || body.params?.merchant_uid || body.params?.merchantUid || ''
  ).trim();
  const requestedPayChannel = String(
    body.payChannel || body.params?.payChannel || body.params?.channel_type || ''
  ).trim().toUpperCase();

  return (accountList || []).filter((account) => {
    if (!account || !account.merchant_uid || account.uid_type === undefined || account.member_type === undefined) {
      return false;
    }
    if (requestedMerchantUid && String(account.merchant_uid) !== requestedMerchantUid) {
      return false;
    }
    if (requestedPayChannel && !matchesRequestedPayChannel(account, requestedPayChannel)) {
      return false;
    }
    return true;
  });
}

/**
 * 功能描述：判断支付账户是否匹配请求中的通道筛选。
 * @param {object} account 账户信息
 * @param {string} requestedPayChannel 请求中的支付通道
 * @return {boolean} 返回是否匹配
 */
function matchesRequestedPayChannel(account, requestedPayChannel) {
  const aliases = new Set([
    String(account.channel_type || '').toUpperCase(),
    String(account.account_desc || '').toUpperCase()
  ]);
  const normalizedMap = {
    AGGREGATE: ['PA', '聚合支付账户'],
    PA: ['PA', '聚合支付账户'],
    '聚合支付': ['PA', '聚合支付账户'],
    WECHAT: ['WX', '微信支付账户'],
    WX: ['WX', '微信支付账户'],
    '微信支付': ['WX', '微信支付账户'],
    DOUYIN: ['NEW_HZ', '抖音支付账户'],
    NEW_HZ: ['NEW_HZ', '抖音支付账户'],
    '抖音支付': ['NEW_HZ', '抖音支付账户']
  };
  (normalizedMap[requestedPayChannel] || []).forEach((alias) => aliases.add(String(alias).toUpperCase()));
  return aliases.has(requestedPayChannel);
}

/**
 * 功能描述：给账户来源生成稳定 key。
 * @param {object} account 账户信息
 * @param {number} index 下标
 * @return {string} 返回来源 key
 */
function buildAccountSourceKey(account, index) {
  const channel = String(account.channel_type || account.account_desc || `account_${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${channel || 'account'}_${String(account.uid_type || index + 1)}`;
}

/**
 * 功能描述：按照候选路径提取第一个数组。
 * @param {object} source 响应 JSON
 * @param {Array<string>} paths 候选路径
 * @return {Array} 返回命中的数组
 */
function extractFirstArrayByPaths(source, paths) {
  for (const path of paths || []) {
    const value = getValueByPath(source, path);
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

/**
 * 功能描述：按点分路径读取对象值。
 * @param {object} source 源对象
 * @param {string} path 点分路径
 * @return {unknown} 返回命中的值
 */
function getValueByPath(source, path) {
  if (!source || !path) return undefined;
  return String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => {
      if (current === undefined || current === null) return undefined;
      return current[key];
    }, source);
}

/**
 * 功能描述：读取本地聚合请求携带的 Cookie，并兼容被加密后的密文值。
 * @param {object} req Express 请求
 * @return {string} 返回可直接透传给抖店接口的 Cookie
 */
function resolveAggregateRequestCookie(req) {
  const rawCookie = String(req?.headers?.cookie || '').trim();
  if (!rawCookie) return '';
  if (!rawCookie.startsWith('enc:v1:')) return rawCookie;
  try {
    return decryptCredential(rawCookie);
  } catch (error) {
    console.warn('[Doudian Aggregate] 请求头 Cookie 解密失败，继续按原值透传', {
      message: error.message
    });
    return rawCookie;
  }
}

/**
 * 功能描述：处理购买类目分析的本地多行展开聚合请求。
 */
async function handleCateTradeAggregateRequest(req, res) {
  await sendAggregateResponse(res, async () => {
    const body = req.body || {};
    const apiHost = String(body.sourceApiHost || 'https://compass.jinritemai.com').replace(/\/$/, '');
    const apiPath = body.sourceApiPath || '/api/commop/business_chance_center/user_select/cate_trade';
    const requestUrlObj = new URL(apiPath, apiHost);
    
    const params = body.params || {};
    const contentType = 'application/json;charset=UTF-8';
    const cookie = resolveAggregateRequestCookie(req);
    const fetchOptions = {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        Accept: 'application/json, text/plain, */*',
        'Content-Type': contentType,
        Referer: `${requestUrlObj.origin}/`,
        Origin: requestUrlObj.origin
      },
      body: JSON.stringify(params)
    };

    console.log('[Doudian Cate Trade Request]', {
      url: requestUrlObj.toString(),
      paramsKeys: Object.keys(params)
    });

    const deadlineAt = Number(req.headers['x-request-deadline'] || 0);
    const { response, responseText } = await fetchTextWithTimeout(
      requestUrlObj.toString(),
      fetchOptions,
      getRemainingTimeoutMs(deadlineAt, 15000, 500)
    );

    if (!response.ok) {
      throw new Error(`Doudian Cate Trade HTTP Error: HTTP ${response.status}`);
    }

    let resJson;
    try {
      resJson = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Doudian Cate Trade Non-JSON Response: ${responseText.substring(0, 200)}`);
    }

    const errCode = String(resJson.code ?? resJson.errorCode ?? '');
    const errMsg = resJson.message || resJson.msg || resJson.errorMsg || '';
    if (errCode && !['0', '0000', '200', '100000'].includes(errCode)) {
      throw new Error(`Doudian Cate Trade API Error: [code=${errCode}] ${errMsg}`);
    }

    let rawList = [];
    if (Array.isArray(resJson.data)) {
      rawList = resJson.data;
    } else if (resJson.data && Array.isArray(resJson.data.list)) {
      rawList = resJson.data.list;
    } else if (resJson.data && Array.isArray(resJson.data.records)) {
      rawList = resJson.data.records;
    } else if (Array.isArray(resJson.list)) {
      rawList = resJson.list;
    }

    const expandedList = [];
    rawList.forEach((item) => {
      const cateName = item.cate_name || item.category_name || '';
      
      // 1. 本店
      if (item.shop_category_indicator) {
        const ind = item.shop_category_indicator;
        expandedList.push({
          category_name: cateName,
          range_type: '本店',
          pay_amt: ind.trading_amount_range,
          pay_amt_ratio: ind.trading_amount_rate,
          pay_uv: ind.traded_user_cnt_range,
          pay_uv_ratio: ind.traded_user_cnt_rate,
          field_3: ind.ord_price_avg_range,
          field_4: ind.item_unit_price_range,
          pay_cnt: ind.pay_ord_cnt_range
        });
      }

      // 2. 友商均值
      if (item.competing_shop_category_avg_indicator) {
        const ind = item.competing_shop_category_avg_indicator;
        expandedList.push({
          category_name: cateName,
          range_type: '友商均值',
          pay_amt: ind.trading_amount_range,
          pay_amt_ratio: ind.trading_amount_rate,
          pay_uv: ind.traded_user_cnt_range,
          pay_uv_ratio: ind.traded_user_cnt_rate,
          field_3: ind.ord_price_avg_range,
          field_4: ind.item_unit_price_range,
          pay_cnt: ind.pay_ord_cnt_range
        });
      }

      // 3. 大盘
      if (item.platform_category_indicator) {
        const ind = item.platform_category_indicator;
        expandedList.push({
          category_name: cateName,
          range_type: '大盘',
          pay_amt: ind.trading_amount_range,
          pay_amt_ratio: ind.trading_amount_rate,
          pay_uv: ind.traded_user_cnt_range,
          pay_uv_ratio: ind.traded_user_cnt_rate,
          field_3: ind.ord_price_avg_range,
          field_4: ind.item_unit_price_range,
          pay_cnt: ind.pay_ord_cnt_range
        });
      }
    });

    const originalPageSize = params.page_size || params.pageSize || 10;
    const hasMore = rawList.length >= originalPageSize;
    const pageNum = params.page || params.page_no || 1;
    const loadedCount = (pageNum - 1) * originalPageSize * 3 + expandedList.length;

    return {
      list: expandedList,
      hasMore,
      loadedCount,
      nextPageToken: hasMore ? `page_${pageNum + 1}_${loadedCount}` : '',
      pageSize: originalPageSize * 3,
      total: hasMore ? loadedCount + 30 : loadedCount
    };
  });
}

module.exports = {
  doudianLocalAggregateRouter
};
