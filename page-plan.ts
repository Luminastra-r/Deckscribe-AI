import { parseJsonWithRepair } from "./json-repair.ts";

export const SUPPORTED_PAGE_TYPES = [
  "cover",
  "toc",
  "sectionDivider",
  "summary",
  "content",
] as const;

export const SUPPORTED_LAYOUT_FAMILIES = [
  "single-hero",
  "top-band-plus-grid",
  "left-rail-plus-action-grid",
  "comparison-split",
  "chart-plus-insights",
  "timeline-flow",
  "process-flow",
  "stacked-sections",
] as const;

export const SUPPORTED_REGION_KINDS = [
  "hero",
  "framework",
  "actions",
  "comparison",
  "evidence",
  "summary",
  "support",
  "details",
  "chart",
  "process",
  "timeline",
] as const;

export const SUPPORTED_REGION_PLACEMENTS = [
  "top",
  "left",
  "right",
  "center",
  "bottom",
  "main",
] as const;

export const SUPPORTED_REGION_EMPHASIS = [
  "high",
  "medium",
  "low",
] as const;

export const SUPPORTED_ELEMENT_HINTS = [
  "frameworkRail",
  "title",
  "text",
  "bulletList",
  "callout",
  "icon",
  "badge",
  "metric",
  "actionCardGroup",
  "objectiveBand",
  "pageBadge",
  "timeline",
  "process",
  "comparison",
  "insight",
  "matrix",
  "miniDiagram",
  "summaryBand",
  "funnel",
  "swimlane",
  "chart",
  "grid",
  "cardGroup",
] as const;

export type PagePlanType = (typeof SUPPORTED_PAGE_TYPES)[number];
export type PagePlanLayoutFamily = (typeof SUPPORTED_LAYOUT_FAMILIES)[number];
export type PagePlanRegionKind = (typeof SUPPORTED_REGION_KINDS)[number];
export type PagePlanRegionPlacement = (typeof SUPPORTED_REGION_PLACEMENTS)[number];
export type PagePlanRegionEmphasis = (typeof SUPPORTED_REGION_EMPHASIS)[number];
export type PagePlanElementHint = (typeof SUPPORTED_ELEMENT_HINTS)[number];

export type PagePlanRegion = {
  id: string;
  title: string;
  kind: PagePlanRegionKind;
  placement: PagePlanRegionPlacement;
  emphasis: PagePlanRegionEmphasis;
  minHeightPx: number;
  maxVisualAidSlots: number;
  iconPlacement: "inline" | "stacked" | "none";
  mustKeepTitleSingleBlock: boolean;
  suggestedElements: PagePlanElementHint[];
  sourceSignals: string[];
  notes?: string;
};

export type PagePlan = {
  version: "page-plan/v1";
  page: {
    title: string;
    pageType: PagePlanType;
    layoutFamily: PagePlanLayoutFamily;
    visualRichness: "high" | "normal";
    requiresVisualAid: boolean;
    pptxCriticality: "high" | "normal";
    densityClass: "dense" | "balanced" | "airy";
    headerReservePx: number;
    footerReservePx: number;
    maxTopOccupancyRatio: number;
    visualAidBudget: "minimal" | "standard" | "rich";
    regionMinTextAreaRatio: number;
    narrative?: string;
    keyMessage?: string;
    objective?: string;
    preserveDetails: boolean;
    maxRegions: number;
    avoidPatterns: string[];
    regions: PagePlanRegion[];
  };
};

export type PagePlanDecodeResult = {
  plan: PagePlan;
  jsonRepaired: boolean;
  jsonRepairNotes: string[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = compactText(value);
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function sanitizeString(value: unknown, fallback: string): string {
  return toTrimmedString(value) ?? fallback;
}

function sanitizeStringArray(value: unknown, limit = 8): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => toTrimmedString(item))
      .filter((item): item is string => Boolean(item))
      .slice(0, limit);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n|[;；]/)
      .map((item) => item.replace(/^\s*[-*•]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, limit);
  }

  return [];
}

