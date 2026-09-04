#!/usr/bin/env python3
"""
make-soulsync-screenshots.py — compose SoulSync's framed Google Play phone screenshots.

Run it:
    python3 store/make-soulsync-screenshots.py                  # regenerate the whole framed set
    python3 store/make-soulsync-screenshots.py --fastlane       # ...and refresh the unframed F-Droid set
    python3 store/make-soulsync-screenshots.py --only 03 04     # re-render just those slides
    python3 store/make-soulsync-screenshots.py --config x.json  # slide list from JSON instead of SLIDES

Why this exists: the framed set is what strangers actually judge the app on, and it goes stale
every time the UI moves (v2.10 replaced the navigator header bar with in-page titles, v2.11
replaced the whole charting layer). Regenerating it used to be a one-off script that was never
committed, so each refresh started from scratch. This is the committed, re-runnable version.

Inputs  : store/screenshots/raw/*.png   (tracked raw device captures, any size, portrait)
Outputs : store/play-screenshots/en-US/phoneScreenshots/01..08.png   (1080x2160, framed)
          fastlane/metadata/android/en-US/images/phoneScreenshots/1..N.png  (--fastlane, unframed)

Design system (matches the shipped feature graphic + the 2026-07 framed set it replaces):
  - Ground: near-black slate at the top easing into a deep forest green at the bottom, with one
    soft green bloom behind the device. Dithered — flat dark gradients band badly on Play's
    JPEG-ish downscales and banding is the single most "cheap" looking artefact on a store rail.
  - Device: drawn PROGRAMMATICALLY (rounded body + rounded screen + camera dot) rather than
    pasted into a borrowed frame PNG. Zero aspect distortion, full colour control, and the frame
    width/top edge are identical on every slide no matter what each capture's aspect is.
  - Headline: DM Sans at weight 700, white, with exactly ONE phrase in the brand green. Lines are
    declared explicitly in the config (never auto-wrapped) so the rag is a design decision and the
    first baseline is pinned to the same y on all eight slides.
  - The whole device fits on the canvas with a small margin under it. Every capture off the same
    phone shares one aspect ratio, so with the body top and width pinned the body BOTTOM lands on
    the same y on all eight slides too. If a future capture has a different aspect the device
    simply grows; check the bottom margin before shipping rather than assuming it still fits.

Palette + geometry constants are sampled from the previous shipped set so the new slides sit in
the same family as the feature graphic and the app icon.
"""

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
RAW_DIR = os.path.join(HERE, "screenshots", "raw")
OUT_DIR = os.path.join(HERE, "play-screenshots", "en-US", "phoneScreenshots")
FASTLANE_DIR = os.path.join(
    REPO, "fastlane", "metadata", "android", "en-US", "images", "phoneScreenshots")
FONT_DIR = os.path.expanduser("~/projects/content-tools/fonts")
DM_SANS_VAR = os.path.join(FONT_DIR, "DMSans-Variable.ttf")

# ── Play spec ────────────────────────────────────────────────────────────────
OUT_SIZE = (1080, 2160)          # 1:2, the Pixel-3 aspect; comfortably over Play's 1080 minimum
FASTLANE_MAX = 8                 # Play/F-Droid both cap the phone rail at 8

# ── Palette (sampled from store/play-screenshots 2026-07 set + the feature graphic) ──
BG_TOP = (18, 21, 26)            # #12151A near-black slate
BG_BOTTOM = (10, 20, 15)         # #0A140F deep forest
GREEN = (79, 200, 96)            # #4FC860 brand accent (the headline accent + bloom colour)
WHITE = (245, 247, 246)          # #F5F7F6 headline body — never pure #FFF on a dark ground
BEZEL = (24, 28, 34)             # #181C22 device body
BEZEL_RIM = (68, 78, 88)         # #444E58 top rim highlight, 1px, sells the edge
CAMERA = (10, 12, 15)            # #0A0C0F punch-hole dot

