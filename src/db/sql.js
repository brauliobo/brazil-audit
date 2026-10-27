// Bind values are rendered as SQL literals only for inspection and console links.
export const literal = (value) =>
  value === null || value === undefined ? 'NULL'
  : Array.isArray(value) ? `array[${value.map(literal).join(',')}]`
  : typeof value === 'number' || typeof value === 'boolean' ? String(value)
  : `'${String(value).replaceAll("'", "''")}'`

export const inline = (sql, params = []) => sql.replace(/\$(\d+)/g, (_, i) => literal(params[i - 1]))
