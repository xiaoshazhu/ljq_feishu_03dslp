const { logSyncError } = require('./error_logger.js');
const {
  assertAllowedUrl,
  fetchTextWithTimeout,
  fetchWithTimeout,
  getRemainingTimeoutMs,
  sanitizeUrl
} = require('./http_client.js');
const {
  getDoudianAllowedApiOrigins,
  getLocalAggregateBaseUrl
} = require('./runtime_config.js');
const {
  getDoudianInterfaceByKey
} = require('./database.js');
const {
  isDoudianInterfaceModule,
  getInterfaceKeyFromModule
} = require('./doudian_interface_utils.js');

/**
 * 功能描述：在模式 B 下，使用 Cookie 凭据优先拉取工作台菜单路由，然后发起真实的订单数据请求。包含频控控制和心跳保活。
 * @param {string} cookie - 截获加密的抖音 Session Cookie
 * @param {string} shopId - 对接商户的店铺数字 ID
 * @param {string} dateRange - 回溯天数 (如 30)
 * @param {string} userAgent - 与登录环境完全一致的浏览器指纹
 * @param {string} taskId - 当前定时任务 ID
 * @return {Promise<Array>} 返回解析并清洗后的抖店订单记录列表
 */
/**
 * 功能描述：根据 doudian_interfaces 注册表配置与 Cookie 凭据，发起真实抖店后台接口请求。
 * @param {string} cookie - 截获加密的抖音 Session Cookie
 * @param {string} shopId - 对接商户的店铺数字 ID
 * @param {string} syncModule - 同步目标模块标识
 * @param {string} dateRange - 回溯天数 (如 30)
 * @param {string} userAgent - 与登录环境完全一致 of 浏览器指纹
 * @param {string} taskId - 当前定时任务 ID
 * @return {Promise<Array>} 返回解析并清洗后的抖店/罗盘数据记录列表
 */