# ── Geometry. Vertical placement is a fraction of canvas HEIGHT; type and device widths
# are fractions of canvas WIDTH, so the layout survives a canvas-size change. Every one of
# these is pinned across slides, that is what makes the eight read as one rail. ──
HEAD_TOP_F = 0.058               # first headline line's TOP (of height), same on every slide
HEAD_SIZE_F = 0.085              # headline cap size (of width)
HEAD_LINE_F = 0.104              # line advance (of width), 1.22x the cap size
PHONE_TOP_F = 0.205              # device body's top edge (of height), same on every slide
PHONE_W_F = 0.826                # device body width (of width), same on every slide
BEZEL_SIDE_F = 0.0135            # side + bottom bezel thickness (of canvas width)
BEZEL_TOP_F = 0.0255             # forehead: thicker, holds the camera dot
BODY_RADIUS_F = 0.072            # device body corner radius
SCREEN_RADIUS_F = 0.052          # screen corner radius


# ─────────────────────────────────────────────────────────────────────────────
# Slide list. `lines` is a list of LINES; each line is a list of [text, role]
# segments where role is "accent" (brand green) or anything else (white).
# Exactly one accent phrase per slide — that is the whole headline system.
# `crop_top` / `crop_bottom` are fractions of the raw capture's height: crop_top
# drops the status bar, crop_bottom drops the Android nav/gesture bar.
#
# crop_bottom defaults to 0.0625, measured off the real captures: on a 2000px
# Pixel 3 render the 3-button nav band is the bottom 123px. Leaving even a sliver
# of it in puts a bright white strip inside a dark device and it is the first
# thing the eye lands on.
#
# crop_top defaults to 0 ON PURPOSE. Our captures are taken with SysUI demo mode
# on, so the status bar is a clean 9:00 / full wifi / full battery, and keeping it
# is what makes the frame read as a phone rather than a cropped asset. If a
# capture session forgets demo mode, set crop_top on those slides rather than
# shipping someone's real clock and notification icons.
DEFAULT_CROP_TOP = 0.0
DEFAULT_CROP_BOTTOM = 0.0625

SLIDES = [
    {
        "out": "01",
        "raw": "01-home.png",
        "lines": [[["Your mood,", "body"]],
                  [["your phone only", "accent"]]],
    },
    {
        "out": "02",
        "raw": "02-stats-trend.png",
        "lines": [[["See patterns", "body"]],
                  [["you ", "body"], ["can't feel", "accent"]]],
    },
    {
        "out": "03",
        "raw": "03-stats-scrub.png",
        "lines": [[["Hold to inspect", "body"]],
                  [["any day", "accent"]]],
    },
    {
        "out": "04",
        "raw": "04-chart-expanded-fit.png",
        "lines": [[["Zoom into", "body"]],
                  [["your own range", "accent"]]],
    },
    {
        "out": "05",
        "raw": "05-stats-daily-bars.png",
        "lines": [[["Which day", "body"]],
                  [["lifts you most", "accent"]]],
    },
    {
        "out": "06",
        "raw": "06-insights.png",
        "lines": [[["Insights in", "body"]],
                  [["plain English", "accent"]]],
    },
    {
        "out": "07",
        "raw": "07-stats-heatmap.png",
        "lines": [[["A whole year", "body"]],
                  [["at a glance", "accent"]]],
    },
    {
        "out": "08",
        "raw": "08-timeline.png",
        "lines": [[["Your whole story,", "body"]],
                  [["searchable", "accent"]]],
    },
]


# ── Fonts ────────────────────────────────────────────────────────────────────
def load_font(size, weight=700, optical=40):
    """
    DM Sans variable at an explicit weight.

    GOTCHA: set_variation_by_axes takes values POSITIONALLY for every axis the font declares,
    and DMSans-Variable declares TWO: [Optical size 9..40, Weight 100..1000]. Passing [700]
    therefore sets the OPTICAL SIZE to 700 (clamped to 40) and silently leaves the weight at its
    400 default, which renders a headline that looks limp with no error anywhere. Always pass
    both. Optical size 40 is the display end of the axis, which is what a 90px headline wants.
    """
    font = ImageFont.truetype(DM_SANS_VAR, size)
    axes = font.get_variation_axes()
    try:
        font.set_variation_by_axes([optical, weight] if len(axes) == 2 else [weight])
    except Exception:                                    # static build / no FreeType VF support
        pass
    return font


