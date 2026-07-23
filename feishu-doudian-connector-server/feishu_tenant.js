/**
 * @module FeishuTenant
 * 功能描述：调用飞书开放平台 API 获取当前企业/租户信息。
 */

let cachedAccessToken = '';
let accessTokenExpireAt = 0;
let cachedTenantName = '';
let tenantNameExpireAt = 0;

/**
 * 获取内部应用的 tenant_access_token
 */
async function getTenantAccessToken() {
  const appId = String(process.env.FEISHU_APP_ID || '').trim();
  const appSecret = String(process.env.FEISHU_APP_SECRET || '').trim();

  if (!appId || !appSecret) {
    return '';
  }

  const now = Date.now();
  if (cachedAccessToken && now < accessTokenExpireAt) {
    return cachedAccessToken;
  }

  try {
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret
      })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(data.msg || `code ${data.code}`);
    }

    cachedAccessToken = data.tenant_access_token;
    // 提前 5 分钟刷新
    const expireIn = Number(data.expire || 7200);
    accessTokenExpireAt = now + Math.max(60, expireIn - 300) * 1000;
    return cachedAccessToken;
  } catch (error) {
    console.warn('[Feishu Tenant] 获取 tenant_access_token 失败:', error.message);
    return '';
  }
}

/**
 * 获取当前企业/租户名称
 * @return {Promise<string>} 返回企业名称，获取失败时返回空字符串
 */
async function getFeishuTenantName() {
  const now = Date.now();
  if (cachedTenantName && now < tenantNameExpireAt) {
    return cachedTenantName;
  }

  const token = await getTenantAccessToken();
  if (!token) {
    return '';
  }

  try {
    const res = await fetch('https://open.feishu.cn/open-apis/tenant/v2/tenant/query', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(data.msg || `code ${data.code}`);
    }

    const tenant = data.tenant || data.data?.tenant || {};
    const name = String(tenant.name || '').trim();
    if (name) {
      cachedTenantName = name;
      // 缓存企业名称 10 分钟
      tenantNameExpireAt = now + 10 * 60 * 1000;
    }
    return name;
  } catch (error) {
    console.warn('[Feishu Tenant] 获取企业信息失败:', error.message);
    return '';
  }
}

module.exports = {
  getFeishuTenantName
};