async function fetchRealDoudianData(cookie, shopId, syncModule, configOrDateRange, userAgent, taskId, pageNum = 1) {
  let maxPageSize = 1000;
  let doudianExtraQuery = {};
  let doudianInterfaceOverride = null;
  let aggregatePageToken = '';
  let dateRange = '';
  let deadlineAt = 0;
  let companyId = 'default';
  let dateRangeAnchorAt = 0;
  const isDebugTestRequest = String(taskId || '').startsWith('TEST_');

  if (configOrDateRange && typeof configOrDateRange === 'object') {
    maxPageSize = Number(configOrDateRange.maxPageSize || 1000) || 1000;
    doudianExtraQuery = configOrDateRange.doudianExtraQuery || {};
    doudianInterfaceOverride = configOrDateRange.doudianInterface || null;
    aggregatePageToken = configOrDateRange.aggregatePageToken || '';
    dateRange = String(configOrDateRange.dateRange || '');
    deadlineAt = Number(configOrDateRange.deadlineAt || 0);
    companyId = String(configOrDateRange.companyId || configOrDateRange.tenantKey || 'default');
    dateRangeAnchorAt = Number(configOrDateRange.dateRangeAnchorAt || 0);
  } else if (configOrDateRange !== undefined && configOrDateRange !== null) {
    dateRange = String(configOrDateRange || '');
  }
  dateRangeAnchorAt = resolveDateRangeAnchorAt(dateRangeAnchorAt, aggregatePageToken);

  const ua = userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  
  const headers = {
    'Cookie': cookie,
    'User-Agent': ua,
    'Accept': '*/*'
  };

  // 单次请求前保留随机间隔，同时受飞书 records 总截止时间约束。
  const delayMs = Math.floor(Math.random() * 1500) + 1500;
  console.log(`[Mode B] 频控延迟休眠 ${delayMs} 毫秒...`);
  await sleepWithinDeadline(delayMs, deadlineAt);

  let requestUrl = '';
  let requestMethod = 'GET';
  let requestBody = null;
  let selectedInterfaceMeta = null;

  if (!isDoudianInterfaceModule(syncModule)) {
    throw new Error(`DoudianInterfaceRequired: 当前连接器只支持 doudian_interfaces 注册表接口 (${syncModule || 'empty'})`);
  }
  selectedInterfaceMeta = await getDoudianInterfaceByKey(getInterfaceKeyFromModule(syncModule));
  if (!selectedInterfaceMeta) {
    throw new Error(`DoudianInterfaceNotFound: 当前接口未接入或不存在 (${syncModule})`);
  }
  selectedInterfaceMeta = applyDoudianInterfaceOverride(selectedInterfaceMeta, doudianInterfaceOverride);
  const builtRequest = buildDoudianRegisteredRequest(
    selectedInterfaceMeta,
    shopId,
    pageNum,
    maxPageSize,
    doudianExtraQuery,
    aggregatePageToken,
    cookie,
    ua,
    dateRange,
    dateRangeAnchorAt
  );
  if (selectedInterfaceMeta.useLocalAggregate) {
    assertAllowedUrl(
      builtRequest.requestUrl,
      [getLocalAggregateBaseUrl()],
      { allowHttp: true }
    );
  } else {
    assertAllowedUrl(builtRequest.requestUrl, getDoudianAllowedApiOrigins());
  }
  requestUrl = builtRequest.requestUrl;
  requestMethod = builtRequest.requestMethod;
  requestBody = builtRequest.requestBody;
  applyRequestHeaders(headers, builtRequest, requestMethod);
  if (builtRequest.requestHeaders) {
    Object.assign(headers, builtRequest.requestHeaders);
  }
  if (selectedInterfaceMeta.useLocalAggregate && deadlineAt > 0) {
    headers['X-Request-Deadline'] = String(deadlineAt);
  }

  // console.log(`[Mode B] 真实请求 URL: ${requestUrl}, Method: ${requestMethod}`);
  if (isDebugTestRequest) {
    // console.log('[Doudian Test Request]', JSON.stringify({
    //   syncModule,
    //   shopId,
    //   pageNum,
    //   dateRange,
    //   requestUrl,
    //   requestMethod,
    //   headers: sanitizeDebugHeaders(headers),
    //   requestBody,
    //   curl: buildDebugCurlCommand(requestMethod, requestUrl, headers, requestBody)
    // }, null, 2));
  }

  try {
    // 判断 Cookie 的有效性
    if (!cookie || cookie.startsWith('mock_') || cookie.length < 30) {
      throw new Error("CredentialsExpired: 凭证失效(Cookie过期)");
    }

    const fetchOptions = {
      method: requestMethod,
      headers: headers
    };
    if (requestBody) {
      fetchOptions.body = requestBody;
    }

    if (isDebugTestRequest) {
      // console.log('[Doudian Test FetchOptions]', JSON.stringify({
      //   method: fetchOptions.method,
      //   headers: sanitizeDebugHeaders(fetchOptions.headers || {}),
      //   body: fetchOptions.body || null,
      //   timeout: fetchOptions.timeout
      // }, null, 2));
    }

    const requestTimeoutMs = getRemainingTimeoutMs(
      deadlineAt,
      selectedInterfaceMeta.useLocalAggregate ? 15000 : 8000,
      800
    );
    const { response, responseText } = await fetchTextWithTimeout(
      requestUrl,
      fetchOptions,
      requestTimeoutMs
    );

    if (isDebugTestRequest) {
      // console.log('[Doudian Test Response]', JSON.stringify({
      //   status: response.status,
      //   statusText: response.statusText,
      //   headers: normalizeResponseHeaders(response.headers),
      //   bodyPreview: truncateDebugText(responseText, 4000)
      // }, null, 2));
    }
    
    if (response.status === 401) {
      throw new Error("CredentialsExpired: 凭证失效(Cookie过期)");
    }
    if (response.status === 403) {
      throw new Error(`DoudianForbidden: 抖店接口拒绝访问，通常是缺少 _bid/verifyFp/fp/msToken/a_bogus 等 Query 风控参数，HTTP 403`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error(
        `DoudianHTMLResponse: 抖店接口返回 HTML 页面，不是 JSON。`
        + `通常是请求参数或风控参数不完整，不一定是 Cookie 过期。`
        + `HTTP ${response.status}, bodyBytes=${Buffer.byteLength(responseText, 'utf8')}`
      );
    }

    let resJson;
    try {
      resJson = JSON.parse(responseText);
    } catch (jsonError) {
      throw new Error(
        `DoudianNonJsonResponse: 抖店接口返回非 JSON 内容。`
        + `HTTP ${response.status}, contentType=${contentType}, `
        + `bodyBytes=${Buffer.byteLength(responseText, 'utf8')}`
      );
    }
    console.log(`[Doudian API Response] URL: ${sanitizeUrl(requestUrl)}`);
    
    // 校验响应内容中的未登录或受限标记
    const errCode = String(resJson.code || resJson.errorCode || '');
    const errMsg = resJson.message || resJson.msg || resJson.errorMsg || '';

    if (!response.ok) {
      throw new Error(
        `DoudianHTTPError: 抖店接口 HTTP ${response.status} ${errMsg || response.statusText || '请求失败'}`
      );
    }
    
    if (errCode === '40004' || errCode === '10008' || errCode === '401' || (errMsg && (errMsg.includes("登录") || errMsg.includes("会话") || errMsg.includes("expire") || errMsg.includes("失效") || errMsg.includes("未授权")))) {
      throw new Error("CredentialsExpired: 凭证失效(Cookie过期)");
    }

    if (!isSuccessfulResponseCode(errCode, selectedInterfaceMeta?.requestConfig || {})) {
      throw new Error(`DoudianAPIError: [code=${errCode}] ${errMsg || '接口返回错误'}`);
    }

    // 抖音有些接口会在 data 下返回 list，或者直接在根节点，或者 data 本身直接就是数组
    let list = [];
    if (selectedInterfaceMeta) {
      list = extractListByPaths(resJson, selectedInterfaceMeta.requestConfig?.listPaths || []);
      if (list.length === 0) {
        list = extractFirstArray(resJson);
      }
    } else if (Array.isArray(resJson.list)) {
      list = resJson.list;
    } else if (resJson.data) {
      if (Array.isArray(resJson.data)) {
        list = resJson.data;
      } else {
        list = resJson.data.list || resJson.data.data_list || resJson.data.flows || resJson.data.flow_list || [];
      }
    }
    
    const resultList = normalizeListItemsByConfig(
      Array.isArray(list) ? list : [],
      selectedInterfaceMeta?.requestConfig || {}
    );
    const configuredTotal = selectedInterfaceMeta
      ? getFirstValueByPaths(resJson, selectedInterfaceMeta.requestConfig?.totalPaths || [])
      : undefined;
    const responseTotal = configuredTotal !== undefined
      ? configuredTotal
      : resJson.total !== undefined
        ? resJson.total
        : resJson.data && resJson.data.total !== undefined
          ? resJson.data.total
          : undefined;
    const numericResponseTotal = Number(responseTotal);
    const hasKnownTotal = responseTotal !== undefined
      && responseTotal !== null
      && responseTotal !== ''
      && Number.isFinite(numericResponseTotal)
      && numericResponseTotal >= 0;
    resultList.total = hasKnownTotal ? numericResponseTotal : 0;
    if (selectedInterfaceMeta) {
      resultList.interfaceMeta = selectedInterfaceMeta;
      resultList.pageSize = Math.min(Number(selectedInterfaceMeta.requestConfig?.pageSize || resultList.length || 50), Number(maxPageSize || 1000));
      resultList.pageStart = Number(selectedInterfaceMeta.requestConfig?.pageStart ?? 0);
      const normalizedPageNum = normalizeInternalPageNum(pageNum);
      resultList.doudianPage = resultList.pageStart + Math.max(normalizedPageNum - 1, 0);
      if (selectedInterfaceMeta.useLocalAggregate) {
        const aggregateData = resJson.data && typeof resJson.data === 'object' ? resJson.data : resJson;
        resultList.hasMore = aggregateData.hasMore === true || aggregateData.has_more === true;
        resultList.nextPageToken = aggregateData.nextPageToken || aggregateData.next_page_token || '';
        resultList.loadedCount = Number(aggregateData.loadedCount || aggregateData.loaded_count || resultList.length || 0);
        resultList.pageSize = Number(aggregateData.pageSize || aggregateData.page_size || resultList.pageSize || maxPageSize);
        resultList.total = Number(aggregateData.total || resultList.total || resultList.loadedCount || 0);
      } else {
        const requestConfig = selectedInterfaceMeta.requestConfig || {};
        const paginationEnabled = requestConfig.pagination !== false;
        const loadedCount = calculateLoadedCount(
          aggregatePageToken,
          normalizedPageNum,
          resultList.pageSize,
          resultList.length
        );
        const responseHasMore = getFirstValueByPaths(
          resJson,
          requestConfig.hasMorePaths || requestConfig.has_more_paths || []
        );
        const hasMore = responseHasMore !== undefined
          ? normalizeBoolean(responseHasMore)
          : hasKnownTotal
            ? loadedCount < resultList.total
            : paginationEnabled && resultList.length >= resultList.pageSize;
        resultList.loadedCount = loadedCount;
        resultList.hasMore = hasMore;
        resultList.nextPageToken = hasMore
          ? `page_${normalizedPageNum + 1}_${loadedCount}_${dateRangeAnchorAt}`
          : '';
        if (!hasKnownTotal) {
          resultList.total = hasMore ? loadedCount + 1 : loadedCount;
        }
      }
    }

    return resultList;
  } catch (err) {
    let errorType = '接口500报错';
    let msg = err.message;

    if (msg.includes("CredentialsExpired") || msg.includes("401")) {
      errorType = '凭证失效(Cookie过期)';
      msg = '抖店 Session Cookie 已过期失效，请重新在连接器配置页面扫码/验证码登录捕获！';
    } else if (msg.includes("UpstreamResponseTooLarge")) {
      errorType = '抖店接口响应过大';
    } else if (msg.includes("DoudianForbidden") || msg.includes("DoudianHTMLResponse") || msg.includes("DoudianNonJsonResponse")) {
      errorType = '抖店接口请求参数不完整';
    }

    // 静默写入本地错误库
    logSyncError(taskId, '抖音电商罗盘', `店铺_${shopId}`, errorType, msg, companyId);
    
    // 抛出异常供 records 同步阶段进行真实连接的处理，绝不静默降级，带上详细错误消息
    throw new Error(`${errorType}: ${msg}`);
  }
}

/**
 * 功能描述：规范连接器内部页码；内部页码一基，抖店 0 页接口由 requestConfig.pageStart=0 表达。
 * @param {unknown} pageNum 当前内部页码
 * @return {number} 返回可用于分页计算的页码
 */
function normalizeInternalPageNum(pageNum) {
  const numericPage = Number(pageNum);
  return Number.isSafeInteger(numericPage) && numericPage > 0 ? numericPage : 1;
}

function calculateLoadedCount(pageToken, pageNum, pageSize, currentCount) {
  const tokenLoadedCount = Number(String(pageToken || '').split('_')[2]);
  const loadedBefore = Number.isSafeInteger(tokenLoadedCount) && tokenLoadedCount >= 0
    ? tokenLoadedCount
    : Math.max(pageNum - 1, 0) * pageSize;
  return loadedBefore + currentCount;
}

/**
 * 功能描述：根据数据库接口目录配置构造抖店后台真实请求，统一补齐域名前缀、Cookie Header 与分页参数。
 * @param {object} interfaceMeta 数据库中的接口目录配置
 * @param {string} shopId 店铺 ID
 * @param {number} pageNum 当前页码
 * @return {object} 返回请求 URL、方法、正文与 Content-Type
 */
function buildDoudianRegisteredRequest(interfaceMeta, shopId, pageNum, maxPageSize = 1000, runtimeExtraQuery = {}, aggregatePageToken = '', cookie = '', userAgent = '', dateRange = '', dateRangeAnchorAt = Date.now()) {
  const requestConfig = interfaceMeta.requestConfig || {};
  const paginationEnabled = requestConfig.pagination !== false;
  const contentType = requestConfig.contentType || 'application/json;charset=UTF-8';
  const requestMethod = requestConfig.method || 'POST';
  const pageParam = requestConfig.pageParam || 'page';
  const pageSizeParam = requestConfig.pageSizeParam || 'pageSize';
  const pageStart = Number(requestConfig.pageStart ?? 0);
  const pageSize = Math.min(Number(requestConfig.pageSize || 50), Number(maxPageSize || 1000));
  const normalizedPageNum = normalizeInternalPageNum(pageNum);
  const pageValue = pageStart + Math.max(normalizedPageNum - 1, 0);
  const apiHost = normalizeUrlPrefix(interfaceMeta.apiHost || 'https://fxg.jinritemai.com');

  const computedDateRangeParams = buildDateRangeQueryParams(
    requestConfig,
    dateRange,
    dateRangeAnchorAt
  );
  const baseParams = {
    ...(requestConfig.extraQuery || {}),
    ...computedDateRangeParams,
    ...(runtimeExtraQuery || {})
  };
  if (paginationEnabled && requestMethod.toUpperCase() === 'GET') {
    baseParams[pageParam] = pageValue;
    baseParams[pageSizeParam] = pageSize;
  }
  if (requestConfig.includeShopId) {
    baseParams.shop_id = shopId;
    baseParams.shopId = shopId;
  }

  // 本地聚合接口分支：
  // 前端在 saveConfigAndGoNext 时，如果 doudian_interfaces.local_aggregate_path 有值，
  // 会把 config.doudianInterface.apiHost/apiPath 保存成本地聚合服务地址，并设置 useLocalAggregate=true。
  // 飞书仍然只调用 /api/records；这里识别 useLocalAggregate 后，改为由后端内部 POST 到本地聚合接口。
  // aggregatePageToken 就是飞书本次传进 /api/records 的 pageToken，用来让聚合接口继续上次的多来源游标。
  if (interfaceMeta.useLocalAggregate) {
    const requestUrlObj = new URL(interfaceMeta.apiPath, apiHost);
    const aggregateParams = {
      ...baseParams,
      ...(requestConfig.extraBody || {})
    };
    applyPaginationParams(aggregateParams, pageParam, pageSizeParam, pageValue, pageSize, paginationEnabled);
    return {
      requestUrl: requestUrlObj.toString(),
      requestMethod: 'POST',
      requestHeaders: {
        Cookie: cookie,
        'User-Agent': userAgent
      },
      extraHeaders: requestConfig.extraHeaders || {},
      referer: requestConfig.referer || '',
      includeOriginHeader: requestConfig.includeOriginHeader,
      requestBody: JSON.stringify({
        interfaceKey: interfaceMeta.interfaceKey,
        sourceApiHost: interfaceMeta.sourceApiHost || '',
        sourceApiPath: interfaceMeta.sourceApiPath || '',
        shopId,
        page: paginationEnabled ? pageValue : undefined,
        pageSize: paginationEnabled ? pageSize : undefined,
        pageParam: paginationEnabled ? pageParam : undefined,
        pageSizeParam: paginationEnabled ? pageSizeParam : undefined,
        paginationEnabled,
        aggregatePageToken,
        dateRangeAnchorAt,
        sources: requestConfig.localAggregateSources || requestConfig.aggregateSources || [],
        params: aggregateParams
      }),
      contentType: 'application/json;charset=UTF-8',
      refererHost: apiHost
    };
  }

  // 普通抖店接口分支：
  // local_aggregate_path 为空时，前端保存的 apiHost/apiPath 仍然是抖店原始接口地址；
  // 这里直接按 doudian_interfaces.request_config 组装分页参数，请求真实抖店接口。
  const requestUrlObj = new URL(interfaceMeta.apiPath, apiHost);

  if (requestMethod.toUpperCase() === 'GET') {
    appendUrlSearchParams(requestUrlObj.searchParams, baseParams);
    return {
      requestUrl: requestUrlObj.toString(),
      requestMethod: 'GET',
      requestBody: null,
      contentType,
      refererHost: apiHost,
      extraHeaders: requestConfig.extraHeaders || {},
      referer: requestConfig.referer || '',
      includeOriginHeader: requestConfig.includeOriginHeader
    };
  }

  const bodyParams = {
    ...baseParams,
    ...(requestConfig.extraBody || {})
  };
  applyPaginationParams(bodyParams, pageParam, pageSizeParam, pageValue, pageSize, paginationEnabled);

  return {
    requestUrl: requestUrlObj.toString(),
    requestMethod: requestMethod.toUpperCase(),
    requestBody: contentType.includes('application/x-www-form-urlencoded')
      ? buildFormUrlEncodedBody(bodyParams)
      : JSON.stringify(bodyParams),
    contentType,
    refererHost: apiHost,
    extraHeaders: requestConfig.extraHeaders || {},
    referer: requestConfig.referer || '',
    includeOriginHeader: requestConfig.includeOriginHeader
  };
}

/**
 * 功能描述：把嵌套对象展开为点分参数并写入 URLSearchParams，避免对象被编码成 [object Object]。
 * @param {URLSearchParams} searchParams 目标查询参数
 * @param {object} source 原始参数对象
 * @param {string} prefix 当前点分路径
 * @return {void} 无返回值
 */
function appendUrlSearchParams(searchParams, source, prefix = '') {
  if (!source || typeof source !== 'object') return;
  Object.entries(source).forEach(([key, value]) => {
    const parameterName = prefix ? `${prefix}.${key}` : key;
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== '') {
          searchParams.append(parameterName, serializeQueryValue(item));
        }
      });
      return;
    }
    if (typeof value === 'object') {
      appendUrlSearchParams(searchParams, value, parameterName);
      return;
    }
    searchParams.set(parameterName, String(value));
  });
}

