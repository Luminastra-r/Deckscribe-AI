import { type CardGroupContent, type SceneElement, type SceneGraph } from "./types.ts";

type MutableSceneGraph = SceneGraph;

function isTextLike(element: SceneElement): boolean {
  return ["title", "text", "bulletList", "callout", "grid"].includes(element.type);
}

function textLength(element: SceneElement): number {
  switch (element.type) {
    case "title":
    case "text":
      return element.content.text.length;
    case "bulletList":
      return element.content.items.join("").length;
    case "callout":
      return element.content.title.length + element.content.text.length;
    case "grid":
      return element.content.header.join("").length + element.content.rows.flat().join("").length;
    default:
      return 0;
  }
}

function overlap(a: SceneElement, b: SceneElement): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function adjustTextStyle(element: SceneElement): void {
  if (!isTextLike(element)) {
    return;
  }

  const baseSize = element.style.fontSize;
  if (baseSize === undefined) {
    return;
  }

  const density = textLength(element) / Math.max(1, element.w * element.h);
  if (density > 0.0022) {
    element.style.fontSize = Math.max(12, baseSize - 2);
  }

  if (element.type === "title" && textLength(element) > 20) {
    element.style.fontSize = Math.max(28, (element.style.fontSize ?? baseSize) - 1);
  }
}

function setElementFrame(element: SceneElement, x: number, y: number, w: number, h?: number): void {
  element.x = Math.round(x);
  element.y = Math.round(y);
  element.w = Math.round(w);
  if (h !== undefined) {
    element.h = Math.round(h);
  }
}

function isInsideContainer(element: SceneElement, container: SceneElement, tolerance = 20): boolean {
  return (
    element.x >= container.x - tolerance &&
    element.y >= container.y - tolerance &&
    element.x + element.w <= container.x + container.w + tolerance &&
    element.y + element.h <= container.y + container.h + tolerance
  );
}

function isChartCompanion(element: SceneElement): boolean {
  return [
    "chart",
    "metric",
    "insight",
    "callout",
    "text",
    "bulletList",
    "summaryBand",
    "badge",
  ].includes(element.type);
}

function preferredElementHeight(element: SceneElement): number {
  switch (element.type) {
    case "metric":
      return clamp(element.h || 118, 96, 132);
    case "insight":
      return clamp(element.h || 168, 132, 220);
    case "callout":
      return clamp(element.h || 154, 126, 206);
    case "summaryBand":
      return clamp(element.h || 132, 108, 172);
    case "bulletList":
      return clamp(element.h || 148, 122, 206);
    case "text":
      return clamp(element.h || 122, 92, 174);
    case "badge":
      return clamp(element.h || 40, 32, 52);
    default:
      return element.h;
  }
}

function stackElementsVertically(
  elements: SceneElement[],
  x: number,
  y: number,
  w: number,
  availableH: number,
  gap: number,
): void {
  if (elements.length === 0) {
    return;
  }

  const preferredHeights = elements.map((element) => preferredElementHeight(element));
  const totalPreferred = preferredHeights.reduce((sum, value) => sum + value, 0) + gap * Math.max(0, elements.length - 1);
  const scale = totalPreferred > availableH ? availableH / totalPreferred : 1;
  let cursorY = y;

  elements.forEach((element, index) => {
    const remainingElements = elements.length - index - 1;
    const remainingGap = gap * remainingElements;
    const remainingMin = remainingElements * 84;
    const scaledHeight = Math.max(72, Math.floor(preferredHeights[index] * scale));
    const maxHeight = Math.max(72, y + availableH - cursorY - remainingGap - remainingMin);
    const height = Math.min(scaledHeight, maxHeight);
    setElementFrame(element, x, cursorY, w, height);
    adjustTextStyle(element);
    cursorY += height + gap;
  });
}

function layoutMetricsRow(
  metrics: Extract<SceneElement, { type: "metric" }>[],
  x: number,
  y: number,
  w: number,
  gap: number,
): number {
  if (metrics.length === 0) {
    return 0;
  }

  const itemW = Math.floor((w - gap * (metrics.length - 1)) / metrics.length);
  const rowH = clamp(
    Math.max(...metrics.map((metric) => preferredElementHeight(metric))),
    96,
    132,
  );

  metrics.forEach((metric, index) => {
    const itemX = x + index * (itemW + gap);
    setElementFrame(metric, itemX, y, itemW, rowH);
  });

  return rowH;
}

