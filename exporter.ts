import { readFile } from "node:fs/promises";
import path from "node:path";

import PptxGenJS from "pptxgenjs";

import { buildHeuristicPagePlan } from "./page-plan.ts";
import { computeActionCardGroupLayout } from "./primitive-layout.ts";
import {
  resolvePrimitiveTonePalette,
  resolveReadableBorderColor,
  resolveReadableTextColor,
  resolveThemeTokens,
} from "./primitive-theme.ts";
import { buildPptxLayoutPlan, type PptxLayoutPlan } from "./pptx-layout-plan.ts";
import { renderDonutChartSvg, renderIconSvg } from "./render.ts";
import { decodeSceneGraphFromText } from "./scene-graph-codec.ts";
import {
  PPTX_HEIGHT_IN,
  PPTX_WIDTH_IN,
  type ActionCardGroupContent,
  type BadgeContent,
  type ChartContent,
  type ComparisonContent,
  type ConnectorContent,
  type CoverContent,
  type FrameworkRailContent,
  type IconContent,
  type InsightContent,
  type MatrixContent,
  type MiniDiagramContent,
  type ObjectiveBandContent,
  type PageBadgeContent,
  type ProcessContent,
  type SceneElement,
  type SceneGraph,
  type SectionDividerContent,
  type SummaryBandContent,
  type SummaryContent,
  type TimelineContent,
  type TocContent,
  type FunnelContent,
  type SwimlaneContent,
} from "./types.ts";

// Keep text metrics tied to the same px/in scale as coordinates:
// 1280x720 -> 96px/in -> 0.75pt/px; 1600x900 -> 120px/in -> 0.60pt/px.
let activePxToPt = 0.60;
const PPTX_WRAP_SAFETY = 1.1;

type Point = {
  x: number;
  y: number;
};

