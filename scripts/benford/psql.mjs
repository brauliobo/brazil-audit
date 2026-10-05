// Thin psql wrapper: a script on stdin, ON_ERROR_STOP, no output noise. Source databases are only ever read.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { parseCsvLine } from '../csv.mjs'

const ENV = { ...process.env, PGOPTIONS: '-c statement_timeout=3600000 -c client_min_messages=error' }

/** Runs `script` in `db` and resolves with its stdout. */
export function psql(db, script) {
  const p = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db], { env: ENV })
  const [out, err] = [[], []]
  p.stdout.on('data', (c) => out.push(c))
  p.stderr.on('data', (c) => err.push(c))
  p.stdin.end(script)
  return new Promise((res, rej) => p.on('close', (code) => {
    const message = Buffer.concat(err).toString().split('\n').filter((l) => l && !/collation/.test(l)).join('\n')
    code ? rej(new Error(`psql ${db} exited ${code}: ${message}`)) : res(Buffer.concat(out).toString())
  }))
}

const oneLine = (sql) => sql.replace(/\s+/g, ' ').trim()

/** Query rows as arrays of strings (CSV through \copy, so quoting is handled by `parseCsvLine`). */
export async function rows(db, sql) {
  const text = await psql(db, `\\copy (${oneLine(sql)}) to stdout csv\n`)
  return text.split('\n').filter(Boolean).map(parseCsvLine)
}

/** `\copy` statements writing each query to its file, in one repeatable-read transaction (one consistent snapshot). */
export const snapshotDump = (db, dumps) => psql(db, [
  'begin isolation level repeatable read read only;',
  ...dumps.map(([sql, file]) => `\\copy (${oneLine(sql)}) to '${file}' csv`),
  'commit;',
].join('\n') + '\n')

/** Streams the CSV lines of a query to `onLine` without holding the result (the deputy facts are millions of rows). */
export async function stream(db, sql, onLine) {
  const p = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db], { env: ENV })
  const err = []
  p.stderr.on('data', (c) => err.push(c))
  p.stdin.end(`\\copy (${oneLine(sql)}) to stdout csv\n`)
  const closed = new Promise((res, rej) => p.on('close', (code) => (code ? rej(new Error(`psql ${db} exited ${code}: ${Buffer.concat(err)}`)) : res())))
  for await (const line of createInterface({ input: p.stdout })) onLine(line)
  await closed
}
