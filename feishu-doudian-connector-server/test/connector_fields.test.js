const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONNECTOR_PRIMARY_FIELD,
  ACCOUNT_NAME_FIELD,
  appendConnectorFields
} = require('../connector_fields.js');

test('连接器字段始终补充第一列主键，并忽略数据库字段 isPrimary', () => {
  const fields = appendConnectorFields([
    {
      key: 'order_id',
      label: '订单ID',
      defaultField: 'order_id',
      isPrimary: true
    },
    {
      key: 'amount',
      label: '金额',
      defaultField: 'amount'
    }
  ]);

  assert.equal(fields[0].key, CONNECTOR_PRIMARY_FIELD.key);
  assert.equal(fields[0].isPrimary, true);
  assert.equal(fields[0].isConnectorPrimary, true);
  assert.equal(fields[1].key, ACCOUNT_NAME_FIELD.key);
  assert.equal(fields[2].key, 'order_id');
  assert.equal(fields[2].isPrimary, false);
  assert.equal(fields[2].isConnectorPrimary, false);
});