function layoutCardContents(item: CardGroupContent["items"][number], elementsById: Map<string, SceneElement>): void {
  const container = elementsById.get(item.containerId);
  if (!container) {
    return;
  }

  const icons = (item.iconIds ?? []).map((id) => elementsById.get(id)).filter((el): el is SceneElement => Boolean(el));
  const titles = (item.titleIds ?? []).map((id) => elementsById.get(id)).filter((el): el is SceneElement => Boolean(el));
  const bodies = (item.bodyIds ?? []).map((id) => elementsById.get(id)).filter((el): el is SceneElement => Boolean(el));

  const padX = Math.max(16, Math.round(container.w * 0.055));
  const padY = Math.max(14, Math.round(container.h * 0.08));
  const compact = titles.length === 0 && bodies.length === 1 && container.h <= 96;

  if (compact) {
    const icon = icons[0];
    const body = bodies[0];
    let textX = container.x + padX;
    if (icon) {
      setElementFrame(icon, container.x + padX, container.y + Math.round((container.h - icon.h) / 2), icon.w, icon.h);
      textX = icon.x + icon.w + 12;
    }
    if (body) {
      setElementFrame(body, textX, container.y + 14, container.x + container.w - padX - textX, container.h - 28);
      adjustTextStyle(body);
    }
    return;
  }

  let cursorY = container.y + padY;
  const icon = icons[0];
  if (icon) {
    setElementFrame(icon, container.x + padX, cursorY + 2, icon.w, icon.h);
  }

  const title = titles[0];
  if (title) {
    const titleX = icon ? icon.x + icon.w + 12 : container.x + padX;
    setElementFrame(title, titleX, cursorY, container.x + container.w - padX - titleX, title.h);
    adjustTextStyle(title);
    cursorY += Math.max(icon?.h ?? 0, title.h) + 12;
  } else if (icon) {
    cursorY += icon.h + 10;
  }

  const remaining = Math.max(24, container.y + container.h - cursorY - padY);
  if (bodies.length === 1) {
    const body = bodies[0];
    setElementFrame(body, container.x + padX, cursorY, container.w - padX * 2, remaining);
    adjustTextStyle(body);
    return;
  }

  const bodyGap = 8;
  const totalGap = bodyGap * Math.max(0, bodies.length - 1);
  const bodyHeight = Math.max(24, Math.floor((remaining - totalGap) / Math.max(1, bodies.length)));
  bodies.forEach((body) => {
    setElementFrame(body, container.x + padX, cursorY, container.w - padX * 2, bodyHeight);
    adjustTextStyle(body);
    cursorY += bodyHeight + bodyGap;
  });
}

function cardGroupNeedsLayout(group: Extract<SceneElement, { type: "cardGroup" }>, elementsById: Map<string, SceneElement>): boolean {
  const containers = group.content.items
    .map((item) => elementsById.get(item.containerId))
    .filter((el): el is SceneElement => Boolean(el));

  if (containers.length !== group.content.items.length || containers.length <= 1) {
    return true;
  }

  const first = containers[0];
  const allSameOrigin = containers.every((container) => container.x === first.x && container.y === first.y);
  if (allSameOrigin) {
    return true;
  }

  if (containers.some((container) => !isInsideContainer(container, group, 36))) {
    return true;
  }

  for (let index = 0; index < containers.length; index += 1) {
    for (let inner = index + 1; inner < containers.length; inner += 1) {
      if (overlap(containers[index], containers[inner])) {
        return true;
      }
    }
  }

  return false;
}

function layoutCardGroup(group: Extract<SceneElement, { type: "cardGroup" }>, elementsById: Map<string, SceneElement>): void {
  const items = group.content.items;

  if (!cardGroupNeedsLayout(group, elementsById)) {
    items.forEach((item) => layoutCardContents(item, elementsById));
    return;
  }

  const columns = Math.max(1, Math.min(group.content.columns ?? items.length, 4));
  const rows = Math.ceil(items.length / columns);
  const gap = group.content.gap ?? 24;
  const padX = group.content.paddingX ?? 0;
  const padY = group.content.paddingY ?? 0;
  const availableW = group.w - padX * 2 - gap * (columns - 1);
  const availableH = group.h - padY * 2 - gap * (rows - 1);
  const itemW = Math.floor(availableW / columns);
  const itemH = Math.floor(availableH / rows);

  items.forEach((item, index) => {
    const container = elementsById.get(item.containerId);
    if (!container) {
      return;
    }

    const row = Math.floor(index / columns);
    const col = index % columns;
    const x = group.x + padX + col * (itemW + gap);
    const y = group.y + padY + row * (itemH + gap);
    setElementFrame(container, x, y, itemW, itemH);
    layoutCardContents(item, elementsById);
  });
}

