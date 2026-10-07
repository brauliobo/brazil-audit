// Shared by the browser checks (check-responsive, check-usability): a thin driver of agent-browser sessions.
import { execFileSync } from 'node:child_process'

export const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
export const baseUrl = () => process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4190/brazil-audit'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function browser(session) {
  const ab = (...args) => execFileSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8' }).trim().split('\n').at(-1)
  const evaluate = (js) => JSON.parse(JSON.parse(ab('eval', js)))
  return { ab, evaluate }
}

// a view is ready when it has content, no skeleton and no panel still counting (badge '…')
export const READY = `(() => JSON.stringify(document.querySelectorAll('.panel, h1').length > 0 && !document.querySelector('.skeleton') && ![...document.querySelectorAll('.panel__badge')].some((m) => m.innerText === '…')))()`
