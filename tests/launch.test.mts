import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redactArgs, splitArgs } from '../src/main/core/launch'

const HIDDEN = '<已隐藏>'

test('redactArgs 掩掉令牌类参数的值', () => {
  const out = redactArgs(['--username', 'Steve', '--uuid', 'abcd', '--accessToken', 'SECRET', '--version', '1.20.1'])
  assert.deepEqual(out, ['--username', 'Steve', '--uuid', HIDDEN, '--accessToken', HIDDEN, '--version', '1.20.1'])
})

test('redactArgs 支持 --flag=value 写法', () => {
  assert.deepEqual(redactArgs(['--accessToken=SECRET']), [`--accessToken=${HIDDEN}`])
})

test('redactArgs 不把紧跟其后的参数当成值吞掉', () => {
  assert.deepEqual(redactArgs(['--accessToken', '--fullscreen']), ['--accessToken', '--fullscreen'])
})

test('redactArgs 原样保留无关参数', () => {
  const args = ['-Xmx4096M', '-cp', 'a;b', 'net.minecraft.client.main.Main', '--gameDir', 'D:/x']
  assert.deepEqual(redactArgs(args), args)
})

test('redactArgs 覆盖 buildCommand 真实会产出的参数形状', () => {
  const out = redactArgs([
    '-XX:+UseG1GC',
    '--username',
    'Steve',
    '--version',
    '1.20.1',
    '--gameDir',
    'C:/g',
    '--uuid',
    'c06f880b1f0b3d1b9d470b98b8b4b1e5',
    '--accessToken',
    'eyJhbGciOi',
    '--clientId',
    '',
    '--xuid',
    '',
    '--userType',
    'msa'
  ])
  assert.equal(out.includes('eyJhbGciOi'), false)
  assert.equal(out.includes('c06f880b1f0b3d1b9d470b98b8b4b1e5'), false)
  assert.equal(out.includes('Steve'), true, '玩家名不是凭据，应当保留')
})

test('splitArgs 支持引号内含空格', () => {
  assert.deepEqual(splitArgs('--a "b c" -d'), ['--a', 'b c', '-d'])
})

test('splitArgs 空白串返回空数组', () => {
  assert.deepEqual(splitArgs('   '), [])
  assert.deepEqual(splitArgs(''), [])
})