# ── Background ───────────────────────────────────────────────────────────────
def _vertical_gradient(size, top, bottom):
    w, h = size
    strip = Image.new("RGB", (1, h))
    px = strip.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = tuple(int(round(top[i] + (bottom[i] - top[i]) * t)) for i in range(3))
    return strip.resize((w, h), Image.BILINEAR).convert("RGBA")


def _bloom(size, center, radius, color, peak_alpha):
    """One soft radial glow (ellipse + heavy blur) as an RGBA layer."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = center
    d.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=color + (peak_alpha,))
    return layer.filter(ImageFilter.GaussianBlur(radius // 2))


def build_background(size, phone_top, seed=11):
    """
    Slate-to-forest gradient + one green bloom behind the device's shoulders + a corner vignette,
    then dithered. The dither is not optional: an 1080-wide flat dark gradient bands visibly once
    Play recompresses it, and banding is what makes a store rail look homemade.
    """
    w, h = size
    bg = _vertical_gradient(size, BG_TOP, BG_BOTTOM)
    # green bloom behind the top of the phone — lifts the device off the ground
    bg = Image.alpha_composite(bg, _bloom(size, (w // 2, phone_top + int(h * 0.14)),
                                          int(w * 0.62), GREEN, 20))
    # a second, cooler bloom low-left so the bottom third isn't dead flat
    bg = Image.alpha_composite(bg, _bloom(size, (int(w * 0.14), int(h * 0.88)),
                                          int(w * 0.42), GREEN, 12))
    # corner vignette: pull the far corners down so the headline reads first
    vig = Image.new("L", size, 0)
    ImageDraw.Draw(vig).ellipse(
        [-int(w * 0.30), -int(h * 0.12), int(w * 1.30), int(h * 1.12)], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(int(w * 0.18)))
    dark = Image.new("RGBA", size, (0, 0, 0, 0))
    dark.putalpha(Image.eval(vig, lambda p: int((255 - p) * 0.42)))
    bg = Image.alpha_composite(bg, dark)
    # Dither. This is ADDITIVE and zero-mean, not a blend toward mid-grey: a blend lifts the whole
    # ground a few levels and washes the black out. One offset shared across R/G/B per pixel reads
    # as film grain rather than colour speckle. sigma 1.1 is enough to break up a 1-level step and
    # is invisible at 100%; without it this gradient shows ~8 visible bands down the canvas.
    rng = np.random.default_rng(seed)
    arr = np.asarray(bg.convert("RGB")).astype(np.float32)
    arr += rng.normal(0.0, 1.1, arr.shape[:2])[:, :, None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).convert("RGBA")


# ── Device frame ─────────────────────────────────────────────────────────────
def _round_corners(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.width - 1, img.height - 1],
                                           radius=radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def crop_capture(path, crop_top, crop_bottom):
    """Drop the status bar / Android nav bar off a raw capture. Fractions of its own height."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    top = int(round(h * crop_top))
    bottom = h - int(round(h * crop_bottom))
    if bottom <= top:
        raise ValueError(f"{os.path.basename(path)}: crop_top+crop_bottom removes the whole image")
    return im.crop((0, top, w, bottom))


