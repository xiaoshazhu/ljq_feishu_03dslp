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
  const safeFields = Array.isArray(fields) ? fields : [];
  const matchedIndex = safeFields.findIndex((field) => (
    field?.key === ACCOUNT_NAME_FIELD.key ||
    field?.defaultField === ACCOUNT_NAME_FIELD.defaultField ||
    field?.fieldId === ACCOUNT_NAME_FIELD.defaultField
  ));
  if (matchedIndex < 0) return [...safeFields, ACCOUNT_NAME_FIELD];

  return safeFields.map((field, index) => (
    index === matchedIndex
      ? { ...ACCOUNT_NAME_FIELD, ...field, isConnectorField: true }
      : field
  ));
}

module.exports = {
  ACCOUNT_NAME_FIELD,
  appendConnectorFields
};
