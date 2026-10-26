// Schema metadata always follows the generator, including when an existing table is rebuilt.
export function tableDefinition(name, schema, existing = {}) {
  const columns = schema.split(',').map((c) => c.trim().split(' ')[0]).join(',')
  return { ...existing, name, columns: `election,turn,${columns}`, ddl: `create table ${name} (election int, turn int, ${schema})`, parts: existing.parts ?? {} }
}