function sectionNeedsLayout(section: Extract<SceneElement, { type: "section" }>, elementsById: Map<string, SceneElement>): boolean {
  const linked = [...section.content.headerIds, ...section.content.bodyIds]
    .map((id) => elementsById.get(id))
    .filter((el): el is SceneElement => Boolean(el));

  if (linked.length === 0) {
    return false;
  }

  if (linked.every((element) => element.x === 0 && element.y === 0)) {
    return true;
  }

  if (linked.some((element) => !isInsideContainer(element, section, 36))) {
    return true;
  }

  return false;
}

function layoutSectionHeader(
  section: Extract<SceneElement, { type: "section" }>,
  elementsById: Map<string, SceneElement>,
): { innerX: number; innerW: number; cursorY: number; gap: number } {
  const topPadding = section.content.topPadding ?? 24;
  const headerGap = section.content.headerGap ?? 18;
  const gap = section.content.gap ?? 16;
  const innerX = section.x + 24;
  const innerW = section.w - 48;
  let cursorY = section.y + topPadding;

  const headerElements = section.content.headerIds
    .map((id) => elementsById.get(id))
    .filter((el): el is SceneElement => Boolean(el));

  if (headerElements.length > 0) {
    let headerX = innerX;
    let rowHeight = 0;
    headerElements.forEach((element, index) => {
      if (element.type === "icon") {
        setElementFrame(element, headerX, cursorY + 2, element.w, element.h);
        headerX += element.w + 12;
      } else {
        const width = index === headerElements.length - 1 ? section.x + section.w - 24 - headerX : element.w;
        setElementFrame(element, headerX, cursorY, width);
        adjustTextStyle(element);
        headerX += width + 12;
      }
      rowHeight = Math.max(rowHeight, element.h);
    });
    cursorY += rowHeight + headerGap;
  }

  return { innerX, innerW, cursorY, gap };
}

function layoutChartSection(
  section: Extract<SceneElement, { type: "section" }>,
  elementsById: Map<string, SceneElement>,
): boolean {
  const bodyElements = section.content.bodyIds
    .map((id) => elementsById.get(id))
    .filter((el): el is SceneElement => Boolean(el));

  const charts = bodyElements.filter((element): element is Extract<SceneElement, { type: "chart" }> => element.type === "chart");
  if (charts.length === 0 || bodyElements.some((element) => !isChartCompanion(element))) {
    return false;
  }

  const { innerX, innerW, gap, cursorY: headerBottom } = layoutSectionHeader(section, elementsById);
  const sectionBottom = section.y + section.h - 24;
  let cursorY = headerBottom;
  let availableH = sectionBottom - cursorY;
  if (availableH < 120) {
    return false;
  }

  const metrics = bodyElements.filter((element): element is Extract<SceneElement, { type: "metric" }> => element.type === "metric");
  const narrative = bodyElements.filter((element) => !["chart", "metric", "badge"].includes(element.type));
  const badges = bodyElements.filter((element): element is Extract<SceneElement, { type: "badge" }> => element.type === "badge");

  if (badges.length > 0) {
    let badgeX = innerX;
    let badgeRowH = 0;
    badges.forEach((badge) => {
      const width = Math.min(Math.max(badge.w, 110), 220);
      setElementFrame(badge, badgeX, cursorY, width, clamp(badge.h || 40, 34, 48));
      badgeX += width + 10;
      badgeRowH = Math.max(badgeRowH, badge.h);
    });
    cursorY += badgeRowH + 12;
    availableH = sectionBottom - cursorY;
  }

  if (metrics.length >= 2 && metrics.length <= 4) {
    const metricGap = metrics.length >= 4 ? 14 : 16;
    const metricsH = layoutMetricsRow(metrics, innerX, cursorY, innerW, metricGap);
    cursorY += metricsH + gap;
    availableH = sectionBottom - cursorY;
  }

  if (availableH < 120) {
    return false;
  }

  if (charts.length === 1) {
    const chart = charts[0];
    if (narrative.length === 0) {
      setElementFrame(chart, innerX, cursorY, innerW, availableH);
      return true;
    }

    const chartRatio = chart.content.chartType === "donut" ? 0.54 : 0.6;
    const chartW = Math.max(420, Math.round(innerW * chartRatio));
    const sideW = innerW - chartW - gap;
    if (sideW < 280) {
      setElementFrame(chart, innerX, cursorY, innerW, Math.round(availableH * 0.56));
      stackElementsVertically(narrative, innerX, chart.y + chart.h + gap, innerW, sectionBottom - chart.y - chart.h - gap, gap);
      return true;
    }

    setElementFrame(chart, innerX, cursorY, chartW, availableH);
    stackElementsVertically(narrative, innerX + chartW + gap, cursorY, sideW, availableH, gap);
    return true;
  }

  if (charts.length === 2 && narrative.length <= 2) {
    const chartW = Math.floor((innerW - gap) / 2);
    charts.forEach((chart, index) => {
      setElementFrame(chart, innerX + index * (chartW + gap), cursorY, chartW, narrative.length > 0 ? Math.round(availableH * 0.68) : availableH);
    });
    if (narrative.length > 0) {
      const narrativesY = charts[0].y + charts[0].h + gap;
      stackElementsVertically(narrative, innerX, narrativesY, innerW, sectionBottom - narrativesY, gap);
    }
    return true;
  }

  return false;
}