/**
 * 功能描述：生成 application/x-www-form-urlencoded 请求体并正确展开嵌套参数。
 * @param {object} source 原始请求参数
 * @return {string} 返回表单编码正文
 */
function buildFormUrlEncodedBody(source) {
  const searchParams = new URLSearchParams();
  appendUrlSearchParams(searchParams, source);
  return searchParams.toString();
}

/**
 * 功能描述：把查询参数中的对象值转换为稳定 JSON，基础类型直接转字符串。
 * @param {unknown} value 原始参数值
 * @return {string} 返回可编码文本
 */
function serializeQueryValue(value) {
  return value && typeof value === 'object'
    ? JSON.stringify(value)
    : String(value);
}

/**
 * 功能描述：把分页参数写入请求体，支持 page.current 这类点分嵌套路径。
 * @param {object} target 请求体参数对象
 * @param {string} pageParam 页码字段或点分路径
 * @param {string} pageSizeParam 每页大小字段或点分路径
 * @param {number} pageValue 当前页码值
 * @param {number} pageSize 每页大小
 * @param {boolean} paginationEnabled 是否启用分页
 * @return {void} 无返回值
 */
function applyPaginationParams(target, pageParam, pageSizeParam, pageValue, pageSize, paginationEnabled) {
  if (!paginationEnabled) return;
  setValueByConfigPath(target, pageParam, pageValue);
  setValueByConfigPath(target, pageSizeParam, pageSize);
}

