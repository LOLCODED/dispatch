// A snapshot keeps every row of the task database's tables up to a row budget; larger tables keep only their row count.
export const rowLimit = 20_000, totalRowLimit = 100_000;

export const tablesSql = `select coalesce(json_agg(t order by t.name), '[]') from (
  select format('%I.%I', n.nspname, c.relname) as name,
    (select json_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns,
    coalesce((select json_agg(a.attname order by array_position(i.indkey::int2[], a.attnum)) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = c.oid and i.indisprimary), '[]') as key,
    (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as count
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and not c.relispartition and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_toast%' and n.nspname not like 'pg\\_temp%'
) t`;

const literal = text => `'${text.replaceAll("'", "''")}'`;

// Names come from format('%I.%I') above, so they are already quoted identifiers.
export function rowsSql(tables) {
  return `select coalesce(json_object_agg(name, rows), '{}') from (${tables.map(table => `select ${literal(table.name)} as name, (select coalesce(json_agg(t), '[]') from ${table.name} t) as rows`).join(' union all ')}) x`;
}

// The largest tables give up their rows first until the rest fit the budget.
export function keptTables(tables) {
  const kept = new Set(), small = tables.filter(table => table.count <= rowLimit).sort((a, b) => a.count - b.count);
  let total = 0;
  for (const table of small) { if (total + table.count > totalRowLimit) break; total += table.count; kept.add(table.name); }
  return kept;
}

export function databaseChanges(dispatch, run) {
  const json = async (sql, ctx, env) => {
    const output = await run(sql, ctx, env);
    try { return JSON.parse(output); } catch { throw new Error(`psql returned unreadable output: ${output.trim().slice(0, 300)}`); }
  };

  async function state({ env }, ctx) {
    const tables = await json(tablesSql, ctx, env), kept = keptTables(tables);
    const rows = kept.size ? await json(rowsSql(tables.filter(table => kept.has(table.name))), ctx, env) : {};
    return tables.map(table => kept.has(table.name)
      ? { name: table.name, columns: table.columns, key: table.key, rows: (rows[table.name] ?? []).map(row => table.columns.map(column => row[column] ?? null)) }
      : { name: table.name, count: Number(table.count) });
  }

  return {
    'database.snapshot': async (input, ctx) => ({ snapshot: { tables: await state(input, ctx) } }),
    'database.changes': async (input, ctx) => ({ tables: dispatch.tableChanges(input.snapshot?.tables ?? [], await state(input, ctx)) }),
  };
}
