<template>
  <a-spin :spinning="isInitializing" tip="正在加载连接器配置...">
    <div class="connector-container">
      <div class="page-shell">
        <div class="page-body">
          <aside class="left-sidebar">
            <div class="sidebar-header">

              <div class="header-tabs">
                <button
                  type="button"
                  class="header-tab"
                  :class="{ active: pageTab === 'config' }"
                  @click="pageTab = 'config'"
                >
                  配置信息
                </button>
                <button
                  type="button"
                  class="header-tab"
                  :class="{ active: pageTab === 'accounts' }"
                  @click="pageTab = 'accounts'"
                >
                  账号详情
                </button>
              </div>
            </div>

            <nav v-if="pageTab === 'config'" class="sidebar-nav">
              <div
                v-for="item in navItems"
                :key="item.key"
                class="nav-item"
                :class="{ active: activeMenu === item.key }"
                @click="scrollToSection(item.key)"
              >
                <span class="nav-badge">{{ item.step }}</span>
                <div class="nav-copy">
                  <div class="nav-label">{{ item.label }}</div>
                  <div class="nav-desc">{{ item.desc }}</div>
                </div>
              </div>
            </nav>
            <nav v-else class="sidebar-nav">
              <div
                v-for="item in accountNavItems"
                :key="item.key"
                class="nav-item"
                :class="{ active: activeAccountMenu === item.key }"
                @click="scrollToAccountSection(item.key)"
              >
                <span class="nav-badge">{{ item.step }}</span>
                <div class="nav-copy">
                  <div class="nav-label">{{ item.label }}</div>
                  <div class="nav-desc">{{ item.desc }}</div>
                </div>
              </div>
            </nav>
          </aside>

          <main
            v-if="pageTab === 'config'"
            ref="scrollContainerRef"
            class="right-content"
            :class="{ 'dropdown-scroll-locked': isModuleDropdownOpen }"
            @scroll="handleScroll"
          >
            <section id="section-account" class="form-section">
              <div class="section-header">
                <span class="section-step">1</span>
                <span>配置账号</span>
              </div>
              <div class="account-link-card" @click="openAccountModal()">
                <div class="account-link-icon">+</div>
                <div class="account-link-text">关联账号</div>
              </div>

              <CurrentAccountSummary
                :account="currentSelectedAccount"
                :module-label="currentSelectedAccount ? getAccountModuleLabel(currentSelectedAccount.module) : '未绑定同步模块'"
                @manage="pageTab = 'accounts'"
                @edit="openAccountModal"
              />
            </section>

            <section id="section-datasource" class="form-section">
              <div class="section-header between">
                <div class="section-title-inline">
                  <span class="section-step">2</span>
                  <span>数据源选择</span>
                </div>
<!--                <a-button-->
<!--                  class="toolbar-button"-->
<!--                  size="small"-->
<!--                  :loading="isRefreshingInterfaces"-->
<!--                  @click="handleRefreshDoudianInterfaces"-->
<!--                >-->
<!--                  <template #icon><ReloadOutlined /></template>-->
<!--                  刷新配置-->
<!--                </a-button>-->
              </div>
<!--              <div class="section-note">选择要同步的抖店数据源，保持当前检索方式，便于大批量接口场景使用。</div>-->
              <a-tree-select
                v-model:value="syncModuleSelectValue"
                show-search
                tree-node-filter-prop="title"
                style="width: 100%"
                :dropdown-style="{ maxHeight: '400px', overflow: 'auto' }"
                placeholder="请选择目标同步动作 / 模块"
                tree-default-expand-all
                tree-node-label-prop="title"
                :tree-data="moduleTreeData"
                @dropdownVisibleChange="handleModuleDropdownVisibleChange"
              />
            </section>

            <section id="section-params" class="form-section">
              <div class="section-header">
                <span class="section-step">3</span>
                <span>参数设置</span>
              </div>
              <a-form layout="vertical" class="section-form">
                <a-form-item label="店铺" required>
                  <a-input v-model:value="shopIdParam" placeholder="请输入数字格式的抖音店铺 ID，例如：982734" />
                </a-form-item>

                <div class="test-connection-row">
                  <a-button :loading="isTestingConnection" @click="handleTestConnection">测试连接</a-button>
                  <span v-if="testConnectionResult" class="test-result">{{ testConnectionResult }}</span>
                </div>

                <a-form-item v-if="hasDateRangeMapping" label="同步时间范围" required>
                  <a-select v-model:value="dateRange" :options="dateRangeOptions" />
                </a-form-item>

                <template v-if="customQueryFields.length > 0">
                  <a-form-item
                    v-for="field in customQueryFields"
                    :key="field.name"
                    :label="field.label || field.name"
                    :required="field.required"
                  >
                    <a-input-number
                      v-if="!hasCustomQueryOptions(field) && isNumericCustomQueryField(field)"
                      style="width: 100%"
                      :min="getCustomQueryFieldType(field) === 'integer' ? 0 : undefined"
                      :precision="getCustomQueryFieldType(field) === 'integer' ? 0 : undefined"
                      :placeholder="field.placeholder || `请输入 ${field.label || field.name}`"
                      :value="getNumericCustomQueryFieldValue(field.name)"
                      @update:value="handleCustomQueryValueChange(field.name, $event)"
                    />
                    <a-select
                      v-else-if="!hasCustomQueryOptions(field) && getCustomQueryFieldType(field) === 'boolean'"
                      style="width: 100%"
                      :placeholder="field.placeholder || `请选择 ${field.label || field.name}`"
                      :options="booleanCustomQueryOptions"
                      :value="getBooleanCustomQueryFieldValue(field.name)"
                      @update:value="handleCustomQueryValueChange(field.name, $event)"
                    />
                    <a-select
                      v-else-if="hasCustomQueryOptions(field)"
                      style="width: 100%"
                      :placeholder="field.placeholder || `请选择 ${field.label || field.name}`"
                      :options="field.options"
                      :value="getCustomQueryFieldValue(field.name)"
                      allow-clear
                      @update:value="handleCustomQueryValueChange(field.name, $event)"
                    />
                    <a-input
                      v-else
                      :value="getStringCustomQueryFieldValue(field.name)"
                      :placeholder="field.placeholder || `请输入 ${field.label || field.name}`"
                      @update:value="handleCustomQueryValueChange(field.name, $event)"
                    />
                    <div v-if="field.helpText" class="query-field-help">{{ field.helpText }}</div>
                  </a-form-item>
                </template>
              </a-form>
            </section>

            <section id="section-fields" class="form-section">
              <div class="section-header between">
                <div class="section-title-inline">
                  <span class="section-step">4</span>
                  <span>字段设置</span>
                </div>
                <div class="field-toolbar">
                  <span class="field-selected-count">已选择 {{ selectedFieldCount }} / {{ currentModuleFields.length }}</span>
                  <a-button class="toolbar-button"  @click="handleClearFieldSelection">
                    <template #icon><ClearOutlined /></template>
                    清空
                  </a-button>
                  <a-button class="toolbar-button primary" type="primary"  @click="handleAutoMapFields">
                    <template #icon><CheckSquareOutlined /></template>
                    全选映射
                  </a-button>
                </div>
              </div>
              <div class="section-note">配置字段映射规则</div>
              <div class="field-table-wrap">
                <table class="field-map-table">
                  <colgroup>
                    <col class="field-col-sync" />
                    <col class="field-col-source" />
                    <col class="field-col-target" />
                    <col class="field-col-name" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>是否同步</th>
                      <th>源数据字段</th>
                      <th>目标多维表格映射列</th>
                      <th>目标列名称</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="field in currentModuleFields"
                      :key="field.key"
                      :class="{ 'field-row-disabled': !isFieldSelected(field.key) }"
                    >
                      <td>
                        <a-checkbox
                          :checked="isFieldSelected(field.key)"
                          @change="handleFieldSyncToggle(field.key, $event.target.checked)"
                        />
                      </td>
                      <td class="field-label-cell">{{ field.label }}</td>
                      <td>
                        <a-select
                          class="field-target-select"
                          placeholder="选择要写入的列"
                          :value="fieldMappings[field.key]"
                          :options="bitableFields"
                          :disabled="!isFieldSelected(field.key)"
                          :allow-clear="true"
                          @change="handleFieldSelectChange(field.key, $event)"
                        />
                      </td>
                      <td>
                        <a-input
                          v-model:value="targetFieldNames[field.key]"
                          class="field-target-name-input"
                          :placeholder="getDefaultTargetFieldName(field)"
                          :disabled="!isFieldSelected(field.key)"
                          :maxlength="100"
                          @blur="handleTargetFieldNameBlur(field)"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>



            <section id="section-guide" class="form-section">
              <div class="section-header">
                <span class="section-step">5</span>
                <span>使用说明</span>
              </div>
              <div class="guide-copy">
                <p> 工作原理：</p>
                <div class="cookie-box">
<!--                <div class="cookie-card">-->
<!--                  <div class="cookie-card-title">开始网页模拟登录 </div>-->
<!--                  <div class="cookie-card-desc">在账号关联界面进行该操作。 </div>-->
<!--                </div>-->
<!--                  <RightOutlined />-->
                  <div class="cookie-card">
                    <div class="cookie-card-title">登录您的商家账号 </div>
                    <div class="cookie-card-desc">在浏览器子窗口中登录您的商家账号。 </div>
                  </div>
                  <RightOutlined />
                  <div class="cookie-card">
                    <div class="cookie-card-title">运行 一键捕获书签 </div>
                    <div class="cookie-card-desc">脚本会跨域安全上报当前 Session Cookie。 </div>
                  </div>
                  <RightOutlined />
                  <div class="cookie-card">
                    <div class="cookie-card-title">自动绑定并开始同步 </div>
                    <div class="cookie-card-desc">系统会自动绑定Cookie 并复用凭证进行同步。 </div>
                  </div>
                </div>
              </div>
              <div class="guide-actions">
                <a
                    :href="bookmarkCode"
                    class=" helper-bookmark"
                    :class="{ disabled: !hasValidCaptureSession }"
                    :aria-disabled="!hasValidCaptureSession"
                    @mouseenter="prepareCaptureSession()"
                    @focus="prepareCaptureSession()"
                    @click.prevent="showDragBookmarkTip"
                >
                  <img :src="buttonImg"  />
                  <div  class="righ-helper-bookmark">
                    拖拽此按钮至书签栏
                    <text>(抖音凭证捕获助手)</text>
                  </div>

                </a>
              </div>
              <div class="helper-divider">
                <span></span>
                <em>或</em>
                <span></span>
              </div>
                <div class="helper-console-row">
                  <p> 或者<a-button size="small"  ghost type="primary" @click="copyBookmarkCode" style="margin: 0 8px">复制代码</a-button>并在登录后的网页控制台 (Console) 中贴入回车运行</p>
                </div>
<!--                <code>{{ bookmarkCode }}</code>-->

            </section>
          </main>
          <main
            v-else
            ref="accountScrollContainerRef"
            class="right-content account-detail-content"
            @scroll="handleAccountScroll"
          >
            <AccountDetailPanel
              :accounts="accounts"
              :logs="syncLogs"
              :log-status-filter="syncLogStatusFilter"
              :log-page="syncLogPage"
              :log-page-size="syncLogPageSize"
              :log-total="syncLogTotal"
              :log-loading="isSyncLogLoading"
              :current-user-id="userId || 'default'"
              :get-module-label="getAccountModuleLabel"
              @add="openAccountModal()"
              @edit="openAccountModal"
              @delete="handleDeleteAccount"
              @set-active="handleSetActiveAccount"
              @refresh-logs="fetchSyncLogs"
              @change-log-filter="handleSyncLogFilterChange"
              @change-log-page="handleSyncLogPageChange"
            />
          </main>
        </div>

        <div class="bottom-bar">
          <a-button v-if="pageTab === 'accounts'" size="large" @click="pageTab = 'config'">返回配置</a-button>
