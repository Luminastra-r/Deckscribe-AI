import { computeActionCardGroupLayout } from "./primitive-layout.ts";
import { CURATED_LUCIDE_ICON_SVGS } from "./assets/icon-catalog.ts";
import {
  colorWithAlphaCss,
  resolvePrimitiveTonePalette,
  resolveReadableBorderColor,
  resolveReadableTextColor,
  resolveThemeTokens,
} from "./primitive-theme.ts";
import { type ElementStyle, type IconName, type SceneElement, type SceneGraph } from "./types.ts";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatText(value: string): string {
  return escapeHtml(value).replaceAll("\n", "<br/>");
}

function toCssLength(value?: number): string | undefined {
  return value === undefined ? undefined : `${value}px`;
}

function toCssStyle(style: ElementStyle, fallbackTextColor: string): string {
  const borderWidth = style.borderWidth ?? 0;
  const borderColor = style.borderColor;
  const borderStyle = style.borderStyle ?? "solid";
  const border = borderColor && borderWidth > 0 ? `${borderWidth}px ${borderStyle} ${borderColor}` : undefined;

  const entries: Array<[string, string | undefined]> = [
    ["font-size", toCssLength(style.fontSize)],
    ["font-weight", style.fontWeight?.toString()],
    ["line-height", style.lineHeight?.toString()],
    ["color", style.color ?? fallbackTextColor],
    ["background-color", style.backgroundColor],
    ["border", border],
    ["border-radius", toCssLength(style.borderRadius)],
    ["padding", toCssLength(style.padding)],
    ["text-align", style.textAlign],
    ["opacity", style.opacity?.toString()],
  ];

  return entries
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
}

function fillToCssBackground(style: ElementStyle): string | undefined {
  const fill = style.fill;
  if (!fill) {
    return undefined;
  }
  if (fill.type === "none") {
    return "transparent";
  }
  if (fill.type === "solid" && fill.color) {
    return fill.color;
  }
  if (fill.type === "linearGradient") {
    return fill.color ?? fill.from ?? fill.to;
  }
  return undefined;
}

function absoluteBoxStyle(element: SceneElement): string {
  return [
    "position:absolute",
    `left:${element.x}px`,
    `top:${element.y}px`,
    `width:${element.w}px`,
    `height:${element.h}px`,
    `z-index:${element.zIndex}`,
    "box-sizing:border-box",
    "overflow:hidden",
  ].join(";");
}

function fitAttributes(element: SceneElement, minFontSize: number): string {
  if (element.style.fontSize === undefined) {
    return "";
  }

  return ` data-fit-text="true" data-fit-min="${minFontSize}" data-fit-max="${element.style.fontSize}"`;
}

function hexToRgb(color: string): [number, number, number] | null {
  const match = color.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) {
    return null;
  }

  const hex = match[1].length === 3
    ? match[1].split("").map((char) => char + char).join("")
    : match[1];

  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function colorWithAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color);
  if (!rgb) {
    return color;
  }

  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function shadowForElevation(level = 1): string {
  switch (level) {
    case 0:
      return "none";
    case 1:
      return "0 12px 28px rgba(15,23,42,0.06), 0 2px 6px rgba(15,23,42,0.04)";
    case 2:
      return "0 18px 36px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.04)";
    case 3:
      return "0 24px 48px rgba(15,23,42,0.12), 0 4px 12px rgba(15,23,42,0.06)";
    default:
      return "0 16px 34px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.04)";
  }
}

function shadowForTheme(graph: SceneGraph, level = 1): string {
  const tokens = resolveThemeTokens(graph.slide.theme);
  const base = hexToRgb(tokens.surfaceShadowBase);
  if (!base) {
    return shadowForElevation(level);
  }

  const alpha = level === 0 ? 0 : level === 1 ? 0.12 : level === 2 ? 0.17 : 0.22;
  const spread = level === 1 ? "0 16px 36px" : level === 2 ? "0 22px 44px" : "0 26px 52px";
  return `${spread} rgba(${base[0]}, ${base[1]}, ${base[2]}, ${alpha}), 0 4px 12px rgba(${base[0]}, ${base[1]}, ${base[2]}, ${alpha * 0.45})`;
}

function resolveSurfacePresentation(
  graph: SceneGraph,
  style: ElementStyle,
  fallbackBackground = "#FFFFFF",
): { background: string; borderColor: string; shadow: string } {
  const tokens = resolveThemeTokens(graph.slide.theme);
  const accent = style.color ?? graph.slide.theme.accentColor;
  const tone = style.surfaceTone ?? "default";
  const elevation = style.elevation ?? 2;
  const isGovBank = tokens.preset === "govBankWarmOrange";

  if (tone === "accent") {
    const background = style.backgroundColor ?? (isGovBank ? tokens.accentSoft : colorWithAlpha(accent, tokens.preset === "legacyWarm" ? 0.12 : 0.1));
    return {
      background: fillToCssBackground(style) ?? background,
      borderColor: style.borderColor ?? (isGovBank ? resolveReadableBorderColor(background, tokens.accentStrong, tokens.accent) : colorWithAlpha(accent, tokens.preset === "legacyWarm" ? 0.28 : 0.22)),
      shadow: shadowForTheme(graph, elevation),
    };
  }

  if (tone === "softAccent") {
    const background = style.backgroundColor ?? (isGovBank ? tokens.accentLight : colorWithAlpha(accent, tokens.preset === "legacyWarm" ? 0.08 : 0.07));
    return {
      background: fillToCssBackground(style) ?? background,
      borderColor: style.borderColor ?? (isGovBank ? colorWithAlpha(tokens.accent, 0.18) : colorWithAlpha(accent, tokens.preset === "legacyWarm" ? 0.18 : 0.16)),
      shadow: shadowForTheme(graph, Math.max(1, elevation - 1)),
    };
  }

  if (tone === "muted") {
    const background = style.backgroundColor ?? (tokens.preset === "legacyWarm" ? "#F3EEE7" : isGovBank ? tokens.secondarySoft : "#FFF8F4");
    return {
      background: fillToCssBackground(style) ?? background,
      borderColor: style.borderColor ?? (tokens.preset === "legacyWarm" ? "rgba(15,23,42,0.05)" : isGovBank ? colorWithAlpha(tokens.secondaryAccent, 0.18) : colorWithAlpha(tokens.neutralAccent, 0.32)),
      shadow: shadowForTheme(graph, Math.max(1, elevation - 1)),
    };
  }

  const background = style.backgroundColor ?? fallbackBackground;
  return {
    background: fillToCssBackground(style) ?? background,
    borderColor: style.borderColor ?? (tokens.preset === "legacyWarm" ? "rgba(15,23,42,0.06)" : isGovBank ? tokens.chromeLine : colorWithAlpha(tokens.accentSoft, 0.34)),
    shadow: shadowForTheme(graph, elevation),
  };
}

function badgeToneStyle(graph: SceneGraph, tone?: string): { background: string; color: string; border: string } {
  const palette = resolvePrimitiveTonePalette(
    graph.slide.theme,
    tone === "accent" || tone === "success" || tone === "warning" || tone === "neutral" ? tone : "default",
  );
  return {
    background: palette.cssFill,
    color: resolveReadableTextColor(palette.cssFill, palette.cssText, {
      fallbackDark: graph.slide.theme.titleColor,
      fallbackLight: "#FFF9F4",
    }),
    border: resolveReadableBorderColor(palette.cssFill, palette.cssBorder, graph.slide.theme.accentColor),
  };
}

function headerBandTextColor(element: Extract<SceneElement, { type: "title" | "text" }>, graph: SceneGraph): string | null {
  return null;
}

function renderPageChrome(graph: SceneGraph): string {
  return "";
}

const DEFAULT_ACTION_ICONS: IconName[] = ["layers", "target", "check", "dashboard", "briefcase", "trend"];

function fallbackFrameworkIcon(element: Extract<SceneElement, { type: "frameworkRail" }>): IconName {
  return element.content.layout === "top" ? "target" : "layers";
}

function fallbackObjectiveIcon(): IconName {
  return "target";
}

function fallbackActionIcon(
  element: Extract<SceneElement, { type: "actionCardGroup" }>,
  index: number,
): IconName | null {
  if (element.content.visualAid && element.content.visualAid !== "icon") {
    return null;
  }
  return DEFAULT_ACTION_ICONS[index % DEFAULT_ACTION_ICONS.length];
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const angleRad = (angleDeg - 90) * (Math.PI / 180);
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
}

function describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function chartPalette(graph: SceneGraph): string[] {
  const accent = graph.slide.theme.accentColor;
  return [
    accent,
    colorWithAlpha(accent, 0.84).replace("rgba(", "rgb(").replace(/, 0\.84\)/, ")"),
    colorWithAlpha(accent, 0.66).replace("rgba(", "rgb(").replace(/, 0\.66\)/, ")"),
    "#F4B183",
    "#F8CCB0",
    "#FBE8DA",
  ];
}

function formatChartNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function formatChartShare(value: number, total: number): string {
  if (total <= 0) {
    return "0%";
  }

  const share = (value / total) * 100;
  return `${Math.round(share)}%`;
}

export function renderDonutChartSvg(
  graph: SceneGraph,
  element: Extract<SceneElement, { type: "chart" }>,
  width: number,
  height: number,
): string {
  const { segments, centerText } = element.content;
  const palette = chartPalette(graph);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);
  const outerRadius = Math.max(56, Math.min(width, height) * 0.31);
  const strokeWidth = Math.max(22, Math.round(outerRadius * 0.3));
  const gapAngle = segments.length > 1 ? 2.4 : 0;
  const ringTrack = `<circle cx="${cx}" cy="${cy}" r="${outerRadius}" fill="none" stroke="${colorWithAlpha(graph.slide.theme.accentColor, 0.12)}" stroke-width="${strokeWidth}" />`;

  let angle = 0;
  const arcs = segments
    .map((segment, index) => {
      const sweep = (segment.value / total) * 360;
      const startAngle = angle + gapAngle / 2;
      const endAngle = angle + sweep - gapAngle / 2;
      angle += sweep;
      const color = segment.color ?? palette[index % palette.length];
      return `<path d="${describeArc(cx, cy, outerRadius, startAngle, Math.max(startAngle + 0.1, endAngle))}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" fill="none"/>`;
    })
    .join("");

  const centerPrimary = centerText ?? formatChartNumber(total);
  const centerSecondary = centerText ? "总量" : "总计";
  const centerLabel = centerText
    ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="${Math.max(18, Math.round(strokeWidth * 0.72))}" font-weight="700" fill="${graph.slide.theme.titleColor}">${escapeHtml(centerPrimary)}</text>`
    : `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="${Math.max(22, Math.round(strokeWidth * 0.74))}" font-weight="700" fill="${graph.slide.theme.titleColor}">${escapeHtml(centerPrimary)}</text>`;
  const centerSubLabel = `<text x="${cx}" y="${cy + Math.max(22, Math.round(strokeWidth * 0.72))}" text-anchor="middle" font-size="13" font-weight="600" fill="${colorWithAlpha(graph.slide.theme.textColor, 0.72)}">${escapeHtml(centerSecondary)}</text>`;

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    ${ringTrack}
    ${arcs}
    ${centerLabel}
    ${centerSubLabel}
  </svg>`;
}

function iconBadgeStyle(element: Extract<SceneElement, { type: "icon" }>, graph: SceneGraph): string {
  const accent = element.style.color ?? graph.slide.theme.accentColor;
  const smallSquare = element.w <= 44 && element.h <= 44;
  if (!smallSquare) {
    return "";
  }

  return `background:${colorWithAlpha(accent, 0.12)};border:1px solid ${colorWithAlpha(accent, 0.18)};border-radius:14px;padding:8px;`;
}

