import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  DEFAULT_WARM_ORANGE,
  SUPPORTED_ELEMENT_TYPES,
  SUPPORTED_ICON_NAMES,
  SUPPORTED_VERSIONS,
  canvasDimensionsForPreset,
  isSupportedCanvasSize,
  type CanvasPreset,
  type SceneGraph,
} from "./types.ts";

type LooseObject = Record<string, unknown>;

const SUPPORTED_STYLE_KEYS = new Set([
  "fontSize",
  "fontWeight",
  "lineHeight",
  "color",
  "backgroundColor",
  "surfaceTone",
  "elevation",
  "borderRadius",
  "padding",
  "textAlign",
  "opacity",
  "borderColor",
  "borderWidth",
  "borderStyle",
  "fill",
]);

const ELEMENT_TYPE_ALIASES: Record<string, string> = {
  framework: "frameworkRail",
  frameworkPanel: "frameworkRail",
  rail: "frameworkRail",
  sidebarSummary: "frameworkRail",
  heading: "title",
  header: "title",
  paragraph: "text",
  paragraphText: "text",
  subtitle: "text",
  description: "text",
  list: "bulletList",
  bullets: "bulletList",
  note: "callout",
  highlight: "callout",
  chip: "badge",
  pill: "badge",
  tag: "badge",
  stat: "metric",
  metricCard: "metric",
  kpi: "metric",
  actionCards: "actionCardGroup",
  actionGrid: "actionCardGroup",
  weightedCards: "actionCardGroup",
  objective: "objectiveBand",
  objectiveStrip: "objectiveBand",
  footerBand: "objectiveBand",
  pageNumber: "pageBadge",
  pageTag: "pageBadge",
  chronology: "timeline",
  milestone: "timeline",
  history: "timeline",
  flow: "process",
  stepFlow: "process",
  workflowSteps: "process",
  compare: "comparison",
  versus: "comparison",
  beforeAfter: "comparison",
  quote: "insight",
  keyInsight: "insight",
  insightBox: "insight",
  quadrant: "matrix",
  matrix2x2: "matrix",
  miniDiagram: "miniDiagram",
  "mini-diagram": "miniDiagram",
  diagram: "miniDiagram",
  summary: "summaryBand",
  summaryStrip: "summaryBand",
  "summary-bar": "summaryBand",
  funnelChart: "funnel",
  pipeline: "funnel",
  laneFlow: "swimlane",
  swimLane: "swimlane",
  donut: "chart",
  donutChart: "chart",
  pie: "chart",
  barChart: "chart",
  progressChart: "chart",
  panel: "shape",
  card: "shape",
  rect: "shape",
  box: "shape",
  rule: "line",
  stroke: "line",
  table: "grid",
};

const STYLE_KEY_ALIASES: Record<string, string> = {
  font_size: "fontSize",
  fontsize: "fontSize",
  font_weight: "fontWeight",
  line_height: "lineHeight",
  bg: "backgroundColor",
  bgcolor: "backgroundColor",
  bgColor: "backgroundColor",
  background: "backgroundColor",
  tone: "surfaceTone",
  surface_tone: "surfaceTone",
  surface: "surfaceTone",
  depth: "elevation",
  shadowLevel: "elevation",
  border_color: "borderColor",
  stroke: "borderColor",
  strokeColor: "borderColor",
  border_width: "borderWidth",
  strokeWidth: "borderWidth",
  stroke_width: "borderWidth",
  border_style: "borderStyle",
  radius: "borderRadius",
  border_radius: "borderRadius",
  align: "textAlign",
  text_align: "textAlign",
  gradient: "fill",
};

const ICON_NAME_ALIASES: Record<string, string> = {
  office: "building",
  bank: "building",
  process: "flow",
  workflow: "flow",
  transition: "arrows",
  compare: "arrows",
  stack: "layers",
  hierarchy: "layers",
  idea: "lightbulb",
  insight: "lightbulb",
  inspiration: "spark",
  team: "people",
  users: "people",
  settings: "gear",
  cog: "gear",
  graph: "chart",
  bag: "briefcase",
  work: "briefcase",
  timer: "clock",
  time: "clock",
  stats: "dashboard",
  metrics: "dashboard",
  growth: "trend",
  safety: "shield",
};

function isPlainObject(value: unknown): value is LooseObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function toInteger(value: unknown, fallback: number): number {
  const numeric = toFiniteNumber(value);
  return numeric === undefined ? fallback : Math.round(numeric);
}

function toPositiveInteger(value: unknown, fallback: number): number {
  return Math.max(1, toInteger(value, fallback));
}

function toNonNegativeNumber(value: unknown): number | undefined {
  const numeric = toFiniteNumber(value);
  return numeric !== undefined && numeric >= 0 ? numeric : undefined;
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
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

const PLACEHOLDER_VISIBLE_VALUES = new Set([
  "optional",
  "strong",
  "default",
  "regular",
  "compact",
  "lead",
  "accent",
  "success",
  "warning",
  "neutral",
]);

const OPTIONAL_VISIBLE_KEYS = new Set([
  "attribution",
  "badge",
  "callToAction",
  "centerLabel",
  "centerText",
  "contact",
  "description",
  "emphasis",
  "eyebrow",
  "footerTitle",
  "intro",
  "label",
  "meta",
  "note",
  "subtitle",
  "summary",
  "tag",
]);

function isPlaceholderVisibleValue(value: string): boolean {
  return PLACEHOLDER_VISIBLE_VALUES.has(value.trim().toLowerCase());
}

function sanitizeIdentifier(value: unknown, fallback: string): string {
  const base = sanitizeString(value, fallback);
  return base.replace(/\s+/g, "-");
}

function sanitizeStringArray(value: unknown, limit = Number.POSITIVE_INFINITY): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => toTrimmedString(item))
      .filter((item): item is string => typeof item === "string" && item.length > 0 && !isPlaceholderVisibleValue(item))
      .slice(0, limit);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n|[•·▪]/)
      .map((item) => item.replace(/^\s*[-*]\s*/, "").trim())
      .filter((item) => Boolean(item) && !isPlaceholderVisibleValue(item))
      .slice(0, limit);
  }

  return [];
}

function stripPlaceholderVisibleContent(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    return key && OPTIONAL_VISIBLE_KEYS.has(key) && isPlaceholderVisibleValue(value) ? undefined : value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => stripPlaceholderVisibleContent(item))
      .filter((item) => item !== undefined);
  }

  if (isPlainObject(value)) {
    const cleaned: LooseObject = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const nextValue = stripPlaceholderVisibleContent(childValue, childKey);
      if (nextValue !== undefined) {
        cleaned[childKey] = nextValue;
      }
    }
    return cleaned;
  }

  return value;
}

function sanitizeIdArray(value: unknown): string[] {
  return sanitizeStringArray(value).map((item) => item.replace(/\s+/g, "-"));
}

function isSupportedElementType(value: unknown): value is (typeof SUPPORTED_ELEMENT_TYPES)[number] {
  return typeof value === "string" && SUPPORTED_ELEMENT_TYPES.includes(value as (typeof SUPPORTED_ELEMENT_TYPES)[number]);
}

function normalizeElementType(value: unknown): (typeof SUPPORTED_ELEMENT_TYPES)[number] {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (isSupportedElementType(normalized)) {
      return normalized;
    }

    const alias = ELEMENT_TYPE_ALIASES[normalized];
    if (alias && isSupportedElementType(alias)) {
      return alias;
    }
  }

  return "text";
}

