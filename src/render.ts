import { type ElementStyle, type SceneElement, type SceneGraph } from "./types.ts";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toCssLength(value?: number): string | undefined {
  return value === undefined ? undefined : `${value}px`;
}

function toCssStyle(style: ElementStyle, fallbackTextColor: string): string {
  const entries: Array<[string, string | undefined]> = [
    ["font-size", toCssLength(style.fontSize)],
    ["font-weight", style.fontWeight?.toString()],
    ["line-height", style.lineHeight?.toString()],
    ["color", style.color ?? fallbackTextColor],
    ["background-color", style.backgroundColor],
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

function renderElement(element: SceneElement, graph: SceneGraph): string {
  const baseStyle = `${absoluteBoxStyle(element)};${toCssStyle(element.style, graph.slide.theme.textColor)}`;
  const attrs = `data-element-id="${escapeHtml(element.id)}" data-element-type="${escapeHtml(element.type)}" data-role="${escapeHtml(element.role)}"`;

  switch (element.type) {
    case "title":
      return `<div ${attrs} style="${baseStyle};color:${element.style.color ?? graph.slide.theme.titleColor};display:flex;align-items:flex-start;white-space:normal;word-break:break-word;">${escapeHtml(element.content.text)}</div>`;
    case "text":
      return `<div ${attrs} style="${baseStyle};white-space:normal;word-break:break-word;">${escapeHtml(element.content.text)}</div>`;
    case "bulletList": {
      const items = element.content.items
        .map((item) => `<li style="margin:0 0 12px 0;">${escapeHtml(item)}</li>`)
        .join("");
      return `<div ${attrs} style="${baseStyle};"><ul style="margin:0;padding-left:1.2em;">${items}</ul></div>`;
    }
    case "callout":
      return [
        `<div ${attrs} style="${baseStyle};display:flex;flex-direction:column;gap:16px;">`,
        `<div style="font-size:${Math.max((element.style.fontSize ?? 24) + 4, 18)}px;font-weight:700;color:${graph.slide.theme.titleColor};line-height:1.3;">${escapeHtml(element.content.title)}</div>`,
        `<div style="white-space:normal;word-break:break-word;">${escapeHtml(element.content.text)}</div>`,
        `</div>`,
      ].join("");
    case "shape":
      return `<div ${attrs} aria-hidden="true" style="${baseStyle};"></div>`;
    case "divider":
      return `<div ${attrs} aria-hidden="true" style="${baseStyle};"></div>`;
    default:
      return "";
  }
}

export function renderSceneGraphToHtml(graph: SceneGraph): string {
  const pageElements = [...graph.slide.elements]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((element) => renderElement(element, graph))
    .join("\n");

  const fontFamily = `${graph.slide.theme.fontFamily}, 'PingFang SC', 'Microsoft YaHei', sans-serif`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(graph.slide.id)}</title>
  <style>
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
      width: ${graph.slide.width}px;
      height: ${graph.slide.height}px;
      position: relative;
      overflow: hidden;
      background: ${graph.slide.background.color};
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.18);
    }
  </style>
</head>
<body>
  <main class="slide-stage" data-slide-id="${escapeHtml(graph.slide.id)}" data-scene-graph-version="${escapeHtml(graph.version)}">
${pageElements}
  </main>
</body>
</html>`;
}
