import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  SUPPORTED_ELEMENT_TYPES,
  SUPPORTED_ICON_NAMES,
  SUPPORTED_VERSIONS,
  isSupportedCanvasSize,
  type ElementStyle,
  type SceneElement,
  type SceneGraph,
} from "./types.ts";

const STYLE_KEYS = new Set([
  "fontSize",
  "fontWeight",
  "lineHeight",
  "color",
  "backgroundColor",
  "surfaceTone",
  "elevation",
  "borderColor",
  "borderWidth",
  "borderStyle",
  "borderRadius",
  "padding",
  "textAlign",
  "opacity",
  "fill",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertInteger(value: unknown, label: string): asserts value is number {
  assert(typeof value === "number" && Number.isInteger(value), `${label} must be an integer`);
}

function assertString(value: unknown, label: string): asserts value is string {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`);
}

function assertColor(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  assert(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(value), `${label} must be a hex color like #RRGGBB`);
}

function validateSvgMarkup(svg: unknown, label: string): asserts svg is string {
  assertString(svg, label);
  const normalized = svg.trim();

  assert(normalized.startsWith("<svg"), `${label} must start with <svg`);
  assert(normalized.endsWith("</svg>"), `${label} must end with </svg>`);

  const blockedPatterns: Array<[RegExp, string]> = [
    [/<script[\s>]/i, "script tags are not allowed"],
    [/<foreignObject[\s>]/i, "foreignObject is not allowed"],
    [/<iframe[\s>]/i, "iframe is not allowed"],
    [/<object[\s>]/i, "object is not allowed"],
    [/<embed[\s>]/i, "embed is not allowed"],
    [/<image[\s>]/i, "image is not allowed"],
    [/\son[a-z]+\s*=/i, "event handler attributes are not allowed"],
    [/\s(?:href|xlink:href)\s*=/i, "external references are not allowed"],
    [/javascript:/i, "javascript URLs are not allowed"],
  ];

  for (const [pattern, message] of blockedPatterns) {
    assert(!pattern.test(normalized), `${label} ${message}`);
  }

  const textNodeMatches = [...normalized.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)];
  const totalTextChars = textNodeMatches.reduce((sum, match) => {
    const innerText = match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, "");
    return sum + innerText.length;
  }, 0);

  assert(textNodeMatches.length <= 8, `${label} is too text-heavy; move most labels into text elements`);
  assert(totalTextChars <= 96, `${label} is too text-heavy; keep svg structural and use HTML text blocks`);
}

function validateStyle(style: unknown, elementLabel: string): asserts style is ElementStyle {
  assert(isPlainObject(style), `${elementLabel}.style must be an object`);

  for (const key of Object.keys(style)) {
    assert(STYLE_KEYS.has(key), `${elementLabel}.style.${key} is not supported`);
  }

  for (const numericKey of ["fontSize", "fontWeight", "lineHeight", "borderWidth", "borderRadius", "padding", "opacity"] as const) {
    const value = style[numericKey];
    if (value !== undefined) {
      assert(typeof value === "number" && Number.isFinite(value), `${elementLabel}.style.${numericKey} must be a number`);
    }
  }

  const elevation = style.elevation;
  if (elevation !== undefined) {
    assert(typeof elevation === "number" && Number.isInteger(elevation) && elevation >= 0 && elevation <= 3, `${elementLabel}.style.elevation must be an integer between 0 and 3`);
  }

  for (const colorKey of ["color", "backgroundColor", "borderColor"] as const) {
    const value = style[colorKey];
    if (value !== undefined) {
      assertColor(value, `${elementLabel}.style.${colorKey}`);
    }
  }

  if (style.fill !== undefined) {
    assert(isPlainObject(style.fill), `${elementLabel}.style.fill must be an object`);
    assert(style.fill.type === "none" || style.fill.type === "solid", `${elementLabel}.style.fill.type must be none or solid`);
    if (style.fill.type === "solid") {
      assertColor(style.fill.color, `${elementLabel}.style.fill.color`);
    }
  }

  const textAlign = style.textAlign;
  if (textAlign !== undefined) {
    assert(typeof textAlign === "string" && ["left", "center", "right"].includes(textAlign), `${elementLabel}.style.textAlign must be left, center, or right`);
  }

  const borderStyle = style.borderStyle;
  if (borderStyle !== undefined) {
    assert(typeof borderStyle === "string" && ["solid", "dashed"].includes(borderStyle), `${elementLabel}.style.borderStyle must be solid or dashed`);
  }

  const surfaceTone = style.surfaceTone;
  if (surfaceTone !== undefined) {
    assert(typeof surfaceTone === "string" && ["default", "muted", "accent", "softAccent"].includes(surfaceTone), `${elementLabel}.style.surfaceTone must be default, muted, accent, or softAccent`);
  }
}

