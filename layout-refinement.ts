import { computeActionCardGroupLayout } from "./primitive-layout.ts";
import { type PagePlan } from "./page-plan.ts";
import {
  type ActionCardGroupContent,
  type FrameworkRailContent,
  type ObjectiveBandContent,
  type SceneElement,
  type SceneGraph,
} from "./types.ts";

type LayoutRefinementResult = {
  graph: SceneGraph;
  changes: string[];
};

type LayoutRefinementOptions = {
  mode?: "minimal" | "full";
};

function cloneGraph(graph: SceneGraph): SceneGraph {
  if (typeof structuredClone === "function") {
    return structuredClone(graph);
  }
  return JSON.parse(JSON.stringify(graph)) as SceneGraph;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function containsEastAsianText(text: string): boolean {
  return /[\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(text);
}

function compactUnits(text: string | undefined): number {
  if (!text) {
    return 0;
  }
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

function overlapsHorizontally(a: SceneElement, b: SceneElement): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w;
}

function containsElement(container: SceneElement, child: SceneElement): boolean {
  return (
    child.x >= container.x - 4 &&
    child.y >= container.y - 4 &&
    child.x + child.w <= container.x + container.w + 4 &&
    child.y + child.h <= container.y + container.h + 4
  );
}

function nearlyEqual(a: number, b: number, tolerance = 20): boolean {
  return Math.abs(a - b) <= tolerance;
}

function isHeaderElement(element: SceneElement, headerReservePx: number): boolean {
  if (element.type === "title") {
    return element.role === "header" || element.y < headerReservePx;
  }
  return element.type === "text" && (element.role === "context" || element.y < headerReservePx);
}

function isAnchoredBottomElement(element: SceneElement, pagePlan: PagePlan, slideHeight: number): boolean {
  const requiresBottomSummary =
    Boolean(pagePlan.page.objective) ||
    pagePlan.page.regions.some((region) => region.placement === "bottom" || region.kind === "summary");
  if (!requiresBottomSummary) {
    return false;
  }
  return (element.type === "objectiveBand" || element.type === "summaryBand") && element.y >= slideHeight * 0.62;
}

function minHeightForHeaderIntruder(element: SceneElement): number {
  switch (element.type) {
    case "summaryBand":
      return 48;
    case "objectiveBand":
      return 88;
    case "callout":
      return 56;
    case "text":
      return 30;
    case "frameworkRail":
      return 180;
    case "actionCardGroup":
      return 150;
    default:
      return 32;
  }
}

function toneFromContainer(container: Extract<SceneElement, { type: "shape" }>): "default" | "accent" | "neutral" {
  const borderColor = container.style.borderColor?.toLowerCase();
  const backgroundColor = container.style.backgroundColor?.toLowerCase();
  if (
    borderColor === "#ff5a1f" ||
    borderColor === "#f3a08c" ||
    borderColor === "#d85a1f" ||
    borderColor === "#f0b08d" ||
    borderColor === "#c84c2b" ||
    backgroundColor === "#fff5f0" ||
    backgroundColor === "#fef6f3" ||
    backgroundColor === "#fff3ea" ||
    backgroundColor === "#fffaf6"
  ) {
    return "accent";
  }
  if (
    borderColor === "#d8ba86" ||
    borderColor === "#2f5f86" ||
    backgroundColor === "#fdf8f0" ||
    backgroundColor === "#eef4f8" ||
    backgroundColor === "#fff7e6"
  ) {
    return "neutral";
  }
  return "default";
}

function extractTextValue(element: SceneElement): string {
  switch (element.type) {
    case "title":
    case "text":
      return element.content.text ?? "";
    case "badge":
      return element.content.text ?? "";
    default:
      return "";
  }
}

function collapseEvidenceTextBands(graph: SceneGraph, changes: string[]): void {
  const containers = graph.slide.elements.filter(
    (element): element is Extract<SceneElement, { type: "shape" }> =>
      element.type === "shape" &&
      element.role === "container" &&
      element.w >= 900 &&
      element.h >= 72 &&
      element.h <= 180,
  );

  for (const container of containers) {
    const children = graph.slide.elements.filter((element) => element.id !== container.id && containsElement(container, element));
    const texts = children.filter((element) => element.type === "text").sort((a, b) => a.y - b.y || a.x - b.x);
    if (texts.length < 3) {
      continue;
    }

    const titleElement = children.find((element) => element.type === "title" || element.type === "badge")
      ?? graph.slide.elements.find((element) =>
        (element.type === "title" || element.type === "badge") &&
        element.y + element.h <= container.y &&
        container.y - (element.y + element.h) <= 40 &&
        element.x <= container.x + container.w &&
        element.x + element.w >= container.x,
      );
    const title = titleElement ? extractTextValue(titleElement) : "";
    const items = texts.map((element) => extractTextValue(element).replace(/\s+/g, " ").trim()).filter(Boolean);
    if (items.length < 3) {
      continue;
    }

    const emphasis = items.length > 4 ? items.pop() : undefined;
    const removableIds = new Set<string>([container.id, ...texts.map((element) => element.id)]);
    if (titleElement) {
      removableIds.add(titleElement.id);
    }

    graph.slide.elements = graph.slide.elements.filter((element) => !removableIds.has(element.id));
    graph.slide.elements.push({
      id: `collapsed-summary-${container.id}`,
      type: "summaryBand",
      role: "evidence",
      x: container.x,
      y: container.y,
      w: container.w,
      h: container.h,
      zIndex: 5,
      style: {
        backgroundColor: container.style.backgroundColor,
        borderColor: container.style.borderColor,
        borderWidth: container.style.borderWidth,
        borderStyle: container.style.borderStyle,
        borderRadius: container.style.borderRadius,
        padding: 16,
      },
      content: {
        title: title || "Supporting Evidence",
        items,
        emphasis,
        tone: toneFromContainer(container),
      },
    });
    changes.push(`collapsed evidence text strip "${container.id}" into summaryBand`);
  }
}

function collapseRepeatedCardRows(graph: SceneGraph, pagePlan: PagePlan, changes: string[]): void {
  const containers = graph.slide.elements.filter(
    (element): element is Extract<SceneElement, { type: "shape" }> =>
      element.type === "shape" && element.role === "container" && element.w >= 240 && element.h >= 90,
  );
  if (containers.length < 3) {
    return;
  }

  const rows: Extract<SceneElement, { type: "shape" }>[][] = [];
  for (const container of [...containers].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((candidate) =>
      candidate.length > 0 &&
      nearlyEqual(candidate[0].y, container.y, 42) &&
      nearlyEqual(candidate[0].h, container.h, 48),
    );
    if (row) {
      row.push(container);
    } else {
      rows.push([container]);
    }
  }

  for (const row of rows) {
    if (row.length < 3) {
      continue;
    }
    const sortedRow = [...row].sort((a, b) => a.x - b.x);
    const rowWidthSpread = Math.max(...sortedRow.map((item) => item.w)) - Math.min(...sortedRow.map((item) => item.w));
    if (rowWidthSpread > 80) {
      continue;
    }

    const removableIds = new Set<string>();
    const items: ActionCardGroupContent["items"] = [];
    let groupTitle = "";

    for (const [index, container] of sortedRow.entries()) {
      const children = graph.slide.elements.filter((element) => element.id !== container.id && containsElement(container, element));
      const title = children.find((element) => element.type === "title");
      const body = children.find((element) => element.type === "text");
      const badge = children.find((element) => element.type === "badge");
      const icon = children.find((element) => element.type === "icon");
      const labelAbove = graph.slide.elements.find((element) =>
        (element.type === "title" || element.type === "badge") &&
        element.y + element.h <= container.y &&
        container.y - (element.y + element.h) <= 56 &&
        element.x <= container.x + container.w &&
        element.x + element.w >= container.x,
      );

      if (!groupTitle && labelAbove) {
        groupTitle = extractTextValue(labelAbove);
        removableIds.add(labelAbove.id);
      }

      if (!body) {
        items.length = 0;
        break;
      }

      const titleText = extractTextValue(title ?? badge ?? labelAbove ?? container);
      const bodyText = extractTextValue(body);
      if (!titleText || !bodyText) {
        items.length = 0;
        break;
      }

      removableIds.add(container.id);
      for (const child of children) {
        removableIds.add(child.id);
      }

      items.push({
        step: badge ? extractTextValue(badge).slice(0, 8) : String(index + 1).padStart(2, "0"),
        title: titleText.replace(/\s+/g, " ").trim(),
        body: bodyText.replace(/\s+/g, " ").trim(),
        icon: icon?.type === "icon" ? icon.content.name : undefined,
        weight: toneFromContainer(container) === "accent" || index === 0 ? "lead" : "regular",
        tone: toneFromContainer(container),
      });
    }

    if (items.length !== sortedRow.length) {
      continue;
    }

    const minX = Math.min(...sortedRow.map((item) => item.x));
    const minY = Math.min(...sortedRow.map((item) => item.y));
    const maxX = Math.max(...sortedRow.map((item) => item.x + item.w));
    const maxY = Math.max(...sortedRow.map((item) => item.y + item.h));
    const sectionTitle = groupTitle || pagePlan.page.regions.find((region) =>
      region.placement === "main" || region.placement === "bottom" || region.kind === "actions" || region.kind === "details"
    )?.title;

    graph.slide.elements = graph.slide.elements.filter((element) => !removableIds.has(element.id));
    graph.slide.elements.push({
      id: `collapsed-group-${sortedRow[0].id}`,
      type: "actionCardGroup",
      role: "layout",
      x: minX,
      y: minY - (groupTitle ? 8 : 0),
      w: maxX - minX,
      h: maxY - minY + (groupTitle ? 8 : 0),
      zIndex: 6,
      style: {
        backgroundColor: "transparent",
        padding: 0,
        lineHeight: 1.24,
      },
      content: {
        title: sectionTitle,
        layout: "lead-grid",
        iconPlacement: "inline",
        densityClass: row.length >= 4 ? "dense" : "balanced",
        items,
      },
    });
    changes.push(`collapsed ${sortedRow.length} repeated manual cards into actionCardGroup "${sortedRow[0].id}"`);
  }
}

function refineActionCardGroups(graph: SceneGraph, changes: string[]): void {
  for (const element of graph.slide.elements) {
    if (element.type !== "actionCardGroup") {
      continue;
    }

    const content = element.content as ActionCardGroupContent;
    const denseByContent =
      content.densityClass === "dense" ||
      content.items.length >= 5 ||
      content.items.some((item) => compactUnits(item.title) + compactUnits(item.body) >= 70);
    const layout = computeActionCardGroupLayout(content, { w: element.w, h: element.h });
    const compactSlots = layout.slots.filter((slot) => slot.w < 320 || slot.h < 170 || slot.weight === "compact");

    if (denseByContent && content.densityClass !== "dense") {
      content.densityClass = "dense";
      changes.push(`tightened actionCardGroup "${element.id}" to dense mode`);
    }

    if (content.visualAid && (denseByContent || compactSlots.length > 0) && content.iconPlacement !== "inline") {
      content.iconPlacement = "inline";
      changes.push(`forced inline icon placement for actionCardGroup "${element.id}"`);
    }

    if ((denseByContent || compactSlots.length > 0) && (content.columns === undefined || content.columns > 2)) {
      content.columns = 2;
      changes.push(`limited actionCardGroup "${element.id}" to 2 columns for readability`);
    }

    for (const slot of compactSlots) {
      const item = content.items[slot.itemIndex];
      if (item.eyebrow) {
        delete item.eyebrow;
        changes.push(`removed eyebrow from compact action card "${element.id}:${slot.itemIndex}"`);
      }
      if (item.emphasis && slot.weight !== "lead") {
        delete item.emphasis;
        changes.push(`removed non-essential emphasis from compact action card "${element.id}:${slot.itemIndex}"`);
      }
    }
  }
}

function refineFrameworkRails(graph: SceneGraph, changes: string[]): void {
  for (const element of graph.slide.elements) {
    if (element.type !== "frameworkRail") {
      continue;
    }

    const content = element.content as FrameworkRailContent;
    const contentWeight =
      compactUnits(content.title) +
      compactUnits(content.summary) +
      (content.bullets?.reduce((sum, item) => sum + compactUnits(item), 0) ?? 0) * 0.85 +
      (content.footerItems?.reduce((sum, item) => sum + compactUnits(item), 0) ?? 0) * 0.45;
    const denseMode = content.densityClass === "dense" || contentWeight > 200;

    if (denseMode && content.densityClass !== "dense") {
      content.densityClass = "dense";
      changes.push(`tightened frameworkRail "${element.id}" to dense mode`);
    }

    if (element.h < 240 && (content.footerTitle || (content.footerItems?.length ?? 0) > 0)) {
      delete content.footerTitle;
      delete content.footerItems;
      changes.push(`removed footer chips from compact frameworkRail "${element.id}"`);
    }
  }
}

function refineObjectiveBands(graph: SceneGraph, changes: string[]): void {
  for (const element of graph.slide.elements) {
    if (element.type !== "objectiveBand") {
      continue;
    }

    const content = element.content as ObjectiveBandContent;
    const denseMode =
      content.densityClass === "dense" ||
      compactUnits(content.text) + compactUnits(content.emphasis) >= 90 ||
      element.h <= 124;
    const targetHeight = denseMode ? 124 : 136;

    if (denseMode && content.densityClass !== "dense") {
      content.densityClass = "dense";
      changes.push(`tightened objectiveBand "${element.id}" to dense mode`);
    }

    if (element.h > targetHeight) {
      const delta = element.h - targetHeight;
      element.y += delta;
      element.h = targetHeight;
      changes.push(`compressed objectiveBand "${element.id}" by ${delta}px`);
    }
  }
}

function tightenHeaderIntrusions(graph: SceneGraph, pagePlan: PagePlan, changes: string[]): void {
  const headerReservePx = pagePlan.page.headerReservePx;
  const headerElements = graph.slide.elements.filter((element) => isHeaderElement(element, headerReservePx));
  if (headerElements.length === 0) {
    return;
  }

  const protectedStart = Math.max(
    headerReservePx,
    Math.max(...headerElements.map((element) => element.y + element.h)) + 18,
  );
  const intruders = graph.slide.elements
    .filter((element) => !isHeaderElement(element, headerReservePx) && element.y < protectedStart)
    .sort((a, b) => a.y - b.y);
  if (intruders.length === 0) {
    return;
  }

  let cursor = protectedStart;
  for (const element of intruders) {
    const originalY = element.y;
    const originalH = element.h;
    if (element.y < cursor) {
      element.y = cursor;
    }

    const nextBlockY = graph.slide.elements
      .filter((other) => other.id !== element.id && !isHeaderElement(other, headerReservePx) && other.y > originalY)
      .reduce((minY, other) => Math.min(minY, other.y), Number.POSITIVE_INFINITY);

    if (Number.isFinite(nextBlockY) && element.y + element.h > nextBlockY) {
      const compressedHeight = Math.max(minHeightForHeaderIntruder(element), nextBlockY - element.y);
      if (compressedHeight < element.h) {
        element.h = compressedHeight;
      }
    }

    if (originalY !== element.y || originalH !== element.h) {
      const detail = [];
      if (originalY !== element.y) {
        detail.push(`moved to y=${element.y}`);
      }
      if (originalH !== element.h) {
        detail.push(`compressed to h=${element.h}`);
      }
      changes.push(`tightened header intrusion "${element.id}" (${detail.join(", ")})`);
    }

    cursor = Math.max(cursor, element.y + element.h + 6);
  }
}

function shiftContentBelowHeader(graph: SceneGraph, pagePlan: PagePlan, changes: string[]): void {
  const headerReservePx = pagePlan.page.headerReservePx;
  const headerElements = graph.slide.elements.filter((element) => isHeaderElement(element, headerReservePx));
  const movableElements = graph.slide.elements.filter(
    (element) => !isHeaderElement(element, headerReservePx) && !isAnchoredBottomElement(element, pagePlan, graph.slide.height),
  );
  if (headerElements.length === 0 || movableElements.length === 0) {
    return;
  }

  const headerBottom = Math.max(...headerElements.map((element) => element.y + element.h));
  const currentStart = Math.min(...movableElements.map((element) => element.y));
  const desiredStart = Math.max(headerReservePx, headerBottom + 18);
  if (currentStart >= desiredStart) {
    return;
  }

  const anchoredElements = graph.slide.elements.filter((element) => isAnchoredBottomElement(element, pagePlan, graph.slide.height));
  const upperBoundary = anchoredElements.length > 0
    ? Math.min(...anchoredElements.map((element) => element.y)) - 16
    : graph.slide.height - 24;
  const movableBottom = Math.max(...movableElements.map((element) => element.y + element.h));
  const availableShift = upperBoundary - movableBottom;
  const delta = Math.min(desiredStart - currentStart, Math.max(0, availableShift));
  if (delta <= 0) {
    return;
  }

  for (const element of movableElements) {
    element.y += delta;
  }
  changes.push(`shifted content regions downward by ${delta}px to protect the title band`);
}

function growElementDownward(element: SceneElement, elements: SceneElement[], limitY: number, maxIncrease: number): number {
  const blockers = elements.filter(
    (other) =>
      other.id !== element.id &&
      other.y >= element.y + element.h &&
      overlapsHorizontally(element, other),
  );
  const blockerY = blockers.length > 0 ? Math.min(...blockers.map((other) => other.y)) - 12 : limitY;
  const room = blockerY - (element.y + element.h);
  const increase = Math.min(maxIncrease, Math.max(0, room));
  if (increase > 0) {
    element.h += increase;
  }
  return increase;
}

function rebalanceTopHeavy(graph: SceneGraph, pagePlan: PagePlan, changes: string[]): void {
  const anchoredElements = graph.slide.elements.filter((element) => isAnchoredBottomElement(element, pagePlan, graph.slide.height));
  const upperBoundary = anchoredElements.length > 0
    ? Math.min(...anchoredElements.map((element) => element.y)) - 16
    : graph.slide.height - 24;
  const growable = graph.slide.elements.filter(
    (element) =>
      (element.type === "actionCardGroup" || element.type === "frameworkRail") &&
      element.y + element.h < upperBoundary &&
      !isHeaderElement(element, pagePlan.page.headerReservePx),
  );
  if (growable.length === 0) {
    return;
  }

  const candidate = [...growable].sort((a, b) => (b.y + b.h) - (a.y + a.h))[0];
  const increase = growElementDownward(candidate, graph.slide.elements, upperBoundary, 72);
  if (increase > 0) {
    changes.push(`expanded "${candidate.id}" downward by ${increase}px to reduce top-heavy composition`);
  }
}

function clampElementsToCanvas(graph: SceneGraph): void {
  for (const element of graph.slide.elements) {
    element.x = clamp(element.x, 0, Math.max(0, graph.slide.width - element.w));
    element.y = clamp(element.y, 0, Math.max(0, graph.slide.height - element.h));
    element.w = clamp(element.w, 1, graph.slide.width - element.x);
    element.h = clamp(element.h, 1, graph.slide.height - element.y);
  }
}

export function refineSceneGraphLayout(graph: SceneGraph, pagePlan: PagePlan, options: LayoutRefinementOptions = {}): LayoutRefinementResult {
  const refined = cloneGraph(graph);
  const changes: string[] = [];
  const mode = options.mode ?? "full";

  if (pagePlan.page.pageType !== "content") {
    clampElementsToCanvas(refined);
    return { graph: refined, changes };
  }

  if (mode === "minimal") {
    clampElementsToCanvas(refined);
    return { graph: refined, changes };
  }

  collapseRepeatedCardRows(refined, pagePlan, changes);
  collapseEvidenceTextBands(refined, changes);
  refineActionCardGroups(refined, changes);
  refineFrameworkRails(refined, changes);
  refineObjectiveBands(refined, changes);
  tightenHeaderIntrusions(refined, pagePlan, changes);
  shiftContentBelowHeader(refined, pagePlan, changes);
  rebalanceTopHeavy(refined, pagePlan, changes);
  clampElementsToCanvas(refined);

  return { graph: refined, changes };
}
