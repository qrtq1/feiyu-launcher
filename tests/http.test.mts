import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatBytes, pool, retry } from '../src/main/core/http'

test('formatBytes 分档正确', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3.00 GB')
})

test('pool 保持输入顺序并遵守并发上限', async () => {
  let live = 0
  let peak = 0
  const out = await pool([1, 2, 3, 4, 5, 6], 2, async (n) => {
    live++
    peak = Math.max(peak, live)
    await new Promise((r) => setTimeout(r, 5))
    live--
    return n * 10
  })
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60])
  assert.ok(peak <= 2, `峰值并发 ${peak} 超过了上限 2`)
  assert.ok(peak >= 1)
})

test('pool 空输入返回空数组', async () => {
  assert.deepEqual(await pool([], 4, async () => 1), [])
})

test('retry 允许前几次失败', async () => {
  let tries = 0
  const v = await retry(
    async () => {
      tries++
      if (tries < 3) throw new Error('boom')
      return 'ok'
    },
    3,
    1
  )
  assert.equal(v, 'ok')
  assert.equal(tries, 3)
})

test('retry 次数耗尽后抛出最后一次的错误', async () => {
  await assert.rejects(
    () =>
      retry(async () => {
        throw new Error('always')
      }, 2, 1),
    /always/
  )
})