function validateContent(element: Record<string, unknown>, elementLabel: string): void {
  const content = element.content;
  assert(isPlainObject(content), `${elementLabel}.content must be an object`);

  switch (element.type) {
    case "frameworkRail":
      if (content.icon !== undefined) {
        assert(typeof content.icon === "string" && SUPPORTED_ICON_NAMES.includes(content.icon as (typeof SUPPORTED_ICON_NAMES)[number]), `${elementLabel}.content.icon must be a supported icon name`);
      }
      assertString(content.title, `${elementLabel}.content.title`);
      if (content.label !== undefined) {
        assertString(content.label, `${elementLabel}.content.label`);
      }
      if (content.summary !== undefined) {
        assertString(content.summary, `${elementLabel}.content.summary`);
      }
      if (content.bullets !== undefined) {
        assert(Array.isArray(content.bullets) && content.bullets.length > 0, `${elementLabel}.content.bullets must be a non-empty array`);
        content.bullets.forEach((item, index) => assertString(item, `${elementLabel}.content.bullets[${index}]`));
      }
      if (content.footerTitle !== undefined) {
        assertString(content.footerTitle, `${elementLabel}.content.footerTitle`);
      }
      if (content.footerItems !== undefined) {
        assert(Array.isArray(content.footerItems) && content.footerItems.length > 0, `${elementLabel}.content.footerItems must be a non-empty array`);
        content.footerItems.forEach((item, index) => assertString(item, `${elementLabel}.content.footerItems[${index}]`));
      }
      if (content.layout !== undefined) {
        assert(["left", "top"].includes(content.layout as string), `${elementLabel}.content.layout must be left or top`);
      }
      if (content.densityClass !== undefined) {
        assert(["dense", "balanced", "airy"].includes(content.densityClass as string), `${elementLabel}.content.densityClass must be dense, balanced, or airy`);
      }
      if (content.tone !== undefined) {
        assert(["default", "accent", "success", "warning", "neutral"].includes(content.tone as string), `${elementLabel}.content.tone must be default, accent, success, warning, or neutral`);
      }
      return;
    case "title":
    case "text":
      assertString(content.text, `${elementLabel}.content.text`);
      return;
    case "bulletList":
      assert(Array.isArray(content.items) && content.items.length > 0, `${elementLabel}.content.items must be a non-empty array`);
      content.items.forEach((item, index) => assertString(item, `${elementLabel}.content.items[${index}]`));
      return;
    case "callout":
      assertString(content.title, `${elementLabel}.content.title`);
      assertString(content.text, `${elementLabel}.content.text`);
      return;
    case "badge":
      assertString(content.text, `${elementLabel}.content.text`);
      if (content.tone !== undefined) {
        assert(["default", "accent", "success", "warning", "neutral"].includes(content.tone as string), `${elementLabel}.content.tone must be default, accent, success, warning, or neutral`);
      }
      return;
    case "metric":
      assertString(content.value, `${elementLabel}.content.value`);
      assertString(content.label, `${elementLabel}.content.label`);
      if (content.note !== undefined) {
        assertString(content.note, `${elementLabel}.content.note`);
      }
      return;
    case "actionCardGroup":
      if (content.title !== undefined) {
        assertString(content.title, `${elementLabel}.content.title`);
      }
      if (content.visualAid !== undefined) {
        assert(["icon", "badge", "divider", "accentStrip"].includes(content.visualAid as string), `${elementLabel}.content.visualAid must be icon, badge, divider, or accentStrip`);
      }
      if (content.layout !== undefined) {
        assert(["auto", "lead-grid", "grid"].includes(content.layout as string), `${elementLabel}.content.layout must be auto, lead-grid, or grid`);
      }
      if (content.iconPlacement !== undefined) {
        assert(["inline", "stacked", "none"].includes(content.iconPlacement as string), `${elementLabel}.content.iconPlacement must be inline, stacked, or none`);
      }
      if (content.densityClass !== undefined) {
        assert(["dense", "balanced", "airy"].includes(content.densityClass as string), `${elementLabel}.content.densityClass must be dense, balanced, or airy`);
      }
      if (content.columns !== undefined) {
        assert(typeof content.columns === "number" && Number.isFinite(content.columns) && content.columns > 0, `${elementLabel}.content.columns must be a positive number`);
      }
      assert(Array.isArray(content.items) && content.items.length >= 2 && content.items.length <= 6, `${elementLabel}.content.items must have 2 to 6 items`);
      content.items.forEach((item, index) => {
        assert(isPlainObject(item), `${elementLabel}.content.items[${index}] must be an object`);
        if (item.step !== undefined) {
          assertString(item.step, `${elementLabel}.content.items[${index}].step`);
        }
        if (item.eyebrow !== undefined) {
          assertString(item.eyebrow, `${elementLabel}.content.items[${index}].eyebrow`);
        }
        if (item.icon !== undefined) {
          assert(typeof item.icon === "string" && SUPPORTED_ICON_NAMES.includes(item.icon as (typeof SUPPORTED_ICON_NAMES)[number]), `${elementLabel}.content.items[${index}].icon must be a supported icon name`);
        }
        assertString(item.title, `${elementLabel}.content.items[${index}].title`);
        assertString(item.body, `${elementLabel}.content.items[${index}].body`);
        if (item.emphasis !== undefined) {
          assertString(item.emphasis, `${elementLabel}.content.items[${index}].emphasis`);
        }
        if (item.weight !== undefined) {
          assert(["lead", "regular", "compact"].includes(item.weight as string), `${elementLabel}.content.items[${index}].weight must be lead, regular, or compact`);
        }
        if (item.tone !== undefined) {
          assert(["default", "accent", "success", "warning", "neutral"].includes(item.tone as string), `${elementLabel}.content.items[${index}].tone must be default, accent, success, warning, or neutral`);
        }
      });
      return;
    case "objectiveBand":
      if (content.icon !== undefined) {
        assert(typeof content.icon === "string" && SUPPORTED_ICON_NAMES.includes(content.icon as (typeof SUPPORTED_ICON_NAMES)[number]), `${elementLabel}.content.icon must be a supported icon name`);
      }
      assertString(content.text, `${elementLabel}.content.text`);
      if (content.label !== undefined) {
        assertString(content.label, `${elementLabel}.content.label`);
      }
      if (content.emphasis !== undefined) {
        assertString(content.emphasis, `${elementLabel}.content.emphasis`);
      }
      if (content.densityClass !== undefined) {
        assert(["dense", "balanced", "airy"].includes(content.densityClass as string), `${elementLabel}.content.densityClass must be dense, balanced, or airy`);
      }
      if (content.tone !== undefined) {
        assert(["default", "accent", "success", "warning", "neutral"].includes(content.tone as string), `${elementLabel}.content.tone must be default, accent, success, warning, or neutral`);
      }
      return;
    case "pageBadge":
      assertString(content.value, `${elementLabel}.content.value`);
      if (content.label !== undefined) {
        assertString(content.label, `${elementLabel}.content.label`);
      }
      if (content.position !== undefined) {
        assert(["topRight", "bottomRight", "bottomLeft"].includes(content.position as string), `${elementLabel}.content.position must be topRight, bottomRight, or bottomLeft`);
      }
      if (content.tone !== undefined) {
        assert(["default", "accent", "success", "warning", "neutral"].includes(content.tone as string), `${elementLabel}.content.tone must be default, accent, success, warning, or neutral`);
      }
      return;
    case "timeline":
      assert(content.axis === undefined || content.axis === "vertical", `${elementLabel}.content.axis must be vertical when provided`);
      assert(Array.isArray(content.items) && content.items.length > 0, `${elementLabel}.content.items must be a non-empty array`);
      content.items.forEach((item, index) => {
        assert(isPlainObject(item), `${elementLabel}.content.items[${index}] must be an object`);
        assertString(item.title, `${elementLabel}.content.items[${index}].title`);
        if (item.body !== undefined) {
          assertString(item.body, `${elementLabel}.content.items[${index}].body`);
        }
        if (item.meta !== undefined) {
          assertString(item.meta, `${elementLabel}.content.items[${index}].meta`);
        }
      });
      return;
    case "process":
      assert(content.axis === undefined || content.axis === "horizontal" || content.axis === "vertical", `${elementLabel}.content.axis must be horizontal or vertical when provided`);
      assert(Array.isArray(content.items) && content.items.length > 0, `${elementLabel}.content.items must be a non-empty array`);
      content.items.forEach((item, index) => {
        assert(isPlainObject(item), `${elementLabel}.content.items[${index}] must be an object`);
        assertString(item.title, `${elementLabel}.content.items[${index}].title`);
        if (item.body !== undefined) {
          assertString(item.body, `${elementLabel}.content.items[${index}].body`);
        }
        if (item.meta !== undefined) {
          assertString(item.meta, `${elementLabel}.content.items[${index}].meta`);
        }
        if (item.tag !== undefined) {
          assertString(item.tag, `${elementLabel}.content.items[${index}].tag`);
        }
      });
      return;
    case "comparison":
      assert(content.layout === undefined || content.layout === "split" || content.layout === "stack", `${elementLabel}.content.layout must be split or stack when provided`);
      for (const sideKey of ["left", "right"] as const) {
        const side = content[sideKey];
        assert(isPlainObject(side), `${elementLabel}.content.${sideKey} must be an object`);
        assertString(side.title, `${elementLabel}.content.${sideKey}.title`);
        if (side.body !== undefined) {
          assertString(side.body, `${elementLabel}.content.${sideKey}.body`);
        }
        if (side.badge !== undefined) {
          assertString(side.badge, `${elementLabel}.content.${sideKey}.badge`);
        }
        if (side.bullets !== undefined) {
          assert(Array.isArray(side.bullets) && side.bullets.length > 0, `${elementLabel}.content.${sideKey}.bullets must be a non-empty array`);
          side.bullets.forEach((item, index) => assertString(item, `${elementLabel}.content.${sideKey}.bullets[${index}]`));
        }
      }
      if (content.conclusion !== undefined) {
        assertString(content.conclusion, `${elementLabel}.content.conclusion`);
      }
      return;
    case "insight":
      assertString(content.title, `${elementLabel}.content.title`);
      assertString(content.text, `${elementLabel}.content.text`);
      if (content.emphasis !== undefined) {
        assertString(content.emphasis, `${elementLabel}.content.emphasis`);
      }
      if (content.attribution !== undefined) {
        assertString(content.attribution, `${elementLabel}.content.attribution`);
      }
      if (content.tone !== undefined) {
        assert(["default", "accent", "success", "warning", "neutral"].includes(content.tone as string), `${elementLabel}.content.tone must be default, accent, success, warning, or neutral`);
      }
      return;
    case "matrix":
      if (content.xAxisTitle !== undefined) {
        assertString(content.xAxisTitle, `${elementLabel}.content.xAxisTitle`);
      }
      if (content.yAxisTitle !== undefined) {
        assertString(content.yAxisTitle, `${elementLabel}.content.yAxisTitle`);
      }
      if (content.centerLabel !== undefined) {
        assertString(content.centerLabel, `${elementLabel}.content.centerLabel`);
      }
      assert(Array.isArray(content.quadrants) && content.quadrants.length > 0, `${elementLabel}.content.quadrants must be a non-empty array`);
      content.quadrants.forEach((quadrant, index) => {
        assert(isPlainObject(quadrant), `${elementLabel}.content.quadrants[${index}] must be an object`);
        assert(["topLeft", "topRight", "bottomLeft", "bottomRight"].includes(String(quadrant.position)), `${elementLabel}.content.quadrants[${index}].position must be a valid quadrant`);
        assertString(quadrant.title, `${elementLabel}.content.quadrants[${index}].title`);
        if (quadrant.body !== undefined) {
          assertString(quadrant.body, `${elementLabel}.content.quadrants[${index}].body`);
        }
        if (quadrant.badge !== undefined) {
          assertString(quadrant.badge, `${elementLabel}.content.quadrants[${index}].badge`);
        }
        if (quadrant.tone !== undefined) {
          assert(["default", "accent", "success", "warning", "neutral"].includes(quadrant.tone as string), `${elementLabel}.content.quadrants[${index}].tone must be default, accent, success, warning, or neutral`);
        }
      });
      return;
    case "miniDiagram":
      assert(["sequence", "hub", "layers"].includes(String(content.layout)), `${elementLabel}.content.layout must be sequence, hub, or layers`);
      if (content.title !== undefined) {
        assertString(content.title, `${elementLabel}.content.title`);
      }
      assert(Array.isArray(content.nodes) && content.nodes.length >= 2 && content.nodes.length <= 5, `${elementLabel}.content.nodes must have 2 to 5 items`);
      content.nodes.forEach((node, index) => {
        assert(isPlainObject(node), `${elementLabel}.content.nodes[${index}] must be an object`);
        assertString(node.title, `${elementLabel}.content.nodes[${index}].title`);
        if (node.body !== undefined) {
          assertString(node.body, `${elementLabel}.content.nodes[${index}].body`);
        }
        if (node.icon !== undefined) {
          assert(typeof node.icon === "string" && SUPPORTED_ICON_NAMES.includes(node.icon as (typeof SUPPORTED_ICON_NAMES)[number]), `${elementLabel}.content.nodes[${index}].icon must be a supported icon name`);
        }
        if (node.tone !== undefined) {
          assert(["default", "accent", "success", "warning", "neutral"].includes(node.tone as string), `${elementLabel}.content.nodes[${index}].tone must be default, accent, success, warning, or neutral`);
        }
      });
      return;
    case "summaryBand":
      assertString(content.title, `${elementLabel}.content.title`);
      assert(Array.isArray(content.items) && content.items.length > 0, `${elementLabel}.content.items must be a non-empty array`);
      content.items.forEach((item, index) => assertString(item, `${elementLabel}.content.items[${index}]`));
      if (content.emphasis !== undefined) {
        assertString(content.emphasis, `${elementLabel}.content.emphasis`);
      }
      if (content.tone !== undefined) {
        assert(["default", "accent", "success", "warning", "neutral"].includes(content.tone as string), `${elementLabel}.content.tone must be default, accent, success, warning, or neutral`);
      }
      return;
    case "funnel":
      if (content.title !== undefined) {
        assertString(content.title, `${elementLabel}.content.title`);
      }
      assert(Array.isArray(content.stages) && content.stages.length >= 3 && content.stages.length <= 5, `${elementLabel}.content.stages must have 3 to 5 items`);
      content.stages.forEach((stage, index) => {
        assert(isPlainObject(stage), `${elementLabel}.content.stages[${index}] must be an object`);
        assertString(stage.title, `${elementLabel}.content.stages[${index}].title`);
        if (stage.body !== undefined) {
          assertString(stage.body, `${elementLabel}.content.stages[${index}].body`);
        }
        if (stage.value !== undefined) {
          assertString(stage.value, `${elementLabel}.content.stages[${index}].value`);
        }
        if (stage.note !== undefined) {
          assertString(stage.note, `${elementLabel}.content.stages[${index}].note`);
        }
        if (stage.tone !== undefined) {
          assert(["default", "accent", "success", "warning", "neutral"].includes(stage.tone as string), `${elementLabel}.content.stages[${index}].tone must be default, accent, success, warning, or neutral`);
        }
      });
      return;
    case "swimlane":
      if (content.title !== undefined) {
        assertString(content.title, `${elementLabel}.content.title`);
      }
      assert(Array.isArray(content.lanes) && content.lanes.length >= 2 && content.lanes.length <= 4, `${elementLabel}.content.lanes must have 2 to 4 items`);
      content.lanes.forEach((lane, index) => {
        assert(isPlainObject(lane), `${elementLabel}.content.lanes[${index}] must be an object`);
        assertString(lane.title, `${elementLabel}.content.lanes[${index}].title`);
        if (lane.badge !== undefined) {
          assertString(lane.badge, `${elementLabel}.content.lanes[${index}].badge`);
        }
        if (lane.tone !== undefined) {
          assert(["default", "accent", "success", "warning", "neutral"].includes(lane.tone as string), `${elementLabel}.content.lanes[${index}].tone must be default, accent, success, warning, or neutral`);
        }
        assert(Array.isArray(lane.steps) && lane.steps.length >= 2 && lane.steps.length <= 5, `${elementLabel}.content.lanes[${index}].steps must have 2 to 5 items`);
        lane.steps.forEach((step, innerIndex) => assertString(step, `${elementLabel}.content.lanes[${index}].steps[${innerIndex}]`));
      });
      return;
    case "chart":
      assert(["donut", "bar", "progress"].includes(String(content.chartType)), `${elementLabel}.content.chartType must be donut, bar, or progress`);
      if (content.title !== undefined) {
        assertString(content.title, `${elementLabel}.content.title`);
      }
      if (content.centerText !== undefined) {
        assertString(content.centerText, `${elementLabel}.content.centerText`);
      }
      if (content.showLegend !== undefined) {
        assert(typeof content.showLegend === "boolean", `${elementLabel}.content.showLegend must be a boolean`);
      }
      if (content.maxValue !== undefined) {
        assert(typeof content.maxValue === "number" && Number.isFinite(content.maxValue) && content.maxValue > 0, `${elementLabel}.content.maxValue must be a positive number`);
      }
      assert(Array.isArray(content.segments) && content.segments.length > 0, `${elementLabel}.content.segments must be a non-empty array`);
      content.segments.forEach((segment, index) => {
        assert(isPlainObject(segment), `${elementLabel}.content.segments[${index}] must be an object`);
        assertString(segment.label, `${elementLabel}.content.segments[${index}].label`);
        assert(typeof segment.value === "number" && Number.isFinite(segment.value) && segment.value > 0, `${elementLabel}.content.segments[${index}].value must be a positive number`);
        if (segment.color !== undefined) {
          assertColor(segment.color, `${elementLabel}.content.segments[${index}].color`);
        }
        if (segment.note !== undefined) {
          assertString(segment.note, `${elementLabel}.content.segments[${index}].note`);
        }
      });
      return;
    case "shape":
      assert(content.shape === "rect", `${elementLabel}.content.shape must be rect`);
      return;
    case "line":
    case "divider":
      assert(["horizontal", "vertical"].includes(content.direction as string), `${elementLabel}.content.direction must be horizontal or vertical`);
      return;
    case "svg":
      validateSvgMarkup(content.svg, `${elementLabel}.content.svg`);
      assertString(content.description, `${elementLabel}.content.description`);
      return;
    case "icon":
      assert(
        typeof content.name === "string" && SUPPORTED_ICON_NAMES.includes(content.name as (typeof SUPPORTED_ICON_NAMES)[number]),
        `${elementLabel}.content.name must be one of: ${SUPPORTED_ICON_NAMES.join(", ")}`
      );
      return;
    case "grid": {
      const header = content.header;
      assert(Array.isArray(header) && header.length > 0, `${elementLabel}.content.header must be a non-empty array`);
      header.forEach((item, index) => assertString(item, `${elementLabel}.content.header[${index}]`));
      assert(Array.isArray(content.rows) && content.rows.length > 0, `${elementLabel}.content.rows must be a non-empty array`);
      content.rows.forEach((row, rowIndex) => {
        assert(Array.isArray(row), `${elementLabel}.content.rows[${rowIndex}] must be an array`);
        assert(row.length === header.length, `${elementLabel}.content.rows[${rowIndex}] must match header length`);
        row.forEach((cell, cellIndex) => assertString(cell, `${elementLabel}.content.rows[${rowIndex}][${cellIndex}]`));
      });
      if (content.columnWidths !== undefined) {
        assert(Array.isArray(content.columnWidths), `${elementLabel}.content.columnWidths must be an array`);
        assert(content.columnWidths.length === header.length, `${elementLabel}.content.columnWidths must match header length`);
        content.columnWidths.forEach((width, index) => {
          assert(typeof width === "number" && width > 0, `${elementLabel}.content.columnWidths[${index}] must be a positive number`);
        });
      }
      return;
    }
    case "connector":
      assert(Array.isArray(content.targets) && content.targets.length >= 2, `${elementLabel}.content.targets must have at least two ids`);
      content.targets.forEach((target, index) => assertString(target, `${elementLabel}.content.targets[${index}]`));
      if (content.lineStyle !== undefined) {
        assert(["solid", "dashed"].includes(content.lineStyle as string), `${elementLabel}.content.lineStyle must be solid or dashed`);
      }
      if (content.showDots !== undefined) {
        assert(typeof content.showDots === "boolean", `${elementLabel}.content.showDots must be a boolean`);
      }
      if (content.routing !== undefined) {
        assert(["auto", "chain", "bus"].includes(content.routing as string), `${elementLabel}.content.routing must be auto, chain, or bus`);
      }
      if (content.anchor !== undefined) {
        assert(["center", "top", "bottom"].includes(content.anchor as string), `${elementLabel}.content.anchor must be center, top, or bottom`);
      }
      return;
    case "section":
      assert(Array.isArray(content.headerIds), `${elementLabel}.content.headerIds must be an array`);
      content.headerIds.forEach((id, index) => assertString(id, `${elementLabel}.content.headerIds[${index}]`));
      assert(Array.isArray(content.bodyIds), `${elementLabel}.content.bodyIds must be an array`);
      content.bodyIds.forEach((id, index) => assertString(id, `${elementLabel}.content.bodyIds[${index}]`));
      for (const key of ["topPadding", "gap", "headerGap"] as const) {
        const value = content[key];
        if (value !== undefined) {
          assert(typeof value === "number" && value >= 0, `${elementLabel}.content.${key} must be a non-negative number`);
        }
      }
      return;
    case "cardGroup":
      assert(Array.isArray(content.items) && content.items.length > 0, `${elementLabel}.content.items must be a non-empty array`);
      content.items.forEach((item, index) => {
        assert(isPlainObject(item), `${elementLabel}.content.items[${index}] must be an object`);
        assertString(item.containerId, `${elementLabel}.content.items[${index}].containerId`);
        for (const listKey of ["iconIds", "titleIds", "bodyIds"] as const) {
          const list = item[listKey];
          if (list !== undefined) {
            assert(Array.isArray(list), `${elementLabel}.content.items[${index}].${listKey} must be an array`);
            list.forEach((id, innerIndex) => assertString(id, `${elementLabel}.content.items[${index}].${listKey}[${innerIndex}]`));
          }
        }
      });
      for (const key of ["columns", "gap", "paddingX", "paddingY"] as const) {
        const value = content[key];
        if (value !== undefined) {
          assert(typeof value === "number" && value >= 0, `${elementLabel}.content.${key} must be a non-negative number`);
        }
      }
      return;
    default:
      throw new Error(`${elementLabel}.type is not supported`);
  }
}

