<template>
  <a-spin :spinning="false" tip="正在加载连接器配置...">
    <div class="connector-container">
      <nav class="left-nav">
        <div class="nav-title">配置控制台</div>
        <div
          v-for="item in navItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: activeMenu === item.key }"
          @click="scrollToSection(item.key)"
        >
          <span>{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </div>
      </nav>

    <main
      ref="scrollContainerRef"
      class="right-content"
      :class="{ 'dropdown-scroll-locked': isModuleDropdownOpen }"
      @scroll="handleScroll"
    >
      <section id="section-datasource" class="form-section">
        <div class="section-header">1. 对接数据源平台</div>
        <div class="platform-grid">
          <div class="platform-card" :class="{ selected: platform === 'douyin' }" @click="platform = 'douyin'">
            <span class="platform-icon">🎵</span>
            <div>
              <div class="platform-name">抖音电商</div>
              <div class="platform-desc">包含抖店、电商罗盘模块</div>
            </div>
          </div>

          <a-tooltip title="小红书平台接口模块暂整改中，请先使用抖音通道进行测试">
            <div class="platform-card disabled">
              <span class="platform-icon">📕</span>
              <div>
                <div class="platform-name">小红书</div>
                <div class="platform-desc">包含蒲公英、千帆平台 (不可选)</div>
              </div>
            </div>
          </a-tooltip>

          <a-tooltip title="暂不可选">
            <div class="platform-card disabled">
              <span class="platform-icon">📦</span>
              <div>
                <div class="platform-name">聚水潭 ERP</div>
                <div class="platform-desc">发货、出库与退货 (不可选)</div>
              </div>
            </div>
          </a-tooltip>

          <a-tooltip title="暂不可选">
            <div class="platform-card disabled">
              <span class="platform-icon">🔗</span>
              <div>
                <div class="platform-name">千牛工作台</div>
                <div class="platform-desc">微信/支付宝聚合账单 (不可选)</div>
              </div>
            </div>
          </a-tooltip>
        </div>
      </section>

      <section id="section-account" class="form-section">
        <div class="section-header">2. 账号授权设置</div>
        <div style="margin-bottom: 16px">
          <a-button type="primary" ghost @click="openAccountModal()">关联新账号</a-button>
        </div>
        <a-table :data-source="accounts" :columns="accountColumns" :pagination="false" size="small" row-key="key">
          <template #bodyCell="{ column, record, text }">
            <template v-if="column.key === 'active'">
              <a-radio :checked="record.isActive" @change="handleSetActiveAccount(record.key)" />
            </template>
            <template v-else-if="column.key === 'name'">
              <div>
                <div style="font-weight: 500">{{ text }}</div>
<!--                <div style="font-size: 12px; color: #8c8c8c">-->
<!--                  {{ getAccountModuleLabel(record.module) }}-->
<!--                </div>-->
              </div>
            </template>
            <template v-else-if="column.key === 'mode'">
              <a-badge color="blue" :text="record.mode" />
            </template>
            <template v-else-if="column.key === 'status'">
              <a-badge
                v-if="record.status === 'active'"
                status="success"
                text="正常 (长效保活中)"
              />
              <a-badge v-else status="error" text="凭证失效(Cookie过期)" />
            </template>
            <template v-else-if="column.key === 'action'">
              <a-space>
                <a @click="openAccountModal(record)">重新连接</a>
                <a style="color: #ff4d4f" @click="handleDeleteAccount(record)">删除</a>
              </a-space>
            </template>
          </template>
        </a-table>
      </section>

      <section id="section-params" class="form-section">
        <div class="section-header">3. 同步参数设置</div>
        <a-form layout="vertical">
          <a-form-item label="目标同步动作 / 模块" required>
            <a-tree-select
                show-search
                tree-node-filter-prop="title"
              v-model:value="syncModule"
              style="width: 100%"
              :dropdown-style="{ maxHeight: '400px', overflow: 'auto' }"
              placeholder="请选择目标同步动作 / 模块"
              tree-default-expand-all
              tree-node-label-prop="title"
              :tree-data="moduleTreeData"
              @dropdownVisibleChange="handleModuleDropdownVisibleChange"
            />
          </a-form-item>

<!--          <div v-if="selectedDoudianInterface" class="interface-summary">-->
<!--            <div>{{ selectedDoudianInterface.moduleGroup }} / {{ selectedDoudianInterface.interfaceName }}</div>-->
<!--            <code>{{ selectedDoudianInterface.apiHost }}{{ selectedDoudianInterface.apiPath }}</code>-->
<!--          </div>-->

<!--          <a-form-item v-if="selectedDoudianInterface" label="接口附加 Query 参数">-->
<!--            <a-textarea-->
<!--              v-model:value="doudianExtraQueryText"-->
<!--              :rows="3"-->
<!--              placeholder="_bid=ffa_governance_new&verifyFp=xxx&fp=xxx&msToken=xxx&a_bogus=xxx"-->
<!--            />-->
<!--          </a-form-item>-->

          <a-form-item label="抖音店铺 ID (Shop ID)" required>
            <a-input v-model:value="shopIdParam" placeholder="请输入数字格式的抖音店铺 ID，例如：982734" />
          </a-form-item>

          <div style="margin-bottom: 16px">
            <a-space>
              <a-button :loading="isTestingConnection" @click="handleTestConnection">测试连接</a-button>
              <span v-if="testConnectionResult" class="test-result">{{ testConnectionResult }}</span>
            </a-space>
          </div>

          <a-form-item label="同步时间范围" required>
            <a-select v-model:value="dateRange" :options="dateRangeOptions" />
          </a-form-item>
        </a-form>
      </section>

      <section id="section-fields" class="form-section">
        <div class="section-header between">
          <span>4. 字段与同步配置</span>
          <a-space>
            <span class="field-selected-count">已选择 {{ selectedFieldCount }} / {{ currentModuleFields.length }}</span>
            <a-button size="small" @click="handleClearFieldSelection">清空选择</a-button>
            <a-button type="primary" size="small" @click="handleAutoMapFields">全选并自动映射</a-button>
          </a-space>
        </div>
        <div style="margin-bottom: 16px; color: #595959; font-size: 13px">目标多维数据表映射配置：</div>
        <table class="field-map-table">
          <thead>
            <tr>
              <th style="width: 88px">是否同步</th>
              <th>源数据字段</th>
              <th>字段类型</th>
              <th>目标多维表格映射列</th>
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
              <td style="font-weight: 500">{{ field.label }}</td>
              <td style="font-size: 12px; color: #8c8c8c">{{ field.type }}</td>
              <td>
                <a-select
                  style="width: 220px"
                  placeholder="选择要写入的列"
                  :value="fieldMappings[field.key]"
                  :options="bitableFields"
                  :disabled="!isFieldSelected(field.key)"
                  allow-clear
                  @change="handleFieldSelectChange(field.key, $event)"
                />
              </td>
            </tr>
          </tbody>
        </table>

<!--        <a-form layout="vertical">-->
<!--          <a-form-item label="自动定时刷新频率" required>-->
<!--            <a-select v-model:value="refreshFrequency" :options="refreshFrequencyOptions" />-->
<!--          </a-form-item>-->
<!--        </a-form>-->
      </section>

      <section id="section-guide" class="form-section">
        <div class="section-header">5. 网页模拟登录与书签助手安装指南</div>
        <div style="font-size: 13px; line-height: 1.6; color: #595959">
          <p><strong>关于模式 B (Cookie 捕获免验证码同步) 的工作原理：</strong></p>
          <ol>
            <li>点击账号关联界面的“点击开始网页模拟登录”，系统将引导打开抖音罗盘或抖店登录主页。</li>
            <li>在浏览器子窗口中登录您的商家账号。</li>
            <li>登录完成后，运行“一键捕获书签”，脚本会跨域安全上报当前 Session Cookie。</li>
            <li>后端捕获 Cookie 后，配置页自动确认绑定；定时任务会复用凭证进行同步。</li>
          </ol>
          <p style="margin-top: 16px"><strong>浏览器捕获助手一键安装：</strong></p>
          <p>请将下面按钮拖动到浏览器书签栏，或者复制代码到登录后的抖音网页控制台运行。</p>
          <div style="margin: 14px 0">
            <a :href="bookmarkCode" class="ant-btn ant-btn-primary bookmark-button" @click.prevent="showDragBookmarkTip">
              拖拽此按钮至书签栏 (抖音凭证捕获助手)
            </a>
          </div>
          <div class="bookmark-code-container">
            <a-button size="small" type="primary" class="copy-btn" @click="copyBookmarkCode">复制</a-button>
            <code>{{ bookmarkCode }}</code>
          </div>
        </div>
      </section>
    </main>

    <div class="bottom-bar">
      <a-button size="large" @click="handleCancel">取消</a-button>
      <a-button size="large" type="primary" @click="handleSaveAndGoNext">创建 / 保存</a-button>
    </div>

    <a-modal
      v-model:open="isAccountModalOpen"
      :title="`${reconnectingAccount ? '重新连接账号' : '关联账号设置'} (${currentStep}/2)`"
      @cancel="closeAccountModal"
    >
      <div style="padding: 12px 0">
        <div v-if="currentStep === 1">
          <p style="font-weight: 500; margin-bottom: 12px">请选择账号来源类型：</p>
          <a-radio-group v-model:value="accountSourceType" style="display: flex; flex-direction: column; gap: 16px">
            <a-radio value="shared">
              <span style="display: inline-block; vertical-align: top; margin-left: 8px">
                <span style="display: block; font-weight: 600">使用企业共享账号</span>
                <span style="display: block; font-size: 12px; color: #8c8c8c; margin-top: 4px">
                  复用企业内其他协作者已公开发布的脱敏账号。免输入密钥/扫码，安全免密绑定。
                </span>
              </span>
            </a-radio>
            <a-radio value="self">
              <span style="display: inline-block; vertical-align: top; margin-left: 8px">
                <span style="display: block; font-weight: 600">绑定/授权自己的全新账号</span>
                <span style="display: block; font-size: 12px; color: #8c8c8c; margin-top: 4px">
                  通过网页登录方式捕获 Cookie，添加个人商户接入。
                </span>
              </span>
            </a-radio>
          </a-radio-group>
        </div>

        <div v-else>
          <div v-if="accountSourceType === 'shared'">
            <p style="font-weight: 500; margin-bottom: 12px">使用企业共享账号</p>
            <a-form layout="vertical">
              <a-form-item label="选择共享账号" required>
                <a-select v-model:value="selectedSharedAccountId" :options="sharedAccountOptions" />
              </a-form-item>
            </a-form>
            <a-checkbox v-model:checked="isNewAccountActive">绑定后立即启用该账号作为同步账号</a-checkbox>
          </div>

          <div v-else>
            <p style="font-weight: 500; margin-bottom: 12px">绑定个人新账号</p>
            <a-form layout="vertical">
              <a-form-item label="账号/店铺显示名">
                <a-input
                  v-model:value="accountDisplayName"
                  placeholder="例如：一店-商品资质、广州旗舰店、130480051-子账号"
                />
              </a-form-item>
            </a-form>
            <div class="capture-box">
              <p style="margin: 0 0 10px; font-size: 13px">
                请点击下方按钮打开官方登录页，并在登录后运行书签脚本或控制台代码进行凭证回传。
              </p>
              <a-button type="primary" :disabled="isPolling" @click="handleStartSimulatedLogin">
                点击开始网页模拟登录
              </a-button>

              <div style="margin-top: 12px">
                <div v-if="isPolling" class="capture-status-badge badge-waiting">
                  <span>正在等待浏览器脚本回传 Cookie 凭据...</span>
                </div>
                <div v-else-if="capturedCookie" class="capture-status-badge badge-success">
                  <span>凭证自动拦截成功 (已获取)</span>
                </div>
                <div v-else style="font-size: 12px; color: #8c8c8c; margin-top: 6px">（未启动拦截）</div>
            </div>
            </div>

            <div class="modal-tip-box">
              <div style="font-size: 13px; font-weight: 600; margin-bottom: 8px; color: #333">
                安装与使用书签助手：
              </div>
              <div style="font-size: 12px; color: #595959; margin-bottom: 8px; line-height: 1.4">
                1. 显示浏览器书签栏（快捷键：Ctrl/Cmd + Shift + B）。<br />
                2. 直接拖拽下方按钮至您的浏览器书签栏。<br />
                3. 登录抖店后台主页后，点击该书签即可自动上报并绑定。
              </div>
              <div style="margin-bottom: 12px">
                <a :href="bookmarkCode" class="ant-btn ant-btn-primary bookmark-button compact" @click.prevent="showDragBookmarkTip">
                  拖拽此按钮至书签栏 (抖音凭证捕获助手)
                </a>
              </div>
              <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px">
                或复制并在登录后的网页控制台 (Console) 中贴入回车运行：
              </div>
              <div class="bookmark-code-container" style="margin-top: 4px">
                <a-button size="small" type="primary" class="copy-btn" @click="copyBookmarkCode">复制</a-button>
                <code style="font-size: 10px; display: block; word-break: break-all">{{ bookmarkCode }}</code>
              </div>
            </div>

            <div style="margin-top: 16px; border-top: 1px solid #f0f0f0; padding-top: 12px">
              <a-checkbox v-model:checked="allowShare">允许该账号在企业内共享复用</a-checkbox>
            </div>
            <div style="margin-top: 8px">
              <a-checkbox v-model:checked="isNewAccountActive">绑定后立即启用该账号作为同步账号</a-checkbox>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <a-button v-if="currentStep === 2" @click="currentStep = 1">返回上一步</a-button>
        <a-button v-if="currentStep === 1" type="primary" @click="currentStep = 2">下一步</a-button>
        <a-button v-else type="primary" @click="handleSaveAccountRelation">
          {{ reconnectingAccount ? '确认更新账号' : '确认关联并绑定' }}
        </a-button>
      </template>
    </a-modal>
    </div>
  </a-spin>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import { bitable } from '@lark-base-open/connector-api';
import { bridge } from '@lark-base-open/js-sdk';

// 数据源字段定义：用于渲染字段映射表，也会作为保存到飞书配置中的映射来源。
interface ModuleField {
  key: string;
  label?: string;
  fieldName?: string;
  type?: 'Text' | 'Number' | 'DateTime';
  defaultField?: string;
}

// 已绑定账号定义：来自后端 accounts 表，用于账号列表与同步配置 accountInfo。
interface Account {
  key: string;
  name: string;
  mode: string;
  status: 'active' | 'expired';
  cookie?: string;
  shopId?: string;
  isActive?: boolean;
  module?: string;
  userId?: string;
  shareScope?: 'company' | 'private';
}

// 共享账号定义：来自企业共享账号接口，可被当前用户免密绑定复用。
interface SharedAccount {
  id: string;
  key?: string;
  name: string;
  mode?: string;
  status?: 'active' | 'expired';
  cookie?: string;
  shopId?: string;
  module?: string;
  shareScope?: 'company' | 'private';
}

// Ant Design Vue Select 组件的通用选项结构。
interface BitableOption {
  value: string;
  label: string;
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
  { key: 'datasource', icon: '🔗', label: '数据源选择' },
  { key: 'account', icon: '🔑', label: '账号设置' },
  { key: 'params', icon: '⚙️', label: '参数设置' },
  { key: 'fields', icon: '📊', label: '字段设置' },
  { key: 'guide', icon: '❓', label: '使用说明' }
];

// 固定模块树配置：保留为空时，只展示后端动态返回的抖店接口目录。
const BASE_MODULE_TREE_DATA: ModuleTreeNode[] = [

];

// 账号表格列定义：实际渲染内容由 template 的 bodyCell 插槽控制。
const accountColumns = [
  { title: '启用', key: 'active', width: 60, align: 'center' },
  { title: '账号/店铺名称', dataIndex: 'name', key: 'name' },
  { title: '对接模式', dataIndex: 'mode', key: 'mode' },
  { title: '凭证状态', dataIndex: 'status', key: 'status' },
  { title: '操作', key: 'action' }
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
  { value: '3', label: '回溯近 3 天数据（高频增量，推荐）' },
  { value: '7', label: '回溯近 7 天数据' },
  { value: '30', label: '回溯近 30 天数据（多页拉取）' }
];

// 飞书同步刷新频率选项，会随配置保存给后端任务表。
const refreshFrequencyOptions = [
  { value: 'hour', label: '每小时自动静默同步（采用捕获凭证长效保活）' },
  { value: 'none', label: '不自动刷新（仅限用户在表格内手动触发）' }
];

// 当前左侧导航高亮项。
const activeMenu = ref('datasource');
// 当前选择的数据源平台，目前默认抖音电商。
const platform = ref('douyin');
// 当前飞书 Base 用户 ID，用于隔离个人账号和 Cookie 捕获缓冲。
const userId = ref('');
// 当前飞书租户 Key，用于企业维度的数据隔离。
const tenantKey = ref('');
// 当前可用账号列表，包含个人账号和可见的共享账号。
const accounts = ref<Account[]>([]);
// 页面初始化期间显示加载态，避免配置恢复前展示默认信息。
const isInitializing = ref(true);
// 后端返回的抖店接口目录列表。
const doudianInterfaces = ref<DoudianInterface[]>([]);
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
// 模块下拉框是否打开，打开时用于锁住右侧滚动容器。
const isModuleDropdownOpen = ref(false);
// 书签助手捕获到的 Cookie。
const capturedCookie = ref('');
// 书签助手捕获到的店铺 ID。
const capturedShopId = ref('');
// 书签助手捕获到的店铺名称。
const capturedShopName = ref('');
// 当前选择的同步模块，统一使用 DOUDIAN_INTERFACE_PREFIX + interfaceKey。
const syncModule = ref('');
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
  order_id: 'col_order_id',
  create_time: 'col_create_time_v2',
  pay_amount: 'col_pay_amount',
  order_status: 'col_order_status',
  shop_name: 'col_shop_name',
  shop_id: 'col_shop_id'
});
// 自动刷新频率配置。
const refreshFrequency = ref('hour');
const merchantUid = ref('');
const payChannel = ref('');
const timeType = ref('');
const customStartDate = ref('');
const customEndDate = ref('');
// 右侧滚动容器引用，用于滚动监听和导航高亮。
const scrollContainerRef = ref<HTMLElement | null>(null);
// Cookie 捕获轮询定时器句柄，组件卸载或停止轮询时必须清理。
let pollingTimer: number | null = null;
// 恢复飞书已保存配置时，避免模块 watcher 把字段选择重置成全选。
let isRestoringSavedConfig = false;

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
const sharedAccountOptions = computed(() => sharedAccounts.value.map((account) => ({
  value: account.id,
  label: `${account.name}${account.shareScope === 'private' ? '（仅自己可见）' : '（企业共享）'}`
})));
// 当前页面生成的书签助手代码，会随租户、用户和模块变化自动更新。
const bookmarkCode = computed(() => buildBookmarkCode());

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
  bitableFields.value = fields.map((field) => {
    const labelText = (field.label || field.fieldName || field.key).split(' (')[0];
    const typeText = field.type === 'Text' ? '文本型' : field.type === 'Number' ? '数字型' : '日期型';
    const emoji = field.type === 'DateTime' ? '📅' : field.type === 'Number' ? '💰' : '📝';
    return { value: field.defaultField || field.key, label: `${emoji} ${labelText} (${typeText})` };
  });

  Object.keys(fieldMappings).forEach((key) => delete fieldMappings[key]);
  fields.forEach((field) => {
    fieldMappings[field.key] = field.defaultField || field.key;
  });
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
 * @return {Promise<void>} 无返回值
 */
