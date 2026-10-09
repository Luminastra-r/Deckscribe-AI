import { computeActionCardGroupLayout } from "./primitive-layout.ts";
import { type PagePlan } from "./page-plan.ts";
import { type SceneElement, type SceneGraph, SLIDE_HEIGHT, SLIDE_WIDTH } from "./types.ts";

type LayoutDensityResult = {
  ok: boolean;
  reason?: string;
};

export type LayoutQualityAssessment = {
  ok: boolean;
  fatalReasons: string[];
  warningReasons: string[];
  reason?: string;
};

const CONTENTFUL_ELEMENT_TYPES = new Set<SceneElement["type"]>([
  "cover",
  "toc",
  "sectionDivider",
  "summary",
  "frameworkRail",
  "title",
  "text",
  "bulletList",
  "callout",
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
]);

function compactLength(value: string | undefined): number {
  return (value ?? "").replace(/\s+/g, "").length;
}

function area(element: SceneElement): number {
  return Math.max(0, element.w) * Math.max(0, element.h);
}

function compactUnits(value: string | undefined): number {
  return (value ?? "").replace(/\s+/g, "").length;
}

function extractElementTextLength(element: SceneElement): number {
  switch (element.type) {
    case "cover":
      return (
        compactLength(element.content.title) +
        compactLength(element.content.subtitle) +
        compactLength(element.content.meta)
      );
    case "toc":
      return (
        compactLength(element.content.title) +
        element.content.items.reduce(
          (sum, item) => sum + compactLength(item.number) + compactLength(item.title) + compactLength(item.description),
          0,
        )
      );
    case "sectionDivider":
      return (
        compactLength(element.content.number) +
        compactLength(element.content.title) +
        compactLength(element.content.intro)
      );
    case "summary":
      return (
        compactLength(element.content.title) +
        (element.content.takeaways?.reduce((sum, item) => sum + compactLength(item), 0) ?? 0) +
        compactLength(element.content.callToAction) +
        compactLength(element.content.contact)
      );
    case "frameworkRail":
      return (
        compactLength(element.content.label) +
        compactLength(element.content.title) +
        compactLength(element.content.summary) +
        (element.content.bullets?.reduce((sum, item) => sum + compactLength(item), 0) ?? 0) +
        compactLength(element.content.footerTitle) +
        (element.content.footerItems?.reduce((sum, item) => sum + compactLength(item), 0) ?? 0)
      );
    case "title":
    case "text":
      return compactLength(element.content.text);
    case "bulletList":
      return element.content.items.reduce((sum, item) => sum + compactLength(item), 0);
    case "callout":
      return compactLength(element.content.title) + compactLength(element.content.text);
    case "metric":
      return (
        compactLength(element.content.value) +
        compactLength(element.content.label) +
        compactLength(element.content.note)
      );
    case "actionCardGroup":
      return (
        compactLength(element.content.title) +
        element.content.items.reduce(
          (sum, item) =>
            sum +
            compactLength(item.step) +
            compactLength(item.eyebrow) +
            compactLength(item.title) +
            compactLength(item.body) +
            compactLength(item.emphasis),
          0,
        )
      );
    case "objectiveBand":
      return compactLength(element.content.label) + compactLength(element.content.text) + compactLength(element.content.emphasis);
    case "pageBadge":
      return compactLength(element.content.label) + compactLength(element.content.value);
    case "timeline":
      return element.content.items.reduce(
        (sum, item) => sum + compactLength(item.title) + compactLength(item.meta) + compactLength(item.body),
        compactLength(element.content.axis),
      );
    case "process":
      return element.content.items.reduce(
        (sum, item) =>
          sum +
          compactLength(item.title) +
          compactLength(item.meta) +
          compactLength(item.tag) +
          compactLength(item.body),
        compactLength(element.content.axis),
      );
    case "comparison":
      return (
        compactLength(element.content.left.title) +
        compactLength(element.content.left.badge) +
        compactLength(element.content.left.body) +
        (element.content.left.bullets?.reduce((sum, item) => sum + compactLength(item), 0) ?? 0) +
        compactLength(element.content.right.title) +
        compactLength(element.content.right.badge) +
        compactLength(element.content.right.body) +
        (element.content.right.bullets?.reduce((sum, item) => sum + compactLength(item), 0) ?? 0) +
        compactLength(element.content.conclusion)
      );
    case "insight":
      return (
        compactLength(element.content.title) +
        compactLength(element.content.text) +
        compactLength(element.content.emphasis) +
        compactLength(element.content.attribution)
      );
    case "matrix":
      return (
        compactLength(element.content.xAxisTitle) +
        compactLength(element.content.yAxisTitle) +
        compactLength(element.content.centerLabel) +
        element.content.quadrants.reduce(
          (sum, quadrant) =>
            sum + compactLength(quadrant.title) + compactLength(quadrant.badge) + compactLength(quadrant.body),
          0,
        )
      );
    case "miniDiagram":
      return (
        compactLength(element.content.title) +
        element.content.nodes.reduce(
          (sum, node) => sum + compactLength(node.title) + compactLength(node.body),
          0,
        )
      );
    case "summaryBand":
      return (
        compactLength(element.content.title) +
        compactLength(element.content.emphasis) +
        element.content.items.reduce((sum, item) => sum + compactLength(item), 0)
      );
    case "funnel":
      return (
        compactLength(element.content.title) +
        element.content.stages.reduce(
          (sum, stage) =>
            sum +
            compactLength(stage.title) +
            compactLength(stage.value) +
            compactLength(stage.body) +
            compactLength(stage.note),
          0,
        )
      );
    case "swimlane":
      return (
        compactLength(element.content.title) +
        element.content.lanes.reduce(
          (sum, lane) =>
            sum +
            compactLength(lane.title) +
            compactLength(lane.badge) +
            lane.steps.reduce((stepSum, step) => stepSum + compactLength(step), 0),
          0,
        )
      );
    case "chart":
      return (
        compactLength(element.content.title) +
        compactLength(element.content.centerText) +
        element.content.segments.reduce(
          (sum, segment) => sum + compactLength(segment.label) + compactLength(segment.note),
          0,
        )
      );
    case "grid":
      return (
        element.content.header.reduce((sum, item) => sum + compactLength(item), 0) +
        element.content.rows.reduce(
          (rowSum, row) => rowSum + row.reduce((cellSum, cell) => cellSum + compactLength(cell), 0),
          0,
        )
      );
    default:
      return 0;
  }
}

