/**
 * Robustly parse AI-generated JSON that may contain:
 * - Unescaped literal newlines / carriage-returns / tabs inside string values
 * - Leading/trailing prose around the JSON object
 *
 * Strategy:
 *   1. Extract the outermost JSON object via regex
 *   2. Try standard JSON.parse
 *   3. On failure, sanitise literal control characters inside string values and retry
 *   4. Throw with the original error message if both attempts fail
 */
export function parseAiJson<T = unknown>(raw: string, passName: string): T {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in ${passName} response`);

  const candidate = match[0];

  try {
    return JSON.parse(candidate) as T;
  } catch (firstErr) {
    const sanitised = sanitiseJsonString(candidate);
    try {
      return JSON.parse(sanitised) as T;
    } catch {
      throw firstErr;
    }
  }
}

/**
 * Replace literal control characters that appear inside JSON string values
 * with their properly-escaped JSON equivalents.
 *
 * The regex walks through the JSON character-by-character in two states:
 *   - inside a string literal  → escape raw \r \n \t and other control chars
 *   - outside a string literal → leave unchanged
 *
 * This avoids the much more complex full-parser approach while covering the
 * common GPT failure mode of embedding raw newlines in string values.
 */
function sanitiseJsonString(json: string): string {
  let result = "";
  let inString = false;
  let i = 0;

  while (i < json.length) {
    const ch = json[i];

    if (inString) {
      if (ch === "\\") {
        result += ch + (json[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
        result += ch;
        i++;
        continue;
      }
      // Replace any bare control character with its JSON escape
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        switch (ch) {
          case "\n": result += "\\n"; break;
          case "\r": result += "\\r"; break;
          case "\t": result += "\\t"; break;
          default:   result += `\\u${code.toString(16).padStart(4, "0")}`; break;
        }
        i++;
        continue;
      }
    } else {
      if (ch === '"') inString = true;
    }

    result += ch;
    i++;
  }

  return result;
}