function normalizeColor(color: string | undefined, fallback = "000000"): string {
  return (color ?? fallback).replace(/^#/, "").toUpperCase();
}

function opacityToTransparency(opacity?: number): number {
  if (opacity === undefined) {
    return 0;
  }

  const transparency = Math.round((1 - opacity) * 100);
  return Math.max(0, Math.min(100, transparency));
}

function solidFillColor(element: SceneElement, fallback: string): string {
  const fill = element.style.fill;
  if (fill?.type === "solid" && fill.color) {
    return normalizeColor(fill.color, fallback);
  }
  if (fill?.type === "linearGradient" && fill.from) {
    return normalizeColor(fill.from, fallback);
  }
  return fallback;
}

function pxToInches(value: number, scale: number): number {
  return Number((value * scale).toFixed(4));
}

function pxToPoints(value?: number): number | undefined {
  return value === undefined ? undefined : Number((value * activePxToPt).toFixed(2));
}

function dataUriFromSvg(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function wrapIconSvg(content: IconContent, color: string): string {
  return renderIconSvg(content.name).replace("<svg ", `<svg style="color:${color}" `);
}

function colorWithAlphaHex(color: string, alpha: number): string {
  const normalized = color.replace(/^#/, "");
  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) {
    return color;
  }

  const channel = Math.round(clamp(alpha, 0, 1) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `${normalized}${channel}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function containsEastAsianText(text: string): boolean {
  return /[\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(text);
}

function estimateTextUnits(text: string): number {
  let units = 0;
  for (const char of text) {
    if (/\s/.test(char)) {
      units += 0.35;
    } else if (containsEastAsianText(char)) {
      units += 1;
    } else if (/[A-Z0-9]/.test(char)) {
      units += 0.72;
    } else if (/[a-z]/.test(char)) {
      units += 0.58;
    } else {
      units += 0.66;
    }
  }
  return units;
}

function estimateTextBlockHeightPx(
  text: string,
  widthPx: number,
  fontSizePt: number,
  lineHeight = 1.35,
  minLines = 1,
  maxLines = 6,
): number {
  const safeWidth = Math.max(80, widthPx);
  const fontPx = Math.max(10, fontSizePt / activePxToPt);
  const unitWidth = (containsEastAsianText(text) ? fontPx * 0.96 : fontPx * 0.62) * PPTX_WRAP_SAFETY;
  const unitsPerLine = Math.max(6, safeWidth / Math.max(6, unitWidth));
  const lines = clamp(Math.ceil(estimateTextUnits(text) / unitsPerLine), minLines, maxLines);
  return Math.ceil(Math.max(fontPx * lineHeight * lines + 4, fontPx * lineHeight * minLines));
}

function resolvePptFontFace(fontFamily: string | undefined, sampleText = ""): string {
  const requested = fontFamily?.trim();
  if (!requested) {
    return containsEastAsianText(sampleText) ? "Microsoft YaHei" : "Aptos";
  }

  const normalized = requested.toLowerCase();
  const windowsFallbackNeeded = [
    "noto sans sc",
    "noto sans cjk sc",
    "noto serif sc",
    "source han sans",
    "source han sans sc",
    "source han serif",
    "source han serif sc",
  ];

  if (containsEastAsianText(sampleText) && windowsFallbackNeeded.some((name) => normalized.includes(name))) {
    return "Microsoft YaHei";
  }

  return requested;
}

function headerBandTextColor(graph: SceneGraph, element: Extract<SceneElement, { type: "title" | "text" }>): string | null {
  return null;
}

function addPageChrome(slide: PptxGenJS.Slide, pptx: PptxGenJS, graph: SceneGraph, scale: number): void {
  return;
}

const DEFAULT_ACTION_ICONS: IconContent["name"][] = ["layers", "target", "check", "dashboard", "briefcase", "trend"];

function fallbackFrameworkIcon(content: FrameworkRailContent): IconContent["name"] {
  return content.layout === "top" ? "target" : "layers";
}

function fallbackObjectiveIcon(): IconContent["name"] {
  return "target";
}

function fallbackActionIcon(content: ActionCardGroupContent, index: number): IconContent["name"] | null {
  if (content.visualAid && content.visualAid !== "icon") {
    return null;
  }
  return DEFAULT_ACTION_ICONS[index % DEFAULT_ACTION_ICONS.length];
}

function collectGraphText(graph: SceneGraph): string {
  return graph.slide.elements.map((element) => {
    switch (element.type) {
      case "title":
      case "text":
        return element.content.text;
      case "bulletList":
        return element.content.items.join("\n");
      case "callout":
        return `${element.content.title}\n${element.content.text}`;
      case "frameworkRail":
        return [element.content.label, element.content.title, element.content.summary, ...(element.content.bullets ?? []), element.content.footerTitle, ...(element.content.footerItems ?? [])].filter(Boolean).join("\n");
      case "actionCardGroup":
        return [element.content.title, ...element.content.items.flatMap((item) => [item.step, item.eyebrow, item.title, item.body, item.emphasis])].filter(Boolean).join("\n");
      case "objectiveBand":
        return [element.content.label, element.content.text, element.content.emphasis].filter(Boolean).join("\n");
      default:
        return "";
    }
  }).filter(Boolean).join("\n");
}

function defaultPptxLayoutPlan(graph: SceneGraph): PptxLayoutPlan {
  const pagePlan = buildHeuristicPagePlan(collectGraphText(graph) || graph.slide.id);
  return buildPptxLayoutPlan(graph, pagePlan);
}

function findElementPlan(layoutPlan: PptxLayoutPlan | undefined, elementId: string) {
  return layoutPlan?.elementPlans.find((plan) => plan.elementId === elementId);
}

function toneFillColor(graph: SceneGraph, element: SceneElement, fallback = "FFFFFF"): string {
  const fillFallback = solidFillColor(element, fallback);
  if (element.style.backgroundColor) {
    return normalizeColor(element.style.backgroundColor, fillFallback);
  }

  const isGovBank = graph.slide.theme.preset === "govBankWarmOrange";
  const accent = graph.slide.theme.accentColor;
  switch (element.style.surfaceTone) {
    case "muted":
      return isGovBank ? "EEF4F8" : "F3EEE7";
    case "accent":
      return solidFillColor(element, normalizeColor(accent, fallback));
    case "softAccent":
      return isGovBank ? "FFFAF6" : "FBE7DD";
    default:
      return fillFallback;
  }
}

function toneFillTransparency(element: SceneElement): number {
  if (element.style.fill?.type === "none") {
    return 100;
  }

  if (element.style.opacity !== undefined) {
    return opacityToTransparency(element.style.opacity);
  }

  switch (element.style.surfaceTone) {
    case "accent":
      return 88;
    case "softAccent":
      return 90;
    default:
      return 0;
  }
}

function toneBorderColor(graph: SceneGraph, element: SceneElement, fallback = "E8E3DB"): string {
  if (element.style.borderColor) {
    return normalizeColor(element.style.borderColor, fallback);
  }

  if (graph.slide.theme.preset === "govBankWarmOrange") {
    if (element.style.surfaceTone === "accent" || element.style.surfaceTone === "softAccent") {
      return normalizeColor(graph.slide.theme.accentColor, fallback);
    }
    if (element.style.surfaceTone === "muted") {
      return normalizeColor(graph.slide.theme.secondaryAccentColor ?? "2F5F86", fallback);
    }
    return normalizeColor(graph.slide.theme.chromeLineColor ?? "D8DEE8", fallback);
  }

  if (element.style.surfaceTone === "accent" || element.style.surfaceTone === "softAccent") {
    return normalizeColor(graph.slide.theme.accentColor, fallback);
  }

  return fallback;
}

function asCssColor(color: string | undefined, fallback = "#000000"): string {
  if (!color) {
    return fallback;
  }

  return color.startsWith("#") || color.startsWith("rgb") ? color : `#${normalizeColor(color, fallback.replace(/^#/, ""))}`;
}

function safePptTextColor(
  background: string,
  preferred: string | undefined,
  fallbackDark: string,
  fallbackLight = "#FFF9F4",
): string {
  return normalizeColor(
    resolveReadableTextColor(
      asCssColor(background, "#FFFFFF"),
      asCssColor(preferred, fallbackDark),
      { fallbackDark: asCssColor(fallbackDark), fallbackLight: asCssColor(fallbackLight) },
    ),
    normalizeColor(fallbackDark),
  );
}

function safePptBorderColor(background: string, preferred: string | undefined, accentFallback: string): string {
  return normalizeColor(
    resolveReadableBorderColor(
      asCssColor(background, "#FFFFFF"),
      asCssColor(preferred, accentFallback),
      asCssColor(accentFallback),
    ),
    normalizeColor(accentFallback),
  );
}

function extractEmbeddedSceneGraph(html: string): string | null {
  const match = html.match(/<script type="application\/json" data-scene-graph>([\s\S]*?)<\/script>/i);
  return match?.[1]?.trim() ?? null;
}

async function resolveFallbackJsonPath(inputPath: string): Promise<string | null> {
  const basename = path.parse(inputPath).name;
  const candidates = [
    path.resolve(path.dirname(inputPath), `${basename}.json`),
    path.resolve(path.dirname(inputPath), "..", "input", `${basename}.json`),
    path.resolve(process.cwd(), "input", `${basename}.json`),
  ];

  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

async function loadSceneGraphFromHtml(inputPath: string): Promise<SceneGraph> {
  const html = await readFile(inputPath, "utf8");
  const embedded = extractEmbeddedSceneGraph(html);

  if (embedded) {
    return decodeSceneGraphFromText(embedded, false).graph;
  }

  const fallbackJsonPath = await resolveFallbackJsonPath(inputPath);
  if (!fallbackJsonPath) {
    throw new Error("HTML does not contain embedded scene graph data, and no matching JSON source was found.");
  }

  const jsonRaw = await readFile(fallbackJsonPath, "utf8");
  return decodeSceneGraphFromText(jsonRaw, false).graph;
}

export async function loadSceneGraphForExport(inputPath: string): Promise<SceneGraph> {
  const ext = path.extname(inputPath).toLowerCase();

  if (ext === ".html") {
    return loadSceneGraphFromHtml(inputPath);
  }

  if (ext === ".json") {
    const inputRaw = await readFile(inputPath, "utf8");
    return decodeSceneGraphFromText(inputRaw, false).graph;
  }

  throw new Error(`Unsupported export input: ${inputPath}`);
}

function computeConnectorPoints(
  content: ConnectorContent,
  element: Extract<SceneElement, { type: "connector" }>,
  elementsById: Map<string, SceneElement>,
): { points: Point[]; busY?: number; routing: "bus" | "chain" } {
  const anchor = content.anchor ?? "top";
  const targets = content.targets
    .map((id) => elementsById.get(id))
    .filter((target): target is SceneElement => Boolean(target));

  const points = targets.map((target) => {
    const anchorY =
      anchor === "bottom"
        ? target.y + target.h - element.y
        : anchor === "center"
          ? target.y + target.h / 2 - element.y
          : target.y - element.y;

    return {
      x: target.x + target.w / 2 - element.x,
      y: anchorY,
    };
  });

  if (points.length < 2) {
    return { points, routing: "chain" };
  }

  const sameRow = Math.max(...targets.map((target) => target.y)) - Math.min(...targets.map((target) => target.y)) <= 24;
  const routing = content.routing === "auto" || content.routing === undefined
    ? (sameRow ? "bus" : "chain")
    : content.routing;

  if (routing === "bus") {
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const busY = anchor === "bottom"
      ? Math.min(element.h - 8, maxY + 12)
      : Math.max(8, minY - 12);

    return { points, busY, routing };
  }

  return { points, routing };
}

function addLineShape(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  start: Point,
  end: Point,
  scale: number,
  color: string,
  dashed: boolean,
): void {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.max(Math.abs(end.x - start.x), 1);
  const h = Math.max(Math.abs(end.y - start.y), 1);

  slide.addShape(pptx.ShapeType.line, {
    x: pxToInches(x, scale),
    y: pxToInches(y, scale),
    w: pxToInches(w, scale),
    h: pxToInches(h, scale),
    flipH: start.x > end.x,
    flipV: start.y > end.y,
    line: {
      color,
      pt: pxToPoints(3),
      dashType: dashed ? "dash" : "solid",
      beginArrowType: "none",
      endArrowType: "none",
    },
  });
}

function addCover(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "cover" }>,
  scale: number,
): void {
  const content: CoverContent = element.content;
  const accent = normalizeColor(element.style.color, graph.slide.theme.accentColor);
  const layout = content.layout ?? "centered";
  const titleSize = Math.max(36, Math.min(72, Math.round(element.h * 0.1)));
  const subtitleSize = Math.max(18, Math.min(28, Math.round(element.h * 0.04)));
  const metaSize = Math.max(12, Math.min(16, Math.round(element.h * 0.02)));

  if (layout === "asymmetric") {
    const leftW = Math.round(element.w * 0.55);
    slide.addShape(pptx.ShapeType.rect, {
      x: pxToInches(element.x + leftW, scale),
      y: pxToInches(element.y, scale),
      w: pxToInches(element.w - leftW, scale),
      h: pxToInches(element.h, scale),
      fill: { color: accent, transparency: 88 },
    });

    slide.addText(content.title, {
      x: pxToInches(element.x + 48, scale),
      y: pxToInches(element.y + element.h * 0.35, scale),
      w: pxToInches(leftW - 96, scale),
      h: pxToInches(titleSize * 1.5, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: titleSize,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
      valign: "middle",
    });

    if (content.subtitle) {
      slide.addText(content.subtitle, {
        x: pxToInches(element.x + 48, scale),
        y: pxToInches(element.y + element.h * 0.35 + titleSize * 1.5 + 16, scale),
        w: pxToInches(leftW - 96, scale),
        h: pxToInches(subtitleSize * 1.5, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: subtitleSize,
        color: normalizeColor(graph.slide.theme.textColor),
        fit: "shrink",
      });
    }

    if (content.meta) {
      slide.addText(content.meta, {
        x: pxToInches(element.x + 48, scale),
        y: pxToInches(element.y + element.h - 48 - metaSize * 1.5, scale),
        w: pxToInches(leftW - 96, scale),
        h: pxToInches(metaSize * 1.5, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: metaSize,
        color: normalizeColor(graph.slide.theme.textColor),
        transparency: 30,
        fit: "shrink",
      });
    }
    return;
  }

  slide.addText(content.title, {
    x: pxToInches(element.x + 48, scale),
    y: pxToInches(element.y + element.h * 0.35, scale),
    w: pxToInches(element.w - 96, scale),
    h: pxToInches(titleSize * 1.5, scale),
    margin: 0,
    fontFace: graph.slide.theme.fontFamily,
    fontSize: titleSize,
    bold: true,
    color: normalizeColor(graph.slide.theme.titleColor),
    fit: "shrink",
    align: "center",
    valign: "middle",
  });

  if (content.subtitle) {
    slide.addText(content.subtitle, {
      x: pxToInches(element.x + 48, scale),
      y: pxToInches(element.y + element.h * 0.35 + titleSize * 1.5 + 16, scale),
      w: pxToInches(element.w - 96, scale),
      h: pxToInches(subtitleSize * 1.5, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: subtitleSize,
      color: normalizeColor(graph.slide.theme.textColor),
      fit: "shrink",
      align: "center",
    });
  }

  if (content.meta) {
    slide.addText(content.meta, {
      x: pxToInches(element.x + 48, scale),
      y: pxToInches(element.y + element.h - 48 - metaSize * 1.5, scale),
      w: pxToInches(element.w - 96, scale),
      h: pxToInches(metaSize * 1.5, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: metaSize,
      color: normalizeColor(graph.slide.theme.textColor),
      transparency: 30,
      fit: "shrink",
      align: "center",
    });
  }
}

function addToc(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "toc" }>,
  scale: number,
): void {
  const content: TocContent = element.content;
  const accent = normalizeColor(element.style.color, graph.slide.theme.accentColor);
  const layout = content.layout ?? "vertical";
  const title = content.title ?? "鐩綍";
  const titleSize = 28;
  const itemTitleSize = 18;
  const numberSize = 24;
  const descSize = 12;
  const padding = 40;

  if (layout === "sidebar") {
    const sidebarW = Math.round(element.w * 0.25);
    slide.addShape(pptx.ShapeType.rect, {
      x: pxToInches(element.x, scale),
      y: pxToInches(element.y, scale),
      w: pxToInches(sidebarW, scale),
      h: pxToInches(element.h, scale),
      fill: { color: accent, transparency: 88 },
    });

    slide.addText(title, {
      x: pxToInches(element.x + 12, scale),
      y: pxToInches(element.y + element.h / 2 - titleSize, scale),
      w: pxToInches(sidebarW - 24, scale),
      h: pxToInches(titleSize * 2, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: titleSize,
      bold: true,
      color: accent,
      fit: "shrink",
      align: "center",
      valign: "middle",
      rotate: 270,
    });
  }

  const mainX = layout === "sidebar" ? element.x + Math.round(element.w * 0.25) + padding : element.x + padding;
  const mainW = layout === "sidebar" ? element.w - Math.round(element.w * 0.25) - padding * 2 : element.w - padding * 2;

  if (layout !== "sidebar") {
    slide.addText(title, {
      x: pxToInches(mainX, scale),
      y: pxToInches(element.y + padding, scale),
      w: pxToInches(mainW, scale),
      h: pxToInches(titleSize + 16, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: titleSize,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });
  }

  const itemGap = 16;
  const itemH = Math.max(60, (element.h - padding * 2 - titleSize - 32) / Math.max(content.items.length, 1));
  content.items.forEach((item, index) => {
    const y = element.y + padding + titleSize + 32 + index * (itemH + itemGap);
    const num = item.number ?? String(index + 1).padStart(2, "0");

    slide.addText(num, {
      x: pxToInches(mainX, scale),
      y: pxToInches(y, scale),
      w: pxToInches(48, scale),
      h: pxToInches(itemH, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: numberSize,
      bold: true,
      color: accent,
      fit: "shrink",
      valign: "top",
    });

    slide.addText(item.title, {
      x: pxToInches(mainX + 64, scale),
      y: pxToInches(y, scale),
      w: pxToInches(mainW - 64, scale),
      h: pxToInches(itemTitleSize + 8, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: itemTitleSize,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });

    if (item.description) {
      slide.addText(item.description, {
        x: pxToInches(mainX + 64, scale),
        y: pxToInches(y + itemTitleSize + 12, scale),
        w: pxToInches(mainW - 64, scale),
        h: pxToInches(itemH - itemTitleSize - 12, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: descSize,
        color: normalizeColor(graph.slide.theme.textColor),
        fit: "shrink",
        valign: "top",
      });
    }
  });
}

function addSectionDivider(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "sectionDivider" }>,
  scale: number,
): void {
  const content: SectionDividerContent = element.content;
  const accent = normalizeColor(element.style.color, graph.slide.theme.accentColor);
  const layout = content.layout ?? "boldCenter";
  const numberSize = Math.max(56, Math.min(96, Math.round(element.h * 0.15)));
  const titleSize = Math.max(28, Math.min(40, Math.round(element.h * 0.05)));
  const introSize = Math.max(12, Math.min(16, Math.round(element.h * 0.02)));

  if (layout === "accentBlock") {
    const blockW = Math.round(element.w * 0.35);
    slide.addShape(pptx.ShapeType.rect, {
      x: pxToInches(element.x, scale),
      y: pxToInches(element.y, scale),
      w: pxToInches(blockW, scale),
      h: pxToInches(element.h, scale),
      fill: { color: accent },
    });

    if (content.number) {
      slide.addText(content.number, {
        x: pxToInches(element.x, scale),
        y: pxToInches(element.y + element.h / 2 - numberSize / 2, scale),
        w: pxToInches(blockW, scale),
        h: pxToInches(numberSize, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: numberSize,
        bold: true,
        color: "FFFFFF",
        fit: "shrink",
        align: "center",
        valign: "middle",
      });
    }

    slide.addText(content.title, {
      x: pxToInches(element.x + blockW + 48, scale),
      y: pxToInches(element.y + element.h * 0.38, scale),
      w: pxToInches(element.w - blockW - 96, scale),
      h: pxToInches(titleSize + 16, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: titleSize,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });

    if (content.intro) {
      slide.addText(content.intro, {
        x: pxToInches(element.x + blockW + 48, scale),
        y: pxToInches(element.y + element.h * 0.38 + titleSize + 24, scale),
        w: pxToInches(element.w - blockW - 96, scale),
        h: pxToInches(introSize * 2, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: introSize,
        color: normalizeColor(graph.slide.theme.textColor),
        fit: "shrink",
      });
    }
    return;
  }

  if (layout === "splitBackground") {
    slide.addShape(pptx.ShapeType.rect, {
      x: pxToInches(element.x, scale),
      y: pxToInches(element.y, scale),
      w: pxToInches(element.w, scale),
      h: pxToInches(element.h, scale),
      fill: { color: accent, transparency: 92 },
    });

    if (content.number) {
      slide.addText(content.number, {
        x: pxToInches(element.x + element.w - 160, scale),
        y: pxToInches(element.y + element.h / 2 - numberSize / 2, scale),
        w: pxToInches(120, scale),
        h: pxToInches(numberSize, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: numberSize,
        bold: true,
        color: accent,
        transparency: 75,
        fit: "shrink",
        align: "right",
        valign: "middle",
      });
    }
  }

  const centerY = element.y + element.h / 2;
  if (content.number) {
    slide.addText(content.number, {
      x: pxToInches(element.x, scale),
      y: pxToInches(centerY - titleSize - numberSize - 16, scale),
      w: pxToInches(element.w, scale),
      h: pxToInches(numberSize, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: numberSize,
      bold: true,
      color: accent,
      fit: "shrink",
      align: "center",
      valign: "middle",
    });
  }

  slide.addText(content.title, {
    x: pxToInches(element.x + 48, scale),
    y: pxToInches(centerY - titleSize / 2, scale),
    w: pxToInches(element.w - 96, scale),
    h: pxToInches(titleSize + 16, scale),
    margin: 0,
    fontFace: graph.slide.theme.fontFamily,
    fontSize: titleSize,
    bold: true,
    color: normalizeColor(graph.slide.theme.titleColor),
    fit: "shrink",
    align: "center",
    valign: "middle",
  });

  if (content.intro) {
    slide.addText(content.intro, {
      x: pxToInches(element.x + 48, scale),
      y: pxToInches(centerY + titleSize + 16, scale),
      w: pxToInches(element.w - 96, scale),
      h: pxToInches(introSize * 2, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: introSize,
      color: normalizeColor(graph.slide.theme.textColor),
      fit: "shrink",
      align: "center",
    });
  }
}

function addSummary(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "summary" }>,
  scale: number,
): void {
  const content: SummaryContent = element.content;
  const accent = normalizeColor(element.style.color, graph.slide.theme.accentColor);
  const layout = content.layout ?? "takeaways";
  const titleSize = Math.max(28, Math.min(44, Math.round(element.h * 0.055)));
  const itemSize = Math.max(14, Math.min(18, Math.round(element.h * 0.022)));
  const ctaSize = Math.max(12, Math.min(16, Math.round(element.h * 0.018)));
  const padding = 48;

  if (layout === "thankYou") {
    slide.addShape(pptx.ShapeType.rect, {
      x: pxToInches(element.x, scale),
      y: pxToInches(element.y, scale),
      w: pxToInches(element.w, scale),
      h: pxToInches(element.h, scale),
      fill: { color: accent, transparency: 94 },
    });

    slide.addText(content.title, {
      x: pxToInches(element.x, scale),
      y: pxToInches(element.y + element.h * 0.4, scale),
      w: pxToInches(element.w, scale),
      h: pxToInches(titleSize * 1.5, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: Math.round(titleSize * 1.3),
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
      align: "center",
      valign: "middle",
    });

    if (content.contact) {
      slide.addText(content.contact, {
        x: pxToInches(element.x, scale),
        y: pxToInches(element.y + element.h * 0.4 + titleSize * 1.5 + 24, scale),
        w: pxToInches(element.w, scale),
        h: pxToInches(ctaSize * 1.5, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: ctaSize,
        color: normalizeColor(graph.slide.theme.textColor),
        fit: "shrink",
        align: "center",
      });
    }
    return;
  }

  slide.addText(content.title, {
    x: pxToInches(element.x + padding, scale),
    y: pxToInches(element.y + padding, scale),
    w: pxToInches(element.w - padding * 2, scale),
    h: pxToInches(titleSize + 16, scale),
    margin: 0,
    fontFace: graph.slide.theme.fontFamily,
    fontSize: titleSize,
    bold: true,
    color: normalizeColor(graph.slide.theme.titleColor),
    fit: "shrink",
    align: layout === "cta" ? "center" : "left",
  });

  if (content.takeaways?.length) {
    const itemGap = 16;
    const startY = element.y + padding + titleSize + 32;
    content.takeaways.forEach((item, index) => {
      const y = startY + index * (itemSize + itemGap + 8);
      slide.addText(`鉁?${item}`, {
        x: pxToInches(element.x + padding + 36, scale),
        y: pxToInches(y, scale),
        w: pxToInches(element.w - padding * 2 - 36, scale),
        h: pxToInches(itemSize + 8, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: itemSize,
        color: normalizeColor(graph.slide.theme.textColor),
        fit: "shrink",
      });
    });
  }

  if (content.callToAction) {
    if (layout === "cta") {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: pxToInches(element.x + element.w / 2 - 100, scale),
        y: pxToInches(element.y + element.h - padding - 48, scale),
        w: pxToInches(200, scale),
        h: pxToInches(36, scale),
        fill: { color: accent },
      });
      slide.addText(content.callToAction, {
        x: pxToInches(element.x + element.w / 2 - 100, scale),
        y: pxToInches(element.y + element.h - padding - 42, scale),
        w: pxToInches(200, scale),
        h: pxToInches(28, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: ctaSize,
        bold: true,
        color: "FFFFFF",
        fit: "shrink",
        align: "center",
        valign: "middle",
      });
    } else {
      slide.addText(content.callToAction, {
        x: pxToInches(element.x + padding, scale),
        y: pxToInches(element.y + element.h - padding - ctaSize - 8, scale),
        w: pxToInches(element.w - padding * 2, scale),
        h: pxToInches(ctaSize + 8, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: ctaSize,
        bold: true,
        color: accent,
        fit: "shrink",
      });
    }
  }

  if (content.contact && layout === "cta") {
    slide.addText(content.contact, {
      x: pxToInches(element.x + padding, scale),
      y: pxToInches(element.y + element.h - padding - ctaSize - 8, scale),
      w: pxToInches(element.w - padding * 2, scale),
      h: pxToInches(ctaSize, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: ctaSize - 2,
      color: normalizeColor(graph.slide.theme.textColor),
      transparency: 30,
      fit: "shrink",
      align: "center",
    });
  }
}

function addTextBox(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "title" | "text" }>,
  scale: number,
): void {
  const fontFace = resolvePptFontFace(graph.slide.theme.fontFamily, element.content.text);
  const chromeColor = headerBandTextColor(graph, element);
  const hasFill = Boolean(element.style.backgroundColor) || (element.style.fill !== undefined && element.style.fill.type !== "none");
  const borderWidth = pxToPoints(element.style.borderWidth) ?? 0;
  const hasBorder = borderWidth > 0 && Boolean(element.style.borderColor);
  slide.addText(element.content.text, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    margin: 0,
    fontFace,
    fontSize: pxToPoints(element.style.fontSize) ?? 18,
    bold: (element.style.fontWeight ?? 400) >= 600,
    color: normalizeColor(
      chromeColor ?? element.style.color,
      element.type === "title" ? graph.slide.theme.titleColor : graph.slide.theme.textColor,
    ),
    align: element.style.textAlign ?? "left",
    valign: "top",
    fit: "shrink",
    breakLine: false,
    ...(element.style.lineHeight !== undefined
      ? { lineSpacingMultiple: element.style.lineHeight }
      : {}),
    ...(hasFill
      ? {
          fill: {
            color: toneFillColor(graph, element, "FFFFFF"),
            transparency: toneFillTransparency(element),
          },
        }
      : {}),
    ...(hasBorder
      ? {
          line: {
            color: normalizeColor(element.style.borderColor),
            pt: borderWidth,
            dashType: element.style.borderStyle === "dashed" ? "dash" : "solid",
          },
        }
      : {}),
    ...((hasFill || hasBorder) && element.style.borderRadius
      ? { shape: pptx.ShapeType.roundRect }
      : {}),
  });
}

function addBulletList(
  slide: PptxGenJS.Slide,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "bulletList" }>,
  scale: number,
): void {
  const text = element.content.items.map((item) => `鈥?${item}`).join("\n");
  slide.addText(text, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    margin: 0,
    fontFace: graph.slide.theme.fontFamily,
    fontSize: pxToPoints(element.style.fontSize) ?? 14,
    bold: (element.style.fontWeight ?? 400) >= 600,
    color: normalizeColor(element.style.color, graph.slide.theme.textColor),
    align: element.style.textAlign ?? "left",
    valign: "top",
    fit: "shrink",
    breakLine: false,
    ...(element.style.lineHeight !== undefined
      ? { lineSpacingMultiple: element.style.lineHeight }
      : {}),
  });
}

function addCallout(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "callout" }>,
  scale: number,
): void {
  const titleHeight = Math.min(Math.max(element.h * 0.3, 36), 72);
  if (element.style.backgroundColor || element.style.fill || element.style.borderColor || element.style.borderWidth) {
    const fillColor = toneFillColor(graph, element, "FFFFFF");
    const borderWidth = pxToPoints(element.style.borderWidth) ?? 0;
    slide.addShape(element.style.borderRadius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
      x: pxToInches(element.x, scale),
      y: pxToInches(element.y, scale),
      w: pxToInches(element.w, scale),
      h: pxToInches(element.h, scale),
      line: {
        color: toneBorderColor(graph, element, fillColor),
        transparency: borderWidth > 0 ? 0 : 100,
        pt: borderWidth,
        dashType: element.style.borderStyle === "dashed" ? "dash" : "solid",
      },
      fill: {
        color: fillColor,
        transparency: toneFillTransparency(element),
      },
    });
  }

  slide.addText(element.content.title, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(titleHeight, scale),
    margin: 0,
    fontFace: graph.slide.theme.fontFamily,
    fontSize: pxToPoints((element.style.fontSize ?? 24) + 4) ?? 20,
    bold: true,
    color: normalizeColor(graph.slide.theme.titleColor),
    valign: "top",
    fit: "shrink",
  });

  slide.addText(element.content.text, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y + titleHeight + 12, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(Math.max(element.h - titleHeight - 12, 12), scale),
    margin: 0,
    fontFace: graph.slide.theme.fontFamily,
    fontSize: pxToPoints(element.style.fontSize) ?? 16,
    color: normalizeColor(element.style.color, graph.slide.theme.textColor),
    valign: "top",
    fit: "shrink",
  });
}

function addMetric(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "metric" }>,
  scale: number,
): void {
  const fillColor = toneFillColor(graph, element, "FFFFFF");
  const borderColor = toneBorderColor(graph, element, "E8E3DB");
  const borderWidth = pxToPoints(element.style.borderWidth) ?? pxToPoints(1) ?? 0.75;
  const padding = element.style.padding ?? 24;
  const accent = normalizeColor(element.style.color, graph.slide.theme.accentColor);

  slide.addShape(element.style.borderRadius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    line: {
      color: borderColor,
      pt: borderWidth,
      dashType: element.style.borderStyle === "dashed" ? "dash" : "solid",
    },
    fill: {
      color: fillColor,
      transparency: toneFillTransparency(element),
    },
  });

  slide.addText(element.content.value, {
    x: pxToInches(element.x + padding, scale),
    y: pxToInches(element.y + padding, scale),
    w: pxToInches(element.w - padding * 2, scale),
    h: pxToInches(Math.max(28, element.h * 0.34), scale),
    margin: 0,
    fontFace: graph.slide.theme.fontFamily,
    fontSize: pxToPoints(Math.max(34, Math.min(72, Math.round(element.h * 0.25)))) ?? 32,
    bold: true,
    color: accent,
    fit: "shrink",
    valign: "middle",
  });

  slide.addText(element.content.label, {
    x: pxToInches(element.x + padding, scale),
    y: pxToInches(element.y + padding + Math.max(28, element.h * 0.34), scale),
    w: pxToInches(element.w - padding * 2, scale),
    h: pxToInches(Math.max(22, element.h * 0.18), scale),
    margin: 0,
    fontFace: graph.slide.theme.fontFamily,
    fontSize: pxToPoints(Math.max(16, Math.round(element.h * 0.09))) ?? 16,
    bold: true,
    color: normalizeColor(graph.slide.theme.titleColor),
    fit: "shrink",
    valign: "middle",
  });

  if (element.content.note) {
    slide.addText(element.content.note, {
      x: pxToInches(element.x + padding, scale),
      y: pxToInches(element.y + element.h - padding - Math.max(24, element.h * 0.16), scale),
      w: pxToInches(element.w - padding * 2, scale),
      h: pxToInches(Math.max(24, element.h * 0.16), scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: pxToPoints(Math.max(12, Math.round(element.h * 0.06))) ?? 12,
      color: normalizeColor(element.style.color, graph.slide.theme.textColor),
      fit: "shrink",
      valign: "middle",
    });
  }
}

function addFrameworkRail(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "frameworkRail" }>,
  scale: number,
  layoutPlan?: PptxLayoutPlan,
): void {
  const content: FrameworkRailContent = element.content;
  const palette = resolvePrimitiveTonePalette(
    graph.slide.theme,
    content.tone === "accent" || content.tone === "success" || content.tone === "warning" || content.tone === "neutral"
      ? content.tone
      : "accent",
  );
  const padding = element.style.padding ?? 24;
  const fontFace = resolvePptFontFace(
    graph.slide.theme.fontFamily,
    [content.label, content.title, content.summary, ...(content.bullets ?? []), content.footerTitle, ...(content.footerItems ?? [])]
      .filter(Boolean)
      .join(" "),
  );
  const innerWidth = element.w - padding * 2;
  const denseMode = content.densityClass === "dense" || (content.bullets?.length ?? 0) >= 5 || (content.summary?.length ?? 0) >= 58;
  const elementPlan = findElementPlan(layoutPlan, element.id);
  const titleSize = content.layout === "top" ? 17 : denseMode ? 14.5 : 15.5;
  const panelBackground = `#${palette.pptFill}`;
  const titleTextColor = safePptTextColor(panelBackground, graph.slide.theme.titleColor, graph.slide.theme.titleColor);
  const bodyTextColor = safePptTextColor(panelBackground, graph.slide.theme.textColor, graph.slide.theme.textColor);
  const accentTextColor = safePptTextColor(panelBackground, palette.pptText, graph.slide.theme.accentColor);

  slide.addShape(pptx.ShapeType.roundRect, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    line: { color: safePptBorderColor(panelBackground, palette.pptBorder, graph.slide.theme.accentColor), transparency: 78, pt: pxToPoints(element.style.borderWidth) ?? pxToPoints(1) ?? 0.75 },
    fill: { color: palette.pptFill, transparency: 82 },
  });

  let cursorY = element.y + padding;
  if (content.label) {
    slide.addShape(pptx.ShapeType.line, {
      x: pxToInches(element.x + padding, scale),
      y: pxToInches(cursorY + 8, scale),
      w: pxToInches(24, scale),
      h: 0,
      line: { color: accentTextColor, pt: pxToPoints(3) ?? 2.25 },
    });
    slide.addText(content.label, {
      x: pxToInches(element.x + padding + 34, scale),
      y: pxToInches(cursorY, scale),
      w: pxToInches(Math.max(40, element.w - padding * 2 - 34), scale),
      h: pxToInches(18, scale),
      margin: 0,
      fontFace,
      fontSize: 9.5,
      bold: true,
      color: accentTextColor,
      fit: "shrink",
    });
    cursorY += 24;
  }

  const effectiveIcon = content.icon ?? fallbackFrameworkIcon(content);
  if (effectiveIcon && elementPlan?.preserveVisualAid) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: pxToInches(element.x + padding, scale),
      y: pxToInches(cursorY, scale),
      w: pxToInches(28, scale),
      h: pxToInches(28, scale),
      line: { color: safePptBorderColor("#FFF4EE", palette.pptBorder, graph.slide.theme.accentColor), pt: pxToPoints(1) ?? 0.75 },
      fill: { color: palette.pptFill, transparency: 84 },
    });
    slide.addImage({
      data: dataUriFromSvg(wrapIconSvg({ name: effectiveIcon }, `#${safePptTextColor("#FFF4EE", palette.pptText, graph.slide.theme.accentColor)}`)),
      x: pxToInches(element.x + padding + 5, scale),
      y: pxToInches(cursorY + 5, scale),
      w: pxToInches(18, scale),
      h: pxToInches(18, scale),
    });
    cursorY += 36;
  }

  const titleHeight = estimateTextBlockHeightPx(content.title, innerWidth, titleSize, 1.18, 1, 4);
  slide.addText(content.title, {
    x: pxToInches(element.x + padding, scale),
    y: pxToInches(cursorY, scale),
    w: pxToInches(innerWidth, scale),
    h: pxToInches(titleHeight, scale),
    margin: 0,
    fontFace,
    fontSize: titleSize,
    bold: true,
    color: titleTextColor,
    fit: "shrink",
  });
  cursorY += titleHeight + 12;

  if (content.summary) {
    const summaryHeight = estimateTextBlockHeightPx(content.summary, innerWidth, denseMode ? 11 : 11.5, 1.25, 2, 6);
    slide.addText(content.summary, {
      x: pxToInches(element.x + padding, scale),
      y: pxToInches(cursorY, scale),
      w: pxToInches(innerWidth, scale),
      h: pxToInches(summaryHeight, scale),
      margin: 0,
      fontFace,
      fontSize: denseMode ? 10.5 : 11,
      color: bodyTextColor,
      valign: "top",
      fit: "shrink",
      paraSpaceAfter: 4,
    });
    cursorY += summaryHeight + 14;
  }

  if (content.bullets?.length) {
    const bulletLines = content.bullets.map((item, index) => ({
      text: item,
      options: {
        bullet: { indent: 12 },
        breakLine: index < content.bullets!.length - 1,
        paraSpaceAfter: 5,
      },
    }));
    const bulletHeight = estimateTextBlockHeightPx(content.bullets.join(" "), innerWidth - 12, denseMode ? 9.2 : 9.8, 1.38, content.bullets.length, 9);
    slide.addText(bulletLines, {
      x: pxToInches(element.x + padding, scale),
      y: pxToInches(cursorY, scale),
      w: pxToInches(innerWidth, scale),
      h: pxToInches(Math.max(64, bulletHeight + 8), scale),
      margin: 1,
      fontFace,
      fontSize: denseMode ? 9.2 : 9.8,
      color: bodyTextColor,
      breakLine: true,
      fit: "shrink",
      valign: "top",
    });
    cursorY += Math.max(64, bulletHeight + 8) + 14;
  }

  const showFooterChips = element.h >= (denseMode ? 230 : 260);
  if (showFooterChips && content.footerTitle) {
    slide.addText(content.footerTitle, {
      x: pxToInches(element.x + padding, scale),
      y: pxToInches(Math.min(cursorY + 2, element.y + element.h - 80), scale),
      w: pxToInches(element.w - padding * 2, scale),
      h: pxToInches(16, scale),
      margin: 0,
      fontFace,
      fontSize: 8.5,
      bold: true,
      color: accentTextColor,
      fit: "shrink",
    });
    cursorY += 22;
  }

  if (showFooterChips && content.footerItems?.length) {
    let chipX = element.x + padding;
    let chipY = Math.min(cursorY, element.y + element.h - 56);
    for (const item of content.footerItems) {
      const chipW = Math.min(
        element.w - padding * 2,
        Math.max(104, Math.round(estimateTextUnits(item) * 9.2 + 30)),
      );
      if (chipX + chipW > element.x + element.w - padding) {
        chipX = element.x + padding;
        chipY += 28;
      }
      slide.addShape(pptx.ShapeType.roundRect, {
        x: pxToInches(chipX, scale),
        y: pxToInches(chipY, scale),
        w: pxToInches(chipW, scale),
        h: pxToInches(24, scale),
        line: { color: safePptBorderColor("#FFFFFF", palette.pptBorder, graph.slide.theme.accentColor), transparency: 78, pt: pxToPoints(1) ?? 0.75 },
        fill: { color: "FFFFFF", transparency: 4 },
      });
      slide.addText(item, {
        x: pxToInches(chipX + 10, scale),
        y: pxToInches(chipY + 5, scale),
        w: pxToInches(chipW - 20, scale),
        h: pxToInches(14, scale),
        margin: 0,
        fontFace,
        fontSize: 8.5,
        bold: true,
        color: safePptTextColor("#FFFFFF", graph.slide.theme.titleColor, graph.slide.theme.titleColor),
        fit: "shrink",
      });
      chipX += chipW + 8;
    }
  }
}

function addActionCardGroup(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "actionCardGroup" }>,
  scale: number,
  layoutPlan?: PptxLayoutPlan,
): void {
  const content: ActionCardGroupContent = element.content;
  const layout = computeActionCardGroupLayout(content, { w: element.w, h: element.h });
  const groupPlan = findElementPlan(layoutPlan, element.id);
  const fontFace = resolvePptFontFace(
    graph.slide.theme.fontFamily,
    [content.title, ...content.items.flatMap((item) => [item.step, item.eyebrow, item.title, item.body, item.emphasis])]
      .filter(Boolean)
      .join(" "),
  );

  if (content.title) {
    slide.addText(content.title, {
      x: pxToInches(element.x + layout.padding, scale),
      y: pxToInches(element.y + layout.padding, scale),
      w: pxToInches(element.w - layout.padding * 2, scale),
      h: pxToInches(layout.titleHeight, scale),
      margin: 0,
      fontFace,
      fontSize: 11,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });
  }

  layout.slots.forEach((slot) => {
    const item = content.items[slot.itemIndex];
    const denseMode = content.densityClass === "dense" || content.items.length >= 5;
    const compactCard = denseMode || slot.weight === "compact" || slot.w < 320 || slot.h < 170;
    const iconPlacement = content.iconPlacement ?? groupPlan?.iconPlacement ?? "inline";
    const palette = resolvePrimitiveTonePalette(
      graph.slide.theme,
      item.tone === "accent" || item.tone === "success" || item.tone === "warning" || item.tone === "neutral"
        ? item.tone
        : slot.weight === "lead"
          ? "accent"
          : "default",
    );
    const cardX = element.x + slot.x;
    const cardY = element.y + slot.y;
    const padding = compactCard ? 16 : 18;
    const cardBackground = `#${palette.pptFill}`;
    const titleTextColor = safePptTextColor(cardBackground, graph.slide.theme.titleColor, graph.slide.theme.titleColor);
    const bodyTextColor = safePptTextColor(cardBackground, graph.slide.theme.textColor, graph.slide.theme.textColor);
    const accentTextColor = safePptTextColor(cardBackground, palette.pptText, graph.slide.theme.accentColor);

    slide.addShape(pptx.ShapeType.roundRect, {
      x: pxToInches(cardX, scale),
      y: pxToInches(cardY, scale),
      w: pxToInches(slot.w, scale),
      h: pxToInches(slot.h, scale),
      line: { color: safePptBorderColor(cardBackground, palette.pptBorder, graph.slide.theme.accentColor), transparency: slot.weight === "lead" ? 64 : 86, pt: pxToPoints(1) ?? 0.75 },
      fill: { color: palette.pptFill, transparency: slot.weight === "lead" ? 84 : Math.min(palette.pptFillTransparency, 88) },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: pxToInches(cardX, scale),
      y: pxToInches(cardY, scale),
      w: pxToInches(slot.w, scale),
      h: pxToInches(slot.weight === "lead" ? 7 : 5, scale),
      line: { color: normalizeColor(graph.slide.theme.accentColor), transparency: 100, pt: 0 },
      fill: { color: normalizeColor(graph.slide.theme.accentColor), transparency: slot.weight === "lead" ? 0 : 48 },
    });

    let cursorY = cardY + padding;
    const effectiveIcon = item.icon ?? fallbackActionIcon(content, slot.itemIndex);
    if (!effectiveIcon && (item.step || (!compactCard && item.eyebrow))) {
      const chipText = item.step ?? item.eyebrow ?? "";
      const chipW = Math.max(56, Math.min(slot.w - padding * 2, chipText.length * 11 + 22));
      slide.addShape(pptx.ShapeType.roundRect, {
        x: pxToInches(cardX + padding, scale),
        y: pxToInches(cursorY, scale),
        w: pxToInches(chipW, scale),
        h: pxToInches(22, scale),
        line: { color: safePptBorderColor(`#${palette.pptFill}`, palette.pptBorder, graph.slide.theme.accentColor), pt: pxToPoints(1) ?? 0.75 },
        fill: { color: palette.pptFill, transparency: slot.weight === "lead" ? 84 : Math.max(0, Math.min(palette.pptFillTransparency, 88) - 8) },
      });
      slide.addText(chipText, {
        x: pxToInches(cardX + padding + 8, scale),
        y: pxToInches(cursorY + 4, scale),
        w: pxToInches(chipW - 16, scale),
        h: pxToInches(14, scale),
        margin: 0,
        fontFace,
        fontSize: 8.5,
        bold: true,
        color: safePptTextColor(`#${palette.pptFill}`, palette.pptText, graph.slide.theme.accentColor),
        fit: "shrink",
      });
      cursorY += 30;
    }

    if (effectiveIcon && groupPlan?.preserveVisualAid && iconPlacement === "stacked") {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: pxToInches(cardX + padding, scale),
        y: pxToInches(cursorY, scale),
        w: pxToInches(30, scale),
        h: pxToInches(30, scale),
        line: { color: safePptBorderColor("#FFF4EE", palette.pptBorder, graph.slide.theme.accentColor), pt: pxToPoints(1) ?? 0.75 },
        fill: { color: palette.pptFill, transparency: 84 },
      });
      slide.addImage({
        data: dataUriFromSvg(wrapIconSvg({ name: effectiveIcon }, `#${safePptTextColor("#FFF4EE", palette.pptText, graph.slide.theme.accentColor)}`)),
        x: pxToInches(cardX + padding + 6, scale),
        y: pxToInches(cursorY + 6, scale),
        w: pxToInches(18, scale),
        h: pxToInches(18, scale),
      });
      cursorY += 40;
    } else if (!effectiveIcon && (content.visualAid === "accentStrip" || groupPlan?.visualAidMode === "accentStrip")) {
      slide.addShape(pptx.ShapeType.line, {
        x: pxToInches(cardX + padding, scale),
        y: pxToInches(cursorY + 2, scale),
        w: pxToInches(40, scale),
        h: 0,
        line: { color: accentTextColor, pt: pxToPoints(3) ?? 2.25 },
      });
      cursorY += 14;
    }

    const titleSize = slot.weight === "lead" ? 12.5 : compactCard ? 10.5 : 11;
    const inlineIconWidth = effectiveIcon && iconPlacement === "inline" && groupPlan?.preserveVisualAid ? 34 : 0;
    if (effectiveIcon && iconPlacement === "inline" && groupPlan?.preserveVisualAid) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: pxToInches(cardX + padding, scale),
        y: pxToInches(cursorY + 1, scale),
        w: pxToInches(28, scale),
        h: pxToInches(28, scale),
        line: { color: safePptBorderColor("#FFF4EE", palette.pptBorder, graph.slide.theme.accentColor), pt: pxToPoints(1) ?? 0.75 },
        fill: { color: palette.pptFill, transparency: 84 },
      });
      slide.addImage({
        data: dataUriFromSvg(wrapIconSvg({ name: effectiveIcon }, `#${safePptTextColor("#FFF4EE", palette.pptText, graph.slide.theme.accentColor)}`)),
        x: pxToInches(cardX + padding + 5, scale),
        y: pxToInches(cursorY + 6, scale),
        w: pxToInches(18, scale),
        h: pxToInches(18, scale),
      });
    }
    const titleHeight = estimateTextBlockHeightPx(item.title, slot.w - padding * 2 - inlineIconWidth, titleSize, 1.16, 1, 3);
    slide.addText(item.title, {
      x: pxToInches(cardX + padding + inlineIconWidth, scale),
      y: pxToInches(cursorY, scale),
      w: pxToInches(slot.w - padding * 2 - inlineIconWidth, scale),
      h: pxToInches(Math.max(slot.weight === "lead" ? 34 : 28, titleHeight), scale),
      margin: 0,
      fontFace,
      fontSize: titleSize,
      bold: true,
      color: titleTextColor,
      fit: "shrink",
      valign: "middle",
    });
    cursorY += Math.max(slot.weight === "lead" ? 34 : 28, titleHeight) + 10;

    const emphasisReserve = item.emphasis && (!compactCard || slot.weight === "lead") ? 28 : 0;
    const bodyHeight = Math.max(32, slot.h - (cursorY - cardY) - padding - emphasisReserve);

    slide.addText(item.body, {
      x: pxToInches(cardX + padding, scale),
      y: pxToInches(cursorY, scale),
      w: pxToInches(slot.w - padding * 2, scale),
      h: pxToInches(bodyHeight, scale),
      margin: 0,
      fontFace,
      fontSize: compactCard ? 9.1 : slot.weight === "compact" ? 9.25 : 9.75,
      color: slot.weight === "lead" ? titleTextColor : bodyTextColor,
      fit: "shrink",
      valign: "top",
    });

    if (item.emphasis && (!compactCard || slot.weight === "lead")) {
      slide.addText(item.emphasis, {
        x: pxToInches(cardX + padding, scale),
        y: pxToInches(cardY + slot.h - padding - 18, scale),
        w: pxToInches(slot.w - padding * 2, scale),
        h: pxToInches(18, scale),
        margin: 0,
        fontFace,
        fontSize: 8.5,
        bold: true,
        color: accentTextColor,
        fit: "shrink",
      });
    }
  });
}

