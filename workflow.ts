import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { exportSceneGraphsToPptxFile } from "./exporter.ts";
import { evaluatePptxParity, evaluateSceneGraphExportSafety, lintRenderedHtmlForExportSafety } from "./export-safety.ts";
import {
  delay,
  extractJsonPayloadFromResponse,
  extractSceneGraphJson,
  isEmptyResponseErrorMessage,
  isFatalLlmErrorMessage,
  isTransientLlmErrorMessage,
  loadLlmConfig,
  type LlmConfig,
  type LlmConfigOverrides,
  requestPagePlanJsonText,
  requestSceneGraphJsonText,
} from "./llm.ts";
import {
  COLOR_STYLE_PROMPTS,
  loadComposedAgentPrompt,
  type AgentPromptMode,
  type ColorStyleKey,
  type LayoutStyleKey,
} from "./prompt.ts";
import {
  buildHeuristicPagePlan,
  decodePagePlanFromText,
  type PagePlan,
} from "./page-plan.ts";
import { refineSceneGraphLayout } from "./layout-refinement.ts";
import { buildDirectPptxLayoutPlan, buildPptxLayoutPlan, type PptxLayoutPlan } from "./pptx-layout-plan.ts";
import {
  buildLlmPageContents,
  parseDoPptCommandMessage,
  type ParsedPptCommand,
} from "./parser.ts";
import { renderSceneGraphToHtml, renderSceneGraphsToHtml } from "./render.ts";
import { decodeSceneGraphFromParsedValue, decodeSceneGraphFromText } from "./scene-graph-codec.ts";
import { parseJsonWithRepair } from "./json-repair.ts";
import { inspectLayoutPlanAlignment } from "./layout-quality.ts";
import { type SceneElement, type SceneGraph } from "./types.ts";

export type WorkflowPageStatus = "pending" | "generating" | "llm_done" | "json_valid" | "pptx_exported" | "failed";

export type WorkflowPageRecord = {
  pageIndex?: number;
  pageNumber: number;
  status?: WorkflowPageStatus;
  pptxPageStatus?: WorkflowPageStatus;
  inputPreview: string;
  planPath: string;
  pptxPlanPath: string;
  planSource: "llm" | "heuristic" | "direct";
  planAttempts: number;
  jsonPath: string;
  finalJsonPath?: string;
  htmlPath: string;
  rawResponsePath?: string;
  rawJsonPath?: string;
  diagnosticPath?: string;
  inputHash?: string;
  attempts: number;
  sceneSource?: "llm";
  fallbackReason?: string;
  acceptedWithWarnings?: boolean;
  warnings?: string[];
  qualityWarnings?: string[];
  blockingFailures?: string[];
  refinementAttempts?: number;
  autoLayoutApplied?: boolean;
  layoutRefinementApplied?: boolean;
  layoutRefinementChanges?: string[];
  exportSafetyHardErrors?: string[];
  normalizationChanges?: string[];
  normalizationLostTextCount?: number;
  normalizationLostTextElementIds?: string[];
  detailsPendingCount?: number;
};

export type WorkflowManifest = {
  inputPath: string;
  outputDir: string;
  pagesPath?: string;
  pagesDebugPath?: string;
  promptPath: string;
  promptPaths?: string[];
  agentPromptMode?: AgentPromptMode;
  basePromptPath?: string;
  layoutStyle?: LayoutStyleKey;
  colorStyle?: ColorStyleKey;
  promptHash?: string;
  model: string;
  pageGenerationMode?: LlmConfig["pageGenerationMode"];
  canvasPreset?: LlmConfig["canvasPreset"];
  pipelineMode: "single-step" | "two-step";
  pagePlanEnabled: boolean;
  qualityRetryEnabled: boolean;
  layoutQualityReportOnly?: boolean;
  parityEnforced: boolean;
  stepDelayMs: number;
  successStepDelayMs: number;
  retryDelayMs: number;
  pageDelayMs: number;
  pageCount: number;
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  failedPageNumber?: number;
  errorMessage?: string;
  finalHtmlPath?: string;
  finalPptxPath?: string;
  partialHtmlPath?: string;
  partialPptxPath?: string;
  resumedAt?: string;
  reusedPageCount?: number;
  pages: WorkflowPageRecord[];
};

export type WorkflowProgressEvent =
  | {
      type: "started";
      pageCount: number;
      outputDir: string;
    }
  | {
      type: "page-start";
      pageNumber: number;
      totalPages: number;
      message: string;
    }
  | {
      type: "page-complete";
      pageNumber: number;
      totalPages: number;
      htmlPath: string;
      jsonPath: string;
      message: string;
    }
  | {
      type: "html-complete";
      pageCount: number;
      finalHtmlPath: string;
      outputDir: string;
      message: string;
    }
  | {
      type: "failed";
      failedPageNumber?: number;
      outputDir: string;
      errorMessage: string;
      partialHtmlPath?: string;
      message: string;
    };

export type BuildDeckHtmlOptions = {
  deckName?: string;
  outputDir?: string;
  config?: LlmConfigOverrides;
  agentPromptPath?: string;
  agentPromptMode?: AgentPromptMode;
  basePromptPath?: string;
  layoutStyle?: LayoutStyleKey;
  colorStyle?: ColorStyleKey;
  pageGenerationMode?: LlmConfig["pageGenerationMode"];
  signal?: AbortSignal;
  onProgress?: (event: WorkflowProgressEvent) => void;
};

function pageFileStem(pageNumber: number): string {
  return `page-${String(pageNumber).padStart(3, "0")}`;
}

function normalizeSlideId(pageNumber: number, graph: SceneGraph): SceneGraph {
  const normalizedGraph = decodeSceneGraphFromParsedValue(graph, false).graph;
  return {
    ...normalizedGraph,
    slide: {
      ...normalizedGraph.slide,
      id: pageFileStem(pageNumber),
    },
  };
}

function buildWorkflowOutputDir(inputPath: string): string {
  const name = path.parse(inputPath).name;
  return path.resolve(process.cwd(), "output", name);
}

function buildPreview(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 120);
}

function hashPageContent(content: string): string {
  return createHash("sha256").update(content.trim(), "utf8").digest("hex");
}

function hashPromptContent(content: string): string {
  return createHash("sha256").update(content.trim(), "utf8").digest("hex");
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function writeTextFile(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

async function writePageDiagnostic(
  diagnosticPath: string,
  record: WorkflowPageRecord,
  options: {
    finalSceneGraphJsonPath: string;
    htmlPreviewPath: string;
    pptxOutputPath?: string;
    canvas?: { width: number; height: number };
  },
): Promise<void> {
  await writeJsonFile(diagnosticPath, {
    pageNumber: record.pageNumber,
    canvas: options.canvas,
    rawLlmResponsePath: record.rawResponsePath,
    rawLlmJsonPath: record.rawJsonPath,
    finalSceneGraphJsonPath: options.finalSceneGraphJsonPath,
    htmlPreviewPath: options.htmlPreviewPath,
    pptxOutputPath: options.pptxOutputPath,
    autoLayoutApplied: Boolean(record.autoLayoutApplied),
    layoutRefinementApplied: Boolean(record.layoutRefinementApplied),
    layoutRefinementChanges: record.layoutRefinementChanges ?? [],
    layoutQualityWarningsReportOnly: record.qualityWarnings ?? [],
    exportSafetyHardErrors: record.exportSafetyHardErrors ?? [],
    normalizationChanges: record.normalizationChanges ?? [],
    normalizationLostTextCount: record.normalizationLostTextCount ?? 0,
    normalizationLostTextElementIds: record.normalizationLostTextElementIds ?? [],
    detailsPendingCount: record.detailsPendingCount ?? 0,
  });
}

async function waitForStepDelay(
  pageNumber: number,
  totalPages: number,
  delayMs: number,
  reason: string,
  signal?: AbortSignal,
): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  console.log(`[Page ${pageNumber}/${totalPages}] waiting ${delayMs}ms ${reason}.`);
  await delay(delayMs, signal);
}

function buildFlexibleSceneGraphInput(pageContent: string): string {
  return pageContent.trim();
}

function buildDirectPlaceholderPagePlan(pageContent: string): PagePlan {
  const title = compactPageLines(pageContent)[0] ?? "Single page";
  return {
    version: "page-plan/v1",
    page: {
      title,
      pageType: "content",
      layoutFamily: "stacked-sections",
      visualRichness: "normal",
      requiresVisualAid: false,
      pptxCriticality: "normal",
      densityClass: "balanced",
      headerReservePx: 0,
      footerReservePx: 0,
      maxTopOccupancyRatio: 1,
      visualAidBudget: "minimal",
      regionMinTextAreaRatio: 0,
      preserveDetails: true,
      maxRegions: 1,
      avoidPatterns: [],
      regions: [],
    },
  };
}

function compactPageLines(pageContent: string): string[] {
  return pageContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && line !== "---");
}