async function fetchDoudianInterfaces(): Promise<void> {
  try {
    const response = await fetch('/api/v1/connector/doudian-interfaces');
    if (!response.ok) throw new Error('获取接口目录失败');
    const data: DoudianInterface[] = await response.json();
    doudianInterfaces.value = data;
    moduleTreeData.value = buildModuleTreeWithDoudianInterfaces(data);
    if (!syncModule.value && data[0]) {
      syncModule.value = `${DOUDIAN_INTERFACE_PREFIX}${data[0].interfaceKey}`;
    }
  } catch (error) {
    console.warn('获取抖店接口目录失败，继续使用本地基础模块', error);
    doudianInterfaces.value = [];
    moduleTreeData.value = BASE_MODULE_TREE_DATA;
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
    const response = await fetch(`/api/v1/connector/accounts?${getCompanyQuery()}`);
    if (!response.ok) return;
    const data = await response.json();
    const mappedList: Account[] = data.map((item: any) => ({
      key: item.key,
      name: item.name,
      mode: item.mode,
      status: item.status,
      cookie: item.cookie,
      shopId: item.shopId,
      isActive: item.is_active === 1,
      module: item.module,
      userId: item.user_id,
      shareScope: item.share_scope
    }));
    accounts.value = mappedList;
    const activeAccount = mappedList.find((account) => account.isActive);
    if (activeAccount?.shopId) shopIdParam.value = activeAccount.shopId;
    if (activeAccount?.module?.startsWith(DOUDIAN_INTERFACE_PREFIX)) syncModule.value = activeAccount.module;
  } catch (error) {
    console.error('从 MySQL 数据库获取账户列表失败', error);
  }
}