function addObjectiveBand(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "objectiveBand" }>,
  scale: number,
  layoutPlan?: PptxLayoutPlan,
): void {
  const content: ObjectiveBandContent = element.content;
  const palette = resolvePrimitiveTonePalette(
    graph.slide.theme,
    content.tone === "accent" || content.tone === "success" || content.tone === "warning" || content.tone === "neutral"
      ? content.tone
      : "accent",
  );
  const background = normalizeColor(element.style.backgroundColor, "FFF8F4");
  const fontFace = resolvePptFontFace(
    graph.slide.theme.fontFamily,
    [content.label, content.text, content.emphasis].filter(Boolean).join(" "),
  );
  const elementPlan = findElementPlan(layoutPlan, element.id);
  const backgroundCss = `#${background}`;
  const denseMode = content.densityClass === "dense" || element.h <= 124;
  const titleTextColor = safePptTextColor(backgroundCss, graph.slide.theme.titleColor, graph.slide.theme.titleColor);
  const accentTextColor = safePptTextColor(backgroundCss, palette.pptText, graph.slide.theme.accentColor);

  slide.addShape(pptx.ShapeType.roundRect, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    line: { color: safePptBorderColor(backgroundCss, element.style.borderColor ?? palette.pptBorder, graph.slide.theme.accentColor), pt: pxToPoints(element.style.borderWidth) ?? 0.75 },
    fill: { color: background },
  });

  let textX = element.x + 24;
  const innerY = element.y + (denseMode ? 12 : 14);
  const innerH = Math.max(26, element.h - (denseMode ? 24 : 28));
  const effectiveIcon = content.icon ?? fallbackObjectiveIcon();
  if (content.label || (effectiveIcon && elementPlan?.preserveVisualAid)) {
    const chipW = Math.max(denseMode ? 64 : 72, Math.min(180, (content.label?.length ?? 0) * 11 + (effectiveIcon ? 48 : 26)));
    slide.addShape(pptx.ShapeType.roundRect, {
      x: pxToInches(textX, scale),
      y: pxToInches(element.y + Math.max(10, (element.h - 28) / 2), scale),
      w: pxToInches(chipW, scale),
      h: pxToInches(denseMode ? 26 : 28, scale),
      line: { color: safePptBorderColor(`#${palette.pptFill}`, palette.pptBorder, graph.slide.theme.accentColor), pt: pxToPoints(1) ?? 0.75 },
      fill: { color: palette.pptFill, transparency: 84 },
    });
    if (effectiveIcon && elementPlan?.preserveVisualAid) {
      slide.addImage({
        data: dataUriFromSvg(wrapIconSvg({ name: effectiveIcon }, `#${safePptTextColor(`#${palette.pptFill}`, palette.pptText, graph.slide.theme.accentColor)}`)),
        x: pxToInches(textX + 9, scale),
        y: pxToInches(element.y + Math.max(13, (element.h - 18) / 2) - 1, scale),
        w: pxToInches(18, scale),
        h: pxToInches(18, scale),
      });
    }
    slide.addText(content.label ?? "", {
      x: pxToInches(textX + (effectiveIcon ? 30 : 10), scale),
      y: pxToInches(element.y + Math.max(14, (element.h - 18) / 2), scale),
      w: pxToInches(chipW - (effectiveIcon ? 40 : 20), scale),
      h: pxToInches(18, scale),
      margin: 0,
      fontFace,
      fontSize: denseMode ? 9 : 10,
      bold: true,
      color: safePptTextColor(`#${palette.pptFill}`, palette.pptText, graph.slide.theme.accentColor),
      fit: "shrink",
    });
    textX += chipW + 16;
  }

  const remainingWidth = Math.max(180, element.x + element.w - textX - 24);
  const emphasisWidth = content.emphasis
    ? Math.min(
      Math.max(denseMode ? 120 : 150, Math.round(estimateTextUnits(content.emphasis) * 10)),
      Math.max(denseMode ? 120 : 150, Math.round(remainingWidth * (denseMode ? 0.3 : 0.34))),
    )
    : 0;
  const gap = content.emphasis ? 14 : 0;
  const bodyWidth = Math.max(160, remainingWidth - emphasisWidth - gap);
  const bodyFontSize = pxToPoints(denseMode ? Math.max(15, Math.round(element.h * 0.18)) : Math.max(16, Math.round(element.h * 0.2))) ?? 12;

  slide.addText(content.text, {
    x: pxToInches(textX, scale),
    y: pxToInches(innerY, scale),
    w: pxToInches(bodyWidth, scale),
    h: pxToInches(innerH, scale),
    margin: 0,
    fontFace,
    fontSize: bodyFontSize,
    bold: true,
    color: titleTextColor,
    fit: "shrink",
    valign: "middle",
  });

  if (content.emphasis) {
    slide.addText(content.emphasis, {
      x: pxToInches(textX + bodyWidth + gap, scale),
      y: pxToInches(innerY, scale),
      w: pxToInches(emphasisWidth, scale),
      h: pxToInches(innerH, scale),
      margin: 0,
      fontFace,
      fontSize: Math.max(bodyFontSize, 12),
      bold: true,
      color: accentTextColor,
      fit: "shrink",
      valign: "middle",
      align: "right",
    });
  }
}

function addPageBadge(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "pageBadge" }>,
  scale: number,
): void {
  if (!graph.slide.theme.showPageBadge) {
    return;
  }
  const content: PageBadgeContent = element.content;
  const palette = resolvePrimitiveTonePalette(
    graph.slide.theme,
    content.tone === "accent" || content.tone === "success" || content.tone === "warning" || content.tone === "neutral"
      ? content.tone
      : "accent",
  );
  const fillColor = content.tone === "neutral" ? palette.pptFill : normalizeColor(graph.slide.theme.accentColor);
  const textColor = content.tone === "neutral"
    ? safePptTextColor(`#${fillColor}`, graph.slide.theme.titleColor, graph.slide.theme.titleColor)
    : safePptTextColor(`#${fillColor}`, `#${palette.inverseText}`, graph.slide.theme.accentColor);

  slide.addShape(pptx.ShapeType.roundRect, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    line: { color: fillColor, transparency: 100, pt: 0 },
    fill: { color: fillColor },
  });

  let cursorY = element.y + 10;
  if (content.label) {
    slide.addText(content.label, {
      x: pxToInches(element.x + 8, scale),
      y: pxToInches(cursorY, scale),
      w: pxToInches(element.w - 16, scale),
      h: pxToInches(12, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 8,
      bold: true,
      color: textColor,
      fit: "shrink",
      align: "center",
    });
    cursorY += 14;
  }

  slide.addText(content.value, {
    x: pxToInches(element.x + 8, scale),
    y: pxToInches(cursorY, scale),
    w: pxToInches(element.w - 16, scale),
    h: pxToInches(element.h - (cursorY - element.y) - 10, scale),
    margin: 0,
    fontFace: graph.slide.theme.fontFamily,
    fontSize: pxToPoints(Math.max(22, Math.round(element.h * 0.42))) ?? 16,
    bold: true,
    color: textColor,
    fit: "shrink",
    align: "center",
    valign: "middle",
  });
}