<!--          <a-button size="large" @click="handleCancel">取消</a-button>-->
          <a-button v-if="pageTab === 'config'" size="large" type="primary" @click="handleSaveAndGoNext">保存</a-button>
        </div>
      </div>

      <a-modal
        v-model:open="isAccountModalOpen"
        :footer="null"
        :width="660"
        :style="{ top: '50px' }"
        @cancel="closeAccountModal"
      >
        <template #title>
          <div class="modal-title">关联账号设置</div>
        </template>

        <div class="account-modal-body">
          <div class="modal-steps">
            <div class="modal-step" :class="{ active: currentStep === 1, done: currentStep > 1 }">
              <span class="modal-step-dot">{{ currentStep > 1 ? '✓' : '1' }}</span>
              <span>选择账号来源类型</span>
            </div>
            <div class="modal-step-line" :class="{ active: currentStep > 1 }"></div>
            <div class="modal-step" :class="{ active: currentStep === 2 }">
              <span class="modal-step-dot">2</span>
              <span>关联并绑定账号</span>
            </div>
          </div>

          <div v-if="currentStep === 1" class="source-type-grid">
            <button
              type="button"
              class="source-type-card"
              :class="{ selected: accountSourceType === 'shared' }"
              @click="accountSourceType = 'shared'"
            >
              <span class="source-select-mark">{{ accountSourceType === 'shared' ? '✓' : '' }}</span>
              <div class="source-type-title">使用企业共享账号</div>
              <div class="source-type-desc">
                复用企业内其他协作者已公开发布的脱敏账号，免输入密钥/扫码，安全免密绑定。
              </div>
            </button>

            <button
              type="button"
              class="source-type-card"
              :class="{ selected: accountSourceType === 'self' }"
              @click="accountSourceType = 'self'"
            >
              <span class="source-select-mark">{{ accountSourceType === 'self' ? '✓' : '' }}</span>
              <div class="source-type-title">绑定/授权自己的全新账号</div>
              <div class="source-type-desc">
                通过网页登录方式捕获 Cookie，添加个人商户接入。
              </div>
            </button>
          </div>

          <div v-else class="bind-step-wrap">
            <div v-if="accountSourceType === 'shared'">
              <a-form layout="vertical" class="section-form">
                <a-form-item label="选择共享账号" required>
                  <a-select v-model:value="selectedSharedAccountId" :options="sharedAccountOptions" />
                </a-form-item>
              </a-form>
              <div class="modal-checkboxes">
                <a-checkbox v-model:checked="isNewAccountActive">绑定后立即启用该账号作为同步账号</a-checkbox>
              </div>
            </div>

            <div v-else class="bind-step2-wrap">
              <div class="capture-panelleft">
                <a-form layout="vertical" class="section-form">
                  <a-form-item label="账号/店铺显示名" required>
                    <a-input
                        v-model:value="accountDisplayName"
                        placeholder="请输入"
                    />
                  </a-form-item>
                </a-form>
                <div class="capture-panel">

                  <div class="capture-panel-icon">
                    <img :src="iconImg"  />
                  </div>
                  <div class="capture-panel-content">
                    <div class="capture-panel-copy">
                      点击后将跳转官方登录页，并在登录后运行书签脚本或控制台代码进行凭证回传。
                    </div>
                  <a-button
                    type="primary"
                    :loading="isPreparingCaptureSession"
                    :disabled="isPolling"
                    @click="handleStartSimulatedLogin"
                  >
                      点击开始网页模拟登录
                    </a-button>
                    <div class="capture-inline-status">
                      <div v-if="isPolling" class="capture-status-badge badge-waiting">
                        正在等待浏览器脚本回传 Cookie 凭据...
                      </div>
                      <div v-else-if="hasCapturedCredential" class="capture-status-badge badge-success">
                        凭证自动拦截成功 (已获取)
                      </div>
                      <div v-else class="capture-idle-text">（未启动拦截）</div>
                    </div>
                  </div>
                </div>
                <div class="modal-checkboxes" style="margin-top: 20px">
                  <a-checkbox v-model:checked="allowShare">允许该账号在企业内共享复用</a-checkbox>
                  <a-checkbox v-model:checked="isNewAccountActive">绑定后立即启用该账号作为同步账号</a-checkbox>
                </div>
              </div>

              <div class="modal-tip-box">
                <div class="helper-title">安装与使用书签助手：</div>
                <div class="helper-card-row">
                  <div class="helper-card">
                    <div class="helper-card-title">1</div>
                    <div class="helper-card-desc">显示浏览器书签栏:快捷键：Ctrl/Cmd + Shift + B</div>
                  </div>
                  <div class="helper-card">
                    <div class="helper-card-title">2</div>
                    <div class="helper-card-desc">直接拖拽下方按钮:拖拽至您的浏览器书签栏。</div>
                  </div>
                  <div class="helper-card">
                    <div class="helper-card-title">3</div>
                    <div class="helper-card-desc">自动上报并绑定:登录抖店后台主页后，点击书签即可自动上报并绑定。</div>
                  </div>
                </div>

                <div class="helper-action-title">浏览器捕获助手一键安装：</div>
                <div class="helper-button-row">
                  <a
                    :href="bookmarkCode"
                    class="  helper-bookmark"
                    :class="{ disabled: !hasValidCaptureSession }"
                    :aria-disabled="!hasValidCaptureSession"
                    @mouseenter="prepareCaptureSession()"
                    @focus="prepareCaptureSession()"
                    @click.prevent="showDragBookmarkTip"
                  >
                    <img :src="buttonImg"  />
                    <div  class="righ-helper-bookmark">
                      拖拽此按钮至书签栏
                      <text>(抖音凭证捕获助手)</text>
                    </div>

                  </a>
                </div>

                <div class="helper-divider">
                  <span></span>
                  <em>或</em>
                  <span></span>
                </div>

                <div class="helper-console-row">

                  <p> 或者<a-button size="small"  ghost type="primary" @click="copyBookmarkCode" style="margin: 0 8px">复制代码</a-button>并在登录后的网页控制台 (Console) 中贴入回车运行</p>
                </div>

<!--                <div class="bookmark-code-container modal-code">-->
<!--                  <code>{{ bookmarkCode }}</code>-->
<!--                </div>-->
              </div>


            </div>
          </div>
        </div>

        <div class="modal-footer">
          <a-button v-if="currentStep === 1" @click="closeAccountModal">取消</a-button>
          <a-button v-if="currentStep === 1" type="primary" @click="currentStep = 2">下一步</a-button>
          <a-button v-if="currentStep === 2" @click="currentStep = 1" :disabled="reconnectingAccount">上一步</a-button>
          <a-button v-if="currentStep === 2" type="primary" @click="handleSaveAccountRelation">
            {{ reconnectingAccount ? '确认更新账号' : '确认关联并绑定' }}
          </a-button>
        </div>
      </a-modal>
    </div>
  </a-spin>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { message, } from 'ant-design-vue';