/**
 * 功能描述：按配置路径写入对象值；路径无点号时保持原来的扁平字段行为。
 * @param {object} target 目标对象
 * @param {string} path 字段名或点分路径，例如 page.current
 * @param {unknown} value 要写入的值
 * @return {void} 无返回值
 */
function setValueByConfigPath(target, path, value) {
  if (!target || typeof target !== 'object' || !path) return;
  const pathSegments = String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  if (pathSegments.length === 0) return;
  if (pathSegments.some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))) {
    throw new Error(`DoudianParameterPathInvalid: 非法分页参数路径 (${path})`);
  }

  let current = target;
  pathSegments.forEach((key, index) => {
    if (index === pathSegments.length - 1) {
      current[key] = value;
      return;
    }
    if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) {
      current[key] = {};
    }
    current = current[key];
  });
}

/**
 * 功能描述：将飞书保存的接口地址快照覆盖到数据库接口元信息上。
 * @param {object} interfaceMeta 数据库接口元信息
 * @param {object|null} override 前端保存的 doudianInterface 快照
 * @return {object} 返回合并后的接口元信息
 */
function applyDoudianInterfaceOverride(interfaceMeta, override) {
  const localAggregatePath = normalizeNullableText(interfaceMeta.localAggregatePath);
  if (!localAggregatePath) {
    return {
      ...interfaceMeta,
      useLocalAggregate: false
    };
  }
  if (!localAggregatePath.startsWith('/local/') && localAggregatePath !== '/demo') {
    throw new Error(`LocalAggregatePathInvalid: 非法本地聚合路径 (${localAggregatePath})`);
  }
  return {
    ...interfaceMeta,
    apiHost: getLocalAggregateBaseUrl(),
    apiPath: localAggregatePath,
    sourceApiHost: interfaceMeta.apiHost,
    sourceApiPath: interfaceMeta.apiPath,
    useLocalAggregate: true
  };
}