function slugify(value: string): string {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return ascii || "region";
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : typeof value === "string" && value.trim()
      ? Math.round(Number(value))
      : fallback;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function normalizeEnum<T extends readonly string[]>(
  value: unknown,
  supported: T,
  fallback: T[number],
): T[number] {
  if (typeof value === "string" && supported.includes(value as T[number])) {
    return value as T[number];
  }

  return fallback;
}

function inferElementHints(kind: PagePlanRegionKind): PagePlanElementHint[] {
  switch (kind) {
    case "hero":
      return ["insight", "summaryBand", "icon"];
    case "framework":
      return ["frameworkRail", "icon", "badge"];
    case "actions":
      return ["actionCardGroup", "badge", "icon"];
    case "comparison":
      return ["comparison", "callout", "bulletList"];
    case "chart":
      return ["chart", "metric", "summaryBand"];
    case "timeline":
      return ["timeline", "bulletList", "callout"];
    case "process":
      return ["process", "callout", "summaryBand"];
    case "summary":
      return ["objectiveBand", "badge", "callout"];
    case "evidence":
      return ["bulletList", "grid", "text"];
    case "details":
      return ["bulletList", "text", "callout"];
    default:
      return ["text", "bulletList", "callout"];
  }
}

function normalizeElementHints(value: unknown, regionKind: PagePlanRegionKind): PagePlanElementHint[] {
  const source = sanitizeStringArray(value, 4)
    .filter((item): item is PagePlanElementHint => SUPPORTED_ELEMENT_HINTS.includes(item as PagePlanElementHint));

  return source.length > 0 ? source : inferElementHints(regionKind);
}

function normalizeRegion(input: unknown, index: number): PagePlanRegion {
  const source = isPlainObject(input) ? input : {};
  const kind = normalizeEnum(source.kind, SUPPORTED_REGION_KINDS, index === 0 ? "hero" : "support");
  const title = sanitizeString(source.title, index === 0 ? "Core Region" : `Region ${index + 1}`);
  const iconPlacementSource = toTrimmedString(source.iconPlacement)?.toLowerCase();
  const iconPlacement =
    iconPlacementSource === "inline" || iconPlacementSource === "stacked" || iconPlacementSource === "none"
      ? iconPlacementSource
      : kind === "actions" || kind === "details" || kind === "support"
        ? "inline"
        : "stacked";

  return {
    id: sanitizeString(source.id, slugify(title)),
    title,
    kind,
    placement: normalizeEnum(
      source.placement,
      SUPPORTED_REGION_PLACEMENTS,
      index === 0 ? "top" : "main",
    ),
    emphasis: normalizeEnum(
      source.emphasis,
      SUPPORTED_REGION_EMPHASIS,
      index === 0 ? "high" : "medium",
    ),
    minHeightPx: clampInteger(source.minHeightPx, kind === "summary" ? 112 : kind === "framework" ? 180 : 150, 96, 420),
    maxVisualAidSlots: clampInteger(source.maxVisualAidSlots, kind === "actions" ? 1 : kind === "hero" ? 2 : 1, 0, 3),
    iconPlacement,
    mustKeepTitleSingleBlock: typeof source.mustKeepTitleSingleBlock === "boolean"
      ? source.mustKeepTitleSingleBlock
      : index === 0 || kind === "framework" || kind === "actions",
    suggestedElements: normalizeElementHints(source.suggestedElements, kind),
    sourceSignals: sanitizeStringArray(source.sourceSignals, 4),
    ...(toTrimmedString(source.notes) ? { notes: sanitizeString(source.notes, "") } : {}),
  };
}

function defaultAvoidPatterns(): string[] {
  return [
    "mechanical equal-size cards",
    "large empty containers",
    "flattening all detail into one paragraph",
    "pure text-only regions with no visual aid",
    "single-color body copy with no structural accents",
  ];
}

function extractLines(pageContent: string): string[] {
  return pageContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isBulletLine(line: string): boolean {
  return /^[-*•·]\s*/.test(line) || /^[0-9]+[.)、]\s*/.test(line);
}

function stripBulletPrefix(line: string): string {
  return line.replace(/^[-*•·]\s*/, "").replace(/^[0-9]+[.)、]\s*/, "").trim();
}

function isActionLine(line: string): boolean {
  return /^(动作\s*\d+|重点动作\s*\d+|action\s*\d+)/i.test(line);
}

