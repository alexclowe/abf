# ExcelJS Spreadsheet Generation Guide

## Setup

```javascript
const ExcelJS = require("exceljs");
const fs = require("fs");

const workbook = new ExcelJS.Workbook();
workbook.creator = "Author";
workbook.created = new Date();

const sheet = workbook.addWorksheet("Sheet1");

// ... add data, formatting, formulas ...

workbook.xlsx.writeFile("outputs/spreadsheet.xlsx");
```

## Worksheets

```javascript
// Add worksheet
const sheet = workbook.addWorksheet("Revenue", {
  properties: { defaultRowHeight: 15 },
  pageSetup: { paperSize: 9, orientation: "landscape" }  // 9 = A4
});

// Access existing
const sheet = workbook.getWorksheet("Revenue");

// Sheet properties
sheet.state = "visible";  // "visible", "hidden", "veryHidden"

// Freeze panes
sheet.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];  // Freeze row 1
```

## Rows and Cells

```javascript
// Add data row by row
sheet.addRow(["Name", "Revenue", "Growth"]);
sheet.addRow(["Product A", 50000, 0.15]);

// Access cells
const cell = sheet.getCell("B2");
cell.value = 50000;

// Access by row/column (1-indexed)
sheet.getRow(1).getCell(1).value = "Header";

// Set column widths
sheet.columns = [
  { header: "Name", key: "name", width: 25 },
  { header: "Revenue", key: "revenue", width: 15 },
  { header: "Growth", key: "growth", width: 12 },
];

// Row height
sheet.getRow(1).height = 25;
```

## Formatting

```javascript
// Font
cell.font = {
  name: "Arial", size: 12, bold: true, italic: false,
  color: { argb: "FF0000FF" }  // ARGB format (alpha + RGB)
};

// Fill (background color)
cell.fill = {
  type: "pattern", pattern: "solid",
  fgColor: { argb: "FFFFFF00" }  // Yellow background
};

// Alignment
cell.alignment = {
  horizontal: "center",  // "left", "center", "right"
  vertical: "middle",    // "top", "middle", "bottom"
  wrapText: true
};

// Borders
cell.border = {
  top: { style: "thin", color: { argb: "FFCCCCCC" } },
  bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
  left: { style: "thin", color: { argb: "FFCCCCCC" } },
  right: { style: "thin", color: { argb: "FFCCCCCC" } }
};
// Border styles: "thin", "medium", "thick", "dotted", "dashed", "double"

// Number formatting
cell.numFmt = "$#,##0";         // Currency
cell.numFmt = "0.0%";           // Percentage
cell.numFmt = "#,##0";          // Number with commas
cell.numFmt = "0.0x";           // Multiples
cell.numFmt = '$#,##0;($#,##0);"-"';  // Negative in parens, zero as dash
```

## Applying Styles to Ranges

```javascript
// Style a header row
const headerRow = sheet.getRow(1);
headerRow.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E75B6" } };
headerRow.alignment = { horizontal: "center" };
headerRow.height = 25;

// Style a column
sheet.getColumn("B").numFmt = "$#,##0";
sheet.getColumn("C").numFmt = "0.0%";

// Apply borders to a range
for (let row = 1; row <= 10; row++) {
  for (let col = 1; col <= 5; col++) {
    sheet.getRow(row).getCell(col).border = {
      top: { style: "thin" }, bottom: { style: "thin" },
      left: { style: "thin" }, right: { style: "thin" }
    };
  }
}
```

## Formulas

```javascript
// Simple formula
sheet.getCell("B10").value = { formula: "SUM(B2:B9)" };

// Formula with pre-calculated result (for display before recalc)
sheet.getCell("B10").value = { formula: "SUM(B2:B9)", result: 42000 };

// Cross-sheet reference
sheet.getCell("A1").value = { formula: "Revenue!B10" };

// Common formulas
sheet.getCell("C2").value = { formula: "(B2-B1)/B1" };           // Growth rate
sheet.getCell("D2").value = { formula: 'IF(C2>0,"Up","Down")' }; // Conditional
sheet.getCell("E1").value = { formula: "AVERAGE(B2:B13)" };      // Average
```

### Formula Rules

