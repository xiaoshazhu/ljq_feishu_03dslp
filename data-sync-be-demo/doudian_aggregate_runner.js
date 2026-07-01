let fetch = require('node-fetch');
if (fetch && fetch.default) {
  fetch = fetch.default;
}

/**
 * 功能描述：执行本地聚合接口的通用分页流程。它按 sources 顺序逐个请求真实抖店接口，
 * 自动跳过空来源，直到凑够本次 pageSize 或全部来源耗尽。
 * @param {object} req Express 请求
 * @param {object} options 聚合接口配置
 * @return {Promise<object>} 返回聚合后的 list、hasMore 与 nextPageToken
 */
async function runDoudianAggregate(req, options) {
  const body = req.body || {};
  const pageSize = clampNumber(body.pageSize || body.maxPageSize, 1, 1000, options.defaultPageSize || 100);
  const apiPageSize = clampNumber(
    getFirstNonEmpty(body.params?.[options.pageSizeParam || 'size'], body.params?.pageSize, body.pageSize),
    1,
    options.maxApiPageSize || 200,
    options.defaultApiPageSize || 100
  );
  const pageStart = Number(getFirstNonEmpty(body.params?.[options.pageParam || 'page'], options.pageStart, 0));
  const sources = normalizeSources(options.sources);
  const cursor = parseAggregateToken(body.aggregatePageToken, options.tokenPrefix, pageStart);
  const list = [];

  while (cursor.sourceIndex < sources.length && list.length < pageSize) {
    const source = sources[cursor.sourceIndex];
    const pageResult = await fetchDoudianAggregatePage(req, body, options, source, cursor.page, apiPageSize);

    if (pageResult.list.length === 0) {
      cursor.sourceIndex += 1;
      cursor.page = pageStart;
      cursor.itemOffset = 0;
      continue;
    }

    const availableList = pageResult.list.slice(cursor.itemOffset);
    const takeCount = Math.min(pageSize - list.length, availableList.length);
    availableList.slice(0, takeCount).forEach((item) => {
      list.push(decorateAggregateItem(item, source, options));
    });
    cursor.itemOffset += takeCount;
    cursor.loaded += takeCount;

    if (cursor.itemOffset < pageResult.list.length) {
      break;
    }

    cursor.itemOffset = 0;
    if (pageResult.list.length < apiPageSize) {
      cursor.sourceIndex += 1;
      cursor.page = pageStart;
    } else {
      cursor.page += 1;
    }
  }

  const hasMore = cursor.sourceIndex < sources.length;
  return {
    list,
    total: cursor.loaded,
    pageSize,
    loadedCount: cursor.loaded,
    hasMore,
    nextPageToken: hasMore ? buildAggregateToken(cursor, options.tokenPrefix) : ''
  };
}

/**
 * 功能描述：请求单个聚合来源的一页真实抖店数据。
 * @param {object} req Express 请求
 * @param {object} body 聚合请求体
 * @param {object} options 聚合配置
 * @param {object} source 当前来源配置
 * @param {number} page 当前页码
 * @param {number} pageSize 抖店单页大小
 * @return {Promise<object>} 返回单页列表
 */
async function fetchDoudianAggregatePage(req, body, options, source, page, pageSize) {
  const apiHost = String(options.apiHost || body.sourceApiHost || 'https://fxg.jinritemai.com').replace(/\/$/, '');
  const apiPath = options.apiPath || body.sourceApiPath;
  const method = String(options.method || 'GET').toUpperCase();
  const pageParam = options.pageParam || 'page';
  const pageSizeParam = options.pageSizeParam || 'size';
  const requestUrlObj = new URL(apiPath, apiHost);
  const requestOrigin = requestUrlObj.origin;
  const params = {
    ...(body.params || {}),
    ...(options.baseParams || {}),
    ...(source.params || {}),
    [pageParam]: page,
    [pageSizeParam]: pageSize
  };

  const contentType = options.contentType || 'application/json;charset=UTF-8';
  const fetchOptions = {
    method,
    headers: {
      Cookie: req.headers.cookie || '',
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
      Accept: 'application/json, text/plain, */*',
      'Content-Type': contentType,
      Referer: `${requestOrigin}/`,
      Origin: requestOrigin
    },
    timeout: options.timeout || 8000
  };

  if (method === 'GET') {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        requestUrlObj.searchParams.set(key, String(value));
      }
    });
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    fetchOptions.body = new URLSearchParams(params).toString();
  } else {
    fetchOptions.body = JSON.stringify(params);
  }

  const delayMs = getRequestDelayMs(options);
  console.log(`[Doudian Aggregate] 聚合来源 ${source.key} 请求前延迟 ${delayMs}ms，降低连续调用风控风险`);
  await sleep(delayMs);

  const response = await fetch(requestUrlObj.toString(), fetchOptions);
  const responseText = await response.text();
  let resJson;
  try {
    resJson = JSON.parse(responseText);
  } catch (error) {
    throw new Error(`DoudianAggregateNonJson: HTTP ${response.status}, snippet=${responseText.substring(0, 160)}`);
  }

  const errCode = String(resJson.code ?? resJson.errorCode ?? '');
  if (errCode && errCode !== '0' && errCode !== '200') {
    throw new Error(`DoudianAggregateAPIError: [code=${errCode}] ${resJson.message || resJson.msg || '接口返回错误'}`);
  }

  return {
    list: extractListByPaths(resJson, options.listPaths || [])
  };
}

