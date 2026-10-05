// Seats of one UF and one proportional office (federal, state or district deputy), step by step. Pure: no I/O, no framework.
// input = {
//   seats                          the number of seats (vagas)
//   lineup: [{ party, sigla, bloc, name, valid, legend }]   one per party list; `bloc` groups the parties of a federation or coalition
//   votes: [{ n, votes }]          nominal votes per candidate number (its first two digits are the party number)
//   annulled: [n]                  candidates whose votes the official result does not count
//   toLegend: [n]                  candidates whose registration was rejected after the election: their votes count for the list (Res. 23.677 art. 20 §2)
// }
// The result keeps every intermediate figure (quotients, standing of each bloc in each round) so the interface can show the whole count.
import { RULES } from './rules.js'

const sum = (list) => list.reduce((t, x) => t + x, 0)
const reaches = (votes, share, qe) => votes * 100 >= share * qe
const minVotes = (share, qe) => Math.ceil((share * qe) / 100)
const byVotes = (a, b) => b.votes - a.votes || (a.n < b.n ? -1 : 1) // the tie by age is not in the data: by number

/** Quociente eleitoral (CE art. 106): valid votes / seats, a fraction up to one half is dropped, above it counts as one. */
export const quotientOf = (votes, seats) => {
  const q = Math.floor(votes / seats)
  return 2 * (votes - q * seats) > seats ? q + 1 : q
}

const blocsOf = ({ lineup, votes, annulled, toLegend = [] }) => {
  const [parties, dead, moved, blocs] = [new Map(lineup.map((p) => [p.party, p])), new Set(annulled), new Set(toLegend), new Map()]
  for (const p of lineup) {
    const b = blocs.get(p.bloc) ?? blocs.set(p.bloc, { bloc: p.bloc, name: p.name, parties: [], candidates: [], annulled: [], moved: [] }).get(p.bloc)
    b.parties.push({ party: p.party, sigla: p.sigla, valid: p.valid, typed: p.legend, legend: p.valid ? p.legend : 0 })
  }
  const unmatched = []
  for (const v of votes) {
    const p = parties.get(v.n.slice(0, 2))
    if (!p) unmatched.push(v)
    else blocs.get(p.bloc)[!p.valid || dead.has(v.n) ? 'annulled' : moved.has(v.n) ? 'moved' : 'candidates'].push({ ...v })
  }
  for (const b of blocs.values()) {
    b.candidates.sort(byVotes)
    b.nominal = sum(b.candidates.map((c) => c.votes))
    b.legend = sum(b.parties.map((p) => p.legend)) + sum(b.moved.map((c) => c.votes))
    b.votes = b.nominal + b.legend
  }
  return { blocs: [...blocs.values()], unmatched }
}

const elect = (b, c, seat) => (c.seat = seat, b.elected.push(c))
const open = (b) => b.candidates.find((c) => !c.seat)

// Quociente partidário (art. 107) and the seats it fills: the best-voted candidates with at least the individual minimum (art. 108)
function byQuotient(b, qe, rule) {
  Object.assign(b, { qp: Math.floor(b.votes / qe), elected: [], extra: 0 })
  const fit = b.candidates.filter((c) => reaches(c.votes, rule.candidate, qe))
  fit.slice(0, b.qp).forEach((c) => elect(b, c, { kind: 'qp' }))
  b.released = b.qp - b.elected.length
}

// A bloc's standing for the next sobra: the average (art. 109 I) counts every seat it holds, even one released by the minimum vote
function standing(b, phase, qe) {
  const [held, next] = [b.qp + b.extra, open(b)]
  const reason = !reaches(b.votes, phase.party, qe) ? 'party' : !next ? 'none' : !reaches(next.votes, phase.candidate, qe) ? 'candidate' : null
  return { bloc: b.bloc, votes: b.votes, held, average: b.votes / (held + 1), candidate: next?.n ?? null, nextVotes: next?.votes ?? 0, eligible: !reason, reason }
}

// higher average (compared exactly by cross-multiplication), then more votes of the list, then more votes of the candidate (Res. 23.677 art. 11 §6-7)
const better = (a, b) => a.votes * (b.held + 1) - b.votes * (a.held + 1) || a.votes - b.votes || a.nextVotes - b.nextVotes
const tied = (a, b) => a.votes * (b.held + 1) === b.votes * (a.held + 1)

