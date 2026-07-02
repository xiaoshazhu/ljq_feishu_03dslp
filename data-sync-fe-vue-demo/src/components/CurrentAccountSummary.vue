<template>
  <div class="account-table-wrap account-summary-panel">
    <div v-if="account" class="account-summary-card">
      <div class="account-summary-main">
        <div class="account-summary-header">
          <div class="account-summary-title-wrap">
            <span class="account-summary-title">当前选择账号</span>
            <span class="account-summary-name">{{ account.name }}</span>
          </div>
          <div class="account-summary-tags">
            <span class="table-tag">{{ account.mode }}</span>
            <span class="account-visibility-tag" :class="visibilityClass">
              {{ visibilityLabel }}
            </span>
          </div>
        </div>

        <div class="account-summary-meta">
<!--          <span class="account-module">{{ moduleLabel }}</span>-->
<!--          <span class="account-summary-divider"></span>-->
          <span class="table-status" :class="account.status === 'active' ? 'status-ok' : 'status-error'">
            {{ account.status === 'active' ? '凭证正常' : '凭证失效' }}
          </span>
<!--          <span v-if="account.shopId" class="account-summary-shop">Shop ID: {{ account.shopId }}</span>-->
        </div>
      </div>

      <div class="account-summary-actions">
        <a-button type="link" @click="$emit('manage')">账号详情</a-button>
        <a-button type="link" @click="$emit('edit', account)">重新连接</a-button>
      </div>
    </div>

    <div v-else class="account-summary-empty">
      <div class="account-summary-empty-title">当前还没有启用账号</div>
      <div class="account-summary-empty-desc">先关联一个账号，再继续配置同步参数。</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Account } from '../types/account';

const props = defineProps<{
  account: Account | null;
  moduleLabel: string;
}>();

defineEmits<{
  manage: [];
  edit: [account: Account];
}>();

const visibilityLabel = computed(() => (
  props.account?.shareScope === 'private' ? '个人账号' : '企业共享'
));

const visibilityClass = computed(() => (
  props.account?.shareScope === 'private' ? 'visibility-private' : 'visibility-company'
));
</script>
