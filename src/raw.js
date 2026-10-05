// Where the raw files behind a section's numbers live: per-section zips published as GitHub release assets. The release's INDEX.json
// (reduced by scripts/build-data.mjs to `[kind, name, first, last, files, bytes]` per asset, in data/raw/<election>.json) says which
// zip holds a section: the keys are `files/<uf>-<city>-<zone>-<section>` (aux: `ballots/...`) and an asset holds every key between
// its first and last, compared as plain strings. Pure functions: also used by scripts/check-raw.mjs.
import { REPO } from './elections.js'

const KINDS = ['rdv', 'logs', 'aux']
const GITHUB = `https://github.com/${REPO}`

export const sectionId = (uf, city, zone, section) => `${uf}-${city}-${zone}-${section}`
const keyOf = (kind, id) => (kind === 'aux' ? `ballots/${id}` : `files/${id}`)

/** The asset of each kind that holds the section, if any: { rdv, logs, aux } of { kind, name, files, bytes }. */
export function findAssets(raw, id) {
  const inside = ([, , first, last], key) => first.slice(0, key.length) <= key && key <= last.slice(0, key.length)
  return Object.fromEntries(KINDS.map((kind) => {
    const found = raw.assets.find((a) => a[0] === kind && inside(a, keyOf(kind, id)))
    return [kind, found && { kind, name: found[1], files: found[4], bytes: found[5] }]
  }))
}

export const releaseUrl = (raw) => `${GITHUB}/releases/tag/${raw.tag}`
export const assetUrl = (raw, asset) => `${GITHUB}/releases/download/${raw.tag}/${asset.name}`
/** Prints the section's file from the downloaded zip (the entry names carry a hash after the section, hence the glob). */
export const commandOf = (asset, id) => `unzip -p ${asset.name} '${keyOf(asset.kind, id)}${asset.kind === 'aux' ? '*' : '-*'}'`

/** The live TSE address of the section's aux.json, for the elections that configure it. */
export const tseAuxUrl = (el, { uf, city, zone, section }) => el.raw.tseAux?.replaceAll('{uf}', uf).replaceAll('{city}', city).replace('{zone}', zone).replace('{section}', section)

/** Links into the collector's branch: its code files and the coverage lists. */
export const branchUrl = (el) => `${GITHUB}/tree/${el.raw.branch}`
export const fileUrl = (el, path) => `${GITHUB}/blob/${el.raw.branch}/${path}`
