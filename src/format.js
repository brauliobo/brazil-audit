const nf = new Intl.NumberFormat('pt-BR')
export const int = (n) => (n == null ? '–' : nf.format(Math.round(n)))
export const num = (n, d = 2) => (n == null ? '–' : n.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }))
export const pct = (x, d = 2) => (x == null ? '–' : `${num(x * 100, d)}%`)
export const ms = (t) => (t < 10 ? `${t.toFixed(1)} ms` : t < 1000 ? `${Math.round(t)} ms` : `${(t / 1000).toFixed(2)} s`)
export const bytes = (n) => (n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`)
export const clock = (sec) => `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`
