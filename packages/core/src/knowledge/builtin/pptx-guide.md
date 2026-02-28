# PptxGenJS Document Generation Guide

## Setup

```javascript
const pptxgen = require("pptxgenjs");

let pres = new pptxgen();
pres.layout = "LAYOUT_16x9"; // 10" x 5.625"
pres.author = "Author Name";
pres.title = "Presentation Title";

let slide = pres.addSlide();
// ... add content ...

// Write to outputs/ directory
pres.writeFile({ fileName: "outputs/presentation.pptx" });
```

Layouts: `LAYOUT_16x9` (10x5.625"), `LAYOUT_16x10` (10x6.25"), `LAYOUT_4x3` (10x7.5"), `LAYOUT_WIDE` (13.3x7.5")

## Text

```javascript
slide.addText("Title", {
  x: 1, y: 1, w: 8, h: 2,
  fontSize: 36, fontFace: "Arial", color: "363636",
  bold: true, align: "center", valign: "middle", margin: 0
});

// Rich text array
slide.addText([
  { text: "Bold ", options: { bold: true, breakLine: true } },
  { text: "Normal text", options: { fontSize: 14 } }
], { x: 0.5, y: 0.5, w: 8, h: 2 });

// Character spacing (NOT letterSpacing)
slide.addText("SPACED", { x: 1, y: 1, w: 8, h: 1, charSpacing: 6 });
```

Set `margin: 0` when aligning text with shapes/icons at the same position.

## Lists

```javascript
// Bullets -- use bullet:true, NEVER unicode "bullet" characters
slide.addText([
  { text: "First item", options: { bullet: true, breakLine: true } },
  { text: "Second item", options: { bullet: true, breakLine: true } },
  { text: "Sub-item", options: { bullet: true, indentLevel: 1 } }
], { x: 0.5, y: 0.5, w: 8, h: 3 });

// Numbered
{ text: "Step 1", options: { bullet: { type: "number" }, breakLine: true } }
```

## Shapes

```javascript
slide.addShape(pres.shapes.RECTANGLE, {
  x: 0.5, y: 0.8, w: 3, h: 2,
  fill: { color: "FF0000" },
  line: { color: "000000", width: 2 }
});

// Rounded rectangle
slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 1, y: 1, w: 3, h: 2,
  fill: { color: "FFFFFF" }, rectRadius: 0.1
});

// Line
slide.addShape(pres.shapes.LINE, {
  x: 1, y: 3, w: 5, h: 0,
  line: { color: "CCCCCC", width: 1, dashType: "dash" }
});

// Shadow (create fresh object per shape -- see pitfalls)
slide.addShape(pres.shapes.RECTANGLE, {
  x: 1, y: 1, w: 3, h: 2,
  fill: { color: "FFFFFF" },
  shadow: { type: "outer", color: "000000", blur: 6, offset: 2, angle: 135, opacity: 0.15 }
});
```

Shapes: `RECTANGLE`, `OVAL`, `LINE`, `ROUNDED_RECTANGLE`

Shadow: type ("outer"/"inner"), color (6-char hex), blur (0-100pt), offset (>=0), angle (0-359), opacity (0-1.0).

## Images

```javascript
// From file
slide.addImage({ path: "images/photo.png", x: 1, y: 1, w: 5, h: 3 });

// From base64 (preferred for generated content)
slide.addImage({ data: "image/png;base64,iVBOR...", x: 1, y: 1, w: 5, h: 3 });

// Sizing modes
{ sizing: { type: "contain", w: 4, h: 3 } }  // fit inside
{ sizing: { type: "cover", w: 4, h: 3 } }    // fill area
```

## Backgrounds

```javascript
slide.background = { color: "1E2761" };
slide.background = { color: "FF3399", transparency: 50 };
slide.background = { data: "image/png;base64,..." };
```

## Tables

```javascript
slide.addTable([
  [{ text: "Header", options: { fill: { color: "2E75B6" }, color: "FFFFFF", bold: true } }, "Col 2"],
  ["Cell 1", "Cell 2"]
], {
  x: 0.5, y: 1, w: 9, h: 2,
  border: { pt: 1, color: "CCCCCC" },
  colW: [4.5, 4.5]
});
```

## Charts

