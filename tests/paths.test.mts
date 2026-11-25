import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { assertSafeVersionId, defaultDataDir, isInside } from '../src/main/core/paths'

test('isInside 认得自身与子目录', () => {
  const root = 'C:\\game'
  assert.equal(isInside(root, root), true)
  assert.equal(isInside(root, join(root, 'versions', '1.20.1')), true)
  assert.equal(isInside(root, join(root, 'versions', '1.20.1', 'mods', 'a.jar')), true)
})

test('isInside 拒绝 ../ 逃逸与盘外路径', () => {
  const root = 'C:\\game'
  assert.equal(isInside(root, join(root, '..', '..', 'Windows')), false)
  assert.equal(isInside(root, 'C:\\Windows'), false)
  assert.equal(isInside(root, 'D:\\elsewhere'), false)
})

test('assertSafeVersionId 挡住路径分隔符与 ..', () => {
  assert.throws(() => assertSafeVersionId('..\\..\\Windows'))
  assert.throws(() => assertSafeVersionId('../escape'))
  assert.throws(() => assertSafeVersionId('a/b'))
  assert.throws(() => assertSafeVersionId(''))
  assert.throws(() => assertSafeVersionId('.'))
  assert.throws(() => assertSafeVersionId(' padded '))
})

test('assertSafeVersionId 放行真实存在的 id 形状', () => {
  assert.equal(assertSafeVersionId('1.20.1'), '1.20.1')
  assert.equal(assertSafeVersionId('1.20.1-forge-47.4.29'), '1.20.1-forge-47.4.29')
  assert.equal(assertSafeVersionId('fabric-loader-0.20.1-1.20.1'), 'fabric-loader-0.20.1-1.20.1')
  assert.equal(assertSafeVersionId('改名测试实例'), '改名测试实例')
})

test('assertSafeVersionId 挡住 Windows 保留字符 / 设备名 / 尾随点', () => {
  assert.throws(() => assertSafeVersionId('a:b'))
  assert.throws(() => assertSafeVersionId('CON'))
  assert.throws(() => assertSafeVersionId('com1'))
  assert.throws(() => assertSafeVersionId('x.'))
  assert.throws(() => assertSafeVersionId('a<b'))
})


test('defaultDataDir 三个平台各有去处', () => {
  const win = defaultDataDir('win32', 'C:\\Users\\u')
  const mac = defaultDataDir('darwin', '/Users/u')
  const linux = defaultDataDir('linux', '/home/u')
  assert.ok(win.endsWith('feiyu-launcher'))
  assert.ok(win.includes('AppData'))
  assert.ok(mac.includes('Library'))
  assert.ok(linux.includes('.local'))
  assert.equal(linux.includes('AppData'), false)
})