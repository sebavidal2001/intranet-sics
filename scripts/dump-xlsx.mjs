import XLSX from "xlsx";

const file = process.argv[2];
const onlySheet = process.argv[3]; // opzionale: nome foglio
const wb = XLSX.readFile(file, { cellFormula: true, cellNF: true, cellText: true });

for (const name of wb.SheetNames) {
  if (/verifica costi/i.test(name)) continue;
  if (onlySheet && name !== onlySheet) continue;
  const ws = wb.Sheets[name];
  if (!ws || !ws["!ref"]) { console.log(`\n===== FOGLIO: ${name} (vuoto) =====`); continue; }
  const range = XLSX.utils.decode_range(ws["!ref"]);
  console.log(`\n===== FOGLIO: ${name}  (${ws["!ref"]}) =====`);
  for (let R = range.s.r; R <= range.e.r; R++) {
    const rowOut = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (!cell) continue;
      const v = cell.v !== undefined ? String(cell.v).slice(0, 40) : "";
      if (cell.f) {
        rowOut.push(`${addr}: =${cell.f}  ⇒ ${v}`);
      } else if (cell.v !== undefined && String(cell.v).trim() !== "") {
        rowOut.push(`${addr}: ${v}`);
      }
    }
    if (rowOut.length) console.log(rowOut.join("  |  "));
  }
}
