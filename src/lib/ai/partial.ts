// Reading structured output while the model is still writing it. Agents stream their JSON so a
// reply can appear word by word; these helpers pull the readable parts out of the unfinished text.

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };

/**
 * The value of the first `"field": "…"` string in unfinished JSON, decoded so far, and whether
 * its closing quote has arrived. Null until the value starts.
 */
export function partialString(json: string, field: string): { value: string; complete: boolean } | null {
  const key = `"${field}"`;
  let i = json.indexOf(key);
  if (i < 0) return null;
  i += key.length;
  while (i < json.length && (json[i] === ":" || /\s/.test(json[i]))) i++;
  if (json[i] !== '"') return null;
  i++;
  let value = "";
  while (i < json.length) {
    const ch = json[i];
    if (ch === '"') return { value, complete: true };
    if (ch === "\\") {
      const next = json[i + 1];
      if (next === undefined) break; // the escape is split across chunks; wait for the rest
      if (next === "u") {
        const hex = json.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        value += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      value += ESCAPES[next] ?? next;
      i += 2;
      continue;
    }
    value += ch;
    i++;
  }
  return { value, complete: false };
}

/** How many times `"key":` appears so far: a cheap count of list entries the model has started. */
export function countKey(json: string, key: string) {
  return json.split(`"${key}":`).length - 1;
}