def paste_device(bg, shot):
    """
    Draw the phone: body, screen, camera dot, rim highlight. The body's top edge and width are
    fixed constants, so only the height varies with each capture's aspect — and the device is
    allowed to run off the bottom of the canvas.
    """
    W, H = bg.size
    body_w = int(W * PHONE_W_F)
    side = int(W * BEZEL_SIDE_F)
    fore = int(W * BEZEL_TOP_F)
    body_x = (W - body_w) // 2
    body_y = int(H * PHONE_TOP_F)

    screen_w = body_w - 2 * side
    screen_h = int(round(screen_w * shot.height / shot.width))
    body_h = fore + screen_h + side
    body_radius = int(W * BODY_RADIUS_F)
    screen_radius = int(W * SCREEN_RADIUS_F)

    # drop shadow under the device
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [body_x + 6, body_y + 26, body_x + body_w + 6, body_y + body_h + 26],
        radius=body_radius, fill=(0, 0, 0, 130))
    bg = Image.alpha_composite(bg, shadow.filter(ImageFilter.GaussianBlur(34)))

    # body
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle([body_x, body_y, body_x + body_w, body_y + body_h],
                        radius=body_radius, fill=BEZEL + (255,))
    # rim highlight along the top edge only — a lit bevel, not an outline
    d.rounded_rectangle([body_x, body_y, body_x + body_w, body_y + body_h],
                        radius=body_radius, outline=BEZEL_RIM + (110,), width=2)

    # screen
    screen = shot.resize((screen_w, screen_h), Image.LANCZOS)
    screen = _round_corners(screen, screen_radius)
    bg.alpha_composite(screen, (body_x + side, body_y + fore))

    # punch-hole camera, centred in the forehead
    dot_r = max(4, int(fore * 0.28))
    cx, cy = W // 2, body_y + fore // 2
    d.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=CAMERA + (255,))
    return bg


# ── Headline ─────────────────────────────────────────────────────────────────
def draw_headline(bg, lines, font):
    """
    Centred, explicit line breaks, one accent phrase. Returns the measured block width so the
    caller can assert nothing ran past the safe margin.
    """
    W, H = bg.size
    d = ImageDraw.Draw(bg)
    top = int(H * HEAD_TOP_F)
    advance = int(W * HEAD_LINE_F)
    widest = 0
    for i, line in enumerate(lines):
        widths = [d.textlength(text, font=font) for text, _ in line]
        total = sum(widths)
        widest = max(widest, total)
        x = (W - total) / 2
        y = top + i * advance
        for (text, role), tw in zip(line, widths):
            d.text((x, y), text, font=font,
                   fill=(GREEN if role == "accent" else WHITE) + (255,))
            x += tw
    return widest