function validateElement(element: unknown, index: number, slideWidth: number, slideHeight: number): asserts element is SceneElement {
  const elementLabel = `slide.elements[${index}]`;
  assert(isPlainObject(element), `${elementLabel} must be an object`);

  assertString(element.id, `${elementLabel}.id`);
  assertString(element.role, `${elementLabel}.role`);
  assert(
    typeof element.type === "string" && SUPPORTED_ELEMENT_TYPES.includes(element.type as (typeof SUPPORTED_ELEMENT_TYPES)[number]),
    `${elementLabel}.type must be one of: ${SUPPORTED_ELEMENT_TYPES.join(", ")}`
  );

  assertInteger(element.x, `${elementLabel}.x`);
  assertInteger(element.y, `${elementLabel}.y`);
  assertInteger(element.w, `${elementLabel}.w`);
  assertInteger(element.h, `${elementLabel}.h`);
  assertInteger(element.zIndex, `${elementLabel}.zIndex`);
  assert(element.w > 0 && element.h > 0, `${elementLabel}.w and ${elementLabel}.h must be greater than 0`);
  assert(element.x >= 0 && element.y >= 0, `${elementLabel}.x and ${elementLabel}.y must be non-negative`);
  assert(element.x + element.w <= slideWidth, `${elementLabel} exceeds slide width`);
  assert(element.y + element.h <= slideHeight, `${elementLabel} exceeds slide height`);

  validateStyle(element.style, elementLabel);
  validateContent(element, elementLabel);
}

