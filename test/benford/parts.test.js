import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { writeParts } from '../../scripts/benford/parts.mjs'

test('rebuilding an election removes only its own parts, preserving its runoff', () => {
  const root = mkdtempSync(join(tmpdir(), 'benford-parts-'))
  try {
    const dir = join(root, 'benford_hist')
    mkdirSync(dir)
    writeFileSync(join(dir, '2026-br.csv.gz'), 'old first round')
    writeFileSync(join(dir, '2026-2-br.csv.gz'), 'runoff')
    writeParts(root, { key: '2026', year: 2026, turn: 1 }, 'benford_hist', [])
    assert.equal(existsSync(join(dir, '2026-br.csv.gz')), false)
    assert.equal(readFileSync(join(dir, '2026-2-br.csv.gz'), 'utf8'), 'runoff')
  } finally {
    rmSync(root, { recursive: true })
  }
})

test('part sizes count UTF-8 bytes of municipality names', () => {
  const root = mkdtempSync(join(tmpdir(), 'benford-bytes-'))
  try {
    const parts = writeParts(root, { key: '2026-2', year: 2026, turn: 2 }, 'benford_hist', [[2026, 2, 1, 'section', 'sp', 'SÃO PAULO', '13', 'd1', 1, 9]])
    const part = parts['2026-2/sp']
    assert.equal(part.rawBytes, gunzipSync(readFileSync(join(root, part.url))).length)
  } finally {
    rmSync(root, { recursive: true })
  }
})