import { bitable } from '@lark-base-open/connector-api';
import { bridge } from '@lark-base-open/js-sdk';
import buttonImg from './assets/button.png';
import iconImg from './assets/icon.png';
import AccountDetailPanel from './components/AccountDetailPanel.vue';
import CurrentAccountSummary from './components/CurrentAccountSummary.vue';
import type { Account, SharedAccount, SyncLog, SyncLogListResponse } from './types/account';
import { CheckSquareOutlined, ClearOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons-vue';

// 数据源字段定义：用于渲染字段映射表，也会作为保存到飞书配置中的映射来源。
interface ModuleField {
  key: string;
  label?: string;
  fieldName?: string;
  type?: 'Text' | 'Number' | 'DateTime' | 'price' | 'percentage';
  defaultField?: string;
  isPrimary?: boolean;
}

// Ant Design Vue Select 组件的通用选项结构。
interface BitableOption {
  value: string;
  label: string;
}

interface CustomQueryFieldOption {
  value: string | number | boolean;
  label: string;
}

type CustomQueryFieldType = 'string' | 'integer' | 'number' | 'boolean';

interface CustomQueryField {
  name: string;
  label?: string;
  type?: CustomQueryFieldType | 'String' | 'Integer' | 'Number' | 'Boolean';
  required?: boolean;
  defaultValue?: string | number | boolean;
  placeholder?: string;
  helpText?: string;
  options?: CustomQueryFieldOption[];
}

interface DateRangeMappingConfig {
  startTime?: string;
  endTime?: string;
  format?: string;
}

interface DoudianRequestConfig {
  extraQuery?: Record<string, unknown>;
  customQueryFields?: CustomQueryField[];
  dateRangeMapping?: DateRangeMappingConfig;
}

// 后端抖店接口目录定义：用于动态生成模块树、字段 Schema 和接口摘要。
interface DoudianInterface {
  interfaceKey: string;
  moduleGroup: string;
  interfaceName: string;
  apiHost: string;
  apiPath: string;
  localAggregatePath?: string | null;
  isEnabled: boolean;
  description?: string;
  fieldsSchema?: ModuleField[];
  requestConfig?: DoudianRequestConfig;
  detailLoaded?: boolean;
}

interface CaptureSessionResponse {
  code: number;
  message: string;
  token: string;
  expiresAt: string;
  requestId?: string;
}

// 模块 TreeSelect 节点定义：支持分组节点和可选叶子节点。
interface ModuleTreeNode {
  title: string;
  value: string;
  selectable?: boolean;
  children?: ModuleTreeNode[];
}

// 抖店接口目录模块前缀：用于区分固定模块和数据库驱动的动态接口模块。
const DOUDIAN_INTERFACE_PREFIX = 'doudian_shop__';

// 固定模块字段配置：保留为空时，字段完全依赖后端接口目录的 fieldsSchema。
const MODULE_FIELDS: Record<string, ModuleField[]> = {
};

// 左侧导航配置：key 必须和 section-xxx 的 DOM id 后缀一致。
const navItems = [
  { key: 'account', step: '1', label: '配置账号', desc: '配置账号与凭证' },
  { key: 'datasource', step: '2', label: '数据源选择', desc: '选择数据源' },
  { key: 'params', step: '3', label: '参数设置', desc: '配置连接器参数' },
  { key: 'fields', step: '4', label: '字段设置', desc: '配置字段映射规则' },
  { key: 'guide', step: '5', label: '使用说明', desc: '配置同步步骤' }
];

const accountNavItems = [
  { key: 'management', step: '1', label: '账号管理', desc: '管理账号与凭证' },
  { key: 'logs', step: '2', label: '同步日志', desc: '查看同步记录' }
];

// 固定模块树配置：保留为空时，只展示后端动态返回的抖店接口目录。
const BASE_MODULE_TREE_DATA: ModuleTreeNode[] = [

];

// 账户中心资金流水的支付通道选项。
const payChannelOptions = [
  { value: 'aggregate', label: '聚合支付' },
  { value: 'wechat', label: '微信支付' },
  { value: 'douyin', label: '抖音支付' }
];

// 账户中心资金流水的时间模式选项。
const timeTypeOptions = [
  { value: 'relative', label: '相对天数范围' },
  { value: 'custom', label: '自定义日期范围（传参同步）' }
];

// 普通模块的相对同步时间范围选项。
const dateRangeOptions = [
  { value: 'all', label: '全量数据（不传时间范围参数）' },
  { value: '3', label: '回溯近 3 天数据（高频增量，推荐）' },
  { value: '7', label: '回溯近 7 天数据' },
  { value: '30', label: '回溯近 30 天数据（多页拉取）' }
];

const booleanCustomQueryOptions = [
  { value: 'true', label: '是' },
  { value: 'false', label: '否' }
];



// 当前左侧导航高亮项。
const activeMenu = ref('account');
const activeAccountMenu = ref('management');
// 顶部页签：配置页或账号详情页。
const pageTab = ref<'config' | 'accounts'>('config');
// 当前选择的数据源平台，目前默认抖音电商。
const platform = ref('douyin');
// 当前飞书 Base 用户 ID，用于隔离个人账号和 Cookie 捕获缓冲。
const userId = ref('');
// 当前飞书租户 Key，用于企业维度的数据隔离。
const tenantKey = ref('');
// 当前同步表的独立连接器配置 ID，用于隔离同一 Base 内多张同步表的后台任务。
const connectorConfigId = ref('');
// 当前可用账号列表，包含个人账号和可见的共享账号。
const accounts = ref<Account[]>([]);
// 页面初始化期间显示加载态，避免配置恢复前展示默认信息。
const isInitializing = ref(true);
// 后端返回的抖店接口目录列表。
const doudianInterfaces = ref<DoudianInterface[]>([]);
const doudianInterfaceDetailRequests = new Map<string, Promise<DoudianInterface | null>>();
// 模块选择树数据，固定模块和动态抖店接口都会合并到这里。
const moduleTreeData = ref<ModuleTreeNode[]>(BASE_MODULE_TREE_DATA);
// 账号关联弹窗是否打开。
const isAccountModalOpen = ref(false);
// 账号关联弹窗当前步骤，1 为选择来源，2 为填写或选择账号。
const currentStep = ref(1);
// 账号来源类型：企业共享账号或自己新绑定账号。
const accountSourceType = ref<'shared' | 'self'>('shared');
// 企业共享账号候选列表。
const sharedAccounts = ref<SharedAccount[]>([]);
const syncLogs = ref<SyncLog[]>([]);
const syncLogStatusFilter = ref<'all' | 'running' | 'success' | 'failed'>('all');
const syncLogPage = ref(1);
const syncLogPageSize = ref(6);
const syncLogTotal = ref(0);
const isSyncLogLoading = ref(false);
// 当前选中的共享账号 ID。
const selectedSharedAccountId = ref('');
// 用户手动输入的账号/店铺显示名，优先用于账号列表展示。
const accountDisplayName = ref('');
// 当前正在重新连接的已有账号；为空表示新增账号。
const reconnectingAccount = ref<Account | null>(null);
// 手动粘贴的 Cookie，作为书签捕获失败时的备用输入。
const pastedCookie = ref('');
// 自建账号是否允许企业内共享。
const allowShare = ref(true);
// 新绑定账号是否立即设为当前活跃同步账号。
const isNewAccountActive = ref(true);
// 是否正在轮询后端 Cookie 捕获状态。
const isPolling = ref(false);
// 是否正在测试当前抖店接口连接。
const isTestingConnection = ref(false);
// 是否正在刷新抖店接口目录与字段配置。
const isRefreshingInterfaces = ref(false);
// 模块下拉框是否打开，打开时用于锁住右侧滚动容器。
const isModuleDropdownOpen = ref(false);
// 书签助手是否已经把 Cookie 安全写入服务端缓冲区，前端不持有明文凭证。
const hasCapturedCredential = ref(false);
// 书签助手捕获到的店铺 ID。
const capturedShopId = ref('');
// 书签助手捕获到的店铺名称。
const capturedShopName = ref('');
// 当前书签使用的一次性捕获令牌，服务端只保存其 SHA-256 哈希。
const captureToken = ref('');
// 一次性捕获令牌的服务端过期时间。
const captureTokenExpiresAt = ref(0);
// 是否正在向后端创建捕获会话。
const isPreparingCaptureSession = ref(false);
// 当前选择的同步模块，统一使用 DOUDIAN_INTERFACE_PREFIX + interfaceKey。
const syncModule = ref('');
// TreeSelect 需要 undefined 才会展示 placeholder，内部仍统一用空字符串表示未选择。
const syncModuleSelectValue = computed<string | undefined>({
  get: () => syncModule.value || undefined,
  set: (value) => {
    syncModule.value = value || '';
  }
});
// 用户配置的抖音店铺 ID。
const shopIdParam = ref('');
// 动态抖店接口的附加 Query 参数文本，保存前会被解析成对象。
const doudianExtraQueryText = ref('');
// 最近一次测试连接结果，用于在配置页给出轻量反馈。
const testConnectionResult = ref('');
// 相对同步时间范围，单位为天。
const dateRange = ref('30');
// 字段映射下拉框的目标列选项。
const bitableFields = ref<BitableOption[]>([]);
// 源字段 key 到飞书目标列 fieldId 的映射关系。
const fieldMappings = reactive<Record<string, string>>({

});
// 源字段 key 到当前任务目标列显示名称的映射关系，只影响本次导出的多维表格。
const targetFieldNames = reactive<Record<string, string>>({});

const merchantUid = ref('');
const payChannel = ref('');
const timeType = ref('');
const customStartDate = ref('');
const customEndDate = ref('');
const customQueryValues = reactive<Record<string, string | number | boolean>>({});
// 右侧滚动容器引用，用于滚动监听和导航高亮。
const scrollContainerRef = ref<HTMLElement | null>(null);
const accountScrollContainerRef = ref<HTMLElement | null>(null);
// Cookie 捕获轮询定时器句柄，组件卸载或停止轮询时必须清理。
let pollingTimer: number | null = null;
let captureSessionRequest: Promise<boolean> | null = null;
// 恢复飞书已保存配置时，避免模块 watcher 把字段选择重置成全选。
let isRestoringSavedConfig = false;
let syncModuleDetailRequestId = 0;
let syncLogRequestId = 0;
// 程序化滚动期间阻止 handleScroll 更新高亮，避免闪烁。
let isScrollingByClick = false;
let scrollClickTimer: ReturnType<typeof setTimeout> | null = null;

// 当前配置流程使用的账号，优先展示已启用账号，没有则回退为列表第一条。
const currentSelectedAccount = computed<Account | null>(() => (
  accounts.value.find((account: Account) => account.isActive) || accounts.value[0] || null
));

/**
 * 功能描述：停止凭证捕获轮询并关闭顶部加载提示。
 * @return {void} 无返回值
 */
function stopCapturePolling(): void {
  isPolling.value = false;
  if (pollingTimer) {
    window.clearInterval(pollingTimer);
    pollingTimer = null;
  }
  message.destroy('poll');
}

/**
 * 功能描述：获取当前企业隔离参数。
 * @return {string} 返回 URL 查询参数
 */
function getCompanyQuery(): string {
  const params = new URLSearchParams({
    tenantKey: tenantKey.value || 'default',
    userId: userId.value || 'default'
  });
  return params.toString();
}

// 从 syncModule 中提取动态抖店接口 key；固定模块返回空字符串。
const selectedDoudianInterfaceKey = computed(() => {
  if (!syncModule.value.startsWith(DOUDIAN_INTERFACE_PREFIX)) return '';
  return syncModule.value.slice(DOUDIAN_INTERFACE_PREFIX.length);
});
// 当前选中的动态抖店接口完整元数据。
const selectedDoudianInterface = computed(() => (
  doudianInterfaces.value.find((item) => item.interfaceKey === selectedDoudianInterfaceKey.value) || null
));
const customQueryFields = computed<CustomQueryField[]>(() => {
  const fields = selectedDoudianInterface.value?.requestConfig?.customQueryFields;
  return Array.isArray(fields) ? fields.filter((field) => Boolean(field?.name)) : [];
});
// 只有接口 request_config 显式配置 dateRangeMapping 时，才展示同步时间范围。
const hasDateRangeMapping = computed(() => {
  const mapping = selectedDoudianInterface.value?.requestConfig?.dateRangeMapping;
  return Boolean(mapping && typeof mapping === 'object' && (mapping.startTime || mapping.endTime));
});
// 当前模块字段列表：动态接口优先使用后端 fieldsSchema，固定模块使用本地 MODULE_FIELDS。
const currentModuleFields = computed<ModuleField[]>(() => {
  if (syncModule.value.startsWith(DOUDIAN_INTERFACE_PREFIX)) {
    return selectedDoudianInterface.value?.fieldsSchema?.length
      ? selectedDoudianInterface.value.fieldsSchema
      : (MODULE_FIELDS.doudian_shop_interface || []);
  }
  return [];
});
// 当前已勾选同步的字段数量。
const selectedFieldCount = computed(() => getSelectedFieldKeys().length);
// 共享账号 Select 选项，将共享范围拼进展示文案里。
const sharedAccountOptions = computed(() => sharedAccounts.value.map((account: SharedAccount) => ({
  value: account.id,
  label: `${account.name}${account.shareScope === 'private' ? '（仅自己可见）' : '（企业共享）'}`
})));
// 给拖拽书签预留 15 秒时间，临近过期时主动重新生成。
const hasValidCaptureSession = computed(() => (
  Boolean(captureToken.value)
  && captureTokenExpiresAt.value - Date.now() > 15000
));
// 当前页面生成的书签助手代码，会随租户、用户和模块变化自动更新。
const bookmarkCode = computed(() => buildBookmarkCode());

/**
 * 功能描述：统一解析后端 JSON 响应，并把稳定业务错误码和请求 ID 转成可读异常。
 * @param {Response} response Fetch 原始响应
 * @param {string} fallbackMessage 无有效错误正文时的兜底提示
 * @return {Promise<any>} 返回解析后的 JSON 数据
 */
async function parseApiResponse<T = any>(response: Response, fallbackMessage: string): Promise<T> {
  const body = await response.json().catch(() => null);
  const businessFailed = body
    && typeof body === 'object'
    && typeof body.code === 'number'
    && body.code !== 0;
  if (!response.ok || businessFailed) {
    const requestId = body?.requestId ? `（请求 ID：${body.requestId}）` : '';
    throw new Error(`${body?.message || fallbackMessage}${requestId}`);
  }
  return body as T;
}

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

/**
 * 功能描述：根据当前构建环境拼接后端 API 地址；本地开发默认继续走同源代理。
 * @param {string} path API 路径
 * @return {string} 返回最终请求地址
 */
function apiUrl(path: string): string {
  return API_BASE_URL && path.startsWith('/') ? `${API_BASE_URL}${path}` : path;
}

/**
 * 功能描述：为当前用户创建短效一次性捕获会话，避免书签载荷伪造租户和用户身份。
 * @param {boolean} force 是否忽略现有有效令牌并强制重建
 * @return {Promise<boolean>} 返回是否已获得可用捕获令牌
 */
async function prepareCaptureSession(force = false): Promise<boolean> {
  if (!force && hasValidCaptureSession.value) return true;
  if (captureSessionRequest) return captureSessionRequest;

  isPreparingCaptureSession.value = true;
  captureSessionRequest = (async () => {
    try {
      const response = await fetch(apiUrl('/api/v1/connector/sources/capture-session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantKey: tenantKey.value || 'default',
          userId: userId.value || 'default',
          module: syncModule.value || ''
        })
      });
      const result = await parseApiResponse<CaptureSessionResponse>(
        response,
        '生成凭证捕获脚本失败'
      );
      captureToken.value = result.token || '';
      captureTokenExpiresAt.value = new Date(result.expiresAt).getTime();
      return hasValidCaptureSession.value;
    } catch (error: any) {
      captureToken.value = '';
      captureTokenExpiresAt.value = 0;
      message.error(error.message || '生成凭证捕获脚本失败');
      return false;
    } finally {
      isPreparingCaptureSession.value = false;
      captureSessionRequest = null;
    }
  })();
  return captureSessionRequest;
}

/**
 * 功能描述：根据同步模块标识返回可读的模块名称，用于账号列表和账号命名。
 * @param {string|undefined} module 同步模块标识
 * @return {string} 返回模块展示名称
 */
function getAccountModuleLabel(module?: string): string {
  if (!module) return '未绑定同步模块';
  if (module.startsWith(DOUDIAN_INTERFACE_PREFIX)) {
    const interfaceKey = module.slice(DOUDIAN_INTERFACE_PREFIX.length);
    const meta = doudianInterfaces.value.find((item) => item.interfaceKey === interfaceKey);
    return meta ? `${meta.moduleGroup} / ${meta.interfaceName}` : interfaceKey;
  }
  return module;
}

