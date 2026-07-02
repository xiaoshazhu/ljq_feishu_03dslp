<template>
  <section class="form-section account-detail-panel">
    <div class="account-detail-header">
      <div>
        <div class="account-detail-title">账号详情</div>
        <div class="section-note account-detail-note">
          展示当前可见的全部账号，包含个人账号和企业共享账号。只有创建该账号的用户才能删除。
        </div>
      </div>
      <a-button type="primary" @click="$emit('add')">新增账号</a-button>
    </div>

    <div class="account-detail-stats">
      <div class="account-stat-card">
        <div class="account-stat-label">可见账号</div>
        <div class="account-stat-value">{{ accounts.length }}</div>
      </div>
      <div class="account-stat-card">
        <div class="account-stat-label">当前启用</div>
        <div class="account-stat-value">{{ activeCount }}</div>
      </div>
      <div class="account-stat-card">
        <div class="account-stat-label">企业共享</div>
        <div class="account-stat-value">{{ companyCount }}</div>
      </div>
      <div class="account-stat-card">
        <div class="account-stat-label">个人账号</div>
        <div class="account-stat-value">{{ privateCount }}</div>
      </div>
    </div>

    <div class="account-detail-list">
      <div
        v-for="account in accounts"
        :key="account.key"
        class="account-detail-card"
        :class="{ 'is-active': account.isActive }"
      >
        <div class="account-detail-card-top">
          <div class="account-detail-main">
            <div class="account-name">{{ account.name }}</div>
<!--            <div class="account-module">{{ getModuleLabel(account.module) }}</div>-->
          </div>
          <div class="account-detail-tags">
            <span v-if="account.isActive" class="account-current-badge">当前使用</span>
            <span class="table-tag">{{ account.mode }}</span>
            <span
              class="account-visibility-tag"
              :class="account.shareScope === 'private' ? 'visibility-private' : 'visibility-company'"
            >
              {{ account.shareScope === 'private' ? '个人账号' : '企业共享' }}
            </span>
          </div>
        </div>

        <div class="account-detail-meta">
          <span class="table-status" :class="account.status === 'active' ? 'status-ok' : 'status-error'">
            {{ account.status === 'active' ? '正常 (长效保活中)' : '凭证失效 (Cookie 过期)' }}
          </span>
          <span v-if="account.shopId" class="account-summary-shop">Shop ID: {{ account.shopId }}</span>
        </div>

        <div class="account-detail-actions">
          <a-radio :checked="account.isActive" @change="$emit('set-active', account.key)">设为当前账号</a-radio>
          <a-space>
            <a @click="$emit('edit', account)">修改</a>
            <a
              v-if="account.userId === currentUserId"
              style="color: #ff4d4f"
              @click="$emit('delete', account)"
            >
              删除
            </a>
            <span v-else class="account-action-disabled">仅创建人可删除</span>
          </a-space>
        </div>
      </div>
    </div>

    <div class="sync-log-section">
      <div class="sync-log-header">
        <div>
          <div class="account-detail-title sync-log-title">同步日志</div>
          <div class="section-note account-detail-note">展示最近的同步执行结果，可以按状态筛选。</div>
        </div>
        <div class="sync-log-toolbar">
          <a-select
            :value="logStatusFilter"
            style="width: 140px"
            :options="statusOptions"
            @change="$emit('change-log-filter', $event)"
          />
          <a-button @click="$emit('refresh-logs')">刷新</a-button>
        </div>
      </div>

      <div v-if="logs.length" class="sync-log-card-list">
        <div v-for="log in logs" :key="log.id" class="sync-log-card">
          <div class="sync-log-card-top">
            <div class="sync-log-main">
              <div class="sync-log-name-row">
                <div class="sync-log-name">{{ log.accountName || '未命名账号' }}</div>
                <span class="sync-log-status" :class="`sync-log-${log.status}`">
                  {{ statusLabelMap[log.status] || log.status }}
                </span>
              </div>
              <div class="account-module">{{ getModuleLabel(log.syncModule) }}</div>
            </div>
          </div>

          <div class="sync-log-metrics">
            <div class="sync-log-metric">
              <span class="sync-log-metric-label">店铺 ID</span>
              <span class="sync-log-metric-value">{{ log.shopId || '-' }}</span>
            </div>
            <div class="sync-log-metric">
              <span class="sync-log-metric-label">记录数</span>
              <span class="sync-log-metric-value">{{ typeof log.recordCount === 'number' ? log.recordCount : '-' }}</span>
            </div>
            <div class="sync-log-metric">
              <span class="sync-log-metric-label">耗时</span>
              <span class="sync-log-metric-value">{{ typeof log.durationMs === 'number' ? formatDuration(log.durationMs) : '-' }}</span>
            </div>
            <div class="sync-log-metric">
              <span class="sync-log-metric-label">开始时间</span>
              <span class="sync-log-metric-value">{{ formatDateTime(log.startedAt) }}</span>
            </div>
          </div>

          <div v-if="log.errorMessage" class="sync-log-error-inline">{{ log.errorMessage }}</div>
        </div>

        <div class="sync-log-pagination-wrap">
          <a-pagination
            :locale="paginationLocale"
            v-model:current="logPagination.current"
            v-model:page-size="logPagination.pageSize"
            :total="logTotal"
            :show-size-changer="true"
            :page-size-options="['3', '10', '20']"
            :show-total="(total: number) => `共 ${total} 条`"
            size="small"
            @change="handlePaginationChange"
            @showSizeChange="handlePageSizeChange"
          />
        </div>
      </div>

      <div v-else class="account-summary-empty">
