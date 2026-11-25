import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoMaxMemory, autoMinMemory, mbToGb, memoryPlan, sliderMaxMemory, totalMemoryText } from '../src/shared/memory'

const GB = 1024 * 1024 * 1024

test('autoMaxMemory 按物理内存给一个稳妥的堆', () => {
  // 4 GB：给系统留完，再对半劈
  assert.equal(autoMaxMemory(4 * GB), 2048)
  // 8 GB
  assert.equal(autoMaxMemory(8 * GB), 3584)
  // 16 GB
  assert.equal(autoMaxMemory(16 * GB), 8192)
  // 32 GB / 64 GB：撞到 12 GB 上限
  assert.equal(autoMaxMemory(32 * GB), 12288)
  assert.equal(autoMaxMemory(64 * GB), 12288)
})

test('autoMaxMemory 永远不超过物理内存的一半', () => {
  for (const gb of [2, 3, 4, 6, 8, 12, 16, 24, 32, 64, 128]) {
    const total = gb * GB
    const max = autoMaxMemory(total)
    assert.ok(max <= (total / 2) + 512, `${gb}GB 算出来 ${max} MB 超过一半了`)
    assert.ok(max >= 512, `${gb}GB 算出来 ${max} MB 太小`)
  }
})

test('autoMaxMemory 拿不到物理内存时给保守值', () => {
  assert.equal(autoMaxMemory(0), 4096)
  assert.equal(autoMaxMemory(-1), 4096)
  assert.equal(autoMaxMemory(Number.NaN), 4096)
})

test('memoryPlan 自动模式用算出来的值、最小堆 512', () => {
  const p = memoryPlan('auto', 16 * GB, { maxMemory: 2048, minMemory: 1024 })
  assert.equal(p.mode, 'auto')
  assert.equal(p.maxMemory, 8192)
  assert.equal(p.minMemory, autoMinMemory())
  assert.equal(p.minMemory, 512)
  assert.equal(p.autoMax, 8192)
  assert.equal(p.totalMb, 16384)
})

test('memoryPlan 手动模式用用户填的、并按边界夹紧', () => {
  const p = memoryPlan('manual', 16 * GB, { maxMemory: 6144, minMemory: 2048 })
  assert.equal(p.maxMemory, 6144)
  assert.equal(p.minMemory, 2048)
  // 建议值照样算出来，界面上当参考
  assert.equal(p.autoMax, 8192)

  assert.equal(memoryPlan('manual', 16 * GB, { maxMemory: 100, minMemory: 0 }).maxMemory, 512)
  // Xms 不能比 Xmx 大
  const weird = memoryPlan('manual', 16 * GB, { maxMemory: 4096, minMemory: 99999 })
  assert.equal(weird.minMemory, 4096)
  // 0 表示不传 -Xms
  assert.equal(memoryPlan('manual', 16 * GB, { maxMemory: 4096, minMemory: 0 }).minMemory, 0)
})

test('mbToGb / totalMemoryText / sliderMaxMemory', () => {
  assert.equal(mbToGb(8192), '8 GB')
  assert.equal(mbToGb(7680), '7.5 GB')
  assert.equal(mbToGb(0), '—')
  assert.equal(totalMemoryText(16 * GB), '16.0 GB')
  assert.equal(totalMemoryText(0), '未知')
  assert.equal(sliderMaxMemory(16 * GB), 16384)
  assert.equal(sliderMaxMemory(0), 16384)
})

test('memoryPlan 32 位 Java：自动压到 1 GB、手动最多 2 GB', () => {
  const auto = memoryPlan('auto', 16 * GB, { maxMemory: 4096, minMemory: 512 }, { arch32: true })
  assert.equal(auto.maxMemory, 1024)
  assert.equal(auto.autoMax, 1024)
  assert.equal(auto.minMemory, 512)
  assert.equal(auto.arch32, true)

  const manual = memoryPlan('manual', 16 * GB, { maxMemory: 8192, minMemory: 4096 }, { arch32: true })
  assert.equal(manual.maxMemory, 2048)
  assert.equal(manual.minMemory, 2048)

  // 不传 arch32 时行为和以前一样
  assert.equal(memoryPlan('auto', 16 * GB, { maxMemory: 1, minMemory: 0 }).maxMemory, 8192)
})