/**
 * 功能描述：将浏览器标题或捕获名称整理成可区分的账号名称前缀。
 * @param {string} rawName 原始店铺名或页面标题
 * @param {string} shopId 店铺 ID
 * @return {string} 返回账号名称前缀
 */
function buildShopNamePrefix(rawName: string, shopId: string): string {
  const cleaned = String(rawName || '').trim();
  if (!cleaned || ['首页', '抖店', '抖店商家店铺', '已拦截抖店'].includes(cleaned)) {
    return `抖店店铺 ${shopId}`;
  }
  return cleaned;
}

/**
 * 功能描述：根据当前模块字段生成飞书目标列选项和默认映射。
 * @return {void} 无返回值
 */
function resetFieldMappingByModule(): void {
  const fields = Array.isArray(currentModuleFields.value) ? currentModuleFields.value : [];

  const typeMap: Record<string, string> = {
    Text: '文本型',
    Number: '数字型',
    DateTime: '日期型',
    ImageUrl: '图片型',
    VideoUrl: '视频型',
    price: '价格型',
    percentage: '百分比'
  };

  const emojiMap: Record<string, string> = {
    Text: '📝',
    Number: '🔢',
    DateTime: '📅',
    ImageUrl: '🖼️',
    VideoUrl: '🎬',
    price: '💰',
    percentage: '📊'

  };

  bitableFields.value = fields.map((field) => {
    const labelText = (field.label || field.fieldName || field.key).split(' (')[0];

    const type = field.type ?? 'Text';

    const typeText = typeMap[type] || '未知类型';
    const emoji = emojiMap[type] || '📌';

    return {
      value: field.defaultField || field.key,
      label: `${emoji} ${labelText} (${typeText})`
    };
  });

  Object.keys(fieldMappings).forEach((key) => delete fieldMappings[key]);
  Object.keys(targetFieldNames).forEach((key) => delete targetFieldNames[key]);

  fields.forEach((field) => {
    fieldMappings[field.key] = field.defaultField || field.key;
    targetFieldNames[field.key] = getDefaultTargetFieldName(field);
  });
}

/**
 * 功能描述：获取字段创建到多维表格时使用的默认列名。
 * @param {ModuleField} field 当前源字段
 * @return {string} 返回默认目标列名
 */
function getDefaultTargetFieldName(field: ModuleField): string {
  return String(field.fieldName || field.label || field.key).trim();
}

/**
 * 功能描述：目标列名称失焦时清理首尾空格，空值自动恢复默认名称。
 * @param {ModuleField} field 当前源字段
 * @return {void} 无返回值
 */
function handleTargetFieldNameBlur(field: ModuleField): void {
  targetFieldNames[field.key] = String(targetFieldNames[field.key] || '').trim() || getDefaultTargetFieldName(field);
}

/**
 * 功能描述：校验当前选中字段的目标列名称不为空且不重复。
 * @param {string[]} selectedFieldKeys 当前选中的源字段 key
 * @return {boolean} 返回目标列名称是否有效
 */
function validateTargetFieldNames(selectedFieldKeys: string[]): boolean {
  const usedNames = new Set<string>();
  const usedFieldIds = new Set<string>();
  for (const sourceKey of selectedFieldKeys) {
    const field = currentModuleFields.value.find((item) => item.key === sourceKey);
    if (!field) continue;
    const targetName = String(targetFieldNames[sourceKey] || '').trim() || getDefaultTargetFieldName(field);
    const targetFieldId = String(fieldMappings[sourceKey] || field.defaultField || sourceKey).trim();
    targetFieldNames[sourceKey] = targetName;
    if (usedNames.has(targetName)) {
      message.error(`目标列名称“${targetName}”重复，请修改后再保存。`);
      return false;
    }
    if (!targetFieldId) {
      message.error(`字段“${field.label || sourceKey}”缺少目标列映射。`);
      return false;
    }
    if (['sys_record_id', 'sys_name', 'account_name'].includes(targetFieldId)) {
      message.error(`目标列“${targetFieldId}”由连接器保留使用，请为业务字段选择其他目标列。`);
      return false;
    }
    if (usedFieldIds.has(targetFieldId)) {
      message.error(`多个源字段映射到了同一个目标列“${targetFieldId}”，请调整后再保存。`);
      return false;
    }
    usedNames.add(targetName);
    usedFieldIds.add(targetFieldId);
  }
  return true;
}

/**
 * 功能描述：判断当前页面是否通过飞书“新建连接器”入口打开。
 * @return {boolean} 返回是否为新建模式
 */
function isCreateConnectorMode(): boolean {
  const isNew = String(
    new URLSearchParams(window.location.search).get('isNew') || ''
  ).trim().toLowerCase();
  return ['1', 'true', 'yes'].includes(isNew);
}

/**
 * 功能描述：生成当前同步表稳定使用的连接器配置 ID。
 * @return {string} 返回配置 ID
 */
