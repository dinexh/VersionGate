/**
 * Parses raw .env or key=value strings (single-line or multiline) into key-value pairs.
 * Supports:
 * - KEY=value
 * - KEY="quoted value"
 * - KEY='single quoted'
 * - Exported vars: export KEY=value
 * - Multiline bulk paste
 */
export function parseEnvText(text: string): Array<{ key: string; value: string }> {
  const lines = text.split(/\r?\n/);
  const result: Array<{ key: string; value: string }> = [];

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('export ')) {
      line = line.slice(7).trim();
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) {
      const k = line.trim();
      if (k) {
        result.push({ key: k, value: '' });
      }
      continue;
    }

    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();

    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }

    if (key) {
      result.push({ key, value: val });
    }
  }

  return result;
}

/**
 * Handles paste event on key or value input:
 * If pasted text contains '=' or newline, parses into pairs and splices into envPairs at target index.
 * Returns true if handled (and caller should preventDefault), false otherwise.
 */
export function handleEnvPaste(
  pastedText: string,
  targetIdx: number,
  setPairs: (updater: (prev: Array<{ key: string; value: string }>) => Array<{ key: string; value: string }>) => void
): boolean {
  if (!pastedText.includes("=") && !pastedText.includes("\n") && !pastedText.includes("\r")) {
    return false;
  }

  const parsed = parseEnvText(pastedText);
  if (parsed.length === 0) return false;

  setPairs((prev) => {
    const next = [...prev];
    // Replace the current row at targetIdx with parsed pairs
    next.splice(targetIdx, 1, ...parsed);
    return next;
  });

  return true;
}
