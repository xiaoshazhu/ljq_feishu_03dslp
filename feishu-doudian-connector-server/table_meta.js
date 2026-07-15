const {
  getDoudianInterfaceByKey
} = require('./database.js');
const {
  isDoudianInterfaceModule,
  getInterfaceKeyFromModule
} = require('./doudian_interface_utils.js');
const {
  ACCOUNT_NAME_FIELD,
  appendConnectorFields
} = require('./connector_fields.js');

/**
 * 功能描述：获取飞书多维表格连接器的数据字段元信息，并追加账号名称等连接器公共字段。
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

  const interfaceFields = Array.isArray(interfaceMeta.fieldsSchema) ? interfaceMeta.fieldsSchema : [];
  if (interfaceFields.length === 0) {
    throw new Error(`DoudianFieldsSchemaMissing: 当前接口缺少 fields_schema (${interfaceMeta.interfaceKey})`);
  }
  const reservedField = interfaceFields.find((field) => (
    field?.key === ACCOUNT_NAME_FIELD.key ||
    field?.defaultField === ACCOUNT_NAME_FIELD.defaultField ||
    field?.fieldId === ACCOUNT_NAME_FIELD.defaultField
  ));
  if (reservedField) {
    throw new Error(
      `DoudianFieldSchemaInvalid: 接口 ${interfaceMeta.interfaceKey} 占用了连接器保留字段 ${ACCOUNT_NAME_FIELD.defaultField}`
    );
  }
  const fields = appendConnectorFields(interfaceFields);
  const selectedFields = filterModuleFieldsByConfig(fields, config);
  const primaryFields = selectedFields.filter((field) => field.isPrimary === true);
  if (primaryFields.length !== 1) {
    throw new Error(
      `DoudianPrimaryFieldInvalid: 接口 ${interfaceMeta.interfaceKey} 必须且只能配置一个主键字段，当前为 ${primaryFields.length} 个`
    );
  }
  const convertedFields = ensureConnectorFieldNamesUnique(
    selectedFields.map((field) => convertModuleFieldToBitableField(field, config))
  );
  assertValidConvertedFields(convertedFields, interfaceMeta.interfaceKey);
  return {
    tableName: `抖店-${interfaceMeta.interfaceName}`,
    fields: convertedFields
  };
};

/**
 * 功能描述：当连接器公共列被旧配置命名成业务列同名时，自动改为稳定且不重复的公共列名。
 * @param {Array<object>} fields 已转换的飞书字段
 * @return {Array<object>} 返回字段名不冲突的表结构字段
 */
function ensureConnectorFieldNamesUnique(fields) {
  const usedBusinessNames = new Set(
    fields
      .filter((field) => field.isConnectorField !== true)
      .map((field) => String(field.fieldName || '').trim())
      .filter(Boolean)
  );
  const usedNames = new Set(usedBusinessNames);

  return fields.map((field) => {
    const fieldName = String(field.fieldName || '').trim();
    if (field.isConnectorField !== true) {
      return field;
    }
    if (fieldName && !usedBusinessNames.has(fieldName) && !usedNames.has(fieldName)) {
      usedNames.add(fieldName);
      return field;
    }

    const uniqueName = resolveUniqueConnectorFieldName(usedNames);
    usedNames.add(uniqueName);
    return {
      ...field,
      fieldName: uniqueName
    };
  });
}

/**
 * 功能描述：基于连接器公共列默认名生成不与现有字段冲突的列名。
 * @param {Set<string>} usedNames 已占用字段名集合
 * @return {string} 返回可安全用于飞书表结构的字段名
 */
function resolveUniqueConnectorFieldName(usedNames) {
  const baseName = String(ACCOUNT_NAME_FIELD.fieldName || ACCOUNT_NAME_FIELD.label || '同步账号').trim();
  if (!usedNames.has(baseName)) return baseName;
  let index = 2;
  while (usedNames.has(`${baseName} ${index}`)) {
    index += 1;
  }
  return `${baseName} ${index}`;
}

/**
 * 功能描述：校验飞书表结构中的字段 ID、字段名均非空且互不重复。
 * @param {Array<object>} fields 已转换的飞书字段
 * @param {string} interfaceKey 接口标识
 * @return {void} 无返回值
 */
function assertValidConvertedFields(fields, interfaceKey) {
  const fieldIds = new Set();
  const fieldNames = new Set();
  fields.forEach((field) => {
    const fieldId = String(field.fieldId || '').trim();
    const fieldName = String(field.fieldName || '').trim();
    if (!fieldId || !fieldName) {
      throw new Error(
        `DoudianFieldSchemaInvalid: 接口 ${interfaceKey} 存在空字段 ID 或字段名`
      );
    }
    if (fieldIds.has(fieldId)) {
      throw new Error(
        `DoudianFieldSchemaInvalid: 接口 ${interfaceKey} 存在重复字段 ID ${fieldId}`
      );
    }
    if (fieldNames.has(fieldName)) {
      throw new Error(
        `DoudianFieldSchemaInvalid: 接口 ${interfaceKey} 存在重复字段名 ${fieldName}`
      );
    }
    fieldIds.add(fieldId);
    fieldNames.add(fieldName);
  });
}

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
    fieldName: resolveTargetFieldName(config, field),
    fieldType,
    isPrimary: field.isPrimary === true,
    description: field.description || field.label || field.key,
    isConnectorField: field.isConnectorField === true
  };
  if (fieldType === 5) {
    result.property = {
      formatter: field.formatter || 'yyyy-MM-dd HH:mm'
    };
  }
  return result;
}

/**
 * 功能描述：读取当前任务自定义的目标列名，未配置时回退数据库字段名称。
 * @param {object} config 前端保存的同步配置
 * @param {object} field 数据库字段配置
 * @return {string} 返回当前任务实际使用的目标列名
 */
function resolveTargetFieldName(config, field) {
  const targetFieldNames = config.targetFieldNames && typeof config.targetFieldNames === 'object'
    ? config.targetFieldNames
    : {};
  const customName = targetFieldNames[field.key];
  if (typeof customName === 'string' && customName.trim()) {
    return customName.trim();
  }
  return field.fieldName || String(field.label || field.key).trim();
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
    return fields.filter((field) => (
      field.isConnectorField ||
      field.isPrimary === true ||
      selectedFieldKeys.has(field.key)
    ));
  }

  const mappings = getFieldMappings(config);
  const mappingKeys = Object.keys(mappings);
  if (mappingKeys.length > 0) {
    return fields.filter((field) => (
      field.isConnectorField ||
      field.isPrimary === true ||
      (Object.prototype.hasOwnProperty.call(mappings, field.key) && Boolean(mappings[field.key]))
    ));
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
