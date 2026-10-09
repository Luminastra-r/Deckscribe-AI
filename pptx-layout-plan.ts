import { resolveThemeTokens } from "./primitive-theme.ts";
import { type PagePlan } from "./page-plan.ts";
import { type SceneElement, type SceneGraph } from "./types.ts";

export type PptxLayoutElementPlan = {
  elementId: string;
  elementType: SceneElement["type"];
  role: string;
  exportMode: "direct" | "pptx-adapted";
  splitTextBoxes: boolean;
  preserveVisualAid: boolean;
  visualAidMode?: "icon" | "badge" | "divider" | "accentStrip";
  iconPlacement?: "inline" | "stacked" | "none";
};

export type PptxLayoutPlan = {
  version: "pptx-layout-plan/v1";
  pageTitle: string;
  layoutFamily: PagePlan["page"]["layoutFamily"];
  visualRichness: PagePlan["page"]["visualRichness"];
  requiresVisualAid: boolean;
  pptxCriticality: PagePlan["page"]["pptxCriticality"];
  parityRisk: "low" | "medium" | "high";
  htmlSemantics: {
    hasHeaderChrome: boolean;
    footerStyle: "none" | "legacy";
    iconCount: number;
    badgeCount: number;
    primitiveCount: number;
    totalVisualAidSignals: number;
  };
  directives: {
    useContinuousFooter: boolean;
    preserveIcons: boolean;
    preserveBadges: boolean;
    splitDenseText: boolean;
    preferShapeDecorations: boolean;
    rebalanceDenseFramework: boolean;
    headerSafeZone: number;
    visualAidBudget: "minimal" | "standard" | "rich";
    iconPlacementPolicy: "inline-first" | "stacked-ok" | "none";
    denseCardFallback: "remove-icon-first" | "remove-eyebrow-first" | "split-grid";
    rebalanceTopHeavyLayout: boolean;
  };
  elementPlans: PptxLayoutElementPlan[];
};

function countMatching(html: string | undefined, pattern: RegExp): number {
  if (!html) {
    return 0;
  }
  return html.match(pattern)?.length ?? 0;
}

function countVisualAidSignals(graph: SceneGraph, html?: string): number {
  const fromGraph = graph.slide.elements.reduce((sum, element) => {
    switch (element.type) {
      case "icon":
      case "badge":
      case "metric":
      case "chart":
      case "process":
      case "timeline":
      case "comparison":
      case "matrix":
      case "miniDiagram":
      case "funnel":
      case "swimlane":
        return sum + 1;
      case "frameworkRail":
        return sum + (element.content.icon ? 1 : 0) + (element.content.label ? 1 : 0) + ((element.content.footerItems?.length ?? 0) > 0 ? 1 : 0);
      case "actionCardGroup":
        return sum + (element.content.visualAid ? 1 : 0) + element.content.items.reduce(
          (itemSum, item) => itemSum + (item.icon ? 1 : 0) + (item.step ? 1 : 0) + (item.eyebrow ? 1 : 0),
          0,
        );
      case "objectiveBand":
        return sum + (element.content.icon ? 1 : 0) + (element.content.label ? 1 : 0) + (element.content.emphasis ? 1 : 0);
      default:
        return sum;
    }
  }, 0);

  const fromHtml = countMatching(html, /class="icon-block"/g) + countMatching(html, /class="badge-block"/g);
  return fromGraph + fromHtml;
}

function elementNeedsSplitText(element: SceneElement): boolean {
  switch (element.type) {
    case "frameworkRail":
      return Boolean(element.content.summary && element.content.summary.length >= 44)
        || (element.content.bullets?.length ?? 0) >= 4;
    case "actionCardGroup":
      return element.content.items.some((item) => item.body.length >= 46 || Boolean(item.emphasis));
    case "objectiveBand":
      return element.content.text.length >= 48 || Boolean(element.content.emphasis);
    case "text":
      return element.content.text.length >= 80;
    case "bulletList":
      return element.content.items.length >= 5;
    default:
      return false;
  }
}

function inferElementVisualAidMode(element: SceneElement): PptxLayoutElementPlan["visualAidMode"] {
  switch (element.type) {
    case "frameworkRail":
      return element.content.icon ? "icon" : element.content.label ? "divider" : "accentStrip";
    case "actionCardGroup":
      return element.content.visualAid ?? (element.content.items.some((item) => item.icon) ? "icon" : "badge");
    case "objectiveBand":
      return element.content.icon ? "icon" : element.content.label ? "badge" : "accentStrip";
    case "badge":
      return "badge";
    case "icon":
      return "icon";
    default:
      return undefined;
  }
}

function inferElementIconPlacement(element: SceneElement, pagePlan: PagePlan): PptxLayoutElementPlan["iconPlacement"] {
  switch (element.type) {
    case "actionCardGroup":
      return element.content.iconPlacement ?? "inline";
    case "frameworkRail":
      return pagePlan.page.visualAidBudget === "minimal" ? "inline" : undefined;
    case "objectiveBand":
      return "inline";
    default:
      return undefined;
  }
}