export function renderIconSvg(name: IconName): string {
  const curatedSvg = CURATED_LUCIDE_ICON_SVGS[name];
  if (curatedSvg) {
    return curatedSvg;
  }

  const icons: Partial<Record<IconName, string>> = {
    target: "<circle cx='32' cy='32' r='20' fill='none' stroke='currentColor' stroke-width='4'/><circle cx='32' cy='32' r='10' fill='none' stroke='currentColor' stroke-width='4'/><circle cx='32' cy='32' r='4' fill='currentColor'/>",
    warning: "<path d='M32 10 56 52H8L32 10Z' fill='none' stroke='currentColor' stroke-width='4' stroke-linejoin='round'/><line x1='32' y1='24' x2='32' y2='38' stroke='currentColor' stroke-width='4' stroke-linecap='round'/><circle cx='32' cy='46' r='2.5' fill='currentColor'/>",
    check: "<circle cx='32' cy='32' r='24' fill='none' stroke='currentColor' stroke-width='4'/><path d='M21 33 28 40 43 24' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/>",
    chart: "<path d='M14 50V20M32 50V12M50 50V28' stroke='currentColor' stroke-width='5' stroke-linecap='round'/><path d='M12 12H52' stroke='currentColor' stroke-width='4' stroke-linecap='round' opacity='0.2'/>",
    people: "<circle cx='23' cy='24' r='8' fill='none' stroke='currentColor' stroke-width='4'/><circle cx='42' cy='22' r='6' fill='none' stroke='currentColor' stroke-width='4'/><path d='M12 50c2-9 8-14 16-14s14 5 16 14' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round'/><path d='M35 49c1-6 5-10 11-11' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round'/>",
    arrows: "<path d='M12 24h34' stroke='currentColor' stroke-width='4' stroke-linecap='round'/><path d='M38 16l8 8-8 8' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/><path d='M52 40H18' stroke='currentColor' stroke-width='4' stroke-linecap='round'/><path d='M26 32l-8 8 8 8' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/>",
    layers: "<path d='M32 12 52 22 32 32 12 22 32 12Z' fill='none' stroke='currentColor' stroke-width='4' stroke-linejoin='round'/><path d='M18 30 32 38 46 30' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/><path d='M18 40 32 48 46 40' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/>",
    gear: "<circle cx='32' cy='32' r='10' fill='none' stroke='currentColor' stroke-width='4'/><path d='M32 10v8M32 46v8M10 32h8M46 32h8M16 16l6 6M42 42l6 6M16 48l6-6M42 22l6-6' stroke='currentColor' stroke-width='4' stroke-linecap='round'/>",
    flow: "<rect x='8' y='18' width='14' height='14' rx='4' fill='none' stroke='currentColor' stroke-width='4'/><rect x='42' y='18' width='14' height='14' rx='4' fill='none' stroke='currentColor' stroke-width='4'/><rect x='25' y='42' width='14' height='14' rx='4' fill='none' stroke='currentColor' stroke-width='4'/><path d='M22 25h20M32 32v10' stroke='currentColor' stroke-width='4' stroke-linecap='round'/>",
    service: "<rect x='12' y='18' width='40' height='30' rx='8' fill='none' stroke='currentColor' stroke-width='4'/><path d='M20 18v-4c0-4 4-8 12-8s12 4 12 8v4' fill='none' stroke='currentColor' stroke-width='4'/><path d='M22 34h20' stroke='currentColor' stroke-width='4' stroke-linecap='round'/>",
    hotline: "<path d='M19 13c8-6 18-6 26 0' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round'/><path d='M16 21c10-8 22-8 32 0' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round'/><rect x='16' y='28' width='10' height='18' rx='5' fill='none' stroke='currentColor' stroke-width='4'/><rect x='38' y='28' width='10' height='18' rx='5' fill='none' stroke='currentColor' stroke-width='4'/><path d='M26 43c2 4 8 7 12 7' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round'/>",
    briefcase: "<rect x='12' y='20' width='40' height='28' rx='6' fill='none' stroke='currentColor' stroke-width='4'/><path d='M24 20v-4c0-4 3-6 8-6s8 2 8 6v4' fill='none' stroke='currentColor' stroke-width='4'/><path d='M12 32h40' stroke='currentColor' stroke-width='4'/><path d='M28 32v6h8v-6' fill='none' stroke='currentColor' stroke-width='4' stroke-linejoin='round'/>",
    clock: "<circle cx='32' cy='32' r='22' fill='none' stroke='currentColor' stroke-width='4'/><path d='M32 20v14l10 6' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/>",
    building: "<path d='M16 54V14l16-6 16 6v40' fill='none' stroke='currentColor' stroke-width='4' stroke-linejoin='round'/><path d='M26 22h4M34 22h4M26 30h4M34 30h4M26 38h4M34 38h4M30 54V44h4v10' stroke='currentColor' stroke-width='4' stroke-linecap='round'/>",
    globe: "<circle cx='32' cy='32' r='22' fill='none' stroke='currentColor' stroke-width='4'/><path d='M10 32h44M32 10c7 6 11 13 11 22S39 48 32 54M32 10c-7 6-11 13-11 22s4 16 11 22' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round'/>",
    dashboard: "<rect x='10' y='14' width='44' height='36' rx='8' fill='none' stroke='currentColor' stroke-width='4'/><path d='M18 38c3-9 12-14 22-14' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round'/><circle cx='32' cy='38' r='3.5' fill='currentColor'/><path d='M35 35l9-9' stroke='currentColor' stroke-width='4' stroke-linecap='round'/>",
    lightbulb: "<path d='M22 28c0-6 4-12 10-12s10 6 10 12c0 5-3 8-6 11v5H28v-5c-3-3-6-6-6-11Z' fill='none' stroke='currentColor' stroke-width='4' stroke-linejoin='round'/><path d='M28 50h8M27 56h10' stroke='currentColor' stroke-width='4' stroke-linecap='round'/>",
    spark: "<path d='M32 10 37 24 52 24 40 33 45 48 32 39 19 48 24 33 12 24 27 24 32 10Z' fill='none' stroke='currentColor' stroke-width='4' stroke-linejoin='round'/>",
    trend: "<path d='M12 46h40' stroke='currentColor' stroke-width='4' stroke-linecap='round'/><path d='M16 38 26 28 34 34 48 18' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/><path d='M40 18h8v8' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/>",
    shield: "<path d='M32 10 50 16v14c0 12-8 20-18 24-10-4-18-12-18-24V16l18-6Z' fill='none' stroke='currentColor' stroke-width='4' stroke-linejoin='round'/><path d='M24 32l6 6 10-12' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/>",
  };

  const body = icons[name];
  if (!body) {
    throw new Error(`Unsupported icon: ${name}`);
  }
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
}

function renderGrid(element: Extract<SceneElement, { type: "grid" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="grid" data-role="${escapeHtml(element.role)}"`;
  const baseStyle = `${absoluteBoxStyle(element)};${toCssStyle(element.style, graph.slide.theme.textColor)}`;
  const columns = element.content.columnWidths?.length
    ? element.content.columnWidths.map((width) => `${width}px`).join(" ")
    : `repeat(${element.content.header.length}, 1fr)`;
  const outerBorderColor = element.style.borderColor ?? "#d9d5cf";

  const headerCells = element.content.header
    .map((cell, index) => {
      const rounded = index === 0 ? " grid-cell--header-first" : index === element.content.header.length - 1 ? " grid-cell--header-last" : "";
      return `<div class="grid-cell grid-cell--header${rounded}"><div${fitAttributes(element, 12)} class="fit-target grid-cell-text">${formatText(cell)}</div></div>`;
    })
    .join("");

  const bodyCells = element.content.rows
    .flatMap((row, rowIndex) =>
      row.map((cell, cellIndex) => {
        const classes = [
          "grid-cell",
          rowIndex === element.content.rows.length - 1 ? "grid-cell--last-row" : "",
          cellIndex === 0 ? "grid-cell--first-col" : "",
          cellIndex === row.length - 1 ? "grid-cell--last-col" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<div class="${classes}"><div${fitAttributes(element, 12)} class="fit-target grid-cell-text${cellIndex === 0 ? " grid-cell-text--strong" : ""}">${formatText(cell)}</div></div>`;
      })
    )
    .join("");

  return `<div ${attrs} class="grid-block" style="${baseStyle};--grid-columns:${columns};--grid-border-color:${outerBorderColor};">${headerCells}${bodyCells}</div>`;
}

function renderMetric(element: Extract<SceneElement, { type: "metric" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="metric" data-role="${escapeHtml(element.role)}"`;
  const accent = element.style.color ?? graph.slide.theme.accentColor;
  const surface = resolveSurfacePresentation(graph, element.style, "#FFFFFF");
  const background = surface.background;
  const borderColor = surface.borderColor;
  const borderWidth = element.style.borderWidth ?? 1;
  const radius = element.style.borderRadius ?? 22;
  const padding = element.style.padding ?? 24;

  return [
    `<div ${attrs} class="metric-block surface-block" style="${absoluteBoxStyle(element)};background:${background};border:${borderWidth}px ${element.style.borderStyle ?? "solid"} ${borderColor};border-radius:${radius}px;padding:${padding}px;box-shadow:${surface.shadow};display:flex;flex-direction:column;justify-content:center;gap:10px;">`,
    `<div class="metric-value" style="font-size:${Math.max(34, Math.min(72, Math.round(element.h * 0.25)))}px;font-weight:700;line-height:1;color:${accent};">${formatText(element.content.value)}</div>`,
    `<div class="metric-label" style="font-size:${Math.max(16, Math.round(element.h * 0.09))}px;font-weight:600;line-height:1.35;color:${graph.slide.theme.titleColor};">${formatText(element.content.label)}</div>`,
    element.content.note
      ? `<div class="metric-note" style="font-size:${Math.max(12, Math.round(element.h * 0.06))}px;line-height:1.5;color:${graph.slide.theme.textColor};">${formatText(element.content.note)}</div>`
      : "",
    `</div>`,
  ].join("");
}

function renderTimeline(element: Extract<SceneElement, { type: "timeline" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="timeline" data-role="${escapeHtml(element.role)}"`;
  const accent = element.style.color ?? graph.slide.theme.accentColor;
  const axisX = Math.max(26, Math.round(element.w * 0.085));
  const topY = 28;
  const bottomY = Math.max(topY + 40, element.h - 28);
  const itemGap = element.content.items.length > 1 ? (bottomY - topY) / (element.content.items.length - 1) : 0;
  const bodyX = axisX + 34;

  const items = element.content.items
    .map((item, index) => {
      const y = topY + index * itemGap;
      return [
        `<div class="timeline-dot" style="left:${axisX - 8}px;top:${y - 8}px;background:${accent};box-shadow:0 0 0 8px ${colorWithAlpha(accent, 0.14)};"></div>`,
        item.meta ? `<div class="timeline-meta" style="left:${bodyX}px;top:${y - 2}px;color:${accent};">${formatText(item.meta)}</div>` : "",
        `<div class="timeline-title" style="left:${bodyX}px;top:${y + (item.meta ? 18 : -2)}px;color:${graph.slide.theme.titleColor};">${formatText(item.title)}</div>`,
        item.body ? `<div class="timeline-body" style="left:${bodyX}px;top:${y + (item.meta ? 54 : 32)}px;color:${graph.slide.theme.textColor};">${formatText(item.body)}</div>` : "",
      ].join("");
    })
    .join("");

  return `<div ${attrs} class="timeline-block" style="${absoluteBoxStyle(element)};${toCssStyle(element.style, graph.slide.theme.textColor)}">
    <div class="timeline-axis" style="left:${axisX}px;top:${topY}px;height:${bottomY - topY}px;background:${colorWithAlpha(accent, 0.34)};"></div>
    ${items}
  </div>`;
}

function renderBarLikeChart(
  element: Extract<SceneElement, { type: "chart" }>,
  graph: SceneGraph,
  mode: "bar" | "progress",
): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="chart" data-role="${escapeHtml(element.role)}"`;
  const surface = resolveSurfacePresentation(graph, element.style, "#FFFFFF");
  const background = surface.background;
  const borderColor = surface.borderColor;
  const borderWidth = element.style.borderWidth ?? 1;
  const radius = element.style.borderRadius ?? 22;
  const padding = element.style.padding ?? 20;
  const palette = chartPalette(graph);
  const maxValue = element.content.maxValue ?? Math.max(...element.content.segments.map((segment) => segment.value), 1);
  const metaText = mode === "progress"
    ? (element.content.centerText ? `目标 ${formatText(element.content.centerText)}` : `当前满值 ${formatText(formatChartNumber(maxValue))}`)
    : `最高值 ${formatText(formatChartNumber(maxValue))}`;
  const header = element.content.title || metaText
    ? `<div class="chart-header">
        ${element.content.title ? `<div class="chart-title">${formatText(element.content.title)}</div>` : `<div class="chart-title"></div>`}
        <div class="chart-meta">${metaText}</div>
      </div>`
    : "";

  const rows = element.content.segments
    .map((segment, index) => {
      const color = segment.color ?? palette[index % palette.length];
      const ratio = Math.max(0.04, Math.min(1, segment.value / Math.max(maxValue, 1)));
      const valueText = mode === "progress" && element.content.centerText
        ? `${formatText(formatChartNumber(segment.value))}/${formatText(element.content.centerText)}`
        : formatText(formatChartNumber(segment.value));
      const note = segment.note ? `<div class="chart-row-note">${formatText(segment.note)}</div>` : "";
      return `<div class="chart-row chart-row--${mode}">
        <div class="chart-row-head">
          <span class="chart-row-label">${formatText(segment.label)}</span>
          <span class="chart-row-value">${valueText}</span>
        </div>
        <div class="chart-row-track">
          <div class="chart-row-fill" style="width:${Math.round(ratio * 100)}%;background:${color};"></div>
        </div>
        ${note}
      </div>`;
    })
    .join("");

  return `<div ${attrs} class="chart-block chart-block--${mode} surface-block" style="${absoluteBoxStyle(element)};background:${background};border:${borderWidth}px ${element.style.borderStyle ?? "solid"} ${borderColor};border-radius:${radius}px;padding:${padding}px;box-shadow:${surface.shadow};display:flex;flex-direction:column;gap:14px;">
    ${header}
    <div class="chart-rows">${rows}</div>
  </div>`;
}

function renderMatrix(element: Extract<SceneElement, { type: "matrix" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="matrix" data-role="${escapeHtml(element.role)}"`;
  const surface = resolveSurfacePresentation(graph, element.style, "#FFFFFF");
  const accent = element.style.color ?? graph.slide.theme.accentColor;
  const quadrants = new Map(element.content.quadrants.map((item) => [item.position, item]));
  const positions = [
    ["topLeft", "topRight"],
    ["bottomLeft", "bottomRight"],
  ] as const;

  const renderQuadrant = (position: "topLeft" | "topRight" | "bottomLeft" | "bottomRight") => {
    const item = quadrants.get(position);
    if (!item) {
      return `<div class="matrix-cell"></div>`;
    }
    const tone = badgeToneStyle(graph, item.tone);
    return `<div class="matrix-cell matrix-cell--${position}" style="background:${item.tone && item.tone !== "default" ? tone.background : "#FFFFFF"};border-color:${item.tone && item.tone !== "default" ? tone.border : "rgba(15,23,42,0.06)"};">
      ${item.badge ? `<div class="matrix-cell-badge" style="color:${tone.color};background:${tone.background};border:1px solid ${tone.border};">${formatText(item.badge)}</div>` : ""}
      <div class="matrix-cell-title">${formatText(item.title)}</div>
      ${item.body ? `<div class="matrix-cell-body">${formatText(item.body)}</div>` : ""}
    </div>`;
  };

  const rows = positions
    .map((row) => row.map((position) => renderQuadrant(position)).join(""))
    .join("");

  return `<div ${attrs} class="matrix-block surface-block" style="${absoluteBoxStyle(element)};background:${surface.background};border:${element.style.borderWidth ?? 1}px ${element.style.borderStyle ?? "solid"} ${surface.borderColor};border-radius:${element.style.borderRadius ?? 24}px;padding:${element.style.padding ?? 18}px;box-shadow:${surface.shadow};">
    ${element.content.yAxisTitle ? `<div class="matrix-axis matrix-axis--y" style="color:${accent};">${formatText(element.content.yAxisTitle)}</div>` : ""}
    ${element.content.xAxisTitle ? `<div class="matrix-axis matrix-axis--x" style="color:${accent};">${formatText(element.content.xAxisTitle)}</div>` : ""}
    ${element.content.centerLabel ? `<div class="matrix-center-label" style="color:${accent};">${formatText(element.content.centerLabel)}</div>` : ""}
    <div class="matrix-grid">
      ${rows}
    </div>
  </div>`;
}