export function validateSceneGraph(value: unknown): SceneGraph {
  assert(isPlainObject(value), "Input root must be an object");
  assert(
    typeof value.version === "string" && SUPPORTED_VERSIONS.includes(value.version as (typeof SUPPORTED_VERSIONS)[number]),
    `version must be one of: ${SUPPORTED_VERSIONS.join(", ")}`
  );
  assert(isPlainObject(value.slide), "slide must be an object");

  const { slide } = value;
  assertString(slide.id, "slide.id");
  assertInteger(slide.width, "slide.width");
  assertInteger(slide.height, "slide.height");
  const slideWidth = slide.width;
  const slideHeight = slide.height;
  assert(
    isSupportedCanvasSize(slideWidth, slideHeight),
    `slide size must be ${SLIDE_WIDTH}x${SLIDE_HEIGHT}; legacy 1600x900 is accepted only for historical exports`,
  );

  assert(isPlainObject(slide.background), "slide.background must be an object");
  assert(slide.background.type === "solid", "slide.background.type must be solid");
  assertColor(slide.background.color, "slide.background.color");

  assert(isPlainObject(slide.theme), "slide.theme must be an object");
  assertString(slide.theme.fontFamily, "slide.theme.fontFamily");
  assertColor(slide.theme.titleColor, "slide.theme.titleColor");
  assertColor(slide.theme.textColor, "slide.theme.textColor");
  assertColor(slide.theme.accentColor, "slide.theme.accentColor");

  assert(Array.isArray(slide.elements), "slide.elements must be an array");
  slide.elements.forEach((element, index) => validateElement(element, index, slideWidth, slideHeight));

  return value as SceneGraph;
}