# ── Compose ──────────────────────────────────────────────────────────────────
def verify(img, slide, widest, font_size, n_lines):
    """
    Invariants every shipped slide must hold. Checked on EVERY render, not on demand, because the
    failures they guard are silent: a clipped headline or a device running off the canvas still
    writes a perfectly valid PNG, and nobody opens all eight before upload. The checks target the
    CLASS of defect (text out of bounds, device out of bounds, banding) rather than pixel-diffing
    a golden image, which would break on every intentional copy change and get deleted.
    """
    problems = []
    W, H = img.size

    if (W, H) != OUT_SIZE:
        problems.append(f"size {W}x{H}, expected {OUT_SIZE[0]}x{OUT_SIZE[1]}")

    safe = W * 0.90
    if widest > safe:
        problems.append(f"headline {widest:.0f}px wide, safe margin {safe:.0f}px; shorten a line")

    # Headline must not collide with the device. 1.30x the cap size approximates the last line's
    # descender depth; the device top is a hard constant, so this is pure arithmetic.
    head_bottom = int(H * HEAD_TOP_F) + (n_lines - 1) * int(W * HEAD_LINE_F) + int(font_size * 1.30)
    device_top = int(H * PHONE_TOP_F)
    if head_bottom > device_top:
        problems.append(f"headline bottom {head_bottom}px overlaps the device top at {device_top}px")

    # The device must fit. Scan the centre column upward for the first non-background pixel: that
    # is the bottom bezel. Under 8px of margin reads as an accidental crop; over 240px leaves a
    # dead band under the phone. Either way the fix is PHONE_W_F / PHONE_TOP_F, not the capture.
    px = img.load()
    bottom = None
    for y in range(H - 1, device_top, -1):
        if sum(px[W // 2, y]) > 60:
            bottom = y
            break
    if bottom is None:
        problems.append("no device found in the centre column")
    else:
        margin = H - bottom
        if margin < 8:
            problems.append(f"device is clipped by the canvas (bottom margin {margin}px)")
        elif margin > 240:
            problems.append(f"device floats {margin}px above the bottom edge; retune PHONE_W_F")

    # Banding guard. A flat dark gradient contributes roughly one unique value per quantisation
    # step over this span; the dither pushes it into the hundreds. If this trips, the dither blend
    # got removed or zeroed and the slide will band visibly once Play recompresses it.
    strip = [px[int(W * 0.02), y] for y in range(int(H * 0.45), int(H * 0.95))]
    if len(set(strip)) < 40:
        problems.append(f"background column has only {len(set(strip))} unique colours; "
                        "dither is off and this will band on Play")

    return problems


def compose(slide, size, font, raw_dir):
    raw_path = os.path.join(raw_dir, slide["raw"])
    if not os.path.exists(raw_path):
        raise FileNotFoundError(raw_path)
    shot = crop_capture(raw_path,
                        slide.get("crop_top", DEFAULT_CROP_TOP),
                        slide.get("crop_bottom", DEFAULT_CROP_BOTTOM))
    bg = build_background(size, int(size[1] * PHONE_TOP_F), seed=11 + int(slide["out"]))
    bg = paste_device(bg, shot)
    widest = draw_headline(bg, slide["lines"], font)
    img = bg.convert("RGB")
    return img, widest, verify(img, slide, widest, font.size, len(slide["lines"]))


def write_fastlane(slides, raw_dir):
    """Unframed captures for F-Droid: status bar AND nav bar cropped, numbered 1..N."""
    os.makedirs(FASTLANE_DIR, exist_ok=True)
    for old in sorted(os.listdir(FASTLANE_DIR)):
        if old.endswith(".png"):
            os.remove(os.path.join(FASTLANE_DIR, old))
    n = 0
    for slide in slides[:FASTLANE_MAX]:
        raw_path = os.path.join(raw_dir, slide["raw"])
        if not os.path.exists(raw_path):
            continue
        # F-Droid shots carry no headline, so the status bar has nothing to sell — crop both ends.
        im = crop_capture(raw_path,
                          max(slide.get("crop_top", DEFAULT_CROP_TOP), 0.035),
                          slide.get("crop_bottom", DEFAULT_CROP_BOTTOM))
        n += 1
        out = os.path.join(FASTLANE_DIR, f"{n}.png")
        im.save(out, "PNG")
        print(f"  fastlane {n}.png  {im.size}  <- {slide['raw']}")
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", help="JSON file with the same shape as SLIDES")
    ap.add_argument("--raw-dir", default=RAW_DIR)
    ap.add_argument("--out-dir", default=OUT_DIR)
    ap.add_argument("--only", nargs="*", help="render only these slide numbers, e.g. --only 03 04")
    ap.add_argument("--fastlane", action="store_true",
                    help="also refresh the unframed fastlane/F-Droid set")
    ap.add_argument("--width", type=int, default=OUT_SIZE[0])
    ap.add_argument("--height", type=int, default=OUT_SIZE[1])
    args = ap.parse_args()

    slides = SLIDES
    if args.config:
        with open(args.config) as f:
            slides = json.load(f)

    size = (args.width, args.height)
    font = load_font(int(size[0] * HEAD_SIZE_F))
    os.makedirs(args.out_dir, exist_ok=True)

    targets = [s for s in slides if not args.only or s["out"] in args.only]
    failed = 0
    for i, slide in enumerate(targets, 1):
        img, widest, problems = compose(slide, size, font, args.raw_dir)
        out = os.path.join(args.out_dir, f"{slide['out']}.png")
        img.save(out, "PNG")
        print(f"  [{i}/{len(targets)}] {os.path.relpath(out, REPO)}  {img.size}  "
              f"headline {widest:.0f}px")
        for problem in problems:
            failed += 1
            print(f"      FAIL {slide['out']}: {problem}", file=sys.stderr)

    if args.fastlane:
        n = write_fastlane(slides, args.raw_dir)
        print(f"Fastlane: {n} unframed shots.")
    print(f"Done: {len(targets)} framed screenshots.")
    if failed:
        # Exit non-zero so a caller, or a human skimming the log, cannot miss it. The PNGs are
        # still written: inspecting a broken slide beats not having one to inspect.
        print(f"{failed} invariant failure(s); do NOT ship this set.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
