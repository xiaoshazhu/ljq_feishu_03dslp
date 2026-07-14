const { fetchRealDoudianData } = require('./dy_helper.js');
const {
  getDoudianInterfaceByKey,
  getAccounts
} = require('./database.js');
const {
  isDoudianInterfaceModule,
  getInterfaceKeyFromModule
} = require('./doudian_interface_utils.js');
const {
  ACCOUNT_NAME_FIELD
} = require('./connector_fields.js');

/**
 * 功能描述：在飞书多维表格引擎发起数据同步任务时，按 doudian_interfaces 注册表拉取并组装抖店数据。
 * @param {object} reqBody 飞书同步服务发来的 POST 请求体，包含配置 JSON
 * @return {Promise<object>} 返回符合飞书 Bitable 连接协议规范的分页记录数据结构
 */
const getTableRecords = async (reqBody, context = {}) => {
  const requestContext = parseRecordsRequest(reqBody);
  const config = await hydrateConnectorConfigWithLatestAccount(requestContext.config, context);
  const pageToken = requestContext.pageToken;
  const maxPageSize = requestContext.maxPageSize;

  const syncModule = config.syncModule || '';
  if (!isDoudianInterfaceModule(syncModule)) {
    throw new Error(`DoudianInterfaceRequired: 当前连接器只支持 doudian_interfaces 注册表接口，请重新选择抖店接口 (${syncModule || 'empty'})`);
  }

  const interfaceKey = getInterfaceKeyFromModule(syncModule);
  const interfaceMeta = await getDoudianInterfaceByKey(interfaceKey);
  if (!interfaceMeta) {
    throw new Error(`DoudianInterfaceNotFound: 当前接口未接入或不存在 (${interfaceKey})`);
  }

  const shopId = config.shopIdParam || config.accountInfo?.shopId || '';
  const cookie = config.accountInfo?.cookie || '';
  const accountName = String(config.accountInfo?.name || '').trim();
  const mappings = config.fieldMappings || {};
  const selectedFieldKeys = normalizeSelectedFieldKeys(config.selectedFieldKeys);
  const taskId = reqBody?.taskId || reqBody?.task_id || `TASK_${Date.now().toString().substring(0, 8)}`;
  const pageNum = parsePageNumFromToken(pageToken, 1);
  const fetchConfig = {
    ...config,
    maxPageSize,
    aggregatePageToken: pageToken
  };

  const rawList = cookie && !cookie.startsWith('mock_')
    ? await fetchRealDoudianData(cookie, shopId, syncModule, fetchConfig, null, taskId, pageNum)
    : buildMockDoudianInterfaceList(interfaceMeta);

  const fieldsSchema = Array.isArray(rawList.interfaceMeta?.fieldsSchema)
    ? rawList.interfaceMeta.fieldsSchema
    : interfaceMeta.fieldsSchema || [];
  const records = rawList.map((item, index) => buildDoudianRecord({
    item,
    index,
    pageNum,
    fieldsSchema,
    interfaceMeta,
    mappings,
    selectedFieldKeys,
    accountName
  }));

  const aggregateHasMore = typeof rawList.hasMore === 'boolean' ? rawList.hasMore : rawList.has_more;
  const aggregateNextPageToken = rawList.nextPageToken || rawList.next_page_token || '';
  const pageSize = Number(rawList.pageSize || maxPageSize || rawList.length || 1000);
  const loadedBefore = parseLoadedCountFromToken(pageToken);
  const loadedCount = Number(rawList.loadedCount || rawList.loaded_count || (
    loadedBefore === null
      ? (pageNum - 1) * pageSize + rawList.length
      : loadedBefore + rawList.length
  ));
  const totalCount = Number(rawList.total || loadedCount || rawList.length || 0);
  const hasMore = typeof aggregateHasMore === 'boolean'
    ? aggregateHasMore
    : rawList.length > 0 && loadedCount < totalCount;
  const nextPageToken = typeof aggregateHasMore === 'boolean'
    ? (hasMore ? aggregateNextPageToken : '')
    : (hasMore ? `page_${pageNum + 1}_${loadedCount}` : '');

  console.log(`[Doudian Records] 接口 ${interfaceMeta.interfaceKey}, 页码 ${pageNum}, 本页 ${rawList.length}, 已加载 ${loadedCount}/${totalCount}, hasMore=${hasMore}`);

  return {
    nextPageToken,
    next_page_token: nextPageToken,
    hasMore,
    has_more: hasMore,
    loadedCount,
    totalCount,
    pageNum,
    records
  };
};

