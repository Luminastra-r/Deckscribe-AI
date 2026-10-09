import path from "node:path";

export const DO_PPT_COMMAND = "/做PPT";
export const MIN_PAGE_COUNT = 1;
export const MAX_PAGE_COUNT = 20;

export type ParsedPptPage = {
  pageNumber: number;
  title: string;
  body: string;
  bodyLines: string[];
  rawBlock: string;
};

export type ParsedPptCommand = {
  command: typeof DO_PPT_COMMAND;
  rawMessage: string;
  normalizedPayload: string;
  pageCount: number;
  pages: ParsedPptPage[];
  pageTitleIssues: PageTitleIssue[];
  feedbackMessage: string;
};

export type PageTitleIssue = {
  pageNumber: number;
  markerCount: number;
};

export type ParsePptOptions = {
  splitByTitleMarkers?: boolean;
};

export type LlmPageContents = string[];

const PAGE_DELIMITER_PATTERN = /^(?:(?:[-—－]\s*){3,})(?:(?:#|\/\/).*)?$/;
const PAGE_TITLE_MARKER_PATTERN = /^(?:页标题\s*[:：]\s*\S|#{1,6}\s+(?:页标题\s*[:：]\s*)?\S)/;
const KNOWN_META_COMMENTS = [
  "分页标识",
  "第一行是标题",
  "下一页标题",
  "以下是正文",
  "第一页标题",
];

function normalizeNewlines(value: string): string {
  return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function unwrapCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  return match ? match[1] : value;
}

function removeAngleBracketWrapper(value: string): string {
  const lines = value.split("\n");
  if (lines.length >= 2 && lines[0].trim() === "<" && lines.at(-1)?.trim() === ">") {
    return lines.slice(1, -1).join("\n");
  }
  return value;
}

function stripCommandPrefix(value: string): string {
  const trimmedStart = value.trimStart();
  if (!trimmedStart.startsWith(DO_PPT_COMMAND)) {
    return value;
  }

  const withoutCommand = trimmedStart.slice(DO_PPT_COMMAND.length);
  const newlineIndex = withoutCommand.indexOf("\n");
  const firstLine = newlineIndex === -1 ? withoutCommand : withoutCommand.slice(0, newlineIndex);
  const remaining = newlineIndex === -1 ? "" : withoutCommand.slice(newlineIndex);
  const cleanedFirstLine = firstLine.replace(/^[ \t]*[:：]?[ \t]*/, "");

  return `${cleanedFirstLine}${remaining}`;
}

function trimTrailingMetaComment(line: string): string {
  let next = line;
  for (const comment of KNOWN_META_COMMENTS) {
    next = next.replace(new RegExp(`\\s+#\\s*${comment}\\s*$`), "");
    next = next.replace(new RegExp(`\\s+//\\s*${comment}\\s*$`), "");
  }
  return next;
}

function isKnownMetaLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return KNOWN_META_COMMENTS.some((comment) => trimmed === `# ${comment}` || trimmed === `// ${comment}`);
}

function isPageDelimiter(line: string): boolean {
  return PAGE_DELIMITER_PATTERN.test(line.trim());
}

function normalizePageLine(line: string, isTitleLine: boolean): string {
  let normalized = trimTrailingMetaComment(line).trim();

  if (isTitleLine) {
    normalized = normalized.replace(/^#{1,6}\s+/, "");
  }

  return normalized;
}

function compactBlankLines(lines: string[]): string[] {
  const result: string[] = [];

  for (const line of lines) {
    const isBlank = line.trim() === "";
    const previousIsBlank = result.at(-1)?.trim() === "";

    if (isBlank && previousIsBlank) {
      continue;
    }

    result.push(line);
  }

  while (result[0]?.trim() === "") {
    result.shift();
  }

  while (result.at(-1)?.trim() === "") {
    result.pop();
  }

  return result;
}

function splitIntoPageBlocks(payload: string): string[] {
  const lines = payload.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (isPageDelimiter(line)) {
      const block = compactBlankLines(current).join("\n").trim();
      if (block) {
        blocks.push(block);
      }
      current = [];
      continue;
    }

    if (isKnownMetaLine(line)) {
      continue;
    }

    current.push(line);
  }

  const trailingBlock = compactBlankLines(current).join("\n").trim();
  if (trailingBlock) {
    blocks.push(trailingBlock);
  }

  return blocks;
}

export function countPageTitleMarkers(block: string): number {
  return normalizeNewlines(block)
    .split("\n")
    .filter((line) => PAGE_TITLE_MARKER_PATTERN.test(line.trim()))
    .length;
}

function splitPageBlockByTitleMarkers(block: string): string[] {
  if (countPageTitleMarkers(block) <= 1) {
    return [block];
  }

  const lines = normalizeNewlines(block).split("\n");
  const prefix: string[] = [];
  const blocks: string[] = [];
  let current: string[] = [];
  let markerSeen = false;

  for (const line of lines) {
    if (PAGE_TITLE_MARKER_PATTERN.test(line.trim())) {
      if (markerSeen) {
        const completed = compactBlankLines(current).join("\n").trim();
        if (completed) blocks.push(completed);
      }
      current = [line];
      if (!markerSeen && prefix.length > 0) {
        current.push(...prefix);
      }
      markerSeen = true;
      continue;
    }

    if (markerSeen) {
      current.push(line);
    } else {
      prefix.push(line);
    }
  }

  const trailing = compactBlankLines(current).join("\n").trim();
  if (trailing) blocks.push(trailing);
  return blocks.length > 0 ? blocks : [block];
}

function parsePageBlock(block: string, index: number): ParsedPptPage {
  const rawLines = compactBlankLines(block.split("\n"));
  const normalizedLines = rawLines.map((line, lineIndex) => normalizePageLine(line, lineIndex === 0));

  const firstNonEmptyIndex = normalizedLines.findIndex((line) => line.trim() !== "");
  if (firstNonEmptyIndex === -1) {
    throw new Error(`第 ${index + 1} 页没有可识别内容。`);
  }

  const title = normalizedLines[firstNonEmptyIndex].trim();
  if (!title) {
    throw new Error(`第 ${index + 1} 页缺少标题。`);
  }

  const bodyLines = compactBlankLines(
    normalizedLines
      .slice(firstNonEmptyIndex + 1)
      .map((line) => line.trimEnd()),
  );

  return {
    pageNumber: index + 1,
    title,
    body: bodyLines.join("\n").trim(),
    bodyLines,
    rawBlock: block,
  };
}

export function createArrangementFeedback(pageCount: number): string {
  return `共识别到${pageCount}页的内容，现在进入编排环节。`;
}

export function parseDoPptCommandMessage(rawMessage: string, options: ParsePptOptions = {}): ParsedPptCommand {
  const normalizedMessage = normalizeNewlines(rawMessage);
  const payload = removeAngleBracketWrapper(unwrapCodeFence(stripCommandPrefix(normalizedMessage))).trim();

  if (!payload) {
    throw new Error("未检测到 /做PPT 指令内容。");
  }

  const explicitBlocks = splitIntoPageBlocks(payload);
  const blocks = options.splitByTitleMarkers
    ? explicitBlocks.flatMap((block) => splitPageBlockByTitleMarkers(block))
    : explicitBlocks;
  if (blocks.length === 0) {
    throw new Error("未识别到有效分页内容，请检查分页标识是否为 ---。");
  }

  if (blocks.length < MIN_PAGE_COUNT || blocks.length > MAX_PAGE_COUNT) {
    throw new Error(`识别到 ${blocks.length} 页内容，当前仅支持 ${MIN_PAGE_COUNT}-${MAX_PAGE_COUNT} 页。`);
  }

  const pages = blocks.map((block, index) => parsePageBlock(block, index));
  const pageTitleIssues = pages
    .map((page) => ({ pageNumber: page.pageNumber, markerCount: countPageTitleMarkers(page.rawBlock) }))
    .filter((issue) => issue.markerCount > 1);

  return {
    command: DO_PPT_COMMAND,
    rawMessage,
    normalizedPayload: payload,
    pageCount: pages.length,
    pages,
    pageTitleIssues,
    feedbackMessage: createArrangementFeedback(pages.length),
  };
}

export function buildLlmPageContents(parsed: ParsedPptCommand): LlmPageContents {
  return parsed.pages.map((page) => page.rawBlock);
}

export function buildParsedOutputPath(inputPath: string): string {
  const inputName = path.parse(inputPath).name;
  return path.join(path.resolve(process.cwd(), "output"), `${inputName}.pages.json`);
}

export function buildParsedDebugOutputPath(inputPath: string): string {
  const inputName = path.parse(inputPath).name;
  return path.join(path.resolve(process.cwd(), "output"), `${inputName}.pages.debug.json`);
}