function createConnectorConfigId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `connector_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * 功能描述：兼容解析 saveConfigAndGoNext 保存的 value JSON 包装和旧版扁平配置。
 * @param {Record<string, unknown>|null|undefined} savedConfig 飞书返回的原始配置
 * @return {Record<string, any>|null} 返回连接器业务配置
 */
function parseSavedConnectorConfig(
  savedConfig: Record<string, unknown> | null | undefined
): Record<string, any> | null {
  if (!savedConfig || typeof savedConfig !== 'object') return null;
  if (typeof savedConfig.value === 'string') {
    try {
      const parsed = JSON.parse(savedConfig.value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      console.warn('解析飞书连接器 value 配置失败', error);
      return null;
    }
  }
  if (savedConfig.value && typeof savedConfig.value === 'object') {
    return savedConfig.value as Record<string, any>;
  }
  return savedConfig as Record<string, any>;
}

/**
 * 功能描述：根据当前接口的自定义 Query 字段定义重置默认值。
 * @param {Record<string, unknown>} savedValues 已保存的自定义查询参数
 * @return {void} 无返回值
 */
function resetCustomQueryValues(savedValues: Record<string, unknown> = {}): void {
  Object.keys(customQueryValues).forEach((key) => delete customQueryValues[key]);
  customQueryFields.value.forEach((field) => {
    const savedValue = savedValues[field.name];
    if (savedValue !== undefined && savedValue !== null && savedValue !== '') {
      customQueryValues[field.name] = normalizeCustomQueryFieldValue(field, savedValue);
      return;
    }
    if (field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== '') {
      customQueryValues[field.name] = normalizeCustomQueryFieldValue(field, field.defaultValue);
    }
  });
}

/**
 * 功能描述：判断某个自定义 Query 字段是否为数值输入。
 * @param {CustomQueryField} field 字段定义
 * @return {boolean} 返回是否为数值型字段
 */
function isNumericCustomQueryField(field: CustomQueryField): boolean {
  const fieldType = getCustomQueryFieldType(field);
  return fieldType === 'integer' || fieldType === 'number';
}

/**
 * 功能描述：判断自定义 Query 字段是否配置了选项。
 * @param {CustomQueryField} field 字段定义
 * @return {boolean} 返回是否有选项
 */
function hasCustomQueryOptions(field: CustomQueryField): boolean {
  return Array.isArray(field.options) && field.options.length > 0;
}

/**
 * 功能描述：归一化自定义 Query 字段类型，兼容 Number/number 等大小写写法。
 * @param {CustomQueryField} field 字段定义
 * @return {CustomQueryFieldType} 返回标准字段类型
 */
function getCustomQueryFieldType(field: CustomQueryField): CustomQueryFieldType {
  const type = String(field.type || 'string').toLowerCase();
  if (type === 'integer' || type === 'int') return 'integer';
  if (type === 'number' || type === 'numeric') return 'number';
  if (type === 'boolean' || type === 'bool') return 'boolean';
  return 'string';
}

/**
 * 功能描述：按字段类型归一化自定义 Query 字段值。
 * @param {CustomQueryField} field 字段定义
 * @param {unknown} rawValue 原始输入值
 * @return {string|number|boolean} 返回归一化后的值
 */
function normalizeCustomQueryFieldValue(field: CustomQueryField, rawValue: unknown): string | number | boolean {
  const fieldType = getCustomQueryFieldType(field);
  if (fieldType === 'boolean') {
    return rawValue === true || rawValue === 'true' || rawValue === 1 || rawValue === '1';
  }
  if (fieldType === 'integer') {
    return Number.parseInt(String(rawValue), 10);
  }
  if (fieldType === 'number') {
    return Number(rawValue);
  }
  return String(rawValue);
}

/**
 * 功能描述：获取数值型自定义 Query 字段的当前值，供 InputNumber 绑定。
 * @param {string} fieldName 字段名
 * @return {number|undefined} 返回数值或 undefined
 */
function getNumericCustomQueryFieldValue(fieldName: string): number | undefined {
  const value = customQueryValues[fieldName];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 功能描述：获取布尔型自定义 Query 字段的当前值，统一转成 Select 所需字符串。
 * @param {string} fieldName 字段名
 * @return {string|undefined} 返回 true/false 字符串或 undefined
 */
function getBooleanCustomQueryFieldValue(fieldName: string): string | undefined {
  const value = customQueryValues[fieldName];
  return typeof value === 'boolean' ? String(value) : undefined;
}

/**
 * 功能描述：获取字符串型自定义 Query 字段的当前值。
 * @param {string} fieldName 字段名
 * @return {string|undefined} 返回字符串值
 */
function getStringCustomQueryFieldValue(fieldName: string): string | undefined {
  const value = customQueryValues[fieldName];
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
}

/**
 * 功能描述：获取自定义 Query 字段当前值，供 Select 绑定并保留 number/boolean 类型。
 * @param {string} fieldName 字段名
 * @return {string|number|boolean|undefined} 返回当前值
 */
function getCustomQueryFieldValue(fieldName: string): string | number | boolean | undefined {
  const value = customQueryValues[fieldName];
  return value === undefined || value === null || value === '' ? undefined : value;
}

/**
 * 功能描述：响应界面上自定义 Query 字段的变更。
 * @param {string} fieldName 字段名
 * @param {unknown} value 组件返回值
 * @return {void} 无返回值
 */
function handleCustomQueryValueChange(fieldName: string, value: unknown): void {
  if (value === undefined || value === null || value === '') {
    delete customQueryValues[fieldName];
    return;
  }
  const field = customQueryFields.value.find((item) => item.name === fieldName);
  if (!field) {
    customQueryValues[fieldName] = String(value);
    return;
  }
  customQueryValues[fieldName] = normalizeCustomQueryFieldValue(field, value);
}

/**
 * 功能描述：组装当前运行时需要覆盖到真实抖店请求中的 Query 参数。
 * @return {Record<string, string|number|boolean>} 返回最终附加 Query 参数
 */
function buildRuntimeDoudianExtraQuery(): Record<string, string | number | boolean> {
  return {
    ...parseQueryText(doudianExtraQueryText.value),
    ...customQueryValues
  };
}

/**
 * 功能描述：校验 request_config.customQueryFields 中标记为必填的动态查询字段。
 * @return {boolean} 返回是否全部已填写
 */
function validateRequiredCustomQueryFields(): boolean {
  const missingField = customQueryFields.value.find((field) => {
    if (field.required !== true) return false;
    const value = customQueryValues[field.name];
    return value === undefined || value === null || value === '';
  });
  if (!missingField) return true;
  message.error(`${getRequiredCustomQueryFieldAction(missingField)}${getCustomQueryFieldLabel(missingField)}`);
  return false;
}

/**
 * 功能描述：根据自定义 Query 控件类型返回必填提示动作。
 * @param {CustomQueryField} field 字段定义
 * @return {string} 返回“请选择”或“请填写”
 */
function getRequiredCustomQueryFieldAction(field: CustomQueryField): string {
  return hasCustomQueryOptions(field) || getCustomQueryFieldType(field) === 'boolean'
    ? '请选择'
    : '请填写';
}

/**
 * 功能描述：校验当前店铺 ID 为抖店可识别的纯数字标识。
 * @return {boolean} 返回店铺 ID 是否可用
 */
function validateShopIdParam(): boolean {
  const normalizedShopId = String(shopIdParam.value || '').trim();
  if (!/^\d+$/.test(normalizedShopId)) {
    message.error('请输入正确的数字格式抖音店铺 ID (Shop ID)。');
    return false;
  }
  shopIdParam.value = normalizedShopId;
  return true;
}

/**
 * 功能描述：获取自定义 Query 字段展示名，避免必填提示为空。
 * @param {CustomQueryField} field 字段定义
 * @return {string} 返回展示名
 */
function getCustomQueryFieldLabel(field: CustomQueryField): string {
  return String(field.label || field.placeholder || field.name || '必填项').trim() || '必填项';
}

/**
 * 功能描述：判断某个源字段是否已被勾选进入同步范围。
 * @param {string} sourceKey 数据源字段标识
 * @return {boolean} 返回是否同步该字段
 */
function isFieldSelected(sourceKey: string): boolean {
  return Boolean(fieldMappings[sourceKey]);
}

/**
 * 功能描述：获取当前配置中真正需要同步的字段 key。
 * @return {Array<string>} 返回已选择字段 key 数组
 */
function getSelectedFieldKeys(): string[] {
  return currentModuleFields.value
    .filter((field) => Boolean(fieldMappings[field.key]))
    .map((field) => field.key);
}

/**
 * 功能描述：从后端 MySQL 数据库中拉取抖店接口目录，并合并到同步模块树。
 * @return {Promise<boolean>} 返回是否成功获取或保留了接口目录
 */
async function fetchDoudianInterfaces(autoSelect = false): Promise<boolean> {
  const previousInterfaces = doudianInterfaces.value;
  const requestUrl = `/api/v1/connector/doudian-interfaces?_t=${Date.now()}`;
  try {
    const response = await fetch(apiUrl(requestUrl), {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      }
    });
    if (response.status === 304) {
      console.warn('抖店接口目录返回 304，继续使用当前页面已有接口目录。');
      return true;
    }
    const data = await parseApiResponse<DoudianInterface[]>(response, '获取接口目录失败');
    doudianInterfaces.value = data;
    moduleTreeData.value = buildModuleTreeWithDoudianInterfaces(data);
    if (autoSelect && !syncModule.value && data[0]) {
      syncModule.value = `${DOUDIAN_INTERFACE_PREFIX}${data[0].interfaceKey}`;
    }
    return true;
  } catch (error) {
    console.warn('获取抖店接口目录失败，继续使用当前页面已有接口目录', error);
    doudianInterfaces.value = previousInterfaces;
    moduleTreeData.value = previousInterfaces.length > 0
      ? buildModuleTreeWithDoudianInterfaces(previousInterfaces)
      : BASE_MODULE_TREE_DATA;
    return false;
  }
}

/**
 * 功能描述：按需读取当前选中抖店接口的完整字段与请求配置，避免列表接口返回大 JSON。
 * @param {string} interfaceKey 抖店接口 key
 * @return {Promise<DoudianInterface|null>} 返回接口详情
 */
async function fetchDoudianInterfaceDetail(interfaceKey: string): Promise<DoudianInterface | null> {
  if (!interfaceKey) return null;
  const existing = doudianInterfaces.value.find((item) => item.interfaceKey === interfaceKey);
  if (existing?.detailLoaded) return existing;
  const pending = doudianInterfaceDetailRequests.get(interfaceKey);
  if (pending) return pending;

  const request = (async () => {
    try {
      const response = await fetch(apiUrl(`/api/v1/connector/doudian-interfaces/${encodeURIComponent(interfaceKey)}?_t=${Date.now()}`), {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache'
        }
      });
      if (response.status === 304) {
        return existing || null;
      }
      const detail = await parseApiResponse<DoudianInterface>(response, '获取接口详情失败');
      const nextDetail = { ...detail, detailLoaded: true };
      const index = doudianInterfaces.value.findIndex((item) => item.interfaceKey === interfaceKey);
      if (index >= 0) {
        doudianInterfaces.value.splice(index, 1, {
          ...doudianInterfaces.value[index],
          ...nextDetail
        });
      } else {
        doudianInterfaces.value.push(nextDetail);
      }
      return nextDetail;
    } catch (error) {
      console.warn('获取抖店接口详情失败', error);
      return existing || null;
    } finally {
      doudianInterfaceDetailRequests.delete(interfaceKey);
    }
  })();

  doudianInterfaceDetailRequests.set(interfaceKey, request);
  return request;
}

/**
 * 功能描述：确保当前选中的动态抖店接口已加载完整详情。
 * @return {Promise<DoudianInterface|null>} 返回当前接口详情
 */
async function ensureSelectedDoudianInterfaceDetail(): Promise<DoudianInterface | null> {
  return fetchDoudianInterfaceDetail(selectedDoudianInterfaceKey.value);
}

/**
 * 功能描述：手动刷新抖店接口目录与字段配置，避免页面继续使用旧 Schema。
 * @return {Promise<void>} 无返回值
 */
async function handleRefreshDoudianInterfaces(): Promise<void> {
  isRefreshingInterfaces.value = true;
  try {
    const previousModule = syncModule.value;
    doudianInterfaceDetailRequests.clear();
    const refreshed = await fetchDoudianInterfaces();
    if (!refreshed) throw new Error('获取接口目录失败');
    if (previousModule) {
      syncModule.value = previousModule;
    }
    await ensureSelectedDoudianInterfaceDetail();
    resetFieldMappingByModule();
    resetCustomQueryValues();
    testConnectionResult.value = '';
    message.success('已刷新接口配置，页面字段已按最新目录重载。');
  } catch (error) {
    message.error('刷新接口配置失败，请稍后重试。');
  } finally {
    isRefreshingInterfaces.value = false;
  }
}

/**
 * 功能描述：将数据库接口目录按业务模块分组，生成 TreeSelect 可用的数据结构。
 * @param {Array<DoudianInterface>} interfaces 抖店接口目录数组
 * @return {Array<ModuleTreeNode>} 返回合并后的模块树
 */
function buildModuleTreeWithDoudianInterfaces(interfaces: DoudianInterface[]): ModuleTreeNode[] {
  const grouped = interfaces.reduce<Record<string, DoudianInterface[]>>((acc, item) => {
    const groupName = item.moduleGroup || '抖店店铺接口';
    if (!acc[groupName]) acc[groupName] = [];
    acc[groupName].push(item);
    return acc;
  }, {});

  const doudianInterfaceGroups = Object.entries(grouped).map(([groupName, children]) => ({
    title: groupName,
    value: `group_doudian_${groupName}`,
    selectable: false,
    children: children.map((item) => ({
      title: item.interfaceName,
      value: `${DOUDIAN_INTERFACE_PREFIX}${item.interfaceKey}`
    }))
  }));

  return [
    ...BASE_MODULE_TREE_DATA,
    {
      title: '🏬 店铺接口',
      value: 'group_doudian_shop_interfaces',
      selectable: false,
      children: doudianInterfaceGroups
    }
  ];
}

/**
 * 功能描述：从后端 MySQL 数据库中拉取已绑定账号列表。
 * @return {Promise<void>} 无返回值
 */
async function fetchAccounts(): Promise<void> {
  try {
    const response = await fetch(apiUrl(`/api/v1/connector/accounts?${getCompanyQuery()}`));
    const data = await parseApiResponse<any[]>(response, '获取账号列表失败');
    const mappedList: Account[] = data.map((item: any) => ({
      id: item.id,
      key: item.key,
      name: item.name,
      mode: item.mode,
      status: item.status,
      shopId: item.shopId,
      isActive: item.is_active === 1,
      module: item.module,
      userId: item.user_id,
      shareScope: item.share_scope
    }));
    accounts.value = mappedList;
    const activeAccount = mappedList.find((account: Account) => account.isActive);
    if (!shopIdParam.value && activeAccount?.shopId) shopIdParam.value = activeAccount.shopId;
  } catch (error) {
    console.error('从 MySQL 数据库获取账户列表失败', error);
    accounts.value = [];
  }
}

/**
 * 功能描述：拉取企业共享账号列表。
 * @return {Promise<void>} 无返回值
 */
async function fetchSharedAccounts(): Promise<void> {
  try {
    const response = await fetch(apiUrl(`/api/v1/connector/shared-accounts?${getCompanyQuery()}`));
    const data = await parseApiResponse<SharedAccount[]>(response, '获取共享账号失败');
    sharedAccounts.value = data;
    selectedSharedAccountId.value = data[0]?.id || '';
  } catch (error) {
    console.warn('获取可关联账号列表失败', error);
    sharedAccounts.value = [];
    selectedSharedAccountId.value = '';
  }
}

/**
 * 功能描述：读取最近同步执行日志，可按状态筛选。
 * @return {Promise<void>} 无返回值
 */
async function fetchSyncLogs(): Promise<void> {
  const requestId = ++syncLogRequestId;
  isSyncLogLoading.value = true;
  try {
    const params = new URLSearchParams({
      tenantKey: tenantKey.value || 'default',
      page: String(syncLogPage.value),
      pageSize: String(syncLogPageSize.value)
    });
    if (syncLogStatusFilter.value !== 'all') {
      params.set('status', syncLogStatusFilter.value);
    }
    const response = await fetch(apiUrl(`/api/v1/sync/logs?${params.toString()}`));
    const result = await parseApiResponse<SyncLogListResponse>(response, '获取同步日志失败');
    if (requestId !== syncLogRequestId) return;
    syncLogs.value = Array.isArray(result.list) ? result.list : [];
    syncLogTotal.value = Number(result.total || 0);
  } catch (error) {
    if (requestId !== syncLogRequestId) return;
    console.warn('获取同步日志失败', error);
    syncLogs.value = [];
    syncLogTotal.value = 0;
  } finally {
    if (requestId === syncLogRequestId) {
      isSyncLogLoading.value = false;
    }
  }
}

/**
 * 功能描述：查询 Cookie 是否已被书签助手成功拦截并上报。
 * @return {Promise<void>} 无返回值
 */
async function checkCaptureStatus(): Promise<void> {
  if (!hasValidCaptureSession.value && !hasCapturedCredential.value) {
    stopCapturePolling();
    captureToken.value = '';
    captureTokenExpiresAt.value = 0;
    message.warning('凭证捕获脚本已过期，请重新生成后再运行。');
    return;
  }
  try {
    const response = await fetch(apiUrl(`/api/v1/connector/sources/capture-status?${getCompanyQuery()}`));
    const data = await parseApiResponse<any>(response, '读取凭证捕获状态失败');
    if (data.captured) {
      stopCapturePolling();
      hasCapturedCredential.value = true;
      captureToken.value = '';
      captureTokenExpiresAt.value = 0;
      capturedShopId.value = data.shopId || '';
      capturedShopName.value = data.shopName || '已拦截抖店';
      message.success(`成功拦截到抖店登录凭据！店铺名: ${data.shopName || '未命名'}`);
    }
  } catch (error) {
    console.error('轮询捕获状态接口出错', error);
  }
}
// 进入账号关联第二步时刷新共享账号，避免弹窗打开较早导致列表仍为空。
watch([currentStep, accountSourceType, isAccountModalOpen], async ([step, sourceType, modalOpen]) => {
  if (!modalOpen || step !== 2) return;
  if (sourceType === 'shared') {
    await fetchSharedAccounts();
    return;
  }
  await prepareCaptureSession();
});
/**
 * 功能描述：打开关联账号弹窗并清理本次捕获态。
 * @return {void} 无返回值
 */
function openAccountModal(account?: Account): void {
  if (account && String(account.userId || '') !== String(userId.value || 'default')) {
    message.warning('共享账号仅创建人可以修改凭证');
    return;
  }
  reconnectingAccount.value = account || null;
  currentStep.value = account ? 2 : 1;
  isAccountModalOpen.value = true;
  accountSourceType.value = account ? 'self' : accountSourceType.value;
  hasCapturedCredential.value = false;
  capturedShopId.value = '';
  capturedShopName.value = '';
  accountDisplayName.value = account?.name || '';
  pastedCookie.value = '';
  stopCapturePolling();
  isNewAccountActive.value = account ? account.isActive !== false : true;
  allowShare.value = account ? account.shareScope !== 'private' : allowShare.value;
  captureToken.value = '';
  captureTokenExpiresAt.value = 0;
  if (account) {
    void prepareCaptureSession(true);
  }
}

/**
 * 功能描述：关闭账号弹窗并停止轮询。
 * @return {void} 无返回值
 */
function closeAccountModal(): void {
  isAccountModalOpen.value = false;
  reconnectingAccount.value = null;
  stopCapturePolling();
}

/**
 * 功能描述：触发打开外部抖店登录页并启动凭证捕获轮询。
 * @return {void} 无返回值
 */
async function handleStartSimulatedLogin(): Promise<void> {
  const prepared = await prepareCaptureSession();
  if (!prepared) return;
  const targetUrl = 'https://fxg.jinritemai.com/login/common?extra=%7B%22target_url%22%3A%22https%3A%2F%2Ffxg.jinritemai.com%2Fffa%2Fmshop%2Fhomepage%2Findex%22%7D';
  window.open(targetUrl, '_blank', 'width=800,height=600,left=200,top=100');
  isPolling.value = true;
  message.loading({ content: '正在轮询捕获抖音登录凭证，请在新页面中登录并运行书签脚本...', key: 'poll', duration: 0 });
}

/**
 * 功能描述：保存并关联选择的共享账号或个人自建账号。
 * @return {Promise<void>} 无返回值
 */
async function handleSaveAccountRelation(): Promise<void> {
  const customDisplayName = accountDisplayName.value.trim();

  if (accountSourceType.value === 'shared') {
    const selected = sharedAccounts.value.find((account: SharedAccount) => account.id === selectedSharedAccountId.value);
    if (!selected) {
      message.error('请选择一个有效的共享账号');
      return;
    }
    const newAccount: Account = {
      key: selected.key || selected.id,
      name: customDisplayName || selected.name,
      mode: selected.mode || '企业共享免密',
      status: selected.status || 'active',
      shopId: selected.shopId || '',
      module: selected.module || syncModule.value
    };
    try {
      const response = await fetch(apiUrl('/api/v1/connector/accounts/active'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: newAccount.key,
          tenantKey: tenantKey.value || 'default',
          userId: userId.value || 'default'
        })
      });
      await parseApiResponse(response, '启用共享账号失败');
      message.success('共享账号已设为当前同步账号！');
      await fetchAccounts();
      closeAccountModal();
    } catch (error: any) {
      message.error(error.message || '启用共享账号失败');
    }
    return;
  }

  const existingAccount = reconnectingAccount.value;
  if (existingAccount) {
    if (!existingAccount.id) {
      message.error('缺少账号 id，无法修改');
      return;
    }
    if (!customDisplayName) {
      message.error('请输入账号/店铺显示名称');
      return;
    }

    let nextCookie = pastedCookie.value || '';
    let nextShopId = capturedShopId.value || '';

    if (!hasCapturedCredential.value && !pastedCookie.value) {
      try {
        const response = await fetch(apiUrl(`/api/v1/connector/sources/capture-status?${getCompanyQuery()}`));
        const data = await parseApiResponse<any>(response, '读取凭证捕获状态失败');
        if (data.captured) {
          hasCapturedCredential.value = true;
          nextShopId = data.shopId || '';
        }
      } catch (error) {
        console.error('最后尝试获取凭证失败', error);
      }
    }

    const updatePayload: Record<string, unknown> = {
      id: existingAccount.id,
      name: customDisplayName,
      shareScope: allowShare.value ? 'company' : 'private',
      is_active: isNewAccountActive.value ? 1 : 0
    };

    if (syncModule.value) {
      updatePayload.module = syncModule.value;
    }

    if (hasCapturedCredential.value) {
      updatePayload.useCapturedCredential = true;
      updatePayload.status = 'active';
      if (nextShopId) updatePayload.shopId = nextShopId;
    }

    if (nextCookie) {
      const match = nextCookie.match(/shop_id=(\d+)/) || nextCookie.match(/shop_id_str=(\d+)/);
      const nextResolvedShopId = String(
        nextShopId || (match ? match[1] : '') || shopIdParam.value || ''
      ).trim();
      if (!/^\d+$/.test(nextResolvedShopId)) {
        message.error('无法从新 Cookie 中识别店铺 ID，请先在参数设置中填写正确的数字 Shop ID。');
        return;
      }
      updatePayload.cookie = nextCookie;
      updatePayload.status = 'active';
      updatePayload.shopId = nextResolvedShopId;
    }

    try {
      const response = await fetch(apiUrl('/api/v1/connector/accounts/update'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...updatePayload,
          tenantKey: tenantKey.value || 'default',
          userId: userId.value || 'default'
        })
      });
      await parseApiResponse(response, '更新账号失败');
      message.success('账号信息已更新！');
      await fetchAccounts();
      closeAccountModal();
    } catch (error: any) {
      message.error(error.message || '更新账号失败');
    }
    return;
  }

  if (!customDisplayName) {
    message.error('请输入账号/店铺显示名称');
    return;
  }

  const finalCookie = pastedCookie.value;
  let finalShopId = capturedShopId.value;
  let finalShopName = capturedShopName.value;

  if (!hasCapturedCredential.value && !finalCookie) {
    try {
    const response = await fetch(apiUrl(`/api/v1/connector/sources/capture-status?${getCompanyQuery()}`));
      const data = await parseApiResponse<any>(response, '读取凭证捕获状态失败');
      if (data.captured) {
        hasCapturedCredential.value = true;
        finalShopId = data.shopId || '';
        finalShopName = data.shopName || '已拦截抖店';
      }
    } catch (error) {
      console.error('最后尝试获取凭证失败', error);
    }
  }

  if (!hasCapturedCredential.value && !finalCookie) {
    message.error('请在下方登录或手动粘贴您的 Cookie 凭证！');
    return;
  }

  const match = finalCookie.match(/shop_id=(\d+)/) || finalCookie.match(/shop_id_str=(\d+)/);
  const displayShopId = String(
    finalShopId || (match ? match[1] : '') || shopIdParam.value || ''
  ).trim();
  if (!/^\d+$/.test(displayShopId)) {
    message.error('无法从 Cookie 中识别店铺 ID，请先在参数设置中填写正确的数字 Shop ID。');
    return;
  }
  const shopNamePrefix = buildShopNamePrefix(finalShopName, displayShopId);
  const moduleLabel = getAccountModuleLabel(syncModule.value);
  const newAccount: Account = {
    key: `self_${createConnectorConfigId()}`,
    name: customDisplayName || `${shopNamePrefix} / ${moduleLabel}`,
    mode: '模拟登录',
    status: 'active',
    shopId: displayShopId,
    module: syncModule.value,
    shareScope: allowShare.value ? 'company' : 'private'
  };

  try {
    const response = await fetch(apiUrl('/api/v1/connector/accounts/add'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: newAccount.key,
        name: newAccount.name,
        mode: newAccount.mode,
        status: newAccount.status,
        cookie: finalCookie || '',
        useCapturedCredential: hasCapturedCredential.value,
        shopId: newAccount.shopId || '',
        is_active: isNewAccountActive.value ? 1 : 0,
        module: newAccount.module || '',
        tenantKey: tenantKey.value || 'default',
        userId: userId.value || 'default',
        shareScope: newAccount.shareScope || (allowShare.value ? 'company' : 'private')
      })
    });
    await parseApiResponse(response, '写入数据库失败');
    message.success('新账号已成功绑定并存盘！');
    await fetchAccounts();
    closeAccountModal();
  } catch (error: any) {
    message.error(error.message || '写入数据库失败');
  }
}

function handleSyncLogFilterChange(value: unknown): void {
  syncLogStatusFilter.value = (typeof value === 'string' ? value : 'all') as 'all' | 'running' | 'success' | 'failed';
  syncLogPage.value = 1;
  fetchSyncLogs();
}

function handleSyncLogPageChange(payload: { page: number; pageSize: number }): void {
  syncLogPage.value = payload.page;
  syncLogPageSize.value = payload.pageSize;
  fetchSyncLogs();
}

/**
 * 功能描述：切换当前启用的同步账号。
 * @param {string} key 账号主键
 * @return {Promise<void>} 无返回值
 */
async function handleSetActiveAccount(key: string): Promise<void> {
  try {
    const response = await fetch(apiUrl('/api/v1/connector/accounts/active'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        tenantKey: tenantKey.value || 'default',
        userId: userId.value || 'default'
      })
    });
    await parseApiResponse(response, '切换启用账号失败');
    message.success('已成功切换并启用该数据源同步账号！');
    await fetchAccounts();
  } catch (error: any) {
    message.error(error.message || '切换启用账号失败');
  }
}

/**
 * 功能描述：解除某个账号。本人创建的账号由后端逻辑删除，共享账号只从当前用户列表移除。
 * @param {Account} account 当前操作的账号
 * @return {Promise<void>} 无返回值
 */
async function handleDeleteAccount(account: Account): Promise<void> {
  if (String(account.userId || '') !== String(userId.value || 'default')) {
    message.warning('只有创建该账号的用户才能删除');
    return;
  }

  try {
    const response = await fetch(apiUrl(`/api/v1/connector/accounts/${account.key}`), {
      method: 'DELETE',
      headers: {
        'x-tenant-key': tenantKey.value || 'default',
        'x-user-id': userId.value || 'default'
      }
    });
    const result = await parseApiResponse<any>(response, '删除账号失败');
    message.info(result?.message || '账号已解除关联');
    await fetchAccounts();
  } catch (error: any) {
    message.error(error.message || '删除账号失败');
  }
}

/**
 * 功能描述：自动按模块默认字段完成映射。
 * @return {void} 无返回值
 */
function handleAutoMapFields(): void {
  resetFieldMappingByModule();
  message.success(`已根据同名原则为您自动映射了该模块的 ${currentModuleFields.value.length} 个列字段！`);
}

/**
 * 功能描述：清空字段同步选择，避免保存后自动全字段写入。
 * @return {void} 无返回值
 */
function handleClearFieldSelection(): void {
  Object.keys(fieldMappings).forEach((key) => delete fieldMappings[key]);
  message.info('已清空可选字段。');
}

/**
 * 功能描述：切换单个字段是否参与同步。
 * @param {string} sourceKey 数据源字段标识
 * @param {boolean} checked 是否同步
 * @return {void} 无返回值
 */
function handleFieldSyncToggle(sourceKey: string, checked: boolean): void {
  const field = currentModuleFields.value.find((item) => item.key === sourceKey);
  if (!checked) {
    delete fieldMappings[sourceKey];
    return;
  }
  fieldMappings[sourceKey] = field?.defaultField || sourceKey;
}

/**
 * 功能描述：更新单个源字段到目标飞书列的映射关系。
 * @param {string} sourceKey 数据源字段标识
 * @param {string} bitableFieldId 飞书列字段标识
 * @return {void} 无返回值
 */
function handleMapFieldChange(sourceKey: string, bitableFieldId: string): void {
  if (bitableFieldId) {
    fieldMappings[sourceKey] = bitableFieldId;
  } else {
    delete fieldMappings[sourceKey];
  }
}

/**
 * 功能描述：承接 Ant Design Vue Select 的变更事件并转换为字段映射值。
 * @param {string} sourceKey 数据源字段标识
 * @param {unknown} value Select 返回值
 * @return {void} 无返回值
 */
function handleFieldSelectChange(sourceKey: string, value: unknown): void {
  const mappedValue = typeof value === 'string' ? value : '';
  handleMapFieldChange(sourceKey, mappedValue);
}

/**
 * 功能描述：记录模块 TreeSelect 下拉层开关状态，用于打开下拉层时锁住外层滚动容器。
 * @param {boolean} visible 下拉层是否可见
 * @return {void} 无返回值
 */
function handleModuleDropdownVisibleChange(visible: boolean): void {
  isModuleDropdownOpen.value = visible;
}

/**
 * 功能描述：调用后端轻量测试接口，验证当前活跃账号 Cookie、店铺 ID 与所选抖店接口是否可用。
 * @return {Promise<void>} 无返回值
 */
async function handleTestConnection(): Promise<void> {
  testConnectionResult.value = '';
  if (!validateShopIdParam()) {
    return;
  }
  if (!selectedDoudianInterface.value) {
    message.error('请选择一个数据源');
    return;
  }
  if (accounts.value.length === 0) {
    message.error('请先关联一个抖店账号');
    return;
  }
  if (!validateRequiredCustomQueryFields()) {
    return;
  }

  isTestingConnection.value = true;
  try {
    const response = await fetch(apiUrl('/api/v1/connector/doudian/test-connection'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantKey: tenantKey.value || 'default',
        userId: userId.value || 'default',
        syncModule: syncModule.value,
        doudianInterface: buildSelectedDoudianInterfaceConfig(),
        shopIdParam: shopIdParam.value,
        doudianExtraQuery: buildRuntimeDoudianExtraQuery(),
        dateRange: hasDateRangeMapping.value ? dateRange.value : 'all'
      })
    });
    const result = await parseApiResponse<any>(response, '测试连接失败');
    const data = result.data || {};
    testConnectionResult.value = `已连通：${data.interfaceName || '抖店接口'}，本页 ${data.count || 0} 条，总数 ${data.total || 0}`;
    message.success('测试连接成功');
  } catch (error: any) {
    testConnectionResult.value = '';
    message.error(error.message || '测试连接失败');
  } finally {
    isTestingConnection.value = false;
  }
}

/**
 * 功能描述：保存连接器配置到后端任务表和飞书配置流程。
 * @return {Promise<void>} 无返回值
 */
async function handleSaveAndGoNext(): Promise<void> {
  if (accounts.value.length === 0) {
    message.error('请至少关联一个账号进行数据同步！');
    return;
  }
  if (!validateShopIdParam()) {
    return;
  }
  if (!selectedDoudianInterface.value) {
    message.error('请选择一个抖店接口！');
    return;
  }
  if (!validateRequiredCustomQueryFields()) {
    return;
  }
  const selectedFieldKeys = getSelectedFieldKeys();
  if (currentModuleFields.value.length > 0 && selectedFieldKeys.length === 0) {
    message.error('请至少选择一个需要同步的字段！');
    return;
  }
  if (!validateTargetFieldNames(selectedFieldKeys)) {
    return;
  }

  const activeAccount = accounts.value.find((account: Account) => account.isActive) || accounts.value[0];
  if (!connectorConfigId.value) {
    connectorConfigId.value = createConnectorConfigId();
  }
  const config = {
    connectorConfigId: connectorConfigId.value,
    platform: platform.value,
    syncModule: syncModule.value,
    doudianInterfaceKey: selectedDoudianInterfaceKey.value,
    doudianInterface: buildSelectedDoudianInterfaceConfig(),
    doudianExtraQuery: buildRuntimeDoudianExtraQuery(),
    shopIdParam: shopIdParam.value,
    dateRange: hasDateRangeMapping.value ? dateRange.value : 'all',
    fieldMappings: { ...fieldMappings },
    targetFieldNames: { ...targetFieldNames },
    selectedFieldKeys,

    merchantUid: merchantUid.value,
    payChannel: payChannel.value,
    timeType: timeType.value,
    customStartDate: customStartDate.value,
    customEndDate: customEndDate.value,
    tenantKey: tenantKey.value || 'default',
    userId: userId.value || 'default',
    accountInfo: {
      key: activeAccount?.key || '',
      id: activeAccount?.id || '',
      mode: activeAccount?.mode || '模拟登录',
      name: activeAccount?.name || '抖店模拟账号',
      shopId: activeAccount?.shopId || shopIdParam.value
    }
  };

  try {
    const response = await fetch(apiUrl('/api/v1/sync/tasks/save'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    await parseApiResponse(response, '后端任务保存失败');
    await bitable.saveConfigAndGoNext({ value: JSON.stringify(config) });
  } catch (error: any) {
    message.error(`任务保存失败: ${error.message}`);
  }
}

/**
 * 功能描述：构造保存给飞书 datasourceConfig 的最终接口地址；有本地聚合 path 时优先保存本地接口。
 * @return {object|null} 返回接口配置快照
 */
function buildSelectedDoudianInterfaceConfig(): object | null {
  const selected = selectedDoudianInterface.value;
  if (!selected) return null;

  const localAggregatePath = String(selected.localAggregatePath || '').trim();
  const shouldUseLocalAggregate = Boolean(localAggregatePath);
  return {
    interfaceKey: selected.interfaceKey,
    moduleGroup: selected.moduleGroup,
    interfaceName: selected.interfaceName,
    apiHost: shouldUseLocalAggregate ? getLocalAggregateHost() : selected.apiHost,
    apiPath: shouldUseLocalAggregate ? localAggregatePath : selected.apiPath,
    sourceApiHost: selected.apiHost,
    sourceApiPath: selected.apiPath,
    localAggregatePath: selected.localAggregatePath || '',
    useLocalAggregate: shouldUseLocalAggregate
  };
}

/**
 * 功能描述：读取前端环境中的本地聚合接口前缀，默认当前连接器后端地址。
 * @return {string} 返回 URL 前缀
 */
function getLocalAggregateHost(): string {
  return String(
    import.meta.env.VITE_DOUDIAN_LOCAL_AGGREGATE_HOST ||
    import.meta.env.VITE_LOCAL_AGGREGATE_HOST ||
    window.location.origin
  ).replace(/\/$/, '');
}

/**
 * 功能描述：将用户从调试工具复制的 Query 字符串解析为对象，供后端复刻真实抖店请求。
 * @param {string} text Query 字符串，例如 _bid=x&msToken=y
 * @return {Record<string, string>} 返回 Query 参数对象
 */
function parseQueryText(text: string): Record<string, string> {
  const cleanText = text.trim().replace(/^\?/, '');
  if (!cleanText) return {};
  const params = new URLSearchParams(cleanText);
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    if (key && value !== '') result[key] = value;
  });
  return result;
}

/**
 * 功能描述：执行取消动作并交还飞书配置流程。
 * @return {void} 无返回值
 */
function handleCancel(): void {
  bitable.saveConfigAndGoNext({});
}

/**
 * 功能描述：滚动到指定配置区块。
 * @param {string} sectionId 区块 ID 后缀
 * @return {void} 无返回值
 */
function scrollToSection(sectionId: string): void {
  activeMenu.value = sectionId;
  isScrollingByClick = true;
  if (scrollClickTimer) clearTimeout(scrollClickTimer);
  scrollClickTimer = setTimeout(() => { isScrollingByClick = false; }, 600);
  document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 功能描述：滚动到账号详情页指定区块。
 * @param {string} sectionId 账号详情区块 ID 后缀
 * @return {void} 无返回值
 */
function scrollToAccountSection(sectionId: string): void {
  activeAccountMenu.value = sectionId;
  isScrollingByClick = true;
  if (scrollClickTimer) clearTimeout(scrollClickTimer);
  scrollClickTimer = setTimeout(() => { isScrollingByClick = false; }, 600);
  document.getElementById(`account-section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 功能描述：根据滚动位置高亮当前配置区块。
 * @return {void} 无返回值
 */