```javascript
// Bar chart
slide.addChart(pres.charts.BAR, [{
  name: "Sales", labels: ["Q1", "Q2", "Q3"], values: [100, 200, 300]
}], {
  x: 0.5, y: 1, w: 9, h: 4, barDir: "col",
  chartColors: ["0D9488", "14B8A6"],
  showValue: true, dataLabelPosition: "outEnd",
  valGridLine: { color: "E2E8F0", size: 0.5 },
  catGridLine: { style: "none" }
});

// Line chart
slide.addChart(pres.charts.LINE, [chartData], {
  x: 0.5, y: 1, w: 9, h: 4, lineSize: 3, lineSmooth: true
});

// Pie chart
slide.addChart(pres.charts.PIE, [chartData], {
  x: 1, y: 1, w: 5, h: 4, showPercent: true
});
```

Charts: `BAR`, `LINE`, `PIE`, `DOUGHNUT`, `SCATTER`, `BUBBLE`, `RADAR`

## Slide Masters

```javascript
pres.defineSlideMaster({
  title: "TITLE_SLIDE",
  background: { color: "1E2761" },
  objects: [{ placeholder: { options: { name: "title", type: "title", x: 1, y: 2, w: 8, h: 2 } } }]
});
let slide = pres.addSlide({ masterName: "TITLE_SLIDE" });
```

## Design Guidelines

### Color Palettes

Choose colors that match your topic. Never default to generic blue.

| Theme | Primary | Secondary | Accent |
|-------|---------|-----------|--------|
| Midnight Executive | `1E2761` | `CADCFC` | `FFFFFF` |
| Forest & Moss | `2C5F2D` | `97BC62` | `F5F5F5` |
| Coral Energy | `F96167` | `F9E795` | `2F3C7E` |
| Warm Terracotta | `B85042` | `E7E8D1` | `A7BEAE` |
| Ocean Gradient | `065A82` | `1C7293` | `21295C` |
| Charcoal Minimal | `36454F` | `F2F2F2` | `212121` |
| Teal Trust | `028090` | `00A896` | `02C39A` |
| Cherry Bold | `990011` | `FCF6F5` | `2F3C7E` |

**Dominance rule**: One color 60-70% visual weight, 1-2 supporting tones, one sharp accent.

### Typography

| Element | Size |
|---------|------|
| Slide title | 36-44pt bold |
| Section header | 20-24pt bold |
| Body text | 14-16pt |
| Captions | 10-12pt |

Font pairings: Georgia/Calibri, Arial Black/Arial, Trebuchet MS/Calibri, Palatino/Garamond.

### Layout Patterns

- **Two-column**: text left, visual right
- **Icon + text rows**: icon in colored circle, header, description
- **Grid**: 2x2 or 2x3 content blocks
- **Half-bleed image**: full left/right side with content overlay
- **Large stat callout**: big numbers (60-72pt) with small labels
- **Timeline/process flow**: numbered steps with arrows

### Spacing

- 0.5" minimum margins from slide edges
- 0.3-0.5" between content blocks
- Leave breathing room

## Critical Rules

1. **NEVER use "#" in hex colors** -- causes file corruption. Use `"FF0000"` not `"#FF0000"`
2. **NEVER encode opacity in color strings** -- 8-char hex corrupts files. Use `opacity` property
3. **NEVER use unicode bullets** -- use `bullet: true`. Unicode creates double bullets
4. **Use `breakLine: true`** between array text items
5. **Avoid `lineSpacing` with bullets** -- use `paraSpaceAfter` instead
6. **Each presentation needs a fresh `pptxgen()` instance**
7. **NEVER reuse option objects** -- PptxGenJS mutates them. Use factory functions:
   ```javascript
   const makeShadow = () => ({ type: "outer", blur: 6, offset: 2, color: "000000", opacity: 0.15 });
   slide.addShape(pres.shapes.RECTANGLE, { shadow: makeShadow(), ... });
   ```
8. **Don't use ROUNDED_RECTANGLE with accent borders** -- rectangular overlays won't cover corners
9. **Shadow offset must be non-negative** -- negative values corrupt the file
10. **Every slide needs a visual element** -- avoid text-only slides
11. **NEVER use accent lines under titles** -- hallmark of AI-generated slides
12. **Don't repeat the same layout** -- vary columns, cards, callouts
13. **Left-align body text** -- center only titles
14. **Write output files to the `outputs/` directory**