function round(blocs, phase, qe, index, rounds) {
  const rows = blocs.map((b) => standing(b, phase, qe))
  const eligible = rows.filter((r) => r.eligible).sort((a, b) => better(b, a))
  if (!eligible.length) return false
  const [win, next] = eligible
  const bloc = blocs.find((b) => b.bloc === win.bloc)
  bloc.extra++
  elect(bloc, open(bloc), { kind: 'avg', round: index, phase: phase.index })
  rounds.push({ round: index, phase: phase.index, winner: win.bloc, candidate: win.candidate, tie: !!next && tied(win, next), rows: rows.sort((a, b) => b.average - a.average) })
  return true
}

function bySobras(blocs, rule, qe, left) {
  const rounds = []
  for (const [index, phase] of rule.phases.entries()) {
    let more = true
    while (more && rounds.length < left) more = round(blocs, { ...phase, index }, qe, rounds.length + 1, rounds)
  }
  return rounds
}

// Art. 111 (before the STF decision): no list reached the QE, so the most voted candidates of all lists take the seats
function byTop(blocs, seats) {
  const all = blocs.flatMap((b) => b.candidates.map((c) => ({ b, c }))).sort((x, y) => byVotes(x.c, y.c))
  all.slice(0, seats).forEach(({ b, c }) => elect(b, c, { kind: 'top' }))
}

// Who comes next in each bloc (the suplentes, CE art. 112: no minimum vote) and by how many votes the list's last elected leads
function alternates(b) {
  const rest = b.candidates.filter((c) => !c.seat)
  rest.forEach((c, i) => (c.alternate = i + 1))
  const last = b.elected.at(-1)
  b.next = rest[0] && { n: rest[0].n, votes: rest[0].votes, behind: last ? last.votes - rest[0].votes : null }
}

// The closest decision of the sobras: the last seat and the votes the best list left without it would have needed (also for projections)
function lastSeat(rounds) {
  const last = rounds.at(-1)
  const [win, ...others] = last?.rows.filter((r) => r.eligible || r.bloc === last.winner).sort((a, b) => (a.bloc === last.winner ? -1 : b.bloc === last.winner ? 1 : b.average - a.average)) ?? []
  const next = others[0]
  return next && { winner: win.bloc, runnerUp: next.bloc, votesBehind: Math.floor((win.votes * (next.held + 1)) / (win.held + 1)) + 1 - next.votes }
}

/** The seats of one UF/office under `rule` (an entry of RULES, or its id): { seats, validVotes, quotient, blocs, rounds, vacant, ... }. */
export function calculate(input, rule = RULES.stf2024) {
  if (typeof rule === 'string') rule = RULES[rule]
  const { blocs, unmatched } = blocsOf(input)
  const validVotes = sum(blocs.map((b) => b.votes))
  const qe = quotientOf(validVotes, input.seats)
  blocs.forEach((b) => byQuotient(b, qe, rule))
  const noQuotient = !blocs.some((b) => b.qp)
  const left = input.seats - sum(blocs.map((b) => b.elected.length))
  const top = noQuotient && rule.noQuotient === 'top'
  if (top) byTop(blocs, input.seats)
  const rounds = top ? [] : bySobras(blocs, rule, qe, left)
  blocs.forEach(alternates)
  blocs.sort((a, b) => b.elected.length - a.elected.length || b.votes - a.votes)
  const elected = blocs.flatMap((b) => b.elected.map((c) => ({ ...c, bloc: b.bloc })))
  return {
    rule: rule.id, seats: input.seats, validVotes, noQuotient: top, unmatched: sum(unmatched.map((v) => v.votes)),
    quotient: { exact: validVotes / input.seats, value: qe, candidateMin: minVotes(rule.candidate, qe), partyMin: minVotes(rule.phases[0].party, qe) },
    blocs, rounds, elected, vacant: input.seats - elected.length, lastSeat: lastSeat(rounds),
  }
}

/** Official elected candidate numbers against the calculation: { agree, onlyCalculated, onlyOfficial }. */
export function compare(result, official) {
  const [calc, real] = [new Set(result.elected.map((c) => c.n)), new Set(official)]
  const [onlyCalculated, onlyOfficial] = [[...calc].filter((n) => !real.has(n)), [...real].filter((n) => !calc.has(n))]
  return { agree: [...calc].filter((n) => real.has(n)).length, onlyCalculated, onlyOfficial, equal: !onlyCalculated.length && !onlyOfficial.length }
}