/**
 * 功能描述：每次 /api/records 同步前优先从数据库刷新账号凭证，避免飞书任务长期持有过期 Cookie。
 * @param {object} config 飞书保存的原始配置
 * @param {object} context 请求上下文
 * @return {Promise<object>} 返回带最新账号凭证的配置
 */
async function hydrateConnectorConfigWithLatestAccount(config = {}, context = {}) {
  const companyId = String(context.companyId || 'default');
  const userId = String(context.userId || 'default');
  const accountInfo = config.accountInfo && typeof config.accountInfo === 'object' ? config.accountInfo : {};
  const currentCookie = String(accountInfo.cookie || '');

  if (currentCookie.startsWith('mock_')) {
    return config;
  }

  const accounts = await getAccounts(companyId, userId);
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return config;
  }

  const matchedAccount = resolveLatestAccount(accounts, config);
  if (!matchedAccount?.cookie) {
    return config;
  }

  return {
    ...config,
    shopIdParam: config.shopIdParam || matchedAccount.shopId || '',
    accountInfo: {
      ...accountInfo,
      key: matchedAccount.key || accountInfo.key || '',
      id: matchedAccount.id || accountInfo.id || '',
      name: matchedAccount.name || accountInfo.name || '',
      mode: matchedAccount.mode || accountInfo.mode || '',
      cookie: matchedAccount.cookie,
      shopId: matchedAccount.shopId || accountInfo.shopId || ''
    }
  };
}

/**
 * 功能描述：优先按已保存账号特征匹配数据库中的最新账号，未命中时回退到当前活跃账号。
 * @param {Array<object>} accounts 数据库账号列表
 * @param {object} config 飞书保存的配置
 * @return {object|null} 返回匹配到的账号
 */
function resolveLatestAccount(accounts, config = {}) {
  const accountInfo = config.accountInfo && typeof config.accountInfo === 'object' ? config.accountInfo : {};
  const configuredShopId = String(config.shopIdParam || accountInfo.shopId || '').trim();
  const configuredName = String(accountInfo.name || '').trim();
  const configuredMode = String(accountInfo.mode || '').trim();
  const configuredKey = String(accountInfo.key || accountInfo.id || '').trim();

  const candidates = accounts.filter((account) => account && account.cookie);
  if (candidates.length === 0) return null;

  const byKey = configuredKey
    ? candidates.find((account) => String(account.key || account.id || '') === configuredKey)
    : null;
  if (byKey) return byKey;

  const byShopAndName = candidates.find((account) => (
    configuredShopId &&
    configuredName &&
    String(account.shopId || '') === configuredShopId &&
    String(account.name || '') === configuredName
  ));
  if (byShopAndName) return byShopAndName;

  const byShop = configuredShopId
    ? candidates.find((account) => String(account.shopId || '') === configuredShopId)
    : null;
  if (byShop) return byShop;

  const byNameAndMode = candidates.find((account) => (
    configuredName &&
    configuredMode &&
    String(account.name || '') === configuredName &&
    String(account.mode || '') === configuredMode
  ));
  if (byNameAndMode) return byNameAndMode;

  return candidates.find((account) => Number(account.is_active) === 1) || candidates[0];
}

/**
 * 功能描述：把一条抖店接口原始记录转换为飞书 records 协议数据。
 * @param {object} options 转换上下文
 * @return {object} 返回飞书 record
 */