- **Always use formulas, never hardcode calculations** -- spreadsheets must be dynamic
- Place assumptions in dedicated cells, reference them in formulas
- Use `=B5*(1+$B$6)` not `=B5*1.05`
- Test formulas on 2-3 cells before applying broadly
- Check for division by zero in denominators
- Verify cross-sheet references use correct sheet names

## Merge Cells

```javascript
sheet.mergeCells("A1:D1");  // Merge range
sheet.getCell("A1").value = "Merged Title";
sheet.getCell("A1").alignment = { horizontal: "center" };
```

## Conditional Formatting

```javascript
sheet.addConditionalFormatting({
  ref: "C2:C20",
  rules: [
    {
      type: "cellIs", operator: "greaterThan", priority: 1,
      formulae: [0],
      style: { font: { color: { argb: "FF008000" } } }  // Green for positive
    },
    {
      type: "cellIs", operator: "lessThan", priority: 2,
      formulae: [0],
      style: { font: { color: { argb: "FFFF0000" } } }  // Red for negative
    }
  ]
});
```

## Data Validation

```javascript
sheet.getCell("B2").dataValidation = {
  type: "list",
  allowBlank: true,
  formulae: ['"Option1,Option2,Option3"']
};

sheet.getCell("C2").dataValidation = {
  type: "whole",
  operator: "between",
  formulae: [0, 100],
  showErrorMessage: true,
  errorTitle: "Invalid",
  error: "Enter a number between 0 and 100"
};
```

## Images

```javascript
const imageId = workbook.addImage({
  filename: "logo.png",
  extension: "png",
});

sheet.addImage(imageId, {
  tl: { col: 0, row: 0 },      // Top-left anchor
  br: { col: 2, row: 3 },      // Bottom-right anchor
});

// Or with exact positioning
sheet.addImage(imageId, {
  tl: { col: 0.5, row: 0.5 },
  ext: { width: 200, height: 100 }  // Pixels
});
```

## Print Setup

```javascript
sheet.pageSetup = {
  paperSize: 1,            // 1 = Letter, 9 = A4
  orientation: "landscape",
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 0,          // 0 = auto
  margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 }
};

// Print area
sheet.pageSetup.printArea = "A1:F20";

// Repeat header rows
sheet.pageSetup.printTitlesRow = "1:1";
```

## Financial Model Conventions

### Color Coding Standards

| Text Color | ARGB | Usage |
|------------|------|-------|
| Blue | `FF0000FF` | Hardcoded inputs, scenario variables |
| Black | `FF000000` | All formulas and calculations |
| Green | `FF008000` | Links from other worksheets |
| Red | `FFFF0000` | External links to other files |

| Background | ARGB | Usage |
|------------|------|-------|
| Yellow | `FFFFFF00` | Key assumptions needing attention |

### Number Format Standards

| Type | Format | Example |
|------|--------|---------|
| Currency | `$#,##0` | $1,234 |
| Currency (neg) | `$#,##0;($#,##0);"-"` | ($1,234) |
| Percentage | `0.0%` | 12.5% |
| Multiples | `0.0x` | 8.5x |
| Years | Text (not number) | "2024" |

### Model Structure

1. **Assumptions sheet** -- all inputs with blue text, yellow background for key items
2. **Calculations sheets** -- formulas only (black text), referencing assumptions
3. **Output/Summary sheet** -- key metrics, formatted for presentation
4. **Document sources** in comments: "Source: [System], [Date], [Reference]"

## Critical Rules

1. **ARGB format for colors** -- always 8 characters: `"FF" + RGB` (e.g., `"FFFF0000"` for red)
2. **Cell indices are 1-based** -- row 1, column 1 = cell A1
3. **Always set column widths** -- auto-width is unreliable
4. **Use formulas, not hardcoded values** -- spreadsheets must recalculate when data changes
5. **Years as text** -- format year columns as text to prevent `"2,024"` display
6. **Negative numbers in parentheses** -- use `$#,##0;($#,##0)` format
7. **Zeros as dashes** -- append `;"-"` to number format
8. **Professional font** -- use Arial consistently unless matching an existing template
9. **Freeze header rows** -- use `sheet.views` with `ySplit: 1`
10. **Write output files to the `outputs/` directory**