/**
 * 功能描述：获取单次真实抖店请求前的随机延迟，避免聚合接口连续调用触发风控。
 * @param {object} options 聚合配置
 * @return {number} 返回延迟毫秒数
 */
function getRequestDelayMs(options = {}) {
  if (Number.isFinite(Number(options.fixedDelayMs))) {
    return Math.max(0, Number(options.fixedDelayMs));
  }
  const minDelayMs = Math.max(0, Number(options.minDelayMs ?? 1500));
  const maxDelayMs = Math.max(minDelayMs, Number(options.maxDelayMs ?? 3000));
  return Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
}

/**
 * 功能描述：休眠指定毫秒。
 * @param {number} ms 毫秒
 * @return {Promise<void>} 无返回值
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 功能描述：给聚合出的记录补充来源信息，或调用具体接口自定义装饰函数。
 * @param {object} item 原始记录
 * @param {object} source 当前来源配置
 * @param {object} options 聚合配置
 * @return {object} 返回最终记录
 */
function decorateAggregateItem(item, source, options) {
  if (typeof options.decorateItem === 'function') {
    return options.decorateItem(item, source);
  }
  return {
    ...item,
    aggregate_source_key: source.key,
    aggregate_source_label: source.label
  };
}

/**
 * 功能描述：解析通用聚合游标。
 * @param {string} token 飞书 pageToken
 * @param {string} tokenPrefix token 前缀
 * @param {number} pageStart 起始页码
 * @return {object} 返回游标
 */
function parseAggregateToken(token, tokenPrefix, pageStart) {
  if (!token) return { sourceIndex: 0, page: pageStart, itemOffset: 0, loaded: 0 };
  const pattern = new RegExp(`^${escapeRegExp(tokenPrefix)}_(\\d+)_(\\d+)_(\\d+)_(\\d+)$`);
  const match = String(token).match(pattern);
  if (!match) return { sourceIndex: 0, page: pageStart, itemOffset: 0, loaded: 0 };
  return {
    sourceIndex: Number(match[1]),
    page: Number(match[2]),
    itemOffset: Number(match[3]),
    loaded: Number(match[4])
  };
}

/**
 * 功能描述：构造通用聚合游标。
 * @param {object} cursor 当前游标
 * @param {string} tokenPrefix token 前缀
 * @return {string} 返回 token
 */
function buildAggregateToken(cursor, tokenPrefix) {
  return `${tokenPrefix}_${cursor.sourceIndex}_${cursor.page}_${cursor.itemOffset}_${cursor.loaded}`;
}

/**
 * 功能描述：从候选路径读取列表，未命中时递归取第一个数组。
 * @param {object} json 接口响应 JSON
 * @param {Array<string>} paths 候选列表路径
 * @return {Array} 返回列表
 */
function extractListByPaths(json, paths) {
  for (const path of paths || []) {
    const value = getValueByPath(json, path);
    if (Array.isArray(value)) return value;
  }
  return extractFirstArray(json);
}

/**
 * 功能描述：按点分路径读取对象值。
 * @param {object} source 源对象
 * @param {string} path 点分路径
 * @return {unknown} 返回路径命中的值
 */
function getValueByPath(source, path) {
  if (!source || !path) return undefined;
  return path.split('.').reduce((current, key) => {
    if (current === undefined || current === null) return undefined;
    return current[key];
  }, source);
}

/**
 * 功能描述：递归提取第一个数组节点作为兜底列表。
 * @param {unknown} value 响应任意节点
 * @return {Array} 返回列表
 */
function extractFirstArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const child of Object.values(value)) {
    const found = extractFirstArray(child);
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * 功能描述：归一化聚合来源配置。
 * @param {Array<object>} sources 原始来源配置
 * @return {Array<object>} 返回来源配置
 */
function normalizeSources(sources) {
  return (sources || []).map((source, index) => ({
    key: String(source.key || `source_${index + 1}`),
    label: String(source.label || source.key || `来源 ${index + 1}`),
    params: source.params && typeof source.params === 'object' ? source.params : {}
  }));
}

/**
 * 功能描述：返回第一个非空值。
 * @param {...unknown} values 候选值
 * @return {unknown} 返回命中的值
 */
function getFirstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
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
 * 功能描述：转义正则特殊字符。
 * @param {string} value 原始字符串
 * @return {string} 返回正则安全字符串
 */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  runDoudianAggregate
};