/**
 * 功能描述：清理 URL 前缀尾部斜杠，便于 URL 构造。
 * @param {string} value 原始 URL 前缀
 * @return {string} 清理后的 URL 前缀
 */
function normalizeUrlPrefix(value) {
  return String(value || '').replace(/\/$/, '');
}

/**
 * 功能描述：根据请求方法和接口配置，拼装最终请求头。
 * @param {object} headers 当前请求头对象
 * @param {object} builtRequest 已构造的请求信息
 * @param {string} requestMethod 请求方法
 * @return {void} 无返回值
 */
function applyRequestHeaders(headers, builtRequest, requestMethod) {
  const method = String(requestMethod || 'GET').toUpperCase();
  const referer = String(builtRequest?.referer || '').trim();
  const refererHost = String(builtRequest?.refererHost || '').trim();
  const extraHeaders = builtRequest?.extraHeaders && typeof builtRequest.extraHeaders === 'object'
    ? builtRequest.extraHeaders
    : {};
  const includeOriginHeader = builtRequest?.includeOriginHeader === true;

  if (method === 'GET') {
    delete headers['Content-Type'];
    if (includeOriginHeader && refererHost) {
      headers['Origin'] = refererHost;
    } else {
      delete headers['Origin'];
    }
  } else {
    headers['Content-Type'] = builtRequest.contentType;
    if (includeOriginHeader && refererHost) {
      headers['Origin'] = refererHost;
    }
  }

  if (referer) {
    headers['Referer'] = referer;
  } else {
    delete headers['Referer'];
  }

  Object.entries(extraHeaders).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    headers[key] = String(value);
  });
}