function buildDoudianRecord({
  item,
  index,
  pageNum,
  fieldsSchema,
  interfaceMeta,
  mappings,
  selectedFieldKeys,
  accountName
}) {
  const primaryField = fieldsSchema.find((field) => field.isPrimary) || fieldsSchema[0];
  const recordId = primaryField
    ? getValueByPath(item, primaryField.sourcePath || primaryField.key)
    : pickFirstValue(item, ['id', 'ID', 'record_id', 'recordId', 'user_id', 'userId', 'order_id', 'orderId']);
  let primaryId = String(recordId || '').substring(0, 100);
  if (!primaryId || primaryId === 'undefined') {
    primaryId = `DOUDIAN_${pageNum}_${index}`;
  }

  const data = {};
  fieldsSchema.forEach((field) => {
    const fieldId = resolveMappedFieldId(mappings, selectedFieldKeys, field.key, field.defaultField);
    if (!fieldId) return;
    const rawValue = getDoudianInterfaceFieldValue(item, field, interfaceMeta);
    data[fieldId] = normalizeDoudianFieldValue(rawValue, field);
  });
  const accountNameFieldId = resolveConnectorFieldId(mappings, ACCOUNT_NAME_FIELD);
  data[accountNameFieldId] = accountName;

  return {
    primaryID: primaryId,
    primaryId,
    data
  };
}

/**
 * 功能描述：解析连接器公共字段的目标列，公共字段不受业务字段勾选状态影响。
 * @param {object} mappings 字段映射配置
 * @param {object} field 连接器公共字段
 * @return {string} 返回目标字段 ID
 */
function resolveConnectorFieldId(mappings, field) {
  const mappedFieldId = mappings && typeof mappings === 'object' ? mappings[field.key] : '';
  return typeof mappedFieldId === 'string' && mappedFieldId.trim()
    ? mappedFieldId.trim()
    : field.defaultField;
}

/**
 * 功能描述：为没有真实 Cookie 的调试场景生成与接口字段 schema 一致的轻量 Mock 列表。
 * @param {object} interfaceMeta 接口元信息
 * @return {Array} 返回模拟接口列表
 */
function buildMockDoudianInterfaceList(interfaceMeta) {
  const fieldsSchema = Array.isArray(interfaceMeta?.fieldsSchema) ? interfaceMeta.fieldsSchema : [];
  const list = Array.from({ length: 5 }).map((_, index) => {
    const recordId = `DOUDIAN_MOCK_${String(index + 1).padStart(3, '0')}`;
    const now = Date.now() - index * 3600000;
    const item = {};
    fieldsSchema.forEach((field) => {
      if (field.key === 'raw_json') return;
      item[field.sourcePath || field.key] = buildMockDoudianFieldValue(field, index, now, recordId);
    });
    return item;
  });
  list.total = list.length;
  list.pageSize = list.length;
  list.interfaceMeta = interfaceMeta;
  return list;
}

/**
 * 功能描述：兼容飞书同步引擎不同版本的分页字段命名，解析配置、分页 token 与单页上限。
 * @param {object} reqBody 飞书同步服务发来的请求体
 * @return {object} 返回解析后的同步配置与分页上下文
 */
function parseRecordsRequest(reqBody = {}) {
  const paramsObj = parseMaybeJsonObject(reqBody.params, {});
  const datasourceConfigObj = parseMaybeJsonObject(
    firstNonEmpty(paramsObj.datasourceConfig, reqBody.datasourceConfig, reqBody.config),
    {}
  );

  let config = {};
  const rawConfigValue = firstNonEmpty(datasourceConfigObj.value, reqBody.config?.value);
  if (rawConfigValue !== undefined) {
    config = parseMaybeJsonObject(rawConfigValue, {});
  }

  const pageToken = String(firstNonEmpty(
    paramsObj.pageToken,
    paramsObj.page_token,
    paramsObj.nextPageToken,
    paramsObj.next_page_token,
    paramsObj.pagination?.pageToken,
    paramsObj.pagination?.page_token,
    reqBody.pageToken,
    reqBody.page_token,
    reqBody.nextPageToken,
    reqBody.next_page_token,
    reqBody.pagination?.pageToken,
    reqBody.pagination?.page_token,
    ''
  ));

  const maxPageSize = Number(firstNonEmpty(
    paramsObj.maxPageSize,
    paramsObj.max_page_size,
    paramsObj.pageSize,
    paramsObj.page_size,
    reqBody.maxPageSize,
    reqBody.max_page_size,
    reqBody.pageSize,
    reqBody.page_size,
    1000
  )) || 1000;

  return { config, pageToken, maxPageSize };
}