function addBadge(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "badge" }>,
  scale: number,
): void {
  const content: BadgeContent = element.content;
  const palette = resolvePrimitiveTonePalette(
    graph.slide.theme,
    content.tone === "accent" || content.tone === "success" || content.tone === "warning" || content.tone === "neutral"
      ? content.tone
      : "default",
  );
  const fillColor = content.tone ? palette.pptFill : toneFillColor(graph, element, "FFFFFF");
  const fillTransparency = content.tone ? palette.pptFillTransparency : 0;
  const textColor = content.tone
    ? safePptTextColor(`#${fillColor}`, palette.pptText, graph.slide.theme.accentColor)
    : safePptTextColor(`#${fillColor}`, element.style.color, graph.slide.theme.textColor);
  const borderColor = content.tone
    ? safePptBorderColor(`#${fillColor}`, palette.pptBorder, graph.slide.theme.accentColor)
    : safePptBorderColor(`#${fillColor}`, toneBorderColor(graph, element, "D9E0E8"), graph.slide.theme.accentColor);

  slide.addShape(pptx.ShapeType.roundRect, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    line: {
      color: borderColor,
      pt: pxToPoints(element.style.borderWidth) ?? pxToPoints(1) ?? 0.75,
      dashType: element.style.borderStyle === "dashed" ? "dash" : "solid",
    },
    fill: {
      color: fillColor,
      transparency: fillTransparency,
    },
  });

  slide.addText(content.text, {
    x: pxToInches(element.x + 10, scale),
    y: pxToInches(element.y + 2, scale),
    w: pxToInches(Math.max(10, element.w - 20), scale),
    h: pxToInches(Math.max(10, element.h - 4), scale),
    margin: 0,
    fontFace: graph.slide.theme.fontFamily,
    fontSize: pxToPoints(element.style.fontSize ?? Math.max(12, Math.min(18, Math.round(element.h * 0.38)))) ?? 12,
    bold: (element.style.fontWeight ?? 600) >= 600,
    color: textColor,
    fit: "shrink",
    align: "center",
    valign: "middle",
  });
}

