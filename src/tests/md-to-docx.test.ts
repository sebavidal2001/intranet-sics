import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { markdownToDocxBuffer } from "@/lib/portali/preventivatore/scheda-tecnica/md-to-docx";

// Conversione della scheda tecnica in Word: liste annidate e numerate, codici con
// underscore che non devono diventare corsivo.

async function documentXml(markdown: string): Promise<string> {
  const buffer = await markdownToDocxBuffer({ markdown, titoloDocumento: "Prova" });
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("word/document.xml")!.async("string");
}

describe("markdownToDocxBuffer", () => {
  it("un codice con underscore resta testo normale", async () => {
    const xml = await documentXml("Profilo NASTRO_3M_A in alluminio");
    expect(xml).toContain("NASTRO_3M_A");
    expect(xml).not.toContain("<w:i/>");
  });

  it("_testo_ delimitato è corsivo", async () => {
    const xml = await documentXml("Una parola _importante_ qui");
    expect(xml).toContain("<w:i/>");
  });

  it("le liste annidate conservano il livello, quelle numerate la numerazione", async () => {
    const xml = await documentXml("- primo\n  - secondo livello\n\n1. uno\n2. due");
    expect(xml).toMatch(/<w:ilvl w:val="1"\/>/);
    expect((xml.match(/<w:numPr>/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