function stripBulletPrefix(line: string): string {
  return line.replace(/^[-*•·]\s*/, "").replace(/^[0-9]+[.)、]\s*/, "").trim();
}

function truncateText(text: string | undefined, maxLength: number): string {
  const compact = (text ?? "").replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function buildCompactHeading(text: string | undefined, maxLength: number): string {
  const compact = stripBulletPrefix(text ?? "").replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  const segments = compact
    .split(/[：:；;。！？?!，,、]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 4);
  const heading = segments[0] || compact;
  return truncateText(heading, maxLength);
}

function uniqueStrings(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const normalized = truncateText(stripBulletPrefix(item), 120);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) {
      break;
    }
  }
  return output;
}

function collectPlanAnchors(pagePlan: PagePlan, pageContent: string): string[] {
  return uniqueStrings(
    [
      ...(pagePlan.page.keyMessage ? [pagePlan.page.keyMessage] : []),
      ...(pagePlan.page.objective ? [pagePlan.page.objective] : []),
      ...pagePlan.page.regions.flatMap((region) => region.sourceSignals),
      ...compactPageLines(pageContent),
    ],
    24,
  );
}

function normalizeComparableText(text: string | undefined): string {
  return (text ?? "")
    .replace(/\s+/g, " ")
    .replace(/[，。；：、,.!?！？:;·"'“”‘’（）()【】\[\]-]/g, "")
    .trim()
    .toLowerCase();
}

function collectUsedGraphTexts(graph: SceneGraph): Set<string> {
  const used = new Set<string>();
  for (const element of graph.slide.elements) {
    switch (element.type) {
      case "title":
      case "text":
        used.add(normalizeComparableText(element.content.text));
        break;
      case "bulletList":
        for (const item of element.content.items) {
          used.add(normalizeComparableText(item));
        }
        break;
      case "frameworkRail":
        used.add(normalizeComparableText(element.content.title));
        used.add(normalizeComparableText(element.content.summary));
        for (const item of element.content.bullets ?? []) {
          used.add(normalizeComparableText(item));
        }
        for (const item of element.content.footerItems ?? []) {
          used.add(normalizeComparableText(item));
        }
        break;
      case "summaryBand":
        used.add(normalizeComparableText(element.content.title));
        used.add(normalizeComparableText(element.content.emphasis));
        for (const item of element.content.items) {
          used.add(normalizeComparableText(item));
        }
        break;
      case "objectiveBand":
        used.add(normalizeComparableText(element.content.text));
        used.add(normalizeComparableText(element.content.emphasis));
        break;
      case "actionCardGroup":
        used.add(normalizeComparableText(element.content.title));
        for (const item of element.content.items) {
          used.add(normalizeComparableText(item.title));
          used.add(normalizeComparableText(item.body));
          used.add(normalizeComparableText(item.emphasis));
        }
        break;
      case "callout":
        used.add(normalizeComparableText(element.content.title));
        used.add(normalizeComparableText(element.content.text));
        break;
      default:
        break;
    }
  }
  used.delete("");
  return used;
}

function pickUnusedAnchors(
  anchors: string[],
  used: Set<string>,
  limit: number,
  minLength = 8,
): string[] {
  const picked: string[] = [];
  for (const anchor of anchors) {
    const normalized = normalizeComparableText(anchor);
    if (!normalized || normalized.length < minLength || used.has(normalized)) {
      continue;
    }
    picked.push(anchor);
    used.add(normalized);
    if (picked.length >= limit) {
      break;
    }
  }
  return picked;
}

function infuseDetailIntoGraph(graph: SceneGraph, pagePlan: PagePlan, pageContent: string): { graph: SceneGraph; changes: string[] } {
  const infused = typeof structuredClone === "function"
    ? structuredClone(graph) as SceneGraph
    : JSON.parse(JSON.stringify(graph)) as SceneGraph;
  const changes: string[] = [];
  const anchors = collectPlanAnchors(pagePlan, pageContent);
  const used = collectUsedGraphTexts(infused);

  for (const element of infused.slide.elements) {
    if (element.type === "frameworkRail") {
      const bulletCapacity = element.h >= 180 ? 4 : 3;
      const existingBullets = [...(element.content.bullets ?? [])];
      if (existingBullets.length < bulletCapacity) {
        const additions = pickUnusedAnchors(anchors, used, bulletCapacity - existingBullets.length);
        if (additions.length > 0) {
          element.content.bullets = existingBullets.concat(additions);
          changes.push(`infused ${additions.length} supporting bullets into frameworkRail "${element.id}"`);
        }
      }
      if ((!element.content.summary || element.content.summary.length < 26) && element.h >= 170) {
        const [summary] = pickUnusedAnchors(anchors, used, 1, 12);
        if (summary) {
          element.content.summary = truncateText(summary, 120);
          changes.push(`strengthened frameworkRail summary for "${element.id}"`);
        }
      }
    }

    if (element.type === "actionCardGroup") {
      const itemCapacity = element.h >= 220 ? 4 : 3;
      if (element.content.items.length < itemCapacity) {
        const additions = pickUnusedAnchors(anchors, used, itemCapacity - element.content.items.length, 10);
        if (additions.length > 0) {
          for (const addition of additions) {
            element.content.items.push({
              step: String(element.content.items.length + 1).padStart(2, "0"),
              title: buildCompactHeading(addition, 18) || `Action ${element.content.items.length + 1}`,
              body: truncateText(addition, 72),
              weight: "regular",
              tone: "default",
            });
          }
          changes.push(`infused ${additions.length} extra action items into "${element.id}"`);
        }
      }
      for (const item of element.content.items) {
        if (!item.title || item.title.length > 22 || item.title === item.body) {
          item.title = buildCompactHeading(item.body || item.title, 18) || item.title;
        }
        if (item.body.length < 24 && item.title && item.title !== item.body) {
          item.body = truncateText(`${item.title}：${item.body}`, 72);
        }
        if ((!item.emphasis || item.emphasis.length < 8) && element.h >= 180) {
          const [emphasis] = pickUnusedAnchors(anchors, used, 1, 8);
          if (emphasis) {
            item.emphasis = truncateText(emphasis, 26);
            changes.push(`added emphasis cue to action card "${element.id}:${item.title}"`);
          }
        }
      }
    }

    if (element.type === "summaryBand") {
      const itemCapacity = element.h >= 96 ? 4 : 3;
      if (element.content.items.length < itemCapacity) {
        const additions = pickUnusedAnchors(anchors, used, itemCapacity - element.content.items.length, 8);
        if (additions.length > 0) {
          element.content.items = element.content.items.concat(additions);
          changes.push(`infused ${additions.length} summary chips into "${element.id}"`);
        }
      }
      if (!element.content.emphasis && element.h >= 90) {
        const [emphasis] = pickUnusedAnchors(anchors, used, 1, 10);
        if (emphasis) {
          element.content.emphasis = truncateText(emphasis, 72);
          changes.push(`added summary emphasis to "${element.id}"`);
        }
      }
    }

    if (element.type === "bulletList") {
      const itemCapacity = element.h >= 220 ? 6 : element.h >= 160 ? 5 : 4;
      if (element.content.items.length < itemCapacity) {
        const additions = pickUnusedAnchors(anchors, used, itemCapacity - element.content.items.length, 10);
        if (additions.length > 0) {
          element.content.items = element.content.items.concat(additions);
          changes.push(`infused ${additions.length} bullet details into "${element.id}"`);
        }
      }
    }
  }

  return { graph: infused, changes };
}

async function loadPageContents(inputPath: string): Promise<{
  pages: string[];
  feedbackMessage?: string;
  parsedDebug?: ParsedPptCommand;
}> {
  const ext = path.extname(inputPath).toLowerCase();

  if (ext === ".txt" || ext === ".md") {
    const rawMessage = await readFile(inputPath, "utf8");
    const parsed = parseDoPptCommandMessage(rawMessage);
    return {
      pages: buildLlmPageContents(parsed),
      feedbackMessage: parsed.feedbackMessage,
      parsedDebug: parsed,
    };
  }

  if (ext === ".json") {
    const rawJson = await readFile(inputPath, "utf8");
    const parsed = JSON.parse(rawJson) as unknown;

    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return { pages: parsed };
    }

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "pages" in parsed &&
      Array.isArray((parsed as { pages: unknown }).pages) &&
      (parsed as { pages: unknown[] }).pages.every((item) => typeof item === "string")
    ) {
      return { pages: (parsed as { pages: string[] }).pages };
    }

    throw new Error("JSON input must be a string array of page contents.");
  }

  throw new Error("build-deck input must be .txt, .md, or .json.");
}