/**
 * 功能描述：拉取企业共享账号列表。
 * @return {Promise<void>} 无返回值
 */
async function fetchSharedAccounts(): Promise<void> {
  try {
    const response = await fetch(`/api/v1/connector/shared-accounts?${getCompanyQuery()}`);
    if (!response.ok) throw new Error('获取共享账号失败');
    const data = await response.json();
    sharedAccounts.value = data;
    selectedSharedAccountId.value = data[0]?.id || '';
  } catch (error) {
    console.warn('获取可关联账号列表失败', error);
    sharedAccounts.value = [];
    selectedSharedAccountId.value = '';
  }
}

/**
 * 功能描述：查询 Cookie 是否已被书签助手成功拦截并上报。
 * @return {Promise<void>} 无返回值
 */
async function checkCaptureStatus(): Promise<void> {
  try {
    const response = await fetch(`/api/v1/connector/sources/capture-status?${getCompanyQuery()}`);
    if (!response.ok) return;
    const data = await response.json();
    if (data.captured && data.cookie) {
      stopCapturePolling();
      capturedCookie.value = data.cookie;
      capturedShopId.value = data.shopId || '';
      capturedShopName.value = data.shopName || '已拦截抖店';
      if (data.module?.startsWith(DOUDIAN_INTERFACE_PREFIX)) syncModule.value = data.module;
      message.success(`成功拦截到抖店登录凭据！店铺名: ${data.shopName || '未命名'}`);
    }
  } catch (error) {
    console.error('轮询捕获状态接口出错', error);
  }
}
// 进入账号关联第二步时刷新共享账号，避免弹窗打开较早导致列表仍为空。
watch(currentStep, async (newVal) => {
  if (newVal === 2) {
    await fetchSharedAccounts();
  }
});
/**
 * 功能描述：打开关联账号弹窗并清理本次捕获态。
 * @return {void} 无返回值
 */
