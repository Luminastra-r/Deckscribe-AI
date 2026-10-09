export const SUPPORTED_VERSIONS = ["scene-graph/v0", "scene-graph/v1"] as const;
export const LEGACY_SLIDE_WIDTH = 1600;
export const LEGACY_SLIDE_HEIGHT = 900;
export const DIRECT_SLIDE_WIDTH = 1280;
export const DIRECT_SLIDE_HEIGHT = 720;
export const SLIDE_WIDTH = DIRECT_SLIDE_WIDTH;
export const SLIDE_HEIGHT = DIRECT_SLIDE_HEIGHT;
export const DEFAULT_CANVAS_PRESET = "pptx_16_9_1280x720" as const;
export const LEGACY_CANVAS_PRESET = "legacy_1600x900" as const;
export const PPTX_WIDTH_IN = 13.333;
export const PPTX_HEIGHT_IN = 7.5;
export const DEFAULT_WARM_ORANGE = {
  primary: "#FF4E26",
  coral: "#F86B42",
  lightCoral: "#F27D6C",
  gradientFrom: "#FF4E26",
  gradientTo: "#F58472",
  textMain: "#172033",
  textSecondary: "#5B6472",
  surfaceWarm: "#FFF4ED",
  surfaceSoft: "#FFF7F2",
  border: "#E5E7EB",
} as const;

export type CanvasPreset = "legacy_1600x900" | "pptx_16_9_1280x720";

export function canvasDimensionsForPreset(preset: CanvasPreset): { width: number; height: number } {
  return preset === "pptx_16_9_1280x720"
    ? { width: DIRECT_SLIDE_WIDTH, height: DIRECT_SLIDE_HEIGHT }
    : { width: LEGACY_SLIDE_WIDTH, height: LEGACY_SLIDE_HEIGHT };
}

export function isSupportedCanvasSize(width: number, height: number): boolean {
  return (
    (width === LEGACY_SLIDE_WIDTH && height === LEGACY_SLIDE_HEIGHT) ||
    (width === DIRECT_SLIDE_WIDTH && height === DIRECT_SLIDE_HEIGHT)
  );
}

export function pxToPptxInches(value: number, canvasHeight = DIRECT_SLIDE_HEIGHT): number {
  return Number((value * (PPTX_HEIGHT_IN / canvasHeight)).toFixed(4));
}

export function pxToPptxPoints(value: number, canvasHeight = DIRECT_SLIDE_HEIGHT): number {
  return Number((value * (PPTX_HEIGHT_IN / canvasHeight) * 72).toFixed(2));
}

export const SUPPORTED_ELEMENT_TYPES = [
  "cover",
  "toc",
  "sectionDivider",
  "summary",
  "frameworkRail",
  "title",
  "text",
  "bulletList",
  "callout",
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
  "shape",
  "line",
  "divider",
  "svg",
  "icon",
  "grid",
  "connector",
  "section",
  "cardGroup",
] as const;

export const SUPPORTED_ICON_NAMES = [
  "target",
  "warning",
  "check",
  "chart",
  "arrows",
  "layers",
  "people",
  "gear",
  "flow",
  "service",
  "hotline",
  "briefcase",
  "clock",
  "building",
  "globe",
  "dashboard",
  "lightbulb",
  "spark",
  "trend",
  "shield",
  "banknote",
  "wallet",
  "creditCard",
  "coins",
  "piggyBank",
  "receipt",
  "landmark",
  "scale",
  "lock",
  "fileCheck",
  "clipboardCheck",
  "stamp",
  "badgeCheck",
  "database",
  "server",
  "cloud",
  "network",
  "cpu",
  "bot",
  "scan",
  "route",
  "gitBranch",
  "link",
  "refresh",
  "userCheck",
  "handshake",
  "hospital",
  "heartPulse",
] as const;

export type ElementType = (typeof SUPPORTED_ELEMENT_TYPES)[number];
export type IconName = (typeof SUPPORTED_ICON_NAMES)[number];

export type Background = {
  type: "solid";
  color: string;
};

export type VisualProfile = "sunriseChrome" | "consultingBlue" | "govBankWarmOrange";
export type LayoutMode = "directSceneGraph" | "freeformEditable";

export type Theme = {
  preset?: "legacyWarm" | VisualProfile;
  fontFamily: string;
  titleColor: string;
  textColor: string;
  mutedTextColor?: string;
  accentColor: string;
  accentDarkColor?: string;
  accentStrongColor?: string;
  accentSoftColor?: string;
  accentLightColor?: string;
  secondaryAccentColor?: string;
  secondarySoftColor?: string;
  goldAccentColor?: string;
  goldSoftColor?: string;
  neutralAccentColor?: string;
  chromeLineColor?: string;
  surfaceShadowColor?: string;
  showPageBadge?: boolean;
};

