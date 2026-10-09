export const SUPPORTED_VERSION = "scene-graph/v0";
export const SLIDE_WIDTH = 1600;
export const SLIDE_HEIGHT = 900;

export const SUPPORTED_ELEMENT_TYPES = [
  "title",
  "text",
  "bulletList",
  "callout",
  "shape",
  "divider",
] as const;

export type ElementType = (typeof SUPPORTED_ELEMENT_TYPES)[number];

export type Background = {
  type: "solid";
  color: string;
};

export type Theme = {
  fontFamily: string;
  titleColor: string;
  textColor: string;
  accentColor: string;
};

export type ElementStyle = {
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  color?: string;
  backgroundColor?: string;
  borderRadius?: number;
  padding?: number;
  textAlign?: "left" | "center" | "right";
  opacity?: number;
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

export type ShapeContent = {
  shape: "rect";
};

export type DividerContent = {
  direction: "horizontal";
};

export type ElementContentMap = {
  title: TitleContent;
  text: TextContent;
  bulletList: BulletListContent;
  callout: CalloutContent;
  shape: ShapeContent;
  divider: DividerContent;
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
  | BaseElement<"title">
  | BaseElement<"text">
  | BaseElement<"bulletList">
  | BaseElement<"callout">
  | BaseElement<"shape">
  | BaseElement<"divider">;

export type Slide = {
  id: string;
  width: number;
  height: number;
  background: Background;
  theme: Theme;
  elements: SceneElement[];
};

export type SceneGraph = {
  version: typeof SUPPORTED_VERSION;
  slide: Slide;
};
