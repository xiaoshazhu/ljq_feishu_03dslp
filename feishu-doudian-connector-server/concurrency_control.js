class ConcurrencyLimitError extends Error {
  constructor(scope, key, timeoutMs, reason = 'timeout') {
    const detail = reason === 'queue_full'
      ? '等待队列已满'
      : `等待 ${timeoutMs}ms 后仍未获得执行槽位`;
    super(`SyncBusy: ${scope} 同步并发已满，${detail}，请稍后重试`);
    this.name = 'ConcurrencyLimitError';
    this.code = 'SYNC_BUSY';
    this.retryable = true;
    this.scope = scope;
    this.reason = reason;
  }
}

class Semaphore {
  constructor(limit, scope, queueLimit) {
    this.limit = Math.max(1, Number(limit) || 1);
    this.scope = scope;
    this.queueLimit = Math.max(0, Number(queueLimit) || 0);
    this.active = 0;
    this.queue = [];
  }

  acquire(key, timeoutMs) {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.createRelease());
    }

    if (this.queueLimit > 0 && this.queue.length >= this.queueLimit) {
      return Promise.reject(new ConcurrencyLimitError(this.scope, key, timeoutMs, 'queue_full'));
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new ConcurrencyLimitError(this.scope, key, timeoutMs));
        }, timeoutMs)
      };
      this.queue.push(waiter);
    });
  }

  createRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      const waiter = this.queue.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(this.createRelease());
        return;
      }
      this.active = Math.max(0, this.active - 1);
    };
  }

  isIdle() {
    return this.active === 0 && this.queue.length === 0;
  }
}

class KeyedSemaphore {
  constructor(limit, scope, queueLimit) {
    this.limit = limit;
    this.scope = scope;
    this.queueLimit = queueLimit;
    this.semaphores = new Map();
  }

  async acquire(key, timeoutMs) {
    const normalizedKey = String(key || 'default');
    let semaphore = this.semaphores.get(normalizedKey);
    if (!semaphore) {
      semaphore = new Semaphore(this.limit, this.scope, this.queueLimit);
      this.semaphores.set(normalizedKey, semaphore);
    }

    const release = await semaphore.acquire(normalizedKey, timeoutMs);
    return () => {
      release();
      if (semaphore.isIdle()) {
        this.semaphores.delete(normalizedKey);
      }
    };
  }
}

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const settings = {
  globalLimit: readPositiveInteger('SYNC_GLOBAL_CONCURRENCY', 40),
  companyLimit: readPositiveInteger('SYNC_COMPANY_CONCURRENCY', 10),
  accountLimit: readPositiveInteger('SYNC_ACCOUNT_CONCURRENCY', 5),
  globalQueueLimit: readPositiveInteger('SYNC_GLOBAL_QUEUE_LIMIT', 200),
  companyQueueLimit: readPositiveInteger('SYNC_COMPANY_QUEUE_LIMIT', 50),
  accountQueueLimit: readPositiveInteger('SYNC_ACCOUNT_QUEUE_LIMIT', 20),
  queueTimeoutMs: readPositiveInteger('SYNC_QUEUE_TIMEOUT_MS', 1500),
  accountStartIntervalMs: readPositiveInteger('SYNC_ACCOUNT_START_INTERVAL_MS', 200)
};

const globalSemaphore = new Semaphore(settings.globalLimit, '服务实例', settings.globalQueueLimit);
const companySemaphores = new KeyedSemaphore(settings.companyLimit, '企业', settings.companyQueueLimit);
const accountSemaphores = new KeyedSemaphore(settings.accountLimit, '账号', settings.accountQueueLimit);
const accountNextStartAt = new Map();

async function acquireSyncSlot(context = {}) {
  const companyId = String(context.companyId || 'default');
  const accountKey = String(context.accountKey || context.shopId || 'unknown');
  const scopedAccountKey = `${companyId}:${accountKey}`;
  const releases = [];

  try {
    // 先获取最细粒度账号槽位，避免热点账号的等待请求提前占满企业和全局容量。
    releases.push(await accountSemaphores.acquire(scopedAccountKey, settings.queueTimeoutMs));
    releases.push(await companySemaphores.acquire(companyId, settings.queueTimeoutMs));
    releases.push(await globalSemaphore.acquire('global', settings.queueTimeoutMs));
    await waitForAccountStartWindow(scopedAccountKey);
  } catch (error) {
    releaseAll(releases);
    throw error;
  }

  return () => releaseAll(releases);
}

async function waitForAccountStartWindow(accountKey) {
  const now = Date.now();
  const nextStartAt = Math.max(now, accountNextStartAt.get(accountKey) || 0);
  accountNextStartAt.set(accountKey, nextStartAt + settings.accountStartIntervalMs);

  const waitMs = nextStartAt - now;
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const cleanupDelay = Math.max(settings.accountStartIntervalMs * 10, 1000);
  const expectedNextStartAt = nextStartAt + settings.accountStartIntervalMs;
  const timer = setTimeout(() => {
    if (accountNextStartAt.get(accountKey) === expectedNextStartAt) {
      accountNextStartAt.delete(accountKey);
    }
  }, cleanupDelay);
  if (typeof timer.unref === 'function') timer.unref();
}

function releaseAll(releases) {
  releases.reverse().forEach((release) => release());
}

module.exports = {
  acquireSyncSlot,
  ConcurrencyLimitError,
  syncConcurrencySettings: settings
};
