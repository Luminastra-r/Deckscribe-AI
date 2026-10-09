import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  SUPPORTED_ELEMENT_TYPES,
  SUPPORTED_VERSION,
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
  "borderRadius",
  "padding",
  "textAlign",
  "opacity",
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

function validateStyle(style: unknown, elementLabel: string): asserts style is ElementStyle {
  assert(isPlainObject(style), `${elementLabel}.style must be an object`);

  for (const key of Object.keys(style)) {
    assert(STYLE_KEYS.has(key), `${elementLabel}.style.${key} is not supported`);
  }

  for (const numericKey of ["fontSize", "fontWeight", "lineHeight", "borderRadius", "padding", "opacity"] as const) {
    const value = style[numericKey];
    if (value !== undefined) {
      assert(typeof value === "number" && Number.isFinite(value), `${elementLabel}.style.${numericKey} must be a number`);
    }
  }

  for (const colorKey of ["color", "backgroundColor"] as const) {
    const value = style[colorKey];
    if (value !== undefined) {
      assertColor(value, `${elementLabel}.style.${colorKey}`);
    }
  }

  const textAlign = style.textAlign;
  if (textAlign !== undefined) {
    assert(["left", "center", "right"].includes(textAlign), `${elementLabel}.style.textAlign must be left, center, or right`);
  }
}

function validateContent(element: Record<string, unknown>, elementLabel: string): void {
  const content = element.content;
  assert(isPlainObject(content), `${elementLabel}.content must be an object`);

  switch (element.type) {
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
    case "shape":
      assert(content.shape === "rect", `${elementLabel}.content.shape must be rect`);
      return;
    case "divider":
      assert(content.direction === "horizontal", `${elementLabel}.content.direction must be horizontal`);
      return;
    default:
      throw new Error(`${elementLabel}.type is not supported`);
  }
}

function validateElement(element: unknown, index: number): asserts element is SceneElement {
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
  assert(element.x + element.w <= SLIDE_WIDTH, `${elementLabel} exceeds slide width`);
  assert(element.y + element.h <= SLIDE_HEIGHT, `${elementLabel} exceeds slide height`);

  validateStyle(element.style, elementLabel);
  validateContent(element, elementLabel);
}

export function validateSceneGraph(value: unknown): SceneGraph {
  assert(isPlainObject(value), "Input root must be an object");
  assert(value.version === SUPPORTED_VERSION, `version must be ${SUPPORTED_VERSION}`);
  assert(isPlainObject(value.slide), "slide must be an object");

  const { slide } = value;
  assertString(slide.id, "slide.id");
  assertInteger(slide.width, "slide.width");
  assertInteger(slide.height, "slide.height");
  assert(slide.width === SLIDE_WIDTH, `slide.width must be ${SLIDE_WIDTH}`);
  assert(slide.height === SLIDE_HEIGHT, `slide.height must be ${SLIDE_HEIGHT}`);

  assert(isPlainObject(slide.background), "slide.background must be an object");
  assert(slide.background.type === "solid", "slide.background.type must be solid");
  assertColor(slide.background.color, "slide.background.color");

  assert(isPlainObject(slide.theme), "slide.theme must be an object");
  assertString(slide.theme.fontFamily, "slide.theme.fontFamily");
  assertColor(slide.theme.titleColor, "slide.theme.titleColor");
  assertColor(slide.theme.textColor, "slide.theme.textColor");
  assertColor(slide.theme.accentColor, "slide.theme.accentColor");

  assert(Array.isArray(slide.elements), "slide.elements must be an array");
  slide.elements.forEach((element, index) => validateElement(element, index));

  return value as SceneGraph;
}