async function saveParsedInputs(
  outputDir: string,
  pages: string[],
  parsedDebug?: ParsedPptCommand,
): Promise<{ pagesPath?: string; pagesDebugPath?: string }> {
  const outputPagesPath = path.join(outputDir, "pages.json");
  await writeJsonFile(outputPagesPath, pages);

  let outputPagesDebugPath: string | undefined;
  if (parsedDebug) {
    outputPagesDebugPath = path.join(outputDir, "pages.debug.json");
    await writeJsonFile(outputPagesDebugPath, parsedDebug);
  }

  return {
    pagesPath: outputPagesPath,
    pagesDebugPath: outputPagesDebugPath,
  };
}

async function writeManifest(outputDir: string, manifest: WorkflowManifest): Promise<void> {
  await writeJsonFile(path.join(outputDir, "manifest.json"), manifest);
}

async function fileExists(filePath: string | undefined): Promise<boolean> {
  if (!filePath) {
    return false;
  }

  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function loadPromptFromPathOrDefault(filePath: string | undefined, fallback: () => Promise<string>): Promise<string> {
  if (!filePath) {
    return fallback();
  }
  const raw = await readFile(path.resolve(process.cwd(), filePath), "utf8");
  const fencedMatch = raw.match(/```text\s*([\s\S]*?)```/i);
  return (fencedMatch?.[1] ?? raw).trim();
}

async function loadWorkflowAgentPrompt(options: {
  agentPromptPath?: string;
  agentPromptMode?: AgentPromptMode;
  basePromptPath?: string;
  layoutStyle?: LayoutStyleKey;
  colorStyle?: ColorStyleKey;
  pageGenerationMode?: LlmConfig["pageGenerationMode"];
} = {}): Promise<{
  agentPrompt: string;
  promptPath: string;
  promptPaths: string[];
  agentPromptMode: AgentPromptMode;
  basePromptPath: string;
  layoutStyle: LayoutStyleKey;
  colorStyle: ColorStyleKey;
}> {
  if (options.pageGenerationMode === "singlePageDirect") {
    const promptFile = "prompts/agent-single-page-direct.md";
    const colorStyle = options.colorStyle ?? "warm-orange";
    const colorPromptFile = COLOR_STYLE_PROMPTS[colorStyle].path ?? "prompts/color-warm-orange.md";
    const prompt = [
      await loadPromptFromPathOrDefault(promptFile, () => loadPromptFromPathOrDefault("AGENT_PROMPT.md", async () => "")),
      await loadPromptFromPathOrDefault(colorPromptFile, async () => ""),
    ].filter(Boolean).join("\n\n");
    return {
      agentPrompt: prompt,
      promptPath: `composed:${promptFile}+${colorPromptFile}`,
      promptPaths: [promptFile, colorPromptFile].map((item) => path.resolve(process.cwd(), item)),
      agentPromptMode: options.agentPromptMode ?? "custom",
      basePromptPath: options.basePromptPath ?? "",
      layoutStyle: options.layoutStyle ?? "consulting",
      colorStyle,
    };
  }

  const composed = await loadComposedAgentPrompt({
    agentPromptPath: options.agentPromptPath,
    agentPromptMode: options.agentPromptMode,
    basePromptPath: options.basePromptPath,
    layoutStyle: options.layoutStyle,
    colorStyle: options.colorStyle,
  });
  return {
    agentPrompt: composed.prompt,
    promptPath: composed.promptParts.agentPromptMode === "custom"
      ? path.resolve(process.cwd(), composed.promptParts.agentPromptPath)
      : `composed:${composed.promptPaths.join("+")}`,
    promptPaths: composed.promptPaths.map((promptPath) => path.resolve(process.cwd(), promptPath)),
    agentPromptMode: composed.promptParts.agentPromptMode,
    basePromptPath: composed.promptParts.basePromptPath,
    layoutStyle: composed.promptParts.layoutStyle,
    colorStyle: composed.promptParts.colorStyle,
  };
}

async function readExistingManifest(outputDir: string): Promise<WorkflowManifest | null> {
  const manifestPath = path.join(outputDir, "manifest.json");
  if (!(await fileExists(manifestPath))) {
    return null;
  }

  try {
    return await readJsonFile<WorkflowManifest>(manifestPath);
  } catch {
    return null;
  }
}

async function restoreCompletedPages(
  outputDir: string,
  inputPath: string,
  pages: string[],
  promptHash?: string,
): Promise<{
  restoredPages: WorkflowPageRecord[];
  restoredGraphs: SceneGraph[];
  restoredPptxPlans: PptxLayoutPlan[];
}> {
  const existingManifest = await readExistingManifest(outputDir);
  if (!existingManifest || !Array.isArray(existingManifest.pages) || existingManifest.pages.length === 0) {
    return { restoredPages: [], restoredGraphs: [], restoredPptxPlans: [] };
  }
  if (existingManifest.inputPath && path.resolve(existingManifest.inputPath) !== path.resolve(inputPath)) {
    return { restoredPages: [], restoredGraphs: [], restoredPptxPlans: [] };
  }
  if (promptHash && existingManifest.promptHash && existingManifest.promptHash !== promptHash) {
    return { restoredPages: [], restoredGraphs: [], restoredPptxPlans: [] };
  }

  const restoredPages: WorkflowPageRecord[] = [];
  const restoredGraphs: SceneGraph[] = [];
  const restoredPptxPlans: PptxLayoutPlan[] = [];

  for (let index = 0; index < pages.length; index += 1) {
    const expectedPageNumber = index + 1;
    const record = existingManifest.pages.find((item) => item.pageNumber === expectedPageNumber);
    if (!record || !(await fileExists(record.jsonPath))) {
      break;
    }
    const expectedHash = hashPageContent(pages[index]);
    if (record.inputHash) {
      if (record.inputHash !== expectedHash) {
        break;
      }
    } else if (record.inputPreview !== buildPreview(pages[index])) {
      break;
    }

    try {
      const graph = normalizeSlideId(expectedPageNumber, await readJsonFile<SceneGraph>(record.jsonPath));
      const html = renderSceneGraphToHtml(graph);
      await writeFile(record.htmlPath, html, "utf8");

      let pptxPlan: PptxLayoutPlan;
      if (await fileExists(record.pptxPlanPath)) {
        pptxPlan = await readJsonFile<PptxLayoutPlan>(record.pptxPlanPath);
      } else {
        const plan = await fileExists(record.planPath)
          ? await readJsonFile<PagePlan>(record.planPath)
          : buildHeuristicPagePlan(pages[index]);
        pptxPlan = existingManifest.pageGenerationMode === "singlePageDirect"
          ? buildDirectPptxLayoutPlan(graph, html)
          : buildPptxLayoutPlan(graph, plan, html);
        await writeJsonFile(record.pptxPlanPath, pptxPlan);
      }

      restoredPages.push(record);
      restoredGraphs.push(graph);
      restoredPptxPlans.push(pptxPlan);
    } catch {
      break;
    }
  }

  return { restoredPages, restoredGraphs, restoredPptxPlans };
}

async function exportDeckArtifacts(
  outputDir: string,
  deckName: string,
  sceneGraphs: SceneGraph[],
  pptxPlans: PptxLayoutPlan[],
  suffix = "",
): Promise<{ htmlPath: string; pptxPath: string }> {
  const htmlPath = await exportDeckHtmlArtifact(outputDir, deckName, sceneGraphs, suffix);
  const pptxPath = await exportDeckPptxArtifact(outputDir, deckName, sceneGraphs, pptxPlans, suffix);
  return { htmlPath, pptxPath };
}

async function exportDeckHtmlArtifact(
  outputDir: string,
  deckName: string,
  sceneGraphs: SceneGraph[],
  suffix = "",
): Promise<string> {
  const htmlPath = path.join(outputDir, `${deckName}${suffix}.html`);
  await writeFile(htmlPath, renderSceneGraphsToHtml(sceneGraphs, deckName), "utf8");
  return htmlPath;
}

async function exportDeckPptxArtifact(
  outputDir: string,
  deckName: string,
  sceneGraphs: SceneGraph[],
  pptxPlans: PptxLayoutPlan[],
  suffix = "",
): Promise<string> {
  const pptxPath = path.join(outputDir, `${deckName}${suffix}.pptx`);
  await exportSceneGraphsToPptxFile(sceneGraphs, pptxPath, pptxPlans);
  return pptxPath;
}

type ValidatedSceneGraphResult = {
  graph: SceneGraph;
  html: string;
  pptxPlan: PptxLayoutPlan;
  acceptedWithWarnings: boolean;
  qualityWarnings: string[];
  blockingFailures: string[];
  exportSafetyHardErrors: string[];
};

function validateSceneGraphForFlow(
  densitySource: string,
  pagePlan: PagePlan,
  graph: SceneGraph,
  config: LlmConfig,
): ValidatedSceneGraphResult {
  const effectiveGraph = graph;
  const previewHtml = renderSceneGraphToHtml(effectiveGraph);
  const sceneSafety = evaluateSceneGraphExportSafety(effectiveGraph);
  if (!sceneSafety.ok) {
    throw new Error(sceneSafety.reason);
  }

  const coverage = evaluatePageContentCoverage(densitySource, effectiveGraph);
  if (!coverage.ok) {
    throw new Error(`Page content coverage too low: ${coverage.reason}`);
  }

  const htmlSafety = lintRenderedHtmlForExportSafety(previewHtml);
  if (!htmlSafety.ok) {
    throw new Error(htmlSafety.reason);
  }

  const alignment = config.enablePagePlan
    ? inspectLayoutPlanAlignment(pagePlan, effectiveGraph)
    : {
      ok: true,
      fatalReasons: [],
      warningReasons: [],
      reason: undefined,
    };
  const pptxPlan = config.pageGenerationMode === "singlePageDirect"
    ? buildDirectPptxLayoutPlan(effectiveGraph, previewHtml)
    : buildPptxLayoutPlan(effectiveGraph, pagePlan, previewHtml);
  const parity = config.pageGenerationMode === "singlePageDirect"
    ? { ok: true, reason: undefined }
    : evaluatePptxParity(pagePlan, effectiveGraph, previewHtml, pptxPlan);

  const qualityWarnings: string[] = [];
  const blockingFailures: string[] = [];
  qualityWarnings.push(...alignment.fatalReasons, ...alignment.warningReasons);
  if (!parity.ok && parity.reason) {
    qualityWarnings.push(parity.reason);
  }

  return {
    graph: effectiveGraph,
    html: previewHtml,
    pptxPlan,
    acceptedWithWarnings: qualityWarnings.length > 0,
    qualityWarnings,
    blockingFailures,
    exportSafetyHardErrors: [],
  };
}

type NormalizationTextAudit = {
  lostTextCount: number;
  lostTextElementIds: string[];
  detailsPendingCount: number;
};

export type PageContentCoverageResult = {
  ok: boolean;
  missingTitle: boolean;
  missingAnchors: string[];
  insufficientBody: boolean;
  reason?: string;
};

function isLooseObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toAuditText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function collectStringLeaves(value: unknown): string[] {
  const direct = toAuditText(value);
  if (direct) {
    return [direct];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringLeaves(item));
  }
  if (isLooseObject(value)) {
    return Object.entries(value)
      .filter(([key]) => key !== "shape" && key !== "direction" && key !== "name")
      .flatMap(([, child]) => collectStringLeaves(child));
  }
  return [];
}

