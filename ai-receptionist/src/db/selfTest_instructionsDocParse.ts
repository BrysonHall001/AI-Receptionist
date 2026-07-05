// Self-test: document extraction (Task 1) + AI organize pass (Task 2). Real parsing libraries on
// in-memory buffers; the OpenAI call is MOCKED (sandbox blocks the network). No DB, no disk.
//   npx tsx src/db/selfTest_instructionsDocParse.ts
import * as XLSX from "xlsx";
import AdmZip from "adm-zip";
import { extractDocuments, combineBlocks, MAX_FILE_BYTES } from "../services/docExtractService";
import { organizeIntoSections, InstructionsParseError } from "../services/instructionsDocParseService";

let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }

function xlsxBuf(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Service", "Price"], ["Drain cleaning", "149"]]), "Prices");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
function docxBuf(text: string): Buffer {
  // Minimal valid .docx (a zip with the parts mammoth reads).
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`));
  zip.addFile("_rels/.rels", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`));
  zip.addFile("word/document.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`));
  return zip.toBuffer();
}
const PDF_HELLO = Buffer.from("JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA2MTIgNzkyXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNCAwIFI+Pj4+L0NvbnRlbnRzIDUgMCBSPj4KZW5kb2JqCjQgMCBvYmoKPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj4KZW5kb2JqCjUgMCBvYmoKPDwvTGVuZ3RoIDQ0Pj4Kc3RyZWFtCkJUCi9GMSAyNCBUZgoxMDAgNzAwIFRkCihIZWxsbyBQREYpIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQ1IDAwMDAwIG4gCjAwMDAwMDAzMjMgMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDYvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgo0MTcKJSVFT0Y=", "base64");

async function main() {
  console.log("instructions doc parse\n======================");
  try {
    console.log("(1) extraction — each supported type + filename labels:");
    const files = [
      { originalname: "about.txt", buffer: Buffer.from("We fix drains and water heaters.") },
      { originalname: "prices.csv", buffer: Buffer.from("Service,Price\nDrain cleaning,149") },
      { originalname: "rates.xlsx", buffer: xlsxBuf() },
      { originalname: "brochure.docx", buffer: docxBuf("We are a family plumbing business.") },
      { originalname: "flyer.pdf", buffer: PDF_HELLO },
      { originalname: "logo.bin", buffer: Buffer.from([1, 2, 3, 4]) },
    ];
    const r = await extractDocuments(files);
    const txt = (n: string) => { const b = r.blocks.find((x) => x.filename === n); return b ? b.text : ""; };
    check(/drains/.test(txt("about.txt")), "txt extracted");
    check(/149/.test(txt("prices.csv")), "csv extracted");
    check(/149/.test(txt("rates.xlsx")), "xlsx extracted (sheet_to_csv)");
    check(/family plumbing/.test(txt("brochure.docx")), "docx extracted (mammoth)");
    check(/Hello/.test(txt("flyer.pdf")), "pdf extracted (pdf-parse v2)");
    check(r.skipped.some((s) => s.filename === "logo.bin" && /unsupported/.test(s.reason)), "unsupported .bin skipped with reason");
    check(r.blocks.every((b) => !!b.filename), "every block is labelled with its source filename");

    console.log("\n(2) zip expansion + oversize:");
    const zip = new AdmZip();
    zip.addFile("inner.txt", Buffer.from("Zip inner text about pricing."));
    zip.addFile("inner.csv", Buffer.from("A,B\n1,2"));
    zip.addFile("skip.exe", Buffer.from("nope"));
    const rz = await extractDocuments([{ originalname: "docs.zip", buffer: zip.toBuffer() }]);
    check(rz.blocks.some((b) => /inner\.txt/.test(b.filename) && /pricing/.test(b.text)), "zip: inner .txt extracted + labelled 'zip › entry'");
    check(rz.blocks.some((b) => /inner\.csv/.test(b.filename)), "zip: inner .csv extracted");
    check(rz.skipped.some((s) => /skip\.exe/.test(s.filename)), "zip: unsupported inner entry skipped");
    const big = { originalname: "huge.txt", buffer: Buffer.alloc(MAX_FILE_BYTES + 1, 97) };
    const rb = await extractDocuments([big]);
    check(rb.skipped.some((s) => s.filename === "huge.txt" && /too big/.test(s.reason)), "oversize file skipped 'too big'");

    console.log("\n(3) combineBlocks labels each source:");
    const combined = combineBlocks(r.blocks);
    check(/===== FILE: about\.txt =====/.test(combined) && /===== FILE: prices\.csv =====/.test(combined), "combined text labels each file block");

    console.log("\n(4) AI organize (MOCKED) — maps to sections, no invention:");
    let sentParams: any = null;
    const mockChat = async (params: any) => { sentParams = params; return { choices: [{ message: { content: JSON.stringify({ sections: [ { section: "Services", content: "We fix drains and water heaters." }, { section: "Pricing", content: "Drain cleaning: $149" }, { section: "Random", content: "ignore me" } ] }) } }] }; };
    const secNames = ["Overview", "Services", "Pricing", "FAQs"];
    const out = await organizeIntoSections(combined, secNames, { chat: mockChat });
    check(out.map((s) => s.section).join(",") === secNames.join(","), "returns exactly the requested sections in order");
    check(out.find((s) => s.section === "Services")!.content === "We fix drains and water heaters.", "Services filled from docs");
    check(out.find((s) => s.section === "Pricing")!.content === "Drain cleaning: $149", "Pricing filled from docs");
    check(out.find((s) => s.section === "Overview")!.content === "" && out.find((s) => s.section === "FAQs")!.content === "", "uncovered sections left EMPTY (no invention)");
    check(!out.some((s) => s.section === "Random"), "unknown section from the model dropped");
    check(/only.*document|do not invent|Do NOT invent/i.test(String(sentParams?.messages?.[0]?.content || "")), "system prompt instructs: only organize, don't invent");
    check(sentParams?.response_format?.type === "json_object", "requests JSON response format");

    console.log("\n(5) graceful failures:");
    let noCall = true;
    const spyChat = async () => { noCall = false; return {} as any; };
    const empty = await organizeIntoSections("   ", secNames, { chat: spyChat });
    check(noCall && empty.every((s) => s.content === ""), "empty docs -> all empty, model NOT called");
    let threwFail = false;
    try { await organizeIntoSections(combined, secNames, { chat: async () => { throw new Error("network down"); } }); } catch (e) { threwFail = e instanceof InstructionsParseError; }
    check(threwFail, "model error -> InstructionsParseError");
    let threwJson = false;
    try { await organizeIntoSections(combined, secNames, { chat: async () => ({ choices: [{ message: { content: "not json at all" } }] } as any) }); } catch (e) { threwJson = e instanceof InstructionsParseError; }
    check(threwJson, "invalid JSON -> InstructionsParseError");
  } catch (e) {
    console.log("   (error: " + (e as Error).message + ")"); fails++;
  }
  console.log("\n======================");
  console.log(fails === 0 ? "ALL PASSED \u2705  (instructions doc parse)" : `${fails} FAILED \u274c`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
