export type JsonParseResult = {
  value: unknown;
  repaired: boolean;
  repairNotes: string[];
};

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/, "");
}

function normalizeUnicodeJsonPunctuation(value: string): { text: string; changed: boolean } {
  let changed = false;
  let result = "";
  let inString = false;
  let escaping = false;

  const punctuationMap: Record<string, string> = {
    "\u201c": "\"",
    "\u201d": "\"",
    "\u2018": "'",
    "\u2019": "'",
    "\uff1a": ":",
    "\uff0c": ",",
    "\uff5b": "{",
    "\uff5d": "}",
    "\uff3b": "[",
    "\uff3d": "]",
  };

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (!inString) {
      const replacement = punctuationMap[char];
      if (replacement) {
        result += replacement;
        changed = true;
        if (replacement === "\"") {
          inString = true;
          escaping = false;
        }
        continue;
      }

      result += char;
      if (char === "\"") {
        inString = true;
        escaping = false;
      }
      continue;
    }

    result += char;

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (char === "\"") {
      inString = false;
    }
  }

  return { text: result, changed };
}

function removeTrailingCommas(value: string): { text: string; changed: boolean } {
  const next = value.replace(/,\s*([}\]])/g, "$1");
  return { text: next, changed: next !== value };
}

function repairJsonStringSyntax(value: string): { text: string; changed: boolean } {
  let changed = false;
  let result = "";
  let inString = false;
  let escaping = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (!inString) {
      result += char;
      if (char === "\"") {
        inString = true;
        escaping = false;
      }
      continue;
    }

    if (escaping) {
      result += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaping = true;
      continue;
    }

    if (char === "\n") {
      result += "\\n";
      changed = true;
      continue;
    }

    if (char === "\r") {
      result += "\\r";
      changed = true;
      continue;
    }

    if (char === "\"") {
      let lookahead = index + 1;
      while (lookahead < value.length && /\s/.test(value[lookahead])) {
        lookahead += 1;
      }

      const next = value[lookahead];
      const isClosingQuote = next === "," || next === "}" || next === "]" || next === ":";

      if (isClosingQuote) {
        result += char;
        inString = false;
        continue;
      }

      result += "\\\"";
      changed = true;
      continue;
    }

    result += char;
  }

  return { text: result, changed };
}

function repairMissingClosingQuotesBeforeDelimiters(value: string): { text: string; changed: boolean } {
  let changed = false;
  let result = "";
  let inString = false;
  let escaping = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (!inString) {
      result += char;
      if (char === "\"") {
        inString = true;
        escaping = false;
      }
      continue;
    }

    if (escaping) {
      result += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaping = true;
      continue;
    }

    if (char === "\"") {
      result += char;
      inString = false;
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;
      while (lookahead < value.length && /\s/.test(value[lookahead])) {
        lookahead += 1;
      }

      if (value[lookahead] === "\"") {
        let nextQuote = lookahead + 1;
        let localEscaping = false;
        while (nextQuote < value.length) {
          const nextChar = value[nextQuote];
          if (localEscaping) {
            localEscaping = false;
          } else if (nextChar === "\\") {
            localEscaping = true;
          } else if (nextChar === "\"") {
            break;
          }
          nextQuote += 1;
        }

        if (nextQuote < value.length && value[nextQuote] === "\"") {
          let trailing = nextQuote + 1;
          while (trailing < value.length && /\s/.test(value[trailing])) {
            trailing += 1;
          }

          const nextToken = value[trailing];
          const looksLikeNextFieldOrItem =
            nextToken === ":" || nextToken === "," || nextToken === "]" || nextToken === "}";

          if (looksLikeNextFieldOrItem) {
            result += "\"";
            result += char;
            inString = false;
            changed = true;
            continue;
          }
        }
      }
    }

    result += char;
  }

  return { text: result, changed };
}

