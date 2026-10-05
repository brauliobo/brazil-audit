// Minimal CSV line parser (quoted fields, doubled quotes) for the data scripts.
export function parseCsvLine(line) {
  const out = []
  for (let i = 0; i <= line.length; i++) {
    if (line[i] === '"') {
      let v = ''
      for (i++; i < line.length; i++) {
        if (line[i] === '"' && line[i + 1] === '"') { v += '"'; i++ } else if (line[i] === '"') break
        else v += line[i]
      }
      out.push(v); i++
    } else {
      const end = line.indexOf(',', i)
      out.push(line.slice(i, end < 0 ? line.length : end)); i = end < 0 ? line.length : end
    }
  }
  return out
}