function openAccountModal(account?: Account): void {
  reconnectingAccount.value = account || null;
  currentStep.value = account ? 2 : 1;
  isAccountModalOpen.value = true;
  accountSourceType.value = account ? 'self' : accountSourceType.value;
  capturedCookie.value = '';
  capturedShopId.value = '';
  capturedShopName.value = '';
  accountDisplayName.value = account?.name || '';
  pastedCookie.value = '';
  stopCapturePolling();
  isNewAccountActive.value = account ? account.isActive !== false : true;
  allowShare.value = account ? account.shareScope !== 'private' : allowShare.value;
  fetch('/api/v1/connector/sources/capture-clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantKey: tenantKey.value || 'default',
      userId: userId.value || 'default'
    })
  }).catch(() => {});
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
function handleStartSimulatedLogin(): void {
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
  let newAccount: Account | null = null;
  const customDisplayName = accountDisplayName.value.trim();

  if (accountSourceType.value === 'shared') {
    const selected = sharedAccounts.value.find((account) => account.id === selectedSharedAccountId.value);
    if (!selected) {
      message.error('请选择一个有效的共享账号');
      return;
    }
    newAccount = {
      key: selected.key || selected.id,
      name: customDisplayName || selected.name,
      mode: selected.mode || '企业共享免密',
      status: selected.status || 'active',
      cookie: selected.cookie || '',
      shopId: selected.shopId || '',
      module: selected.module || syncModule.value
    };
  } else {
    let finalCookie = capturedCookie.value || pastedCookie.value;
    let finalShopId = capturedShopId.value;
    let finalShopName = capturedShopName.value;

    if (!finalCookie) {
      try {
        const response = await fetch(`/api/v1/connector/sources/capture-status?${getCompanyQuery()}`);
        if (response.ok) {
          const data = await response.json();
          if (data.captured && data.cookie) {
            finalCookie = data.cookie;
            finalShopId = data.shopId || '';
            finalShopName = data.shopName || '已拦截抖店';
          }
        }
      } catch (error) {
        console.error('最后尝试获取凭证失败', error);
      }
    }

    if (!finalCookie) {
      message.error('请在下方登录或手动粘贴您的 Cookie 凭证！');
      return;
    }

    const match = finalCookie.match(/shop_id=(\d+)/) || finalCookie.match(/shop_id_str=(\d+)/);
    const displayShopId = finalShopId || (match ? match[1] : reconnectingAccount.value?.shopId || '手动录入');
    const shopNamePrefix = buildShopNamePrefix(finalShopName, displayShopId);
    const moduleLabel = getAccountModuleLabel(syncModule.value);
    newAccount = {
      key: reconnectingAccount.value?.key || `self_${Date.now()}`,
      name: customDisplayName || reconnectingAccount.value?.name || `${shopNamePrefix} / ${moduleLabel}`,
      mode: '模拟登录',
      status: 'active',
      cookie: finalCookie,
      shopId: displayShopId,
      module: reconnectingAccount.value?.module || syncModule.value,
      shareScope: reconnectingAccount.value?.shareScope
    };
  }

  try {
    await fetch('/api/v1/connector/accounts/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: newAccount.key,
        name: newAccount.name,
        mode: newAccount.mode,
        status: newAccount.status,
        cookie: newAccount.cookie || '',
        shopId: newAccount.shopId || '',
        is_active: isNewAccountActive.value ? 1 : 0,
        module: newAccount.module || '',
        tenantKey: tenantKey.value || 'default',
        userId: userId.value || 'default',
        shareScope: accountSourceType.value === 'shared'
          ? (selectedSharedAccountId.value
            ? sharedAccounts.value.find((account) => account.id === selectedSharedAccountId.value)?.shareScope || 'company'
            : 'company')
          : (newAccount.shareScope || (allowShare.value ? 'company' : 'private'))
      })
    });
    message.success(reconnectingAccount.value ? '账号凭证已更新！' : '新账号已成功绑定并存盘！');
    await fetchAccounts();
    closeAccountModal();
  } catch (error) {
    message.error('写入数据库失败');
  }
}