/**
 * 功能描述：根据统一的同步时间范围配置，计算需要写入真实接口的开始/结束时间参数。
 * @param {object} requestConfig 接口 request_config 配置
 * @param {string} dateRange 前端保存的同步时间范围，例如 7 / 30
 * @return {object} 返回要并入请求的时间参数对象
 */
function buildDateRangeQueryParams(requestConfig, dateRange, anchorAt = Date.now()) {
  const mapping = requestConfig?.dateRangeMapping || requestConfig?.syncTimeRangeMapping || null;
  if (String(dateRange || '').trim().toLowerCase() === 'all') {
    return {};
  }
  const days = Number(dateRange || 0);
  if (!mapping || !Number.isFinite(days) || days <= 0) {
    return {};
  }

  const mode = String(mapping.mode || 'natural_day');
  const format = String(mapping.format || 'datetime');
  const normalizedAnchorAt = Number(anchorAt);
  const now = new Date(
    Number.isFinite(normalizedAnchorAt) && normalizedAnchorAt > 0
      ? normalizedAnchorAt
      : Date.now()
  );
  let startAt = null;
  let endAt = null;

  if (mode === 'rolling') {
    endAt = now;
    startAt = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  } else {
    endAt = endOfDay(now);
    startAt = startOfDay(addDays(now, -(days - 1)));
  }

  const params = {};
  if (mapping.startTime) {
    params[mapping.startTime] = formatDateRangeValue(startAt, format);
  }
  if (mapping.endTime) {
    params[mapping.endTime] = formatDateRangeValue(endAt, format);
  }
  return params;
}

/**
 * 功能描述：恢复一次分页同步首屏确定的时间锚点，避免 rolling 时间范围跨页漂移。
 * @param {unknown} explicitAnchorAt 显式时间锚点
 * @param {unknown} pageToken 当前分页令牌
 * @return {number} 返回稳定的毫秒时间戳
 */
function resolveDateRangeAnchorAt(explicitAnchorAt, pageToken) {
  const explicit = Number(explicitAnchorAt);
  if (isValidDateRangeAnchor(explicit)) return explicit;

  const tokenMatch = String(pageToken || '').match(/_(\d{13})$/);
  const tokenAnchor = tokenMatch ? Number(tokenMatch[1]) : 0;
  if (isValidDateRangeAnchor(tokenAnchor)) return tokenAnchor;
  return Date.now();
}

