import { test } from 'node:test'
import assert from 'node:assert/strict'
import { offlineUuid, resolveAuthEndpoint } from '../src/main/core/auth'

test('offlineUuid 是确定性的 v3 UUID', () => {
  const a = offlineUuid('Steve')
  assert.equal(a, offlineUuid('Steve'), '同一名字必须得到同一 UUID')
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, '版本位必须是 3，变体位必须是 8/9/a/b')
})

test('offlineUuid 区分大小写且不同名不同值', () => {
  assert.notEqual(offlineUuid('Steve'), offlineUuid('steve'))
  assert.notEqual(offlineUuid('Steve'), offlineUuid('Alex'))
})

test('resolveAuthEndpoint 空 clientId 回落到官方公共客户端', () => {
  const ep = resolveAuthEndpoint('')
  assert.equal(ep.mode, 'live')
  assert.equal(ep.clientId, '00000000402b5328')
})

test('resolveAuthEndpoint 按 GUID 判定 Azure 端点', () => {
  const guid = '12345678-1234-1234-1234-123456789012'
  const ep = resolveAuthEndpoint(guid)
  assert.equal(ep.mode, 'azure')
  assert.equal(ep.clientId, guid)
})

test('resolveAuthEndpoint 非 GUID 按 Live Connect 处理', () => {
  const ep = resolveAuthEndpoint('00000000402b5328')
  assert.equal(ep.mode, 'live')
  assert.equal(ep.clientId, '00000000402b5328')
})
