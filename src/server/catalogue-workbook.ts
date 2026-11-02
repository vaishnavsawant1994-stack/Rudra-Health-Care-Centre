import ExcelJS from "exceljs";

function escapeCsvCell(value: string) { return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value; }

export async function workbookToCatalogueCsv(buffer: ArrayBuffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  if (workbook.worksheets.length !== 1) throw new Error("Use a workbook with exactly one worksheet to avoid importing the wrong tab.");
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook has no readable worksheet.");
  const lines: string[] = []; let contentLength = 0;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (lines.length >= 1001) throw new Error("Catalogue workbooks are limited to 1,000 data rows.");
    if (row.cellCount > 20) throw new Error("Catalogue workbooks are limited to 20 columns.");
    const cells = Array.from({ length: row.cellCount }, (_, index) => {
      const value = row.getCell(index + 1).value;
      if (value === null || value === undefined) return "";
      if (typeof value === "object" && !(value instanceof Date)) {
        if ("formula" in value || "sharedFormula" in value) throw new Error("Formula cells are not accepted; paste values before import.");
        if ("richText" in value) return value.richText.map((part) => part.text).join("");
        if ("text" in value) return value.text;
        throw new Error("This workbook contains a cell type that cannot be imported safely.");
      }
      return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    });
    const line = cells.map(escapeCsvCell).join(",");
    contentLength += line.length + (lines.length ? 1 : 0);
    if (contentLength > 1_000_000) throw new Error("Parsed workbook content exceeds the 1 MB catalogue limit.");
    lines.push(line);
  });
  return lines.join("\n");
}