/**
 * 功能描述：安全解析可能是 JSON 字符串的对象字段。
 * @param {unknown} value 原始值
 * @param {object} fallback 解析失败时返回值
 * @return {object} 返回对象
 */
function parseMaybeJsonObject(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

/**
 * 功能描述：返回第一个非空值，保留 0 和 false 这类有效值。
 * @param {...unknown} values 候选值
 * @return {unknown} 返回命中的值
 */
function firstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

/**
 * 功能描述：将飞书分页 token 解析为内部页码，兼容 page_2、2 与数字 2。
 * @param {string|number} pageToken 分页 token
 * @param {number} defaultPage 默认页码
 * @return {number} 返回内部页码
 */
function parsePageNumFromToken(pageToken, defaultPage) {
  if (pageToken === undefined || pageToken === null || pageToken === '') return defaultPage;
  const token = String(pageToken);
  if (token.startsWith('page_')) {
    return parseInt(token.split('_')[1], 10) || defaultPage;
  }
  const numericToken = Number(token);
  return Number.isFinite(numericToken) ? numericToken : defaultPage;
}

/**
 * 功能描述：从分页 token 中解析此前已经成功返回给飞书的累计条数。
 * @param {string|number} pageToken 分页 token，格式如 page_3_20
 * @return {number|null} 返回累计条数，旧格式 token 返回 null
 */
function parseLoadedCountFromToken(pageToken) {
  if (pageToken === undefined || pageToken === null || pageToken === '') return null;
  const parts = String(pageToken).split('_');
  if (parts.length < 3 || parts[0] !== 'page') return null;
  const loadedCount = Number(parts[2]);
  return Number.isFinite(loadedCount) && loadedCount >= 0 ? loadedCount : null;
}

/**
 * 功能描述：从对象中按候选字段名读取第一个非空值，用于适配抖店各私有接口未统一的主键字段。
 * @param {object} source 源记录对象
 * @param {Array<string>} keys 候选字段名数组
 * @return {unknown} 返回第一个非空字段值
 */
function pickFirstValue(source, keys) {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/**
 * 功能描述：解析前端显式选择的字段 key 集合。
 * @param {unknown} selectedFieldKeys 前端 selectedFieldKeys
 * @return {Set<string>|null} 返回字段 key 集合，没有显式配置时返回 null
 */
function normalizeSelectedFieldKeys(selectedFieldKeys) {
  if (!Array.isArray(selectedFieldKeys)) return null;
  return new Set(selectedFieldKeys.map((key) => String(key)));
}

/**
 * 功能描述：按用户字段选择解析实际写入的飞书字段 ID。
 * @param {object} mappings 字段映射配置
 * @param {Set<string>|null} selectedFieldKeys 显式选择字段集合
 * @param {string} sourceKey 源字段 key
 * @param {string} defaultField 默认字段 ID
 * @return {string} 返回目标字段 ID，空字符串表示跳过该字段
 */
function resolveMappedFieldId(mappings, selectedFieldKeys, sourceKey, defaultField) {
  const safeMappings = mappings && typeof mappings === 'object' ? mappings : {};
  if (selectedFieldKeys && !selectedFieldKeys.has(sourceKey)) return '';

  if (Object.prototype.hasOwnProperty.call(safeMappings, sourceKey)) {
    const mappedFieldId = safeMappings[sourceKey];
    if (typeof mappedFieldId === 'string' && mappedFieldId.trim()) {
      return mappedFieldId.trim();
    }
    return selectedFieldKeys ? (defaultField || sourceKey) : '';
  }

  if (selectedFieldKeys) return defaultField || sourceKey;
  if (Object.keys(safeMappings).length > 0) return '';
  return defaultField || sourceKey;
}

/**
 * 功能描述：将私有接口返回的秒、毫秒或日期字符串转换为飞书 DateTime 所需毫秒时间戳。
 * @param {unknown} value 接口中的时间字段
 * @return {number|string} 返回毫秒时间戳，无法解析时返回空字符串
 */
function parseOptionalTimestamp(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') {
    return value < 10000000000 ? value * 1000 : value;
  }
  const numericValue = Number(value);
  if (!Number.isNaN(numericValue) && numericValue > 0) {
    return numericValue < 10000000000 ? numericValue * 1000 : numericValue;
  }
  const rawText = String(value).trim();
  const parsedIsoTime = Date.parse(rawText);
  if (!Number.isNaN(parsedIsoTime)) return parsedIsoTime;

  const parsedLocalTime = Date.parse(rawText.replace(/-/g, '/'));
  return Number.isNaN(parsedLocalTime) ? '' : parsedLocalTime;
}

/**
 * 功能描述：按字段类型清洗抖店接口值，保证返回值符合飞书表记录接口字段类型要求。
 * @param {unknown} value 原始接口字段值
 * @param {object} field 字段配置
 * @return {unknown} 返回清洗后的字段值
 */
function normalizeDoudianFieldValue(value, field) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    return normalizeArrayFieldValue(value, field);
  }
  const mappedValue = mapDoudianFieldValue(value, field);
  if (mappedValue !== undefined) return mappedValue;
  if (isPercentageFieldType(field.type)) {
    return normalizePercentageFieldValue(value, field);
  }
  if (isPriceFieldType(field.type)) {
    return normalizePriceFieldValue(value);
  }
  if (field.type === 'Number' || field.fieldType === 2) {
    const numericValue = Number(value);
    return Number.isNaN(numericValue) ? 0 : numericValue;
  }
  if (field.type === 'DateTime' || field.fieldType === 5) {
    return parseOptionalTimestamp(value);
  }
  if (field.fieldType === 10 || isLinkLikeFieldType(field.type)) {
    return normalizeLinkFieldValue(value, field);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * 功能描述：把通配路径读取到的数组值转换成飞书单元格可写入的值。
 * @param {Array<unknown>} values 原始数组值
 * @param {object} field 字段配置
 * @return {unknown} 返回归一化后的字段值
 */
function normalizeArrayFieldValue(values, field = {}) {
  const nonEmptyValues = flattenArray(values).filter((value) => (
    value !== undefined &&
    value !== null &&
    value !== ''
  ));
  if (nonEmptyValues.length === 0) return '';

  const arrayMode = String(field.arrayMode || '').toLowerCase();
  if (arrayMode === 'first') {
    return normalizeDoudianFieldValue(nonEmptyValues[0], { ...field, arrayMode: '' });
  }
  if (arrayMode === 'json') {
    return JSON.stringify(nonEmptyValues);
  }

  if (isPriceFieldType(field.type)) {
    return Number(nonEmptyValues.reduce((sum, value) => sum + normalizePriceFieldValue(value), 0).toFixed(2));
  }
  if (field.type === 'Number' || field.fieldType === 2 || arrayMode === 'sum') {
    const sum = nonEmptyValues.reduce((total, value) => {
      const numericValue = Number(value);
      return Number.isNaN(numericValue) ? total : total + numericValue;
    }, 0);
    return Number(sum.toFixed(6));
  }
  if (field.type === 'DateTime' || field.fieldType === 5) {
    return parseOptionalTimestamp(nonEmptyValues[0]);
  }
  if (field.fieldType === 10 || isLinkLikeFieldType(field.type)) {
    return normalizeLinkFieldValue(nonEmptyValues[0], field);
  }

  const separator = field.arrayJoiner || field.joiner || '、';
  return nonEmptyValues
    .map((value) => {
      const mappedValue = mapDoudianFieldValue(value, field);
      if (mappedValue !== undefined) return mappedValue;
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    })
    .join(separator);
}

/**
 * 功能描述：将图片、视频或普通 URL 字段统一转成飞书超链接字段值。
 * @param {unknown} value 原始 URL 或对象
 * @param {object} field 字段配置
 * @return {object|string} 返回飞书超链接对象，无法解析 URL 时返回空字符串
 */
function normalizeLinkFieldValue(value, field = {}) {
  const url = extractUrlValue(value);
  if (!url) return '';
  return {
    name: buildLinkDisplayName(value, field, url),
    url
  };
}

/**
 * 功能描述：把以“分”为单位的价格字段转换成以“元”为单位的数字。
 * @param {unknown} value 原始价格值，通常为分
 * @return {number} 返回元单位金额，解析失败时返回 0
 */
function normalizePriceFieldValue(value) {
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return 0;
  return Number((numericValue / 100).toFixed(2));
}

/**
 * 功能描述：把小数比例字段转成文本百分比，供飞书文本列展示。
 * 例如 0.03958 -> 3.96%。
 * @param {unknown} value 原始比例值，通常为 0~1 小数
 * @param {object} field 字段配置
 * @return {string} 返回百分比字符串，解析失败时返回空字符串
 */
function normalizePercentageFieldValue(value, field = {}) {
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return '';
  const digits = resolvePercentageDigits(field);
  return `${(numericValue * 100).toFixed(digits)}%`;
}

/**
 * 功能描述：判断字段是否为价格类型，默认按“分转元”处理。
 * @param {string|undefined} fieldType 字段类型
 * @return {boolean} 返回是否为价格型字段
 */
function isPriceFieldType(fieldType) {
  return String(fieldType || '').toLowerCase() === 'price';
}

/**
 * 功能描述：判断字段是否为百分比文本类型。
 * @param {string|undefined} fieldType 字段类型
 * @return {boolean} 返回是否为百分比
 */
function isPercentageFieldType(fieldType) {
  return String(fieldType || '').toLowerCase() === 'percentage';
}

/**
 * 功能描述：解析百分比保留小数位数，默认保留 2 位。
 * @param {object} field 字段配置
 * @return {number} 返回小数位数
 */
function resolvePercentageDigits(field = {}) {
  const digits = Number(field.percentageDigits ?? field.digits ?? 2);
  if (!Number.isFinite(digits)) return 2;
  return Math.max(0, Math.min(6, Math.floor(digits)));
}

/**
 * 功能描述：从字符串或常见对象结构中提取 URL。
 * @param {unknown} value 原始值
 * @return {string} 返回 URL
 */
function extractUrlValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value !== 'object') return String(value).trim();
  return String(
    value.url ||
    value.uri ||
    value.src ||
    value.href ||
    value.video_url ||
    value.videoUrl ||
    value.img_url ||
    value.image_url ||
    value.imageUrl ||
    ''
  ).trim();
}

