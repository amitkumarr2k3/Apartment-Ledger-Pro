# Responsive Regression Checklist — PortalShell

The header packs a lot: hamburger, req-ID badge, search, MODE toggle, period select,
view toggle, print/export. Small viewport changes have historically caused
overlap. Run this checklist (or the automated script) before shipping any
change to `src/components/portal-shell.tsx`.

## Automated

```bash
# Dev server running at :8090
bun scripts/responsive-check.mjs
```

Screenshots land in `/tmp/responsive-check/<width>/<route>.png` and a
`checks.json` summary flags any route whose `<header>` or `<body>` has
horizontal overflow. Exit code is non-zero on failure so this can be wired
into CI.

Widths covered: **320, 360, 390, 480, 640, 768, 900, 1024, 1280, 1440**.
Routes covered: index + all 10 prototype screens (Resident + Admin).

## Manual checklist

For each width below, load `/resident/overview` **and** `/admin/actions`
and confirm:

| Width  | Expected header layout                                                              |
| ------ | ----------------------------------------------------------------------------------- |
| 320 px | Hamburger + req-ID + period + view toggle only. MODE row on its own line below.     |
| 360 px | Same as 320. Section `<Select>` full-width. No horizontal scroll on `<body>`.       |
| 390 px | Same as above. Print/Export buttons appear in the mobile action row.                |
| 480 px | Search button still hidden. Persona toggle still on its own row.                    |
| 640 px | Tabs row appears (may scroll horizontally). Icon-only Export/Print in header.       |
| 768 px | MODE "Mode" labelled persona toggle visible in header. Sidebar still hidden.        |
| 900 px | Same as 768. Verify no overlap between MODE pill and period select.                 |
| 1024 px| Sidebar visible. Header MODE toggle **gone** (sidebar owns persona switch).         |
| 1280 px| Full desktop layout. All controls fit on one row with breathing room.               |
| 1440 px| Same, generous whitespace. Tabs no longer scroll.                                   |

### What to look for
- No text clipped by ellipsis inside `<header>` (script asserts this).
- No horizontal page scroll (`document.scrollWidth > innerWidth`).
- Persona pill never overlaps the section title or tabs.
- Req-ID badge tooltip still opens on tap (mobile) and hover (desktop).
- Print button produces the `@media print` layout with the visible page title.

### When it fails
1. Re-check the offending width's screenshot in `/tmp/responsive-check/`.
2. Common fixes: add `shrink-0` to fixed-width controls, `min-w-0` on the
   text container, promote a control to the mobile action row, or bump the
   breakpoint at which the desktop variant kicks in.
3. Re-run `bun scripts/responsive-check.mjs` until clean.