function handleScroll(): void {
  if (isScrollingByClick) return;
  const container = scrollContainerRef.value;
  if (!container) return;
  const sections = ['account', 'datasource', 'params', 'fields', 'sync', 'guide'];
  let currentSection = 'account';
  let minDiff = Number.POSITIVE_INFINITY;
  for (const section of sections) {
    const element = document.getElementById(`section-${section}`);
    if (!element) continue;
    const diff = Math.abs(element.getBoundingClientRect().top - container.getBoundingClientRect().top);
    if (diff < minDiff && element.getBoundingClientRect().top - container.getBoundingClientRect().top <= 100) {
      minDiff = diff;
      currentSection = section;
    }
  }
  activeMenu.value = currentSection;
}

/**
 * 功能描述：根据滚动位置高亮账号详情页当前区块。
 * @return {void} 无返回值
 */
function handleAccountScroll(): void {
  if (isScrollingByClick) return;
  const container = accountScrollContainerRef.value;
  if (!container) return;
  const sections = ['management', 'logs'];
  let currentSection = 'management';
  let minDiff = Number.POSITIVE_INFINITY;
  for (const section of sections) {
    const element = document.getElementById(`account-section-${section}`);
    if (!element) continue;
    const diff = Math.abs(element.getBoundingClientRect().top - container.getBoundingClientRect().top);
    if (diff < minDiff && element.getBoundingClientRect().top - container.getBoundingClientRect().top <= 100) {
      minDiff = diff;
      currentSection = section;
    }
  }
  activeAccountMenu.value = currentSection;
}