function isHeadingLike(line: string): boolean {
  return (
    /^[一二三四五六七八九十]+[、.]\s*/.test(line) ||
    /^第[一二三四五六七八九十0-9]+[部分章节页项]/.test(line) ||
    /^(核心目标|目标|结论|总体应对框架|关键动作|重点动作|问题诊断|应对框架)/.test(line)
  );
}

function takeInterestingLines(lines: string[], limit: number): string[] {
  return lines
    .map((line) => stripBulletPrefix(line))
    .filter(Boolean)
    .slice(0, limit);
}

function detectPageType(title: string, lines: string[]): PagePlanType {
  const combined = [title, ...lines].join(" ");
  if (/^(封面|cover)/i.test(title)) {
    return "cover";
  }
  if (/(目录|agenda|table of contents)/i.test(combined)) {
    return "toc";
  }
  if (/(总结|结论|takeaway|下一步|行动建议)/i.test(title)) {
    return "summary";
  }
  if (/^(第[一二三四五六七八九十0-9]+部分|section\s*\d+)/i.test(title)) {
    return "sectionDivider";
  }
  return "content";
}

function detectLayoutFamily(lines: string[]): PagePlanLayoutFamily {
  const actionCount = lines.filter((line) => isActionLine(line)).length;
  const comparisonSignals = lines.filter((line) => /(对比|before|after|现状|升级|旧|新)/i.test(line)).length;
  const timelineSignals = lines.filter((line) => /(阶段|里程碑|时间|季度|月份|演进|历程)/i.test(line)).length;
  const chartSignals = lines.filter((line) => /(%|同比|占比|增长|下降|数据|指标|数量)/.test(line)).length;
  const processSignals = lines.filter((line) => /(流程|步骤|闭环|路径|机制|联动)/.test(line)).length;

  if (actionCount >= 4) {
    return "left-rail-plus-action-grid";
  }
  if (comparisonSignals >= 3) {
    return "comparison-split";
  }
  if (timelineSignals >= 3) {
    return "timeline-flow";
  }
  if (chartSignals >= 3) {
    return "chart-plus-insights";
  }
  if (processSignals >= 4) {
    return "process-flow";
  }
  return "top-band-plus-grid";
}

function extractObjective(lines: string[]): string | undefined {
  const explicitObjective = lines.find((line) => /^(核心目标|总目标|目标|结论)[:：]/.test(line));
  if (explicitObjective) {
    return explicitObjective.replace(/^(核心目标|总目标|目标|结论)[:：]\s*/, "").trim();
  }

  const tailCandidate = [...lines]
    .reverse()
    .find((line) => /(因此|最终|总体上|核心判断|核心结论)/.test(line) && !isActionLine(line));

  if (tailCandidate) {
    return stripBulletPrefix(tailCandidate);
  }

  const matched = lines.find((line) => /^(核心目标|结论)[:：]/.test(line));
  if (matched) {
    return matched.replace(/^(核心目标|结论)[:：]\s*/, "").trim();
  }

  return undefined;
}

function extractActionRegions(lines: string[]): PagePlanRegion[] {
  const actionLines = lines.filter((line) => isActionLine(line));
  if (actionLines.length === 0) {
    return [];
  }

  return [
    {
      id: "actions-main",
      title: actionLines.length >= 5 ? `${actionLines.length} Actions` : "Action Cluster",
      kind: "actions",
      placement: "main",
      emphasis: "high",
      minHeightPx: actionLines.length >= 5 ? 220 : 180,
      maxVisualAidSlots: 1,
      iconPlacement: "inline",
      mustKeepTitleSingleBlock: true,
      suggestedElements: ["actionCardGroup", "cardGroup", "process"],
      sourceSignals: takeInterestingLines(actionLines, 6),
      notes: "Keep actions grouped, but avoid identical equal-weight cards. Allow one stronger lead card or a rail + grid composition.",
    },
  ];
}

function extractFrameworkRegion(lines: string[]): PagePlanRegion | null {
  const frameworkSignals = lines.filter((line) => /(框架|总体|核心思路|升级为|闭环)/.test(line));
  const bulletSignals = lines.filter((line) => isBulletLine(line));
  const sourceSignals = takeInterestingLines(
    frameworkSignals.length > 0 ? frameworkSignals.concat(bulletSignals) : bulletSignals,
    6,
  );

  if (sourceSignals.length === 0) {
    return null;
  }

  return {
    id: "framework-summary",
    title: "Framework Summary",
    kind: "framework",
    placement: "top",
    emphasis: "high",
    minHeightPx: 190,
    maxVisualAidSlots: 1,
    iconPlacement: "inline",
    mustKeepTitleSingleBlock: true,
    suggestedElements: ["frameworkRail", "summaryBand", "bulletList"],
    sourceSignals,
    notes: "Use this region to establish the framing logic before expanding into detail cards.",
  };
}