/**
 * 功能描述：限制分页时间锚点在合理范围内，拒绝损坏令牌中的异常时间。
 * @param {number} value 待校验的毫秒时间戳
 * @return {boolean} 返回是否有效
 */
function isValidDateRangeAnchor(value) {
  return Number.isFinite(value)
    && value >= Date.UTC(2020, 0, 1)
    && value <= Date.now() + 5 * 60 * 1000;
}

/**
 * 功能描述：根据配置格式输出时间范围值，支持时间戳和日期字符串。
 * @param {Date} value 日期对象
 * @param {string} format 输出格式
 * @return {string|number} 返回格式化后的日期值
 */
function formatDateRangeValue(value, format) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  switch (format) {
    case 'timestamp':
    case 'timestamp_ms':
      return value.getTime();
    case 'timestamp_s':
    case 'unix':
      return Math.floor(value.getTime() / 1000);
    case 'date':
      return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`;
    case 'datetime':
    default:
      return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())} ${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}:${padDatePart(value.getSeconds())}`;
  }
}

/**
 * 功能描述：给日期增加或减少指定天数。
 * @param {Date} baseDate 基准日期
 * @param {number} offsetDays 偏移天数
 * @return {Date} 返回新的日期对象
 */
function addDays(baseDate, offsetDays) {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + offsetDays);
  return next;
}

/**
 * 功能描述：将日期归一化到当天开始时间。
 * @param {Date} value 原始日期
 * @return {Date} 返回 00:00:00 的日期对象
 */
function startOfDay(value) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

/**
 * 功能描述：将日期归一化到当天结束时间。
 * @param {Date} value 原始日期
 * @return {Date} 返回 23:59:59.999 的日期对象
 */
function endOfDay(value) {
  const next = new Date(value);
  next.setHours(23, 59, 59, 999);
  return next;
}

/**
 * 功能描述：将日期数字补齐为两位。
 * @param {number} value 日期片段
 * @return {string} 返回补零后的字符串
 */
function padDatePart(value) {
  return String(value).padStart(2, '0');
}

/**
 * 功能描述：清洗调试日志中的请求头，避免完整输出敏感 Cookie。
 * @param {object} headers 原始请求头
 * @return {object} 返回适合打印的请求头
 */