function isContentful(element: SceneElement): boolean {
  return CONTENTFUL_ELEMENT_TYPES.has(element.type);
}

function countContentBlocks(elements: SceneElement[]): number {
  return elements.filter((element) => isContentful(element) && extractElementTextLength(element) > 0).length;
}

function countSparseLargeBlocks(elements: SceneElement[]): number {
  return elements.filter((element) => {
    if (!isContentful(element)) {
      return false;
    }

    if (element.type === "chart" || element.type === "metric") {
      return false;
    }

    return area(element) >= 95_000 && extractElementTextLength(element) <= 70;
  }).length;
}

function occupiedAreaRatio(elements: SceneElement[]): number {
  const totalArea = SLIDE_WIDTH * SLIDE_HEIGHT;
  const occupied = elements.reduce((sum, element) => {
    if (!isContentful(element)) {
      return sum;
    }

    return sum + Math.min(area(element), totalArea * 0.35);
  }, 0);

  return occupied / totalArea;
}

function nearlyEqual(a: number, b: number, tolerance = 18): boolean {
  return Math.abs(a - b) <= tolerance;
}

function contentfulElements(graph: SceneGraph): SceneElement[] {
  return graph.slide.elements.filter((element) => isContentful(element) && extractElementTextLength(element) > 0);
}

function containerShapes(graph: SceneGraph): Extract<SceneElement, { type: "shape" }>[] {
  return graph.slide.elements.filter(
    (element): element is Extract<SceneElement, { type: "shape" }> =>
      element.type === "shape" && (element.role === "container" || element.role === "background"),
  );
}

function hasMechanicalEqualCardGrid(graph: SceneGraph): boolean {
  const containers = containerShapes(graph).filter((element) => element.role === "container");
  if (containers.length < 4) {
    return false;
  }

  const [first, ...rest] = containers;
  const similar = rest.filter((element) => nearlyEqual(element.w, first.w) && nearlyEqual(element.h, first.h));
  return similar.length >= Math.ceil(containers.length * 0.75) - 1;
}

