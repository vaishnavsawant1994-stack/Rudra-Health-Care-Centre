import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { workbookToCatalogueCsv } from "./catalogue-workbook";

async function asArrayBuffer(workbook: ExcelJS.Workbook) {
  const data = await workbook.xlsx.writeBuffer() as unknown as Uint8Array;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

describe("browser-local Excel catalogue import", () => {
  it("turns a single sheet into escaped CSV values", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Catalogue").addRows([["service_type", "service_code", "display_name"], ["TEST", "A-1", 'Blood, "basic" panel']]);
    expect(await workbookToCatalogueCsv(await asArrayBuffer(workbook))).toBe('service_type,service_code,display_name\nTEST,A-1,"Blood, ""basic"" panel"');
  });
  it("rejects formulas and multiple sheets instead of guessing values or tabs", async () => {
    const withFormula = new ExcelJS.Workbook();
    const sheet = withFormula.addWorksheet("Catalogue");
    sheet.addRows([["service_type", "service_code", "display_name"], ["TEST", "A-1", "Test"]]);
    sheet.getCell("C2").value = { formula: '"Computed name"', result: "Computed name" };
    await expect(workbookToCatalogueCsv(await asArrayBuffer(withFormula))).rejects.toThrow(/Formula cells/);
    const multiSheet = new ExcelJS.Workbook();
    multiSheet.addWorksheet("Current"); multiSheet.addWorksheet("Archive");
    await expect(workbookToCatalogueCsv(await asArrayBuffer(multiSheet))).rejects.toThrow(/exactly one worksheet/);
  });
});
