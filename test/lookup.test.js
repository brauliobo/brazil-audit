// npm test: how the search box reads what is typed. Needs no database and no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLookup } from '../src/lookup.js'

const at = (uf, city, zone, section) => ({ uf, city, zone, section })

test('reads the way the section is usually written down', () => {
  assert.deepEqual(parseLookup('SP Zona 127 Seção 680'), at('sp', '', '0127', '0680'))
  assert.deepEqual(parseLookup('sp / são paulo / 127 / 680'), at('sp', 'são paulo', '0127', '0680'))
  assert.deepEqual(parseLookup('seção 680 zona 127 sp'), at('sp', '', '0127', '0680'))
  assert.deepEqual(parseLookup('127 680'), at('', '', '0127', '0680'))
})

test('a municipality alone, with its hyphens and its UF anywhere', () => {
  assert.deepEqual(parseLookup('embu-guaçu sp'), at('sp', 'embu-guaçu', '', ''))
  assert.deepEqual(parseLookup('município Rio Branco, AC'), at('ac', 'rio branco', '', ''))
  assert.deepEqual(parseLookup('  '), at('', '', '', ''))
})

test('only a zone or only a section keeps its label', () => {
  assert.deepEqual(parseLookup('ac zona 3'), at('ac', '', '0003', ''))
  assert.deepEqual(parseLookup('ac seção 12'), at('ac', '', '', '0012'))
})
