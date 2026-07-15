const CONNECTOR_PRIMARY_FIELD = Object.freeze({
  key: 'sys_record_id',
  label: '连接器记录ID',
  fieldName: '连接器记录ID',
  type: 'Text',
  fieldType: 1,
  defaultField: 'sys_record_id',
  description: '连接器生成的同步记录主键',
  isPrimary: true,
  isConnectorField: true,
  isConnectorPrimary: true
});

const ACCOUNT_NAME_FIELD = Object.freeze({
  key: 'sys_name',
  label: '同步账号',
  fieldName: '同步账号',
  type: 'Text',
  fieldType: 1,
  defaultField: 'sys_name',
  description: '当前执行同步的抖店账号名称',
  isConnectorField: true
});

/**
 * 功能描述：把连接器生成的公共字段追加到抖店接口字段列表中。
 * @param {Array<object>} fields 抖店接口字段列表
 * @return {Array<object>} 返回包含公共字段的新数组
 */
function appendConnectorFields(fields = []) {
  const safeFields = Array.isArray(fields) ? fields.map((field) => ({
    ...field,
    isPrimary: false,
    isConnectorPrimary: false
  })) : [];
  const fieldsWithoutConnectorReserved = safeFields.filter((field) => !isConnectorReservedField(field));
  return [
    CONNECTOR_PRIMARY_FIELD,
    ...fieldsWithoutConnectorReserved,
    ACCOUNT_NAME_FIELD
  ];
}

/**
 * 功能描述：判断字段是否占用了连接器内部字段 ID。
 * @param {object} field 字段配置
 * @return {boolean} 返回是否为连接器保留字段
 */
function isConnectorReservedField(field) {
  return [
    CONNECTOR_PRIMARY_FIELD,
    ACCOUNT_NAME_FIELD
  ].some((connectorField) => (
    field?.key === connectorField.key ||
    field?.defaultField === connectorField.defaultField ||
    field?.fieldId === connectorField.defaultField
  ));
}

module.exports = {
  CONNECTOR_PRIMARY_FIELD,
  ACCOUNT_NAME_FIELD,
  appendConnectorFields,
  isConnectorReservedField
};
