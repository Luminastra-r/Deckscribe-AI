import { type PagePlan } from "./page-plan.ts";
import { type PptxLayoutPlan } from "./pptx-layout-plan.ts";
import { type SceneGraph } from "./types.ts";

export type ExportSafetyResult = {
  ok: boolean;
  reason?: string;
};

function collectStringLeaves(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringLeaves(item));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap((item) => collectStringLeaves(item));
  }
  return [];
}

const HTML_BANNED_PATTERNS: Array<[RegExp, string]> = [
  [/backdrop-filter\s*:/i, "backdrop-filter is not export-safe"],
  [/\bfilter\s*:/i, "CSS filter is not export-safe"],
  [/linear-gradient\s*\(/i, "CSS linear-gradient is not export-safe"],
  [/radial-gradient\s*\(/i, "CSS radial-gradient is not export-safe"],
  [/mix-blend-mode\s*:/i, "mix-blend-mode is not export-safe"],
  [/clip-path\s*:/i, "clip-path is not export-safe"],
  [/<foreignObject[\s>]/i, "foreignObject is not export-safe"],
];

export function evaluateSceneGraphExportSafety(graph: SceneGraph): ExportSafetyResult {
  const reasons: string[] = [];

  if (graph.slide.elements.length === 0) {
    reasons.push("slide has no elements");
  }

  const invalidGeometry = graph.slide.elements.filter((element) =>
    !Number.isFinite(element.x) || !Number.isFinite(element.y) ||
    !Number.isFinite(element.w) || !Number.isFinite(element.h) ||
    element.w <= 0 || element.h <= 0);
  if (invalidGeometry.length > 0) {
    reasons.push(`${invalidGeometry.length} element(s) have invalid geometry`);
  }

  const textElements = graph.slide.elements.filter((element) => collectStringLeaves(element.content).length > 0);
  if (textElements.length === 0) {
    reasons.push("slide has no visible text content");
  }

  const hasTitle = textElements.some((element) =>
    element.type === "title" || String(element.role).toLowerCase().includes("title"));
  if (!hasTitle) {
    reasons.push("slide has no non-empty title element");
  }

  if (reasons.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: `Export safety too low: ${reasons.join("; ")} Prefer export-safe primitives and simpler structures.`,
  };
}

export function lintRenderedHtmlForExportSafety(html: string): ExportSafetyResult {
  const reasons = HTML_BANNED_PATTERNS
    .filter(([pattern]) => pattern.test(html))
    .map(([, message]) => message);

  if (reasons.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: `Rendered HTML is not export-safe: ${reasons.join("; ")} Remove risky browser-only effects so HTML and PPTX stay aligned.`,
  };
}

export function evaluatePptxParity(
  pagePlan: PagePlan,
  graph: SceneGraph,
  html: string,
  pptxPlan: PptxLayoutPlan,
): ExportSafetyResult {
  const reasons: string[] = [];

  if (pagePlan.page.requiresVisualAid && pptxPlan.htmlSemantics.totalVisualAidSignals < (pagePlan.page.visualRichness === "high" ? 4 : 2)) {
    reasons.push("content page lacks enough visual aid signals for strong HTML/PPTX parity");
  }

  if (pagePlan.page.requiresVisualAid) {
    const primitiveCount = graph.slide.elements.filter((element) =>
      element.type === "frameworkRail" ||
      element.type === "actionCardGroup" ||
      element.type === "objectiveBand" ||
      element.type === "icon" ||
      element.type === "badge").length;
    if (primitiveCount < 2) {
      reasons.push("HTML has too little explicit visual structure for PPTX re-generation");
    }
  }

  if (pptxPlan.parityRisk === "high") {
    reasons.push("pptx-layout-plan still predicts high parity risk");
  }

  if (reasons.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: `PPTX parity too low: ${reasons.join("; ")} Add stable visual aids and exportable structural semantics before PPTX generation.`,
  };
}
