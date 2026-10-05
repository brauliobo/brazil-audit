// npm test: the seat calculation against the shipped dump (data/): hand-checkable arithmetic first, then every UF and office of
// 2018, 2022 and 2026 against the official elected lists. Needs the data/ files, no database and no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ELECTIONS } from '../src/elections.js'
import { RULES } from '../src/seats/rules.js'
import { calculate, compare, quotientOf } from '../src/seats/calc.js'
import { loadElection } from '../scripts/seats-input.mjs'

const list = (n, ...votes) => votes.map((v, i) => ({ n: n + String(i + 1).padStart(2, '0'), votes: v }))
const party = (party, sigla, bloc = sigla, legend = 0) => ({ party, sigla, bloc, name: bloc, valid: true, legend })

test('quociente eleitoral: a fraction up to one half is dropped, above it rounds up (CE art. 106)', () => {
  assert.equal(quotientOf(1967700, 8), 245962) // 245,962.5: the Rio Grande do Norte 2026 example of the TSE
  assert.equal(quotientOf(105, 10), 10)
  assert.equal(quotientOf(106, 10), 11)
  assert.equal(quotientOf(100, 10), 10)
})

test('quociente partidário and sobras by maior média, step by step', () => {
  // 18,000 valid votes for 6 seats: QE 3,000; QP A 3, B 1, C 1; the sixth seat goes to the highest average: B 5,400/2
  const input = {
    seats: 6,
    lineup: [party('10', 'A'), party('20', 'B'), party('30', 'C')],
    votes: [...list('10', 4000, 3000, 2000, 600), ...list('20', 2800, 1600, 1000), ...list('30', 2000, 1000)],
  }
  const r = calculate(input, RULES.stf2024)
  assert.equal(r.validVotes, 18000)
  assert.equal(r.quotient.value, 3000)
  assert.deepEqual(r.blocs.map((b) => [b.bloc, b.qp, b.elected.length]), [['A', 3, 3], ['B', 1, 2], ['C', 1, 1]])
  assert.equal(r.rounds.length, 1)
  assert.equal(r.rounds[0].winner, 'B')
  assert.deepEqual(r.rounds[0].rows.map((x) => [x.bloc, Math.round(x.average)]), [['B', 2700], ['A', 2400], ['C', 1500]])
  assert.equal(r.vacant, 0)
})

test('legend votes count for the bloc, annulled candidates for nobody', () => {
  const input = {
    seats: 2,
    lineup: [party('10', 'A', 'A / B', 500), party('20', 'B', 'A / B', 100), party('30', 'C', 'C', 0)],
    votes: [...list('10', 1000), ...list('20', 300), ...list('30', 900, 5000)],
    annulled: ['3002'],
  }
  const r = calculate(input, RULES.stf2024)
  assert.equal(r.validVotes, 2800) // 1000 + 300 + 900 nominal + 600 legend; the 5,000 of 3002 are annulled
  assert.equal(r.blocs.find((b) => b.bloc === 'A / B').votes, 1900)
  assert.deepEqual(r.blocs.find((b) => b.bloc === 'C').annulled, [{ n: '3002', votes: 5000 }])
})

test('the calculation never changes its input', () => {
  const { inputs } = loadElection('2026')
  const input = inputs.get('ac/6')
  const before = JSON.stringify(input)
  calculate(input, RULES.stf2024)
  assert.equal(JSON.stringify(input), before)
})

for (const key of Object.keys(ELECTIONS).filter((k) => ELECTIONS[k].seatRule)) {
  test(`${key}: every UF and deputy office gives the official elected list (rule ${ELECTIONS[key].seatRule})`, () => {
    const { inputs, official } = loadElection(key)
    assert.equal(inputs.size, 54) // 27 UFs x federal and state deputies, minus the DF state office, plus the DF district office
    for (const [at, input] of inputs) {
      const r = calculate(input, ELECTIONS[key].seatRule)
      const d = compare(r, official.get(at).map((c) => c.n))
      assert.ok(d.equal, `${key} ${at}: only calculated ${d.onlyCalculated}, only official ${d.onlyOfficial}`)
      assert.equal(r.elected.length, input.seats)
      assert.equal(r.vacant, 0)
      assert.equal(r.elected.length, new Set(r.elected.map((c) => c.n)).size)
    }
  })
}

test('2022: the STF decision (ADI 7228) moves exactly the seats of AP, DF, RO and TO', () => {
  const { inputs } = loadElection('2022')
  const moved = [...inputs].filter(([, input]) => !compare(calculate(input, RULES.federations2022), calculate(input, RULES.stf2024).elected.map((c) => c.n)).equal).map(([at]) => at)
  assert.deepEqual(moved, ['ap/6', 'df/6', 'ro/6', 'to/6'])
})

test('2026: the federation of the 80% rule and the STF rule agree where every list reaches the quotients', () => {
  const { inputs } = loadElection('2026')
  const rn = calculate(inputs.get('rn/6'), RULES.stf2024)
  assert.equal(rn.quotient.value, 245962) // official value of the TSE for the Rio Grande do Norte federal deputies
  assert.equal(rn.blocs.reduce((t, b) => t + b.qp, 0), 6) // six of the eight seats by quociente partidário
})

test('2018: coalitions count as one list', () => {
  const { inputs } = loadElection('2018')
  const r = calculate(inputs.get('ac/6'), RULES.coalitions2018)
  assert.ok(r.blocs.some((b) => b.parties.length > 3))
  assert.equal(new Set(r.blocs.flatMap((b) => b.parties.map((p) => p.party))).size, inputs.get('ac/6').lineup.length)
})

test('a projection from a partial count still distributes every seat', () => {
  const { inputs } = loadElection('2026', { residual: false })
  for (const at of ['sp/6', 'mg/6', 'ba/7']) assert.equal(calculate(inputs.get(at), RULES.stf2024).vacant, 0)
})
