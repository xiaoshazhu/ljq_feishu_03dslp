const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.CREDENTIAL_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const {
  ENCRYPTED_PREFIX,
  decryptCredential,
  encryptCredential
} = require('../credential_cipher.js');

test('Cookie 凭证可加密并完整解密', () => {
  const plaintext = 'sessionid=secret-value; shop_id=123456';
  const encrypted = encryptCredential(plaintext);
  assert.ok(encrypted.startsWith(ENCRYPTED_PREFIX));
  assert.notEqual(encrypted, plaintext);
  assert.equal(decryptCredential(encrypted), plaintext);
});

test('相同明文每次生成不同密文', () => {
  const plaintext = 'sessionid=same-value';
  assert.notEqual(encryptCredential(plaintext), encryptCredential(plaintext));
});

test('历史明文凭证保持兼容读取', () => {
  assert.equal(decryptCredential('legacy-cookie'), 'legacy-cookie');
});
