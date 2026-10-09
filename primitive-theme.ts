import { DEFAULT_WARM_ORANGE, type Theme } from "./types.ts";

export type PrimitiveTone = "default" | "accent" | "success" | "warning" | "neutral";

export type ResolvedThemeTokens = {
  preset: "legacyWarm" | "sunriseChrome" | "govBankWarmOrange";
  background: string;
  titleColor: string;
  textColor: string;
  mutedTextColor: string;
  accent: string;
  accentDark: string;
  accentStrong: string;
  accentSoft: string;
  accentLight: string;
  secondaryAccent: string;
  secondarySoft: string;
  goldAccent: string;
  goldSoft: string;
  neutralAccent: string;
  chromeLine: string;
  surfaceShadowBase: string;
  headerTextOnAccent: string;
  mutedHeaderText: string;
};

export type PrimitiveTonePalette = {
  cssFill: string;
  cssBorder: string;
  cssText: string;
  pptFill: string;
  pptFillTransparency: number;
  pptBorder: string;
  pptText: string;
  strongBackground: string;
  inverseText: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(color: string): [number, number, number] | null {
  const rgbMatch = color.trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+\s*)?\)$/i);
  if (rgbMatch) {
    return [
      clamp(Math.round(Number(rgbMatch[1])), 0, 255),
      clamp(Math.round(Number(rgbMatch[2])), 0, 255),
      clamp(Math.round(Number(rgbMatch[3])), 0, 255),
    ];
  }

  const match = color.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) {
    return null;
  }

  const hex = match[1].length === 3
    ? match[1].split("").map((char) => char + char).join("")
    : match[1];

  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function colorWithAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color);
  if (!rgb) {
    return color;
  }

  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamp(alpha, 0, 1)})`;
}

function normalizeColor(color: string): string {
  return color.replace(/^#/, "").toUpperCase();
}

function relativeLuminance(color: string): number {
  const rgb = hexToRgb(color);
  if (!rgb) {
    return 0;
  }

  const [r, g, b] = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

export function resolveReadableTextColor(
  background: string,
  preferred: string,
  options?: {
    fallbackDark?: string;
    fallbackLight?: string;
    minRatio?: number;
  },
): string {
  const fallbackDark = options?.fallbackDark ?? "#14213D";
  const fallbackLight = options?.fallbackLight ?? "#FFF9F4";
  const minRatio = options?.minRatio ?? 3.9;

  if (contrastRatio(preferred, background) >= minRatio) {
    return preferred;
  }

  const darkRatio = contrastRatio(fallbackDark, background);
  const lightRatio = contrastRatio(fallbackLight, background);
  return darkRatio >= lightRatio ? fallbackDark : fallbackLight;
}

export function resolveReadableBorderColor(
  background: string,
  preferred: string,
  accentFallback = "#D85A1F",
): string {
  if (contrastRatio(preferred, background) >= 1.45) {
    return preferred;
  }

  if (contrastRatio(accentFallback, background) >= 1.45) {
    return accentFallback;
  }

  return resolveReadableTextColor(background, preferred, {
    fallbackDark: "#C85C24",
    fallbackLight: "#FFF4EE",
    minRatio: 1.45,
  });
}

export function resolveThemeTokens(theme: Theme): ResolvedThemeTokens {
  const preset = theme.preset === "legacyWarm"
    ? "legacyWarm"
    : theme.preset === "govBankWarmOrange"
      ? "govBankWarmOrange"
      : "sunriseChrome";
  const accent = theme.accentColor;
  const accentDark = theme.accentDarkColor ?? (preset === "govBankWarmOrange" ? "#C73516" : "#9B3418");
  const accentStrong = theme.accentStrongColor ?? (preset === "govBankWarmOrange" ? DEFAULT_WARM_ORANGE.coral : accent);
  const accentSoft = theme.accentSoftColor ?? (
    preset === "legacyWarm" ? "#E8B9A3" : preset === "govBankWarmOrange" ? DEFAULT_WARM_ORANGE.surfaceWarm : "#F3B37A"
  );
  const accentLight = theme.accentLightColor ?? (
    preset === "govBankWarmOrange" ? DEFAULT_WARM_ORANGE.surfaceSoft : preset === "legacyWarm" ? "#F7F1EB" : "#FFF8F4"
  );
  const secondaryAccent = theme.secondaryAccentColor ?? (
    preset === "legacyWarm" ? "#6F7B8A" : preset === "govBankWarmOrange" ? "#2F5F86" : "#184E97"
  );
  const secondarySoft = theme.secondarySoftColor ?? (
    preset === "govBankWarmOrange" ? "#EEF4F8" : preset === "legacyWarm" ? "#EEF2F6" : "#F5F7FA"
  );
  const goldAccent = theme.goldAccentColor ?? (preset === "govBankWarmOrange" ? "#B8862B" : "#D8BA86");
  const goldSoft = theme.goldSoftColor ?? (preset === "govBankWarmOrange" ? "#FFF7E6" : "#FFF5D8");
  const neutralAccent = theme.neutralAccentColor ?? (
    preset === "legacyWarm" ? "#D8CDBE" : preset === "govBankWarmOrange" ? "#D8DEE8" : "#F4C95D"
  );
  const chromeLine = theme.chromeLineColor ?? (
    preset === "legacyWarm" ? "#D8CDBE" : preset === "govBankWarmOrange" ? DEFAULT_WARM_ORANGE.border : "#C9D1DC"
  );
  const surfaceShadowBase = theme.surfaceShadowColor ?? (
    preset === "legacyWarm" ? "#E4D5C9" : preset === "govBankWarmOrange" ? "#E9D7CF" : "#FFDCCB"
  );

  return {
    preset,
    background: "#FFFFFF",
    titleColor: theme.titleColor,
    textColor: theme.textColor,
    mutedTextColor: theme.mutedTextColor ?? "#667085",
    accent,
    accentDark,
    accentStrong,
    accentSoft,
    accentLight,
    secondaryAccent,
    secondarySoft,
    goldAccent,
    goldSoft,
    neutralAccent,
    chromeLine,
    surfaceShadowBase,
    headerTextOnAccent: "#FFF9F4",
    mutedHeaderText: preset === "govBankWarmOrange" ? accentDark : "#FFF0E6",
  };
}

export function resolvePrimitiveTonePalette(theme: Theme, tone: PrimitiveTone = "default"): PrimitiveTonePalette {
  const tokens = resolveThemeTokens(theme);
  const accent = tokens.accent;

  switch (tone) {
    case "accent":
      return {
        cssFill: tokens.preset === "govBankWarmOrange" ? tokens.accentSoft : colorWithAlpha(accent, tokens.preset === "legacyWarm" ? 0.12 : 0.1),
        cssBorder: tokens.preset === "govBankWarmOrange" ? colorWithAlpha(tokens.accentStrong, 0.34) : colorWithAlpha(accent, tokens.preset === "legacyWarm" ? 0.26 : 0.22),
        cssText: tokens.preset === "govBankWarmOrange" ? tokens.accentDark : accent,
        pptFill: normalizeColor(accent),
        pptFillTransparency: tokens.preset === "legacyWarm" ? 88 : 90,
        pptBorder: normalizeColor(accent),
        pptText: normalizeColor(tokens.preset === "govBankWarmOrange" ? tokens.accentDark : accent),
        strongBackground: normalizeColor(tokens.accent),
        inverseText: normalizeColor(tokens.accentLight),
      };
    case "success":
      return {
        cssFill: "#EDF8F2",
        cssBorder: "#8CC7B0",
        cssText: "#1B7F5A",
        pptFill: "EDF8F2",
        pptFillTransparency: 0,
        pptBorder: "8CC7B0",
        pptText: "1B7F5A",
        strongBackground: "1B7F5A",
        inverseText: "F7FCF9",
      };
    case "warning":
      return {
        cssFill: tokens.preset === "govBankWarmOrange" ? tokens.goldSoft : "#FFF1E8",
        cssBorder: tokens.preset === "govBankWarmOrange" ? "#D88900" : "#F2A68E",
        cssText: tokens.preset === "govBankWarmOrange" ? "#9C6B00" : "#9B3418",
        pptFill: tokens.preset === "govBankWarmOrange" ? "FFF7E6" : "FFF1E8",
        pptFillTransparency: 0,
        pptBorder: tokens.preset === "govBankWarmOrange" ? "D88900" : "F2A68E",
        pptText: tokens.preset === "govBankWarmOrange" ? "9C6B00" : "9B3418",
        strongBackground: tokens.preset === "govBankWarmOrange" ? "D88900" : "9B3418",
        inverseText: "FFFDF7",
      };
    case "neutral":
      return {
        cssFill: tokens.preset === "govBankWarmOrange" ? tokens.secondarySoft : colorWithAlpha(tokens.secondaryAccent, 0.08),
        cssBorder: tokens.preset === "govBankWarmOrange" ? colorWithAlpha(tokens.secondaryAccent, 0.22) : colorWithAlpha(tokens.secondaryAccent, 0.22),
        cssText: tokens.secondaryAccent,
        pptFill: normalizeColor(tokens.secondaryAccent),
        pptFillTransparency: tokens.preset === "govBankWarmOrange" ? 90 : 92,
        pptBorder: normalizeColor(tokens.secondaryAccent),
        pptText: normalizeColor(tokens.secondaryAccent),
        strongBackground: normalizeColor(tokens.secondaryAccent),
        inverseText: "F7FAFC",
      };
    default:
      return {
        cssFill: "#FFFFFF",
        cssBorder: tokens.preset === "legacyWarm" ? "#D9E0E8" : tokens.preset === "govBankWarmOrange" ? tokens.chromeLine : "#F1DDD4",
        cssText: theme.textColor,
        pptFill: "FFFFFF",
        pptFillTransparency: 0,
        pptBorder: tokens.preset === "legacyWarm" ? "D9E0E8" : tokens.preset === "govBankWarmOrange" ? normalizeColor(tokens.chromeLine) : "F1DDD4",
        pptText: normalizeColor(theme.textColor),
        strongBackground: normalizeColor(tokens.accent),
        inverseText: normalizeColor(tokens.accentLight),
      };
  }
}

export function colorWithAlphaCss(color: string, alpha: number): string {
  return colorWithAlpha(color, alpha);
}