function addShapeBlock(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "shape" }>,
  scale: number,
): void {
  const fillColor = toneFillColor(graph, element, "FFFFFF");
  const borderColor = toneBorderColor(graph, element, fillColor);
  const borderWidth = pxToPoints(element.style.borderWidth) ?? 0;
  const borderTransparency = borderWidth > 0 ? 0 : 100;
  const dash = element.style.borderStyle === "dashed" ? "dash" : "solid";

  slide.addShape(element.style.borderRadius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    line: {
      color: borderColor,
      transparency: borderTransparency,
      pt: borderWidth,
      dashType: dash,
    },
    fill: {
      color: fillColor,
      transparency: toneFillTransparency(element),
    },
  });
}

function addLine(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "line" | "divider" }>,
  scale: number,
): void {
  const isVertical = element.content.direction === "vertical";
  slide.addShape(pptx.ShapeType.line, {
    x: pxToInches(isVertical ? element.x + element.w / 2 : element.x, scale),
    y: pxToInches(isVertical ? element.y : element.y + element.h / 2, scale),
    w: pxToInches(isVertical ? 0 : element.w, scale),
    h: pxToInches(isVertical ? element.h : 0, scale),
    line: {
      color: normalizeColor(element.style.color, graph.slide.theme.accentColor),
      pt: pxToPoints(isVertical ? element.w || 2 : element.h || 2),
    },
  });
}

function addSvgBlock(
  slide: PptxGenJS.Slide,
  element: Extract<SceneElement, { type: "svg" }>,
  scale: number,
): void {
  slide.addImage({
    data: dataUriFromSvg(element.content.svg),
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
  });
}

function addIconBlock(
  slide: PptxGenJS.Slide,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "icon" }>,
  scale: number,
): void {
  const svg = wrapIconSvg(element.content, element.style.color ?? graph.slide.theme.accentColor);
  slide.addImage({
    data: dataUriFromSvg(svg),
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
  });
}

function addGrid(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "grid" }>,
  scale: number,
): void {
  const columnWidths = element.content.columnWidths?.length
    ? element.content.columnWidths
    : Array.from({ length: element.content.header.length }, () => element.w / element.content.header.length);
  const rowCount = element.content.rows.length + 1;
  const rowHeight = element.h / rowCount;
  const headerFill = "334155";
  const outerBorder = normalizeColor(element.style.borderColor, "D9D5CF");
  const innerBorder = "E7E3DD";

  slide.addShape(pptx.ShapeType.roundRect, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    line: {
      color: outerBorder,
      pt: pxToPoints(1),
    },
    fill: {
      color: "FFFFFF",
    },
  });

  let currentX = element.x;
  for (let index = 0; index < columnWidths.length; index += 1) {
    const columnWidth = columnWidths[index];

    slide.addShape(pptx.ShapeType.rect, {
      x: pxToInches(currentX, scale),
      y: pxToInches(element.y, scale),
      w: pxToInches(columnWidth, scale),
      h: pxToInches(rowHeight, scale),
      line: {
        color: headerFill,
        transparency: 100,
        pt: 0,
      },
      fill: {
        color: headerFill,
      },
    });

    slide.addText(element.content.header[index] ?? "", {
      x: pxToInches(currentX + 14, scale),
      y: pxToInches(element.y + 10, scale),
      w: pxToInches(Math.max(columnWidth - 28, 8), scale),
      h: pxToInches(Math.max(rowHeight - 20, 8), scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: pxToPoints(element.style.fontSize) ?? 12,
      bold: true,
      color: "FFFFFF",
      valign: "middle",
      fit: "shrink",
    });

    if (index < columnWidths.length - 1) {
      slide.addShape(pptx.ShapeType.line, {
        x: pxToInches(currentX + columnWidth, scale),
        y: pxToInches(element.y, scale),
        w: 0,
        h: pxToInches(element.h, scale),
        line: {
          color: innerBorder,
          pt: pxToPoints(1),
        },
      });
    }

    currentX += columnWidth;
  }

  for (let rowIndex = 1; rowIndex < rowCount; rowIndex += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: pxToInches(element.x, scale),
      y: pxToInches(element.y + rowHeight * rowIndex, scale),
      w: pxToInches(element.w, scale),
      h: 0,
      line: {
        color: innerBorder,
        pt: pxToPoints(1),
      },
    });
  }

  let rowY = element.y + rowHeight;
  for (let rowIndex = 0; rowIndex < element.content.rows.length; rowIndex += 1) {
    let cellX = element.x;
    const row = element.content.rows[rowIndex];
    for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
      const value = row[cellIndex];
      const columnWidth = columnWidths[cellIndex] ?? columnWidths[columnWidths.length - 1] ?? 0;
      slide.addText(value, {
        x: pxToInches(cellX + 14, scale),
        y: pxToInches(rowY + 10, scale),
        w: pxToInches(Math.max(columnWidth - 28, 8), scale),
        h: pxToInches(Math.max(rowHeight - 20, 8), scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: pxToPoints(element.style.fontSize) ?? 12,
        bold: cellIndex === 0,
        color: cellIndex === 0 ? "334155" : normalizeColor(element.style.color, graph.slide.theme.textColor),
        valign: "middle",
        fit: "shrink",
      });
      cellX += columnWidth;
    }
    rowY += rowHeight;
  }
}

