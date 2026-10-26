// Official presidential turnout, keeping national/state/city/zone grains distinct.
import { cached } from './geo.mjs'

export const TURNOUT_FIELDS = ['scope','state','city','code','zone','electorate','installed','not_installed','totalized','uncounted','present','absent','sections','counted','generated','url']
export const TURNOUT_SCHEMA = 'scope text, state text, city text, code text, zone text, electorate bigint, installed bigint, not_installed bigint, totalized bigint, uncounted bigint, present bigint, absent bigint, sections int, counted int, generated text, url text'
const fields = ['electorate','installed','not_installed','totalized','uncounted','present','absent','sections','counted']
const key = (r) => [r.scope,r.state,r.code,r.zone].join('|')

export function turnoutTargets(config) {
  return [{ scope: 'br', state: 'br', city: '', code: '', zone: '' }, ...config.abr.flatMap((s) => [
    { scope: 'uf', state: s.cd, city: '', code: '', zone: '' },
    ...s.mu.flatMap((m) => [
      { scope: 'city', state: s.cd, city: m.nm, code: m.cd, zone: '' },
      ...m.z.map((z) => ({ scope: 'zone', state: s.cd, city: m.nm, code: m.cd, zone: z })),
    ]),
  ])]
}

export function turnoutUrl(el, target) {
  const event = el.official.events[1]
  const name = `${target.state}${target.code}${target.zone ? `-z${target.zone}` : ''}-c0001-e${String(event).padStart(6,'0')}-u.json`
  return `https://resultados.tse.jus.br/oficial/ele${el.year}/${event}/dados/${target.state}/${name}`
}

export function turnoutRow(el, target, source) {
  if (+source.ele !== el.official.events[1] || +source.t !== el.turn) throw new Error(`wrong election: ${key(target)}`)
  const values = [source.e.te,source.e.esi,source.e.esni,source.e.est,source.e.esnt,source.e.c,source.e.a,source.s.ts,source.s.st].map(Number)
  const row = { ...target, ...Object.fromEntries(fields.map((f,i) => [f,values[i]])), generated: `${source.dg} ${source.hg}`, url: turnoutUrl(el,target) }
  if (values.some((v) => !Number.isSafeInteger(v) || v < 0) || row.present + row.absent !== row.installed || row.installed + row.not_installed !== row.electorate || row.totalized + row.uncounted !== row.electorate) throw new Error(`invalid electorate: ${key(target)}`)
  if (row.counted !== row.sections) throw new Error(`not totalized: ${key(target)}`)
  return row
}

// Aggregate each level independently: adding all scopes would count the same electorate four times.
export function validateTurnout(rows) {
  const errors = []
  const groups = new Map()
  for (const r of rows) {
    const parent = r.scope === 'uf' ? 'br|br||' : r.scope === 'city' ? `uf|${r.state}||` : r.scope === 'zone' ? `city|${r.state}|${r.code}|` : null
    if (!parent) continue
    const total = groups.get(parent) ?? Object.fromEntries(fields.map((f) => [f,0]))
    fields.forEach((f) => { total[f] += r[f] })
    groups.set(parent,total)
  }
  for (const r of rows) {
    const total = groups.get(key(r))
    if (!total) continue
    for (const f of fields) if (total[f] !== r[f]) errors.push(`${r.scope} ${key(r)} ${f}: children ${total[f]} != ${r[f]} (${r.scope === 'city' ? 'zone' : 'child'} totals)`)
  }
  return errors
}

export async function buildOfficialTurnout(el, { smallTable, log }) {
  const event = el.official.events[1]
  const config = JSON.parse(await cached(`turnout-${el.key}-municipalities.json`, `https://resultados.tse.jus.br/oficial/ele${el.year}/${event}/config/mun-e${String(event).padStart(6,'0')}-cm.json`, { maxAgeHours: 12 }))
  const targets = turnoutTargets(config)
  const rows = Array(targets.length)
  let next = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < targets.length) {
      const i = next++
      const target = targets[i]
      const name = `turnout-${el.key}-${target.state}${target.code}${target.zone ? `-z${target.zone}` : ''}.json`
      rows[i] = turnoutRow(el,target,JSON.parse(await cached(name,turnoutUrl(el,target), { maxAgeHours: 12 })))
      if ((i + 1) % 500 === 0) log(`official turnout: ${i + 1}/${targets.length}`)
    }
  }))
  const errors = validateTurnout(rows)
  if (errors.length) throw new Error(`official turnout totals disagree:\n${errors.join('\n')}`)
  smallTable('turnout',el,rows.map((r) => TURNOUT_FIELDS.map((f) => r[f])))
  log(`official turnout: ${rows.length} scopes, all hierarchical totals match`)
}