function extractDetailRegion(lines: string[]): PagePlanRegion | null {
  const headings = lines.filter((line) => isHeadingLike(line) && !isActionLine(line)).slice(0, 5);
  const details = lines.filter((line) => !isBulletLine(line) && !isHeadingLike(line)).slice(0, 5);
  const sourceSignals = takeInterestingLines(headings.concat(details), 6);

  if (sourceSignals.length === 0) {
    return null;
  }

  return {
    id: "support-details",
    title: "Supporting Details",
    kind: "details",
    placement: "right",
    emphasis: "medium",
    minHeightPx: 140,
    maxVisualAidSlots: 1,
    iconPlacement: "inline",
    mustKeepTitleSingleBlock: false,
    suggestedElements: ["text", "callout", "bulletList"],
    sourceSignals,
    notes: "Keep explanatory detail visible instead of collapsing everything into card body text.",
  };
}

function extractSummaryRegion(lines: string[], objective: string | undefined): PagePlanRegion | null {
  const signals = objective
    ? [objective]
    : lines.filter((line) => /(结论|核心目标|目标|因此|最终)/.test(line)).slice(0, 3);

  if (signals.length === 0) {
    return null;
  }

  return {
    id: "objective-band",
    title: "Objective Band",
    kind: "summary",
    placement: "bottom",
    emphasis: "medium",
    minHeightPx: 112,
    maxVisualAidSlots: 1,
    iconPlacement: "inline",
    mustKeepTitleSingleBlock: true,
    suggestedElements: ["objectiveBand", "summaryBand", "callout"],
    sourceSignals: takeInterestingLines(signals, 3),
    notes: "Reserve a bottom band or footer callout for the page objective or closing judgement.",
  };
}

