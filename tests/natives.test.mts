import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nativeMatchesArch } from '../src/main/core/install'

test('nativeMatchesArch 64 位只认不带后缀的 natives 包', () => {
  assert.equal(nativeMatchesArch('org.lwjgl:lwjgl-glfw:3.3.1:natives-windows', 'x86_64'), true)
  assert.equal(nativeMatchesArch('org.lwjgl:lwjgl-glfw:3.3.1:natives-windows-x86', 'x86_64'), false)
  assert.equal(nativeMatchesArch('org.lwjgl:lwjgl-glfw:3.3.1:natives-windows-arm64', 'x86_64'), false)
})

test('nativeMatchesArch 32 位只认 -x86 那一份', () => {
  assert.equal(nativeMatchesArch('org.lwjgl:lwjgl-glfw:3.3.1:natives-windows-x86', 'x86'), true)
  assert.equal(nativeMatchesArch('org.lwjgl:lwjgl-glfw:3.3.1:natives-windows', 'x86'), false)
  assert.equal(nativeMatchesArch('org.lwjgl:lwjgl-glfw:3.3.1:natives-windows-arm64', 'x86'), false)
})

test('nativeMatchesArch arm64 只认 -arm64 那一份', () => {
  assert.equal(nativeMatchesArch('org.lwjgl:lwjgl:3.3.1:natives-windows-arm64', 'arm64'), true)
  assert.equal(nativeMatchesArch('org.lwjgl:lwjgl:3.3.1:natives-windows', 'arm64'), false)
})

test('nativeMatchesArch 不是 natives 包的一律放行', () => {
  assert.equal(nativeMatchesArch('com.mojang:brigadier:1.0.18', 'x86'), true)
  assert.equal(nativeMatchesArch('org.lwjgl:lwjgl:3.3.1', 'x86'), true)
})