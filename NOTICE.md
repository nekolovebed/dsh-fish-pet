# NOTICE — provenance and third-party rights

This repository is an independent, unofficial project. It is **not affiliated
with, endorsed by, or sponsored by** DeepSeek, Pal AI Lab / Coopanion, or the
maintainers of any desktop-pet plugin for DeepSeek Harness.

## 1. What this repository contains

| Component | Origin | Rights |
| --- | --- | --- |
| All source code in `src/`, `lib/`, `test/` | Written for this project | MIT (see `LICENSE`) |
| Built-in character “泡泡” (the whale-like drawing in `lib/client.js`, `FishArt`) | Drawn for this project as inline SVG | MIT |
| Colour palette, animations, layout, state machine | Written for this project | MIT |

**No third-party character art, sprite sheet, animation frame, icon, sound or
font is bundled in this repository.**

## 2. What was *not* copied

The project was inspired by the desktop-pet presentation layer of
[Pal-AI-Lab/Coopanion](https://github.com/Pal-AI-Lab/Coopanion) and by the
community plugin [QCYTSN/dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu).
Neither repository's source code, nor any of their assets, is present here.

Details and reasoning are in [`docs/LEGAL.md`](docs/LEGAL.md). Summary of the
upstream terms that shaped the design:

- **Coopanion** is licensed **AGPL-3.0-or-later** (with an AGPL §7 additional
  permission to link the Steamworks API; releases up to 0.1.10 were MIT). Its
  README states that the “大肥鱼” (DeepSeek Chan / whale) textures originate
  from third-party original designs and derivative fan art, that vendor
  trademarks appear on its apron, and that those textures are **explicitly
  outside the AGPL grant**.
- **dsh-dafeiyu** is MIT for code, but its `ASSET_LICENSE.md` states that the
  legacy BigFish runtime frames are **not** covered by the MIT code licence,
  are derived from fan-made DeepSeek-related character views and AI-assisted
  animation sheets, that re-encoding or resizing does not change the rights in
  the underlying artwork, and that redistribution outside that repository
  requires permission from the respective rights holders.

Consequently this project reproduces neither the code nor the artwork of those
projects.

## 3. Trademarks

“DeepSeek”, the DeepSeek whale mark, and other product names are trademarks or
registered trademarks of their respective owners. They are used here only in
descriptive, nominative form (to say which harness this plugin runs on). This
project's name, package name (`dsh-fish-pet`) and character are deliberately
distinct from those marks so as not to suggest endorsement.

## 4. Runtime dependencies

`@deepseek-ai/schemastery` is installed from npm and remains under its own
licence. It is not vendored into this repository's source tree.

## 5. If you add your own artwork

You may point the plugin at character art you own or have permission to use.
Do not commit artwork you do not have the rights to — including any frame set
extracted from the projects named above. See `docs/LEGAL.md` §6.
