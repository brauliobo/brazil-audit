// Recomputes every deputy election of the dump (each UF and office) and compares it with the official result:
//   the elected candidates, the valid votes (official party results) and, for 2026, the quociente eleitoral of the TSE state files.
//   node scripts/verify-seats.mjs [--election=2018,2022,2026] [--rule=<id>] [--no-residual]
// Prints one row per election and office, then every UF/office that differs. Exit code 0 always: a mismatch is a finding, not a failure.
import { ELECTIONS } from '../src/elections.js'
import { RULES } from '../src/seats/rules.js'
import { calculate, compare } from '../src/seats/calc.js'
import { cached } from './geo.mjs'
import { loadElection } from './seats-input.mjs'

const opt = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const keys = opt.election ? opt.election.split(',') : Object.keys(ELECTIONS).filter((k) => ELECTIONS[k].seatRule)

// the quociente eleitoral the TSE publishes in its 2026 state files (cached by build-data.mjs, downloaded otherwise)
async function officialQuotient(uf, office) {
  const url = `https://resultados.tse.jus.br/oficial/ele2026/6259/dados/${uf}/${uf}-c${String(office).padStart(4, '0')}-e006259-u.jws`
  return +JSON.parse(Buffer.from((await cached(`tse-${uf}-${office}.jws`, url)).trim().split('.')[1], 'base64url').toString()).carg[0].qe
}

async function verify(key) {
  const rule = RULES[opt.rule ?? ELECTIONS[key].seatRule]
  const { inputs, official } = loadElection(key, { residual: opt['no-residual'] == null })
  const rows = []
  for (const [at, input] of [...inputs].sort(([a], [b]) => a.localeCompare(b))) {
    const result = calculate(input, rule)
    const [uf, office] = at.split('/')
    const quotient = ELECTIONS[key].source.kind === 'rdv' ? await officialQuotient(uf, +office) : null
    rows.push({ key, at, rule: rule.id, seats: input.seats, result, quotientOk: quotient == null ? null : quotient === result.quotient.value, votesGap: result.validVotes - input.officialVotes, ...compare(result, (official.get(at) ?? []).map((c) => c.n)) })
  }
  return rows
}

const rows = (await Promise.all(keys.map(verify))).flat()
const count = (list, test) => list.filter(test).length
const table = keys.flatMap((key) => [6, 7, 8].map((office) => {
  const list = rows.filter((r) => r.key === key && r.at.endsWith(`/${office}`))
  return {
    election: key, office, rule: list[0]?.rule, 'UF/offices': list.length, 'same elected': count(list, (r) => r.equal), different: count(list, (r) => !r.equal),
    seats: list.reduce((t, r) => t + r.seats, 0), 'seats differing': list.reduce((t, r) => t + r.onlyOfficial.length, 0),
    'valid votes = official': count(list, (r) => r.votesGap === 0), 'QE = official': list[0]?.quotientOk == null ? 'n/a' : count(list, (r) => r.quotientOk),
  }
}))
console.table(table)
for (const r of rows.filter((x) => !x.equal || x.votesGap || x.quotientOk === false)) {
  console.log(`${r.key} ${r.at}: QE ${r.result.quotient.value} (official ok: ${r.quotientOk}) valid votes ${r.result.validVotes} (${r.votesGap >= 0 ? '+' : ''}${r.votesGap} vs official) | calculated only ${r.onlyCalculated.join(' ') || '-'} | official only ${r.onlyOfficial.join(' ') || '-'}`)
}
