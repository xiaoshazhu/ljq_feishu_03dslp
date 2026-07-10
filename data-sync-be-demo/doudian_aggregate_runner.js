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
  const fixedApiPageSize = Number.isFinite(Number(options.fixedApiPageSize))
    ? Number(options.fixedApiPageSize)
    : null;
  const apiPageSize = clampNumber(
    fixedApiPageSize ?? getFirstNonEmpty(body.params?.[options.pageSizeParam || 'size'], body.params?.pageSize, body.pageSize),
    1,
    options.maxApiPageSize || 200,
    fixedApiPageSize ?? (options.defaultApiPageSize || 100)
  );
  const fixedApiPage = Number.isFinite(Number(options.fixedApiPage))
    ? Number(options.fixedApiPage)
    : null;
  const pageStart = Number(
    fixedApiPage ?? getFirstNonEmpty(body.params?.[options.pageParam || 'page'], options.pageStart, 0)
  );
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
    if (fixedApiPage !== null || pageResult.list.length < apiPageSize) {
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
  console.log('[Doudian Aggregate Request]', JSON.stringify({
    sourceKey: source.key,
    sourceLabel: source.label,
    method,
    url: requestUrlObj.toString(),
    headers: sanitizeAggregateHeaders(fetchOptions.headers || {}),
    body: fetchOptions.body || null
  }));
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

  const errCode = getAggregateResponseCode(resJson, options);
  const errMessage = getAggregateResponseMessage(resJson, options);
  if (!isSuccessfulAggregateCode(errCode, options)) {
    throw new Error(`DoudianAggregateAPIError: [code=${errCode}] ${errMessage || '接口返回错误'}; request=${JSON.stringify({
      sourceKey: source.key,
      method,
      url: requestUrlObj.toString(),
      body: fetchOptions.body || null
    })}`);
  }
 console.log(requestUrlObj.toString())
  return {
    list: normalizeAggregateListItems(
      extractListByPaths(resJson, options.listPaths || []),
      options
    )
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
 * 功能描述：脱敏聚合请求头，避免完整打印 Cookie。
 * @param {object} headers 原始请求头
 * @return {object} 返回适合日志输出的请求头
 */
function sanitizeAggregateHeaders(headers) {
  const safeHeaders = { ...(headers || {}) };
  if (safeHeaders.Cookie) {
    safeHeaders.Cookie = maskSensitiveValue(String(safeHeaders.Cookie));
  }
  if (safeHeaders.cookie) {
    safeHeaders.cookie = maskSensitiveValue(String(safeHeaders.cookie));
  }
  return safeHeaders;
}

/**
 * 功能描述：对敏感字符串做中间脱敏。
 * @param {string} value 原始值
 * @return {string} 返回脱敏结果
 */
function maskSensitiveValue(value) {
  const text = String(value || '');
  if (text.length <= 24) return text;
  return `${text.slice(0, 12)}...${text.slice(-12)} (len=${text.length})`;
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
 * 功能描述：根据本地聚合配置决定是否把列表项从 JSON 字符串解析为对象。
 * 默认不解析，仅当 parseListItemJson=true 或 listItemFormat=json/json_string 时启用。
 * @param {Array} list 原始列表
 * @param {object} options 聚合配置
 * @return {Array} 返回归一化后的列表
 */
function normalizeAggregateListItems(list, options = {}) {
  const format = String(options.listItemFormat || '').toLowerCase();
  const shouldParseJson = options.parseListItemJson === true || format === 'json' || format === 'json_string';
  if (!shouldParseJson) return Array.isArray(list) ? list : [];

  return (Array.isArray(list) ? list : []).map((item) => {
    if (typeof item !== 'string') return item;
    const text = item.trim();
    if (!text.startsWith('{') && !text.startsWith('[')) return item;
    try {
      return JSON.parse(text);
    } catch (error) {
      return item;
    }
  });
}

/**
 * 功能描述：按本地聚合配置判断当前响应码是否属于成功响应。
 * 默认兼容 0、200、100000，也支持 options.successCodes 自定义覆盖。
 * @param {string} code 接口返回 code
 * @param {object} options 聚合配置
 * @return {boolean} 返回是否成功
 */
function isSuccessfulAggregateCode(code, options = {}) {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) return true;
  const configuredCodes = Array.isArray(options.successCodes)
    ? options.successCodes.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const successCodes = configuredCodes.length > 0 ? configuredCodes : ['0', '200', '100000'];
  return successCodes.includes(normalizedCode);
}

/**
 * 功能描述：按本地聚合配置提取响应状态码，兼容 ret_code / BaseResp.StatusCode 等非标准字段。
 * @param {object} resJson 接口响应 JSON
 * @param {object} options 聚合配置
 * @return {string} 返回状态码字符串
 */
function getAggregateResponseCode(resJson, options = {}) {
  const candidatePaths = Array.isArray(options.responseCodePaths) && options.responseCodePaths.length > 0
    ? options.responseCodePaths
    : ['code', 'errorCode'];

  for (const path of candidatePaths) {
    const value = getValueByPath(resJson, path);
    if (value !== undefined && value !== null && value !== '') {
      return String(value);
    }
  }
  return '';
}

/**
 * 功能描述：按本地聚合配置提取响应错误信息，兼容 ret_message / BaseResp.StatusMessage 等字段。
 * @param {object} resJson 接口响应 JSON
 * @param {object} options 聚合配置
 * @return {string} 返回错误消息
 */
function getAggregateResponseMessage(resJson, options = {}) {
  const candidatePaths = Array.isArray(options.responseMessagePaths) && options.responseMessagePaths.length > 0
    ? options.responseMessagePaths
    : ['message', 'msg'];

  for (const path of candidatePaths) {
    const value = getValueByPath(resJson, path);
    if (value !== undefined && value !== null && value !== '') {
      return String(value);
    }
  }
  return '';
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