function addTimeline(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "timeline" }>,
  scale: number,
): void {
  const content: TimelineContent = element.content;
  const accent = normalizeColor(element.style.color, graph.slide.theme.accentColor);
  const axisX = element.x + Math.max(26, Math.round(element.w * 0.085));
  const topY = element.y + 28;
  const bottomY = element.y + Math.max(68, element.h - 28);
  const itemGap = content.items.length > 1 ? (bottomY - topY) / (content.items.length - 1) : 0;
  const bodyX = axisX + 34;

  slide.addShape(pptx.ShapeType.line, {
    x: pxToInches(axisX, scale),
    y: pxToInches(topY, scale),
    w: 0,
    h: pxToInches(bottomY - topY, scale),
    line: {
      color: accent,
      transparency: 68,
      pt: pxToPoints(2),
    },
  });

  content.items.forEach((item, index) => {
    const y = topY + index * itemGap;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: pxToInches(axisX - 8, scale),
      y: pxToInches(y - 8, scale),
      w: pxToInches(16, scale),
      h: pxToInches(16, scale),
      line: { color: accent, transparency: 100, pt: 0 },
      fill: { color: accent },
    });

    if (item.meta) {
      slide.addText(item.meta, {
        x: pxToInches(bodyX, scale),
        y: pxToInches(y - 2, scale),
        w: pxToInches(element.x + element.w - bodyX - 12, scale),
        h: pxToInches(18, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 10,
        bold: true,
        color: accent,
        fit: "shrink",
      });
    }

    slide.addText(item.title, {
      x: pxToInches(bodyX, scale),
      y: pxToInches(y + (item.meta ? 18 : -2), scale),
      w: pxToInches(element.x + element.w - bodyX - 12, scale),
      h: pxToInches(30, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 16,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });

    if (item.body) {
      slide.addText(item.body, {
        x: pxToInches(bodyX, scale),
        y: pxToInches(y + (item.meta ? 50 : 28), scale),
        w: pxToInches(element.x + element.w - bodyX - 12, scale),
        h: pxToInches(Math.max(28, itemGap - 22), scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 11,
        color: normalizeColor(graph.slide.theme.textColor),
        fit: "shrink",
        valign: "top",
      });
    }
  });
}

function addChart(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "chart" }>,
  scale: number,
): void {
  const content: ChartContent = element.content;
  const fillColor = toneFillColor(graph, element, "FFFFFF");
  const borderColor = toneBorderColor(graph, element, "E8E3DB");
  const borderWidth = pxToPoints(element.style.borderWidth) ?? pxToPoints(1) ?? 0.75;

  slide.addShape(element.style.borderRadius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    line: {
      color: borderColor,
      pt: borderWidth,
      dashType: element.style.borderStyle === "dashed" ? "dash" : "solid",
    },
    fill: {
      color: fillColor,
      transparency: toneFillTransparency(element),
    },
  });

  if (content.chartType === "donut") {
    const svg = renderDonutChartSvg(graph, element, Math.max(10, element.w - 24), Math.max(10, element.h - 24));
    slide.addImage({
      data: dataUriFromSvg(svg),
      x: pxToInches(element.x + 12, scale),
      y: pxToInches(element.y + 12, scale),
      w: pxToInches(element.w - 24, scale),
      h: pxToInches(element.h - 24, scale),
    });
    return;
  }

  const padding = element.style.padding ?? 20;
  const innerX = element.x + padding;
  let cursorY = element.y + padding;

  if (content.title) {
    slide.addText(content.title, {
      x: pxToInches(innerX, scale),
      y: pxToInches(cursorY, scale),
      w: pxToInches(Math.max(10, element.w - padding * 2), scale),
      h: pxToInches(24, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 14,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });
    cursorY += 30;
  }

  const maxValue = content.maxValue ?? Math.max(...content.segments.map((segment) => segment.value), 1);
  const palette = [graph.slide.theme.accentColor, "#E69563", "#F0B48C", "#F6D2BB", "#FBE7DD"];
  const rowGap = 12;
  const rowHeight = content.chartType === "progress" ? 36 : 40;

  content.segments.forEach((segment, index) => {
    const color = normalizeColor(segment.color, normalizeColor(palette[index % palette.length], "C96F4A"));
    const trackY = cursorY + 18;
    const trackWidth = Math.max(80, element.w - padding * 2);
    const ratio = Math.max(0.04, Math.min(1, segment.value / Math.max(maxValue, 1)));

    slide.addText(segment.label, {
      x: pxToInches(innerX, scale),
      y: pxToInches(cursorY, scale),
      w: pxToInches(Math.max(40, trackWidth - 100), scale),
      h: pxToInches(16, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 10,
      bold: true,
      color: "334155",
      fit: "shrink",
    });

    slide.addText(String(segment.value), {
      x: pxToInches(element.x + element.w - padding - 80, scale),
      y: pxToInches(cursorY, scale),
      w: pxToInches(80, scale),
      h: pxToInches(16, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 10,
      bold: true,
      color: "334155",
      fit: "shrink",
      align: "right",
    });

    slide.addShape(pptx.ShapeType.roundRect, {
      x: pxToInches(innerX, scale),
      y: pxToInches(trackY, scale),
      w: pxToInches(trackWidth, scale),
      h: pxToInches(12, scale),
      line: { color: "EFE8DF", transparency: 100, pt: 0 },
      fill: { color: "EFE8DF" },
    });

    slide.addShape(pptx.ShapeType.roundRect, {
      x: pxToInches(innerX, scale),
      y: pxToInches(trackY, scale),
      w: pxToInches(Math.max(8, trackWidth * ratio), scale),
      h: pxToInches(12, scale),
      line: { color, transparency: 100, pt: 0 },
      fill: { color },
    });

    if (segment.note) {
      slide.addText(segment.note, {
        x: pxToInches(innerX, scale),
        y: pxToInches(trackY + 16, scale),
        w: pxToInches(trackWidth, scale),
        h: pxToInches(14, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 8,
        color: "64748B",
        fit: "shrink",
      });
    }

    cursorY += rowHeight + rowGap + (segment.note ? 12 : 0);
  });
}

function addComparison(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "comparison" }>,
  scale: number,
): void {
  const content: ComparisonContent = element.content;
  const fillColor = toneFillColor(graph, element, "FFFFFF");
  const borderColor = toneBorderColor(graph, element, "E8E3DB");
  const padding = element.style.padding ?? 18;
  const gap = 14;

  slide.addShape(pptx.ShapeType.roundRect, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    line: { color: borderColor, pt: pxToPoints(element.style.borderWidth) ?? pxToPoints(1) ?? 0.75 },
    fill: { color: fillColor, transparency: toneFillTransparency(element) },
  });

  const vertical = content.layout === "stack";
  const sideW = vertical ? element.w - padding * 2 : Math.floor((element.w - padding * 2 - gap) / 2);
  const sideH = vertical ? Math.floor((element.h - padding * 2 - gap - (content.conclusion ? 44 : 0)) / 2) : element.h - padding * 2 - (content.conclusion ? 44 : 0);

  const renderSide = (side: typeof content.left, x: number, y: number, w: number, h: number, toneFill: string) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: pxToInches(x, scale),
      y: pxToInches(y, scale),
      w: pxToInches(w, scale),
      h: pxToInches(h, scale),
      line: { color: "E8E3DB", pt: pxToPoints(1) ?? 0.75 },
      fill: { color: toneFill },
    });

    let cursorY = y + 16;
    if (side.badge) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: pxToInches(x + 16, scale),
        y: pxToInches(cursorY, scale),
        w: pxToInches(Math.min(w - 32, Math.max(60, side.badge.length * 12)), scale),
        h: pxToInches(22, scale),
        line: { color: normalizeColor(graph.slide.theme.accentColor), pt: pxToPoints(1) ?? 0.75 },
        fill: { color: normalizeColor(graph.slide.theme.accentColor), transparency: 90 },
      });
      slide.addText(side.badge, {
        x: pxToInches(x + 22, scale),
        y: pxToInches(cursorY + 4, scale),
        w: pxToInches(w - 44, scale),
        h: pxToInches(14, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 8,
        bold: true,
        color: normalizeColor(graph.slide.theme.accentColor),
        fit: "shrink",
      });
      cursorY += 30;
    }

    slide.addText(side.title, {
      x: pxToInches(x + 16, scale),
      y: pxToInches(cursorY, scale),
      w: pxToInches(w - 32, scale),
      h: pxToInches(28, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 16,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });
    cursorY += 34;

    if (side.body) {
      slide.addText(side.body, {
        x: pxToInches(x + 16, scale),
        y: pxToInches(cursorY, scale),
        w: pxToInches(w - 32, scale),
        h: pxToInches(36, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 11,
        color: normalizeColor(graph.slide.theme.textColor),
        fit: "shrink",
        valign: "top",
      });
      cursorY += 42;
    }

    if (side.bullets?.length) {
      slide.addText(side.bullets.map((item) => `鈥?${item}`).join("\n"), {
        x: pxToInches(x + 16, scale),
        y: pxToInches(cursorY, scale),
        w: pxToInches(w - 32, scale),
        h: pxToInches(Math.max(24, h - (cursorY - y) - 12), scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 11,
        color: normalizeColor(graph.slide.theme.textColor),
        fit: "shrink",
        valign: "top",
      });
    }
  };

  const leftX = element.x + padding;
  const leftY = element.y + padding;
  const rightX = vertical ? leftX : leftX + sideW + gap;
  const rightY = vertical ? leftY + sideH + gap : leftY;

  renderSide(content.left, leftX, leftY, sideW, sideH, "F6F3EE");
  renderSide(content.right, rightX, rightY, sideW, sideH, "FBE7DD");

  if (content.conclusion) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: pxToInches(element.x + padding, scale),
      y: pxToInches(element.y + element.h - padding - 30, scale),
      w: pxToInches(element.w - padding * 2, scale),
      h: pxToInches(30, scale),
      line: { color: normalizeColor(graph.slide.theme.accentColor), pt: pxToPoints(1) ?? 0.75 },
      fill: { color: normalizeColor(graph.slide.theme.accentColor), transparency: 92 },
    });
    slide.addText(content.conclusion, {
      x: pxToInches(element.x + padding + 10, scale),
      y: pxToInches(element.y + element.h - padding - 24, scale),
      w: pxToInches(element.w - padding * 2 - 20, scale),
      h: pxToInches(18, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 10,
      bold: true,
      color: "334155",
      fit: "shrink",
    });
  }
}

function addInsight(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "insight" }>,
  scale: number,
): void {
  const content: InsightContent = element.content;
  const toneColor =
    content.tone === "accent" ? normalizeColor(graph.slide.theme.accentColor)
      : content.tone === "success" ? "8A5B0A"
      : content.tone === "warning" ? "9B3418"
      : content.tone === "neutral" ? "475569"
      : normalizeColor(graph.slide.theme.accentColor);
  const fillColor =
    content.tone === "success" ? "FFF5D8"
      : content.tone === "warning" ? "FFF1E8"
      : content.tone === "neutral" ? "EEF2F7"
      : "FBE7DD";

  slide.addShape(pptx.ShapeType.roundRect, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    line: { color: toneColor, pt: pxToPoints(element.style.borderWidth) ?? pxToPoints(1) ?? 0.75 },
    fill: { color: fillColor, transparency: 70 },
  });

  let cursorY = element.y + (element.style.padding ?? 22);
  slide.addText(content.title, {
    x: pxToInches(element.x + 22, scale),
    y: pxToInches(cursorY, scale),
    w: pxToInches(element.w - 44, scale),
    h: pxToInches(18, scale),
    margin: 0,
    fontFace: graph.slide.theme.fontFamily,
    fontSize: 12,
    bold: true,
    color: toneColor,
    fit: "shrink",
  });
  cursorY += 28;

  slide.addText(`"${content.text}"`, {
    x: pxToInches(element.x + 22, scale),
    y: pxToInches(cursorY, scale),
    w: pxToInches(element.w - 44, scale),
    h: pxToInches(Math.max(40, element.h * 0.42), scale),
    margin: 0,
    fontFace: graph.slide.theme.fontFamily,
    fontSize: 22,
    bold: true,
    color: normalizeColor(graph.slide.theme.titleColor),
    fit: "shrink",
    valign: "top",
  });
  cursorY += Math.max(58, element.h * 0.42);

  if (content.emphasis) {
    slide.addText(content.emphasis, {
      x: pxToInches(element.x + 22, scale),
      y: pxToInches(cursorY, scale),
      w: pxToInches(element.w - 44, scale),
      h: pxToInches(24, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 14,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });
    cursorY += 30;
  }

  if (content.attribution) {
    slide.addText(content.attribution, {
      x: pxToInches(element.x + 22, scale),
      y: pxToInches(Math.min(cursorY, element.y + element.h - 30), scale),
      w: pxToInches(element.w - 44, scale),
      h: pxToInches(18, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 10,
      color: normalizeColor(graph.slide.theme.textColor),
      fit: "shrink",
    });
  }
}

function addMatrix(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "matrix" }>,
  scale: number,
): void {
  const content: MatrixContent = element.content;
  const fillColor = toneFillColor(graph, element, "FFFFFF");
  const borderColor = toneBorderColor(graph, element, "E8E3DB");
  const accent = normalizeColor(graph.slide.theme.accentColor);
  const padding = element.style.padding ?? 18;
  const gap = 12;
  const cellW = Math.floor((element.w - padding * 2 - gap) / 2);
  const cellH = Math.floor((element.h - padding * 2 - gap) / 2);
  const toneFill = (tone?: string) =>
    tone === "accent" ? "FBE7DD"
      : tone === "success" ? "FFF5D8"
      : tone === "warning" ? "FFF1E8"
      : tone === "neutral" ? "EEF2F7"
      : "FFFFFF";

  slide.addShape(pptx.ShapeType.roundRect, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    line: { color: borderColor, pt: pxToPoints(element.style.borderWidth) ?? pxToPoints(1) ?? 0.75 },
    fill: { color: fillColor, transparency: toneFillTransparency(element) },
  });

  const positionMap = {
    topLeft: { x: element.x + padding, y: element.y + padding },
    topRight: { x: element.x + padding + cellW + gap, y: element.y + padding },
    bottomLeft: { x: element.x + padding, y: element.y + padding + cellH + gap },
    bottomRight: { x: element.x + padding + cellW + gap, y: element.y + padding + cellH + gap },
  } as const;

  content.quadrants.forEach((quadrant) => {
    const box = positionMap[quadrant.position];
    slide.addShape(pptx.ShapeType.roundRect, {
      x: pxToInches(box.x, scale),
      y: pxToInches(box.y, scale),
      w: pxToInches(cellW, scale),
      h: pxToInches(cellH, scale),
      line: { color: quadrant.tone ? accent : "E8E3DB", pt: pxToPoints(1) ?? 0.75 },
      fill: { color: toneFill(quadrant.tone) },
    });

    let cursorY = box.y + 16;
    if (quadrant.badge) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: pxToInches(box.x + 16, scale),
        y: pxToInches(cursorY, scale),
        w: pxToInches(Math.min(cellW - 32, Math.max(60, quadrant.badge.length * 12)), scale),
        h: pxToInches(20, scale),
        line: { color: accent, pt: pxToPoints(1) ?? 0.75 },
        fill: { color: accent, transparency: 90 },
      });
      slide.addText(quadrant.badge, {
        x: pxToInches(box.x + 22, scale),
        y: pxToInches(cursorY + 3, scale),
        w: pxToInches(cellW - 44, scale),
        h: pxToInches(14, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 8,
        bold: true,
        color: accent,
        fit: "shrink",
      });
      cursorY += 28;
    }

    slide.addText(quadrant.title, {
      x: pxToInches(box.x + 16, scale),
      y: pxToInches(cursorY, scale),
      w: pxToInches(cellW - 32, scale),
      h: pxToInches(24, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 14,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });

    if (quadrant.body) {
      slide.addText(quadrant.body, {
        x: pxToInches(box.x + 16, scale),
        y: pxToInches(cursorY + 30, scale),
        w: pxToInches(cellW - 32, scale),
        h: pxToInches(cellH - (cursorY - box.y) - 42, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 10,
        color: normalizeColor(graph.slide.theme.textColor),
        fit: "shrink",
        valign: "top",
      });
    }
  });
}

