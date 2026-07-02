const {
  getDoudianInterfaceByKey
} = require('./database.js');
const {
  isDoudianInterfaceModule,
  getInterfaceKeyFromModule
} = require('./doudian_interface_utils.js');

/**
 * 功能描述：获取飞书多维表格连接器的数据字段元信息，字段完全来源于 doudian_interfaces.fields_schema。
 * @param {string} module 同步模块标识
 * @param {object} config 前端保存的同步配置
 * @return {object} 返回飞书多维表格定义的数据表 schema
 */
const getTableMeta = async (module, config = {}) => {
  if (!isDoudianInterfaceModule(module)) {
    throw new Error(`DoudianInterfaceRequired: 当前连接器只支持 doudian_interfaces 注册表接口，请重新选择抖店接口 (${module || 'empty'})`);
  }

  const interfaceMeta = await getDoudianInterfaceByKey(getInterfaceKeyFromModule(module));
  if (!interfaceMeta) {
    throw new Error(`DoudianInterfaceNotFound: 当前接口未接入或不存在 (${module})`);
  }

  const fields = Array.isArray(interfaceMeta.fieldsSchema) ? interfaceMeta.fieldsSchema : [];
  if (fields.length === 0) {
    throw new Error(`DoudianFieldsSchemaMissing: 当前接口缺少 fields_schema (${interfaceMeta.interfaceKey})`);
  }
  const selectedFields = filterModuleFieldsByConfig(fields, config);
  return {
    tableName: `抖店-${interfaceMeta.interfaceName}`,
    fields: selectedFields.map((field) => convertModuleFieldToBitableField(field, config))
  };
};

/**
 * 功能描述：将数据库中的字段配置转换为飞书表结构接口字段格式。
 * @param {object} field 数据库字段配置
 * @param {object} config 前端保存的同步配置
 * @return {object} 返回飞书 table_meta 字段对象
 */
function convertModuleFieldToBitableField(field, config = {}) {
  const fieldType = hasEnumValueMap(field) ? 1 : (field.fieldType || getBitableFieldType(field.type));
  const result = {
    fieldId: resolveMappedFieldId(config, field.key, field.defaultField || field.fieldId),
    fieldName: field.fieldName || String(field.label || field.key).replace(/\s*\(.+\)$/, ''),
    fieldType,
    isPrimary: field.isPrimary === true,
    description: field.description || field.label || field.key
  };
  if (fieldType === 5) {
    result.property = {
      formatter: field.formatter || 'yyyy-MM-dd HH:mm'
    };
  }
  return result;
}

/**
 * 功能描述：判断字段是否配置了枚举字典；有字典时按文本列返回给飞书。
 * @param {object} field 数据库字段配置
 * @return {boolean} 返回是否存在枚举映射
 */
function hasEnumValueMap(field) {
  const valueMap = field.valueMap || field.enumMap || field.dict;
  if (!valueMap || typeof valueMap !== 'object') return false;
  if (!Array.isArray(valueMap)) return Object.keys(valueMap).length > 0;
  return valueMap.some((item) => item && typeof item === 'object');
}

/**
 * 功能描述：将前端字段类型转换为飞书表结构接口字段枚举。
 * @param {string} type 前端字段类型
 * @return {number} 返回飞书字段类型枚举
 */
function getBitableFieldType(type) {
  if (type === 'Number' || String(type || '').toLowerCase() === 'price') return 2;
  if (type === 'DateTime') return 5;
  if (isLinkLikeFieldType(type)) return 10;
  return 1;
}

/**
 * 功能描述：判断字段类型是否应在飞书中表现为超链接。
 * @param {string} type 字段类型
 * @return {boolean} 返回是否为链接类字段
 */
function isLinkLikeFieldType(type) {
  return ['Url', 'URL', 'Link', 'Hyperlink', 'ImageUrl', 'VideoUrl'].includes(String(type || ''));
}

/**
 * 功能描述：根据前端字段选择配置裁剪表结构字段。
 * @param {Array<object>} fields 模块完整字段配置
 * @param {object} config 前端保存的同步配置
 * @return {Array<object>} 返回用户选择后的字段配置
 */
function filterModuleFieldsByConfig(fields, config = {}) {
  const selectedFieldKeys = normalizeSelectedFieldKeys(config.selectedFieldKeys);
  if (selectedFieldKeys) {
    return fields.filter((field) => selectedFieldKeys.has(field.key));
  }

  const mappings = getFieldMappings(config);
  const mappingKeys = Object.keys(mappings);
  if (mappingKeys.length > 0) {
    return fields.filter((field) => Object.prototype.hasOwnProperty.call(mappings, field.key) && Boolean(mappings[field.key]));
  }

  return fields;
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
 * 功能描述：安全获取字段映射对象。
 * @param {object} config 前端保存的同步配置
 * @return {object} 返回字段映射
 */
function getFieldMappings(config = {}) {
  return config.fieldMappings && typeof config.fieldMappings === 'object' ? config.fieldMappings : {};
}

/**
 * 功能描述：根据字段映射获取表结构字段 ID。
 * @param {object} config 前端保存的同步配置
 * @param {string} sourceKey 源字段 key
 * @param {string} defaultField 默认字段 ID
 * @return {string} 返回实际字段 ID
 */
function resolveMappedFieldId(config, sourceKey, defaultField) {
  const mappings = getFieldMappings(config);
  const mappedField = mappings[sourceKey];
  return typeof mappedField === 'string' && mappedField.trim() ? mappedField.trim() : defaultField;
}

module.exports = { getTableMeta };
