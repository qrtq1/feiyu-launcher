import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildServers, parseServers } from '../src/main/core/servers'

test('servers.dat 大图标（>32KB）往返一致', () => {
  // NBT 字符串长度是无符号 16 位：超过 32767 字节的 icon 曾被按有符号读成负数，
  // 导致解析崩坏 → listServers 静默返回空 → addServer 把原列表整个覆盖掉
  const icon = 'data:image/png;base64,' + 'A'.repeat(40000)
  const list = [{ name: '大图标服', ip: 'play.example.com', icon, hidden: false }]
  const back = parseServers(buildServers(list))
  assert.deepEqual(back, list)
})

test('servers.dat 普通条目往返一致', () => {
  const list = [
    { name: '服A', ip: 'a.example.com', hidden: true },
    { name: 'b.example.com', ip: 'b.example.com' }
  ]
  const back = parseServers(buildServers(list))
  assert.equal(back.length, 2)
  assert.equal(back[0].name, '服A')
  assert.equal(back[0].hidden, true)
  assert.equal(back[1].name, 'b.example.com')
  assert.equal(back[1].hidden, false)
})

test('servers.dat 截断的缓冲区抛错而不是死循环', () => {
  const buf = buildServers([{ name: 'x', ip: 'y' }])
  assert.throws(() => parseServers(buf.subarray(0, buf.length - 3)))
})