function addMiniDiagram(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "miniDiagram" }>,
  scale: number,
): void {
  const content: MiniDiagramContent = element.content;
  const fillColor = toneFillColor(graph, element, "FFFFFF");
  const borderColor = toneBorderColor(graph, element, "E8E3DB");
  const accent = normalizeColor(graph.slide.theme.accentColor);
  const padding = element.style.padding ?? 18;

  slide.addShape(pptx.ShapeType.roundRect, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    line: { color: borderColor, pt: pxToPoints(element.style.borderWidth) ?? pxToPoints(1) ?? 0.75 },
    fill: { color: fillColor, transparency: toneFillTransparency(element) },
  });

  let topY = element.y + padding;
  if (content.title) {
    slide.addText(content.title, {
      x: pxToInches(element.x + padding, scale),
      y: pxToInches(topY, scale),
      w: pxToInches(element.w - padding * 2, scale),
      h: pxToInches(22, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 14,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });
    topY += 28;
  }

  const drawNode = (x: number, y: number, w: number, h: number, node: MiniDiagramContent["nodes"][number]) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: pxToInches(x, scale),
      y: pxToInches(y, scale),
      w: pxToInches(w, scale),
      h: pxToInches(h, scale),
      line: { color: node.tone ? accent : "E8E3DB", pt: pxToPoints(1) ?? 0.75 },
      fill: { color: node.tone === "accent" ? "FBE7DD" : node.tone === "success" ? "FFF5D8" : node.tone === "warning" ? "FFF1E8" : node.tone === "neutral" ? "EEF2F7" : "FFFFFF" },
    });

    let textX = x + 14;
    if (node.icon) {
      slide.addImage({
        data: dataUriFromSvg(wrapIconSvg({ name: node.icon }, node.tone === "neutral" ? "#475569" : `#${accent}`)),
        x: pxToInches(x + 14, scale),
        y: pxToInches(y + 12, scale),
        w: pxToInches(18, scale),
        h: pxToInches(18, scale),
      });
      textX += 24;
    }

    slide.addText(node.title, {
      x: pxToInches(textX, scale),
      y: pxToInches(y + 12, scale),
      w: pxToInches(w - (textX - x) - 14, scale),
      h: pxToInches(20, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 12,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });
    if (node.body) {
      slide.addText(node.body, {
        x: pxToInches(x + 14, scale),
        y: pxToInches(y + 36, scale),
        w: pxToInches(w - 28, scale),
        h: pxToInches(h - 48, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 9,
        color: normalizeColor(graph.slide.theme.textColor),
        fit: "shrink",
        valign: "top",
      });
    }
  };

  if (content.layout === "sequence") {
    const gap = 14;
    const nodeW = Math.floor((element.w - padding * 2 - gap * (content.nodes.length - 1)) / content.nodes.length);
    const nodeH = Math.max(70, element.h - (topY - element.y) - padding);
    content.nodes.forEach((node, index) => {
      const x = element.x + padding + index * (nodeW + gap);
      const y = topY;
      drawNode(x, y, nodeW, nodeH, node);
      if (index < content.nodes.length - 1) {
        slide.addShape(pptx.ShapeType.line, {
          x: pxToInches(x + nodeW, scale),
          y: pxToInches(y + nodeH / 2, scale),
          w: pxToInches(gap, scale),
          h: 0,
          line: { color: accent, pt: pxToPoints(2) ?? 1.5, endArrowType: "triangle" },
        });
      }
    });
    return;
  }

  if (content.layout === "layers") {
    const gap = 12;
    const nodeH = Math.floor((element.h - (topY - element.y) - padding - gap * (content.nodes.length - 1)) / content.nodes.length);
    content.nodes.forEach((node, index) => {
      const x = element.x + padding;
      const y = topY + index * (nodeH + gap);
      drawNode(x, y, element.w - padding * 2, nodeH, node);
    });
    return;
  }

  const hub = content.nodes[0];
  const spokes = content.nodes.slice(1);
  const hubW = Math.max(150, Math.floor((element.w - padding * 3) * 0.42));
  const hubH = Math.max(100, element.h - (topY - element.y) - padding);
  const spokeX = element.x + padding * 2 + hubW;
  const spokeW = element.w - (spokeX - element.x) - padding;
  drawNode(element.x + padding, topY, hubW, hubH, hub);

  const gap = 12;
  const spokeH = Math.floor((hubH - gap * Math.max(0, spokes.length - 1)) / Math.max(spokes.length, 1));
  spokes.forEach((node, index) => {
    const y = topY + index * (spokeH + gap);
    drawNode(spokeX, y, spokeW, spokeH, node);
    slide.addShape(pptx.ShapeType.line, {
      x: pxToInches(element.x + padding + hubW, scale),
      y: pxToInches(topY + hubH / 2, scale),
      w: pxToInches(spokeX - (element.x + padding + hubW), scale),
      h: pxToInches(y + spokeH / 2 - (topY + hubH / 2), scale),
      line: { color: accent, pt: pxToPoints(2) ?? 1.5, endArrowType: "triangle" },
    });
  });
}

