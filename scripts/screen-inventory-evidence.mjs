export const GENERATED_COLUMNS = new Set([
  "Exact source route",
  "Potential grouped source routes",
  "Explicit grouped screen mapping",
  "Direct page imports",
  "Candidate API routes by module",
  "Schema symbols in candidate APIs",
  "Permission checks found in candidate APIs",
  "Related test files",
]);

export const ACCEPTANCE_COLUMNS = [
  "Acceptance status",
  "Manual desktop/mobile status",
  "Accessibility/responsive status",
  "Final Owner/QA acceptance",
  "Deployment readiness",
];

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error("inventory_csv_unclosed_quote");
  if (cell !== "" || row.length) { row.push(cell); if (row.some((value) => value !== "")) rows.push(row); }
  if (!rows.length) throw new Error("inventory_csv_empty");
  const headers = rows.shift();
  headers[0] = headers[0].replace(/^\uFEFF/, "");
  if (new Set(headers).size !== headers.length) throw new Error("inventory_csv_duplicate_headers");
  return { headers, rows: rows.map((values) => {
    if (values.length !== headers.length) throw new Error(`inventory_csv_column_count:${values.length}:${headers.length}`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  }) };
}

export function serializeCsv(headers, rows) {
  const value = (item) => `"${String(item ?? "").replaceAll('"', '""')}"`;
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((cells) => cells.map(value).join(",")).join("\n")}\n`;
}

export function assertUniqueIds(rows, label = "inventory") {
  const ids = rows.map((row) => row.ID);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length) throw new Error(`${label}_duplicate_ids:${duplicates.join(",")}`);
  if (ids.some((id) => !/^[A-Z]\d{3}$/.test(id ?? ""))) throw new Error(`${label}_invalid_id`);
}

export function mergeGeneratedMatrix({ generated, existing, expectedIds }) {
  assertUniqueIds(generated, "generated_matrix");
  assertUniqueIds(existing, "existing_matrix");
  const expected = new Set(expectedIds);
  const generatedIds = new Set(generated.map((row) => row.ID));
  const existingIds = new Set(existing.map((row) => row.ID));
  const missing = [...expected].filter((id) => !generatedIds.has(id));
  const extra = [...generatedIds].filter((id) => !expected.has(id));
  if (missing.length || extra.length || generatedIds.size !== expected.size) {
    throw new Error(`canonical_inventory_id_conflict:missing=${missing.join("|")};extra=${extra.join("|")}`);
  }
  const missingExisting = [...expected].filter((id) => !existingIds.has(id));
  const extraExisting = [...existingIds].filter((id) => !expected.has(id));
  if (missingExisting.length || extraExisting.length) {
    throw new Error(`existing_matrix_screen_set_conflict:missing=${missingExisting.join("|")};extra=${extraExisting.join("|")}`);
  }
  const existingById = new Map(existing.map((row) => [row.ID, row]));
  const generatedHeaders = Object.keys(generated[0] ?? {});
  const existingHeaders = Object.keys(existing[0] ?? {});
  if (existingHeaders.length && (existingHeaders.length !== generatedHeaders.length || existingHeaders.some((column) => !generatedHeaders.includes(column)))) {
    throw new Error("inventory_matrix_header_conflict");
  }
  const headers = generatedHeaders;
  for (const column of ACCEPTANCE_COLUMNS) {
    if (!headers.includes(column)) throw new Error(`acceptance_column_missing:${column}`);
  }
  return {
    headers,
    rows: generated.map((fresh) => {
      const prior = existingById.get(fresh.ID);
      if (!prior) return { ...fresh };
      for (const column of headers.slice(0, 7)) {
        if (prior[column] !== undefined && prior[column] !== fresh[column]) {
          throw new Error(`canonical_definition_conflict:${fresh.ID}:${column}`);
        }
      }
      const merged = { ...fresh };
      for (const column of existingHeaders) {
        if (column === "ID" || GENERATED_COLUMNS.has(column)) continue;
        if (headers.includes(column)) merged[column] = prior[column];
      }
      return merged;
    }),
  };
}

export function acceptanceSnapshot(rows) {
  return Object.fromEntries(rows.map((row) => [row.ID,
    Object.fromEntries(ACCEPTANCE_COLUMNS.map((column) => [column, row[column] ?? ""])),
  ]));
}

export function checkAcceptanceBaseline({ rows, baseline, acceptChanges = false, reviewReference = "" }) {
  const current = acceptanceSnapshot(rows);
  if (!baseline) return { baseline: current, changed: [], initialized: true };
  const changes = [];
  const priorIds = Object.keys(baseline.entries ?? {});
  if (priorIds.length !== rows.length || rows.some((row) => !baseline.entries?.[row.ID])) {
    throw new Error("acceptance_baseline_screen_set_conflict");
  }
  for (const row of rows) for (const column of ACCEPTANCE_COLUMNS) {
    const before = baseline.entries[row.ID][column] ?? "";
    const after = current[row.ID][column] ?? "";
    if (before !== after) changes.push({ id: row.ID, column, before, after });
  }
  if (changes.length && (!acceptChanges || !reviewReference.trim())) {
    const summary = changes.map(({ id, column }) => `${id}:${column}`).join(",");
    throw new Error(`manual_acceptance_change_requires_review:${summary}`);
  }
  return { baseline: changes.length ? current : baseline.entries, changed: changes, initialized: false };
}
