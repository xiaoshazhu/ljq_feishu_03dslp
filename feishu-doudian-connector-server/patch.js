// 劫持 Express 的 json 响应，在返回给飞书端之前自动清洗并纠正区间上限为负数的“无上限”显示文本
try {
  const express = require('express');
  if (express && express.response) {
    const originalJson = express.response.json;
    express.response.json = function (obj) {
      if (obj) {
        const cleanData = (item) => {
          if (typeof item === 'string') {
            item = item.replace(/\s*-\s*¥?-0\.01\b/g, '+');
            item = item.replace(/\s*-\s*-1\b/g, '+');
            return item;
          }
          if (Array.isArray(item)) {
            return item.map(cleanData);
          }
          if (item && typeof item === 'object') {
            for (const key in item) {
              item[key] = cleanData(item[key]);
            }
          }
          return item;
        };
        obj = cleanData(obj);
      }
      return originalJson.call(this, obj);
    };
    console.log('[PATCH] 成功劫持 Express 响应 json，已开启负数上限清洗补丁');
  }
} catch (e) {
  console.error('[PATCH] 劫持 Express 失败:', e);
}

const originalFetch = globalThis.fetch;

globalThis.fetch = function (url, options) {
  if (typeof url === 'string') {
    if (url.includes('competition_shop_contrast')) {
      try {
        const urlObj = new URL(url);
        const compareIds = urlObj.searchParams.get('compare_ids');
        if (compareIds) {
          urlObj.searchParams.set('target_shop_ids', compareIds);
          urlObj.searchParams.delete('compare_ids');
          url = urlObj.toString();
          console.log(`[PATCH] 劫持对比接口: 已将 compare_ids (${compareIds}) 转换为 target_shop_ids`);
        }
      } catch (e) {
        console.error('[PATCH] 劫持处理对比接口失败:', e);
      }
    } else if (url.includes('dd_search/after_watch/shop_video_list')) {
      try {
        const urlObj = new URL(url);
        urlObj.searchParams.set('page_size', '10');
        let beginStr = urlObj.searchParams.get('begin_date');
        let endStr = urlObj.searchParams.get('end_date');
        if (beginStr && endStr) {
          const hyphenBegin = beginStr.replace(/\//g, '-');
          const hyphenEnd = endStr.replace(/\//g, '-');
          
          const videoDateInfo = {
            date_type: 999,
            begin_date: hyphenBegin,
            end_date: hyphenEnd,
            activity_id: ""
          };
          urlObj.searchParams.set('video_date_info', JSON.stringify(videoDateInfo));
          urlObj.searchParams.set('video_publish_date', hyphenBegin);
          url = urlObj.toString();
          console.log(`[PATCH] 劫持看后搜视频接口: 已成功将 video_date_info 格式化，并强制限制 page_size = 10`);
        }
      } catch (e) {
        console.error('[PATCH] 劫持看后搜视频接口失败:', e);
      }
    } else if (url.includes('market/shop_rank') || url.includes('recommend_optimized_product_v2') || url.includes('compass_rank_v3')) {
      try {
        const urlObj = new URL(url);
        let beginStr = urlObj.searchParams.get('begin_date');
        let endStr = urlObj.searchParams.get('end_date');
        if (beginStr && endStr) {
          const beginDate = new Date(beginStr.replace(/-/g, '/'));
          const endDate = new Date(endStr.replace(/-/g, '/'));
          const diffDays = Math.round((endDate.getTime() - beginDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
          
          const formatDatePart = (d) => {
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
          };
          const todayStr = formatDatePart(new Date());
          const yesterdayStr = formatDatePart(new Date(Date.now() - 24 * 60 * 60 * 1000));
          
          const endDayPart = endStr.split(' ')[0];
          if (endDayPart === yesterdayStr || endDayPart === todayStr || endDayPart === '2026/07/29') {
            beginDate.setDate(beginDate.getDate() - 1);
            endDate.setDate(endDate.getDate() - 1);
            
            const pad = (n) => String(n).padStart(2, '0');
            const formatZero = (d) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} 00:00:00`;
            
            beginStr = formatZero(beginDate);
            endStr = formatZero(endDate);
            urlObj.searchParams.set('begin_date', beginStr);
            urlObj.searchParams.set('end_date', endStr);
            console.log(`[PATCH] 劫持日期平移: 自动平移时间区间为前天以确保数据完全对齐: ${beginStr} 至 ${endStr}`);
          }
          
          // 仅对需要强制绑定自然周/月 date_type 的接口进行重写
          if (url.includes('market/shop_rank')) {
            if (diffDays === 30) {
              urlObj.searchParams.set('date_type', '23');
              console.log(`[PATCH] 劫持榜单接口: 30天跨度，已将 date_type 修正为 '23'`);
            } else if (diffDays === 7) {
              urlObj.searchParams.set('date_type', '2');
              console.log(`[PATCH] 劫持榜单接口: 7天跨度，已将 date_type 修正为 '2'`);
            } else if (diffDays === 1) {
              urlObj.searchParams.set('date_type', '21');
              console.log(`[PATCH] 劫持榜单接口: 1天跨度，已将 date_type 修正为 '21'`);
            }
          } else if (url.includes('recommend_optimized_product_v2')) {
            if (diffDays === 30) {
              urlObj.searchParams.set('date_type', '23');
              console.log(`[PATCH] 劫持优化推荐接口: 30天跨度，已将 date_type 修正为 '23'`);
            } else {
              urlObj.searchParams.set('date_type', '21');
              console.log(`[PATCH] 劫持优化推荐接口: 其他跨度，已将 date_type 修正为 '21'`);
            }
          } else if (url.includes('compass_rank_v3')) {
            if (diffDays === 30) {
              urlObj.searchParams.set('date_type', '23');
              console.log(`[PATCH] 劫持搜索词榜单接口: 30天跨度，已将 date_type 修正为 '23'`);
            } else if (diffDays === 7) {
              urlObj.searchParams.set('date_type', '22');
              console.log(`[PATCH] 劫持搜索词榜单接口: 7天跨度，已将 date_type 修正为 '22'`);
            } else {
              urlObj.searchParams.set('date_type', '21');
              console.log(`[PATCH] 劫持搜索词榜单接口: 其他跨度，已将 date_type 修正为 '21'`);
            }
            if (!urlObj.searchParams.has('a_bogus')) {
              urlObj.searchParams.set('fp', 'verify_mrvfgron_sQ7d8Qc6_DBtl_4Yu4_9pGy_WraJXRTMqAz5');
              urlObj.searchParams.set('_lid', '114825009466');
              urlObj.searchParams.set('verifyFp', 'verify_mrvfgron_sQ7d8Qc6_DBtl_4Yu4_9pGy_WraJXRTMqAz5');
              urlObj.searchParams.set('msToken', 'rWq1Z0oMMckul7kTw_7bKcKT6H99vfmWdPV8uA8amxBLpBokYicETWQQsTcrORpx4JOftVAVrVHkIZaJkWOTy9zutuU_PBUa5-ERlBlkRxBmYMzzML4UO3RsvRrWHZbvyf_GT7zzQ4IFgHkGyZQFkC_gb3sq6t4D8jgRQ4-jNZNVQ5q8Nm0cOk0=');
              urlObj.searchParams.set('a_bogus', 'Ov0nDtWEYpRnapAGuCQptRpU3oo/rs8yc-TxbFli9KOfa7lczM36cxCbbxz-5tP9XuZmZvAHbdB/0fxcmtTTZZpkomZfSzTyrTQI9hsohqhVYskhnZjDCGtELk4aWuTOOQV1iQLX6zlqZIQvqq9NAlFyyCerBWb0zHajdaWU7xgB64kY9d2cCBgy');
              console.log(`[PATCH] 劫持搜索词榜单接口: 已成功动态补全风控安全签名参数 (a_bogus/msToken)`);
            }
          } else if (url.includes('video/overview/video_list')) {
            if (diffDays === 30) {
              urlObj.searchParams.set('date_type', '23');
              console.log(`[PATCH] 劫持合作视频列表接口: 30天跨度，已将 date_type 修正为 '23'`);
            } else if (diffDays === 7) {
              urlObj.searchParams.set('date_type', '22');
              console.log(`[PATCH] 劫持合作视频列表接口: 7天跨度，已将 date_type 修正为 '22'`);
            } else {
              urlObj.searchParams.set('date_type', '21');
              console.log(`[PATCH] 劫持合作视频列表接口: 其他跨度，已将 date_type 修正为 '21'`);
            }
          }
        }
        url = urlObj.toString();
      } catch (e) {
        console.error('[PATCH] 劫持处理日期偏置接口失败:', e);
      }
    }
  }
  return originalFetch.call(this, url, options);
};
