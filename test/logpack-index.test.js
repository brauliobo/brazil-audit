import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

for (const key of ['2026', '2026-2']) {
  test(`logpack index preserves the state for election ${key}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'logpack-index-'))
    try {
      const packs = join(dir, 'packs')
      mkdirSync(packs)
      for (const ext of ['idx', 'pack']) copyFileSync(`test/fixtures/logpack/2026-logpack-rr-01.${ext}`, `${packs}/${key}-logpack-rr-01.${ext}`)
      execFileSync(process.execPath, [resolve('scripts/build-logpack-index.mjs'), key, packs], { cwd: dir })
      const { assets } = JSON.parse(readFileSync(`${dir}/data/logs/${key}.json`, 'utf8'))
      assert.equal(assets.length, 1)
      assert.match(assets[0][1], /^rr-\d{5}-\d{4}-\d{4}$/)
      assert.match(assets[0][2], /^rr-\d{5}-\d{4}-\d{4}$/)
      assert.equal(assets[0][3], 4)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