function sanitizeDebugHeaders(headers) {
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
 * 功能描述：对敏感字符串做中间脱敏，保留头尾方便比对。
 * @param {string} value 原始敏感值
 * @return {string} 返回脱敏后的字符串
 */
function maskSensitiveValue(value) {
  const text = String(value || '');
  if (text.length <= 24) return text;
  return `${text.slice(0, 12)}...${text.slice(-12)} (len=${text.length})`;
}

/**
 * 功能描述：把请求转换成便于复现的 curl 命令，方便和 ApiPost 对照。
 * @param {string} method 请求方法
 * @param {string} requestUrl 完整请求 URL
 * @param {object} headers 请求头
 * @param {string|null} requestBody 请求体
 * @return {string} 返回脱敏后的 curl 命令
 */
function buildDebugCurlCommand(method, requestUrl, headers, requestBody) {
  const headerArgs = Object.entries(sanitizeDebugHeaders(headers || {}))
    .map(([key, value]) => `-H ${shellEscape(`${key}: ${value}`)}`)
    .join(' ');
  const bodyArg = requestBody ? ` --data-raw ${shellEscape(String(requestBody))}` : '';
  return `curl -X ${String(method || 'GET').toUpperCase()} ${shellEscape(String(requestUrl || ''))} ${headerArgs}${bodyArg}`.trim();
}

/**
 * 功能描述：把响应头对象转成普通 JSON，便于日志比对。
 * @param {Headers} headers Fetch 返回的响应头
 * @return {object} 返回普通对象
 */
function normalizeResponseHeaders(headers) {
  const result = {};
  if (!headers || typeof headers.forEach !== 'function') return result;
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * 功能描述：截断调试文本，避免日志被大响应淹没。
 * @param {string} text 原始文本
 * @param {number} maxLength 最大长度
 * @return {string} 返回裁剪后的文本
 */
function truncateDebugText(text, maxLength = 1000) {
  const normalized = String(text || '');
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}... (truncated, len=${normalized.length})`;
}

/**
 * 功能描述：对 shell 参数做最小转义，供 curl 调试命令使用。
 * @param {string} value 原始值
 * @return {string} 返回 shell 安全字符串
 */
function shellEscape(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

/**
 * 功能描述：统一清洗本地聚合接口路径，空字符串按不存在处理。
 * @param {unknown} value 原始路径值
 * @return {string} 有效路径或空字符串
 */
function normalizeNullableText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/**
 * 功能描述：按照配置路径从响应 JSON 中提取列表数组。
 * @param {object} json 第三方接口响应 JSON
 * @param {Array<string>} paths 候选数据路径数组
 * @return {Array} 返回命中的列表数组，未命中时为空数组
 */
function extractListByPaths(json, paths) {
  for (const path of paths || []) {
    const value = getValueByPath(json, path);
    if (Array.isArray(value)) return value;
  }
  return [];
}

/**
 * 功能描述：从候选路径中读取第一个非空值。
 * @param {object} json 第三方接口响应 JSON
 * @param {Array<string>} paths 候选路径数组
 * @return {unknown} 返回第一个命中的非空值
 */
function getFirstValueByPaths(json, paths) {
  for (const path of paths || []) {
    const value = getValueByPath(json, path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/**
 * 功能描述：把第三方接口常见的布尔、数字和字符串标记归一化为布尔值。
 * @param {unknown} value 原始是否还有更多数据标记
 * @return {boolean} 返回规范布尔值
 */
function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'y'].includes(String(value || '').trim().toLowerCase());
}

/**
 * 功能描述：按点分路径读取对象值，用于响应字段路径尚未完全确认时的可配置解析。
 * @param {object} source 源对象
 * @param {string} path 点分路径，例如 data.list
 * @return {unknown} 返回路径命中的值
 */
function getValueByPath(source, path) {
  if (!source || !path) return undefined;
  const pathSegments = String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  return pathSegments.reduce((current, key) => {
    if (current === undefined || current === null) return undefined;
    return current[key];
  }, source);
}

/**
 * 功能描述：当接口响应路径未知时，递归查找响应中的第一个数组作为兜底同步明细。
 * @param {unknown} value 响应 JSON 任意节点
 * @return {Array} 返回第一个数组节点，未命中时为空数组
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
 * 功能描述：按接口 request_config 判断当前响应码是否属于成功响应。
 * 默认兼容抖店常见成功码 0、200、100000，也支持数据库 successCodes 自定义覆盖。
 * @param {string} code 接口返回 code
 * @param {object} requestConfig 数据库 request_config
 * @return {boolean} 返回是否成功
 */
function isSuccessfulResponseCode(code, requestConfig = {}) {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) return true;
  const configuredCodes = Array.isArray(requestConfig.successCodes)
    ? requestConfig.successCodes.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const successCodes = configuredCodes.length > 0 ? configuredCodes : ['0', '200', '100000'];
  return successCodes.includes(normalizedCode);
}

/**
 * 功能描述：根据数据库 request_config 的开关，决定是否把列表项从 JSON 字符串解析为对象。
 * 默认不解析，仅当 parseListItemJson=true 或 listItemFormat=json/json_string 时启用。
 * @param {Array} list 原始列表
 * @param {object} requestConfig 接口 request_config 配置
 * @return {Array} 返回归一化后的列表
 */
function normalizeListItemsByConfig(list, requestConfig = {}) {
  const shouldParseJson = requestConfig?.parseListItemJson === true
    || String(requestConfig?.listItemFormat || '').toLowerCase() === 'json'
    || String(requestConfig?.listItemFormat || '').toLowerCase() === 'json_string';

  if (!shouldParseJson) return list;

  return (list || []).map((item) => {
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
 * 功能描述：Session 心跳保活机制 (Keep-Alive)。每 30 分钟发起一次获取店铺信息的轻量请求，激活并延长 Cookie 有效期。
 * @param {string} cookie - 加密的抖音 Cookie 凭证
 * @param {string} userAgent - 登录设备 UA 浏览器指纹
 * @return {Promise<boolean>} 返回保活请求是否成功
 */
async function keepAliveSession(cookie, userAgent) {
  if (!cookie || cookie.startsWith('mock_')) return false;

  const headers = {
    'Cookie': cookie,
    'User-Agent': userAgent || 'Mozilla/5.0',
    'Accept': 'application/json'
  };

  try {
    const response = await fetchWithTimeout(
      'https://compass.jinritemai.com/compass/api/v1/shop/basic_info',
      { headers },
      4000
    );
    if (response.status === 200) {
      console.log(`[心跳保活] 成功对抖音罗盘进行 Session Keep-Alive 延长凭证有效期。`);
      return true;
    }
    return false;
  } catch (e) {
    console.warn(`[心跳保活] 定时保活网络请求失败，静默退出。`);
    return false;
  }
}

/**
 * 功能描述：在总截止时间内执行风控延迟，剩余时间不足时提前失败交给飞书重试。
 * @param {number} delayMs 计划延迟毫秒数
 * @param {number} deadlineAt 整条请求绝对截止时间
 * @return {Promise<void>} 无返回值
 */
async function sleepWithinDeadline(delayMs, deadlineAt) {
  const deadline = Number(deadlineAt);
  if (Number.isFinite(deadline) && deadline > 0 && Date.now() + delayMs + 1000 >= deadline) {
    throw new Error('SyncDeadlineExceeded: 同步请求剩余时间不足，已提前终止');
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

module.exports = { fetchRealDoudianData, keepAliveSession, calculateLoadedCount };
