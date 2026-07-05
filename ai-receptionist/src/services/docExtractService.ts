// Extracts PLAIN TEXT from uploaded documents (PDF, Word .docx, Excel/CSV, plain text) and from
// .zip archives containing any of those. Everything runs on in-memory buffers — nothing is ever
// written to disk or the DB (Task 4: process and discard). Each returned block is labelled with
// its source filename so the AI organize pass doesn't jumble contexts. Unsupported/oversized
// entries are skipped with a reason rather than failing the whole upload.
import AdmZip from "adm-zip";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

export const MAX_FILES = 15;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;   // 10 MB per file (and per zip entry)
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;  // 25 MB across everything
export const MAX_EXTRACTED_CHARS = 200_000;       // cap combined text sent to the model

export interface ExtractBlock { filename: string; text: string; }
export interface SkippedFile { filename: string; reason: string; }
export interface ExtractResult { blocks: ExtractBlock[]; skipped: SkippedFile[]; }

const SUPPORTED = /\.(pdf|docx|xlsx|xls|csv|txt|md|text)$/i;
function ext(name: string): string { const m = name.toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : ""; }
function clean(s: string): string { return String(s || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); }

async function extractOne(filename: string, buf: Buffer): Promise<string> {
  const e = ext(filename);
  if (e === "pdf") {
    // pdf-parse v2: new PDFParse({ data }).getText(). Loaded lazily so its worker only spins up
    // when a PDF is actually present.
    const { PDFParse } = await import("pdf-parse");
    const parser = new (PDFParse as any)({ data: buf });
    try {
      const r = await parser.getText();
      // v2 appends "-- N of M --" page separators; drop them.
      return clean(String(r?.text || "").replace(/^--\s*\d+\s+of\s+\d+\s*--$/gim, ""));
    } finally { try { await parser.destroy(); } catch { /* ignore */ } }
  }
  if (e === "docx") {
    const r = await mammoth.extractRawText({ buffer: buf });
    return clean(r.value || "");
  }
  if (e === "xlsx" || e === "xls" || e === "csv") {
    const wb = XLSX.read(buf, { type: "buffer" });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
      if (csv.trim()) parts.push(wb.SheetNames.length > 1 ? `[Sheet: ${name}]\n${csv}` : csv);
    }
    return clean(parts.join("\n\n"));
  }
  if (e === "txt" || e === "md" || e === "text") return clean(buf.toString("utf8"));
  throw new Error("unsupported type");
}

// Extract from a batch of uploaded files. Enforces per-file, total, and count limits. Zip entries
// count toward the total budget but not the top-level file count.
export async function extractDocuments(files: { originalname: string; buffer: Buffer }[]): Promise<ExtractResult> {
  const blocks: ExtractBlock[] = [];
  const skipped: SkippedFile[] = [];
  let total = 0;

  const list = files.slice(0, MAX_FILES);
  for (const f of files.slice(MAX_FILES)) skipped.push({ filename: f.originalname, reason: `skipped — more than ${MAX_FILES} files` });

  for (const f of list) {
    const name = f.originalname || "file";
    if (ext(name) === "zip") {
      let entries: any[] = [];
      try { entries = new AdmZip(f.buffer).getEntries(); }
      catch { skipped.push({ filename: name, reason: "could not open zip" }); continue; }
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const inner = `${name} › ${entry.entryName}`;
        if (!SUPPORTED.test(entry.entryName)) { skipped.push({ filename: inner, reason: "unsupported type" }); continue; }
        const size = entry.header?.size ?? 0;
        if (size > MAX_FILE_BYTES) { skipped.push({ filename: inner, reason: "too big" }); continue; }
        let data: Buffer;
        try { data = entry.getData(); } catch { skipped.push({ filename: inner, reason: "could not read from zip" }); continue; }
        if (total + data.length > MAX_TOTAL_BYTES) { skipped.push({ filename: inner, reason: "total upload size limit reached" }); continue; }
        total += data.length;
        try { const text = await extractOne(entry.entryName, data); if (text) blocks.push({ filename: inner, text }); else skipped.push({ filename: inner, reason: "no readable text" }); }
        catch (err) { skipped.push({ filename: inner, reason: `couldn't read (${(err as Error).message})` }); }
      }
      continue;
    }

    if (!SUPPORTED.test(name)) { skipped.push({ filename: name, reason: "unsupported type" }); continue; }
    if (f.buffer.length > MAX_FILE_BYTES) { skipped.push({ filename: name, reason: "too big" }); continue; }
    if (total + f.buffer.length > MAX_TOTAL_BYTES) { skipped.push({ filename: name, reason: "total upload size limit reached" }); continue; }
    total += f.buffer.length;
    try { const text = await extractOne(name, f.buffer); if (text) blocks.push({ filename: name, text }); else skipped.push({ filename: name, reason: "no readable text" }); }
    catch (err) { skipped.push({ filename: name, reason: `couldn't read (${(err as Error).message})` }); }
  }

  return { blocks, skipped };
}

// Combine labelled blocks into one text budget for the model.
export function combineBlocks(blocks: ExtractBlock[]): string {
  let out = "";
  for (const b of blocks) {
    const piece = `===== FILE: ${b.filename} =====\n${b.text}\n`;
    if (out.length + piece.length > MAX_EXTRACTED_CHARS) { out += piece.slice(0, Math.max(0, MAX_EXTRACTED_CHARS - out.length)); break; }
    out += piece + "\n";
  }
  return out.trim();
}
