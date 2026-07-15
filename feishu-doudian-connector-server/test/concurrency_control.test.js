const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SYNC_GLOBAL_CONCURRENCY = '2';
process.env.SYNC_COMPANY_CONCURRENCY = '2';
process.env.SYNC_ACCOUNT_CONCURRENCY = '1';
process.env.SYNC_GLOBAL_QUEUE_LIMIT = '3';
process.env.SYNC_COMPANY_QUEUE_LIMIT = '3';
process.env.SYNC_ACCOUNT_QUEUE_LIMIT = '2';
process.env.SYNC_QUEUE_TIMEOUT_MS = '100';
process.env.SYNC_ACCOUNT_START_INTERVAL_MS = '1';

const {
  acquireSyncSlot,
  ConcurrencyLimitError
} = require('../concurrency_control.js');

test('同账号并发达到上限后排队，并在队列满时快速拒绝', async () => {
  const context = {
    companyId: 'company-test',
    accountKey: 'account-test'
  };
  const releaseFirst = await acquireSyncSlot(context);
  const secondAcquire = acquireSyncSlot(context);
  const thirdAcquire = acquireSyncSlot(context);

  await assert.rejects(
    acquireSyncSlot(context),
    (error) => (
      error instanceof ConcurrencyLimitError
      && error.scope === '账号'
      && error.reason === 'queue_full'
      && error.retryable === true
    )
  );

  releaseFirst();
  const releaseSecond = await secondAcquire;
  releaseSecond();
  const releaseThird = await thirdAcquire;
  releaseThird();
});

test('热点账号排队时不会占用其他账号的全局执行槽位', async () => {
  const hotContext = {
    companyId: 'company-fairness',
    accountKey: 'account-hot'
  };
  const coldContext = {
    companyId: 'company-fairness',
    accountKey: 'account-cold'
  };
  const releaseHotFirst = await acquireSyncSlot(hotContext);
  const hotWaiting = acquireSyncSlot(hotContext);

  const releaseCold = await Promise.race([
    acquireSyncSlot(coldContext),
    new Promise((resolve) => setTimeout(() => resolve(null), 30))
  ]);
  assert.equal(typeof releaseCold, 'function');
  releaseCold();

  releaseHotFirst();
  const releaseHotWaiting = await hotWaiting;
  releaseHotWaiting();
});

test('100 个突发请求保持并发上限并对过载请求稳定背压', async () => {
  let active = 0;
  let maxActive = 0;
  const outcomes = await Promise.all(
    Array.from({ length: 100 }, async (_, index) => {
      let release = null;
      try {
        release = await acquireSyncSlot({
          companyId: `company-burst-${index % 10}`,
          accountKey: `account-burst-${index}`
        });
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 8));
        return 'accepted';
      } catch (error) {
        assert.equal(error instanceof ConcurrencyLimitError, true);
        assert.equal(error.code, 'SYNC_BUSY');
        assert.equal(error.retryable, true);
        return 'busy';
      } finally {
        if (release) {
          active -= 1;
          release();
        }
      }
    })
  );

  const accepted = outcomes.filter((item) => item === 'accepted').length;
  const busy = outcomes.filter((item) => item === 'busy').length;
  assert.equal(accepted + busy, 100);
  assert.equal(accepted > 0, true);
  assert.equal(busy > 0, true);
  assert.equal(maxActive <= 2, true);
  assert.equal(active, 0);
});