function normalizeFontWeight(value: unknown): number | undefined {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "bold" || normalized === "bolder" || normalized === "semibold" || normalized === "semi-bold") {
      return 700;
    }
    if (normalized === "medium") {
      return 500;
    }
    if (normalized === "regular" || normalized === "normal") {
      return 400;
    }
  }

  const numeric = toFiniteNumber(value);
  if (numeric === undefined) {
    return undefined;
  }

  if (numeric >= 650) {
    return 700;
  }

  if (numeric >= 450) {
    return 500;
  }

  return 400;
}

function normalizeTextAlign(value: unknown): "left" | "center" | "right" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "left" || normalized === "start") {
    return "left";
  }
  if (normalized === "center" || normalized === "centre" || normalized === "middle") {
    return "center";
  }
  if (normalized === "right" || normalized === "end") {
    return "right";
  }

  return undefined;
}

function normalizeBorderStyle(value: unknown): "solid" | "dashed" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "solid") {
    return "solid";
  }
  if (normalized === "dashed" || normalized === "dash") {
    return "dashed";
  }

  return undefined;
}

function normalizeSurfaceTone(value: unknown): "default" | "muted" | "accent" | "softAccent" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "default" || normalized === "base") {
    return "default";
  }
  if (normalized === "muted" || normalized === "subtle" || normalized === "soft") {
    return "muted";
  }
  if (normalized === "accent" || normalized === "highlight") {
    return "accent";
  }
  if (normalized === "softaccent" || normalized === "soft-accent" || normalized === "accentsoft") {
    return "softAccent";
  }

  return undefined;
}

function normalizeOpacity(value: unknown): number | undefined {
  const numeric = toFiniteNumber(value);
  if (numeric === undefined) {
    return undefined;
  }

  if (numeric > 1 && numeric <= 100) {
    return clamp(numeric / 100, 0, 1);
  }

  return clamp(numeric, 0, 1);
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  const shortHex = trimmed.match(/^#([0-9a-fA-F]{3})$/);
  if (shortHex) {
    return `#${shortHex[1].toUpperCase()}`;
  }

  const fullHex = trimmed.match(/^#([0-9a-fA-F]{6})$/);
  if (fullHex) {
    return `#${fullHex[1].toUpperCase()}`;
  }

  const rgbMatch = trimmed.match(/^rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (rgbMatch) {
    const [r, g, b] = rgbMatch.slice(1).map((part) => clamp(Number(part), 0, 255));
    return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
  }

  return undefined;
}

function deriveShortTitle(text: string, fallback: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return fallback;
  }

  const segments = compact
    .split(/[。；;:：]/)
    .map((part) => part.trim())
    .filter(Boolean);

  const picked = segments.find((part) => part.length >= 2) ?? compact;
  return picked.slice(0, 18);
}

function parseBorderShorthand(value: string): { borderWidth?: number; borderStyle?: string; borderColor?: string } {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)px\s+(solid|dashed)\s+(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))$/);
  if (!match) {
    return {};
  }

  return {
    borderWidth: Number(match[1]),
    borderStyle: match[2],
    borderColor: match[3].toUpperCase(),
  };
}

