# Default PPTX-First Scene-Graph Prompt

Convert the provided single-slide PPT body into exactly one valid scene-graph JSON object. Return JSON only, with no Markdown or explanation.

Final output is an editable 16:9 PPTX. HTML is only a preview, so design with PPTX-native elements first: text boxes, shapes, lines, arrows, cards, simple charts, simple icons, tables, timelines, and solid color blocks.

Use a white 1600x900 canvas. Keep every element inside the slide. Preserve important facts, numbers, constraints, and action logic; reorganize visually when helpful, but do not invent content.

Prefer structures that export cleanly to PPTX. Avoid browser-only or unstable effects: complex CSS, filters, clip-path, foreignObject, raw/complex SVG, masks, external assets, raster-image fallbacks, complex gradients, scripts, and decorative effects that cannot remain editable.

Use deep gray body text instead of pure black. Use light backgrounds for information containers and maintain clear contrast.