function renderMiniDiagram(element: Extract<SceneElement, { type: "miniDiagram" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="miniDiagram" data-role="${escapeHtml(element.role)}"`;
  const surface = resolveSurfacePresentation(graph, element.style, "#FFFFFF");
  const accent = element.style.color ?? graph.slide.theme.accentColor;
  const title = element.content.title ? `<div class="mini-diagram-title">${formatText(element.content.title)}</div>` : "";
  const nodes = element.content.nodes;

  const renderNode = (node: typeof nodes[number], extraClass = "") => {
    const tone = badgeToneStyle(graph, node.tone);
    const icon = node.icon ? `<div class="mini-diagram-node-icon" style="color:${node.tone && node.tone !== "default" ? tone.color : accent};">${renderIconSvg(node.icon)}</div>` : "";
    return `<div class="mini-diagram-node ${extraClass}" style="background:${node.tone && node.tone !== "default" ? tone.background : "#FFFFFF"};border-color:${node.tone && node.tone !== "default" ? tone.border : "rgba(15,23,42,0.06)"};">
      ${icon}
      <div class="mini-diagram-node-title">${formatText(node.title)}</div>
      ${node.body ? `<div class="mini-diagram-node-body">${formatText(node.body)}</div>` : ""}
    </div>`;
  };

  let contentHtml = "";
  if (element.content.layout === "hub") {
    const hub = nodes[0];
    const spokes = nodes.slice(1);
    contentHtml = `<div class="mini-diagram mini-diagram--hub">
      <div class="mini-diagram-hub">${renderNode(hub, "mini-diagram-node--hub")}</div>
      <div class="mini-diagram-spokes">${spokes.map((node) => renderNode(node, "mini-diagram-node--spoke")).join("")}</div>
    </div>`;
  } else if (element.content.layout === "layers") {
    contentHtml = `<div class="mini-diagram mini-diagram--layers">${nodes.map((node) => renderNode(node, "mini-diagram-node--layer")).join("")}</div>`;
  } else {
    contentHtml = `<div class="mini-diagram mini-diagram--sequence">${nodes.map((node) => renderNode(node, "mini-diagram-node--sequence")).join("")}</div>`;
  }

  return `<div ${attrs} class="mini-diagram-block surface-block" style="${absoluteBoxStyle(element)};background:${surface.background};border:${element.style.borderWidth ?? 1}px ${element.style.borderStyle ?? "solid"} ${surface.borderColor};border-radius:${element.style.borderRadius ?? 24}px;padding:${element.style.padding ?? 18}px;box-shadow:${surface.shadow};">
    ${title}
    ${contentHtml}
  </div>`;
}

function renderChart(element: Extract<SceneElement, { type: "chart" }>, graph: SceneGraph): string {
  if (element.content.chartType === "bar" || element.content.chartType === "progress") {
    return renderBarLikeChart(element, graph, element.content.chartType);
  }

  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="chart" data-role="${escapeHtml(element.role)}"`;
  const surface = resolveSurfacePresentation(graph, element.style, "#FFFFFF");
  const background = surface.background;
  const borderColor = surface.borderColor;
  const borderWidth = element.style.borderWidth ?? 1;
  const radius = element.style.borderRadius ?? 22;
  const padding = element.style.padding ?? 20;
  const total = element.content.segments.reduce((sum, segment) => sum + segment.value, 0);
  const showLegend = element.content.showLegend !== false;
  const chartVisualWidth = showLegend ? Math.round(element.w * 0.52) : element.w - padding * 2;
  const chartVisualHeight = Math.max(220, element.h - padding * 2 - (element.content.title ? 44 : 8));
  const svg = renderDonutChartSvg(graph, element, chartVisualWidth, chartVisualHeight);
  const legend = showLegend
    ? `<div class="chart-legend">
        ${element.content.segments
          .map((segment, index) => {
            const color = segment.color ?? chartPalette(graph)[index % chartPalette(graph).length];
            const note = segment.note ? `<div class="chart-legend-note">${formatText(segment.note)}</div>` : "";
            return `<div class="chart-legend-item">
              <span class="chart-legend-swatch" style="background:${color};"></span>
              <div class="chart-legend-copy">
                <div class="chart-legend-label">${formatText(segment.label)}</div>
                ${note}
              </div>
              <div class="chart-legend-value">${formatText(formatChartNumber(segment.value))} <span>${formatText(formatChartShare(segment.value, total))}</span></div>
            </div>`;
          })
          .join("")}
      </div>`
    : "";
  const donutMeta = element.content.centerText ? `总量 ${formatText(element.content.centerText)}` : `合计 ${formatText(formatChartNumber(total))}`;
  const header = element.content.title || total > 0
    ? `<div class="chart-header">
        ${element.content.title ? `<div class="chart-title">${formatText(element.content.title)}</div>` : `<div class="chart-title"></div>`}
        <div class="chart-meta">${donutMeta}</div>
      </div>`
    : "";

  return `<div ${attrs} class="chart-block chart-block--donut surface-block" style="${absoluteBoxStyle(element)};background:${background};border:${borderWidth}px ${element.style.borderStyle ?? "solid"} ${borderColor};border-radius:${radius}px;padding:${padding}px;box-shadow:${surface.shadow};display:flex;flex-direction:column;gap:14px;">
    ${header}
    <div class="chart-donut-layout">
      <div class="chart-visual chart-visual--donut"><div class="chart-host">${svg}</div></div>
      ${legend}
    </div>
  </div>`;
}

function renderComparison(element: Extract<SceneElement, { type: "comparison" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="comparison" data-role="${escapeHtml(element.role)}"`;
  const layout = element.content.layout ?? "split";
  const surface = resolveSurfacePresentation(graph, element.style, "#FFFFFF");
  const accent = element.style.color ?? graph.slide.theme.accentColor;
  const renderSide = (side: typeof element.content.left, tone: "muted" | "softAccent") => {
    const sideSurface = tone === "softAccent"
      ? { background: colorWithAlpha(accent, 0.08), border: colorWithAlpha(accent, 0.18) }
      : { background: "#F6F3EE", border: "rgba(15,23,42,0.06)" };
    const bullets = side.bullets?.length
      ? `<ul class="comparison-side-bullets">${side.bullets.map((item) => `<li>${formatText(item)}</li>`).join("")}</ul>`
      : "";
    const badge = side.badge ? `<div class="comparison-side-badge">${formatText(side.badge)}</div>` : "";
    return `<div class="comparison-side comparison-side--${layout}" style="background:${sideSurface.background};border:1px solid ${sideSurface.border};">
      ${badge}
      <div class="comparison-side-title">${formatText(side.title)}</div>
      ${side.body ? `<div class="comparison-side-body">${formatText(side.body)}</div>` : ""}
      ${bullets}
    </div>`;
  };

  return `<div ${attrs} class="comparison-block comparison-block--${layout} surface-block" style="${absoluteBoxStyle(element)};background:${surface.background};border:${element.style.borderWidth ?? 1}px ${element.style.borderStyle ?? "solid"} ${surface.borderColor};border-radius:${element.style.borderRadius ?? 24}px;padding:${element.style.padding ?? 18}px;box-shadow:${surface.shadow};">
    <div class="comparison-grid comparison-grid--${layout}">
      ${renderSide(element.content.left, "muted")}
      ${renderSide(element.content.right, "softAccent")}
    </div>
    ${element.content.conclusion ? `<div class="comparison-conclusion">${formatText(element.content.conclusion)}</div>` : ""}
  </div>`;
}

function renderInsight(element: Extract<SceneElement, { type: "insight" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="insight" data-role="${escapeHtml(element.role)}"`;
  const tone = badgeToneStyle(graph, element.content.tone === "default" ? undefined : element.content.tone);
  const surface = resolveSurfacePresentation(
    graph,
    {
      ...element.style,
      backgroundColor: element.style.backgroundColor ?? tone.background,
      borderColor: element.style.borderColor ?? tone.border,
      color: element.style.color ?? tone.color,
    },
    tone.background,
  );
  const quoteMark = "&ldquo;";
  return `<div ${attrs} class="insight-block surface-block" style="${absoluteBoxStyle(element)};background:${surface.background};border:${element.style.borderWidth ?? 1}px ${element.style.borderStyle ?? "solid"} ${surface.borderColor};border-radius:${element.style.borderRadius ?? 24}px;padding:${element.style.padding ?? 22}px;box-shadow:${surface.shadow};">
    <div class="insight-kicker" style="color:${element.style.color ?? tone.color};">${formatText(element.content.title)}</div>
    <div class="insight-quote" style="color:${graph.slide.theme.titleColor};"><span class="insight-quote-mark">${quoteMark}</span>${formatText(element.content.text)}</div>
    ${element.content.emphasis ? `<div class="insight-emphasis" style="color:${graph.slide.theme.titleColor};">${formatText(element.content.emphasis)}</div>` : ""}
    ${element.content.attribution ? `<div class="insight-attribution" style="color:${graph.slide.theme.textColor};">${formatText(element.content.attribution)}</div>` : ""}
  </div>`;
}

function renderSummaryBand(element: Extract<SceneElement, { type: "summaryBand" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="summaryBand" data-role="${escapeHtml(element.role)}"`;
  const tone = badgeToneStyle(graph, element.content.tone);
  const surface = resolveSurfacePresentation(
    graph,
    { ...element.style, backgroundColor: element.style.backgroundColor ?? tone.background, borderColor: element.style.borderColor ?? tone.border, color: element.style.color ?? tone.color },
    tone.background,
  );
  const items = element.content.items.map((item) => `<div class="summary-band-chip">${formatText(item)}</div>`).join("");
  return `<div ${attrs} class="summary-band-block surface-block" style="${absoluteBoxStyle(element)};background:${surface.background};border:${element.style.borderWidth ?? 1}px ${element.style.borderStyle ?? "solid"} ${surface.borderColor};border-radius:${element.style.borderRadius ?? 24}px;padding:${element.style.padding ?? 18}px;box-shadow:${surface.shadow};">
    <div class="summary-band-title" style="color:${element.style.color ?? tone.color};">${formatText(element.content.title)}</div>
    <div class="summary-band-items">${items}</div>
    ${element.content.emphasis ? `<div class="summary-band-emphasis">${formatText(element.content.emphasis)}</div>` : ""}
  </div>`;
}

function renderFunnel(element: Extract<SceneElement, { type: "funnel" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="funnel" data-role="${escapeHtml(element.role)}"`;
  const surface = resolveSurfacePresentation(graph, element.style, "#FFFFFF");
  const stages = element.content.stages;
  const palette = chartPalette(graph);
  const title = element.content.title ? `<div class="funnel-title">${formatText(element.content.title)}</div>` : "";
  const blocks = stages.map((stage, index) => {
    const width = 100 - index * Math.max(8, Math.floor(38 / Math.max(stages.length - 1, 1)));
    const tone = stage.tone as string | undefined;
    const color = tone && tone !== "default"
      ? badgeToneStyle(graph, stage.tone).background
      : colorWithAlpha(tone === "neutral" ? "#64748B" : palette[index % palette.length], 0.14);
    const border = tone && tone !== "default"
      ? badgeToneStyle(graph, stage.tone).border
      : colorWithAlpha(palette[index % palette.length], 0.22);
    return `<div class="funnel-stage" style="width:${width}%;background:${color};border:1px solid ${border};">
      <div class="funnel-stage-head">
        <span class="funnel-stage-title">${formatText(stage.title)}</span>
        ${stage.value ? `<span class="funnel-stage-value">${formatText(stage.value)}</span>` : ""}
      </div>
      ${stage.body ? `<div class="funnel-stage-body">${formatText(stage.body)}</div>` : ""}
      ${stage.note ? `<div class="funnel-stage-note">${formatText(stage.note)}</div>` : ""}
    </div>`;
  }).join("");
  return `<div ${attrs} class="funnel-block surface-block" style="${absoluteBoxStyle(element)};background:${surface.background};border:${element.style.borderWidth ?? 1}px ${element.style.borderStyle ?? "solid"} ${surface.borderColor};border-radius:${element.style.borderRadius ?? 24}px;padding:${element.style.padding ?? 18}px;box-shadow:${surface.shadow};">
    ${title}
    <div class="funnel-stages">${blocks}</div>
  </div>`;
}

function renderSwimlane(element: Extract<SceneElement, { type: "swimlane" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="swimlane" data-role="${escapeHtml(element.role)}"`;
  const surface = resolveSurfacePresentation(graph, element.style, "#FFFFFF");
  const title = element.content.title ? `<div class="swimlane-title">${formatText(element.content.title)}</div>` : "";
  const lanes = element.content.lanes.map((lane) => {
    const tone = badgeToneStyle(graph, lane.tone);
    const steps = lane.steps.map((step) => `<div class="swimlane-step">${formatText(step)}</div>`).join("");
    return `<div class="swimlane-row">
      <div class="swimlane-label">
        <div class="swimlane-label-title">${formatText(lane.title)}</div>
        ${lane.badge ? `<div class="swimlane-label-badge" style="color:${tone.color};background:${tone.background};border:1px solid ${tone.border};">${formatText(lane.badge)}</div>` : ""}
      </div>
      <div class="swimlane-steps">${steps}</div>
    </div>`;
  }).join("");
  return `<div ${attrs} class="swimlane-block surface-block" style="${absoluteBoxStyle(element)};background:${surface.background};border:${element.style.borderWidth ?? 1}px ${element.style.borderStyle ?? "solid"} ${surface.borderColor};border-radius:${element.style.borderRadius ?? 24}px;padding:${element.style.padding ?? 18}px;box-shadow:${surface.shadow};">
    ${title}
    <div class="swimlane-rows">${lanes}</div>
  </div>`;
}

function renderCover(element: Extract<SceneElement, { type: "cover" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="cover" data-role="${escapeHtml(element.role)}"`;
  const accent = element.style.color ?? graph.slide.theme.accentColor;
  const layout = element.content.layout ?? "centered";
  const titleSize = Math.max(48, Math.min(96, Math.round(element.h * 0.12)));
  const subtitleSize = Math.max(20, Math.min(36, Math.round(element.h * 0.05)));
  const metaSize = Math.max(14, Math.min(20, Math.round(element.h * 0.025)));

  if (layout === "asymmetric") {
    const leftW = Math.round(element.w * 0.55);
    const rightW = element.w - leftW;
    return `<div ${attrs} class="cover-block cover-block--asymmetric" style="${absoluteBoxStyle(element)};display:flex;">
      <div class="cover-left" style="width:${leftW}px;height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 48px;">
        <div class="cover-title" style="font-size:${titleSize}px;font-weight:700;line-height:1.1;color:${graph.slide.theme.titleColor};margin-bottom:16px;">${formatText(element.content.title)}</div>
        ${element.content.subtitle ? `<div class="cover-subtitle" style="font-size:${subtitleSize}px;font-weight:500;line-height:1.35;color:${graph.slide.theme.textColor};margin-bottom:12px;">${formatText(element.content.subtitle)}</div>` : ""}
        ${element.content.meta ? `<div class="cover-meta" style="font-size:${metaSize}px;line-height:1.5;color:${graph.slide.theme.textColor};opacity:0.7;">${formatText(element.content.meta)}</div>` : ""}
      </div>
      <div class="cover-right" style="width:${rightW}px;height:100%;background:${colorWithAlpha(accent, 0.12)};display:flex;align-items:center;justify-content:center;">
        <div style="width:180px;height:180px;border-radius:50%;background:${colorWithAlpha(accent, 0.22)};display:flex;align-items:center;justify-content:center;">
          <div style="width:120px;height:120px;border-radius:50%;background:${accent};opacity:0.85;"></div>
        </div>
      </div>
    </div>`;
  }

  return `<div ${attrs} class="cover-block cover-block--centered" style="${absoluteBoxStyle(element)};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:48px;">
    <div class="cover-title" style="font-size:${titleSize}px;font-weight:700;line-height:1.1;color:${graph.slide.theme.titleColor};margin-bottom:20px;max-width:90%;">${formatText(element.content.title)}</div>
    ${element.content.subtitle ? `<div class="cover-subtitle" style="font-size:${subtitleSize}px;font-weight:500;line-height:1.35;color:${graph.slide.theme.textColor};margin-bottom:16px;max-width:80%;">${formatText(element.content.subtitle)}</div>` : ""}
    ${element.content.meta ? `<div class="cover-meta" style="font-size:${metaSize}px;line-height:1.5;color:${graph.slide.theme.textColor};opacity:0.7;">${formatText(element.content.meta)}</div>` : ""}
  </div>`;
}

function renderToc(element: Extract<SceneElement, { type: "toc" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="toc" data-role="${escapeHtml(element.role)}"`;
  const accent = element.style.color ?? graph.slide.theme.accentColor;
  const layout = element.content.layout ?? "vertical";
  const title = element.content.title ?? "目录";
  const titleSize = Math.max(28, Math.min(40, Math.round(element.h * 0.05)));
  const itemTitleSize = Math.max(18, Math.min(26, Math.round(element.h * 0.035)));
  const numberSize = Math.max(22, Math.min(32, Math.round(element.h * 0.04)));
  const descSize = Math.max(12, Math.min(16, Math.round(element.h * 0.02)));

  const items = element.content.items.map((item, index) => {
    const num = item.number ?? String(index + 1).padStart(2, "0");
    return `<div class="toc-item" style="display:flex;align-items:flex-start;gap:16px;padding:16px 0;border-bottom:1px solid rgba(15,23,42,0.06);">
      <div class="toc-number" style="font-size:${numberSize}px;font-weight:700;color:${accent};min-width:48px;">${formatText(num)}</div>
      <div class="toc-content" style="flex:1;">
        <div class="toc-item-title" style="font-size:${itemTitleSize}px;font-weight:600;color:${graph.slide.theme.titleColor};line-height:1.3;">${formatText(item.title)}</div>
        ${item.description ? `<div class="toc-item-desc" style="font-size:${descSize}px;color:${graph.slide.theme.textColor};line-height:1.5;margin-top:6px;">${formatText(item.description)}</div>` : ""}
      </div>
    </div>`;
  }).join("");

  if (layout === "grid") {
    const cols = element.content.items.length <= 3 ? 1 : 2;
    return `<div ${attrs} class="toc-block toc-block--grid" style="${absoluteBoxStyle(element)};padding:40px;">
      <div class="toc-title" style="font-size:${titleSize}px;font-weight:700;color:${graph.slide.theme.titleColor};margin-bottom:32px;">${formatText(title)}</div>
      <div class="toc-grid" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:24px;">${items}</div>
    </div>`;
  }

  if (layout === "sidebar") {
    const sidebarW = Math.round(element.w * 0.25);
    return `<div ${attrs} class="toc-block toc-block--sidebar" style="${absoluteBoxStyle(element)};display:flex;">
      <div class="toc-sidebar" style="width:${sidebarW}px;height:100%;background:${colorWithAlpha(accent, 0.12)};padding:40px 24px;">
        <div class="toc-title" style="font-size:${titleSize}px;font-weight:700;color:${accent};writing-mode:vertical-rl;text-orientation:mixed;">${formatText(title)}</div>
      </div>
      <div class="toc-main" style="flex:1;padding:40px;">${items}</div>
    </div>`;
  }

  return `<div ${attrs} class="toc-block toc-block--vertical" style="${absoluteBoxStyle(element)};padding:40px;">
    <div class="toc-title" style="font-size:${titleSize}px;font-weight:700;color:${graph.slide.theme.titleColor};margin-bottom:32px;">${formatText(title)}</div>
    <div class="toc-items">${items}</div>
  </div>`;
}

function renderSectionDivider(element: Extract<SceneElement, { type: "sectionDivider" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="sectionDivider" data-role="${escapeHtml(element.role)}"`;
  const accent = element.style.color ?? graph.slide.theme.accentColor;
  const layout = element.content.layout ?? "boldCenter";
  const numberSize = Math.max(72, Math.min(120, Math.round(element.h * 0.18)));
  const titleSize = Math.max(32, Math.min(48, Math.round(element.h * 0.06)));
  const introSize = Math.max(14, Math.min(20, Math.round(element.h * 0.025)));

  if (layout === "accentBlock") {
    const blockW = Math.round(element.w * 0.35);
    return `<div ${attrs} class="section-divider-block section-divider--accentBlock" style="${absoluteBoxStyle(element)};display:flex;">
      <div class="section-divider-accent" style="width:${blockW}px;height:100%;background:${accent};display:flex;align-items:center;justify-content:center;">
        <div class="section-divider-number" style="font-size:${numberSize}px;font-weight:700;color:#ffffff;">${formatText(element.content.number ?? "")}</div>
      </div>
      <div class="section-divider-content" style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:48px;">
        <div class="section-divider-title" style="font-size:${titleSize}px;font-weight:700;color:${graph.slide.theme.titleColor};margin-bottom:12px;">${formatText(element.content.title)}</div>
        ${element.content.intro ? `<div class="section-divider-intro" style="font-size:${introSize}px;color:${graph.slide.theme.textColor};line-height:1.5;">${formatText(element.content.intro)}</div>` : ""}
      </div>
    </div>`;
  }

  if (layout === "splitBackground") {
    return `<div ${attrs} class="section-divider-block section-divider--splitBackground" style="${absoluteBoxStyle(element)};display:flex;align-items:center;justify-content:center;background:${colorWithAlpha(accent, 0.08)};">
      <div class="section-divider-number" style="font-size:${numberSize}px;font-weight:700;color:${colorWithAlpha(accent, 0.25)};position:absolute;right:80px;top:50%;transform:translateY(-50%);">${formatText(element.content.number ?? "")}</div>
      <div style="text-align:center;position:relative;z-index:1;">
        <div class="section-divider-title" style="font-size:${titleSize}px;font-weight:700;color:${graph.slide.theme.titleColor};margin-bottom:12px;">${formatText(element.content.title)}</div>
        ${element.content.intro ? `<div class="section-divider-intro" style="font-size:${introSize}px;color:${graph.slide.theme.textColor};line-height:1.5;">${formatText(element.content.intro)}</div>` : ""}
      </div>
    </div>`;
  }

  return `<div ${attrs} class="section-divider-block section-divider--boldCenter" style="${absoluteBoxStyle(element)};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
    <div class="section-divider-number" style="font-size:${numberSize}px;font-weight:700;color:${accent};margin-bottom:16px;">${formatText(element.content.number ?? "")}</div>
    <div class="section-divider-title" style="font-size:${titleSize}px;font-weight:700;color:${graph.slide.theme.titleColor};margin-bottom:12px;">${formatText(element.content.title)}</div>
    ${element.content.intro ? `<div class="section-divider-intro" style="font-size:${introSize}px;color:${graph.slide.theme.textColor};line-height:1.5;max-width:60%;">${formatText(element.content.intro)}</div>` : ""}
  </div>`;
}

function renderSummary(element: Extract<SceneElement, { type: "summary" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="summary" data-role="${escapeHtml(element.role)}"`;
  const accent = element.style.color ?? graph.slide.theme.accentColor;
  const layout = element.content.layout ?? "takeaways";
  const titleSize = Math.max(36, Math.min(56, Math.round(element.h * 0.07)));
  const itemSize = Math.max(16, Math.min(22, Math.round(element.h * 0.028)));
  const ctaSize = Math.max(14, Math.min(18, Math.round(element.h * 0.022)));

  const takeaways = element.content.takeaways?.length
    ? `<div class="summary-takeaways" style="display:flex;flex-direction:column;gap:16px;">
        ${element.content.takeaways.map((item) => `<div class="summary-takeaway-item" style="display:flex;align-items:flex-start;gap:12px;">
          <div style="width:24px;height:24px;border-radius:50%;background:${colorWithAlpha(accent, 0.14)};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div style="font-size:${itemSize}px;color:${graph.slide.theme.textColor};line-height:1.5;">${formatText(item)}</div>
        </div>`).join("")}
      </div>`
    : "";

  if (layout === "cta") {
    return `<div ${attrs} class="summary-block summary--cta" style="${absoluteBoxStyle(element)};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:48px;">
      <div class="summary-title" style="font-size:${titleSize}px;font-weight:700;color:${graph.slide.theme.titleColor};margin-bottom:32px;">${formatText(element.content.title)}</div>
      ${takeaways}
      ${element.content.callToAction ? `<div class="summary-cta" style="margin-top:32px;padding:16px 32px;background:${accent};color:#ffffff;font-size:${ctaSize}px;font-weight:600;border-radius:999px;">${formatText(element.content.callToAction)}</div>` : ""}
      ${element.content.contact ? `<div class="summary-contact" style="margin-top:24px;font-size:${ctaSize}px;color:${graph.slide.theme.textColor};opacity:0.7;">${formatText(element.content.contact)}</div>` : ""}
    </div>`;
  }

  if (layout === "thankYou") {
    return `<div ${attrs} class="summary-block summary--thankYou" style="${absoluteBoxStyle(element)};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:${colorWithAlpha(accent, 0.06)};">
      <div class="summary-title" style="font-size:${Math.round(titleSize * 1.2)}px;font-weight:700;color:${graph.slide.theme.titleColor};margin-bottom:24px;">${formatText(element.content.title)}</div>
      ${element.content.contact ? `<div class="summary-contact" style="font-size:${ctaSize}px;color:${graph.slide.theme.textColor};">${formatText(element.content.contact)}</div>` : ""}
    </div>`;
  }

  return `<div ${attrs} class="summary-block summary--takeaways" style="${absoluteBoxStyle(element)};padding:48px;">
    <div class="summary-title" style="font-size:${titleSize}px;font-weight:700;color:${graph.slide.theme.titleColor};margin-bottom:32px;">${formatText(element.content.title)}</div>
    ${takeaways}
    ${element.content.callToAction ? `<div class="summary-cta" style="margin-top:32px;font-size:${ctaSize}px;color:${accent};font-weight:600;">${formatText(element.content.callToAction)}</div>` : ""}
  </div>`;
}

function renderFrameworkRail(element: Extract<SceneElement, { type: "frameworkRail" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="frameworkRail" data-role="${escapeHtml(element.role)}"`;
  const palette = resolvePrimitiveTonePalette(
    graph.slide.theme,
    element.content.tone === "accent" || element.content.tone === "success" || element.content.tone === "warning" || element.content.tone === "neutral"
      ? element.content.tone
      : "accent",
  );
  const surface = resolveSurfacePresentation(
    graph,
    {
      ...element.style,
      backgroundColor: element.style.backgroundColor ?? palette.cssFill,
      borderColor: element.style.borderColor ?? palette.cssBorder,
      color: element.style.color ?? palette.cssText,
      surfaceTone: element.style.surfaceTone ?? "softAccent",
    },
    palette.cssFill,
  );
  const layout = element.content.layout ?? "left";
  const denseMode = element.content.densityClass === "dense" || (element.content.bullets?.length ?? 0) >= 5 || (element.content.summary?.length ?? 0) >= 58;
  const accentTextColor = resolveReadableTextColor(
    surface.background,
    element.style.color ?? palette.cssText,
    { fallbackDark: graph.slide.theme.titleColor, fallbackLight: "#FFF9F4" },
  );
  const titleTextColor = resolveReadableTextColor(
    surface.background,
    graph.slide.theme.titleColor,
    { fallbackDark: graph.slide.theme.titleColor, fallbackLight: "#FFF9F4" },
  );
  const bodyTextColor = resolveReadableTextColor(
    surface.background,
    graph.slide.theme.textColor,
    { fallbackDark: graph.slide.theme.textColor, fallbackLight: "#FFF9F4" },
  );
  const titleSize = layout === "top"
    ? Math.max(24, Math.min(32, Math.round(element.h * 0.1)))
    : Math.max(denseMode ? 18 : 20, Math.min(28, Math.round(element.w * 0.05)));
  const summarySize = layout === "top" ? 16 : denseMode ? 14 : 15;
  const bulletItems = (element.content.bullets ?? []).map((item) => `<li style="margin:0 0 8px 0;">${formatText(item)}</li>`).join("");
  const showFooterChips = element.h >= (denseMode ? 230 : 260);
  const footerItems = showFooterChips
    ? (element.content.footerItems ?? [])
      .map((item) => `<div style="padding:9px 14px;border-radius:14px;background:#FFFFFF;border:1px solid ${resolveReadableBorderColor("#FFFFFF", palette.cssBorder, graph.slide.theme.accentColor)};font-size:12px;font-weight:700;color:${resolveReadableTextColor("#FFFFFF", graph.slide.theme.titleColor, { fallbackDark: graph.slide.theme.titleColor, fallbackLight: "#14213D" })};line-height:1.25;">${formatText(item)}</div>`)
      .join("")
    : "";
  const effectiveIcon = element.content.icon ?? fallbackFrameworkIcon(element);
  const labelIcon = effectiveIcon
    ? `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:12px;background:${colorWithAlphaCss(graph.slide.theme.accentColor, 0.12)};border:1px solid ${resolveReadableBorderColor(colorWithAlphaCss(graph.slide.theme.accentColor, 0.12), palette.cssBorder, graph.slide.theme.accentColor)};color:${resolveReadableTextColor(colorWithAlphaCss(graph.slide.theme.accentColor, 0.12), palette.cssText, { fallbackDark: graph.slide.theme.accentColor, fallbackLight: "#FFF9F4" })};flex:0 0 auto;">${renderIconSvg(effectiveIcon)}</div>`
    : "";

  return `<div ${attrs} class="framework-rail-block surface-block" style="${absoluteBoxStyle(element)};background:${surface.background};border:${element.style.borderWidth ?? 1}px ${element.style.borderStyle ?? "solid"} ${surface.borderColor};border-radius:${element.style.borderRadius ?? 28}px;padding:${element.style.padding ?? 24}px;box-shadow:${surface.shadow};display:flex;flex-direction:column;gap:${layout === "top" ? 12 : 14}px;">
    ${element.content.label || labelIcon ? `<div style="display:flex;align-items:center;gap:10px;color:${accentTextColor};font-size:13px;font-weight:700;letter-spacing:0.01em;">${labelIcon}<span style="display:inline-block;width:26px;height:4px;border-radius:999px;background:${accentTextColor};"></span>${element.content.label ? formatText(element.content.label) : ""}</div>` : ""}
    <div style="font-size:${titleSize}px;font-weight:700;line-height:${element.style.lineHeight ?? 1.18};color:${titleTextColor};">${formatText(element.content.title)}</div>
    ${element.content.summary ? `<div style="font-size:${summarySize}px;line-height:${Math.max(1.25, element.style.lineHeight ?? 1.25)};color:${bodyTextColor};opacity:0.9;">${formatText(element.content.summary)}</div>` : ""}
    ${bulletItems ? `<ul style="margin:0;padding-left:20px;font-size:${denseMode ? 14 : 15}px;line-height:1.32;color:${bodyTextColor};">${bulletItems}</ul>` : ""}
    ${showFooterChips && (element.content.footerTitle || footerItems) ? `<div style="margin-top:auto;display:flex;flex-direction:column;gap:8px;padding-top:6px;">${element.content.footerTitle ? `<div style="font-size:12px;font-weight:700;color:${accentTextColor};text-transform:none;">${formatText(element.content.footerTitle)}</div>` : ""}<div style="display:flex;flex-wrap:wrap;gap:8px;">${footerItems}</div></div>` : ""}
  </div>`;
}

function renderActionCardGroup(element: Extract<SceneElement, { type: "actionCardGroup" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="actionCardGroup" data-role="${escapeHtml(element.role)}"`;
  const layout = computeActionCardGroupLayout(element.content, { w: element.w, h: element.h });
  const title = element.content.title
    ? `<div style="position:absolute;left:${layout.padding}px;top:${layout.padding}px;width:${element.w - layout.padding * 2}px;font-size:16px;font-weight:700;line-height:1.25;color:${graph.slide.theme.titleColor};">${formatText(element.content.title)}</div>`
    : "";
  const cards = layout.slots.map((slot) => {
    const item = element.content.items[slot.itemIndex];
    const effectiveIcon = item.icon ?? fallbackActionIcon(element, slot.itemIndex);
    const denseMode = element.content.densityClass === "dense" || element.content.items.length >= 5;
    const compactCard = denseMode || slot.weight === "compact" || slot.w < 320 || slot.h < 170;
    const iconPlacement = element.content.iconPlacement ?? "inline";
    const palette = resolvePrimitiveTonePalette(
      graph.slide.theme,
      item.tone === "accent" || item.tone === "success" || item.tone === "warning" || item.tone === "neutral"
        ? item.tone
        : slot.weight === "lead"
          ? "accent"
          : "default",
    );
    const surface = resolveSurfacePresentation(
      graph,
      {
        ...element.style,
        backgroundColor: slot.weight === "lead" ? colorWithAlphaCss(graph.slide.theme.accentColor, 0.08) : palette.cssFill,
        borderColor: slot.weight === "lead" ? colorWithAlphaCss(graph.slide.theme.accentColor, 0.22) : palette.cssBorder,
        surfaceTone: slot.weight === "lead" ? "softAccent" : "default",
        elevation: slot.weight === "lead" ? 2 : 1,
      },
      palette.cssFill,
    );
    const titleTextColor = resolveReadableTextColor(surface.background, graph.slide.theme.titleColor, {
      fallbackDark: graph.slide.theme.titleColor,
      fallbackLight: "#FFF9F4",
    });
    const bodyTextColor = resolveReadableTextColor(surface.background, graph.slide.theme.textColor, {
      fallbackDark: graph.slide.theme.textColor,
      fallbackLight: "#FFF9F4",
    });
    const accentTextColor = resolveReadableTextColor(surface.background, palette.cssText, {
      fallbackDark: graph.slide.theme.accentColor,
      fallbackLight: "#FFF9F4",
    });
    const showEyebrow = !compactCard;
    const showEmphasis = !compactCard || slot.weight === "lead";
    const step = !effectiveIcon && (item.step || (showEyebrow ? item.eyebrow : undefined))
      ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;"><div style="padding:6px 10px;border-radius:10px;background:${palette.cssFill};border:1px solid ${resolveReadableBorderColor(palette.cssFill, palette.cssBorder, graph.slide.theme.accentColor)};color:${resolveReadableTextColor(palette.cssFill, palette.cssText, { fallbackDark: graph.slide.theme.accentColor, fallbackLight: "#FFF9F4" })};font-size:12px;font-weight:700;line-height:1;">${formatText(item.step ?? item.eyebrow ?? "")}</div>${item.step && item.eyebrow ? `<div style="font-size:12px;font-weight:700;color:${accentTextColor};">${formatText(item.eyebrow)}</div>` : ""}</div>`
      : "";
    const visualAid = effectiveIcon && iconPlacement === "stacked"
      ? `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:11px;background:${colorWithAlphaCss(graph.slide.theme.accentColor, 0.12)};border:1px solid ${resolveReadableBorderColor(colorWithAlphaCss(graph.slide.theme.accentColor, 0.12), palette.cssBorder, graph.slide.theme.accentColor)};color:${resolveReadableTextColor(colorWithAlphaCss(graph.slide.theme.accentColor, 0.12), palette.cssText, { fallbackDark: graph.slide.theme.accentColor, fallbackLight: "#FFF9F4" })};margin-bottom:12px;">${renderIconSvg(effectiveIcon)}</div>`
      : !effectiveIcon && element.content.visualAid === "accentStrip"
        ? `<div style="width:42px;height:4px;border-radius:999px;background:${accentTextColor};margin-bottom:14px;"></div>`
        : !effectiveIcon && element.content.visualAid === "divider"
          ? `<div style="width:54px;height:1px;background:${resolveReadableBorderColor(surface.background, palette.cssBorder, graph.slide.theme.accentColor)};margin-bottom:14px;"></div>`
          : "";
    const titleSize = slot.weight === "lead" ? 17 : 15;
    const bodySize = compactCard ? 13 : 14;
    const titleRow = effectiveIcon && iconPlacement === "inline"
      ? `<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;"><div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:10px;background:${colorWithAlphaCss(graph.slide.theme.accentColor, 0.12)};border:1px solid ${resolveReadableBorderColor(colorWithAlphaCss(graph.slide.theme.accentColor, 0.12), palette.cssBorder, graph.slide.theme.accentColor)};color:${resolveReadableTextColor(colorWithAlphaCss(graph.slide.theme.accentColor, 0.12), palette.cssText, { fallbackDark: graph.slide.theme.accentColor, fallbackLight: "#FFF9F4" })};flex:0 0 auto;">${renderIconSvg(effectiveIcon)}</div><div style="font-size:${titleSize}px;font-weight:700;line-height:1.18;color:${titleTextColor};min-width:0;">${formatText(item.title)}</div></div>`
      : `<div style="font-size:${titleSize}px;font-weight:700;line-height:1.18;color:${titleTextColor};margin-bottom:10px;">${formatText(item.title)}</div>`;
    return `<div class="surface-block" style="position:absolute;left:${slot.x}px;top:${slot.y}px;width:${slot.w}px;height:${slot.h}px;padding:18px;border-radius:${slot.weight === "lead" ? 24 : 22}px;background:${surface.background};border:1px solid ${surface.borderColor};box-shadow:${surface.shadow};overflow:hidden;display:flex;flex-direction:column;">
      <div aria-hidden="true" style="position:absolute;left:0;top:0;width:100%;height:${slot.weight === "lead" ? 7 : 5}px;background:${slot.weight === "lead" ? graph.slide.theme.accentColor : colorWithAlphaCss(graph.slide.theme.accentColor, 0.52)};"></div>
      ${step}
      ${visualAid}
      ${titleRow}
      <div style="font-size:${bodySize}px;line-height:1.28;color:${bodyTextColor};white-space:normal;word-break:break-word;overflow-wrap:anywhere;">${formatText(item.body)}</div>
      ${showEmphasis && item.emphasis ? `<div style="margin-top:auto;padding-top:12px;font-size:12px;font-weight:700;line-height:1.35;color:${accentTextColor};display:flex;align-items:center;gap:8px;"><span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:${accentTextColor};opacity:0.86;"></span>${formatText(item.emphasis)}</div>` : ""}
    </div>`;
  }).join("");

  return `<div ${attrs} class="action-card-group-block" style="${absoluteBoxStyle(element)};">${title}${cards}</div>`;
}

function renderObjectiveBand(element: Extract<SceneElement, { type: "objectiveBand" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="objectiveBand" data-role="${escapeHtml(element.role)}"`;
  const palette = resolvePrimitiveTonePalette(
    graph.slide.theme,
    element.content.tone === "accent" || element.content.tone === "success" || element.content.tone === "warning" || element.content.tone === "neutral"
      ? element.content.tone
      : "accent",
  );
  const background = element.style.backgroundColor ?? "#FFF8F4";
  const borderColor = resolveReadableBorderColor(background, element.style.borderColor ?? palette.cssBorder, graph.slide.theme.accentColor);
  const titleTextColor = resolveReadableTextColor(background, graph.slide.theme.titleColor, {
    fallbackDark: graph.slide.theme.titleColor,
    fallbackLight: "#FFF9F4",
  });
  const accentTextColor = resolveReadableTextColor(background, palette.cssText, {
    fallbackDark: graph.slide.theme.accentColor,
    fallbackLight: "#FFF9F4",
  });
  const denseMode = element.content.densityClass === "dense" || element.h <= 124;
  const textSize = denseMode ? Math.max(14, Math.min(17, Math.round(element.h * 0.18))) : Math.max(15, Math.min(19, Math.round(element.h * 0.2)));
  const emphasisBlock = element.content.emphasis
    ? `<div style="flex:0 1 ${denseMode ? 28 : 32}%;min-width:${denseMode ? 100 : 120}px;max-width:${denseMode ? 32 : 36}%;font-size:${Math.max(textSize, denseMode ? 15 : 16)}px;font-weight:700;line-height:1.25;color:${accentTextColor};text-align:right;white-space:normal;word-break:break-word;overflow-wrap:anywhere;">${formatText(element.content.emphasis)}</div>`
    : "";
  return `<div ${attrs} class="objective-band-block" style="${absoluteBoxStyle(element)};display:flex;align-items:center;gap:18px;padding:0 24px;border-radius:${element.style.borderRadius ?? 22}px;background:${background};border:${element.style.borderWidth ?? 1}px ${element.style.borderStyle ?? "solid"} ${borderColor};color:${graph.slide.theme.titleColor};box-shadow:${shadowForTheme(graph, 1)};overflow:hidden;">
    ${(() => {
      const effectiveIcon = element.content.icon ?? fallbackObjectiveIcon();
      return element.content.label || effectiveIcon ? `<div style="flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:${denseMode ? "8px 12px" : "10px 14px"};border-radius:12px;background:${palette.cssFill};border:1px solid ${resolveReadableBorderColor(palette.cssFill, palette.cssBorder, graph.slide.theme.accentColor)};font-size:${denseMode ? 12 : 13}px;font-weight:700;color:${resolveReadableTextColor(palette.cssFill, palette.cssText, { fallbackDark: graph.slide.theme.accentColor, fallbackLight: "#FFF9F4" })};line-height:1;"><span style="display:inline-flex;width:${denseMode ? 18 : 20}px;height:${denseMode ? 18 : 20}px;color:${resolveReadableTextColor(palette.cssFill, palette.cssText, { fallbackDark: graph.slide.theme.accentColor, fallbackLight: "#FFF9F4" })};">${renderIconSvg(effectiveIcon)}</span>${element.content.label ? formatText(element.content.label) : ""}</div>` : "";
    })()}
    <div style="flex:1 1 auto;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:14px;">
      <div style="flex:1 1 0;min-width:0;font-size:${textSize}px;line-height:1.25;font-weight:600;color:${titleTextColor};white-space:normal;word-break:break-word;overflow-wrap:anywhere;">${formatText(element.content.text)}</div>
      ${emphasisBlock}
    </div>
  </div>`;
}

function renderPageBadge(element: Extract<SceneElement, { type: "pageBadge" }>, graph: SceneGraph): string {
  if (!graph.slide.theme.showPageBadge) {
    return "";
  }
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="pageBadge" data-role="${escapeHtml(element.role)}"`;
  const palette = resolvePrimitiveTonePalette(
    graph.slide.theme,
    element.content.tone === "accent" || element.content.tone === "success" || element.content.tone === "warning" || element.content.tone === "neutral"
      ? element.content.tone
      : "accent",
  );
  const background = element.style.backgroundColor ?? (element.content.tone === "neutral" ? palette.cssFill : graph.slide.theme.accentColor);
  const textColor = element.style.color ?? (element.content.tone === "neutral" ? graph.slide.theme.titleColor : `#${palette.inverseText}`);
  return `<div ${attrs} class="page-badge-block" style="${absoluteBoxStyle(element)};display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:${element.style.borderRadius ?? 16}px;background:${background};border:${element.style.borderWidth ?? 0}px ${element.style.borderStyle ?? "solid"} ${element.style.borderColor ?? palette.cssBorder};box-shadow:${shadowForElevation(element.style.elevation ?? 1)};">
    ${element.content.label ? `<div style="font-size:11px;font-weight:700;line-height:1;color:${textColor};opacity:0.78;margin-bottom:6px;">${formatText(element.content.label)}</div>` : ""}
    <div style="font-size:${Math.max(22, Math.min(34, Math.round(element.h * 0.42)))}px;font-weight:700;line-height:1;color:${textColor};">${formatText(element.content.value)}</div>
  </div>`;
}

function renderBadge(element: Extract<SceneElement, { type: "badge" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="badge" data-role="${escapeHtml(element.role)}"`;
  const tone = badgeToneStyle(graph, element.content.tone);
  const radius = element.style.borderRadius ?? Math.round(Math.min(element.h, 34) / 2);
  const fontSize = element.style.fontSize ?? Math.max(12, Math.min(18, Math.round(element.h * 0.38)));
  const paddingX = element.style.padding ?? Math.max(12, Math.round(element.h * 0.35));
  const background = element.style.backgroundColor ?? tone.background;
  const textColor = resolveReadableTextColor(background, element.style.color ?? tone.color, {
    fallbackDark: graph.slide.theme.titleColor,
    fallbackLight: "#FFF9F4",
  });
  const borderColor = resolveReadableBorderColor(background, element.style.borderColor ?? tone.border, graph.slide.theme.accentColor);
  return `<div ${attrs}${fitAttributes(element, 10)} class="badge-block fit-target" style="${absoluteBoxStyle(element)};display:flex;align-items:center;justify-content:center;background:${background};color:${textColor};border:${element.style.borderWidth ?? 1}px ${element.style.borderStyle ?? "solid"} ${borderColor};border-radius:${radius}px;font-size:${fontSize}px;font-weight:${element.style.fontWeight ?? 600};line-height:1.1;padding:0 ${paddingX}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${formatText(element.content.text)}</div>`;
}

function renderProcess(element: Extract<SceneElement, { type: "process" }>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="process" data-role="${escapeHtml(element.role)}"`;
  const axis = element.content.axis ?? "horizontal";
  const accent = element.style.color ?? graph.slide.theme.accentColor;
  const items = element.content.items;
  const gap = axis === "vertical" ? 14 : 18;
  const innerPadding = element.style.padding ?? 16;
  const trackThickness = 3;
  const trackColor = colorWithAlpha(accent, 0.24);

  const steps = axis === "vertical"
    ? (() => {
        const stepH = Math.max(72, Math.floor((element.h - innerPadding * 2 - gap * (items.length - 1)) / items.length));
        return items.map((item, index) => {
          const y = innerPadding + index * (stepH + gap);
          const badge = item.tag
            ? (() => {
                const tone = badgeToneStyle(graph, "accent");
                return `<div class="process-step-tag" style="background:${tone.background};color:${tone.color};border:1px solid ${tone.border};">${formatText(item.tag)}</div>`;
              })()
            : "";
          return `<div class="process-step process-step--vertical surface-block" style="left:${innerPadding + 28}px;top:${y}px;width:${Math.max(80, element.w - innerPadding * 2 - 28)}px;height:${stepH}px;">
            <div class="process-step-index" style="background:${accent};">${index + 1}</div>
            ${item.meta ? `<div class="process-step-meta" style="color:${accent};">${formatText(item.meta)}</div>` : ""}
            <div class="process-step-title" style="color:${graph.slide.theme.titleColor};">${formatText(item.title)}</div>
            ${badge}
            ${item.body ? `<div class="process-step-body" style="color:${graph.slide.theme.textColor};">${formatText(item.body)}</div>` : ""}
          </div>`;
        }).join("");
      })()
    : (() => {
        const stepW = Math.max(120, Math.floor((element.w - innerPadding * 2 - gap * (items.length - 1)) / items.length));
        return items.map((item, index) => {
          const x = innerPadding + index * (stepW + gap);
          const badge = item.tag
            ? (() => {
                const tone = badgeToneStyle(graph, "accent");
                return `<div class="process-step-tag" style="background:${tone.background};color:${tone.color};border:1px solid ${tone.border};">${formatText(item.tag)}</div>`;
              })()
            : "";
          return `<div class="process-step surface-block" style="left:${x}px;top:${innerPadding + 22}px;width:${stepW}px;height:${Math.max(80, element.h - innerPadding * 2 - 22)}px;">
            <div class="process-step-index" style="background:${accent};">${index + 1}</div>
            ${item.meta ? `<div class="process-step-meta" style="color:${accent};">${formatText(item.meta)}</div>` : ""}
            <div class="process-step-title" style="color:${graph.slide.theme.titleColor};">${formatText(item.title)}</div>
            ${badge}
            ${item.body ? `<div class="process-step-body" style="color:${graph.slide.theme.textColor};">${formatText(item.body)}</div>` : ""}
          </div>`;
        }).join("");
      })();

  const track = axis === "vertical"
    ? `<div class="process-track process-track--vertical" style="left:${innerPadding + 13}px;top:${innerPadding}px;height:${Math.max(40, element.h - innerPadding * 2)}px;background:${trackColor};width:${trackThickness}px;"></div>`
    : `<div class="process-track" style="left:${innerPadding + 16}px;top:${innerPadding + 12}px;width:${Math.max(40, element.w - innerPadding * 2 - 32)}px;height:${trackThickness}px;background:${trackColor};"></div>`;

  return `<div ${attrs} class="process-block process-block--${axis}" style="${absoluteBoxStyle(element)};${toCssStyle(element.style, graph.slide.theme.textColor)}">${track}${steps}</div>`;
}

function renderConnector(element: Extract<SceneElement, { type: "connector" }>, elementsById: Map<string, SceneElement>, graph: SceneGraph): string {
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="connector" data-role="${escapeHtml(element.role)}"`;
  const baseStyle = `${absoluteBoxStyle(element)};${toCssStyle(element.style, graph.slide.theme.textColor)}`;
  const anchor = element.content.anchor ?? "top";
  const targets = element.content.targets
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
    return `<div ${attrs} style="${baseStyle};"></div>`;
  }

  const sameRow = Math.max(...targets.map((target) => target.y)) - Math.min(...targets.map((target) => target.y)) <= 24;
  const routing = element.content.routing === "auto" || element.content.routing === undefined
    ? (sameRow ? "bus" : "chain")
    : element.content.routing;

  let lines = "";
  let dots = "";

  if (routing === "bus") {
    const xs = [...points].map((point) => point.x).sort((a, b) => a - b);
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const busY = anchor === "bottom"
      ? Math.min(element.h - 8, maxY + 12)
      : Math.max(8, minY - 12);

    const stems = points
      .map((point) => `<line x1="${point.x}" y1="${busY}" x2="${point.x}" y2="${point.y}" />`)
      .join("");
    const trunk = `<line x1="${xs[0]}" y1="${busY}" x2="${xs[xs.length - 1]}" y2="${busY}" />`;
    lines = `${trunk}${stems}`;
    dots = element.content.showDots !== false
      ? points.map((point) => `<circle cx="${point.x}" cy="${busY}" r="5" />`).join("")
      : "";
  } else {
    lines = points
      .slice(0, -1)
      .map((point, index) => {
        const next = points[index + 1];
        return `<line x1="${point.x}" y1="${point.y}" x2="${next.x}" y2="${next.y}" />`;
      })
      .join("");
    dots = element.content.showDots !== false
      ? points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="6" />`).join("")
      : "";
  }

  const dash = element.content.lineStyle === "solid" ? "" : ' stroke-dasharray="10 8"';
  const color = element.style.color ?? graph.slide.theme.accentColor;

  return `<div ${attrs} class="connector-block" aria-hidden="true" style="${baseStyle};overflow:visible;"><svg viewBox="0 0 ${element.w} ${element.h}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible"><g fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"${dash}>${lines}</g><g fill="${color}">${dots}</g></svg></div>`;
}

function renderElement(element: SceneElement, graph: SceneGraph, elementsById: Map<string, SceneElement>): string {
  const baseStyle = `${absoluteBoxStyle(element)};${toCssStyle(element.style, graph.slide.theme.textColor)}`;
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="${escapeHtml(element.type)}" data-role="${escapeHtml(element.role)}"`;

  switch (element.type) {
    case "cover":
      return renderCover(element, graph);
    case "toc":
      return renderToc(element, graph);
    case "sectionDivider":
      return renderSectionDivider(element, graph);
    case "summary":
      return renderSummary(element, graph);
    case "frameworkRail":
      return renderFrameworkRail(element, graph);
    case "title": {
      const color = headerBandTextColor(element, graph) ?? element.style.color ?? graph.slide.theme.titleColor;
      return `<div ${attrs}${fitAttributes(element, 18)} class="text-block title-block fit-target" style="${baseStyle};color:${color};display:flex;align-items:flex-start;white-space:normal;word-break:break-word;overflow-wrap:anywhere;">${formatText(element.content.text)}</div>`;
    }
    case "text": {
      const color = headerBandTextColor(element, graph) ?? element.style.color ?? graph.slide.theme.textColor;
      return `<div ${attrs}${fitAttributes(element, 12)} class="text-block prose-block fit-target" style="${baseStyle};color:${color};white-space:normal;word-break:break-word;overflow-wrap:anywhere;">${formatText(element.content.text)}</div>`;
    }
    case "bulletList": {
      const items = element.content.items
        .map((item) => `<li class="bullet-item">${formatText(item)}</li>`)
        .join("");
      return `<div ${attrs}${fitAttributes(element, 12)} class="bullet-list-block fit-target" style="${baseStyle};"><ul class="bullet-list">${items}</ul></div>`;
    }
    case "callout": {
      const calloutTitleSize = Math.min(Math.max((element.style.fontSize ?? 18) + 2, 16), 26);
      const accent = element.style.color ?? graph.slide.theme.accentColor;
      const surface = resolveSurfacePresentation(graph, { ...element.style, backgroundColor: element.style.backgroundColor ?? colorWithAlpha(accent, 0.08) }, colorWithAlpha(accent, 0.08));
      const background = surface.background;
      const border = element.style.borderColor ?? colorWithAlpha(accent, 0.24);
      return [
        `<div ${attrs} class="callout-block surface-block" style="${baseStyle};display:flex;flex-direction:column;gap:8px;background:${background};border:1px solid ${border};border-radius:${element.style.borderRadius ?? 20}px;padding:${element.style.padding ?? 18}px;box-shadow:${surface.shadow};">`,
        `<div ${fitAttributes({ ...element, style: { ...element.style, fontSize: calloutTitleSize } }, 14)} class="callout-title fit-target" style="font-size:${calloutTitleSize}px;font-weight:700;color:${graph.slide.theme.titleColor};line-height:1.25;white-space:normal;word-break:break-word;overflow-wrap:anywhere;">${formatText(element.content.title)}</div>`,
        `<div ${fitAttributes(element, 11)} class="callout-body fit-target" style="white-space:normal;word-break:break-word;overflow-wrap:anywhere;">${formatText(element.content.text)}</div>`,
        `</div>`,
      ].join("");
    }
    case "badge":
      return renderBadge(element, graph);
    case "metric":
      return renderMetric(element, graph);
    case "actionCardGroup":
      return renderActionCardGroup(element, graph);
    case "objectiveBand":
      return renderObjectiveBand(element, graph);
    case "pageBadge":
      return renderPageBadge(element, graph);
    case "timeline":
      return renderTimeline(element, graph);
    case "process":
      return renderProcess(element, graph);
    case "comparison":
      return renderComparison(element, graph);
    case "insight":
      return renderInsight(element, graph);
    case "matrix":
      return renderMatrix(element, graph);
    case "miniDiagram":
      return renderMiniDiagram(element, graph);
    case "summaryBand":
      return renderSummaryBand(element, graph);
    case "funnel":
      return renderFunnel(element, graph);
    case "swimlane":
      return renderSwimlane(element, graph);
    case "chart":
      return renderChart(element, graph);
    case "shape": {
      const surface = resolveSurfacePresentation(graph, element.style, "#FFFFFF");
      const borderWidth = element.style.borderWidth ?? (element.style.borderColor ? 1 : 0);
      const shadow = element.style.fill?.type === "none" ? "none" : surface.shadow;
      return `<div ${attrs} class="shape-block surface-block" aria-hidden="true" style="${baseStyle};background:${surface.background};border:${borderWidth}px ${element.style.borderStyle ?? "solid"} ${surface.borderColor};border-radius:${element.style.borderRadius ?? 0}px;box-shadow:${shadow};"></div>`;
    }
    case "line":
    case "divider":
      return `<div ${attrs} aria-hidden="true" style="${baseStyle};"></div>`;
    case "svg":
      return `<div ${attrs} role="img" aria-label="${escapeHtml(element.content.description)}" class="svg-structure" style="${baseStyle};"><div class="svg-host">${element.content.svg}</div></div>`;
    case "icon":
      return `<div ${attrs} class="icon-block" aria-hidden="true" style="${baseStyle};${iconBadgeStyle(element, graph)}color:${element.style.color ?? graph.slide.theme.accentColor};display:flex;align-items:center;justify-content:center;">${renderIconSvg(element.content.name)}</div>`;
    case "grid":
      return renderGrid(element, graph);
    case "connector":
      return renderConnector(element, elementsById, graph);
    case "section":
    case "cardGroup":
      return "";
    default:
      return "";
  }
}

function fittingScript(): string {
  return `
  <script>
    (() => {
      const targets = Array.from(document.querySelectorAll('[data-fit-text="true"]'));

      const markOverflow = (el) => {
        if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) {
          el.dataset.fitOverflow = 'true';
        }
      };

      targets.forEach((el) => markOverflow(el));
      document.documentElement.classList.add('fit-ready');
    })();
  </script>`;
}

function sceneGraphScript(graph: SceneGraph): string {
  const serialized = JSON.stringify(graph).replaceAll("<", "\\u003c");
  return `\n  <script type="application/json" data-scene-graph>${serialized}</script>`;
}

function renderHeadStyles(fontFamily: string): string {
  return `  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      min-height: 100%;
      background: #d9d4cb;
      font-family: ${fontFamily};
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px;
    }
    .slide-stage {
      width: 1600px;
      height: 900px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.18);
      page-break-after: always;
      break-after: page;
      border-radius: 24px;
    }
    .deck-stage {
      display: flex;
      flex-direction: column;
      gap: 32px;
      align-items: center;
      width: 100%;
    }
    .text-block,
    .callout-title,
    .callout-body,
    .bullet-list-block,
    .grid-cell-text {
      overflow: hidden;
    }
    .title-block {
      letter-spacing: -0.03em;
      font-weight: 700;
      line-height: 1.08;
      text-wrap: balance;
    }
    .prose-block,
    .callout-body,
    .bullet-list-block,
    .grid-cell-text {
      line-height: 1.55;
    }
    .surface-block {}
    .metric-value,
    .metric-label,
    .metric-note {
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .badge-block {
      letter-spacing: 0.01em;
    }
    .chart-title {
      font-size: 18px;
      font-weight: 700;
      line-height: 1.25;
      color: #1f2937;
      white-space: normal;
      word-break: break-word;
      min-width: 0;
      flex: 1 1 auto;
    }
    .chart-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      min-width: 0;
    }
    .chart-meta {
      flex: 0 0 auto;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(201,111,74,0.1);
      border: 1px solid rgba(201,111,74,0.14);
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      color: #9a5335;
      white-space: nowrap;
    }
    .chart-donut-layout {
      display: grid;
      grid-template-columns: minmax(0, 1.08fr) minmax(230px, 0.92fr);
      gap: 18px;
      align-items: center;
      flex: 1 1 auto;
      min-height: 0;
    }
    .chart-visual {
      min-width: 0;
      min-height: 0;
    }
    .chart-visual--donut {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 240px;
      padding: 4px;
    }
    .chart-legend {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }
    .chart-legend-item {
      display: grid;
      grid-template-columns: 14px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
      padding: 8px 0;
      border-bottom: 1px solid rgba(15,23,42,0.06);
    }
    .chart-legend-item:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }
    .chart-legend-swatch {
      width: 14px;
      height: 14px;
      border-radius: 4px;
      margin-top: 3px;
      display: inline-block;
    }
    .chart-legend-copy {
      min-width: 0;
    }
    .chart-legend-label {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.3;
      color: #1f2937;
      white-space: normal;
      word-break: break-word;
    }
    .chart-legend-note {
      margin-top: 4px;
      font-size: 12px;
      line-height: 1.45;
      color: #64748b;
      white-space: normal;
      word-break: break-word;
    }
    .chart-legend-value {
      display: inline-flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 3px;
      font-size: 14px;
      font-weight: 700;
      line-height: 1;
      color: #1f2937;
      white-space: nowrap;
    }
    .chart-legend-value span {
      font-size: 11px;
      font-weight: 700;
      color: #9a5335;
    }
    .chart-rows {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 100%;
    }
    .chart-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 100%;
    }
    .chart-row-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      font-size: 14px;
      font-weight: 600;
      color: #334155;
    }
    .chart-row-label {
      flex: 1 1 auto;
      min-width: 0;
      white-space: normal;
      word-break: break-word;
    }
    .chart-row-value {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 48px;
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(15,23,42,0.04);
      border: 1px solid rgba(15,23,42,0.08);
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
    }
    .chart-row-track {
      width: 100%;
      height: 16px;
      border-radius: 999px;
      background: #EEE7DE;
      overflow: hidden;
    }
    .chart-row-fill {
      height: 100%;
      border-radius: 999px;
      min-width: 14px;
      box-shadow: inset 0 -1px 0 rgba(255,255,255,0.22);
    }
    .chart-row-note {
      font-size: 12px;
      line-height: 1.4;
      color: #64748b;
      white-space: normal;
      word-break: break-word;
    }
    .chart-block--bar .chart-rows,
    .chart-block--progress .chart-rows {
      gap: 14px;
    }
    .bullet-list {
      margin: 0;
      padding-left: 1.2em;
    }
    .bullet-item {
      margin: 0 0 var(--bullet-gap, 10px) 0;
    }
    .icon-block svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .svg-host,
    .svg-host > svg,
    .chart-host,
    .chart-host > svg,
    .connector-block svg {
      width: 100%;
      height: 100%;
    }
    .svg-host > svg,
    .chart-host > svg,
    .connector-block svg {
      display: block;
    }
    .svg-structure,
    .connector-block {
      pointer-events: none;
    }
    .grid-block {
      display: grid;
      grid-template-columns: var(--grid-columns);
      grid-auto-rows: 1fr;
      border: 1px solid var(--grid-border-color, #d9d5cf);
      border-radius: 18px;
      background: #ffffff;
      overflow: hidden;
      box-shadow: 0 16px 34px rgba(15, 23, 42, 0.08), 0 2px 6px rgba(15, 23, 42, 0.04);
    }
    .grid-cell {
      border-right: 1px solid #e7e3dd;
      border-bottom: 1px solid #edeae5;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      min-width: 0;
    }
    .grid-cell--header {
      background: #334155;
      color: #ffffff;
      font-weight: 700;
      border-bottom: none;
    }
    .grid-cell--header-first {
      border-top-left-radius: 18px;
    }
    .grid-cell--header-last {
      border-top-right-radius: 18px;
      border-right: none;
    }
    .grid-cell--first-col .grid-cell-text {
      font-weight: 700;
      color: #334155;
    }
    .grid-cell--last-col {
      border-right: none;
    }
    .grid-cell--last-row {
      border-bottom: none;
    }
    .grid-cell-text {
      white-space: normal;
      word-break: break-word;
      width: 100%;
    }
    .grid-cell-text--strong {
      font-weight: 700;
    }
    .title-block,
    [data-role="section-heading"] {
      text-wrap: balance;
    }
    .timeline-block {
      position: absolute;
    }
    .timeline-axis {
      position: absolute;
      width: 2px;
      border-radius: 999px;
    }
    .timeline-dot {
      position: absolute;
      width: 16px;
      height: 16px;
      border-radius: 999px;
    }
    .timeline-meta,
    .timeline-title,
    .timeline-body {
      position: absolute;
      right: 16px;
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .timeline-meta {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.2;
    }
    .timeline-title {
      font-size: 22px;
      font-weight: 700;
      line-height: 1.2;
    }
    .timeline-body {
      font-size: 15px;
      line-height: 1.55;
    }
    .process-block,
    .process-step,
    .process-track,
    .process-step-index {
      position: absolute;
    }
    .process-step {
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.06);
      border-radius: 18px;
      box-shadow: 0 14px 28px rgba(15, 23, 42, 0.06), 0 2px 6px rgba(15, 23, 42, 0.04);
      padding: 18px 16px 16px 16px;
      overflow: hidden;
    }
    .process-step-index {
      left: 14px;
      top: 14px;
      min-width: 28px;
      height: 28px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      font-size: 14px;
      font-weight: 700;
    }
    .process-step-meta,
    .process-step-title,
    .process-step-body {
      position: relative;
      display: block;
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
      z-index: 1;
    }
    .process-step-meta {
      margin-left: 42px;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.25;
    }
    .process-step-title {
      margin-top: 10px;
      font-size: 18px;
      font-weight: 700;
      line-height: 1.25;
    }
    .process-step-tag {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-top: 10px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
    }
    .process-step-body {
      margin-top: 10px;
      font-size: 14px;
      line-height: 1.5;
    }
    .comparison-block {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .comparison-grid {
      display: grid;
      gap: 14px;
      width: 100%;
      height: 100%;
    }
    .comparison-grid--split {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .comparison-grid--stack {
      grid-template-columns: 1fr;
      grid-auto-rows: 1fr;
    }
    .comparison-side {
      border-radius: 18px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
    }
    .comparison-side-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      align-self: flex-start;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      color: #c96f4a;
      background: rgba(201,111,74,0.12);
      border: 1px solid rgba(201,111,74,0.18);
    }
    .comparison-side-title {
      font-size: 22px;
      font-weight: 700;
      line-height: 1.25;
      color: #1f2937;
      white-space: normal;
      word-break: break-word;
    }
    .comparison-side-body,
    .comparison-side-bullets {
      font-size: 15px;
      line-height: 1.55;
      color: #374151;
      white-space: normal;
      word-break: break-word;
    }
    .comparison-side-bullets {
      margin: 0;
      padding-left: 1.2em;
    }
    .comparison-conclusion {
      font-size: 14px;
      line-height: 1.5;
      color: #334155;
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(201,111,74,0.08);
      border: 1px solid rgba(201,111,74,0.14);
    }
    .insight-block {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .insight-kicker {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.2;
      letter-spacing: 0.01em;
    }
    .insight-quote {
      font-size: 28px;
      font-weight: 700;
      line-height: 1.28;
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .insight-quote-mark {
      font-size: 1.2em;
      vertical-align: -0.05em;
      margin-right: 4px;
      color: rgba(201,111,74,0.78);
    }
    .insight-emphasis {
      font-size: 18px;
      font-weight: 700;
      line-height: 1.35;
    }
    .insight-attribution {
      font-size: 14px;
      line-height: 1.45;
    }
    .summary-band-block {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .summary-band-title {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.2;
    }
    .summary-band-items {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .summary-band-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 6px 12px;
      border-radius: 999px;
      background: rgba(255,255,255,0.86);
      border: 1px solid rgba(15,23,42,0.08);
      font-size: 13px;
      font-weight: 600;
      line-height: 1.1;
      color: #334155;
    }
    .summary-band-emphasis {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.4;
      color: #1f2937;
    }
    .funnel-block {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .funnel-title {
      font-size: 18px;
      font-weight: 700;
      line-height: 1.25;
      color: #1f2937;
    }
    .funnel-stages {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      width: 100%;
      height: 100%;
    }
    .funnel-stage {
      border-radius: 18px;
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }
    .funnel-stage-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .funnel-stage-title,
    .funnel-stage-value {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.2;
      color: #1f2937;
    }
    .funnel-stage-body,
    .funnel-stage-note {
      font-size: 13px;
      line-height: 1.4;
      color: #374151;
      white-space: normal;
      word-break: break-word;
    }
    .swimlane-block {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .swimlane-title {
      font-size: 18px;
      font-weight: 700;
      line-height: 1.25;
      color: #1f2937;
    }
    .swimlane-rows {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 100%;
      height: 100%;
    }
    .swimlane-row {
      display: grid;
      grid-template-columns: 160px minmax(0, 1fr);
      gap: 12px;
      min-height: 0;
    }
    .swimlane-label {
      border-radius: 16px;
      padding: 14px;
      background: #f6f3ee;
      border: 1px solid rgba(15,23,42,0.06);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .swimlane-label-title {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.2;
      color: #1f2937;
    }
    .swimlane-label-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      align-self: flex-start;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
    }
    .swimlane-steps {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
      gap: 10px;
      align-items: stretch;
    }
    .swimlane-step {
      border-radius: 16px;
      padding: 14px;
      background: #ffffff;
      border: 1px solid rgba(15,23,42,0.06);
      box-shadow: 0 8px 18px rgba(15,23,42,0.05);
      font-size: 13px;
      font-weight: 600;
      line-height: 1.35;
      color: #334155;
      white-space: normal;
      word-break: break-word;
    }
    .matrix-block {
      position: relative;
    }
    .matrix-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-rows: repeat(2, minmax(0, 1fr));
      gap: 12px;
      width: 100%;
      height: 100%;
    }
    .matrix-axis,
    .matrix-center-label {
      position: absolute;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.2;
      z-index: 1;
      background: rgba(247,244,238,0.92);
      padding: 4px 8px;
      border-radius: 999px;
    }
    .matrix-axis--x {
      right: 18px;
      bottom: 18px;
    }
    .matrix-axis--y {
      left: 18px;
      top: 18px;
      writing-mode: vertical-rl;
      text-orientation: mixed;
    }
    .matrix-center-label {
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
    }
    .matrix-cell {
      border: 1px solid rgba(15,23,42,0.06);
      border-radius: 18px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
      min-height: 0;
    }
    .matrix-cell-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      align-self: flex-start;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
    }
    .matrix-cell-title {
      font-size: 20px;
      font-weight: 700;
      line-height: 1.25;
      color: #1f2937;
      white-space: normal;
      word-break: break-word;
    }
    .matrix-cell-body {
      font-size: 14px;
      line-height: 1.5;
      color: #374151;
      white-space: normal;
      word-break: break-word;
    }
    .mini-diagram-block {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .mini-diagram-title {
      font-size: 18px;
      font-weight: 700;
      line-height: 1.25;
      color: #1f2937;
    }
    .mini-diagram {
      width: 100%;
      height: 100%;
    }
    .mini-diagram--sequence,
    .mini-diagram--layers {
      display: grid;
      gap: 14px;
    }
    .mini-diagram--sequence {
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      align-items: stretch;
    }
    .mini-diagram--layers {
      grid-template-columns: 1fr;
      grid-auto-rows: 1fr;
    }
    .mini-diagram--hub {
      display: grid;
      grid-template-columns: 1.1fr 1fr;
      gap: 16px;
      align-items: center;
      height: 100%;
    }
    .mini-diagram-spokes {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }
    .mini-diagram-node {
      border: 1px solid rgba(15,23,42,0.06);
      border-radius: 18px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
    }
    .mini-diagram-node-icon {
      width: 28px;
      height: 28px;
    }
    .mini-diagram-node-icon svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .mini-diagram-node-title {
      font-size: 18px;
      font-weight: 700;
      line-height: 1.25;
      color: #1f2937;
      white-space: normal;
      word-break: break-word;
    }
    .mini-diagram-node-body {
      font-size: 13px;
      line-height: 1.45;
      color: #374151;
      white-space: normal;
      word-break: break-word;
    }
    @media print {
      body {
        padding: 0;
        background: #ffffff;
      }
      .deck-stage {
        gap: 0;
      }
      .slide-stage {
        box-shadow: none;
      }
    }
  </style>`;
}

function renderHtmlDocument(title: string, fontFamily: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
${renderHeadStyles(fontFamily)}
</head>
<body>
${body}
${fittingScript()}
</body>
</html>`;
}

export function renderSceneGraphStage(graph: SceneGraph): string {
  const elementsById = new Map(graph.slide.elements.map((element) => [element.id, element]));
  const pageElements = [...graph.slide.elements]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((element) => renderElement(element, graph, elementsById))
    .join("\n");
  const tokens = resolveThemeTokens(graph.slide.theme);
  const pageChrome = renderPageChrome(graph);

  return `  <main class="slide-stage" data-slide-id="${escapeHtml(graph.slide.id)}" data-scene-graph-version="${escapeHtml(graph.version)}" style="width:${graph.slide.width}px;height:${graph.slide.height}px;background:${tokens.background};">
${pageChrome}
${pageElements}
  </main>
${sceneGraphScript(graph)}`;
}

export function renderSceneGraphToHtml(graph: SceneGraph): string {
  const fontFamily = `${graph.slide.theme.fontFamily}, 'PingFang SC', 'Microsoft YaHei', sans-serif`;
  return renderHtmlDocument(graph.slide.id, fontFamily, renderSceneGraphStage(graph));
}

export function renderSceneGraphsToHtml(graphs: SceneGraph[], title = "slides-deck"): string {
  if (graphs.length === 0) {
    throw new Error("At least one slide is required to render deck HTML.");
  }

  const fontFamily = `${graphs[0].slide.theme.fontFamily}, 'PingFang SC', 'Microsoft YaHei', sans-serif`;
  const stages = graphs.map((graph) => renderSceneGraphStage(graph)).join("\n");
  return renderHtmlDocument(title, fontFamily, `  <section class="deck-stage">\n${stages}\n  </section>`);
}
