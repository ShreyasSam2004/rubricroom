// Browser-safe tokenizer (no node:crypto), used for fuzzy matching in client components.
const STOP = new Set("a an the and or of for to in on at by with from is are be as it this that my me i you task build add".split(" "));

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > 4 ? t.replace(/(ing|ed|es|s)$/, "") : t));
}
