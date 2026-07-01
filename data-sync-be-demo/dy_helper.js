let fetch = require('node-fetch');
if (fetch && fetch.default) {
  fetch = fetch.default;
}
const { logSyncError } = require('./error_logger.js');
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

  if (configOrDateRange && typeof configOrDateRange === 'object') {
    maxPageSize = Number(configOrDateRange.maxPageSize || 1000) || 1000;
    doudianExtraQuery = configOrDateRange.doudianExtraQuery || {};
    doudianInterfaceOverride = configOrDateRange.doudianInterface || null;
    aggregatePageToken = configOrDateRange.aggregatePageToken || '';
  }

  const ua = userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  
  const headers = {
    'Cookie': cookie,
    'User-Agent': ua,
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
    'Referer': 'https://fxg.jinritemai.com/'
  };

  // 1. 模式 B 规定：单次请求之间必须设定 1.5s - 3s 的随机休眠延迟（Delay），防止触发平台风控
  const delayMs = Math.floor(Math.random() * 1500) + 1500;
  console.log(`[Mode B] 频控延迟休眠 ${delayMs} 毫秒...`);
  await new Promise(resolve => setTimeout(resolve, delayMs));

  // 2. 优先拉取工作台导航菜单 (Fetch Menu Structure)
  console.log(`[Mode B] 优先拉取控制台菜单以解析动态路由路径...`);
  const menuUrl = 'https://compass.jinritemai.com/compass/api/v1/menu';
  try {
    const menuResp = await fetch(menuUrl, { headers: { ...headers, 'Referer': 'https://compass.jinritemai.com/' }, timeout: 6000 });
    const menuContentType = menuResp.headers.get('content-type') || '';
    if (menuResp.status === 200 && !menuContentType.includes('text/html')) {
      await menuResp.json();
      console.log(`[Mode B] 菜单路由树解析成功，动态数据节点路径正常`);
    } else {
      console.warn(`[Mode B] 菜单预检接口未返回有效 JSON (status: ${menuResp.status})，将跳过预检`);
    }
  } catch (err) {
    console.warn(`[Mode B] 菜单预检接口请求发生异常，已跳过预检: ${err.message}`);
  }

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
  const builtRequest = buildDoudianRegisteredRequest(selectedInterfaceMeta, shopId, pageNum, maxPageSize, doudianExtraQuery, aggregatePageToken, cookie, ua);
  requestUrl = builtRequest.requestUrl;
  requestMethod = builtRequest.requestMethod;
  requestBody = builtRequest.requestBody;
  headers['Referer'] = builtRequest.refererHost + '/';
  headers['Origin'] = builtRequest.refererHost;
  headers['Content-Type'] = builtRequest.contentType;
  if (builtRequest.requestHeaders) {
    Object.assign(headers, builtRequest.requestHeaders);
  }

  console.log(`[Mode B] 真实请求 URL: ${requestUrl}, Method: ${requestMethod}`);

  try {
    // 判断 Cookie 的有效性
    if (!cookie || cookie.startsWith('mock_') || cookie.length < 30) {
      throw new Error("CredentialsExpired: 凭证失效(Cookie过期)");
    }

    const fetchOptions = {
      method: requestMethod,
      headers: headers,
      timeout: 8000
    };
    if (requestBody) {
      fetchOptions.body = requestBody;
    }

    const response = await fetch(requestUrl, fetchOptions);
    
    if (response.status === 401) {
      throw new Error("CredentialsExpired: 凭证失效(Cookie过期)");
    }
    if (response.status === 403) {
      throw new Error(`DoudianForbidden: 抖店接口拒绝访问，通常是缺少 _bid/verifyFp/fp/msToken/a_bogus 等 Query 风控参数，HTTP 403`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const htmlText = await response.text();
      throw new Error(`DoudianHTMLResponse: 抖店接口返回 HTML 页面，不是 JSON。通常是请求参数或风控参数不完整，不一定是 Cookie 过期。HTTP ${response.status}, snippet=${htmlText.substring(0, 160)}`);
    }

    const responseText = await response.text();
    let resJson;
    try {
      resJson = JSON.parse(responseText);
    } catch (jsonError) {
      throw new Error(`DoudianNonJsonResponse: 抖店接口返回非 JSON 内容。HTTP ${response.status}, contentType=${contentType}, snippet=${responseText.substring(0, 160)}`);
    }
    console.log(`[Doudian API Response] URL: ${requestUrl}, resJson:`, JSON.stringify(resJson));
    
    // 校验响应内容中的未登录或受限标记
    const errCode = String(resJson.code || resJson.errorCode || '');
    const errMsg = resJson.message || resJson.msg || resJson.errorMsg || '';
    
    if (errCode === '40004' || errCode === '10008' || errCode === '401' || (errMsg && (errMsg.includes("登录") || errMsg.includes("会话") || errMsg.includes("expire") || errMsg.includes("失效") || errMsg.includes("未授权")))) {
      throw new Error("CredentialsExpired: 凭证失效(Cookie过期)");
    }

    if (errCode && errCode !== '0' && errCode !== '200') {
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
    
    const resultList = Array.isArray(list) ? list : [];
    const configuredTotal = selectedInterfaceMeta
      ? getFirstValueByPaths(resJson, selectedInterfaceMeta.requestConfig?.totalPaths || [])
      : undefined;
    const totalVal = configuredTotal !== undefined ? configuredTotal : (resJson.total !== undefined ? resJson.total : (resJson.data && resJson.data.total !== undefined ? resJson.data.total : resultList.length));
    resultList.total = Number(totalVal || 0);
    if (selectedInterfaceMeta) {
      resultList.interfaceMeta = selectedInterfaceMeta;
      resultList.pageSize = Math.min(Number(selectedInterfaceMeta.requestConfig?.pageSize || resultList.length || 50), Number(maxPageSize || 1000));
      resultList.pageStart = Number(selectedInterfaceMeta.requestConfig?.pageStart ?? 0);
      resultList.doudianPage = resultList.pageStart + Math.max(Number(pageNum || 1) - 1, 0);
      if (selectedInterfaceMeta.useLocalAggregate) {
        const aggregateData = resJson.data && typeof resJson.data === 'object' ? resJson.data : resJson;
        resultList.hasMore = aggregateData.hasMore === true || aggregateData.has_more === true;
        resultList.nextPageToken = aggregateData.nextPageToken || aggregateData.next_page_token || '';
        resultList.loadedCount = Number(aggregateData.loadedCount || aggregateData.loaded_count || resultList.length || 0);
        resultList.pageSize = Number(aggregateData.pageSize || aggregateData.page_size || resultList.pageSize || maxPageSize);
        resultList.total = Number(aggregateData.total || resultList.total || resultList.loadedCount || 0);
      }
    }

    return resultList;
  } catch (err) {
    let errorType = '接口500报错';
    let msg = err.message;

    if (msg.includes("CredentialsExpired") || msg.includes("401")) {
      errorType = '凭证失效(Cookie过期)';
      msg = '抖店 Session Cookie 已过期失效，请重新在连接器配置页面扫码/验证码登录捕获！';
    } else if (msg.includes("DoudianForbidden") || msg.includes("DoudianHTMLResponse") || msg.includes("DoudianNonJsonResponse")) {
      errorType = '抖店接口请求参数不完整';
    }

    // 静默写入本地错误库
    logSyncError(taskId, '抖音电商罗盘', `店铺_${shopId}`, errorType, msg);
    
    // 抛出异常供 records 同步阶段进行真实连接的处理，绝不静默降级，带上详细错误消息
    throw new Error(`${errorType}: ${msg}`);
  }
}

/**
 * 功能描述：根据数据库接口目录配置构造抖店后台真实请求，统一补齐域名前缀、Cookie Header 与分页参数。
 * @param {object} interfaceMeta 数据库中的接口目录配置
 * @param {string} shopId 店铺 ID
 * @param {number} pageNum 当前页码
 * @return {object} 返回请求 URL、方法、正文与 Content-Type
 */
function buildDoudianRegisteredRequest(interfaceMeta, shopId, pageNum, maxPageSize = 1000, runtimeExtraQuery = {}, aggregatePageToken = '', cookie = '', userAgent = '') {
  const requestConfig = interfaceMeta.requestConfig || {};
  const contentType = requestConfig.contentType || 'application/json;charset=UTF-8';
  const requestMethod = requestConfig.method || 'POST';
  const pageParam = requestConfig.pageParam || 'page';
  const pageSizeParam = requestConfig.pageSizeParam || 'pageSize';
  const pageStart = Number(requestConfig.pageStart ?? 0);
  const pageSize = Math.min(Number(requestConfig.pageSize || 50), Number(maxPageSize || 1000));
  const pageValue = pageStart + Math.max(Number(pageNum || 1) - 1, 0);
  const apiHost = normalizeUrlPrefix(interfaceMeta.apiHost || 'https://fxg.jinritemai.com');

  const baseParams = {
    ...(requestConfig.extraQuery || {}),
    ...(runtimeExtraQuery || {}),
    [pageParam]: pageValue,
    [pageSizeParam]: pageSize
  };
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
    return {
      requestUrl: requestUrlObj.toString(),
      requestMethod: 'POST',
      requestHeaders: {
        Cookie: cookie,
        'User-Agent': userAgent
      },
      requestBody: JSON.stringify({
        interfaceKey: interfaceMeta.interfaceKey,
        sourceApiHost: interfaceMeta.sourceApiHost || '',
        sourceApiPath: interfaceMeta.sourceApiPath || '',
        shopId,
        page: pageValue,
        pageSize,
        pageParam,
        pageSizeParam,
        aggregatePageToken,
        sources: requestConfig.localAggregateSources || requestConfig.aggregateSources || [],
        params: {
          ...baseParams,
          ...(requestConfig.extraBody || {})
        }
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
    Object.entries(baseParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        requestUrlObj.searchParams.set(key, String(value));
      }
    });
    return {
      requestUrl: requestUrlObj.toString(),
      requestMethod: 'GET',
      requestBody: null,
      contentType,
      refererHost: apiHost
    };
  }

  const bodyParams = {
    ...baseParams,
    ...(requestConfig.extraBody || {})
  };

  return {
    requestUrl: requestUrlObj.toString(),
    requestMethod: requestMethod.toUpperCase(),
    requestBody: contentType.includes('application/x-www-form-urlencoded')
      ? new URLSearchParams(bodyParams).toString()
      : JSON.stringify(bodyParams),
    contentType,
    refererHost: apiHost
  };
}

/**
 * 功能描述：将飞书保存的接口地址快照覆盖到数据库接口元信息上。
 * @param {object} interfaceMeta 数据库接口元信息
 * @param {object|null} override 前端保存的 doudianInterface 快照
 * @return {object} 返回合并后的接口元信息
 */
function applyDoudianInterfaceOverride(interfaceMeta, override) {
  if (!override || typeof override !== 'object') return interfaceMeta;
  const apiHost = normalizeNullableText(override.apiHost);
  const apiPath = normalizeNullableText(override.apiPath);
  if (!apiHost && !apiPath) return interfaceMeta;
  return {
    ...interfaceMeta,
    apiHost: apiHost || interfaceMeta.apiHost,
    apiPath: apiPath || interfaceMeta.apiPath,
    sourceApiHost: normalizeNullableText(override.sourceApiHost),
    sourceApiPath: normalizeNullableText(override.sourceApiPath),
    useLocalAggregate: override.useLocalAggregate === true
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
 * 功能描述：按点分路径读取对象值，用于响应字段路径尚未完全确认时的可配置解析。
 * @param {object} source 源对象
 * @param {string} path 点分路径，例如 data.list
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
    const response = await fetch('https://compass.jinritemai.com/compass/api/v1/shop/basic_info', { headers, timeout: 4000 });
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

module.exports = { fetchRealDoudianData, keepAliveSession };