export function buildHeuristicPagePlan(pageContent: string): PagePlan {
  const lines = extractLines(pageContent);
  const title = lines[0] ?? "Untitled Page";
  const bodyLines = lines.slice(1);
  const pageType = detectPageType(title, bodyLines);
  const layoutFamily = detectLayoutFamily(bodyLines);
  const objective = extractObjective(bodyLines);
  const keyMessage = takeInterestingLines(bodyLines, 1)[0];
  const bodyLength = bodyLines.join(" ").replace(/\s+/g, "").length;
  const bulletCount = bodyLines.filter((line) => isBulletLine(line)).length;
  const headingCount = bodyLines.filter((line) => isHeadingLike(line)).length;
  const densityClass =
    bodyLength >= 360 || bulletCount >= 6 || headingCount >= 6
      ? "dense"
      : bodyLength <= 140 && bulletCount <= 2
        ? "airy"
        : "balanced";
  const headerReservePx = pageType === "content" ? (densityClass === "dense" ? 182 : densityClass === "balanced" ? 166 : 150) : 140;
  const footerReservePx = objective ? (densityClass === "dense" ? 124 : 116) : 110;
  const visualAidBudget = densityClass === "dense" ? "minimal" : densityClass === "airy" ? "rich" : "standard";
  const regionMinTextAreaRatio = densityClass === "dense" ? 0.7 : densityClass === "airy" ? 0.52 : 0.6;

  const frameworkRegion = extractFrameworkRegion(bodyLines);
  if (frameworkRegion && layoutFamily === "left-rail-plus-action-grid") {
    frameworkRegion.placement = "left";
    frameworkRegion.notes = "Use this region as a compact framework rail rather than a full-width top banner.";
    frameworkRegion.minHeightPx = densityClass === "dense" ? 220 : 190;
  }

  const regions = [
    frameworkRegion,
    ...extractActionRegions(bodyLines),
    extractDetailRegion(bodyLines),
    extractSummaryRegion(bodyLines, objective),
  ].filter((region): region is PagePlanRegion => Boolean(region));

  const dedupedRegions = regions.slice(0, 5);
  const finalRegions: PagePlanRegion[] = dedupedRegions.length > 0
    ? dedupedRegions
    : [
        {
          id: "main-content",
          title: "Main Content",
          kind: "hero",
          placement: "main",
          emphasis: "high",
          minHeightPx: densityClass === "dense" ? 180 : 150,
          maxVisualAidSlots: densityClass === "dense" ? 1 : 2,
          iconPlacement: densityClass === "dense" ? "inline" : "stacked",
          mustKeepTitleSingleBlock: true,
          suggestedElements: ["text", "bulletList", "callout"],
          sourceSignals: takeInterestingLines(bodyLines, 6),
          notes: "Build one strong primary region and one or two secondary supports instead of an even grid.",
        },
      ];

  return {
    version: "page-plan/v1",
    page: {
      title,
      pageType,
      layoutFamily,
      visualRichness: pageType === "cover" || pageType === "sectionDivider" ? "normal" : "high",
      requiresVisualAid: pageType !== "cover",
      pptxCriticality: pageType === "content" || layoutFamily === "left-rail-plus-action-grid" ? "high" : "normal",
      densityClass,
      headerReservePx,
      footerReservePx,
      maxTopOccupancyRatio: densityClass === "dense" ? 0.42 : densityClass === "balanced" ? 0.46 : 0.5,
      visualAidBudget,
      regionMinTextAreaRatio,
      narrative: (() => {
        switch (layoutFamily) {
          case "left-rail-plus-action-grid":
            return "Compact framing region plus weighted action cluster.";
          case "comparison-split":
            return "Clear left-right contrast with concise takeaway.";
          case "timeline-flow":
            return "Chronology-first structure with visible sequence.";
          case "chart-plus-insights":
            return "One analytical anchor plus supporting insight blocks.";
          case "process-flow":
            return "Staged mechanism with concise supporting explanation.";
          default:
            return "One dominant framing region with a few coordinated supporting blocks.";
        }
      })(),
      ...(keyMessage ? { keyMessage } : {}),
      ...(objective ? { objective } : {}),
      preserveDetails: true,
      maxRegions: Math.max(2, Math.min(5, finalRegions.length)),
      avoidPatterns: defaultAvoidPatterns(),
      regions: finalRegions,
    },
  };
}

function normalizePlan(input: unknown): PagePlan {
  const source = isPlainObject(input) ? input : {};
  const page = isPlainObject(source.page) ? source.page : {};
  const title = sanitizeString(page.title, "Untitled Page");
  const regionsSource = Array.isArray(page.regions) ? page.regions : [];
  const regions: PagePlanRegion[] = regionsSource.map((region, index) => normalizeRegion(region, index)).slice(0, 5);
  const fallback = buildHeuristicPagePlan(title);
  const fallbackRegions = fallback.page.regions;

  return {
    version: "page-plan/v1",
    page: {
      title,
      pageType: normalizeEnum(page.pageType, SUPPORTED_PAGE_TYPES, "content"),
      layoutFamily: normalizeEnum(page.layoutFamily, SUPPORTED_LAYOUT_FAMILIES, "top-band-plus-grid"),
      visualRichness:
        page.visualRichness === "high" || page.visualRichness === "normal"
          ? page.visualRichness
          : fallback.page.visualRichness,
      requiresVisualAid: typeof page.requiresVisualAid === "boolean"
        ? page.requiresVisualAid
        : fallback.page.requiresVisualAid,
      pptxCriticality:
        page.pptxCriticality === "high" || page.pptxCriticality === "normal"
          ? page.pptxCriticality
          : fallback.page.pptxCriticality,
      densityClass:
        page.densityClass === "dense" || page.densityClass === "balanced" || page.densityClass === "airy"
          ? page.densityClass
          : fallback.page.densityClass,
      headerReservePx: clampInteger(page.headerReservePx, fallback.page.headerReservePx, 120, 220),
      footerReservePx: clampInteger(page.footerReservePx, fallback.page.footerReservePx, 90, 180),
      maxTopOccupancyRatio: (() => {
        const value = typeof page.maxTopOccupancyRatio === "number" && Number.isFinite(page.maxTopOccupancyRatio)
          ? page.maxTopOccupancyRatio
          : fallback.page.maxTopOccupancyRatio;
        return Math.max(0.3, Math.min(0.62, value));
      })(),
      visualAidBudget:
        page.visualAidBudget === "minimal" || page.visualAidBudget === "standard" || page.visualAidBudget === "rich"
          ? page.visualAidBudget
          : fallback.page.visualAidBudget,
      regionMinTextAreaRatio: (() => {
        const value = typeof page.regionMinTextAreaRatio === "number" && Number.isFinite(page.regionMinTextAreaRatio)
          ? page.regionMinTextAreaRatio
          : fallback.page.regionMinTextAreaRatio;
        return Math.max(0.45, Math.min(0.82, value));
      })(),
      ...(toTrimmedString(page.narrative)
        ? { narrative: sanitizeString(page.narrative, "") }
        : fallback.page.narrative
          ? { narrative: fallback.page.narrative }
          : {}),
      ...(toTrimmedString(page.keyMessage) ? { keyMessage: sanitizeString(page.keyMessage, "") } : {}),
      ...(toTrimmedString(page.objective) ? { objective: sanitizeString(page.objective, "") } : {}),
      preserveDetails: page.preserveDetails !== false,
      maxRegions: clampInteger(page.maxRegions, Math.max(2, Math.min(5, regions.length || fallbackRegions.length)), 2, 5),
      avoidPatterns: (() => {
        const items = sanitizeStringArray(page.avoidPatterns, 6);
        return items.length > 0 ? items : defaultAvoidPatterns();
      })(),
      regions: regions.length > 0 ? regions : fallbackRegions,
    },
  };
}