export type ElementStyle = {
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  color?: string;
  backgroundColor?: string;
  surfaceTone?: "default" | "muted" | "accent" | "softAccent";
  elevation?: 0 | 1 | 2 | 3;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed";
  borderRadius?: number;
  padding?: number;
  textAlign?: "left" | "center" | "right";
  opacity?: number;
  fill?: {
    type: "none" | "solid" | "linearGradient";
    color?: string;
    from?: string;
    to?: string;
    angle?: 0 | 45 | 90 | number;
  };
};

export type CoverContent = {
  title: string;
  subtitle?: string;
  meta?: string;
  layout?: "centered" | "asymmetric";
};

export type TocItem = {
  number?: string;
  title: string;
  description?: string;
};

export type TocContent = {
  title?: string;
  items: TocItem[];
  layout?: "vertical" | "grid" | "sidebar";
};

export type SectionDividerContent = {
  number?: string;
  title: string;
  intro?: string;
  layout?: "boldCenter" | "accentBlock" | "splitBackground";
};

export type SummaryContent = {
  title: string;
  takeaways?: string[];
  callToAction?: string;
  contact?: string;
  layout?: "takeaways" | "cta" | "thankYou";
};

export type FrameworkRailContent = {
  label?: string;
  icon?: IconName;
  title: string;
  summary?: string;
  bullets?: string[];
  footerTitle?: string;
  footerItems?: string[];
  layout?: "left" | "top";
  densityClass?: "dense" | "balanced" | "airy";
  tone?: "default" | "accent" | "success" | "warning" | "neutral";
};

export type TitleContent = {
  text: string;
};

export type TextContent = {
  text: string;
};

export type BulletListContent = {
  items: string[];
};

export type CalloutContent = {
  title: string;
  text: string;
};

export type BadgeContent = {
  text: string;
  tone?: "default" | "accent" | "success" | "warning" | "neutral";
};

export type MetricContent = {
  value: string;
  label: string;
  note?: string;
};

export type ActionCardItem = {
  step?: string;
  eyebrow?: string;
  icon?: IconName;
  title: string;
  body: string;
  emphasis?: string;
  weight?: "lead" | "regular" | "compact";
  tone?: "default" | "accent" | "success" | "warning" | "neutral";
};

export type ActionCardGroupContent = {
  title?: string;
  visualAid?: "icon" | "badge" | "divider" | "accentStrip";
  layout?: "auto" | "lead-grid" | "grid";
  iconPlacement?: "inline" | "stacked" | "none";
  densityClass?: "dense" | "balanced" | "airy";
  columns?: number;
  items: ActionCardItem[];
};

export type ObjectiveBandContent = {
  label?: string;
  icon?: IconName;
  text: string;
  emphasis?: string;
  densityClass?: "dense" | "balanced" | "airy";
  tone?: "default" | "accent" | "success" | "warning" | "neutral";
};

export type PageBadgeContent = {
  value: string;
  label?: string;
  position?: "topRight" | "bottomRight" | "bottomLeft";
  tone?: "default" | "accent" | "success" | "warning" | "neutral";
};

export type TimelineItem = {
  title: string;
  body?: string;
  meta?: string;
};

export type TimelineContent = {
  axis?: "vertical";
  items: TimelineItem[];
};

export type ProcessStep = {
  title: string;
  body?: string;
  meta?: string;
  tag?: string;
};

export type ProcessContent = {
  axis?: "horizontal" | "vertical";
  items: ProcessStep[];
};

export type ChartSegment = {
  label: string;
  value: number;
  color?: string;
  note?: string;
};

export type ChartContent = {
  chartType: "donut" | "bar" | "progress";
  title?: string;
  centerText?: string;
  showLegend?: boolean;
  maxValue?: number;
  segments: ChartSegment[];
};

export type ComparisonSide = {
  title: string;
  body?: string;
  bullets?: string[];
  badge?: string;
};

export type ComparisonContent = {
  layout?: "split" | "stack";
  left: ComparisonSide;
  right: ComparisonSide;
  conclusion?: string;
};

export type InsightContent = {
  title: string;
  text: string;
  emphasis?: string;
  attribution?: string;
  tone?: "default" | "accent" | "success" | "warning" | "neutral";
};

export type MatrixQuadrant = {
  position: "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
  title: string;
  body?: string;
  badge?: string;
  tone?: "default" | "accent" | "success" | "warning" | "neutral";
};

export type MatrixContent = {
  xAxisTitle?: string;
  yAxisTitle?: string;
  centerLabel?: string;
  quadrants: MatrixQuadrant[];
};