function hasDominantTopRegion(graph: SceneGraph): boolean {
  const topElements = contentfulElements(graph).filter((element) => element.y <= 260);
  if (topElements.some((element) => element.w >= 900 && element.h >= 60)) {
    return true;
  }

  const occupiedTopArea = topElements.reduce((sum, element) => sum + area(element), 0);
  return topElements.length >= 2 && occupiedTopArea >= 120_000;
}

function hasLeftRail(graph: SceneGraph): boolean {
  return contentfulElements(graph).some(
    (element) => element.x <= 360 && element.w <= 440 && element.h >= 160,
  );
}

function hasBottomSummary(graph: SceneGraph): boolean {
  return graph.slide.elements.some((element) => {
    if (!isContentful(element) && element.type !== "shape") {
      return false;
    }

    return element.y + element.h >= 720 && element.w >= 420;
  });
}

function countVisualAidSignals(graph: SceneGraph): number {
  return graph.slide.elements.reduce((sum, element) => {
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
        return sum
          + (element.content.icon ? 1 : 0)
          + (element.content.label ? 1 : 0)
          + ((element.content.footerItems?.length ?? 0) > 0 ? 1 : 0);
      case "actionCardGroup":
        return sum
          + (element.content.title ? 1 : 0)
          + (element.content.visualAid || element.content.items.some((item) => item.icon) ? 1 : 0)
          + (element.content.items.some((item) => item.step || item.eyebrow) ? 1 : 0);
      case "objectiveBand":
        return sum + (element.content.label ? 1 : 0) + (element.content.icon ? 1 : 0) + (element.content.emphasis ? 1 : 0);
      default:
        return sum;
    }
  }, 0);
}

function protectedHeaderIntrusions(graph: SceneGraph, headerReservePx: number): number {
  return graph.slide.elements.filter((element) => {
    if (element.y >= headerReservePx) {
      return false;
    }
    if (element.type === "title") {
      return false;
    }
    if (
      element.type === "text" &&
      (element.role === "context" || element.role === "subtitle" || element.role === "intro" || element.role === "header")
    ) {
      return false;
    }
    return isContentful(element) || element.type === "shape" || element.type === "badge" || element.type === "icon";
  }).length;
}

function topHalfOccupancy(graph: SceneGraph, cutoffY: number): number {
  const occupied = contentfulElements(graph)
    .filter((element) => element.y < cutoffY)
    .reduce((sum, element) => {
      const visibleHeight = Math.max(0, Math.min(element.y + element.h, cutoffY) - element.y);
      return sum + element.w * visibleHeight;
    }, 0);
  return occupied / (SLIDE_WIDTH * cutoffY);
}

function bottomHalfOccupancy(graph: SceneGraph, startY: number): number {
  const occupied = contentfulElements(graph)
    .filter((element) => element.y + element.h > startY)
    .reduce((sum, element) => {
      const visibleHeight = Math.max(0, element.y + element.h - Math.max(element.y, startY));
      return sum + element.w * visibleHeight;
    }, 0);
  return occupied / (SLIDE_WIDTH * Math.max(1, SLIDE_HEIGHT - startY));
}

