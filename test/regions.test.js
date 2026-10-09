// npm test: the regions and the placement of text inside the shipped UF geometry (data/geo/uf.json). Needs no database and no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { UFS } from '../src/model.js'
import { REGIONS, REGION_IDS, regionTotals } from '../src/regions.js'
import { boundsOf, compose, layout, place, rings, textBox } from '../src/shapes.js'

const map = JSON.parse(readFileSync('data/geo/uf.json', 'utf8'))
const path = Object.fromEntries(map.items)
const marks = Object.fromEntries(map.items.map(([id]) => [id, [{ head: id.toUpperCase(), rows: ['Flávio 48,2%', 'Lula 46,1%'] }, { rows: ['48,2%'] }]]))
const inRegion = (name) => map.items.filter(([id]) => REGIONS[name].includes(id))
const sizeOf = (name, px = 520) => ((b) => ((b[2] - b[0]) * 12) / px)(boundsOf(inRegion(name).map(([, d]) => d)))

test('every UF, and only them, belongs to exactly one region', () => {
  const all = Object.values(REGIONS).flat().sort()
  assert.deepEqual(all, UFS.filter((u) => u !== 'zz'))
  assert.equal(new Set(all).size, 26 + 1)
  assert.deepEqual(REGION_IDS.slice(0, 4), ['sudeste', 'nordeste', 'sul', 'norte'])
})

test('regional totals add the states of the region and rank by votes', () => {
  const rows = [
    { state: 'sp', key: '13', name: 'LULA', party: 'PT', votes: 60 }, { state: 'sp', key: '22', name: 'FLAVIO', party: 'PL', votes: 40 },
    { state: 'mg', key: '13', name: 'LULA', party: 'PT', votes: 10 }, { state: 'mg', key: '22', name: 'FLAVIO', party: 'PL', votes: 40 },
    { state: 'ba', key: '13', name: 'LULA', party: 'PT', votes: 90 },
  ]
  const { sudeste, nordeste, sul } = regionTotals(rows)
  assert.equal(sudeste.total, 150)
  assert.deepEqual(sudeste.rows.map((r) => [r.key, r.votes, r.share]), [['22', 80, 80 / 150], ['13', 70, 70 / 150]])
  assert.deepEqual(nordeste.rows.map((r) => [r.key, r.share]), [['13', 1]])
  assert.deepEqual(sul.rows, [])
})

test('paths are read into rings and Fernando de Noronha does not stretch Pernambuco', () => {
  assert.deepEqual(rings('M0 0h10v10l-10 0z'), [[[0, 0], [10, 0], [10, 10], [0, 10]]])
  assert.ok(rings(path.pe).length > 1)
  const [x0, , x1] = boundsOf([path.pe])
  assert.ok(x1 - x0 < 400, `Pernambuco is ${x1 - x0} wide`)
})

test('a box is placed inside a shape that holds it, and not in one that does not', () => {
  const [w, h] = textBox(['SP', 'Flávio 51,9%', 'Lula 38,2%'], sizeOf('sudeste'))
  const at = place(path.sp, w, h)
  assert.ok(at, 'São Paulo holds three lines')
  assert.equal(place(path.df, w, h), null)
  assert.equal(place(path.se, w * 4, h), null)
})

test('regional layout: what fits is inside, the rest goes to a column beside the map without overlaps', () => {
  const size = sizeOf('centro-oeste')
  const { labels, right, bottom } = layout(inRegion('centro-oeste'), marks, { size, callouts: true })
  assert.deepEqual(labels.map((l) => l.id).sort(), ['df', 'go', 'ms', 'mt'])
  const df = labels.find((l) => l.id === 'df')
  assert.ok(df.out && df.from && df.lines.length === 3, 'the DF is too small: callout with its fullest text')
  assert.ok(labels.filter((l) => l.id !== 'df').every((l) => !l.out))
  assert.ok(right > df.x && bottom > df.y0)
  const noCallouts = layout(inRegion('centro-oeste'), marks, { size, callouts: false })
  assert.ok(!noCallouts.labels.some((l) => l.id === 'df') && noCallouts.right === 0)
})

test('callouts stack without overlapping, in the order of the map', () => {
  const size = sizeOf('nordeste') * 3 // large text: the east coast states need the column
  const { labels } = layout(inRegion('nordeste'), marks, { size, callouts: true })
  const column = labels.filter((l) => l.out).sort((a, b) => a.y0 - b.y0)
  assert.ok(column.length >= 3)
  column.slice(1).forEach((l, i) => assert.ok(l.y0 >= column[i].y0 + textBox(column[i].lines, size)[1], `${l.id} overlaps ${column[i].id}`))
})

test('a region is one shape: its states join across their shared borders and the text fits across them', () => {
  const sul = compose(REGIONS.sul.map((id) => path[id]))
  const [x0, y0, x1, y1] = boundsOf(REGIONS.sul.map((id) => path[id]))
  const size = 17
  const [w, h] = textBox(['Sul', 'Flávio 60,1%', 'Lula 31,3%'], size)
  const at = place(sul, w, h)
  assert.ok(at && at.x - w / 2 >= x0 && at.x + w / 2 <= x1 && at.y - h / 2 >= y0 && at.y + h / 2 <= y1)
  const sudeste = REGIONS.sudeste.map((id) => path[id])
  assert.ok(place(compose(sudeste), 300, 10), 'a line crossing SP and MG fits in the Southeast')
  assert.ok(sudeste.every((d) => !place(d, 300, 10)), 'but in none of its states alone')
})

test('whole-Brazil marks per region: one label per region, written inside it', () => {
  const regions = Object.fromEntries(REGION_IDS.map((id) => [id, [{ head: id, rows: ['Flávio 51,4%', 'Lula 39,7%'] }, { rows: ['51,4%'] }]]))
  const items = Object.entries(REGIONS).map(([id, ufs]) => [id, compose(ufs.map((u) => path[u]))])
  const { labels } = layout(items, regions, { size: 17, callouts: false })
  assert.deepEqual(labels.map((l) => l.id).sort(), [...REGION_IDS].sort())
  assert.ok(labels.every((l) => !l.out))
})
