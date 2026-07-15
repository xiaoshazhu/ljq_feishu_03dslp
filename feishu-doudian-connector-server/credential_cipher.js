const crypto = require('crypto');
const { isProduction } = require('./runtime_config.js');

const ENCRYPTED_PREFIX = 'enc:v1:';

/**
 * 功能描述：把环境变量中的凭证加密密钥归一化为 AES-256 所需的 32 字节 Key。
 * @return {Buffer|null} 返回加密 Key，未配置时返回 null
 */
function getEncryptionKey() {
  const rawKey = String(process.env.CREDENTIAL_ENCRYPTION_KEY || '').trim();
  if (!rawKey) return null;

  if (/^[a-f0-9]{64}$/i.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }

  try {
    const decoded = Buffer.from(rawKey, 'base64');
    if (decoded.length === 32 && decoded.toString('base64').replace(/=+$/, '') === rawKey.replace(/=+$/, '')) {
      return decoded;
    }
  } catch (error) {
    // 非 Base64 密钥会在下方通过 SHA-256 派生为固定长度。
  }

  return crypto.createHash('sha256').update(rawKey, 'utf8').digest();
}

/**
 * 功能描述：判断当前是否已配置凭证加密能力。
 * @return {boolean} 返回是否已配置加密密钥
 */
function isCredentialEncryptionEnabled() {
  return Boolean(getEncryptionKey());
}

/**
 * 功能描述：加密 Cookie 等敏感凭证，使用 AES-256-GCM 同时保证机密性与完整性。
 * @param {string} value 原始敏感值
 * @return {string} 返回带版本前缀的密文
 */
function encryptCredential(value) {
  const text = String(value || '');
  if (!text || text.startsWith(ENCRYPTED_PREFIX)) return text;

  const key = getEncryptionKey();
  if (!key) {
    if (isProduction()) {
      throw new Error('CredentialEncryptionUnavailable: 生产环境未配置凭证加密密钥');
    }
    return text;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

/**
 * 功能描述：解密数据库中的敏感凭证，并兼容尚未迁移的历史明文。
 * @param {string} value 数据库存储值
 * @return {string} 返回解密后的原始凭证
 */
function decryptCredential(value) {
  const text = String(value || '');
  if (!text || !text.startsWith(ENCRYPTED_PREFIX)) return text;

  const key = getEncryptionKey();
  if (!key) {
    throw new Error('CredentialDecryptionUnavailable: 缺少凭证解密密钥');
  }

  const parts = text.slice(ENCRYPTED_PREFIX.length).split('.');
  if (parts.length !== 3) {
    throw new Error('CredentialCiphertextInvalid: 凭证密文格式非法');
  }

  const [ivText, tagText, encryptedText] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

module.exports = {
  ENCRYPTED_PREFIX,
  decryptCredential,
  encryptCredential,
  isCredentialEncryptionEnabled
};
