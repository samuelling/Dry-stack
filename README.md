# Dry Stack

A quiet 3D game about building a dry stone wall, one stone at a time, with real rigid-body physics.

No mortar, no score chasing, no music. Just wind in the grass and birdsong (or traffic hum, or the crackle of snapping shrimp), the pile, the string line, and the next stone.

**Play:** https://samuelling.github.io/Dry-stack/

## What's in it

- **Six regional stones**, each generated procedurally with its own shape and shading:
  New England fieldstone (rounded glacial granite, gneiss and schist), Pennsylvania fieldstone (rusty sandstone), Cotswold limestone (thin honey-coloured beds), Welsh slate (thin blue-grey and purple plates), Yorkshire gritstone (dark weathered skin over buff stone) and Aran limestone (pale stone with rain-etched pits).
- **Three settings:** rolling countryside, where the landscape matches the stone's region and the old wall runs off over the hill from the gap you're rebuilding; a vacant lot between brick rowhouses; and a kelp bed nine metres down, with lower effective gravity, water drag, caustics and drifting particles.
- **Real physics** (Rapier): every stone is a dynamic convex body with real mass (granite at 2.6 t/m³). Stones you're carrying still push and get pushed. Walls stand or fall on how well they're built.
- **A lesson** that follows how wallers actually work: footings in the trench, length into the wall, hearting packed as you go, one over two (no running joints), batter frames and string lines, throughs at knee height, copes on top, then a "hundred winters" test.
- **Craft notes** that read your wall the way a waller would: footing coverage, traced stones, stones proud of the line, running joints (marked in red on the face), how well the hearting is packed, throughs and copes.
- **All sound is synthesised** in the browser: gusting wind, grass, regional birds (chickadee, white-throated sparrow and blue jay in New England; robin, wren, curlew and skylark in Britain and Ireland), crickets, the city, the sea, and modal-synthesis stone impacts whose pitch depends on each stone's size and type.

## Focus mode

The slow part of the craft. Two footing faces are already laid, and the pile is yours to read.

- **Look closely:** double-click or press Z to glide in on a spot. Wheel zooms right down to the grain; right-drag or the arrow keys orbit, even while carrying a stone.
- **Examine (V):** hold a stone up in front of you and turn it over with the mouse to read its faces.
- **Fit light (L):** while carrying, the stone glows green where it bears and amber where it only nearly touches; a readout says whether it would rock.
- **Hammer (2):** aim a cut, set the bite with `[` `]` or Shift+wheel, tilt with Q/E, and strike. Chips fall as real flakes you can pick up.
- **Pinning and shims:** small shards and thin pinning stones wedge a stone or pack the hearting.
- **Press (X):** lean on a placed stone to feel whether it rocks.
- **Soft focus (B):** depth of field follows what you are looking at.

## Controls

| | |
|---|---|
| Click a stone | lift it (click again to set it down, or drag and release) |
| Wheel / Q, E | turn the stone (Shift for fine) |
| R / F | tip it over, forwards or sideways |
| T | turn its length into the wall |
| C | stand it on edge as a cope |
| Hold Space | press it down into place |
| H | pour a handful of hearting where you point |
| Drag / right-drag / WASD | look around / pan / walk along the wall |
| N, P, M, U | hide the panel, photo mode, mute, undo the weathering test |

## Running locally

It is a static site with no build step. Three.js and Rapier are included in `vendor/`.

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

URL parameters skip the menu, e.g. `?stone=welsh&setting=underwater&mode=free&len=3&time=golden&q=high&go=1`.

## Code map

- `src/stones.js` — stone types, procedural shapes (a superellipsoid cut by bedding and fracture planes, with rounding that depends on the stone type) and the object-space rock shader
- `src/physics.js` — Rapier world, heightfield ground, stone bodies
- `src/interaction.js` — picking, carrying (velocity-steered dynamic body), turning, setting down
- `src/analysis.js` — reads the wall: footings, faces, running joints, hearting fill (point samples), throughs, copes
- `src/tutorial.js` — lesson steps and their live checks
- `src/env/` — countryside (region presets), city, underwater
- `src/audio.js` — synthesised soundscapes and stone impacts