function detectActionCardCompression(
  pagePlan: PagePlan,
  graph: SceneGraph,
): { starvedCards: number; stackedPenalty: number; titleBreakRisk: number } {
  let starvedCards = 0;
  let stackedPenalty = 0;
  let titleBreakRisk = 0;

  for (const element of graph.slide.elements) {
    if (element.type !== "actionCardGroup") {
      continue;
    }

    const layout = computeActionCardGroupLayout(element.content, { w: element.w, h: element.h });
    for (const slot of layout.slots) {
      const item = element.content.items[slot.itemIndex];
      const textUnits = compactUnits(item.title) + compactUnits(item.body) * 0.75 + compactUnits(item.emphasis) * 0.45;
      const availableArea = slot.w * slot.h;
      const minTextArea = Math.max(0.45, pagePlan.page.regionMinTextAreaRatio - 0.04);
      const denseSmallCard = slot.w < 320 || slot.h < 170;
      const visualAidMode = element.content.iconPlacement ?? "inline";

      if (denseSmallCard && visualAidMode === "stacked" && (item.icon || element.content.visualAid === "icon")) {
        stackedPenalty += 1;
      }

      const estimatedNeed = 1800 + textUnits * 115;
      if (availableArea < estimatedNeed || (denseSmallCard && textUnits >= 78)) {
        starvedCards += 1;
      }

      const reservedDecorHeight =
        visualAidMode === "stacked" && (item.icon || element.content.visualAid === "icon")
          ? 36
          : element.content.visualAid === "accentStrip" || element.content.visualAid === "divider"
            ? 16
            : 0;
      const textAreaRatio = (slot.w * Math.max(0, slot.h - reservedDecorHeight - 18)) / Math.max(1, availableArea);
      if (textAreaRatio < minTextArea) {
        starvedCards += 1;
      }

      if ((denseSmallCard && compactUnits(item.title) >= 18) || compactUnits(item.title) >= Math.max(20, Math.floor(slot.w / 11))) {
        titleBreakRisk += 1;
      }
    }
  }

  return { starvedCards, stackedPenalty, titleBreakRisk };
}

function detectFrameworkRailMismatch(graph: SceneGraph): number {
  return graph.slide.elements.reduce((sum, element) => {
    if (element.type !== "frameworkRail") {
      return sum;
    }
    const contentWeight =
      compactUnits(element.content.title) +
      compactUnits(element.content.summary) +
      (element.content.bullets?.reduce((inner, item) => inner + compactUnits(item), 0) ?? 0) * 0.85 +
      (element.content.footerItems?.reduce((inner, item) => inner + compactUnits(item), 0) ?? 0) * 0.45;
    const available = element.w * element.h;
    if (available > 180_000 && contentWeight < 120) {
      return sum + 1;
    }
    if (contentWeight > 240 && available < 120_000) {
      return sum + 1;
    }
    return sum;
  }, 0);
}

export function inspectLayoutPlanAlignment(pagePlan: PagePlan, graph: SceneGraph): LayoutQualityAssessment {
  const fatalReasons: string[] = [];
  const warningReasons: string[] = [];

  if (pagePlan.page.layoutFamily === "left-rail-plus-action-grid") {
    if (hasMechanicalEqualCardGrid(graph)) {
      fatalReasons.push("left-rail-plus-action-grid collapsed into a mechanical equal-card grid");
    }

    const requiresLeftRail = pagePlan.page.regions.some(
      (region) => region.placement === "left" && (region.kind === "framework" || region.kind === "hero"),
    );
    if (requiresLeftRail && !hasLeftRail(graph)) {
      fatalReasons.push("the planned framing rail is missing or visually too weak");
    }
  }

  if (pagePlan.page.layoutFamily === "top-band-plus-grid" && !hasDominantTopRegion(graph)) {
    fatalReasons.push("the planned top framing band is missing or too weak");
  }

  const requiresBottomSummary =
    Boolean(pagePlan.page.objective) ||
    pagePlan.page.regions.some((region) => region.placement === "bottom" || region.kind === "summary");
  if (requiresBottomSummary && !hasBottomSummary(graph)) {
    fatalReasons.push("the planned bottom summary or objective band is missing");
  }

  if (pagePlan.page.requiresVisualAid) {
    const visualAidSignals = countVisualAidSignals(graph);
    const minimumSignals =
      pagePlan.page.visualAidBudget === "minimal"
        ? 2
        : pagePlan.page.visualAidBudget === "standard"
          ? 3
          : 4;
    if (visualAidSignals < minimumSignals) {
      warningReasons.push("the page is visually too plain and lacks enough badges, icons, dividers, or other structural aids");
    }
    const maxSignals =
      pagePlan.page.visualAidBudget === "minimal" ? Math.max(3, pagePlan.page.regions.length + 1)
        : pagePlan.page.visualAidBudget === "standard" ? Math.max(6, pagePlan.page.regions.length * 2)
          : 14;
    if (visualAidSignals > maxSignals + 2) {
      fatalReasons.push("visual aid overload is crowding the page and reducing text readability");
    } else if (visualAidSignals > maxSignals) {
      warningReasons.push("visual aid count is above the planned budget and may crowd readability");
    }
  }

  const headerIntrusions = protectedHeaderIntrusions(graph, pagePlan.page.headerReservePx);
  if (headerIntrusions > 0) {
    fatalReasons.push("header crowding: non-title content intrudes into the protected title band");
  }

  const topOccupancy = topHalfOccupancy(graph, Math.round(SLIDE_HEIGHT * 0.4));
  const bottomOccupancy = bottomHalfOccupancy(graph, Math.round(SLIDE_HEIGHT * 0.55));
  if (topOccupancy > pagePlan.page.maxTopOccupancyRatio && bottomOccupancy < 0.12) {
    fatalReasons.push("top-heavy layout: the upper section is crowded while the lower half remains underused");
  }

  const actionCompression = detectActionCardCompression(pagePlan, graph);
  if (actionCompression.starvedCards >= 2) {
    fatalReasons.push("card text starvation: multiple cards are too small for their title/body content");
  } else if (actionCompression.starvedCards === 1) {
    warningReasons.push("card text pressure: one card is tighter than planned");
  }
  if (actionCompression.stackedPenalty > 0) {
    warningReasons.push("stacked icon penalty: small dense cards are using icons as a separate vertical layer");
  }
  if (actionCompression.titleBreakRisk > 0) {
    warningReasons.push("title fragmentation: some cards are likely forcing titles into weak or broken wrapping");
  }

  const frameworkRailMismatch = detectFrameworkRailMismatch(graph);
  if (frameworkRailMismatch >= 2) {
    fatalReasons.push("container mismatch: framework rail sizing is badly mismatched to the text load");
  } else if (frameworkRailMismatch === 1) {
    warningReasons.push("container mismatch: a framework rail could be resized to better match its text load");
  }

  if (fatalReasons.length === 0) {
    return { ok: true, fatalReasons, warningReasons };
  }

  return {
    ok: false,
    fatalReasons,
    warningReasons,
    reason: [
      "Plan alignment too low:",
      fatalReasons.concat(warningReasons).join("; "),
      "Restructure the composition so it follows the planned layout family, protects the header safe zone, preserves text area inside cards, and avoids flat repeated-card layouts.",
    ].join(" "),
  };
}

