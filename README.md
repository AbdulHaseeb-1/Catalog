# PSF Catalog Studio

Build pharmaceutical product catalogues on the phone and export them as clean,
print-ready PDFs. Everything is stored locally — nothing leaves the device
unless you share a PDF yourself.

## The model

Three things, and only three:

- **Companies** — a reference list of the manufacturers you carry, each with an
  optional address and phone.
- **Formulas** — a reference list of compositions (e.g. *Paracetamol 500mg*),
  shared across companies.
- **Products** — a company, a formula, and one pack shot. Nothing else.

Because a formula is shared, the same product library answers both
"everything this company makes" and "every brand of this formula".

## Generating a PDF

Four scopes, from the **PDF** tab or from any company / formula page:

| Scope | What you get |
| --- | --- |
| One company | That company's full range, one section |
| One formula | Every company's version of that formula |
| All companies | One labelled section per company |
| All formulas | One labelled section per formula |

Every document is assembled the same way:

1. **Cover** — brand logo, the catalogue title, and a line describing what is
   inside.
2. **Contents** — every section with its product count (multi-section
   catalogues only, paginated when the index is long).
3. **Section label** — a starting label introducing each company or formula,
   listing the formulas it covers (or the companies that market it).
4. **Image pages** — full-bleed grid of pack shots, auto-cropped to fill, with
   your own contact details in a box along the foot of every page.

Each of those four can be switched off per export.

### Your contact details

Set your name, address and phone once under **Settings → Your contact details**.
They print at the foot of every image page, whatever the catalogue covers, so
whoever receives the PDF knows who to call. A company's own address and phone —
entered when you add or edit it — appear on that company's label page instead.

### Ordering

A company's pack shots appear in the order you arrange them: open the company
and tap **Reorder products**, then drag a row by its handle. The order fills
each page left to right, top to bottom, and saves as you drop.

### Page setup

- **Images per page** — 1, 2, 3 or 4 per row, or a 2×2 grid.
- **Paper** — A4 or Letter.
- **Crop** — each product image can be cropped to the exact cell aspect of the
  layout you export with, so nothing important gets trimmed by the auto-crop.

## Quick start

```bash
npm install
npx expo start -c
```

Use Expo Go on a phone for the image picker, camera and PDF share sheet. On
web, export opens the browser print dialog — choose *Save as PDF*.

## Layout of the code

```
src/
  app/            expo-router routes (tabs, product, library, export)
  components/     shared UI: pickers, tiles, forms, sheets
  db/             SQLite schema, migrations and per-table repositories
  services/       image pipeline, catalog document builder, PDF export
  templates/      the printed document — cover, contents, labels, grids
  stores/         zustand library store (companies, formulas, products)
```

Built with Expo SDK 57, expo-router, expo-sqlite and expo-print.
