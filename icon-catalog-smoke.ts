import { strict as assert } from "node:assert";

import { renderIconSvg } from "./render.ts";
import { SUPPORTED_ICON_NAMES } from "./types.ts";

assert.equal(SUPPORTED_ICON_NAMES.length, 48, "curated icon catalog should expose exactly 48 ids");
assert.equal(new Set(SUPPORTED_ICON_NAMES).size, 48, "icon ids should be unique");

for (const name of SUPPORTED_ICON_NAMES) {
  const markup = renderIconSvg(name);
  assert.ok(markup.startsWith("<svg"), `${name} should render an svg root`);
  assert.ok(markup.endsWith("</svg>"), `${name} should close the svg root`);
  assert.ok(markup.includes("currentColor"), `${name} should inherit the selected theme color`);
  assert.ok(!/<(?:script|foreignObject|iframe|object|embed|image|text)[\s>]/i.test(markup), `${name} should contain only safe vector geometry`);
  assert.ok(!/\s(?:href|xlink:href|on[a-z]+)\s*=/i.test(markup), `${name} should not contain links or event handlers`);
}

for (const legacyName of ["target", "service", "building", "globe", "shield"] as const) {
  assert.ok(SUPPORTED_ICON_NAMES.includes(legacyName), `${legacyName} should remain backward compatible`);
}

console.log("icon catalog smoke ok");