function layoutSectionFallback(section: Extract<SceneElement, { type: "section" }>, elementsById: Map<string, SceneElement>): void {
  const { innerX, innerW, cursorY: startY, gap } = layoutSectionHeader(section, elementsById);
  let cursorY = startY;

  section.content.bodyIds.forEach((id) => {
    const element = elementsById.get(id);
    if (!element) {
      return;
    }

    if (element.type === "cardGroup") {
      setElementFrame(element, innerX, cursorY, innerW, element.h);
      layoutCardGroup(element, elementsById);
      cursorY += element.h + gap;
      return;
    }

    if (element.type === "connector") {
      setElementFrame(element, innerX, cursorY, innerW, element.h);
      cursorY += element.h + 8;
      return;
    }

    const width = element.type === "grid" ? innerW : Math.min(innerW, element.w);
    setElementFrame(element, innerX, cursorY, width, element.h);
    adjustTextStyle(element);
    cursorY += element.h + gap;
  });
}

function resolveSectionOverlaps(section: Extract<SceneElement, { type: "section" }>, elementsById: Map<string, SceneElement>): void {
  const ids = [...section.content.headerIds, ...section.content.bodyIds];
  const elements = ids
    .map((id) => elementsById.get(id))
    .filter((el): el is SceneElement => el !== undefined && el.type !== "cardGroup" && el.type !== "connector")
    .sort((a, b) => a.y - b.y || a.x - b.x);

  for (let index = 1; index < elements.length; index += 1) {
    const prev = elements[index - 1]!;
    const current = elements[index]!;
    if (!overlap(prev, current)) {
      continue;
    }

    const sameColumn = Math.abs(prev.x - current.x) <= 40;
    const horizontalOverlap = Math.min(prev.x + prev.w, current.x + current.w) - Math.max(prev.x, current.x);
    if (!sameColumn && horizontalOverlap < Math.min(prev.w, current.w) * 0.5) {
      continue;
    }

    current.y = prev.y + prev.h + 10;
    const sectionBottom = section.y + section.h - 18;
    if (current.y + current.h > sectionBottom && isTextLike(current) && current.style.fontSize) {
      current.style.fontSize = Math.max(12, current.style.fontSize - 1);
      current.y = clamp(current.y, section.y, sectionBottom - current.h);
    }
  }
}

export function applyAutoLayout(input: SceneGraph): SceneGraph {
  const graph = structuredClone(input) as MutableSceneGraph;
  const elementsById = new Map(graph.slide.elements.map((element) => [element.id, element]));

  graph.slide.elements.forEach((element) => {
    if (isTextLike(element)) {
      adjustTextStyle(element);
    }
  });

  graph.slide.elements
    .filter((element): element is Extract<SceneElement, { type: "cardGroup" }> => element.type === "cardGroup")
    .forEach((group) => layoutCardGroup(group, elementsById));

  graph.slide.elements
    .filter((element): element is Extract<SceneElement, { type: "section" }> => element.type === "section")
    .forEach((section) => {
      const chartSectionHandled = layoutChartSection(section, elementsById);
      if (!chartSectionHandled && sectionNeedsLayout(section, elementsById)) {
        layoutSectionFallback(section, elementsById);
      }
      resolveSectionOverlaps(section, elementsById);
    });

  return graph;
}