<!--        <div class="account-summary-empty-title">还没有同步日志</div>-->
        <div class="account-summary-empty-desc">暂无数据</div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type { Account, SyncLog } from '../types/account';

const props = defineProps<{
  accounts: Account[];
  logs: SyncLog[];
  logStatusFilter: string;
  logPage: number;
  logPageSize: number;
  logTotal: number;
  currentUserId: string;
  getModuleLabel: (module?: string) => string;
}>();

const emit = defineEmits<{
  add: [];
  edit: [account: Account];
  delete: [account: Account];
  'set-active': [key: string];
  'refresh-logs': [];
  'change-log-filter': [status: string];
  'change-log-page': [payload: { page: number; pageSize: number }];
}>();

const activeCount = computed(() => props.accounts.filter((item) => item.isActive).length);
const companyCount = computed(() => props.accounts.filter((item) => item.shareScope !== 'private').length);
const privateCount = computed(() => props.accounts.filter((item) => item.shareScope === 'private').length);
const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'running', label: '执行中' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' }
];
const statusLabelMap: Record<string, string> = {
  running: '执行中',
  success: '成功',
  failed: '失败'
};
const paginationLocale = {
  items_per_page: '条/页',
  jump_to: '跳至',
  jump_to_confirm: '确定',
  page: '页',
  prev_page: '上一页',
  next_page: '下一页',
  prev_5: '向前 5 页',
  next_5: '向后 5 页',
  prev_3: '向前 3 页',
  next_3: '向后 3 页'
};
const logPagination = reactive({
  current: props.logPage,
  pageSize: props.logPageSize,
});

watch(() => props.logPage, (value) => {
  logPagination.current = value;
}, { immediate: true });

watch(() => props.logPageSize, (value) => {
  logPagination.pageSize = value;
}, { immediate: true });

watch(() => props.logStatusFilter, () => {
  logPagination.current = 1;
});

function formatDateTime(value?: string): string {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function formatDuration(value: number): string {
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function handlePaginationChange(page: number, pageSize: number): void {
  emit('change-log-page', { page, pageSize });
}

function handlePageSizeChange(page: number, pageSize: number): void {
  emit('change-log-page', { page, pageSize });
}

</script>
