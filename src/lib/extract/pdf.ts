import { sha256 } from "@/lib/text";

export interface ExtractedPdf {
  text: string;
  pages: number;
  contentHash: string;
}

/** Text-only PDF extraction (pdf.js via unpdf). No scripts, forms or embedded files are executed. */
export async function extractPdf(data: Buffer, maxPages = 60): Promise<ExtractedPdf> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(data));
  if (doc.numPages > maxPages) {
    throw new Error(`PDF has ${doc.numPages} pages; the limit is ${maxPages}.`);
  }
  const { text, totalPages } = await extractText(doc, { mergePages: true });
  const clean = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { text: clean, pages: totalPages, contentHash: sha256(clean) };
}
