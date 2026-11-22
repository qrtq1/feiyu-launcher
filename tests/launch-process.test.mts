import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { launchGame } from '../src/main/core/launch'
import { P, setGameDir } from '../src/main/core/paths'
import { DEFAULT_SETTINGS } from '../src/shared/api'
import type { LogLine } from '../src/shared/types'

test('launchGame rejects a failed spawn and still handles a subsequent child exit', { timeout: 5000 }, async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.launch-test-'))
  setGameDir(dir)
  t.after(async () => {
    setGameDir(null)
    await rm(dir, { recursive: true, force: true })
  })

  const versionId = 'fixture'
  await mkdir(P.versionDir(versionId), { recursive: true })
  await writeFile(P.versionJson(versionId), JSON.stringify({ id: versionId, mainClass: 'Example', libraries: [] }))

  const logs: LogLine[] = []
  const options = {
    versionId,
    account: { id: 'offline', type: 'offline' as const, name: 'Tester', uuid: '00000000000000000000000000000000' },
    settings: { ...DEFAULT_SETTINGS, gameDir: dir },
    java: { path: join(dir, 'missing-java.exe'), version: '17', major: 17, source: 'custom' as const },
    onLog: (line: LogLine) => logs.push(line)
  }

  let failedSpawnExits = 0
  await assert.rejects(
    launchGame({ ...options, onExit: () => { failedSpawnExits++ } }),
    { code: 'ENOENT' }
  )
  assert.ok(logs.some((line) => line.stream === 'stderr' && line.line.includes('ENOENT')))
  assert.equal(logs.some((line) => line.stream === 'launcher'), false)

  type Exit = { code: number | null; signal: string | null }
  let recordExit!: (value: Exit) => void
  const exited = new Promise<Exit>((resolve) => { recordExit = resolve })
  // Node starts successfully but exits promptly because the command contains JVM arguments.
  const handle = await launchGame({
    ...options,
    java: { ...options.java, path: process.execPath },
    onExit: (code, signal) => recordExit({ code, signal })
  })
  assert.ok(handle.child.pid)
  const { code, signal } = await exited
  assert.equal(typeof code, 'number')
  assert.notEqual(code, 0)
  assert.equal(signal, null)
  assert.equal(failedSpawnExits, 0)
})