function validatePagePlan(plan: PagePlan): void {
  if (!plan.page.title.trim()) {
    throw new Error("page.title must be a non-empty string");
  }

  if (!SUPPORTED_PAGE_TYPES.includes(plan.page.pageType)) {
    throw new Error("page.pageType is not supported");
  }

  if (!SUPPORTED_LAYOUT_FAMILIES.includes(plan.page.layoutFamily)) {
    throw new Error("page.layoutFamily is not supported");
  }

  if (!["high", "normal"].includes(plan.page.visualRichness)) {
    throw new Error("page.visualRichness must be high or normal");
  }

  if (!["high", "normal"].includes(plan.page.pptxCriticality)) {
    throw new Error("page.pptxCriticality must be high or normal");
  }
  if (!["dense", "balanced", "airy"].includes(plan.page.densityClass)) {
    throw new Error("page.densityClass must be dense, balanced, or airy");
  }
  if (!(plan.page.headerReservePx >= 120 && plan.page.headerReservePx <= 220)) {
    throw new Error("page.headerReservePx must be between 120 and 220");
  }
  if (!(plan.page.footerReservePx >= 90 && plan.page.footerReservePx <= 180)) {
    throw new Error("page.footerReservePx must be between 90 and 180");
  }
  if (!(plan.page.maxTopOccupancyRatio >= 0.3 && plan.page.maxTopOccupancyRatio <= 0.62)) {
    throw new Error("page.maxTopOccupancyRatio must be between 0.3 and 0.62");
  }
  if (!["minimal", "standard", "rich"].includes(plan.page.visualAidBudget)) {
    throw new Error("page.visualAidBudget must be minimal, standard, or rich");
  }
  if (!(plan.page.regionMinTextAreaRatio >= 0.45 && plan.page.regionMinTextAreaRatio <= 0.82)) {
    throw new Error("page.regionMinTextAreaRatio must be between 0.45 and 0.82");
  }

  if (!Array.isArray(plan.page.regions) || plan.page.regions.length === 0) {
    throw new Error("page.regions must be a non-empty array");
  }

  if (plan.page.regions.length > 5) {
    throw new Error("page.regions must not exceed 5 items");
  }

  for (const [index, region] of plan.page.regions.entries()) {
    if (!region.id.trim()) {
      throw new Error(`page.regions[${index}].id must be a non-empty string`);
    }
    if (!region.title.trim()) {
      throw new Error(`page.regions[${index}].title must be a non-empty string`);
    }
    if (!SUPPORTED_REGION_KINDS.includes(region.kind)) {
      throw new Error(`page.regions[${index}].kind is not supported`);
    }
    if (!SUPPORTED_REGION_PLACEMENTS.includes(region.placement)) {
      throw new Error(`page.regions[${index}].placement is not supported`);
    }
    if (!SUPPORTED_REGION_EMPHASIS.includes(region.emphasis)) {
      throw new Error(`page.regions[${index}].emphasis is not supported`);
    }
    if (!(region.minHeightPx >= 96 && region.minHeightPx <= 420)) {
      throw new Error(`page.regions[${index}].minHeightPx must be between 96 and 420`);
    }
    if (!(region.maxVisualAidSlots >= 0 && region.maxVisualAidSlots <= 3)) {
      throw new Error(`page.regions[${index}].maxVisualAidSlots must be between 0 and 3`);
    }
    if (!["inline", "stacked", "none"].includes(region.iconPlacement)) {
      throw new Error(`page.regions[${index}].iconPlacement must be inline, stacked, or none`);
    }
    if (!Array.isArray(region.suggestedElements) || region.suggestedElements.length === 0) {
      throw new Error(`page.regions[${index}].suggestedElements must be a non-empty array`);
    }
    if (!Array.isArray(region.sourceSignals) || region.sourceSignals.length === 0) {
      throw new Error(`page.regions[${index}].sourceSignals must be a non-empty array`);
    }
  }
}

