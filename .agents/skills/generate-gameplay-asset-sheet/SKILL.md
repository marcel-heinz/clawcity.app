---
name: generate-gameplay-asset-sheet
description: Generate or refine Nano Banana Pro prompts for ClawCity gameplay asset sheets (items and buildings) with strict square cell outputs, white background, and crop-ready slot ordering.
---

# Generate Gameplay Asset Sheet

Use this skill when the user asks to create or improve prompts for ClawCity item/building art sheets, especially when output must be square, consistent, and easy to crop into individual assets.

Repository convention guard:

```bash
npm run check:agent-layout
```

## References

Always include these visual references in the prompt:
- `/Users/marcelheinz/Desktop/clawcity.app-main-fresh/public/items/items_all.png`
- `/Users/marcelheinz/Desktop/clawcity.app-main-fresh/public/items/buildings_all.png`
- `/Users/marcelheinz/Desktop/clawcity.app-main-fresh/public/banner-cc-new.png`

## Output Contract

- Output exactly one sprite sheet image.
- White background only.
- Grid must be square cells.
- Every subject must fit fully inside its cell (no clipping).
- No extra subjects beyond the requested list.
- No text or watermark.

## Base Style Suffix

Use this suffix verbatim unless the user requests changes:

`3/4 isometric game icon, stylized realism (not photoreal), ClawCity banner vibe (warm sandstone, forest greens, clear cyan sky accents), clean outline, high readability at small size, white background, no text, no watermark.`

## Canonical Prompt: 13-Item Sheet (Crop-Ready)

Use this prompt template when the user wants the standard item sheet:

```text
Use these reference images for style and consistency:
1) /Users/marcelheinz/Desktop/clawcity.app-main-fresh/public/items/items_all.png
2) /Users/marcelheinz/Desktop/clawcity.app-main-fresh/public/items/buildings_all.png
3) /Users/marcelheinz/Desktop/clawcity.app-main-fresh/public/banner-cc-new.png

Create exactly one sprite sheet PNG for gameplay items.

Hard layout constraints:
- Canvas: 2048x2048 px
- Grid: 4 columns x 4 rows
- Cell size: 512x512 px each
- Pure white background across whole sheet
- Draw a subtle square frame for each cell (no hexagons or other shapes)
- Keep each item fully inside its own square cell with comfortable padding
- No overlap across cells
- No text labels
- No watermark
- Do not add extra items

Place these 13 items in this exact slot order (left-to-right, top-to-bottom):
1. Wooden Pickaxe - rough wooden handle, simple stone/iron head, hand-crafted survival tool, worn but sturdy
2. Stone Pickaxe - reinforced pickaxe with heavier stone head and leather bindings, upgraded mining tool
3. Fishing Rod - rustic wooden rod with line and hook, small tackle detail, explorer survival gear
4. Lumber Axe - broad chopping axe with polished blade and thick wooden haft, forestry tool
5. Harvesting Sickle - curved metal blade with wrapped grip and a few grain stems, farming tool
6. Compass - open brass compass with engraved face and glowing needle, navigation gear
7. Backpack - rugged leather field pack with straps, bedroll, and utility pouches
8. Spyglass - brass telescope with lens reflections and leather wrap, scouting equipment
9. Reinforced Walls kit - compact wall segment with iron braces, rivets, and stone blocks, defensive equipment item
10. Provisions - preserved food bundle with dried meat, bread, and tied cloth wrap, survival consumable
11. Rations - compact travel meal pack with simple wrapped portions, quick-use consumable
12. Territory Deed - parchment deed with wax seal, map lines, and official stamp, claim document
13. Torch - lit wooden torch with bright flame and embers, rugged exploration tool

Leave slots 14-16 empty white with the same subtle square frame only.

Global style for all items:
3/4 isometric game icon, stylized realism (not photoreal), ClawCity banner vibe (warm sandstone, forest greens, clear cyan sky accents), clean outline, high readability at small size, white background, no text, no watermark.
```

## Optional Prompt: 3-Building Sheet

Use only if the user asks for a building sheet:

```text
Use the same references and style. Create one 1024x1024 PNG sprite sheet, 2x2 grid, 512x512 cells, white background, square cell frames, no text/watermark, each subject fully inside its cell, no extras.
Slots:
1) Storage
2) Workshop
3) Fortification
4) Empty framed white slot
```

## QA Checklist

After generation:
1. Confirm output dimensions match the requested canvas.
2. Confirm grid math: width/columns == height/rows and each is a whole number.
3. Confirm all required subjects exist and no extra subjects were introduced.
4. Confirm every subject is fully inside its cell.
5. Confirm white background and no text/watermark.

## Crop Mapping (13-Item Sheet)

For a 4x4 sheet, slot index is row-major:
- Row 1: slots 1-4
- Row 2: slots 5-8
- Row 3: slots 9-12
- Row 4: slots 13-16

Keep this mapping stable so downstream item filenames remain deterministic.
