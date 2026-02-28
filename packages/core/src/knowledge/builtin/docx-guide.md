# DOCX Document Generation Guide (docx-js)

## Setup

```javascript
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
        Header, Footer, AlignmentType, PageOrientation, LevelFormat, ExternalHyperlink,
        InternalHyperlink, Bookmark, FootnoteReferenceRun, PositionalTab,
        PositionalTabAlignment, PositionalTabRelativeTo, PositionalTabLeader,
        TabStopType, TabStopPosition, Column, SectionType,
        TableOfContents, HeadingLevel, BorderStyle, WidthType, ShadingType,
        VerticalAlign, PageNumber, PageBreak } = require("docx");
const fs = require("fs");

const doc = new Document({
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },       // US Letter
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }  // 1" margins
      }
    },
    children: [/* content */]
  }]
});

Packer.toBuffer(doc).then(buffer => fs.writeFileSync("outputs/document.docx", buffer));
```

**Units**: DXA (1440 DXA = 1 inch). US Letter: 12240 x 15840. A4: 11906 x 16838. Content width (1" margins): 9360 DXA.

**Landscape**: Pass portrait dimensions, set `orientation: PageOrientation.LANDSCAPE` -- docx-js swaps internally.

## Styles

```javascript
const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 24 } } },  // 12pt (size in half-points)
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 180, after: 180 }, outlineLevel: 1 } },
    ]
  },
  sections: [{ children: [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Title")] })
  ]}]
});
```

Use exact style IDs (`"Heading1"`, `"Heading2"`) to override built-in styles. Include `outlineLevel` for TOC support.

## Text

```javascript
// Basic paragraph
new Paragraph({ children: [new TextRun({ text: "Hello", bold: true, size: 24 })] })

// Aligned
new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun("Centered text")]
})

// Spacing
new Paragraph({
  spacing: { before: 240, after: 120 },  // DXA
  children: [new TextRun("Spaced paragraph")]
})
```

## Lists

```javascript
// NEVER use unicode bullets. Use numbering config.
const doc = new Document({
  numbering: {
    config: [
      { reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbers",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ]
  },
  sections: [{
    children: [
      new Paragraph({ numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Bullet item")] }),
      new Paragraph({ numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Numbered item")] }),
    ]
  }]
});
```

Same `reference` = continues numbering. Different `reference` = restarts.

## Tables

Tables need dual widths: `columnWidths` on the table AND `width` on each cell.

```javascript
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };

new Table({
  width: { size: 9360, type: WidthType.DXA },    // Full content width
  columnWidths: [4680, 4680],                      // Must sum to table width
  rows: [
    new TableRow({
      children: [
        new TableCell({
          borders,
          width: { size: 4680, type: WidthType.DXA },  // Must match columnWidth
          shading: { fill: "D5E8F0", type: ShadingType.CLEAR },  // CLEAR not SOLID
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun("Cell content")] })]
        }),
        new TableCell({
          borders,
          width: { size: 4680, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun("Cell 2")] })]
        })
      ]
    })
  ]
})
```

**Always use `WidthType.DXA`** -- `WidthType.PERCENTAGE` breaks in Google Docs.

## Images

```javascript
new Paragraph({
  children: [new ImageRun({
    type: "png",                    // Required: png, jpg, jpeg, gif, bmp, svg
    data: fs.readFileSync("image.png"),
    transformation: { width: 200, height: 150 },  // pixels
    altText: { title: "Title", description: "Desc", name: "Name" }  // All three required
  })]
})
```

## Page Breaks

```javascript
new Paragraph({ children: [new PageBreak()] })
// Or
new Paragraph({ pageBreakBefore: true, children: [new TextRun("New page")] })
```

## Hyperlinks

```javascript
// External
new Paragraph({
  children: [new ExternalHyperlink({
    children: [new TextRun({ text: "Click here", style: "Hyperlink" })],
    link: "https://example.com",
  })]
})

// Internal (bookmark + reference)
new Paragraph({ children: [
  new Bookmark({ id: "section1", children: [new TextRun("Section 1")] })
]})
new Paragraph({ children: [new InternalHyperlink({
  children: [new TextRun({ text: "See Section 1", style: "Hyperlink" })],
  anchor: "section1",
})]})
```

## Footnotes

```javascript
const doc = new Document({
  footnotes: {
    1: { children: [new Paragraph("Source: Annual Report 2024")] },
  },
  sections: [{
    children: [new Paragraph({
      children: [new TextRun("Revenue grew 15%"), new FootnoteReferenceRun(1)]
    })]
  }]
});
```

## Tab Stops

```javascript
// Right-aligned text on same line
new Paragraph({
  children: [new TextRun("Left text"), new TextRun("\tRight text")],
  tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
})

// Dot leader (TOC-style)
new Paragraph({
  children: [
    new TextRun("Introduction"),
    new TextRun({ children: [
      new PositionalTab({
        alignment: PositionalTabAlignment.RIGHT,
        relativeTo: PositionalTabRelativeTo.MARGIN,
        leader: PositionalTabLeader.DOT,
      }),
      "3",
    ]}),
  ],
})
```

## Multi-Column Layouts

```javascript
sections: [{
  properties: {
    column: { count: 2, space: 720, equalWidth: true, separate: true }
  },
  children: [/* content flows across columns */]
}]
```

## Table of Contents

```javascript
new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" })
```

Headings must use `HeadingLevel` only -- no custom styles.

## Headers and Footers

```javascript
sections: [{
  headers: {
    default: new Header({ children: [new Paragraph({ children: [new TextRun("Header")] })] })
  },
  footers: {
    default: new Footer({ children: [new Paragraph({
      children: [new TextRun("Page "), new TextRun({ children: [PageNumber.CURRENT] })]
    })] })
  },
  children: [/* content */]
}]
```

## Critical Rules

1. **Set page size explicitly** -- defaults to A4, use US Letter (12240 x 15840) for US documents
2. **Never use `\n`** -- use separate `Paragraph` elements
3. **Never use unicode bullets** -- use `LevelFormat.BULLET` with numbering config
4. **`PageBreak` must be inside a `Paragraph`**
5. **`ImageRun` requires `type`** -- always specify png/jpg/etc
6. **Always use `WidthType.DXA`** for table widths -- never `PERCENTAGE`
7. **Tables need dual widths** -- `columnWidths` array AND cell `width`, both must match
8. **Table width = sum of columnWidths**
9. **Always add cell margins** -- `{ top: 80, bottom: 80, left: 120, right: 120 }`
10. **Use `ShadingType.CLEAR`** -- never `SOLID` for table shading
11. **Never use tables as dividers** -- use `border` on Paragraph. For two-column footers, use tab stops
12. **TOC requires `HeadingLevel` only** -- no custom styles
13. **Override built-in styles** with exact IDs: `"Heading1"`, `"Heading2"`, etc.
14. **Include `outlineLevel`** in heading styles -- required for TOC (0=H1, 1=H2)
15. **Write output files to the `outputs/` directory**