export function decodePagePlanFromText(input: string): PagePlanDecodeResult {
  const parsed = parseJsonWithRepair(input);
  const plan = normalizePlan(parsed.value);
  validatePagePlan(plan);

  return {
    plan,
    jsonRepaired: parsed.repaired,
    jsonRepairNotes: parsed.repairNotes,
  };
}

function buildLayoutFamilyInstructions(plan: PagePlan): string[] {
  switch (plan.page.layoutFamily) {
    case "left-rail-plus-action-grid":
      return [
        "Reserve a compact framing rail on the left or upper-left for the framework or governing logic.",
        "Cluster repeated actions in the main area, but do not give every action identical visual weight.",
        "Allow one lead action card or one heavier row so the page has visual hierarchy.",
        "Prefer high-level primitives such as frameworkRail, actionCardGroup, and objectiveBand when they fit the page.",
        "Use structural cues at the cluster level so the page keeps hierarchy without forcing every small card to carry its own icon or badge.",
        "On dense pages, use inline icons and tighter visual budgets instead of stacking decorative layers above the text.",
        "Do not add pageBadge unless the user explicitly asks for page numbering or a corner marker.",
        "Avoid a flat 3x2 grid of identical white cards unless the plan explicitly demands strict equivalence.",
      ];
    case "top-band-plus-grid":
      return [
        "Create one dominant top framing band or hero region before distributing detail below.",
        "Prefer frameworkRail in top mode or summaryBand for the dominant framing region.",
        "Use the lower area for 2-4 coordinated supporting regions with varied emphasis.",
        "Do not let the title sit above a stack of interchangeable boxes with no dominant narrative block.",
      ];
    case "comparison-split":
      return [
        "Make the contrast explicit with clearly differentiated left-right sides.",
        "Preserve supporting evidence, but keep the main comparison immediately readable.",
      ];
    case "chart-plus-insights":
      return [
        "Use one analytical visual as the primary anchor and place interpretation beside or below it.",
        "Do not bury the chart in a sea of equal text cards.",
      ];
    case "timeline-flow":
      return [
        "Make chronology visible as a sequence or progression, not just stacked prose blocks.",
      ];
    case "process-flow":
      return [
        "Show the process as a staged mechanism or closed loop rather than independent paragraphs.",
      ];
    case "stacked-sections":
      return [
        "Favor top-to-bottom sectional reading order over a rigid card grid.",
      ];
    default:
      return [
        "Establish one dominant region first, then add supporting regions with clear hierarchy.",
      ];
  }
}

function buildRegionInstructions(plan: PagePlan): string[] {
  return plan.page.regions.map((region, index) => {
    const suggested = region.suggestedElements.slice(0, 3).join(", ");
    const signals = region.sourceSignals.slice(0, 2).join(" | ");
    const notes = region.notes ? ` Note: ${region.notes}` : "";
    return `${index + 1}. "${region.title}" = ${region.kind}/${region.placement}/${region.emphasis}. Preserve: ${signals}. Prefer: ${suggested}. MinHeight ${region.minHeightPx}px. VisualAidSlots ${region.maxVisualAidSlots}. Icon ${region.iconPlacement}. SingleBlockTitle ${region.mustKeepTitleSingleBlock ? "yes" : "no"}.${notes}`;
  });
}