/**
 * 功能描述：生成超链接展示名。
 * @param {unknown} value 原始值
 * @param {object} field 字段配置
 * @param {string} url URL
 * @return {string} 返回展示名
 */
function buildLinkDisplayName(value, field = {}, url = '') {
  if (value && typeof value === 'object') {
    const objectName = value.name || value.title || value.file_name || value.fileName;
    if (objectName) return String(objectName).substring(0, 100);
  }
  if (field.linkName) return String(field.linkName).substring(0, 100);
  if (field.type === 'ImageUrl') return '查看图片';
  if (field.type === 'VideoUrl') return '查看视频';
  return String(field.fieldName || field.label || field.key || url).substring(0, 100);
}

/**
 * 功能描述：判断字段类型是否按超链接返回。
 * @param {string} type 字段类型
 * @return {boolean} 返回是否为链接类字段
 */
function isLinkLikeFieldType(type) {
  return ['Url', 'URL', 'Link', 'Hyperlink', 'ImageUrl', 'VideoUrl'].includes(String(type || ''));
}

/**
 * 功能描述：按字段配置中的枚举字典把接口原始值转换为可读文本。
 * @param {unknown} value 原始接口字段值
 * @param {object} field 字段配置
 * @return {string|undefined} 命中字典时返回文本，未配置或未命中时返回 undefined
 */
