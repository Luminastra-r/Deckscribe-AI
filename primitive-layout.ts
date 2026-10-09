import { type ActionCardGroupContent } from "./types.ts";

export type ActionCardLayoutSlot = {
  itemIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  weight: "lead" | "regular" | "compact";
};

export type ActionCardGroupLayout = {
  padding: number;
  gap: number;
  titleHeight: number;
  slots: ActionCardLayoutSlot[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveItemWeight(
  content: ActionCardGroupContent,
  itemIndex: number,
): "lead" | "regular" | "compact" {
  const explicit = content.items[itemIndex]?.weight;
  if (explicit === "lead" || explicit === "regular" || explicit === "compact") {
    return explicit;
  }

  if ((content.layout === "auto" || content.layout === "lead-grid" || content.layout === undefined) && itemIndex === 0 && content.items.length >= 4) {
    return "lead";
  }

  return "regular";
}

export function computeActionCardGroupLayout(
  content: ActionCardGroupContent,
  frame: { w: number; h: number },
): ActionCardGroupLayout {
  const denseMode = content.densityClass === "dense" || content.items.length >= 5;
  const padding = denseMode ? 16 : 18;
  const gap = denseMode ? 14 : content.items.length >= 5 ? 16 : 18;
  const titleHeight = content.title ? 28 : 0;
  const titleGap = content.title ? 12 : 0;
  const innerX = padding;
  const innerY = padding + titleHeight + titleGap;
  const innerW = Math.max(120, frame.w - padding * 2);
  const innerH = Math.max(120, frame.h - padding * 2 - titleHeight - titleGap);
  const itemCount = Math.max(1, content.items.length);
  const slots: ActionCardLayoutSlot[] = [];
  const leadIndex = content.items.findIndex((item) => item.weight === "lead");
  const autoLeadIndex = leadIndex >= 0 ? leadIndex : resolveItemWeight(content, 0) === "lead" ? 0 : -1;
  const allowLeadLayout = autoLeadIndex === 0 && itemCount >= 4 && innerW >= 560 && (content.layout ?? "auto") !== "grid" && !denseMode;

  if (allowLeadLayout) {
    const topRowH = Math.max(140, Math.round(innerH * (itemCount >= 5 ? 0.48 : 0.54)));
    const bottomRowH = Math.max(110, innerH - topRowH - gap);
    const topColW = Math.floor((innerW - gap * 2) / 3);
    const leadW = topColW * 2 + gap;

    slots.push({
      itemIndex: 0,
      x: innerX,
      y: innerY,
      w: leadW,
      h: topRowH,
      weight: "lead",
    });

    if (itemCount >= 2) {
      slots.push({
        itemIndex: 1,
        x: innerX + leadW + gap,
        y: innerY,
        w: innerW - leadW - gap,
        h: topRowH,
        weight: resolveItemWeight(content, 1),
      });
    }

    const remaining = itemCount - 2;
    if (remaining > 0) {
      const cardW = Math.floor((innerW - gap * Math.max(0, remaining - 1)) / remaining);
      for (let index = 0; index < remaining; index += 1) {
        slots.push({
          itemIndex: index + 2,
          x: innerX + index * (cardW + gap),
          y: innerY + topRowH + gap,
          w: cardW,
          h: bottomRowH,
          weight: resolveItemWeight(content, index + 2),
        });
      }
    }

    return { padding, gap, titleHeight, slots };
  }

  const defaultColumns = denseMode
    ? itemCount >= 5 ? 2 : itemCount >= 3 ? 2 : itemCount
    : itemCount >= 5 ? 3 : itemCount >= 3 ? 2 : itemCount;
  const columns = clamp(content.columns ?? defaultColumns, 1, denseMode ? 2 : 3);
  const rows = Math.ceil(itemCount / columns);
  const itemW = Math.floor((innerW - gap * (columns - 1)) / columns);
  const itemH = Math.floor((innerH - gap * (rows - 1)) / rows);

  for (let index = 0; index < itemCount; index += 1) {
    const row = Math.floor(index / columns);
    const col = index % columns;
    slots.push({
      itemIndex: index,
      x: innerX + col * (itemW + gap),
      y: innerY + row * (itemH + gap),
      w: itemW,
      h: itemH,
      weight: resolveItemWeight(content, index),
    });
  }

  return { padding, gap, titleHeight, slots };
}
