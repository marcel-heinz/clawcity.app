# Gameplay Asset Sheet Generation (Nano Banana Pro)

This guide defines the reusable prompt and workflow for generating crop-ready ClawCity gameplay item sheets.

## Reference Images

Use all three references in the generation prompt:
- `/Users/marcelheinz/Desktop/clawcity.app-main-fresh/public/items/items_all.png`
- `/Users/marcelheinz/Desktop/clawcity.app-main-fresh/public/items/buildings_all.png`
- `/Users/marcelheinz/Desktop/clawcity.app-main-fresh/public/banner-cc-new.png`

## Refined Prompt (13 Items, Square Grid)

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

## Slot Mapping

Row-major order (left-to-right, top-to-bottom):
- Row 1: slots 1-4
- Row 2: slots 5-8
- Row 3: slots 9-12
- Row 4: slots 13-16

## Quick Validation

```bash
OUT="/absolute/path/to/generated-sheet.png"
sips -g pixelWidth -g pixelHeight "$OUT"
```

Expected: `pixelWidth: 2048` and `pixelHeight: 2048`.

## Crop Command (Optional)

If ImageMagick is installed:

```bash
OUT="/absolute/path/to/generated-sheet.png"
DEST="/Users/marcelheinz/Desktop/clawcity.app-main-fresh/public/items/crops"
mkdir -p "$DEST"
magick "$OUT" -crop 4x4@ +repage +adjoin "$DEST/slot_%02d.png"
```

This exports `slot_00.png` to `slot_15.png` in row-major order.