export function buildPptxLayoutPlan(graph: SceneGraph, pagePlan: PagePlan, renderedHtml?: string): PptxLayoutPlan {
  const tokens = resolveThemeTokens(graph.slide.theme);
  const iconCount = graph.slide.elements.filter((element) => element.type === "icon").length + countMatching(renderedHtml, /class="icon-block"/g);
  const badgeCount = graph.slide.elements.filter((element) => element.type === "badge").length + countMatching(renderedHtml, /class="badge-block"/g);
  const primitiveCount = graph.slide.elements.filter((element) =>
    element.type === "frameworkRail" ||
    element.type === "actionCardGroup" ||
    element.type === "objectiveBand" ||
    element.type === "process" ||
    element.type === "timeline" ||
    element.type === "comparison" ||
    element.type === "miniDiagram").length;
  const visualAidSignals = countVisualAidSignals(graph, renderedHtml);
  const highRisk = pagePlan.page.requiresVisualAid && visualAidSignals < (pagePlan.page.visualRichness === "high" ? 4 : 2);
  const parityRisk = pagePlan.page.pptxCriticality === "high" && (highRisk || primitiveCount < 2) ? "high"
    : highRisk ? "medium"
      : "low";

  return {
    version: "pptx-layout-plan/v1",
    pageTitle: pagePlan.page.title,
    layoutFamily: pagePlan.page.layoutFamily,
    visualRichness: pagePlan.page.visualRichness,
    requiresVisualAid: pagePlan.page.requiresVisualAid,
    pptxCriticality: pagePlan.page.pptxCriticality,
    parityRisk,
    htmlSemantics: {
      hasHeaderChrome: tokens.preset === "sunriseChrome",
      footerStyle: tokens.preset === "legacyWarm" ? "legacy" : "none",
      iconCount,
      badgeCount,
      primitiveCount,
      totalVisualAidSignals: visualAidSignals,
    },
    directives: {
      useContinuousFooter: false,
      preserveIcons: pagePlan.page.requiresVisualAid,
      preserveBadges: pagePlan.page.visualRichness === "high",
      splitDenseText: true,
      preferShapeDecorations: true,
      rebalanceDenseFramework: pagePlan.page.layoutFamily === "left-rail-plus-action-grid",
      headerSafeZone: pagePlan.page.headerReservePx,
      visualAidBudget: pagePlan.page.visualAidBudget,
      iconPlacementPolicy:
        pagePlan.page.visualAidBudget === "minimal" || pagePlan.page.densityClass === "dense"
          ? "inline-first"
          : pagePlan.page.visualAidBudget === "rich"
            ? "stacked-ok"
            : "inline-first",
      denseCardFallback:
        pagePlan.page.densityClass === "dense"
          ? "remove-icon-first"
          : pagePlan.page.visualAidBudget === "rich"
            ? "split-grid"
            : "remove-eyebrow-first",
      rebalanceTopHeavyLayout: pagePlan.page.maxTopOccupancyRatio <= 0.46,
    },
    elementPlans: graph.slide.elements.map((element) => ({
      elementId: element.id,
      elementType: element.type,
      role: element.role,
      exportMode:
        element.type === "frameworkRail" || element.type === "actionCardGroup" || element.type === "objectiveBand"
          ? "pptx-adapted"
          : "direct",
      splitTextBoxes: elementNeedsSplitText(element),
      preserveVisualAid:
        element.type === "frameworkRail" ||
        element.type === "actionCardGroup" ||
        element.type === "objectiveBand" ||
        element.type === "badge" ||
        element.type === "icon",
      ...(inferElementIconPlacement(element, pagePlan) ? { iconPlacement: inferElementIconPlacement(element, pagePlan) } : {}),
      ...(inferElementVisualAidMode(element) ? { visualAidMode: inferElementVisualAidMode(element) } : {}),
    })),
  };
}

export function buildDirectPptxLayoutPlan(graph: SceneGraph, renderedHtml?: string): PptxLayoutPlan {
  const iconCount = graph.slide.elements.filter((element) => element.type === "icon").length + countMatching(renderedHtml, /class="icon-block"/g);
  const badgeCount = graph.slide.elements.filter((element) => element.type === "badge").length + countMatching(renderedHtml, /class="badge-block"/g);
  const primitiveCount = graph.slide.elements.filter((element) =>
    element.type === "frameworkRail" ||
    element.type === "actionCardGroup" ||
    element.type === "objectiveBand" ||
    element.type === "process" ||
    element.type === "timeline" ||
    element.type === "comparison" ||
    element.type === "miniDiagram").length;
  const visualAidSignals = countVisualAidSignals(graph, renderedHtml);
  const firstTitle = graph.slide.elements.find((element) => element.type === "title") as Extract<SceneElement, { type: "title" }> | undefined;

  return {
    version: "pptx-layout-plan/v1",
    pageTitle: firstTitle?.content.text ?? graph.slide.id,
    layoutFamily: "stacked-sections",
    visualRichness: visualAidSignals >= 4 ? "high" : "normal",
    requiresVisualAid: false,
    pptxCriticality: "normal",
    parityRisk: "low",
    htmlSemantics: {
      hasHeaderChrome: false,
      footerStyle: "none",
      iconCount,
      badgeCount,
      primitiveCount,
      totalVisualAidSignals: visualAidSignals,
    },
    directives: {
      useContinuousFooter: false,
      preserveIcons: true,
      preserveBadges: true,
      splitDenseText: false,
      preferShapeDecorations: false,
      rebalanceDenseFramework: false,
      headerSafeZone: 0,
      visualAidBudget: "standard",
      iconPlacementPolicy: "inline-first",
      denseCardFallback: "remove-eyebrow-first",
      rebalanceTopHeavyLayout: false,
    },
    elementPlans: graph.slide.elements.map((element) => ({
      elementId: element.id,
      elementType: element.type,
      role: element.role,
      exportMode: "direct",
      splitTextBoxes: false,
      preserveVisualAid:
        element.type === "badge" ||
        element.type === "icon" ||
        element.type === "frameworkRail" ||
        element.type === "actionCardGroup" ||
        element.type === "objectiveBand",
      ...(inferElementVisualAidMode(element) ? { visualAidMode: inferElementVisualAidMode(element) } : {}),
    })),
  };
}