/**
 * 功能描述：生成可拖入书签栏的 Cookie 捕获脚本。
 * @return {string} 返回 bookmarklet 代码
 */
function buildBookmarkCode(): string {
  if (!hasValidCaptureSession.value) {
    return 'javascript:alert("捕获脚本尚未生成或已过期，请返回飞书配置页重新生成。")';
  }
  const relayUrl = JSON.stringify(`${window.location.origin}/capture-relay.html`);
  const relayOrigin = JSON.stringify(window.location.origin);
  const token = JSON.stringify(captureToken.value);
  return `javascript:(function(){var token=${token};var relayUrl=${relayUrl};var relayOrigin=${relayOrigin};var cookie=document.cookie;if(!cookie)return alert("当前页面没有可读取的登录凭证，请确认已经登录抖店后台。");var shopIdMatch=cookie.match(/shop_id=(\\d+)/)||cookie.match(/shop_id_str=(\\d+)/);var shopId=shopIdMatch?shopIdMatch[1]:'';if(!shopId){var locationMatch=window.location.href.match(/shop_id=(\\d+)/);if(locationMatch)shopId=locationMatch[1]}if(!shopId)shopId=prompt("请输入您的抖音店铺 ID / Shop ID (必填):");if(!shopId)return alert("获取店铺 ID 失败，已取消上报。");var relay=window.open(relayUrl,"doudian_capture_relay","width=480,height=320,left=240,top=160");if(!relay)return alert("浏览器阻止了凭证中转窗口，请允许弹窗后重试。");var payload={token:token,cookie:cookie,shopId:shopId,shopName:document.title||"抖店商家店铺"};var timeout=window.setTimeout(function(){window.removeEventListener("message",onMessage);alert("安全中转页连接超时，请返回飞书配置页重新生成脚本。")},10000);function onMessage(event){if(event.origin!==relayOrigin||event.source!==relay)return;var data=event.data||{};if(data.type==="doudian-capture-relay-ready"){relay.postMessage({type:"doudian-capture-credential",payload:payload},relayOrigin);return}if(data.type==="doudian-capture-result"){window.clearTimeout(timeout);window.removeEventListener("message",onMessage);alert(data.ok?"抖店登录凭据已成功上报，请返回飞书配置页。":"上报失败: "+(data.message||"请重新生成脚本"))}}window.addEventListener("message",onMessage)})();`;
}

/**
 * 功能描述：在 Clipboard API 被 iframe 权限策略拦截时，降级使用传统复制方式。
 * @param {string} text 待复制文本
 * @return {Promise<boolean>} 返回是否已自动复制成功
 */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.warn('Clipboard API 被当前页面权限策略拦截，尝试降级复制。', error);
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

/**
 * 功能描述：在自动复制被全部拦截时，展示可手动复制的已选中文本框。
 * @param {string} text 待复制文本
 * @return {void} 无返回值
 */