function repairMissingObjectStartersInArrays(value: string): { text: string; changed: boolean } {
  let changed = false;
  let result = "";
  let inString = false;
  let escaping = false;
  const stack: string[] = [];
  let previousSignificant = "";

  const looksLikeObjectKey = (startIndex: number): boolean => {
    if (value[startIndex] !== "\"") {
      return false;
    }
    let cursor = startIndex + 1;
    let localEscaping = false;
    while (cursor < value.length) {
      const nextChar = value[cursor];
      if (localEscaping) {
        localEscaping = false;
      } else if (nextChar === "\\") {
        localEscaping = true;
      } else if (nextChar === "\"") {
        break;
      }
      cursor += 1;
    }
    if (cursor >= value.length || value[cursor] !== "\"") {
      return false;
    }
    cursor += 1;
    while (cursor < value.length && /\s/.test(value[cursor])) {
      cursor += 1;
    }
    return value[cursor] === ":";
  };

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      result += char;
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      if (stack[stack.length - 1] === "[" && (previousSignificant === "[" || previousSignificant === ",") && looksLikeObjectKey(index)) {
        result += "{";
        changed = true;
      }
      result += char;
      inString = true;
      escaping = false;
      previousSignificant = "\"";
      continue;
    }

    result += char;

    if (char === "{") {
      stack.push("{");
      previousSignificant = char;
      continue;
    }
    if (char === "[") {
      stack.push("[");
      previousSignificant = char;
      continue;
    }
    if (char === "}" || char === "]") {
      if (stack.length > 0) {
        stack.pop();
      }
      previousSignificant = char;
      continue;
    }
    if (!/\s/.test(char)) {
      previousSignificant = char;
    }
  }

  return { text: result, changed };
}

function repairKnownBrokenObjectBoundaries(value: string): { text: string; changed: boolean } {
  let next = value.replace(/},\s*"id":/g, '},{"id":');
  next = next.replace(/}}\s*,\s*"conclusion":/g, '},"conclusion":');
  return { text: next, changed: next !== value };
}

function closeOpenStructures(value: string): { text: string; changed: boolean } {
  let changed = false;
  let inString = false;
  let escaping = false;
  const stack: string[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      escaping = false;
      continue;
    }

    if (char === "{") {
      stack.push("}");
      continue;
    }

    if (char === "[") {
      stack.push("]");
      continue;
    }

    if ((char === "}" || char === "]") && stack[stack.length - 1] === char) {
      stack.pop();
    }
  }

  let next = value;
  if (inString) {
    next += "\"";
    changed = true;
  }

  if (stack.length > 0) {
    next += stack.reverse().join("");
    changed = true;
  }

  return { text: next, changed };
}

export function parseJsonWithRepair(input: string): JsonParseResult {
  const normalized = stripBom(input);

  try {
    return { value: JSON.parse(normalized), repaired: false, repairNotes: [] };
  } catch {
    const repairNotes: string[] = [];
    let repairedText = normalized;

    const unicodeRepair = normalizeUnicodeJsonPunctuation(repairedText);
    repairedText = unicodeRepair.text;
    if (unicodeRepair.changed) {
      repairNotes.push("normalized smart quotes or full-width JSON punctuation");
    }

    const stringRepair = repairJsonStringSyntax(repairedText);
    repairedText = stringRepair.text;
    if (stringRepair.changed) {
      repairNotes.push("escaped likely unescaped quotes/newlines inside strings");
    }

    const missingQuoteRepair = repairMissingClosingQuotesBeforeDelimiters(repairedText);
    repairedText = missingQuoteRepair.text;
    if (missingQuoteRepair.changed) {
      repairNotes.push("inserted likely missing closing quotes before field or array delimiters");
    }

    const knownBoundaryRepair = repairKnownBrokenObjectBoundaries(repairedText);
    repairedText = knownBoundaryRepair.text;
    if (knownBoundaryRepair.changed) {
      repairNotes.push("patched known broken object boundaries around repeated items");
    }

    const trailingCommaRepair = removeTrailingCommas(repairedText);
    repairedText = trailingCommaRepair.text;
    if (trailingCommaRepair.changed) {
      repairNotes.push("removed trailing commas");
    }

    const structureRepair = closeOpenStructures(repairedText);
    repairedText = structureRepair.text;
    if (structureRepair.changed) {
      repairNotes.push("closed unterminated strings or trailing braces/brackets");
    }

    return {
      value: JSON.parse(repairedText),
      repaired: repairNotes.length > 0,
      repairNotes,
    };
  }
}