function addSummaryBand(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "summaryBand" }>,
  scale: number,
): void {
  const content: SummaryBandContent = element.content;
  const toneColor =
    content.tone === "success" ? "8A5B0A"
      : content.tone === "warning" ? "9B3418"
      : content.tone === "neutral" ? "475569"
      : normalizeColor(graph.slide.theme.accentColor);
  const fillColor =
    content.tone === "success" ? "FFF5D8"
      : content.tone === "warning" ? "FFF1E8"
      : content.tone === "neutral" ? "EEF2F7"
      : "FBE7DD";
  const padding = element.style.padding ?? 18;

  slide.addShape(pptx.ShapeType.roundRect, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    line: { color: toneColor, pt: pxToPoints(element.style.borderWidth) ?? pxToPoints(1) ?? 0.75 },
    fill: { color: fillColor, transparency: 72 },
  });

  slide.addText(content.title, {
    x: pxToInches(element.x + padding, scale),
    y: pxToInches(element.y + padding, scale),
    w: pxToInches(element.w - padding * 2, scale),
    h: pxToInches(20, scale),
    margin: 0,
    fontFace: graph.slide.theme.fontFamily,
    fontSize: 12,
    bold: true,
    color: toneColor,
    fit: "shrink",
  });

  let chipX = element.x + padding;
  let chipY = element.y + padding + 28;
  const chipH = 24;
  for (const item of content.items) {
    const chipW = Math.min(element.w - padding * 2, Math.max(70, item.length * 13));
    if (chipX + chipW > element.x + element.w - padding) {
      chipX = element.x + padding;
      chipY += chipH + 8;
    }
    slide.addShape(pptx.ShapeType.roundRect, {
      x: pxToInches(chipX, scale),
      y: pxToInches(chipY, scale),
      w: pxToInches(chipW, scale),
      h: pxToInches(chipH, scale),
      line: { color: "D7DEE8", pt: pxToPoints(1) ?? 0.75 },
      fill: { color: "FFFFFF", transparency: 8 },
    });
    slide.addText(item, {
      x: pxToInches(chipX + 8, scale),
      y: pxToInches(chipY + 5, scale),
      w: pxToInches(chipW - 16, scale),
      h: pxToInches(14, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 9,
      bold: true,
      color: "334155",
      fit: "shrink",
    });
    chipX += chipW + 8;
  }

  if (content.emphasis) {
    slide.addText(content.emphasis, {
      x: pxToInches(element.x + padding, scale),
      y: pxToInches(element.y + element.h - padding - 18, scale),
      w: pxToInches(element.w - padding * 2, scale),
      h: pxToInches(18, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 10,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });
  }
}

function addFunnel(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "funnel" }>,
  scale: number,
): void {
  const content: FunnelContent = element.content;
  const fillColor = toneFillColor(graph, element, "FFFFFF");
  const borderColor = toneBorderColor(graph, element, "E8E3DB");
  const padding = element.style.padding ?? 18;
  const topOffset = content.title ? 30 : 0;
  const availableH = element.h - padding * 2 - topOffset;
  const stageGap = 10;
  const stageH = Math.floor((availableH - stageGap * (content.stages.length - 1)) / content.stages.length);
  const palette = [graph.slide.theme.accentColor, "#E69563", "#F0B48C", "#F6D2BB", "#FBE7DD"];

  slide.addShape(pptx.ShapeType.roundRect, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    line: { color: borderColor, pt: pxToPoints(element.style.borderWidth) ?? pxToPoints(1) ?? 0.75 },
    fill: { color: fillColor, transparency: toneFillTransparency(element) },
  });

  if (content.title) {
    slide.addText(content.title, {
      x: pxToInches(element.x + padding, scale),
      y: pxToInches(element.y + padding, scale),
      w: pxToInches(element.w - padding * 2, scale),
      h: pxToInches(22, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 14,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });
  }

  content.stages.forEach((stage, index) => {
    const widthRatio = 1 - index * (0.38 / Math.max(content.stages.length - 1, 1));
    const stageW = Math.max(120, Math.floor((element.w - padding * 2) * widthRatio));
    const x = element.x + Math.floor((element.w - stageW) / 2);
    const y = element.y + padding + topOffset + index * (stageH + stageGap);
    const fill = normalizeColor(stage.tone === "accent" ? "#FBE7DD" : stage.tone === "success" ? "#FFF5D8" : stage.tone === "warning" ? "#FFF1E8" : stage.tone === "neutral" ? "#EEF2F7" : palette[index % palette.length], "FBE7DD");
    slide.addShape(pptx.ShapeType.roundRect, {
      x: pxToInches(x, scale),
      y: pxToInches(y, scale),
      w: pxToInches(stageW, scale),
      h: pxToInches(stageH, scale),
      line: { color: normalizeColor(graph.slide.theme.accentColor), pt: pxToPoints(1) ?? 0.75 },
      fill: { color: fill, transparency: 18 },
    });
    slide.addText(stage.title, {
      x: pxToInches(x + 16, scale),
      y: pxToInches(y + 10, scale),
      w: pxToInches(stageW - 90, scale),
      h: pxToInches(18, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 11,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });
    if (stage.value) {
      slide.addText(stage.value, {
        x: pxToInches(x + stageW - 70, scale),
        y: pxToInches(y + 10, scale),
        w: pxToInches(54, scale),
        h: pxToInches(18, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 10,
        bold: true,
        color: normalizeColor(graph.slide.theme.accentColor),
        fit: "shrink",
        align: "right",
      });
    }
    if (stage.body) {
      slide.addText(stage.body, {
        x: pxToInches(x + 16, scale),
        y: pxToInches(y + 30, scale),
        w: pxToInches(stageW - 32, scale),
        h: pxToInches(Math.max(16, stageH - 46), scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 9,
        color: normalizeColor(graph.slide.theme.textColor),
        fit: "shrink",
        valign: "top",
      });
    }
  });
}

function addSwimlane(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "swimlane" }>,
  scale: number,
): void {
  const content: SwimlaneContent = element.content;
  const fillColor = toneFillColor(graph, element, "FFFFFF");
  const borderColor = toneBorderColor(graph, element, "E8E3DB");
  const padding = element.style.padding ?? 18;
  const titleOffset = content.title ? 28 : 0;
  const gap = 12;
  const availableH = element.h - padding * 2 - titleOffset;
  const rowH = Math.floor((availableH - gap * (content.lanes.length - 1)) / content.lanes.length);
  const labelW = 160;

  slide.addShape(pptx.ShapeType.roundRect, {
    x: pxToInches(element.x, scale),
    y: pxToInches(element.y, scale),
    w: pxToInches(element.w, scale),
    h: pxToInches(element.h, scale),
    line: { color: borderColor, pt: pxToPoints(element.style.borderWidth) ?? pxToPoints(1) ?? 0.75 },
    fill: { color: fillColor, transparency: toneFillTransparency(element) },
  });

  if (content.title) {
    slide.addText(content.title, {
      x: pxToInches(element.x + padding, scale),
      y: pxToInches(element.y + padding, scale),
      w: pxToInches(element.w - padding * 2, scale),
      h: pxToInches(20, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 14,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });
  }

  content.lanes.forEach((lane, index) => {
    const y = element.y + padding + titleOffset + index * (rowH + gap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: pxToInches(element.x + padding, scale),
      y: pxToInches(y, scale),
      w: pxToInches(labelW, scale),
      h: pxToInches(rowH, scale),
      line: { color: "E8E3DB", pt: pxToPoints(1) ?? 0.75 },
      fill: { color: "F6F3EE" },
    });
    slide.addText(lane.title, {
      x: pxToInches(element.x + padding + 12, scale),
      y: pxToInches(y + 12, scale),
      w: pxToInches(labelW - 24, scale),
      h: pxToInches(18, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 11,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });
    if (lane.badge) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: pxToInches(element.x + padding + 12, scale),
        y: pxToInches(y + rowH - 28, scale),
        w: pxToInches(Math.min(labelW - 24, Math.max(56, lane.badge.length * 12)), scale),
        h: pxToInches(18, scale),
        line: { color: normalizeColor(graph.slide.theme.accentColor), pt: pxToPoints(1) ?? 0.75 },
        fill: { color: normalizeColor(graph.slide.theme.accentColor), transparency: 90 },
      });
      slide.addText(lane.badge, {
        x: pxToInches(element.x + padding + 18, scale),
        y: pxToInches(y + rowH - 25, scale),
        w: pxToInches(labelW - 36, scale),
        h: pxToInches(12, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 8,
        bold: true,
        color: normalizeColor(graph.slide.theme.accentColor),
        fit: "shrink",
      });
    }

    const stepAreaX = element.x + padding + labelW + 12;
    const stepAreaW = element.w - padding * 2 - labelW - 12;
    const stepGap = 10;
    const stepW = Math.floor((stepAreaW - stepGap * (lane.steps.length - 1)) / lane.steps.length);
    lane.steps.forEach((step, innerIndex) => {
      const x = stepAreaX + innerIndex * (stepW + stepGap);
      slide.addShape(pptx.ShapeType.roundRect, {
        x: pxToInches(x, scale),
        y: pxToInches(y, scale),
        w: pxToInches(stepW, scale),
        h: pxToInches(rowH, scale),
        line: { color: "E8E3DB", pt: pxToPoints(1) ?? 0.75 },
        fill: { color: "FFFFFF" },
      });
      slide.addText(step, {
        x: pxToInches(x + 10, scale),
        y: pxToInches(y + 12, scale),
        w: pxToInches(stepW - 20, scale),
        h: pxToInches(rowH - 24, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 9,
        bold: true,
        color: "334155",
        fit: "shrink",
        valign: "middle",
      });
    });
  });
}

function addProcess(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "process" }>,
  scale: number,
): void {
  const content: ProcessContent = element.content;
  const accent = normalizeColor(element.style.color, graph.slide.theme.accentColor);
  const axis = content.axis ?? "horizontal";
  const items = content.items;
  const padding = element.style.padding ?? 16;
  const gap = axis === "vertical" ? 14 : 18;

  if (axis === "horizontal") {
    const trackY = element.y + padding + 12;
    slide.addShape(pptx.ShapeType.line, {
      x: pxToInches(element.x + padding + 16, scale),
      y: pxToInches(trackY, scale),
      w: pxToInches(Math.max(24, element.w - padding * 2 - 32), scale),
      h: 0,
      line: { color: accent, transparency: 74, pt: pxToPoints(3) ?? 2.25 },
    });

    const stepW = Math.max(120, Math.floor((element.w - padding * 2 - gap * (items.length - 1)) / items.length));
    items.forEach((item, index) => {
      const x = element.x + padding + index * (stepW + gap);
      const y = element.y + padding + 22;
      const h = Math.max(80, element.h - padding * 2 - 22);

      slide.addShape(pptx.ShapeType.roundRect, {
        x: pxToInches(x, scale),
        y: pxToInches(y, scale),
        w: pxToInches(stepW, scale),
        h: pxToInches(h, scale),
        line: { color: "E8E3DB", pt: pxToPoints(1) ?? 0.75 },
        fill: { color: "FFFFFF" },
      });

      slide.addShape(pptx.ShapeType.ellipse, {
        x: pxToInches(x + 14, scale),
        y: pxToInches(y + 14, scale),
        w: pxToInches(28, scale),
        h: pxToInches(28, scale),
        line: { color: accent, transparency: 100, pt: 0 },
        fill: { color: accent },
      });

      slide.addText(String(index + 1), {
        x: pxToInches(x + 14, scale),
        y: pxToInches(y + 16, scale),
        w: pxToInches(28, scale),
        h: pxToInches(22, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 10,
        bold: true,
        color: "FFFFFF",
        align: "center",
        valign: "middle",
      });

      if (item.meta) {
        slide.addText(item.meta, {
          x: pxToInches(x + 52, scale),
          y: pxToInches(y + 14, scale),
          w: pxToInches(stepW - 66, scale),
          h: pxToInches(16, scale),
          margin: 0,
          fontFace: graph.slide.theme.fontFamily,
          fontSize: 9,
          bold: true,
          color: accent,
          fit: "shrink",
        });
      }

      slide.addText(item.title, {
        x: pxToInches(x + 16, scale),
        y: pxToInches(y + 48, scale),
        w: pxToInches(stepW - 32, scale),
        h: pxToInches(28, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 14,
        bold: true,
        color: normalizeColor(graph.slide.theme.titleColor),
        fit: "shrink",
      });

      let bodyTop = y + 82;
      if (item.tag) {
        slide.addShape(pptx.ShapeType.roundRect, {
          x: pxToInches(x + 16, scale),
          y: pxToInches(bodyTop, scale),
          w: pxToInches(Math.min(stepW - 32, Math.max(56, item.tag.length * 12)), scale),
          h: pxToInches(22, scale),
          line: { color: accent, pt: pxToPoints(1) ?? 0.75 },
          fill: { color: normalizeColor(graph.slide.theme.accentColor, "C96F4A"), transparency: 90 },
        });
        slide.addText(item.tag, {
          x: pxToInches(x + 22, scale),
          y: pxToInches(bodyTop + 4, scale),
          w: pxToInches(stepW - 44, scale),
          h: pxToInches(14, scale),
          margin: 0,
          fontFace: graph.slide.theme.fontFamily,
          fontSize: 8,
          bold: true,
          color: accent,
          fit: "shrink",
        });
        bodyTop += 28;
      }

      if (item.body) {
        slide.addText(item.body, {
          x: pxToInches(x + 16, scale),
          y: pxToInches(bodyTop, scale),
          w: pxToInches(stepW - 32, scale),
          h: pxToInches(Math.max(18, h - (bodyTop - y) - 14), scale),
          margin: 0,
          fontFace: graph.slide.theme.fontFamily,
          fontSize: 11,
          color: normalizeColor(graph.slide.theme.textColor),
          fit: "shrink",
          valign: "top",
        });
      }
    });
    return;
  }

  const trackX = element.x + padding + 13;
  slide.addShape(pptx.ShapeType.line, {
    x: pxToInches(trackX, scale),
    y: pxToInches(element.y + padding, scale),
    w: 0,
    h: pxToInches(Math.max(24, element.h - padding * 2), scale),
    line: { color: accent, transparency: 74, pt: pxToPoints(3) ?? 2.25 },
  });

  const stepH = Math.max(72, Math.floor((element.h - padding * 2 - gap * (items.length - 1)) / items.length));
  items.forEach((item, index) => {
    const y = element.y + padding + index * (stepH + gap);
    const x = element.x + padding + 28;
    const w = Math.max(90, element.w - padding * 2 - 28);

    slide.addShape(pptx.ShapeType.ellipse, {
      x: pxToInches(trackX - 8, scale),
      y: pxToInches(y + 22, scale),
      w: pxToInches(16, scale),
      h: pxToInches(16, scale),
      line: { color: accent, transparency: 100, pt: 0 },
      fill: { color: accent },
    });

    slide.addShape(pptx.ShapeType.roundRect, {
      x: pxToInches(x, scale),
      y: pxToInches(y, scale),
      w: pxToInches(w, scale),
      h: pxToInches(stepH, scale),
      line: { color: "E8E3DB", pt: pxToPoints(1) ?? 0.75 },
      fill: { color: "FFFFFF" },
    });

    slide.addText(item.title, {
      x: pxToInches(x + 16, scale),
      y: pxToInches(y + 12, scale),
      w: pxToInches(w - 32, scale),
      h: pxToInches(22, scale),
      margin: 0,
      fontFace: graph.slide.theme.fontFamily,
      fontSize: 14,
      bold: true,
      color: normalizeColor(graph.slide.theme.titleColor),
      fit: "shrink",
    });

    if (item.meta) {
      slide.addText(item.meta, {
        x: pxToInches(x + 16, scale),
        y: pxToInches(y + 36, scale),
        w: pxToInches(w - 32, scale),
        h: pxToInches(14, scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 9,
        bold: true,
        color: accent,
        fit: "shrink",
      });
    }

    if (item.body) {
      slide.addText(item.body, {
        x: pxToInches(x + 16, scale),
        y: pxToInches(y + (item.meta ? 54 : 40), scale),
        w: pxToInches(w - 32, scale),
        h: pxToInches(Math.max(18, stepH - (item.meta ? 66 : 52)), scale),
        margin: 0,
        fontFace: graph.slide.theme.fontFamily,
        fontSize: 11,
        color: normalizeColor(graph.slide.theme.textColor),
        fit: "shrink",
        valign: "top",
      });
    }
  });
}

function addConnector(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "connector" }>,
  elementsById: Map<string, SceneElement>,
  scale: number,
): void {
  const { points, busY, routing } = computeConnectorPoints(element.content, element, elementsById);
  if (points.length < 2) {
    return;
  }

  const color = normalizeColor(element.style.color, graph.slide.theme.accentColor);
  const dashed = element.content.lineStyle !== "solid";

  if (routing === "bus" && busY !== undefined) {
    const sorted = [...points].sort((a, b) => a.x - b.x);
    addLineShape(
      slide,
      pptx,
      { x: element.x + sorted[0].x, y: element.y + busY },
      { x: element.x + sorted[sorted.length - 1].x, y: element.y + busY },
      scale,
      color,
      dashed,
    );

    for (const point of points) {
      addLineShape(
        slide,
        pptx,
        { x: element.x + point.x, y: element.y + busY },
        { x: element.x + point.x, y: element.y + point.y },
        scale,
        color,
        dashed,
      );
    }

    if (element.content.showDots !== false) {
      for (const point of points) {
        slide.addShape(pptx.ShapeType.ellipse, {
          x: pxToInches(element.x + point.x - 5, scale),
          y: pxToInches(element.y + busY - 5, scale),
          w: pxToInches(10, scale),
          h: pxToInches(10, scale),
          line: {
            color,
            transparency: 100,
            pt: 0,
          },
          fill: {
            color,
          },
        });
      }
    }

    return;
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    addLineShape(
      slide,
      pptx,
      { x: element.x + points[index].x, y: element.y + points[index].y },
      { x: element.x + points[index + 1].x, y: element.y + points[index + 1].y },
      scale,
      color,
      dashed,
    );
  }

  if (element.content.showDots !== false) {
    for (const point of points) {
      slide.addShape(pptx.ShapeType.ellipse, {
        x: pxToInches(element.x + point.x - 6, scale),
        y: pxToInches(element.y + point.y - 6, scale),
        w: pxToInches(12, scale),
        h: pxToInches(12, scale),
        line: {
          color,
          transparency: 100,
          pt: 0,
        },
        fill: {
          color,
        },
      });
    }
  }
}

function renderElementToPptx(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  graph: SceneGraph,
  element: SceneElement,
  elementsById: Map<string, SceneElement>,
  scale: number,
  layoutPlan?: PptxLayoutPlan,
): void {
  switch (element.type) {
    case "cover":
      addCover(slide, pptx, graph, element, scale);
      return;
    case "toc":
      addToc(slide, pptx, graph, element, scale);
      return;
    case "sectionDivider":
      addSectionDivider(slide, pptx, graph, element, scale);
      return;
    case "summary":
      addSummary(slide, pptx, graph, element, scale);
      return;
    case "frameworkRail":
      addFrameworkRail(slide, pptx, graph, element, scale, layoutPlan);
      return;
    case "title":
    case "text":
      addTextBox(slide, pptx, graph, element, scale);
      return;
    case "bulletList":
      addBulletList(slide, graph, element, scale);
      return;
    case "callout":
      addCallout(slide, pptx, graph, element, scale);
      return;
    case "badge":
      addBadge(slide, pptx, graph, element, scale);
      return;
    case "metric":
      addMetric(slide, pptx, graph, element, scale);
      return;
    case "actionCardGroup":
      addActionCardGroup(slide, pptx, graph, element, scale, layoutPlan);
      return;
    case "objectiveBand":
      addObjectiveBand(slide, pptx, graph, element, scale, layoutPlan);
      return;
    case "pageBadge":
      addPageBadge(slide, pptx, graph, element, scale);
      return;
    case "timeline":
      addTimeline(slide, pptx, graph, element, scale);
      return;
    case "process":
      addProcess(slide, pptx, graph, element, scale);
      return;
    case "comparison":
      addComparison(slide, pptx, graph, element, scale);
      return;
    case "insight":
      addInsight(slide, pptx, graph, element, scale);
      return;
    case "matrix":
      addMatrix(slide, pptx, graph, element, scale);
      return;
    case "miniDiagram":
      addMiniDiagram(slide, pptx, graph, element, scale);
      return;
    case "summaryBand":
      addSummaryBand(slide, pptx, graph, element, scale);
      return;
    case "funnel":
      addFunnel(slide, pptx, graph, element, scale);
      return;
    case "swimlane":
      addSwimlane(slide, pptx, graph, element, scale);
      return;
    case "chart":
      addChart(slide, pptx, graph, element, scale);
      return;
    case "shape":
      addShapeBlock(slide, pptx, graph, element, scale);
      return;
    case "line":
    case "divider":
      addLine(slide, pptx, graph, element, scale);
      return;
    case "svg":
      addSvgBlock(slide, element, scale);
      return;
    case "icon":
      addIconBlock(slide, graph, element, scale);
      return;
    case "grid":
      addGrid(slide, pptx, graph, element, scale);
      return;
    case "connector":
      addConnector(slide, pptx, graph, element, elementsById, scale);
      return;
    case "section":
    case "cardGroup":
      return;
  }
}

function configurePptxLayout(pptx: PptxGenJS, graph: SceneGraph): void {
  const scale = PPTX_HEIGHT_IN / graph.slide.height;
  const layoutName = `DECKSCRIBE_AI_${graph.slide.width}x${graph.slide.height}`;
  pptx.defineLayout({
    name: layoutName,
    width: PPTX_WIDTH_IN,
    height: PPTX_HEIGHT_IN,
  });
  pptx.layout = layoutName;
  pptx.author = "Codex";
  pptx.subject = graph.slide.id;
  pptx.title = graph.slide.id;
  pptx.company = "Deckscribe-AI";
  (pptx as PptxGenJS & { lang?: string }).lang = "zh-CN";
}

export function addSceneGraphToPptx(pptx: PptxGenJS, graph: SceneGraph, layoutPlan?: PptxLayoutPlan): void {
  const scale = PPTX_HEIGHT_IN / graph.slide.height;
  activePxToPt = scale * 72;
  const tokens = resolveThemeTokens(graph.slide.theme);

  const slide = pptx.addSlide();
  slide.background = { color: normalizeColor(tokens.background, "FFFFFF") };
  addPageChrome(slide, pptx, graph, scale);

  const elementsById = new Map(graph.slide.elements.map((element) => [element.id, element]));
  const pageElements = [...graph.slide.elements].sort((a, b) => a.zIndex - b.zIndex);

  for (const element of pageElements) {
    renderElementToPptx(slide, pptx, graph, element, elementsById, scale, layoutPlan);
  }
}

export async function exportSceneGraphsToPptxFile(
  graphs: SceneGraph[],
  outputPath: string,
  layoutPlans?: PptxLayoutPlan[],
): Promise<void> {
  if (graphs.length === 0) {
    throw new Error("At least one slide is required to export PPTX.");
  }

  const pptx = new PptxGenJS();
  configurePptxLayout(pptx, graphs[0]);

  for (const [index, graph] of graphs.entries()) {
    addSceneGraphToPptx(pptx, graph, layoutPlans?.[index] ?? defaultPptxLayoutPlan(graph));
  }

  await pptx.writeFile({ fileName: outputPath });
}

export async function exportSceneGraphToPptxFile(
  graph: SceneGraph,
  outputPath: string,
  layoutPlan?: PptxLayoutPlan,
): Promise<void> {
  await exportSceneGraphsToPptxFile([graph], outputPath, [layoutPlan ?? defaultPptxLayoutPlan(graph)]);
}