function mapDoudianFieldValue(value, field) {
  const valueMap = normalizeEnumValueMap(field.valueMap || field.enumMap || field.dict);
  if (!valueMap) return undefined;

  const rawKey = String(value);
  if (Object.prototype.hasOwnProperty.call(valueMap, rawKey)) {
    return String(valueMap[rawKey]);
  }

  const fallback = field.enumFallback || field.valueMapFallback;
  if (fallback === 'empty') return '';
  if (fallback === 'raw') return String(value);
  return String(value);
}

/**
 * 功能描述：兼容对象和数组形式的枚举字典，统一转为 key -> label 映射。
 * @param {unknown} valueMap 原始枚举配置
 * @return {object|undefined} 返回标准枚举映射
 */
function normalizeEnumValueMap(valueMap) {
  if (!valueMap || typeof valueMap !== 'object') return undefined;
  if (!Array.isArray(valueMap)) return valueMap;

  const normalized = {};
  valueMap.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const key = firstNonEmpty(item.value, item.key, item.code, item.id, item.status);
    const label = firstNonEmpty(item.label, item.text, item.name, item.title, item.desc, item.description);
    if (key !== undefined && label !== undefined) {
      normalized[String(key)] = String(label);
    }
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * 功能描述：读取抖店接口字段值，并补齐连接器自身的来源元信息字段。
 * @param {object} item 第三方接口返回的单条记录
 * @param {object} field 字段配置
 * @param {object} interfaceMeta 接口目录元信息
 * @return {unknown} 返回字段值
 */
function getDoudianInterfaceFieldValue(item, field, interfaceMeta) {
  if (field.key === 'source_module') return interfaceMeta.moduleGroup || '';
  if (field.key === 'source_list') return interfaceMeta.interfaceName || '';
  if (field.key === 'source_api') return interfaceMeta.apiPath || '';
  if (field.key === 'raw_json' || field.sourcePath === '') return item;
  return getValueByPath(item, field.sourcePath || field.key);
}

/**
 * 功能描述：按点分路径读取对象值，用于把接口字段配置映射为飞书记录数据。
 * @param {object} source 源对象
 * @param {string} path 点分路径
 * @return {unknown} 返回路径命中的值
 */
function getValueByPath(source, path) {
  if (!source || !path) return undefined;
  const pathSegments = String(path)
    .replace(/\[\]/g, '.*')
    .replace(/\[\*\]/g, '.*')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  return normalizePathResult(resolvePathSegments(source, pathSegments));
}

/**
 * 功能描述：递归解析字段路径，支持 * 通配数组。
 * @param {unknown} current 当前对象或数组
 * @param {Array<string>} segments 剩余路径片段
 * @return {unknown} 返回路径命中的值
 */
function resolvePathSegments(current, segments) {
  if (current === undefined || current === null) return undefined;
  if (segments.length === 0) return current;

  const [key, ...rest] = segments;
  if (key === '*') {
    if (!Array.isArray(current)) return undefined;
    return current.map((item) => resolvePathSegments(item, rest));
  }

  if (Array.isArray(current) && !Number.isInteger(Number(key))) {
    return current.map((item) => resolvePathSegments(item, segments));
  }

  return resolvePathSegments(current[key], rest);
}

/**
 * 功能描述：清理通配路径返回值，去掉空数组层级。
 * @param {unknown} value 原始路径结果
 * @return {unknown} 返回清理后的结果
 */
function normalizePathResult(value) {
  if (!Array.isArray(value)) return value;
  const flattened = flattenArray(value).filter((item) => item !== undefined && item !== null);
  if (flattened.length === 0) return undefined;
  return flattened;
}

/**
 * 功能描述：递归拉平数组。
 * @param {Array<unknown>} values 原始数组
 * @return {Array<unknown>} 拉平后的数组
 */
function flattenArray(values) {
  return values.reduce((result, value) => (
    result.concat(Array.isArray(value) ? flattenArray(value) : value)
  ), []);
}

/**
 * 功能描述：为数据库接口字段生成 Mock 值，保证开发调试时字段映射与真实接口字段保持一致。
 * @param {object} field 字段配置
 * @param {number} index 记录序号
 * @param {number} now 当前模拟时间戳
 * @param {string} recordId 模拟记录 ID
 * @return {unknown} 返回符合字段类型的 Mock 值
 */
function buildMockDoudianFieldValue(field, index, now, recordId) {
  if (field.isPrimary) return recordId;
  if (field.type === 'DateTime' || field.fieldType === 5) return now;
  if (isPriceFieldType(field.type)) return Number((((index + 1) * 1999) / 100).toFixed(2));
  if (field.type === 'Number' || field.fieldType === 2) return index + 1;
  if (field.fieldType === 10 || isLinkLikeFieldType(field.type)) {
    return `https://example.com/doudian/${encodeURIComponent(field.key || 'file')}/${index + 1}`;
  }
  const fieldName = field.fieldName || field.key;
  return `${fieldName}_${index + 1}`;
}

module.exports = { getTableRecords };