function expectedPageTitle(pageContent: string): string {
  const firstLine = compactPageLines(pageContent)[0] ?? "";
  return firstLine
    .replace(/^#{1,6}\s*/, "")
    .replace(/^页标题\s*[:：]\s*/, "")
    .trim();
}

function collectQuantitativeAnchors(pageContent: string): string[] {
  const patterns = [
    /\d[\d,.]*\s*(?:→|至|~|～|—|-)\s*\d[\d,.]*\s*(?:亿元|万元|%|年|人|个|家|户|名|万|亿|倍|天|月|元)?/gi,
    /\d{4,6}\.HK/gi,
    /\d[\d,.]*\s*(?:亿元|万元|%|年|人|个|家|户|名|万|亿|倍|天|月|元)/gi,
  ];
  const unique = new Map<string, string>();
  for (const pattern of patterns) {
    for (const match of pageContent.matchAll(pattern)) {
      const value = match[0].trim();
      const normalized = normalizeComparableText(value).replace(/\s+/g, "");
      if (normalized) unique.set(normalized, value);
    }
  }
  return [...unique.values()];
}

export function evaluatePageContentCoverage(pageContent: string, graph: SceneGraph): PageContentCoverageResult {
  const contentLeaves = graph.slide.elements.flatMap((element) => collectStringLeaves(element.content));
  const outputText = normalizeComparableText(contentLeaves.join(" ")).replace(/\s+/g, "");
  const title = expectedPageTitle(pageContent);
  const normalizedTitle = normalizeComparableText(title).replace(/\s+/g, "");
  const missingTitle = Boolean(normalizedTitle) && !outputText.includes(normalizedTitle);
  const missingAnchors = collectQuantitativeAnchors(pageContent)
    .filter((anchor) => !outputText.includes(normalizeComparableText(anchor).replace(/\s+/g, "")));
  const insufficientBody = contentLeaves.filter((text) => normalizeComparableText(text)).length < 2;
  const reasons = [
    ...(missingTitle ? [`missing page title: ${truncateText(title, 80)}`] : []),
    ...(missingAnchors.length > 0 ? [`missing quantitative anchors: ${missingAnchors.join(", ")}`] : []),
    ...(insufficientBody ? ["slide contains no meaningful body content"] : []),
  ];
  return {
    ok: reasons.length === 0,
    missingTitle,
    missingAnchors,
    insufficientBody,
    reason: reasons.length > 0 ? reasons.join("; ") : undefined,
  };
}

function collectRawTextContentForAudit(element: Record<string, unknown>): string[] {
  const type = typeof element.type === "string" ? element.type : "";
  if (type === "shape" || type === "line" || type === "divider" || type === "connector" || type === "section" || type === "icon") {
    return [];
  }
  const content = element.content;
  if (typeof content === "string" || typeof content === "number" || typeof content === "boolean" || Array.isArray(content)) {
    return collectStringLeaves(content);
  }
  if (!isLooseObject(content)) {
    return [];
  }
  return collectStringLeaves(content);
}

function collectGraphContentText(element: SceneElement): string {
  return collectStringLeaves(element.content).join(" ");
}

function countDetailsPending(graph: SceneGraph): number {
  return graph.slide.elements.reduce((count, element) => (
    count + collectStringLeaves(element.content).filter((text) => text.trim() === "Details pending.").length
  ), 0);
}

function auditNormalizationTextPreservation(rawJsonText: string, graph: SceneGraph): NormalizationTextAudit {
  let rawValue: unknown;
  try {
    rawValue = parseJsonWithRepair(rawJsonText).value;
  } catch {
    return {
      lostTextCount: 0,
      lostTextElementIds: [],
      detailsPendingCount: countDetailsPending(graph),
    };
  }

  const rawSlide = isLooseObject(rawValue) && isLooseObject(rawValue.slide) ? rawValue.slide : undefined;
  const rawElements = rawSlide && Array.isArray(rawSlide.elements) ? rawSlide.elements : [];
  const finalById = new Map(graph.slide.elements.map((element) => [element.id, element]));
  const lostTextElementIds = new Set<string>();
  let lostTextCount = 0;

  for (const [index, rawElement] of rawElements.entries()) {
    if (!isLooseObject(rawElement)) {
      continue;
    }
    const id = toAuditText(rawElement.id) ?? `element-${index + 1}`;
    const rawTexts = collectRawTextContentForAudit(rawElement)
      .map((text) => normalizeComparableText(text))
      .filter((text) => text.length > 0);
    if (rawTexts.length === 0) {
      continue;
    }

    const finalElement = finalById.get(id);
    const finalText = finalElement ? normalizeComparableText(collectGraphContentText(finalElement)) : "";
    for (const rawText of rawTexts) {
      if (!finalText.includes(rawText)) {
        lostTextCount += 1;
        lostTextElementIds.add(id);
      }
    }
  }

  return {
    lostTextCount,
    lostTextElementIds: [...lostTextElementIds],
    detailsPendingCount: countDetailsPending(graph),
  };
}

async function generatePagePlan(
  pageContent: string,
  pageNumber: number,
  totalPages: number,
  plannerPrompt: string,
  rawDir: string,
  config: LlmConfig,
  signal?: AbortSignal,
): Promise<{ plan: PagePlan; source: "llm" | "heuristic"; attempts: number }> {
  const missingLlmConfig = !config.apiBaseUrl || !config.apiKey || !config.model;
  if (config.mockResponsePath || missingLlmConfig) {
    console.log(
      `[Page ${pageNumber}/${totalPages}] page-plan using heuristic fallback (${config.mockResponsePath ? "mock mode" : "LLM unavailable"}).`,
    );
    return {
      plan: buildHeuristicPagePlan(pageContent),
      source: "heuristic",
      attempts: 0,
    };
  }

  let lastError = "";

  for (let attempt = 1; attempt <= config.maxRetries; attempt += 1) {
    try {
      console.log(`[Page ${pageNumber}/${totalPages}] requesting page-plan from LLM (attempt ${attempt}/${config.maxRetries})...`);
      const rawResponse = await requestPagePlanJsonText(config, plannerPrompt, pageContent, { signal });
      const rawResponsePath = path.join(rawDir, `${pageFileStem(pageNumber)}.plan.attempt-${attempt}.raw.txt`);
      await writeTextFile(rawResponsePath, rawResponse);

      const extractedJson = extractJsonPayloadFromResponse(rawResponse);
      const extractedJsonPath = path.join(rawDir, `${pageFileStem(pageNumber)}.plan.attempt-${attempt}.json.txt`);
      await writeTextFile(extractedJsonPath, extractedJson);

      const decoded = decodePagePlanFromText(extractedJson);
      if (decoded.jsonRepaired) {
        console.log(`[Page ${pageNumber}/${totalPages}] repaired page-plan JSON: ${decoded.jsonRepairNotes.join("; ")}`);
      }

      return {
        plan: decoded.plan,
        source: "llm",
        attempts: attempt,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.log(`[Page ${pageNumber}/${totalPages}] page-plan attempt ${attempt} failed: ${lastError}`);

      if (isFatalLlmErrorMessage(lastError)) {
        break;
      }

      if (attempt < config.maxRetries) {
        await waitForStepDelay(
          pageNumber,
          totalPages,
          isTransientLlmErrorMessage(lastError)
            ? Math.max(config.retryDelayMs, config.transientRetryDelayMs)
            : config.retryDelayMs,
          "after failed page-plan attempt / before retry",
          signal,
        );
      }
    }
  }

  console.log(
    `[Page ${pageNumber}/${totalPages}] page-plan falling back to heuristic planner after LLM failure: ${lastError}`,
  );
  return {
    plan: buildHeuristicPagePlan(pageContent),
    source: "heuristic",
    attempts: config.maxRetries,
  };
}

async function generateValidatedSceneGraph(
  sceneGraphInput: string,
  densitySource: string,
  pagePlan: PagePlan,
  pageNumber: number,
  totalPages: number,
  agentPrompt: string,
  rawDir: string,
  config: LlmConfig,
  signal?: AbortSignal,
): Promise<{
  graph: SceneGraph;
  html: string;
  pptxPlan: PptxLayoutPlan;
  attempts: number;
  sceneSource: "llm";
  fallbackReason?: string;
  acceptedWithWarnings: boolean;
  qualityWarnings: string[];
  blockingFailures: string[];
  refinementAttempts: number;
  rawResponsePath?: string;
  rawJsonPath?: string;
  autoLayoutApplied: boolean;
  layoutRefinementApplied: boolean;
  layoutRefinementChanges: string[];
  exportSafetyHardErrors: string[];
  normalizationChanges: string[];
  normalizationLostTextCount: number;
  normalizationLostTextElementIds: string[];
  detailsPendingCount: number;
}> {
  const missingLlmConfig = !config.apiBaseUrl || !config.apiKey || !config.model;
  if (!config.mockResponsePath && missingLlmConfig) {
    throw new Error("Scene-graph generation requires LLM_API_BASE_URL, LLM_API_KEY, and LLM_MODEL; local scene fallback is disabled.");
  }

  let lastError = "";
  let lastInvalidJson = "";
  let emptyBonusAttemptsGranted = 0;
  let layoutBonusAttemptsGranted = 0;
  let structuralBonusAttemptsGranted = 0;
  let consecutiveEmptyResponses = 0;
  let refinementAttempts = 0;
  let acceptedCandidate: ValidatedSceneGraphResult | null = null;

  for (
    let attempt = 1;
    attempt <= config.maxRetries + emptyBonusAttemptsGranted + layoutBonusAttemptsGranted + structuralBonusAttemptsGranted;
    attempt += 1
  ) {
    try {
      console.log(
        `[Page ${pageNumber}/${totalPages}] requesting scene-graph from LLM (attempt ${attempt}/${config.maxRetries + emptyBonusAttemptsGranted + layoutBonusAttemptsGranted + structuralBonusAttemptsGranted})...`,
      );
      const rawResponse = await requestSceneGraphJsonText(
        config,
        agentPrompt,
        sceneGraphInput,
        pageNumber,
        lastError && lastInvalidJson
          ? {
              previousJsonText: lastInvalidJson,
              validationError: lastError,
            }
          : undefined,
        { signal },
      );
      const rawResponsePath = path.join(rawDir, `${pageFileStem(pageNumber)}.attempt-${attempt}.raw.txt`);
      await writeTextFile(rawResponsePath, rawResponse);

      const extractedJson = extractSceneGraphJson(rawResponse);
      lastInvalidJson = extractedJson;
      const extractedJsonPath = path.join(rawDir, `${pageFileStem(pageNumber)}.attempt-${attempt}.json.txt`);
      await writeTextFile(extractedJsonPath, extractedJson);

      const autoLayoutApplied = config.pageGenerationMode !== "singlePageDirect";
      const decoded = decodeSceneGraphFromText(extractedJson, autoLayoutApplied, { canvasPreset: config.canvasPreset });
      const laidOut = normalizeSlideId(pageNumber, decoded.graph);
      const refined = config.pageGenerationMode === "singlePageDirect"
        ? { graph: laidOut, changes: [] }
        : refineSceneGraphLayout(laidOut, pagePlan, {
            mode: config.layoutFreedom === "high" ? "minimal" : "full",
          });
      const validated = validateSceneGraphForFlow(densitySource, pagePlan, refined.graph, config);
      const normalizationAudit = auditNormalizationTextPreservation(extractedJson, validated.graph);
      if (normalizationAudit.lostTextCount > 0) {
        throw new Error(
          `Normalizer dropped ${normalizationAudit.lostTextCount} raw text value(s) before export: ${normalizationAudit.lostTextElementIds.join(", ")}`,
        );
      }

      if (decoded.jsonRepaired) {
        console.log(`[Page ${pageNumber}/${totalPages}] repaired JSON syntax: ${decoded.jsonRepairNotes.join("; ")}`);
      }
      if (decoded.normalizationChanges.length > 0) {
        console.log(`[Page ${pageNumber}/${totalPages}] normalized ${decoded.normalizationChanges.length} compatibility issue(s).`);
      }
      if (refined.changes.length > 0) {
        console.log(`[Page ${pageNumber}/${totalPages}] refined layout: ${refined.changes.join("; ")}`);
      }

      consecutiveEmptyResponses = 0;
      if (validated.qualityWarnings.length === 0) {
        return {
          graph: validated.graph,
          html: validated.html,
          pptxPlan: validated.pptxPlan,
          attempts: attempt,
          sceneSource: "llm",
          acceptedWithWarnings: false,
          qualityWarnings: [],
          blockingFailures: [],
          refinementAttempts,
          rawResponsePath,
          rawJsonPath: extractedJsonPath,
          autoLayoutApplied,
          layoutRefinementApplied: refined.changes.length > 0,
          layoutRefinementChanges: refined.changes,
          exportSafetyHardErrors: validated.exportSafetyHardErrors,
          normalizationChanges: decoded.normalizationChanges,
          normalizationLostTextCount: normalizationAudit.lostTextCount,
          normalizationLostTextElementIds: normalizationAudit.lostTextElementIds,
          detailsPendingCount: normalizationAudit.detailsPendingCount,
        };
      }

      acceptedCandidate ??= validated;
      lastError = validated.qualityWarnings.join(" | ");
      console.log(
        `[Page ${pageNumber}/${totalPages}] quality warnings retained for flow completion: ${validated.qualityWarnings.join(" | ")}`,
      );

      if (config.enableQualityRetry && layoutBonusAttemptsGranted < config.layoutRefinementExtraRetries) {
        layoutBonusAttemptsGranted += 1;
        refinementAttempts += 1;
        console.log(
          `[Page ${pageNumber}/${totalPages}] quality refinement requested, granting an extra optimization retry (${layoutBonusAttemptsGranted}/${config.layoutRefinementExtraRetries}).`,
        );
        await waitForStepDelay(pageNumber, totalPages, config.retryDelayMs, "after scene-graph quality pass / before refinement retry", signal);
        continue;
      }

      return {
        graph: validated.graph,
        html: validated.html,
        pptxPlan: validated.pptxPlan,
        attempts: attempt,
        sceneSource: "llm",
        acceptedWithWarnings: true,
        qualityWarnings: validated.qualityWarnings,
        blockingFailures: validated.blockingFailures,
        refinementAttempts,
        rawResponsePath,
        rawJsonPath: extractedJsonPath,
        autoLayoutApplied,
        layoutRefinementApplied: refined.changes.length > 0,
        layoutRefinementChanges: refined.changes,
        exportSafetyHardErrors: validated.exportSafetyHardErrors,
        normalizationChanges: decoded.normalizationChanges,
        normalizationLostTextCount: normalizationAudit.lostTextCount,
        normalizationLostTextElementIds: normalizationAudit.lostTextElementIds,
        detailsPendingCount: normalizationAudit.detailsPendingCount,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.log(`[Page ${pageNumber}/${totalPages}] attempt ${attempt} failed: ${lastError}`);

      const isEmptyResponse = isEmptyResponseErrorMessage(lastError);
      consecutiveEmptyResponses = isEmptyResponse ? consecutiveEmptyResponses + 1 : 0;
      if (isFatalLlmErrorMessage(lastError)) {
        break;
      }
      if (isEmptyResponse && emptyBonusAttemptsGranted < config.emptyResponseExtraRetries) {
        emptyBonusAttemptsGranted += 1;
        console.log(
          `[Page ${pageNumber}/${totalPages}] empty response detected, granting ${config.transientRetryDelayMs}ms delayed recovery retry (${emptyBonusAttemptsGranted}/${config.emptyResponseExtraRetries}).`,
        );
      }
      const isRecoverableStructureOrCoverageFailure =
        /^(Scene-graph response invalid|Page content coverage too low|Export safety too low):/i.test(lastError);
      if (isRecoverableStructureOrCoverageFailure && structuralBonusAttemptsGranted < 1) {
        structuralBonusAttemptsGranted += 1;
        console.log(
          `[Page ${pageNumber}/${totalPages}] invalid structure or incomplete content detected, granting one corrective retry.`,
        );
      }
      if (consecutiveEmptyResponses >= 2) {
        console.log(
          `[Page ${pageNumber}/${totalPages}] repeated empty responses detected; local scene fallback is disabled, continuing retry budget.`,
        );
      }

      if (attempt < config.maxRetries + emptyBonusAttemptsGranted + layoutBonusAttemptsGranted + structuralBonusAttemptsGranted) {
        await waitForStepDelay(
          pageNumber,
          totalPages,
          isTransientLlmErrorMessage(lastError)
            ? Math.max(config.retryDelayMs, config.transientRetryDelayMs)
            : config.retryDelayMs,
          "after failed scene-graph attempt / before retry",
          signal,
        );
      }
    }
  }

  if (acceptedCandidate) {
    return {
      graph: acceptedCandidate.graph,
      html: acceptedCandidate.html,
      pptxPlan: acceptedCandidate.pptxPlan,
      attempts: config.maxRetries + emptyBonusAttemptsGranted + layoutBonusAttemptsGranted + structuralBonusAttemptsGranted,
      sceneSource: "llm",
      acceptedWithWarnings: true,
      qualityWarnings: acceptedCandidate.qualityWarnings,
      blockingFailures: acceptedCandidate.blockingFailures,
      refinementAttempts,
      autoLayoutApplied: false,
      layoutRefinementApplied: false,
      layoutRefinementChanges: [],
      exportSafetyHardErrors: acceptedCandidate.exportSafetyHardErrors,
      normalizationChanges: [],
      normalizationLostTextCount: 0,
      normalizationLostTextElementIds: [],
      detailsPendingCount: countDetailsPending(acceptedCandidate.graph),
    };
  }

  throw new Error(
    `Page ${pageNumber} failed after ${config.maxRetries + emptyBonusAttemptsGranted + layoutBonusAttemptsGranted + structuralBonusAttemptsGranted} attempts: ${lastError}`,
  );
}

export async function buildDeckFromInput(inputArg: string): Promise<{
  pageCount: number;
  outputDir: string;
  finalHtmlPath: string;
  finalPptxPath: string;
}> {
  const inputPath = path.resolve(process.cwd(), inputArg);
  const outputDir = buildWorkflowOutputDir(inputPath);
  const jsonDir = path.join(outputDir, "json");
  const htmlDir = path.join(outputDir, "html");
  const planDir = path.join(outputDir, "plan");
  const rawDir = path.join(outputDir, "raw");
  const diagnosticDir = path.join(outputDir, "diagnostics");
  const config = loadLlmConfig();
  const {
    agentPrompt,
    promptPath,
    promptPaths,
    agentPromptMode,
    basePromptPath,
    layoutStyle,
    colorStyle,
  } = await loadWorkflowAgentPrompt({
    pageGenerationMode: config.pageGenerationMode,
    colorStyle: "warm-orange",
  });
  const promptHash = hashPromptContent(agentPrompt);
  const loaded = await loadPageContents(inputPath);
  const parsedOutputs = await saveParsedInputs(outputDir, loaded.pages, loaded.parsedDebug);

  const manifest: WorkflowManifest = {
    inputPath,
    outputDir,
    pagesPath: parsedOutputs.pagesPath,
    pagesDebugPath: parsedOutputs.pagesDebugPath,
    promptPath,
    promptPaths,
    agentPromptMode,
    basePromptPath,
    layoutStyle,
    colorStyle,
    promptHash,
    model: config.mockResponsePath ? `mock:${config.mockResponsePath}` : config.model,
    pageGenerationMode: config.pageGenerationMode,
    canvasPreset: config.canvasPreset,
    pipelineMode: config.pipelineMode,
    pagePlanEnabled: config.enablePagePlan,
    qualityRetryEnabled: config.enableQualityRetry,
    layoutQualityReportOnly: true,
    parityEnforced: config.enforcePptxParity,
    stepDelayMs: config.stepDelayMs,
    successStepDelayMs: config.successStepDelayMs,
    retryDelayMs: config.retryDelayMs,
    pageDelayMs: config.pageDelayMs,
    pageCount: loaded.pages.length,
    startedAt: new Date().toISOString(),
    pages: [],
  };

  await mkdir(jsonDir, { recursive: true });
  await mkdir(htmlDir, { recursive: true });
  await mkdir(planDir, { recursive: true });
  await mkdir(rawDir, { recursive: true });
  await mkdir(diagnosticDir, { recursive: true });
  const restored = await restoreCompletedPages(outputDir, inputPath, loaded.pages, promptHash);
  if (restored.restoredPages.length > 0) {
    if (restored.restoredPages.length >= loaded.pages.length) {
      console.log(`[Build] reusing all ${restored.restoredPages.length} completed page(s) and regenerating final artifacts.`);
    } else {
      console.log(
        `[Build] resuming from page ${restored.restoredPages.length + 1}/${loaded.pages.length}; reusing ${restored.restoredPages.length} completed page(s).`,
      );
    }
    manifest.pages = restored.restoredPages;
    manifest.resumedAt = new Date().toISOString();
    manifest.reusedPageCount = restored.restoredPages.length;
  }

  await writeManifest(outputDir, manifest);

  const sceneGraphs: SceneGraph[] = [...restored.restoredGraphs];
  const pptxPlans: PptxLayoutPlan[] = [...restored.restoredPptxPlans];

  try {
    for (let index = sceneGraphs.length; index < loaded.pages.length; index += 1) {
      const pageNumber = index + 1;
      const pageContent = loaded.pages[index];
      const { plan, source: planSource, attempts: planAttempts } = config.pageGenerationMode === "singlePageDirect"
        ? {
            plan: buildDirectPlaceholderPagePlan(pageContent),
            source: "direct" as const,
            attempts: 0,
          }
        : {
            plan: buildHeuristicPagePlan(pageContent),
            source: "heuristic" as const,
            attempts: 0,
          };
      const planPath = path.join(planDir, `${pageFileStem(pageNumber)}.plan.json`);
      await writeJsonFile(planPath, plan);

      const sceneGraphInput = buildFlexibleSceneGraphInput(pageContent);
      const {
        graph,
        html,
        pptxPlan,
        attempts,
        sceneSource,
        fallbackReason,
        acceptedWithWarnings,
        qualityWarnings,
        blockingFailures,
        refinementAttempts,
        rawResponsePath,
        rawJsonPath,
        autoLayoutApplied,
        layoutRefinementApplied,
        layoutRefinementChanges,
        exportSafetyHardErrors,
        normalizationChanges,
        normalizationLostTextCount,
        normalizationLostTextElementIds,
        detailsPendingCount,
      } = await generateValidatedSceneGraph(
        sceneGraphInput,
        pageContent,
        plan,
        pageNumber,
        loaded.pages.length,
        agentPrompt,
        rawDir,
        config,
      );
      await waitForStepDelay(pageNumber, loaded.pages.length, config.successStepDelayMs, "after scene-graph step / before persisting page");
      const jsonPath = path.join(jsonDir, `${pageFileStem(pageNumber)}.json`);
      const htmlPath = path.join(htmlDir, `${pageFileStem(pageNumber)}.html`);
      const pptxPlanPath = path.join(planDir, `${pageFileStem(pageNumber)}.pptx-plan.json`);
      const diagnosticPath = path.join(diagnosticDir, `${pageFileStem(pageNumber)}.diagnostic.json`);

      await writeJsonFile(jsonPath, graph);
      await writeJsonFile(pptxPlanPath, pptxPlan);
      await mkdir(path.dirname(htmlPath), { recursive: true });
      await writeFile(htmlPath, html, "utf8");

      console.log(`[Page ${pageNumber}/${loaded.pages.length}] scene-graph validated in ${attempts} attempt(s).`);

      const record: WorkflowPageRecord = {
        pageNumber,
        pageIndex: pageNumber - 1,
        status: "json_valid",
        pptxPageStatus: "json_valid",
        inputPreview: buildPreview(pageContent),
        planPath,
        pptxPlanPath,
        planSource,
        planAttempts,
        jsonPath,
        finalJsonPath: jsonPath,
        htmlPath,
        rawResponsePath,
        rawJsonPath,
        diagnosticPath,
        inputHash: hashPageContent(pageContent),
        attempts,
        sceneSource,
        fallbackReason,
        acceptedWithWarnings,
        warnings: qualityWarnings,
        qualityWarnings,
        blockingFailures,
        refinementAttempts,
        autoLayoutApplied,
        layoutRefinementApplied,
        layoutRefinementChanges,
        exportSafetyHardErrors,
        normalizationChanges,
        normalizationLostTextCount,
        normalizationLostTextElementIds,
        detailsPendingCount,
      };
      await writePageDiagnostic(diagnosticPath, record, {
        finalSceneGraphJsonPath: jsonPath,
        htmlPreviewPath: htmlPath,
        canvas: { width: graph.slide.width, height: graph.slide.height },
      });
      manifest.pages.push(record);
      await writeManifest(outputDir, manifest);

      sceneGraphs.push(graph);
      pptxPlans.push(pptxPlan);

      if (index < loaded.pages.length - 1) {
        await waitForStepDelay(pageNumber, loaded.pages.length, config.pageDelayMs, "before next page");
      }
    }

    const deckName = path.parse(inputPath).name;
    const { htmlPath: finalHtmlPath, pptxPath: finalPptxPath } = await exportDeckArtifacts(
      outputDir,
      deckName,
      sceneGraphs,
      pptxPlans,
    );

    manifest.finalHtmlPath = finalHtmlPath;
    manifest.finalPptxPath = finalPptxPath;
    manifest.completedAt = new Date().toISOString();
    manifest.pages = manifest.pages.map((record) => ({
      ...record,
      status: "pptx_exported",
      pptxPageStatus: "pptx_exported",
      finalJsonPath: record.finalJsonPath ?? record.jsonPath,
    }));
    await Promise.all(manifest.pages.map((record) =>
      record.diagnosticPath
        ? writePageDiagnostic(record.diagnosticPath, record, {
          finalSceneGraphJsonPath: record.jsonPath,
          htmlPreviewPath: record.htmlPath,
          pptxOutputPath: finalPptxPath,
        })
        : Promise.resolve()
    ));
    await writeManifest(outputDir, manifest);

    return {
      pageCount: loaded.pages.length,
      outputDir,
      finalHtmlPath,
      finalPptxPath,
    };
  } catch (error) {
    manifest.failedAt = new Date().toISOString();
    manifest.failedPageNumber = manifest.pages.length + 1;
    manifest.errorMessage = error instanceof Error ? error.message : String(error);
    const deckName = path.parse(inputPath).name;
    if (sceneGraphs.length > 0) {
      try {
        const partial = await exportDeckArtifacts(outputDir, deckName, sceneGraphs, pptxPlans, ".partial");
        manifest.partialHtmlPath = partial.htmlPath;
        manifest.partialPptxPath = partial.pptxPath;
      } catch (partialError) {
        console.log(`[Build] failed to export partial deck artifacts: ${partialError instanceof Error ? partialError.message : String(partialError)}`);
      }
    }
    await writeManifest(outputDir, manifest);
    throw error;
  }
}

function sanitizeDeckName(value: string | undefined): string {
  const cleaned = (value ?? "").trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || `deck-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Operation aborted.");
  }
}

export async function buildDeckHtmlFromPages(
  pages: string[],
  options: BuildDeckHtmlOptions = {},
): Promise<{
  pageCount: number;
  outputDir: string;
  finalHtmlPath: string;
  manifestPath: string;
  failedPageNumber?: number;
  errorMessage?: string;
  partialHtmlPath?: string;
}> {
  const deckName = sanitizeDeckName(options.deckName);
  const outputDir = options.outputDir ?? path.resolve(process.cwd(), "output", deckName);
  const jsonDir = path.join(outputDir, "json");
  const htmlDir = path.join(outputDir, "html");
  const planDir = path.join(outputDir, "plan");
  const rawDir = path.join(outputDir, "raw");
  const diagnosticDir = path.join(outputDir, "diagnostics");
  const config = loadLlmConfig(options.config);
  const {
    agentPrompt,
    promptPath,
    promptPaths,
    agentPromptMode,
    basePromptPath,
    layoutStyle,
    colorStyle,
  } = await loadWorkflowAgentPrompt({
    agentPromptPath: options.agentPromptPath,
    agentPromptMode: options.agentPromptMode,
    basePromptPath: options.basePromptPath,
    layoutStyle: options.layoutStyle,
    colorStyle: options.colorStyle,
    pageGenerationMode: config.pageGenerationMode,
  });
  const promptHash = hashPromptContent(agentPrompt);
  const inputPath = path.join(outputDir, `${deckName}.pages.json`);

  assertNotAborted(options.signal);

  const parsedOutputs = await saveParsedInputs(outputDir, pages);
  await mkdir(jsonDir, { recursive: true });
  await mkdir(htmlDir, { recursive: true });
  await mkdir(planDir, { recursive: true });
  await mkdir(rawDir, { recursive: true });
  await mkdir(diagnosticDir, { recursive: true });

  const restored = await restoreCompletedPages(outputDir, inputPath, pages, promptHash);

  const manifest: WorkflowManifest = {
    inputPath,
    outputDir,
    pagesPath: parsedOutputs.pagesPath,
    promptPath,
    promptPaths,
    agentPromptMode,
    basePromptPath,
    layoutStyle,
    colorStyle,
    promptHash,
    model: config.mockResponsePath ? `mock:${config.mockResponsePath}` : config.model,
    pageGenerationMode: config.pageGenerationMode,
    canvasPreset: config.canvasPreset,
    pipelineMode: config.pipelineMode,
    pagePlanEnabled: config.enablePagePlan,
    qualityRetryEnabled: config.enableQualityRetry,
    layoutQualityReportOnly: true,
    parityEnforced: config.enforcePptxParity,
    stepDelayMs: config.stepDelayMs,
    successStepDelayMs: config.successStepDelayMs,
    retryDelayMs: config.retryDelayMs,
    pageDelayMs: config.pageDelayMs,
    pageCount: pages.length,
    startedAt: new Date().toISOString(),
    pages: restored.restoredPages,
  };
  if (restored.restoredPages.length > 0) {
    manifest.resumedAt = new Date().toISOString();
    manifest.reusedPageCount = restored.restoredPages.length;
    manifest.finalHtmlPath = undefined;
    manifest.finalPptxPath = undefined;
    manifest.partialHtmlPath = undefined;
    manifest.partialPptxPath = undefined;
    manifest.failedAt = undefined;
    manifest.failedPageNumber = undefined;
    manifest.errorMessage = undefined;
  }

  await writeManifest(outputDir, manifest);
  options.onProgress?.({ type: "started", pageCount: pages.length, outputDir });

  const sceneGraphs: SceneGraph[] = [...restored.restoredGraphs];
  const pptxPlans: PptxLayoutPlan[] = [...restored.restoredPptxPlans];
  for (const record of restored.restoredPages) {
    options.onProgress?.({
      type: "page-complete",
      pageNumber: record.pageNumber,
      totalPages: pages.length,
      htmlPath: record.htmlPath,
      jsonPath: record.jsonPath,
      message: `第 ${record.pageNumber} 页已复用，继续生成后续页面`,
    });
  }

  try {
    for (let index = sceneGraphs.length; index < pages.length; index += 1) {
      assertNotAborted(options.signal);
      const pageNumber = index + 1;
      const pageContent = pages[index];
      options.onProgress?.({
        type: "page-start",
        pageNumber,
        totalPages: pages.length,
        message: `正在生成第 ${pageNumber}/${pages.length} 页`,
      });

      const { plan, source: planSource, attempts: planAttempts } = config.pageGenerationMode === "singlePageDirect"
        ? {
            plan: buildDirectPlaceholderPagePlan(pageContent),
            source: "direct" as const,
            attempts: 0,
          }
        : {
            plan: buildHeuristicPagePlan(pageContent),
            source: "heuristic" as const,
            attempts: 0,
          };

      const planPath = path.join(planDir, `${pageFileStem(pageNumber)}.plan.json`);
      await writeJsonFile(planPath, plan);
      const sceneGraphInput = buildFlexibleSceneGraphInput(pageContent);
      const result = await generateValidatedSceneGraph(
        sceneGraphInput,
        pageContent,
        plan,
        pageNumber,
        pages.length,
        agentPrompt,
        rawDir,
        config,
        options.signal,
      );

      await waitForStepDelay(
        pageNumber,
        pages.length,
        config.successStepDelayMs,
        "after scene-graph step / before persisting page",
        options.signal,
      );

      const jsonPath = path.join(jsonDir, `${pageFileStem(pageNumber)}.json`);
      const htmlPath = path.join(htmlDir, `${pageFileStem(pageNumber)}.html`);
      const pptxPlanPath = path.join(planDir, `${pageFileStem(pageNumber)}.pptx-plan.json`);
      const diagnosticPath = path.join(diagnosticDir, `${pageFileStem(pageNumber)}.diagnostic.json`);

      await writeJsonFile(jsonPath, result.graph);
      await writeJsonFile(pptxPlanPath, result.pptxPlan);
      await writeTextFile(htmlPath, result.html);

      const record: WorkflowPageRecord = {
        pageNumber,
        pageIndex: pageNumber - 1,
        status: "json_valid",
        pptxPageStatus: "json_valid",
        inputPreview: buildPreview(pageContent),
        planPath,
        pptxPlanPath,
        planSource,
        planAttempts,
        jsonPath,
        finalJsonPath: jsonPath,
        htmlPath,
        rawResponsePath: result.rawResponsePath,
        rawJsonPath: result.rawJsonPath,
        diagnosticPath,
        inputHash: hashPageContent(pageContent),
        attempts: result.attempts,
        sceneSource: result.sceneSource,
        fallbackReason: result.fallbackReason,
        acceptedWithWarnings: result.acceptedWithWarnings,
        warnings: result.qualityWarnings,
        qualityWarnings: result.qualityWarnings,
        blockingFailures: result.blockingFailures,
        refinementAttempts: result.refinementAttempts,
        autoLayoutApplied: result.autoLayoutApplied,
        layoutRefinementApplied: result.layoutRefinementApplied,
        layoutRefinementChanges: result.layoutRefinementChanges,
        exportSafetyHardErrors: result.exportSafetyHardErrors,
        normalizationChanges: result.normalizationChanges,
        normalizationLostTextCount: result.normalizationLostTextCount,
        normalizationLostTextElementIds: result.normalizationLostTextElementIds,
        detailsPendingCount: result.detailsPendingCount,
      };
      await writePageDiagnostic(diagnosticPath, record, {
        finalSceneGraphJsonPath: jsonPath,
        htmlPreviewPath: htmlPath,
        canvas: { width: result.graph.slide.width, height: result.graph.slide.height },
      });
      manifest.pages.push(record);
      await writeManifest(outputDir, manifest);

      sceneGraphs.push(result.graph);
      pptxPlans.push(result.pptxPlan);

      options.onProgress?.({
        type: "page-complete",
        pageNumber,
        totalPages: pages.length,
        htmlPath,
        jsonPath,
        message: `第 ${pageNumber} 页生成完成`,
      });

      if (index < pages.length - 1) {
        await waitForStepDelay(pageNumber, pages.length, config.pageDelayMs, "before next page", options.signal);
      }
    }

    const finalHtmlPath = await exportDeckHtmlArtifact(outputDir, deckName, sceneGraphs);
    manifest.finalHtmlPath = finalHtmlPath;
    manifest.completedAt = new Date().toISOString();
    await writeManifest(outputDir, manifest);
    options.onProgress?.({
      type: "html-complete",
      pageCount: pages.length,
      finalHtmlPath,
      outputDir,
      message: "页面预览已生成，正在准备 PPTX 导出",
    });

    return {
      pageCount: pages.length,
      outputDir,
      finalHtmlPath,
      manifestPath: path.join(outputDir, "manifest.json"),
    };
  } catch (error) {
    manifest.failedAt = new Date().toISOString();
    manifest.failedPageNumber = manifest.pages.length + 1;
    manifest.errorMessage = error instanceof Error ? error.message : String(error);
    if (sceneGraphs.length > 0) {
      try {
        manifest.partialHtmlPath = await exportDeckHtmlArtifact(outputDir, deckName, sceneGraphs, ".partial");
      } catch (partialError) {
        console.log(`[Build] failed to export partial HTML artifact: ${partialError instanceof Error ? partialError.message : String(partialError)}`);
      }
    }
    await writeManifest(outputDir, manifest);
    options.onProgress?.({
      type: "failed",
      failedPageNumber: manifest.failedPageNumber,
      outputDir,
      errorMessage: manifest.errorMessage,
      partialHtmlPath: manifest.partialHtmlPath,
      message: `生成失败：${manifest.errorMessage}`,
    });
    throw error;
  }
}

export async function exportPptxFromWorkflowOutput(outputDir: string): Promise<{
  pageCount: number;
  outputDir: string;
  finalPptxPath: string;
}> {
  const manifestPath = path.join(outputDir, "manifest.json");
  if (!(await fileExists(manifestPath))) {
    throw new Error("Workflow manifest was not found. Generate HTML before exporting PPTX.");
  }

  const manifest = await readJsonFile<WorkflowManifest>(manifestPath);
  if (!manifest.finalHtmlPath) {
    throw new Error("HTML deck is not complete yet.");
  }
  if (!(await fileExists(manifest.finalHtmlPath))) {
    throw new Error(`HTML deck file is missing: ${manifest.finalHtmlPath}`);
  }
  if (!manifest.pages.length) {
    throw new Error("No generated pages were found in the workflow manifest.");
  }

  const sourcePages = manifest.pagesPath && await fileExists(manifest.pagesPath)
    ? await readJsonFile<string[]>(manifest.pagesPath)
    : [];
  if (sourcePages.length !== manifest.pageCount || manifest.pages.length !== manifest.pageCount) {
    throw new Error(
      `PPTX export blocked: expected ${manifest.pageCount} source/generated page(s), found ${sourcePages.length}/${manifest.pages.length}.`,
    );
  }

  const sceneGraphs: SceneGraph[] = [];
  const pptxPlans: PptxLayoutPlan[] = [];
  for (const record of [...manifest.pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
    try {
      if (!(await fileExists(record.jsonPath))) {
        throw new Error(`generated JSON is missing: ${record.jsonPath}`);
      }
      if (!(await fileExists(record.pptxPlanPath))) {
        throw new Error(`PPTX layout plan is missing: ${record.pptxPlanPath}`);
      }
      const graph = normalizeSlideId(record.pageNumber, await readJsonFile<SceneGraph>(record.jsonPath));
      const safety = evaluateSceneGraphExportSafety(graph);
      if (!safety.ok) {
        throw new Error(safety.reason);
      }
      const coverage = evaluatePageContentCoverage(sourcePages[record.pageNumber - 1] ?? "", graph);
      if (!coverage.ok) {
        throw new Error(`Page content coverage too low: ${coverage.reason}`);
      }
      sceneGraphs.push(graph);
      pptxPlans.push(await readJsonFile<PptxLayoutPlan>(record.pptxPlanPath));
    } catch (error) {
      manifest.finalPptxPath = undefined;
      manifest.completedAt = undefined;
      manifest.failedAt = new Date().toISOString();
      manifest.failedPageNumber = record.pageNumber;
      manifest.errorMessage = `PPTX export blocked for page ${record.pageNumber}: ${error instanceof Error ? error.message : String(error)}`;
      manifest.pages = manifest.pages.map((pageRecord) => pageRecord.pageNumber === record.pageNumber
        ? { ...pageRecord, status: "failed", pptxPageStatus: "failed" }
        : pageRecord);
      await writeManifest(outputDir, manifest);
      throw new Error(manifest.errorMessage);
    }
  }

  const deckName = path.basename(outputDir);
  const finalPptxPath = await exportDeckPptxArtifact(outputDir, deckName, sceneGraphs, pptxPlans);
  manifest.finalPptxPath = finalPptxPath;
  manifest.completedAt = new Date().toISOString();
  manifest.failedAt = undefined;
  manifest.failedPageNumber = undefined;
  manifest.errorMessage = undefined;
  manifest.pages = manifest.pages.map((record) => ({
    ...record,
    status: "pptx_exported",
    pptxPageStatus: "pptx_exported",
    finalJsonPath: record.finalJsonPath ?? record.jsonPath,
  }));
  await Promise.all(manifest.pages.map((record) =>
    record.diagnosticPath
      ? writePageDiagnostic(record.diagnosticPath, record, {
        finalSceneGraphJsonPath: record.jsonPath,
        htmlPreviewPath: record.htmlPath,
        pptxOutputPath: finalPptxPath,
      })
      : Promise.resolve()
  ));
  await writeManifest(outputDir, manifest);

  return {
    pageCount: sceneGraphs.length,
    outputDir,
    finalPptxPath,
  };
}