function normalizeFillStyle(value: unknown): LooseObject | undefined {
  if (typeof value === "string" && ["none", "transparent"].includes(value.trim().toLowerCase())) {
    return { type: "none" };
  }

  const directColor = normalizeHexColor(value);
  if (directColor) {
    return {
      type: "solid",
      color: directColor,
    };
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const rawType = typeof value.type === "string" ? value.type.trim() : "";
  if (["none", "transparent"].includes(rawType.toLowerCase())) {
    return { type: "none" };
  }

  const from = normalizeHexColor(value.from);
  const to = normalizeHexColor(value.to);
  const color = normalizeHexColor(value.color);

  if ((rawType === "linearGradient" || rawType === "gradient" || (!rawType && from && to)) && (from || color || to)) {
    return {
      type: "solid",
      color: color ?? from ?? to,
    };
  }

  if ((rawType === "solid" || color) && color) {
    return {
      type: "solid",
      color,
    };
  }

  return undefined;
}

function normalizeStyle(input: unknown): LooseObject {
  const source = isPlainObject(input) ? input : {};
  const next: LooseObject = {};

  for (const [rawKey, value] of Object.entries(source)) {
    if (rawKey === "border" && typeof value === "string") {
      Object.assign(next, parseBorderShorthand(value));
      continue;
    }

    const key = STYLE_KEY_ALIASES[rawKey] ?? rawKey;
    if (!SUPPORTED_STYLE_KEYS.has(key)) {
      continue;
    }

    switch (key) {
      case "fontSize":
      case "lineHeight":
      case "borderRadius":
      case "padding":
      case "borderWidth": {
        const numeric = toFiniteNumber(value);
        if (numeric !== undefined) {
          next[key] = numeric;
        }
        break;
      }
      case "fontWeight": {
        const fontWeight = normalizeFontWeight(value);
        if (fontWeight !== undefined) {
          next[key] = fontWeight;
        }
        break;
      }
      case "opacity": {
        const opacity = normalizeOpacity(value);
        if (opacity !== undefined) {
          next[key] = opacity;
        }
        break;
      }
      case "elevation": {
        const numeric = toFiniteNumber(value);
        if (numeric !== undefined) {
          next[key] = clamp(Math.round(numeric), 0, 3);
        }
        break;
      }
      case "textAlign": {
        const textAlign = normalizeTextAlign(value);
        if (textAlign) {
          next[key] = textAlign;
        }
        break;
      }
      case "surfaceTone": {
        const surfaceTone = normalizeSurfaceTone(value);
        if (surfaceTone) {
          next[key] = surfaceTone;
        }
        break;
      }
      case "borderStyle": {
        const borderStyle = normalizeBorderStyle(value);
        if (borderStyle) {
          next[key] = borderStyle;
        }
        break;
      }
      case "color":
      case "backgroundColor":
      case "borderColor": {
        const color = normalizeHexColor(value);
        if (color) {
          next[key] = color;
        }
        break;
      }
      case "fill": {
        const fill = normalizeFillStyle(value);
        if (fill) {
          next[key] = fill;
          if (fill.type === "solid" && typeof fill.color === "string") {
            next.backgroundColor ??= fill.color;
          }
        }
        break;
      }
      default:
        next[key] = value;
    }
  }

  return next;
}

function normalizeElementBox(element: LooseObject, slideWidth: number, slideHeight: number): void {
  const x = Math.max(0, toInteger(element.x, 0));
  const y = Math.max(0, toInteger(element.y, 0));
  let w = toPositiveInteger(element.w, 1);
  let h = toPositiveInteger(element.h, 1);

  const clampedX = clamp(x, 0, slideWidth - 1);
  const clampedY = clamp(y, 0, slideHeight - 1);

  if (clampedX + w > slideWidth) {
    w = Math.max(1, slideWidth - clampedX);
  }

  if (clampedY + h > slideHeight) {
    h = Math.max(1, slideHeight - clampedY);
  }

  element.x = clampedX;
  element.y = clampedY;
  element.w = w;
  element.h = h;
  element.zIndex = toInteger(element.zIndex, 0);
}

function normalizeTheme(input: unknown): LooseObject {
  const theme = isPlainObject(input) ? { ...input } : {};
  const preset = theme.preset === "legacyWarm"
    ? "legacyWarm"
    : theme.preset === "govBankWarmOrange"
      ? "govBankWarmOrange"
      : "govBankWarmOrange";
  const isLegacy = preset === "legacyWarm";
  const isGovBank = preset === "govBankWarmOrange";
  const remapSunriseColor = (value: unknown, fallback: string, replacements: Record<string, string>): string => {
    const normalized = normalizeHexColor(value);
    if (!normalized) {
      return fallback;
    }
    return replacements[normalized.toUpperCase()] ?? normalized;
  };

  return {
    preset,
    fontFamily: sanitizeString(theme.fontFamily ?? theme.font_family, "Noto Sans SC"),
    titleColor: normalizeHexColor(theme.titleColor) ?? (isLegacy ? "#1F2937" : isGovBank ? DEFAULT_WARM_ORANGE.textMain : "#16324F"),
    textColor: normalizeHexColor(theme.textColor) ?? (isLegacy ? "#374151" : isGovBank ? DEFAULT_WARM_ORANGE.textMain : "#2F4054"),
    mutedTextColor: normalizeHexColor(theme.mutedTextColor) ?? (isGovBank ? DEFAULT_WARM_ORANGE.textSecondary : "#667085"),
    accentColor: isLegacy
      ? normalizeHexColor(theme.accentColor) ?? "#C96F4A"
      : isGovBank
        ? normalizeHexColor(theme.accentColor) ?? DEFAULT_WARM_ORANGE.primary
        : remapSunriseColor(theme.accentColor, "#E95420", { "#C96F4A": "#E95420", "#FF5A1F": "#E95420" }),
    accentDarkColor: normalizeHexColor(theme.accentDarkColor) ?? (isGovBank ? "#C73516" : undefined),
    accentStrongColor: normalizeHexColor(theme.accentStrongColor) ?? (isGovBank ? DEFAULT_WARM_ORANGE.coral : undefined),
    accentSoftColor: isLegacy
      ? normalizeHexColor(theme.accentSoftColor) ?? "#E8B9A3"
      : isGovBank
        ? normalizeHexColor(theme.accentSoftColor) ?? DEFAULT_WARM_ORANGE.surfaceWarm
        : remapSunriseColor(theme.accentSoftColor, "#F6B391", { "#F7A18F": "#F6B391", "#F3B37A": "#F6B391", "#E8B9A3": "#FFD2A6" }),
    accentLightColor: normalizeHexColor(theme.accentLightColor) ?? (isGovBank ? DEFAULT_WARM_ORANGE.surfaceSoft : undefined),
    secondaryAccentColor: isLegacy
      ? normalizeHexColor(theme.secondaryAccentColor) ?? "#6F7B8A"
      : isGovBank
        ? normalizeHexColor(theme.secondaryAccentColor) ?? "#2F5F86"
        : remapSunriseColor(theme.secondaryAccentColor, "#285A84", { "#2E68A6": "#285A84", "#184E97": "#285A84" }),
    secondarySoftColor: normalizeHexColor(theme.secondarySoftColor) ?? (isGovBank ? "#EEF4F8" : undefined),
    goldAccentColor: normalizeHexColor(theme.goldAccentColor) ?? (isGovBank ? "#B8862B" : undefined),
    goldSoftColor: normalizeHexColor(theme.goldSoftColor) ?? (isGovBank ? "#FFF7E6" : undefined),
    neutralAccentColor: isLegacy
      ? normalizeHexColor(theme.neutralAccentColor) ?? "#D8CDBE"
      : isGovBank
        ? normalizeHexColor(theme.neutralAccentColor) ?? "#D8DEE8"
        : remapSunriseColor(theme.neutralAccentColor, "#F2C66D", { "#D8BA86": "#F2C66D", "#F4C95D": "#F2C66D", "#D8CDBE": "#E3E8EF" }),
    chromeLineColor: normalizeHexColor(theme.chromeLineColor) ?? (isLegacy ? "#D8CDBE" : isGovBank ? DEFAULT_WARM_ORANGE.border : "#F2A68E"),
    surfaceShadowColor: normalizeHexColor(theme.surfaceShadowColor) ?? (isLegacy ? "#E4D5C9" : isGovBank ? "#E9D7CF" : "#FFD6C7"),
    showPageBadge: typeof theme.showPageBadge === "boolean" ? theme.showPageBadge : false,
  };
}

function normalizeBackground(input: unknown): LooseObject {
  const background = isPlainObject(input) ? { ...input } : {};

  return {
    type: "solid",
    color: normalizeHexColor(background.color ?? background.backgroundColor) ?? "#FFFFFF",
  };
}

function defaultLineHeightForType(type: string): number | undefined {
  switch (type) {
    case "title":
      return 1.18;
    case "bulletList":
      return 1.32;
    case "text":
    case "callout":
    case "summaryBand":
    case "frameworkRail":
    case "actionCardGroup":
    case "objectiveBand":
      return 1.25;
    default:
      return undefined;
  }
}

function extractTextCandidate(content: LooseObject, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = toTrimmedString(content[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function normalizeGridContent(content: LooseObject): LooseObject {
  let header = sanitizeStringArray(content.header ?? content.headers ?? content.columns);
  let rows: string[][] = [];

  if (Array.isArray(content.rows)) {
    rows = content.rows
      .filter((row): row is unknown[] | LooseObject => Array.isArray(row) || isPlainObject(row))
      .map((row) => {
        if (Array.isArray(row)) {
          return row.map((cell) => sanitizeString(cell, "-"));
        }

        if (header.length === 0) {
          header = Object.keys(row);
        }

        return header.map((column) => sanitizeString(row[column], "-"));
      });
  }

  const columnCount = Math.max(header.length, ...rows.map((row) => row.length), 1);

  if (header.length === 0) {
    header = Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`);
  } else if (header.length < columnCount) {
    header = [...header, ...Array.from({ length: columnCount - header.length }, (_, index) => `Column ${header.length + index + 1}`)];
  } else if (header.length > columnCount) {
    header = header.slice(0, columnCount);
  }

  rows = rows.map((row) => {
    const next = row.slice(0, columnCount);
    while (next.length < columnCount) {
      next.push("-");
    }
    return next;
  });

  if (rows.length === 0) {
    rows = [Array.from({ length: columnCount }, (_, index) => (index === 0 ? "TBD" : "-"))];
  }

  const columnWidthsSource = Array.isArray(content.columnWidths) ? content.columnWidths : Array.isArray(content.widths) ? content.widths : [];
  const columnWidths = columnWidthsSource
    .map((value) => toFiniteNumber(value))
    .filter((value): value is number => value !== undefined && value > 0);

  const normalized: LooseObject = { header, rows };
  if (columnWidths.length === columnCount) {
    normalized.columnWidths = columnWidths;
  }

  return normalized;
}

function normalizeMetricContent(content: LooseObject): LooseObject {
  const value = extractTextCandidate(content, "value", "number", "stat", "metric", "headline") ?? "0";
  const label = extractTextCandidate(content, "label", "title", "name", "caption") ?? "Metric";
  const note = extractTextCandidate(content, "note", "text", "description", "subtitle");

  return note ? { value, label, note } : { value, label };
}

function normalizeFrameworkRailContent(content: LooseObject): LooseObject {
  const label = extractTextCandidate(content, "label", "eyebrow", "badge", "tag");
  const icon = typeof content.icon === "string" ? normalizeIconName(content.icon) : undefined;
  const title = extractTextCandidate(content, "title", "heading", "name") ?? "Framework";
  const summary = extractTextCandidate(content, "summary", "text", "body", "description");
  const bullets = sanitizeStringArray(content.bullets ?? content.items ?? content.points, 6);
  const footerTitle = extractTextCandidate(content, "footerTitle", "footerLabel", "legendTitle");
  const footerItems = sanitizeStringArray(content.footerItems ?? content.legendItems ?? content.legend ?? content.footer, 6);
  const layoutSource = extractTextCandidate(content, "layout", "placement", "mode")?.toLowerCase();
  const densitySource = extractTextCandidate(content, "densityClass", "density", "contentDensity")?.toLowerCase();
  const toneSource = extractTextCandidate(content, "tone", "variant", "kind", "status")?.toLowerCase();
  const tone =
    toneSource === "accent" || toneSource === "success" || toneSource === "warning" || toneSource === "neutral" || toneSource === "default"
      ? toneSource
      : undefined;

  return {
    ...(label ? { label } : {}),
    ...(icon ? { icon } : {}),
    title,
    ...(summary ? { summary } : {}),
    ...(bullets.length > 0 ? { bullets } : {}),
    ...(footerTitle ? { footerTitle } : {}),
    ...(footerItems.length > 0 ? { footerItems } : {}),
    layout: layoutSource === "top" ? "top" : "left",
    ...(densitySource === "dense" || densitySource === "balanced" || densitySource === "airy" ? { densityClass: densitySource } : {}),
    ...(tone ? { tone } : {}),
  };
}

function normalizeBadgeContent(content: LooseObject): LooseObject {
  const text = extractTextCandidate(content, "text", "label", "title", "name", "value") ?? "Tag";
  const toneSource = extractTextCandidate(content, "tone", "variant", "kind", "status")?.toLowerCase();
  const tone =
    toneSource === "accent" || toneSource === "success" || toneSource === "warning" || toneSource === "neutral" || toneSource === "default"
      ? toneSource
      : undefined;

  return tone ? { text, tone } : { text };
}

function normalizeActionCardGroupContent(content: LooseObject): LooseObject {
  const sourceItems = Array.isArray(content.items) ? content.items : Array.isArray(content.cards) ? content.cards : [];
  const items = sourceItems
    .filter((item): item is LooseObject => isPlainObject(item))
    .slice(0, 6)
    .map((item, index) => {
      const weightSource = extractTextCandidate(item, "weight", "size", "importance")?.toLowerCase();
      const toneSource = extractTextCandidate(item, "tone", "variant", "kind", "status")?.toLowerCase();
      const weight =
        weightSource === "lead" || weightSource === "regular" || weightSource === "compact"
          ? weightSource
          : undefined;
      const tone =
        toneSource === "accent" || toneSource === "success" || toneSource === "warning" || toneSource === "neutral" || toneSource === "default"
          ? toneSource
          : undefined;

      return {
        ...(extractTextCandidate(item, "step", "number", "index", "badge") ? { step: extractTextCandidate(item, "step", "number", "index", "badge") } : {}),
        ...(extractTextCandidate(item, "eyebrow", "label", "tag") ? { eyebrow: extractTextCandidate(item, "eyebrow", "label", "tag") } : {}),
        ...(typeof item.icon === "string" ? { icon: normalizeIconName(item.icon) } : {}),
        title: extractTextCandidate(item, "title", "heading", "name") ?? `Action ${index + 1}`,
        body: extractTextCandidate(item, "body", "text", "description", "content") ?? "Details pending.",
        ...(extractTextCandidate(item, "emphasis", "takeaway", "goal") ? { emphasis: extractTextCandidate(item, "emphasis", "takeaway", "goal") } : {}),
        ...(weight ? { weight } : {}),
        ...(tone ? { tone } : {}),
      };
    });

  const layoutSource = extractTextCandidate(content, "layout", "mode", "pattern")?.toLowerCase();
  const layout =
    layoutSource === "lead-grid" || layoutSource === "leadgrid"
      ? "lead-grid"
      : layoutSource === "grid"
        ? "grid"
        : "auto";
  const visualAidSource = extractTextCandidate(content, "visualAid", "aid", "decoration", "accent")?.toLowerCase();
  const visualAid =
    visualAidSource === "icon" || visualAidSource === "badge" || visualAidSource === "divider" || visualAidSource === "accentstrip" || visualAidSource === "accent-strip"
      ? visualAidSource === "accentstrip" ? "accentStrip" : visualAidSource === "accent-strip" ? "accentStrip" : visualAidSource
      : undefined;
  const columns = toNonNegativeNumber(content.columns);
  const densitySource = extractTextCandidate(content, "densityClass", "density", "contentDensity")?.toLowerCase();
  const iconPlacementSource = extractTextCandidate(content, "iconPlacement", "iconMode", "iconLayout")?.toLowerCase();
  const iconPlacement =
    iconPlacementSource === "inline" || iconPlacementSource === "stacked" || iconPlacementSource === "none"
      ? iconPlacementSource
      : undefined;
  const densityClass =
    densitySource === "dense" || densitySource === "balanced" || densitySource === "airy"
      ? densitySource
      : items.length >= 5 || items.some((item) => item.body.length >= 46)
        ? "dense"
        : items.length <= 3 && items.every((item) => item.body.length <= 36)
          ? "airy"
          : "balanced";

  return {
    ...(extractTextCandidate(content, "title", "heading", "label") ? { title: extractTextCandidate(content, "title", "heading", "label") } : {}),
    ...(visualAid ? { visualAid } : {}),
    layout,
    iconPlacement: iconPlacement ?? (visualAid ? (densityClass === "dense" ? "inline" : "stacked") : "none"),
    densityClass,
    ...(columns !== undefined ? { columns: Math.max(1, Math.round(columns)) } : {}),
    items: items.length > 0 ? items : [{ title: "Action 1", body: "Details pending." }, { title: "Action 2", body: "Details pending." }],
  };
}

function normalizeObjectiveBandContent(content: LooseObject): LooseObject {
  const label = extractTextCandidate(content, "label", "title", "badge", "tag");
  const icon = typeof content.icon === "string" ? normalizeIconName(content.icon) : undefined;
  const text = extractTextCandidate(content, "text", "body", "summary", "message") ?? "Core objective";
  const emphasis = extractTextCandidate(content, "emphasis", "highlight", "takeaway");
  const densitySource = extractTextCandidate(content, "densityClass", "density", "contentDensity")?.toLowerCase();
  const toneSource = extractTextCandidate(content, "tone", "variant", "kind", "status")?.toLowerCase();
  const tone =
    toneSource === "accent" || toneSource === "success" || toneSource === "warning" || toneSource === "neutral" || toneSource === "default"
      ? toneSource
      : undefined;

  return {
    ...(label ? { label } : {}),
    ...(icon ? { icon } : {}),
    text,
    ...(emphasis ? { emphasis } : {}),
    ...(densitySource === "dense" || densitySource === "balanced" || densitySource === "airy" ? { densityClass: densitySource } : {}),
    ...(tone ? { tone } : {}),
  };
}

function normalizePageBadgeContent(content: LooseObject): LooseObject {
  const value = extractTextCandidate(content, "value", "text", "number", "page") ?? "1";
  const label = extractTextCandidate(content, "label", "prefix", "title");
  const positionSource = extractTextCandidate(content, "position", "placement", "corner");
  const normalizedPosition =
    positionSource === "topRight" || positionSource === "bottomRight" || positionSource === "bottomLeft"
      ? positionSource
      : positionSource?.toLowerCase() === "top-right"
        ? "topRight"
        : positionSource?.toLowerCase() === "bottom-left"
          ? "bottomLeft"
          : "bottomRight";
  const toneSource = extractTextCandidate(content, "tone", "variant", "kind", "status")?.toLowerCase();
  const tone =
    toneSource === "accent" || toneSource === "success" || toneSource === "warning" || toneSource === "neutral" || toneSource === "default"
      ? toneSource
      : undefined;

  return {
    value,
    ...(label ? { label } : {}),
    position: normalizedPosition,
    ...(tone ? { tone } : {}),
  };
}

function normalizeTimelineContent(content: LooseObject): LooseObject {
  const sourceItems = Array.isArray(content.items) ? content.items : Array.isArray(content.nodes) ? content.nodes : Array.isArray(content.steps) ? content.steps : [];
  const items = sourceItems
    .filter((item): item is LooseObject => isPlainObject(item))
    .map((item) => {
      const title = extractTextCandidate(item, "title", "label", "name", "heading") ?? "Stage";
      const body = extractTextCandidate(item, "body", "text", "description", "content");
      const meta = extractTextCandidate(item, "meta", "time", "date", "period", "tag");
      return meta ? { title, ...(body ? { body } : {}), meta } : body ? { title, body } : { title };
    });

  return {
    axis: "vertical",
    items: items.length > 0 ? items : [{ title: "Stage", body: "Details pending." }],
  };
}

function normalizeProcessContent(content: LooseObject): LooseObject {
  const sourceItems = Array.isArray(content.items) ? content.items : Array.isArray(content.steps) ? content.steps : Array.isArray(content.nodes) ? content.nodes : [];
  const items = sourceItems
    .filter((item): item is LooseObject => isPlainObject(item))
    .map((item) => {
      const title = extractTextCandidate(item, "title", "label", "name", "heading") ?? "Step";
      const body = extractTextCandidate(item, "body", "text", "description", "content");
      const meta = extractTextCandidate(item, "meta", "time", "date", "period");
      const tag = extractTextCandidate(item, "tag", "badge", "chip", "status");
      return {
        title,
        ...(body ? { body } : {}),
        ...(meta ? { meta } : {}),
        ...(tag ? { tag } : {}),
      };
    });

  const axisSource = extractTextCandidate(content, "axis", "direction", "layout")?.toLowerCase();
  const axis = axisSource === "vertical" ? "vertical" : "horizontal";

  return {
    axis,
    items: items.length > 0 ? items : [{ title: "Step 1", body: "Details pending." }],
  };
}

function normalizeComparisonSide(input: unknown, fallbackTitle: string): LooseObject {
  const content = isPlainObject(input) ? input : {};
  const title = extractTextCandidate(content, "title", "label", "name", "heading") ?? fallbackTitle;
  const body = extractTextCandidate(content, "body", "text", "description", "content");
  const badge = extractTextCandidate(content, "badge", "tag", "chip");
  const bullets = sanitizeStringArray(content.bullets ?? content.items ?? content.points);

  return {
    title,
    ...(body ? { body } : {}),
    ...(badge ? { badge } : {}),
    ...(bullets.length > 0 ? { bullets } : {}),
  };
}

function normalizeComparisonContent(content: LooseObject): LooseObject {
  const layoutSource = extractTextCandidate(content, "layout", "direction", "axis")?.toLowerCase();
  const left = normalizeComparisonSide(content.left ?? content.before ?? content.a ?? content.optionA, "Option A");
  const right = normalizeComparisonSide(content.right ?? content.after ?? content.b ?? content.optionB, "Option B");
  const conclusion = extractTextCandidate(content, "conclusion", "summary", "takeaway");

  return {
    layout: layoutSource === "stack" || layoutSource === "vertical" ? "stack" : "split",
    left,
    right,
    ...(conclusion ? { conclusion } : {}),
  };
}

function normalizeInsightContent(content: LooseObject): LooseObject {
  const title = extractTextCandidate(content, "title", "label", "heading") ?? "Key Insight";
  const text = extractTextCandidate(content, "text", "quote", "body", "content", "description") ?? "Details pending.";
  const emphasis = extractTextCandidate(content, "emphasis", "highlight", "headline");
  const attribution = extractTextCandidate(content, "attribution", "source", "author", "speaker");
  const toneSource = extractTextCandidate(content, "tone", "variant", "kind", "status")?.toLowerCase();
  const tone =
    toneSource === "accent" || toneSource === "success" || toneSource === "warning" || toneSource === "neutral" || toneSource === "default"
      ? toneSource
      : undefined;

  return {
    title,
    text,
    ...(emphasis ? { emphasis } : {}),
    ...(attribution ? { attribution } : {}),
    ...(tone ? { tone } : {}),
  };
}

function normalizeMatrixContent(content: LooseObject): LooseObject {
  const quadrantSources = Array.isArray(content.quadrants)
    ? content.quadrants
    : Array.isArray(content.items)
      ? content.items
      : [];
  const positionMap = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;
  const quadrants = quadrantSources
    .filter((item): item is LooseObject => isPlainObject(item))
    .map((item, index) => {
      const positionSource = extractTextCandidate(item, "position", "quadrant")?.toLowerCase();
      const position =
        positionSource === "topleft" || positionSource === "top-left" ? "topLeft"
          : positionSource === "topright" || positionSource === "top-right" ? "topRight"
            : positionSource === "bottomleft" || positionSource === "bottom-left" ? "bottomLeft"
              : positionSource === "bottomright" || positionSource === "bottom-right" ? "bottomRight"
                : positionMap[Math.min(index, positionMap.length - 1)];
      const title = extractTextCandidate(item, "title", "label", "name", "heading") ?? `Quadrant ${index + 1}`;
      const body = extractTextCandidate(item, "body", "text", "description", "content");
      const badge = extractTextCandidate(item, "badge", "tag", "chip");
      const toneSource = extractTextCandidate(item, "tone", "variant", "kind", "status")?.toLowerCase();
      const tone =
        toneSource === "accent" || toneSource === "success" || toneSource === "warning" || toneSource === "neutral" || toneSource === "default"
          ? toneSource
          : undefined;
      return {
        position,
        title,
        ...(body ? { body } : {}),
        ...(badge ? { badge } : {}),
        ...(tone ? { tone } : {}),
      };
    });

  return {
    ...(extractTextCandidate(content, "xAxisTitle", "xTitle", "horizontalAxis") ? { xAxisTitle: extractTextCandidate(content, "xAxisTitle", "xTitle", "horizontalAxis") } : {}),
    ...(extractTextCandidate(content, "yAxisTitle", "yTitle", "verticalAxis") ? { yAxisTitle: extractTextCandidate(content, "yAxisTitle", "yTitle", "verticalAxis") } : {}),
    ...(extractTextCandidate(content, "centerLabel", "center", "label") ? { centerLabel: extractTextCandidate(content, "centerLabel", "center", "label") } : {}),
    quadrants: quadrants.length > 0 ? quadrants : [{ position: "topLeft", title: "Quadrant 1", body: "Details pending." }],
  };
}

function normalizeMiniDiagramContent(content: LooseObject): LooseObject {
  const layoutSource = extractTextCandidate(content, "layout", "type", "mode")?.toLowerCase();
  const layout =
    layoutSource === "hub" || layoutSource === "hubspoke" || layoutSource === "hub-spoke"
      ? "hub"
      : layoutSource === "layers" || layoutSource === "layer"
        ? "layers"
        : "sequence";

  const sourceNodes = Array.isArray(content.nodes) ? content.nodes : Array.isArray(content.items) ? content.items : Array.isArray(content.steps) ? content.steps : [];
  const nodes = sourceNodes
    .filter((item): item is LooseObject => isPlainObject(item))
    .slice(0, 5)
    .map((item) => {
      const title = extractTextCandidate(item, "title", "label", "name", "heading") ?? "Node";
      const body = extractTextCandidate(item, "body", "text", "description", "content");
      const icon = typeof item.icon === "string" ? item.icon : undefined;
      const toneSource = extractTextCandidate(item, "tone", "variant", "kind", "status")?.toLowerCase();
      const tone =
        toneSource === "accent" || toneSource === "success" || toneSource === "warning" || toneSource === "neutral" || toneSource === "default"
          ? toneSource
          : undefined;
      return {
        title,
        ...(body ? { body } : {}),
        ...(icon ? { icon: normalizeIconName(icon) } : {}),
        ...(tone ? { tone } : {}),
      };
    });

  return {
    layout,
    ...(extractTextCandidate(content, "title", "label", "heading") ? { title: extractTextCandidate(content, "title", "label", "heading") } : {}),
    nodes: nodes.length >= 2 ? nodes : [{ title: "Node 1" }, { title: "Node 2" }],
  };
}

function normalizeSummaryBandContent(content: LooseObject): LooseObject {
  const title = extractTextCandidate(content, "title", "label", "heading") ?? "Key Summary";
  const items = sanitizeStringArray(content.items ?? content.points ?? content.bullets ?? content.text);
  const emphasis = extractTextCandidate(content, "emphasis", "highlight", "summary");
  const toneSource = extractTextCandidate(content, "tone", "variant", "kind", "status")?.toLowerCase();
  const tone =
    toneSource === "accent" || toneSource === "success" || toneSource === "warning" || toneSource === "neutral" || toneSource === "default"
      ? toneSource
      : undefined;

  return {
    title,
    items: items.length > 0 ? items : ["Details pending."],
    ...(emphasis ? { emphasis } : {}),
    ...(tone ? { tone } : {}),
  };
}

function normalizeFunnelContent(content: LooseObject): LooseObject {
  const sourceStages = Array.isArray(content.stages) ? content.stages : Array.isArray(content.items) ? content.items : Array.isArray(content.steps) ? content.steps : [];
  const stages = sourceStages
    .filter((item): item is LooseObject => isPlainObject(item))
    .slice(0, 5)
    .map((item, index) => {
      const title = extractTextCandidate(item, "title", "label", "name", "heading") ?? `Stage ${index + 1}`;
      const body = extractTextCandidate(item, "body", "text", "description", "content");
      const value = extractTextCandidate(item, "value", "number", "metric", "count");
      const note = extractTextCandidate(item, "note", "annotation", "caption");
      const toneSource = extractTextCandidate(item, "tone", "variant", "kind", "status")?.toLowerCase();
      const tone =
        toneSource === "accent" || toneSource === "success" || toneSource === "warning" || toneSource === "neutral" || toneSource === "default"
          ? toneSource
          : undefined;
      return {
        title,
        ...(body ? { body } : {}),
        ...(value ? { value } : {}),
        ...(note ? { note } : {}),
        ...(tone ? { tone } : {}),
      };
    });

  return {
    ...(extractTextCandidate(content, "title", "label", "heading") ? { title: extractTextCandidate(content, "title", "label", "heading") } : {}),
    stages: stages.length >= 3 ? stages : [{ title: "Stage 1" }, { title: "Stage 2" }, { title: "Stage 3" }],
  };
}

function normalizeSwimlaneContent(content: LooseObject): LooseObject {
  const sourceLanes = Array.isArray(content.lanes) ? content.lanes : Array.isArray(content.items) ? content.items : [];
  const lanes = sourceLanes
    .filter((item): item is LooseObject => isPlainObject(item))
    .slice(0, 4)
    .map((item, index) => {
      const title = extractTextCandidate(item, "title", "label", "name", "heading") ?? `Lane ${index + 1}`;
      const badge = extractTextCandidate(item, "badge", "tag", "chip");
      const steps = sanitizeStringArray(item.steps ?? item.items ?? item.points ?? item.text).slice(0, 5);
      const toneSource = extractTextCandidate(item, "tone", "variant", "kind", "status")?.toLowerCase();
      const tone =
        toneSource === "accent" || toneSource === "success" || toneSource === "warning" || toneSource === "neutral" || toneSource === "default"
          ? toneSource
          : undefined;
      return {
        title,
        ...(badge ? { badge } : {}),
        steps: steps.length >= 2 ? steps : ["Step 1", "Step 2"],
        ...(tone ? { tone } : {}),
      };
    });

  return {
    ...(extractTextCandidate(content, "title", "label", "heading") ? { title: extractTextCandidate(content, "title", "label", "heading") } : {}),
    lanes: lanes.length >= 2 ? lanes : [{ title: "Lane 1", steps: ["Step 1", "Step 2"] }, { title: "Lane 2", steps: ["Step 1", "Step 2"] }],
  };
}

function normalizeChartContent(content: LooseObject): LooseObject {
  const sourceSegments = Array.isArray(content.segments) ? content.segments : Array.isArray(content.items) ? content.items : Array.isArray(content.series) ? content.series : [];
  const segments = sourceSegments
    .filter((segment): segment is LooseObject => isPlainObject(segment))
    .map((segment, index) => {
      const label = extractTextCandidate(segment, "label", "name", "title") ?? `Segment ${index + 1}`;
      const value = Math.max(1, toFiniteNumber(segment.value ?? segment.amount ?? segment.percent ?? segment.percentage) ?? 1);
      const color = normalizeHexColor(segment.color);
      const note = extractTextCandidate(segment, "note", "annotation", "caption", "text");
      return color ? { label, value, ...(note ? { note } : {}), color } : { label, value, ...(note ? { note } : {}) };
    });

  const chartTypeSource = extractTextCandidate(content, "chartType", "type", "kind", "mode")?.toLowerCase();
  const chartType =
    chartTypeSource === "bar" || chartTypeSource === "bars"
      ? "bar"
      : chartTypeSource === "progress" || chartTypeSource === "progressbar" || chartTypeSource === "progress-bar"
        ? "progress"
        : "donut";

  const normalized: LooseObject = {
    chartType,
    segments: segments.length > 0 ? segments : [{ label: "Segment 1", value: 1 }],
  };

  const title = extractTextCandidate(content, "title", "label", "name");
  if (title) {
    normalized.title = title;
  }

  const centerText = extractTextCandidate(content, "centerText", "centerLabel", "valueText");
  if (centerText) {
    normalized.centerText = centerText;
  }

  if (typeof content.showLegend === "boolean") {
    normalized.showLegend = content.showLegend;
  } else {
    normalized.showLegend = chartType !== "progress";
  }

  const maxValue = toFiniteNumber(content.maxValue ?? content.max ?? content.total ?? content.target);
  if (maxValue !== undefined && maxValue > 0) {
    normalized.maxValue = maxValue;
  }

  return normalized;
}

function normalizeConnectorContent(content: LooseObject): LooseObject {
  let targets = sanitizeIdArray(content.targets ?? content.targetIds);

  if (targets.length < 2) {
    const from = toTrimmedString(content.from);
    const to = toTrimmedString(content.to);
    if (from && to) {
      targets = [from, to].map((value) => value.replace(/\s+/g, "-"));
    }
  }

  return {
    targets: targets.length >= 2 ? targets : ["node-1", "node-2"],
    lineStyle: normalizeBorderStyle(content.lineStyle ?? content.style) ?? "solid",
    showDots: typeof content.showDots === "boolean" ? content.showDots : typeof content.dots === "boolean" ? content.dots : false,
    routing: ["auto", "chain", "bus"].includes(String(content.routing)) ? content.routing : "auto",
    anchor: ["center", "top", "bottom"].includes(String(content.anchor)) ? content.anchor : "center",
  };
}

function normalizeSectionContent(content: LooseObject): LooseObject {
  const normalized: LooseObject = {
    headerIds: sanitizeIdArray(content.headerIds ?? content.titles),
    bodyIds: sanitizeIdArray(content.bodyIds ?? content.contentIds ?? content.children),
  };

  for (const key of ["topPadding", "gap", "headerGap"] as const) {
    const value = toNonNegativeNumber(content[key]);
    if (value !== undefined) {
      normalized[key] = value;
    }
  }

  return normalized;
}

function normalizeCardGroupContent(content: LooseObject, index: number): LooseObject {
  const sourceItems = Array.isArray(content.items) ? content.items : Array.isArray(content.cards) ? content.cards : [];
  const items = sourceItems
    .filter((item): item is LooseObject => isPlainObject(item))
    .map((item, itemIndex) => ({
      containerId: sanitizeIdentifier(item.containerId ?? item.container ?? item.cardId, `shape-card-${index + 1}-${itemIndex + 1}`),
      iconIds: sanitizeIdArray(item.iconIds ?? item.icons),
      titleIds: sanitizeIdArray(item.titleIds ?? item.titles),
      bodyIds: sanitizeIdArray(item.bodyIds ?? item.bodies ?? item.textIds),
    }));

  const normalized: LooseObject = {
    items: items.length > 0 ? items : [{ containerId: `shape-card-${index + 1}-1`, iconIds: [], titleIds: [], bodyIds: [] }],
  };

  for (const key of ["columns", "gap", "paddingX", "paddingY"] as const) {
    const value = toNonNegativeNumber(content[key]);
    if (value !== undefined) {
      normalized[key] = value;
    }
  }

  return normalized;
}

function normalizeIconName(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (SUPPORTED_ICON_NAMES.includes(trimmed as (typeof SUPPORTED_ICON_NAMES)[number])) {
      return trimmed;
    }

    const alias = ICON_NAME_ALIASES[trimmed];
    if (alias && SUPPORTED_ICON_NAMES.includes(alias as (typeof SUPPORTED_ICON_NAMES)[number])) {
      return alias;
    }
  }

  return "check";
}

function normalizeElementContent(element: LooseObject, index: number): LooseObject {
  const type = element.type as string;
  const rawContent = element.content;
  const content = isPlainObject(element.content) ? { ...element.content } : {};
  const rawContentText = toTrimmedString(rawContent);

  switch (type) {
    case "frameworkRail":
      return normalizeFrameworkRailContent(content);
    case "title":
      return { text: rawContentText ?? extractTextCandidate(content, "text", "value", "title", "label", "heading") ?? `Title ${index + 1}` };
    case "text":
      return { text: rawContentText ?? extractTextCandidate(content, "text", "value", "body", "bodyText", "description", "subtitle") ?? "Details pending." };
    case "bulletList": {
      const directItems = Array.isArray(rawContent) || typeof rawContent === "string"
        ? sanitizeStringArray(rawContent)
        : sanitizeStringArray(content.items);
      const fallbackItems = sanitizeStringArray(content.text ?? content.body ?? content.bodyText ?? content.value);
      const items = directItems.length > 0 ? directItems : fallbackItems;
      return { items: items.length > 0 ? items : ["Details pending."] };
    }
    case "callout": {
      const rawTitle = extractTextCandidate(content, "title", "label", "heading");
      const rawText = rawContentText ?? extractTextCandidate(content, "text", "body", "bodyText", "description", "value") ?? rawTitle ?? "Details pending.";
      return {
        title: rawTitle ?? deriveShortTitle(rawText, "Key Point"),
        text: rawText,
      };
    }
    case "badge":
      return rawContentText ? { text: rawContentText } : normalizeBadgeContent(content);
    case "metric":
      return rawContentText ? { value: rawContentText, label: deriveShortTitle(rawContentText, "Metric") } : normalizeMetricContent(content);
    case "actionCardGroup":
      return normalizeActionCardGroupContent(content);
    case "objectiveBand":
      return normalizeObjectiveBandContent(content);
    case "pageBadge":
      return normalizePageBadgeContent(content);
    case "timeline":
      return normalizeTimelineContent(content);
    case "process":
      return normalizeProcessContent(content);
    case "comparison":
      return normalizeComparisonContent(content);
    case "insight":
      return normalizeInsightContent(content);
    case "matrix":
      return normalizeMatrixContent(content);
    case "miniDiagram":
      return normalizeMiniDiagramContent(content);
    case "summaryBand":
      return normalizeSummaryBandContent(content);
    case "funnel":
      return normalizeFunnelContent(content);
    case "swimlane":
      return normalizeSwimlaneContent(content);
    case "chart":
      return normalizeChartContent(content);
    case "shape":
      return { shape: "rect" };
    case "line":
    case "divider": {
      const requestedDirection = typeof content.direction === "string" ? content.direction.trim().toLowerCase() : "";
      const width = toFiniteNumber(element.w) ?? 1;
      const height = toFiniteNumber(element.h) ?? 1;
      const direction = requestedDirection === "vertical" || (requestedDirection !== "horizontal" && height > width)
        ? "vertical"
        : "horizontal";
      return { direction };
    }
    case "svg": {
      const svg =
        typeof content.svg === "string" && content.svg.trim().startsWith("<svg") && content.svg.trim().endsWith("</svg>")
          ? content.svg.trim()
          : typeof content.markup === "string" && content.markup.trim().startsWith("<svg") && content.markup.trim().endsWith("</svg>")
            ? content.markup.trim()
            : "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 160 80\"><rect x=\"4\" y=\"4\" width=\"152\" height=\"72\" rx=\"12\" fill=\"none\" stroke=\"#C96F4A\" stroke-width=\"4\"/><circle cx=\"32\" cy=\"40\" r=\"10\" fill=\"#C96F4A\"/><path d=\"M54 40h52\" stroke=\"#C96F4A\" stroke-width=\"4\" stroke-linecap=\"round\"/><path d=\"M118 40h10\" stroke=\"#C96F4A\" stroke-width=\"4\" stroke-linecap=\"round\"/></svg>";

      return {
        svg,
        description: extractTextCandidate(content, "description", "text", "alt") ?? "Structural illustration",
      };
    }
    case "icon":
      return { name: normalizeIconName(rawContentText ?? content.name ?? content.icon) };
    case "grid":
      return normalizeGridContent(content);
    case "connector":
      return normalizeConnectorContent(content);
    case "section":
      return normalizeSectionContent(content);
    case "cardGroup":
      return normalizeCardGroupContent(content, index);
    default:
      return { text: rawContentText ?? "Details pending." };
  }
}

function normalizeElement(input: unknown, index: number, slideWidth: number, slideHeight: number): LooseObject {
  const source = isPlainObject(input) ? { ...input } : {};
  const type = normalizeElementType(source.type);
  const style = normalizeStyle(source.style);
  if (style.lineHeight === undefined) {
    const defaultLineHeight = defaultLineHeightForType(type);
    if (defaultLineHeight !== undefined) {
      style.lineHeight = defaultLineHeight;
    }
  }
  const element: LooseObject = {
    ...source,
    type,
    id: sanitizeIdentifier(source.id, `element-${index + 1}`),
    role: sanitizeString(source.role, type),
    style,
  };

  element.content = stripPlaceholderVisibleContent(normalizeElementContent(element, index)) as LooseObject;
  normalizeElementBox(element, slideWidth, slideHeight);
  return element;
}

function resolveCanvas(inputSlide: LooseObject, canvasPreset?: CanvasPreset): { width: number; height: number } {
  if (canvasPreset) {
    return canvasDimensionsForPreset(canvasPreset);
  }

  const width = toInteger(inputSlide.width, SLIDE_WIDTH);
  const height = toInteger(inputSlide.height, SLIDE_HEIGHT);
  return isSupportedCanvasSize(width, height)
    ? { width, height }
    : { width: SLIDE_WIDTH, height: SLIDE_HEIGHT };
}

export function normalizeSceneGraphInput(input: unknown, canvasPreset?: CanvasPreset): unknown {
  if (!isPlainObject(input)) {
    return input;
  }

  const root = { ...input };
  const slide = isPlainObject(root.slide) ? { ...root.slide } : {};
  const elementsSource = Array.isArray(slide.elements) ? slide.elements : [];
  const canvas = resolveCanvas(slide, canvasPreset);
  const usedIds = new Set<string>();

  const elements = elementsSource.map((element, index) => {
    const normalized = normalizeElement(element, index, canvas.width, canvas.height);
    let nextId = normalized.id as string;

    if (usedIds.has(nextId)) {
      let suffix = 2;
      while (usedIds.has(`${nextId}-${suffix}`)) {
        suffix += 1;
      }
      nextId = `${nextId}-${suffix}`;
      normalized.id = nextId;
    }

    usedIds.add(nextId);
    return normalized;
  });

  const version =
    typeof root.version === "string" && SUPPORTED_VERSIONS.includes(root.version as (typeof SUPPORTED_VERSIONS)[number])
      ? root.version
      : "scene-graph/v1";

  const normalized: SceneGraph | LooseObject = {
    version,
    slide: {
      ...slide,
      id: sanitizeIdentifier(slide.id, "slide-001"),
      width: canvas.width,
      height: canvas.height,
      background: normalizeBackground(slide.background),
      theme: normalizeTheme(slide.theme),
      elements,
    },
  };

  return normalized;
}

export function summarizeNormalizationChanges(input: unknown): string[] {
  if (!isPlainObject(input) || !isPlainObject(input.slide) || !Array.isArray(input.slide.elements)) {
    return [];
  }

  const changes: string[] = [];

  input.slide.elements.forEach((element, index) => {
    if (!isPlainObject(element)) {
      changes.push(`slide.elements[${index}] replaced non-object element`);
      return;
    }

    if (!isSupportedElementType(element.type) && !(typeof element.type === "string" && ELEMENT_TYPE_ALIASES[element.type])) {
      changes.push(`slide.elements[${index}] replaced unsupported type`);
    }

    if (!toTrimmedString(element.id)) {
      changes.push(`slide.elements[${index}] filled missing id`);
    }

    if (!toTrimmedString(element.role)) {
      changes.push(`slide.elements[${index}] filled missing role`);
    }

    const style = isPlainObject(element.style) ? element.style : {};
    if ("border" in style) {
      changes.push(`slide.elements[${index}] converted style.border shorthand`);
    }

    const rawFillType = isPlainObject(style.fill) && typeof style.fill.type === "string"
      ? style.fill.type.trim().toLowerCase()
      : undefined;
    if (
      (typeof style.fill === "string" && ["none", "transparent"].includes(style.fill.trim().toLowerCase())) ||
      (rawFillType !== undefined && ["none", "transparent"].includes(rawFillType))
    ) {
      changes.push(`slide.elements[${index}] preserved transparent fill`);
    }

    for (const rawKey of Object.keys(style)) {
      const key = STYLE_KEY_ALIASES[rawKey] ?? rawKey;
      if (!SUPPORTED_STYLE_KEYS.has(key) && rawKey !== "border") {
        changes.push(`slide.elements[${index}] dropped unsupported style.${rawKey}`);
      }
    }

    const content = isPlainObject(element.content) ? element.content : {};
    const rawContentText = toTrimmedString(element.content);
    if ((element.type === "title" || element.type === "text") && !extractTextCandidate(content, "text", "value", "body", "bodyText", "description", "subtitle")) {
      changes.push(rawContentText
        ? `slide.elements[${index}] converted string content to content.text`
        : `slide.elements[${index}] filled missing content.text`);
    }

    if (element.type === "bulletList") {
      const rawBulletItems = Array.isArray(element.content) || typeof element.content === "string"
        ? sanitizeStringArray(element.content)
        : [];
      if (rawBulletItems.length > 0) {
        changes.push(`slide.elements[${index}] converted raw bulletList content to content.items`);
      } else if (sanitizeStringArray(content.items ?? content.text ?? content.body).length === 0) {
        changes.push(`slide.elements[${index}] filled empty bullet list`);
      }
    }

    if (element.type === "callout") {
      if (!extractTextCandidate(content, "title", "label", "heading")) {
        changes.push(`slide.elements[${index}] filled missing callout title`);
      }
      if (!extractTextCandidate(content, "text", "body", "bodyText", "description", "value")) {
        changes.push(rawContentText
          ? `slide.elements[${index}] converted string content to callout text`
          : `slide.elements[${index}] filled missing callout text`);
      }
    }

    if (element.type === "metric") {
      if (!extractTextCandidate(content, "value", "number", "stat", "metric", "headline")) {
        changes.push(`slide.elements[${index}] filled missing metric value`);
      }
      if (!extractTextCandidate(content, "label", "title", "name", "caption")) {
        changes.push(`slide.elements[${index}] filled missing metric label`);
      }
    }

    if (element.type === "badge" && !extractTextCandidate(content, "text", "label", "title", "name", "value")) {
      changes.push(`slide.elements[${index}] filled missing badge text`);
    }

    if ((element.type === "line" || element.type === "divider") && !["horizontal", "vertical"].includes(String(content.direction ?? ""))) {
      const width = toFiniteNumber(element.w) ?? 1;
      const height = toFiniteNumber(element.h) ?? 1;
      if (height > width) {
        changes.push(`slide.elements[${index}] inferred vertical line direction from geometry`);
      }
    }

    if (element.type === "timeline" && (!Array.isArray(content.items) || content.items.length === 0)) {
      changes.push(`slide.elements[${index}] filled empty timeline items`);
    }

    if (element.type === "process" && (!Array.isArray(content.items) || content.items.length === 0)) {
      changes.push(`slide.elements[${index}] filled empty process items`);
    }

    if (element.type === "comparison") {
      if (!isPlainObject(content.left)) {
        changes.push(`slide.elements[${index}] filled missing comparison.left`);
      }
      if (!isPlainObject(content.right)) {
        changes.push(`slide.elements[${index}] filled missing comparison.right`);
      }
    }

    if (element.type === "insight") {
      if (!extractTextCandidate(content, "title", "label", "heading")) {
        changes.push(`slide.elements[${index}] filled missing insight title`);
      }
      if (!extractTextCandidate(content, "text", "quote", "body", "content", "description")) {
        changes.push(`slide.elements[${index}] filled missing insight text`);
      }
    }

    if (element.type === "matrix" && (!Array.isArray(content.quadrants) || content.quadrants.length === 0)) {
      changes.push(`slide.elements[${index}] filled empty matrix quadrants`);
    }

    if (element.type === "miniDiagram" && (!Array.isArray(content.nodes) || content.nodes.length < 2)) {
      changes.push(`slide.elements[${index}] filled insufficient miniDiagram nodes`);
    }

    if (element.type === "summaryBand" && sanitizeStringArray(content.items ?? content.points ?? content.bullets ?? content.text).length === 0) {
      changes.push(`slide.elements[${index}] filled empty summaryBand items`);
    }

    if (element.type === "funnel" && (!Array.isArray(content.stages) || content.stages.length < 3)) {
      changes.push(`slide.elements[${index}] filled insufficient funnel stages`);
    }

    if (element.type === "swimlane" && (!Array.isArray(content.lanes) || content.lanes.length < 2)) {
      changes.push(`slide.elements[${index}] filled insufficient swimlane lanes`);
    }

    if (element.type === "chart" && (!Array.isArray(content.segments) || content.segments.length === 0)) {
      changes.push(`slide.elements[${index}] filled empty chart segments`);
    }

    const w = toFiniteNumber(element.w);
    const h = toFiniteNumber(element.h);
    if (w !== undefined && w <= 0) {
      changes.push(`slide.elements[${index}] clamped non-positive width`);
    }
    if (h !== undefined && h <= 0) {
      changes.push(`slide.elements[${index}] clamped non-positive height`);
    }
  });

  return changes;
}