function showManualCopyTextarea(text: string): void {
  document.getElementById('manual-copy-bookmark-code')?.remove();

  const textarea = document.createElement('textarea');
  textarea.id = 'manual-copy-bookmark-code';
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.left = '16px';
  textarea.style.right = '16px';
  textarea.style.bottom = '16px';
  textarea.style.zIndex = '99999';
  textarea.style.width = 'calc(100vw - 32px)';
  textarea.style.height = '150px';
  textarea.style.padding = '12px';
  textarea.style.border = '1px solid #1677ff';
  textarea.style.borderRadius = '6px';
  textarea.style.background = '#fff';
  textarea.style.color = '#1f2937';
  textarea.style.boxShadow = '0 12px 32px rgba(15, 23, 42, 0.24)';
  textarea.style.fontSize = '12px';
  textarea.style.lineHeight = '18px';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  window.setTimeout(() => {
    textarea.remove();
  }, 30000);
}

/**
 * 功能描述：复制书签脚本到系统剪贴板，兼容飞书 iframe 禁用 Clipboard API 的场景。
 * @return {Promise<void>} 无返回值
 */
async function copyBookmarkCode(): Promise<void> {
  try {
    const prepared = await prepareCaptureSession();
    if (!prepared) return;

    const copied = await copyText(bookmarkCode.value);
    if (copied) {
      message.success('脚本代码已复制到剪贴板！');
      return;
    }
    showManualCopyTextarea(bookmarkCode.value);
    message.warning('复制权限被限制，已选中脚本代码，请按 Ctrl/Cmd + C 手动复制。');
  } catch (err) {
    console.error(err);
    showManualCopyTextarea(bookmarkCode.value);
    message.warning('复制权限被限制，已选中脚本代码，请按 Ctrl/Cmd + C 手动复制。');
  }
}

/**
 * 功能描述：提示用户拖拽书签按钮而非直接点击运行。
 * @return {void} 无返回值
 */
async function showDragBookmarkTip(): Promise<void> {
  const prepared = await prepareCaptureSession();
  if (prepared) {
    message.info('安全脚本已生成，请将按钮直接拖动到浏览器书签栏。');
  }
}

// 切换同步模块后重建字段列表和默认映射，保证字段配置区跟随模块变化。
watch(syncModule, async () => {
  if (isRestoringSavedConfig) return;
  captureToken.value = '';
  captureTokenExpiresAt.value = 0;
  const requestId = ++syncModuleDetailRequestId;
  await ensureSelectedDoudianInterfaceDetail();
  if (requestId !== syncModuleDetailRequestId) return;
  resetFieldMappingByModule();
  resetCustomQueryValues();
  if (
    isAccountModalOpen.value
    && currentStep.value === 2
    && accountSourceType.value === 'self'
  ) {
    await prepareCaptureSession(true);
  }
});

// 根据轮询开关创建或销毁定时器，集中管理 Cookie 捕获状态查询。
watch(isPolling, (polling) => {
  if (polling) {
    if (pollingTimer) window.clearInterval(pollingTimer);
    pollingTimer = window.setInterval(checkCaptureStatus, 2000);
  } else if (pollingTimer) {
    window.clearInterval(pollingTimer);
    pollingTimer = null;
  }
});

watch(pageTab, (tab) => {
  if (tab === 'accounts') {
    fetchSyncLogs();
  }
});

// 页面初始化：先拉动态接口目录，再恢复飞书已保存配置，最后加载用户、租户和账号数据。
onMounted(async () => {

  try {
    isInitializing.value = true;
    await fetchDoudianInterfaces(false);

    try {
      const savedConfig = isCreateConnectorMode() ? null : await bitable.getConfig();
      const config = parseSavedConnectorConfig(savedConfig);
      if (config) {
        isRestoringSavedConfig = true;
        connectorConfigId.value = config.connectorConfigId || connectorConfigId.value;
        platform.value = config.platform || platform.value;
        if (config.syncModule?.startsWith(DOUDIAN_INTERFACE_PREFIX)) {
          syncModule.value = config.syncModule;
        }
        await ensureSelectedDoudianInterfaceDetail();
        resetFieldMappingByModule();
        shopIdParam.value = config.shopIdParam || shopIdParam.value;
        dateRange.value = config.dateRange || dateRange.value;

        merchantUid.value = config.merchantUid || merchantUid.value;
        payChannel.value = config.payChannel || payChannel.value;
        timeType.value = config.timeType || timeType.value;
        customStartDate.value = config.customStartDate || customStartDate.value;
        customEndDate.value = config.customEndDate || customEndDate.value;
        resetCustomQueryValues(config.doudianExtraQuery || {});
        if (config.doudianExtraQuery) {
          const remainingExtraQuery = { ...config.doudianExtraQuery };
          customQueryFields.value.forEach((field) => {
            delete remainingExtraQuery[field.name];
          });
          doudianExtraQueryText.value = new URLSearchParams(remainingExtraQuery).toString();
        }
        if (Array.isArray(config.selectedFieldKeys)) {
          Object.keys(fieldMappings).forEach((key) => delete fieldMappings[key]);
          config.selectedFieldKeys.forEach((key: string) => {
            const field = currentModuleFields.value.find((item) => item.key === key);
            fieldMappings[key] = config.fieldMappings?.[key] || field?.defaultField || key;
          });
        } else if (config.fieldMappings && Object.keys(config.fieldMappings).length > 0) {
          Object.keys(fieldMappings).forEach((key) => delete fieldMappings[key]);
          Object.assign(fieldMappings, config.fieldMappings);
        }
        if (config.targetFieldNames && typeof config.targetFieldNames === 'object') {
          Object.entries(config.targetFieldNames).forEach(([key, value]) => {
            if (typeof value === 'string' && value.trim()) {
              targetFieldNames[key] = value.trim();
            }
          });
        }
        isRestoringSavedConfig = false;
      }
    } catch (error) {
      isRestoringSavedConfig = false;
      console.warn('读取飞书配置失败，继续使用默认配置', error);
    }
    if (!connectorConfigId.value) {
      connectorConfigId.value = createConnectorConfigId();
    }

    await ensureSelectedDoudianInterfaceDetail();
    if (Object.keys(fieldMappings).length === 0) {
      resetFieldMappingByModule();
    }

    try {
      userId.value = (await bridge.getBaseUserId()) || 'unknown';
    } catch (error) {
      console.warn('获取飞书 Base 用户 ID 失败', error);
      userId.value = 'unknown';
    }
    try {
      tenantKey.value = (await bitable.getTenantKey()) || 'unknown';
    } catch (error) {
      tenantKey.value = 'unknown';
    }
    await Promise.all([fetchAccounts(), fetchSharedAccounts()]);
  } finally {
    isInitializing.value = false;
  }

  fetchSyncLogs();
});

// 组件销毁时清理轮询定时器，避免切页后仍在后台请求捕获状态接口。
onUnmounted(() => {
  if (pollingTimer) window.clearInterval(pollingTimer);
});
</script>

<style scoped>
.bookmark-button {
  background: #ffb020;
  border-color: #ffb020;
  color: #ffffff;
  border-radius: 10px;
  font-weight: 600;
  box-shadow: none;
}



.test-result {
  color: #389e0d;
  font-size: 13px;
}

.modal-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f1f1f;
}

.account-modal-body {
  padding-top: 8px;
}

.modal-steps {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 18px;
}

.modal-step {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #8c8c8c;
  font-size: 14px;
}

.modal-step.active,
.modal-step.done {
  color: #1f1f1f;
}

.modal-step-dot {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  background: #f0f0f0;
  color: #8c8c8c;
}

.modal-step.active .modal-step-dot,
.modal-step.done .modal-step-dot {
  background: #3f78ff;
  color: #ffffff;
}

.modal-step.done .modal-step-dot {
  background: #eef4ff;
  color: #3f78ff;
  border: 1px solid #9db9ff;
}

.modal-step-line {
  width: 40px;
  height: 1px;
  background: #e8e8e8;
}

.modal-step-line.active {
  background: #9db9ff;
}

.source-type-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.source-type-card {
  position: relative;
  text-align: left;
  min-height: 156px;
  padding: 36px 20px 20px;
  border-radius: 14px;
  border: 1px solid #e8e8e8;
  background: #ffffff;
  cursor: pointer;
  transition: 0.2s ease;
}

.source-type-card.selected {
  border-color: #4c7eff;
  box-shadow: inset 0 0 0 1px #4c7eff;
  background: #f8fbff;
}

.source-select-mark {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1px solid #d9d9d9;
  color: #ffffff;
  background: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
}

.source-type-card.selected .source-select-mark {
  border-color: #4c7eff;
  background: #4c7eff;
}

.source-type-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
  margin-bottom: 12px;
}

.source-type-desc {
  color: #8c8c8c;
  font-size: 13px;
  line-height: 1.7;
}

.bind-step-wrap {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.bind-step2-wrap{
  display: flex;
  flex-direction: row;
  gap: 20px;
}
.capture-panelleft{
  display: flex;
  flex-direction: column;
  width: 340px;

}
.capture-panel {
  display: flex;
  gap: 20px;
  padding: 22px 24px;
  border-radius: 12px;
  border: 1px solid #d8e5ff;
  background: #f7fbff;
}

.capture-panel-icon img {
  width: 82px;


}

.capture-panel-content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
}

.capture-panel-copy {
  color: #3f3f46;
  font-size: 12px;
  line-height: 1.7;
}

.capture-inline-status {
  min-height: 24px;
}

.capture-idle-text {
  font-size: 12px;
  color: #8c8c8c;
}

.helper-title,
.helper-action-title {
  font-size: 13px;
  font-weight: 600;
  color: #1f1f1f;
  margin-bottom: 14px;
}

.helper-action-title {
  margin: 18px 0 12px;
}

.helper-card-row {
  display: flex;
 flex-direction: column;
  gap: 12px;
}

.helper-card{
  display: flex;
  flex-direction: row;
}

.helper-card-title{
  background: #3f78ff;
  color: #ffffff;
  width: 20px;
  height: 20px;
  border-radius: 999px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex: none;
  margin: 2px 4px 0 0;
}

.helper-card-desc {
  font-size: 14px;
  color: #8c8c8c;
  line-height: 1.6;
}

.helper-button-row {
  display: flex;
  justify-content: flex-start;
}

.helper-bookmark {
  border-color: #FDB832;
  background: #FFF8ED;
  width: 180px;
  height: 50px;
  padding: 8px;
  display: flex;
  flex-direction: row;
  gap: 12px;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #3D3D3D;
}
.helper-bookmark.disabled {
  cursor: wait;
  opacity: 0.65;
}
.helper-bookmark img{
  height: 20px;
}
.righ-helper-bookmark{
  display: flex;
  flex-direction: column;
  gap:4px;
}
.righ-helper-bookmark text{
  color: #EDA71E;
  font-size: 10px;
}
.helper-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 18px 0 12px;
}

.helper-divider span {
  flex: 1;
  height: 1px;
  border-top: 1px dashed #d9d9d9;
}

.helper-divider em {
  font-style: normal;
  color: #8c8c8c;
  font-size: 13px;
}

.helper-console-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  flex-direction: row;
  margin-bottom: 10px;
  color: #595959;
  font-size: 13px;
}
.helper-console-row p{
  line-height: 28px;
}
.modal-code {
  margin-top: 0;
}

.modal-checkboxes {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.modal-footer {
  display: flex;
  justify-content: center;
  gap: 12px;
  padding-top: 24px;
}

:deep(.ant-modal .ant-modal-content) {
  border-radius: 18px;
  padding: 20px 20px 24px;
}

:deep(.ant-modal .ant-modal-close) {
  top: 18px;
  right: 18px;
}

:deep(.ant-modal .ant-modal-header) {
  margin-bottom: 8px;
}

:deep(.ant-modal .ant-modal-title) {
  line-height: 1.2;
}
</style>