/**
 * 功能描述：切换当前启用的同步账号。
 * @param {string} key 账号主键
 * @return {Promise<void>} 无返回值
 */
async function handleSetActiveAccount(key: string): Promise<void> {
  try {
    const response = await fetch('/api/v1/connector/accounts/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        tenantKey: tenantKey.value || 'default',
        userId: userId.value || 'default'
      })
    });
    if (response.ok) {
      message.success('已成功切换并启用该数据源同步账号！');
      await fetchAccounts();
    }
  } catch (error) {
    message.error('切换启用账号失败');
  }
}

/**
 * 功能描述：解除某个账号。本人创建的账号由后端逻辑删除，共享账号只从当前用户列表移除。
 * @param {Account} account 当前操作的账号
 * @return {Promise<void>} 无返回值
 */
async function handleDeleteAccount(account: Account): Promise<void> {
  if (String(account.userId || '') !== String(userId.value || 'default')) {
    accounts.value = accounts.value.filter((item) => item.key !== account.key);
    message.info('已从当前页面移除该共享账号，下次进入仍可重新选择');
    return;
  }

  try {
    const response = await fetch(`/api/v1/connector/accounts/${account.key}`, {
      method: 'DELETE',
      headers: {
        'x-tenant-key': tenantKey.value || 'default',
        'x-user-id': userId.value || 'default'
      }
    });
    if (response.ok) {
      const result = await response.json().catch(() => null);
      message.info(result?.message || '账号已解除关联');
      await fetchAccounts();
    } else {
      const result = await response.json().catch(() => null);
      message.error(result?.message || '删除账号失败');
    }
  } catch (error) {
    message.error('删除账号失败');
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
  message.info('已清空字段选择，请至少勾选一个需要同步的字段。');
}

/**
 * 功能描述：切换单个字段是否参与同步。
 * @param {string} sourceKey 数据源字段标识
 * @param {boolean} checked 是否同步
 * @return {void} 无返回值
 */
function handleFieldSyncToggle(sourceKey: string, checked: boolean): void {
  if (!checked) {
    delete fieldMappings[sourceKey];
    return;
  }
  const field = currentModuleFields.value.find((item) => item.key === sourceKey);
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
  handleMapFieldChange(sourceKey, typeof value === 'string' ? value : '');
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
  if (!shopIdParam.value) {
    message.error('请先填写抖音店铺 ID');
    return;
  }
  if (!selectedDoudianInterface.value) {
    message.error('请选择一个抖店接口');
    return;
  }
  if (accounts.value.length === 0) {
    message.error('请先关联一个抖店账号');
    return;
  }

  isTestingConnection.value = true;
  try {
    const response = await fetch('/api/v1/connector/doudian/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantKey: tenantKey.value || 'default',
        userId: userId.value || 'default',
        syncModule: syncModule.value,
        doudianInterface: buildSelectedDoudianInterfaceConfig(),
        shopIdParam: shopIdParam.value,
        doudianExtraQuery: parseQueryText(doudianExtraQueryText.value)
      })
    });
    const result = await response.json();
    if (!response.ok || result.code !== 0) {
      throw new Error(result.message || '测试连接失败');
    }
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
  if (!shopIdParam.value) {
    message.error('请输入需要同步的抖音店铺 ID (Shop ID)！');
    return;
  }
  if (!selectedDoudianInterface.value) {
    message.error('请选择一个抖店接口！');
    return;
  }
  const selectedFieldKeys = getSelectedFieldKeys();
  if (currentModuleFields.value.length > 0 && selectedFieldKeys.length === 0) {
    message.error('请至少选择一个需要同步的字段！');
    return;
  }

  const activeAccount = accounts.value.find((account) => account.isActive) || accounts.value[0];
  const config = {
    platform: platform.value,
    syncModule: syncModule.value,
    doudianInterfaceKey: selectedDoudianInterfaceKey.value,
    doudianInterface: buildSelectedDoudianInterfaceConfig(),
    doudianExtraQuery: parseQueryText(doudianExtraQueryText.value),
    shopIdParam: shopIdParam.value,
    dateRange: dateRange.value,
    fieldMappings: { ...fieldMappings },
    selectedFieldKeys,
    refreshFrequency: refreshFrequency.value,
    merchantUid: merchantUid.value,
    payChannel: payChannel.value,
    timeType: timeType.value,
    customStartDate: customStartDate.value,
    customEndDate: customEndDate.value,
    tenantKey: tenantKey.value || 'default',
    userId: userId.value || 'default',
    accountInfo: {
      mode: activeAccount?.mode || '模拟登录',
      name: activeAccount?.name || '抖店模拟账号',
      cookie: activeAccount?.cookie || pastedCookie.value,
      shopId: activeAccount?.shopId || shopIdParam.value
    }
  };

  try {
    const response = await fetch('/api/v1/sync/tasks/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    if (!response.ok) throw new Error('后端任务保存失败');
    bitable.saveConfigAndGoNext({ value: JSON.stringify(config) });
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
  document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 功能描述：根据滚动位置高亮当前配置区块。
 * @return {void} 无返回值
 */
function handleScroll(): void {
  const container = scrollContainerRef.value;
  if (!container) return;
  const sections = ['datasource', 'account', 'params', 'fields', 'guide'];
  let currentSection = 'datasource';
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
 * 功能描述：生成可拖入书签栏的 Cookie 捕获脚本。
 * @return {string} 返回 bookmarklet 代码
 */
function buildBookmarkCode(): string {
  const serverUrl = `${window.location.origin}/api/v1/connector/sources/login-capture`;
  const companyId = encodeURIComponent(tenantKey.value || 'default');
  const currentUserId = encodeURIComponent(userId.value || 'default');
  const currentModule = encodeURIComponent(syncModule.value || '');
  return `javascript:(function(){var cookie=document.cookie;var tenantKey="${companyId}";var userId="${currentUserId}";var selectedModule="${currentModule}";var shopIdMatch=cookie.match(/shop_id=(\\d+)/)||cookie.match(/shop_id_str=(\\d+)/);var shopId=shopIdMatch?shopIdMatch[1]:'';if(!shopId){var match=window.location.href.match(/shop_id=(\\d+)/);if(match)shopId=match[1]}if(!shopId){shopId=prompt("请输入您的抖音店铺 ID / Shop ID (必填):")}if(!shopId)return alert("获取店铺 ID 失败，取消上报！");var module=decodeURIComponent(selectedModule)||"";var companyId=decodeURIComponent(tenantKey);var openUserId=decodeURIComponent(userId);var payload={tenantKey:companyId,companyId:companyId,userId:openUserId,cookie:cookie,shopId:shopId,shopName:document.title||"抖店商家店铺",module:module,userAgent:navigator.userAgent};fetch("${serverUrl}",{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(function(res){return res.json()}).then(function(){alert("抖音登录凭据已成功上报，您可以返回多维表格配置页。")}).catch(function(err){alert("上报失败: "+err.message)})})();`;
}

/**
 * 功能描述：复制书签脚本到系统剪贴板。
 * @return {Promise<void>} 无返回值
 */
async function copyBookmarkCode(): Promise<void> {
  await navigator.clipboard.writeText(bookmarkCode.value);
  message.success('脚本代码已复制到剪贴板！');
}

/**
 * 功能描述：提示用户拖拽书签按钮而非直接点击运行。
 * @return {void} 无返回值
 */
function showDragBookmarkTip(): void {
  message.info('请将该按钮直接拖动到浏览器书签栏。');
}

// 切换同步模块后重建字段列表和默认映射，保证字段配置区跟随模块变化。
watch(syncModule, () => {
  if (isRestoringSavedConfig) return;
  resetFieldMappingByModule();
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

// 页面初始化：先拉动态接口目录，再恢复飞书已保存配置，最后加载用户、租户和账号数据。
onMounted(async () => {

  try {
    isInitializing.value = true;
    await fetchDoudianInterfaces();
    resetFieldMappingByModule();

    try {
      const config = await bitable.getConfig();
      if (config) {
        isRestoringSavedConfig = true;
        platform.value = config.platform || platform.value;
        if (config.syncModule?.startsWith(DOUDIAN_INTERFACE_PREFIX)) {
          syncModule.value = config.syncModule;
        }
        resetFieldMappingByModule();
        shopIdParam.value = config.shopIdParam || shopIdParam.value;
        dateRange.value = config.dateRange || dateRange.value;
        refreshFrequency.value = config.refreshFrequency || refreshFrequency.value;
        merchantUid.value = config.merchantUid || merchantUid.value;
        payChannel.value = config.payChannel || payChannel.value;
        timeType.value = config.timeType || timeType.value;
        customStartDate.value = config.customStartDate || customStartDate.value;
        customEndDate.value = config.customEndDate || customEndDate.value;
        if (config.doudianExtraQuery) {
          doudianExtraQueryText.value = new URLSearchParams(config.doudianExtraQuery).toString();
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
        isRestoringSavedConfig = false;
      }
    } catch (error) {
      isRestoringSavedConfig = false;
      console.warn('读取飞书配置失败，继续使用默认配置', error);
    }

    try {
      userId.value = (await bridge.getBaseUserId()) || 'unknown';
    } catch (error) {
      console.warn('获取飞书 Base 用户 ID 失败', error);
      userId.value = 'unknown';
    }
    try {
      tenantKey.value = (await bitable.getTenantKey()) || 'unknown';
      console.log( tenantKey.value)
    } catch (error) {
      tenantKey.value = 'unknown';
    }
    await Promise.all([fetchAccounts(), fetchSharedAccounts()]);
  } finally {
    isInitializing.value = false;
  }
});

// 组件销毁时清理轮询定时器，避免切页后仍在后台请求捕获状态接口。
onUnmounted(() => {
  if (pollingTimer) window.clearInterval(pollingTimer);
});
</script>

<style scoped>
.bookmark-button {
  background: #d4b106;
  border-color: #d4b106;
  color: #ffffff;
  border-radius: 20px;
  font-weight: 600;
  box-shadow: 0 4px 10px rgba(212, 177, 6, 0.2);
}

.bookmark-button.compact {
  font-size: 12px;
  padding: 4px 12px;
  height: auto;
}

.interface-summary {
  margin: -6px 0 16px;
  padding: 10px 12px;
  border: 1px solid #d9e6ff;
  border-radius: 6px;
  background: #f7fbff;
  color: #1f1f1f;
  font-size: 13px;
}

.interface-summary code {
  display: block;
  margin-top: 4px;
  color: #595959;
  white-space: normal;
  word-break: break-all;
}

.test-result {
  color: #389e0d;
  font-size: 13px;
}
</style>