function buildPrimitiveRecipeInstructions(plan: PagePlan): string[] {
  switch (plan.page.layoutFamily) {
    case "left-rail-plus-action-grid":
      return [
        "Preferred primitive recipe: compact frameworkRail + actionCardGroup + light objectiveBand.",
        "Use a few stable structural cues across the framework and action clusters so the page is not text-only, but do not force every support card to carry a separate visual layer.",
        "Do not add pageBadge unless the user explicitly asks for page numbering or a corner status marker.",
        "Prefer a compact framework panel or top framing band over a tall dominant left rail when the framework copy is dense.",
        "Only fall back to manual shape/title/text card assembly if the primitive recipe truly cannot fit the source detail.",
      ];
    case "top-band-plus-grid":
      return [
        "Preferred primitive recipe: frameworkRail in top mode or summaryBand for the top region, followed by 2-4 supporting regions and an optional light objectiveBand.",
      ];
    default:
      return [
        "Prefer the highest-level legal primitive that matches each region before manually assembling lower-level blocks.",
      ];
  }
}

export function buildSceneGraphPlanningBrief(pagePlan: PagePlan, pageContent: string): string {
  const requiresFooterReserve =
    Boolean(pagePlan.page.objective) ||
    pagePlan.page.regions.some((region) => region.placement === "bottom" || region.kind === "summary");
  const topBandGuidance = pagePlan.page.layoutFamily === "top-band-plus-grid"
    ? "- Preferred macro composition: one top framing rail, one left cluster, one right cluster, and an optional bottom objective band."
    : "";
  const primitivePreferences = [
    pagePlan.page.regions.some((region) => region.suggestedElements.includes("frameworkRail")) ? "frameworkRail" : "",
    pagePlan.page.regions.some((region) => region.suggestedElements.includes("actionCardGroup")) ? "actionCardGroup" : "",
    pagePlan.page.regions.some((region) => region.suggestedElements.includes("objectiveBand")) ? "objectiveBand" : "",
  ].filter(Boolean);

  return [
    "Use this page-plan as a concise composition guide.",
    `Page title: ${pagePlan.page.title}`,
    `Layout family: ${pagePlan.page.layoutFamily}`,
    `Density: ${pagePlan.page.densityClass}; preserveDetails=${pagePlan.page.preserveDetails ? "true" : "false"}`,
    `Header reserve: ${pagePlan.page.headerReservePx}px; footer reserve: ${requiresFooterReserve ? pagePlan.page.footerReservePx : 0}px`,
    pagePlan.page.keyMessage ? `Key message: ${pagePlan.page.keyMessage}` : "",
    pagePlan.page.objective ? `Objective: ${pagePlan.page.objective}` : "",
    pagePlan.page.narrative ? `Narrative: ${pagePlan.page.narrative}` : "",
    "",
    "Global directives:",
    "- Preserve source detail whenever it fits cleanly; do not proactively compress user content.",
    "- Keep the title band clear and avoid flattening the page into repeated equal cards.",
    `- Visual aid budget is ${pagePlan.page.visualAidBudget}; use structure cues at cluster level before adding extra decoration.`,
    primitivePreferences.length > 0
      ? `- Prefer these high-level primitives when possible: ${primitivePreferences.join(", ")}.`
      : "- Prefer high-level primitives when possible over manual repeated shape + title + text blocks.",
    topBandGuidance,
    "",
    "Region directives:",
    ...pagePlan.page.regions.map((region, index) => {
      const primitiveHint = region.suggestedElements.slice(0, 3).join(", ");
      const signals = region.sourceSignals.slice(0, 3).join(" | ");
      return `${index + 1}. ${region.id}: placement=${region.placement}, kind=${region.kind}, emphasis=${region.emphasis}, prefer=${primitiveHint}${signals ? `, signals=${signals}` : ""}`;
    }),
    "",
    pagePlan.page.avoidPatterns.length > 0 ? `Avoid patterns: ${pagePlan.page.avoidPatterns.join("; ")}` : "",
    "",
    "Source page content:",
    pageContent.trim(),
  ].filter(Boolean).join("\n");
}