export type MiniDiagramNode = {
  title: string;
  body?: string;
  icon?: IconName;
  tone?: "default" | "accent" | "success" | "warning" | "neutral";
};

export type MiniDiagramContent = {
  layout: "sequence" | "hub" | "layers";
  title?: string;
  nodes: MiniDiagramNode[];
};

export type SummaryBandContent = {
  title: string;
  items: string[];
  emphasis?: string;
  tone?: "default" | "accent" | "success" | "warning" | "neutral";
};

export type FunnelStage = {
  title: string;
  body?: string;
  value?: string;
  note?: string;
  tone?: "default" | "accent" | "success" | "warning" | "neutral";
};

export type FunnelContent = {
  title?: string;
  stages: FunnelStage[];
};

export type SwimlaneLane = {
  title: string;
  badge?: string;
  steps: string[];
  tone?: "default" | "accent" | "success" | "warning" | "neutral";
};

export type SwimlaneContent = {
  title?: string;
  lanes: SwimlaneLane[];
};

export type ShapeContent = {
  shape: "rect";
};

export type DividerContent = {
  direction: "horizontal" | "vertical";
};

export type SvgContent = {
  svg: string;
  description: string;
};

export type IconContent = {
  name: IconName;
};

export type GridContent = {
  header: string[];
  rows: string[][];
  columnWidths?: number[];
};

export type ConnectorContent = {
  targets: string[];
  lineStyle?: "solid" | "dashed";
  showDots?: boolean;
  routing?: "auto" | "chain" | "bus";
  anchor?: "center" | "top" | "bottom";
};

export type SectionContent = {
  headerIds: string[];
  bodyIds: string[];
  topPadding?: number;
  gap?: number;
  headerGap?: number;
};

export type CardGroupItem = {
  containerId: string;
  iconIds?: string[];
  titleIds?: string[];
  bodyIds?: string[];
};

export type CardGroupContent = {
  items: CardGroupItem[];
  columns?: number;
  gap?: number;
  paddingX?: number;
  paddingY?: number;
};

export type ElementContentMap = {
  cover: CoverContent;
  toc: TocContent;
  sectionDivider: SectionDividerContent;
  summary: SummaryContent;
  frameworkRail: FrameworkRailContent;
  title: TitleContent;
  text: TextContent;
  bulletList: BulletListContent;
  callout: CalloutContent;
  badge: BadgeContent;
  metric: MetricContent;
  actionCardGroup: ActionCardGroupContent;
  objectiveBand: ObjectiveBandContent;
  pageBadge: PageBadgeContent;
  timeline: TimelineContent;
  process: ProcessContent;
  comparison: ComparisonContent;
  insight: InsightContent;
  matrix: MatrixContent;
  miniDiagram: MiniDiagramContent;
  summaryBand: SummaryBandContent;
  funnel: FunnelContent;
  swimlane: SwimlaneContent;
  chart: ChartContent;
  shape: ShapeContent;
  line: DividerContent;
  divider: DividerContent;
  svg: SvgContent;
  icon: IconContent;
  grid: GridContent;
  connector: ConnectorContent;
  section: SectionContent;
  cardGroup: CardGroupContent;
};

type BaseElement<T extends ElementType> = {
  id: string;
  type: T;
  role: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  style: ElementStyle;
  content: ElementContentMap[T];
};

export type SceneElement =
  | BaseElement<"cover">
  | BaseElement<"toc">
  | BaseElement<"sectionDivider">
  | BaseElement<"summary">
  | BaseElement<"frameworkRail">
  | BaseElement<"title">
  | BaseElement<"text">
  | BaseElement<"bulletList">
  | BaseElement<"callout">
  | BaseElement<"badge">
  | BaseElement<"metric">
  | BaseElement<"actionCardGroup">
  | BaseElement<"objectiveBand">
  | BaseElement<"pageBadge">
  | BaseElement<"timeline">
  | BaseElement<"process">
  | BaseElement<"comparison">
  | BaseElement<"insight">
  | BaseElement<"matrix">
  | BaseElement<"miniDiagram">
  | BaseElement<"summaryBand">
  | BaseElement<"funnel">
  | BaseElement<"swimlane">
  | BaseElement<"chart">
  | BaseElement<"shape">
  | BaseElement<"line">
  | BaseElement<"divider">
  | BaseElement<"svg">
  | BaseElement<"icon">
  | BaseElement<"grid">
  | BaseElement<"connector">
  | BaseElement<"section">
  | BaseElement<"cardGroup">;

export type Slide = {
  id: string;
  width: number;
  height: number;
  background: Background;
  theme: Theme;
  elements: SceneElement[];
};

export type SceneGraph = {
  version: (typeof SUPPORTED_VERSIONS)[number];
  slide: Slide;
};