export function evaluateLayoutPlanAlignment(pagePlan: PagePlan, graph: SceneGraph): LayoutDensityResult {
  const assessment = inspectLayoutPlanAlignment(pagePlan, graph);
  if (assessment.ok) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: assessment.reason,
  };
}

export function evaluateLayoutDensity(pageContent: string, graph: SceneGraph): LayoutDensityResult {
  const inputLength = compactLength(pageContent);
  if (inputLength < 180) {
    return { ok: true };
  }

  const outputLength = graph.slide.elements.reduce((sum, element) => sum + extractElementTextLength(element), 0);
  const outputRetention = inputLength === 0 ? 1 : outputLength / inputLength;
  const contentBlocks = countContentBlocks(graph.slide.elements);
  const sparseLargeBlocks = countSparseLargeBlocks(graph.slide.elements);
  const occupancy = occupiedAreaRatio(graph.slide.elements);

  const reasons: string[] = [];

  if (inputLength >= 220 && outputRetention < 0.62) {
    reasons.push("too much input detail was compressed away");
  }

  if (inputLength >= 260 && contentBlocks <= 3) {
    reasons.push("content was not decomposed into enough visual blocks");
  }

  if (inputLength >= 240 && occupancy < 0.22) {
    reasons.push("too much of the slide remains unused");
  }

  if (inputLength >= 180 && sparseLargeBlocks >= 2) {
    reasons.push("large containers are too empty");
  }

  const topOccupancy = topHalfOccupancy(graph, Math.round(SLIDE_HEIGHT * 0.4));
  const bottomOccupancy = bottomHalfOccupancy(graph, Math.round(SLIDE_HEIGHT * 0.55));
  if (inputLength >= 220 && topOccupancy > 0.34 && bottomOccupancy < 0.1) {
    reasons.push("the page is top-heavy and leaves too much meaningful space unused below");
  }

  if (reasons.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: [
      "Layout density too low:",
      reasons.join("; "),
      "Preserve more input detail, use more of the canvas, and split long paragraphs into multiple coordinated blocks.",
    ].join(" "),
  };
}
