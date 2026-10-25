"""Regenerate every Obelisk icon from the slash mark in slash.py.

Usage (from repo root):  python3 packaging/icons/generate.py [out_root]
Writes packaging/icons/sources/*.svg, packaging/icons/obelisk.ico, and
packaging/msix/assets/*.png under out_root (default: the repo root).
Needs cairosvg and Pillow.
"""
import io, os, shutil, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slash import SLASH, TILE, mark_svg, placed_svg, slash_metrics
import cairosvg
from PIL import Image

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "packaging", "icons", "sources")
ASSETS = os.path.join(ROOT, "packaging", "msix", "assets")
os.makedirs(SRC, exist_ok=True)
os.makedirs(ASSETS, exist_ok=True)
for name in os.listdir(SRC):
    if name.endswith(".svg"):
        os.remove(os.path.join(SRC, name))

def png(svg_text, w, h):
    return Image.open(io.BytesIO(cairosvg.svg2png(
        bytestring=svg_text.encode(), output_width=w, output_height=h,
    ))).convert("RGBA")

made = []

def emit(asset_name, src_name, svg_text, w, h):
    with open(os.path.join(SRC, src_name), "w") as fh:
        fh.write(svg_text + "\n")
    image = png(svg_text, w, h)
    image.save(os.path.join(ASSETS, asset_name), optimize=True)
    made.append((asset_name, src_name, w, h))
    return image

# One #3B4654 tile and an #E6EAF0 slash, on every canvas.
for name, n in [("Square44x44Logo.png", 44), ("Square44x44Logo.scale-200.png", 88)]:
    emit(name, f"slash-{n}.svg", mark_svg(n), n, n)

# No unqualified Square44x44Logo.targetsize-*.png. The taskbar reads the
# altform files from resources.pri. Both altforms are this same image, so a
# light taskbar and a dark taskbar show the same full tile.
TASKBAR = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]
for n in TASKBAR:
    src_name = f"slash-{n}.svg"
    unplated = f"Square44x44Logo.targetsize-{n}_altform-unplated.png"
    light = f"Square44x44Logo.targetsize-{n}_altform-lightunplated.png"
    emit(unplated, src_name, mark_svg(n), n, n)
    shutil.copyfile(os.path.join(ASSETS, unplated), os.path.join(ASSETS, light))
    made.append((light, src_name, n, n))

for name, n in [("StoreLogo.png", 50), ("StoreLogo.scale-200.png", 100)]:
    emit(name, f"slash-{n}.svg", mark_svg(n), n, n)

for base, (w, h) in [
    ("Square150x150Logo", (150, 150)),
    ("Square310x310Logo", (310, 310)),
    ("Wide310x150Logo", (310, 150)),
    ("SplashScreen", (620, 300)),
]:
    for scale, factor in (("", 1), (".scale-200", 2)):
        pw, ph = w * factor, h * factor
        text = placed_svg(pw, ph) if pw != ph else mark_svg(pw)
        emit(f"{base}{scale}.png", f"slash-{base}{scale}.svg", text, pw, ph)

def hex_rgb(value):
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))

def assert_small_slash(image, n):
    """The bar is one width, the ends are solid, and the corner is clear."""
    px = image.convert("RGBA").load()
    tile = hex_rgb(TILE)
    slash = hex_rgb(SLASH)
    if px[0, 0][3] > 16:
        raise SystemExit(f"{n}px corner is not transparent")
    # The flat edges of the tile reach the canvas. A transparent margin made the taskbar icon small.
    edge = n // 2
    for x, y in ((edge, 0), (0, edge), (n - 1, edge), (edge, n - 1)):
        if px[x, y][3] < 250:
            raise SystemExit(f"{n}px edge ({x},{y}) alpha {px[x, y][3]} is not full-bleed")
    if n > 48:
        return
    m = slash_metrics(n)
    widths = []
    for y in range(m["top"] + 1, m["bottom"] - 1):
        count = 0
        solid = 0
        for x in range(n):
            r, g, b, a = px[x, y]
            if a > 200 and abs(r - slash[0]) < 24 and abs(g - slash[1]) < 24 and abs(b - slash[2]) < 24:
                count += 1
                if a > 240:
                    solid += 1
        if count == 0:
            raise SystemExit(f"{n}px row {y} has no slash")
        widths.append(count)
    if max(widths) - min(widths) > 1:
        raise SystemExit(f"{n}px slash width varies {widths}")
    # The first and last rows of the bar should be mostly opaque, not a blur.
    for y in (m["top"], m["bottom"] - 1):
        opaque = 0
        for x in range(n):
            if px[x, y][3] > 200:
                opaque += 1
        if opaque < m["width"]:
            raise SystemExit(f"{n}px slash end at y={y} is soft ({opaque})")
    # A tile pixel beside the bar, away from the corner.
    mid = (m["top"] + m["bottom"]) // 2
    found_tile = False
    for x in range(n):
        r, g, b, a = px[x, mid]
        if a > 220 and abs(r - tile[0]) < 18 and abs(g - tile[1]) < 18 and abs(b - tile[2]) < 18:
            found_tile = True
            break
    if not found_tile:
        raise SystemExit(f"{n}px tile colour is missing")

def dib_bytes(im):
    """Uncompressed 32-bit BMP, bottom-up, with an AND mask. No PNG wrapper."""
    im = im.convert("RGBA")
    n = im.width
    if im.height != n:
        raise SystemExit(f"icon frame is {n}x{im.height}")
    header = struct.pack("<IiiHHIIiiII", 40, n, n * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    px = im.load()
    xor = bytearray()
    mask_row = ((n + 31) // 32) * 4
    mask = bytearray()
    for y in range(n - 1, -1, -1):
        row = bytearray(mask_row)
        for x in range(n):
            r, g, b, a = px[x, y]
            xor += bytes((b, g, r, a))
            if a < 128:
                row[x // 8] |= 0x80 >> (x % 8)
        mask += row
    return header + bytes(xor) + bytes(mask)

def frame_blob(im, n):
    if n >= 256:
        out = io.BytesIO()
        im.save(out, format="PNG")
        return out.getvalue()
    return dib_bytes(im)

def write_ico(path, frames):
    """frames: list of (px, PIL image). Sizes below 256 are BMP; 256 is PNG."""
    blobs = [(n, frame_blob(im, n)) for n, im in frames]
    header = struct.pack("<HHH", 0, 1, len(blobs))
    offset = 6 + 16 * len(blobs)
    entries = b""
    body = b""
    for n, blob in blobs:
        dim = 0 if n >= 256 else n
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(blob), offset + len(body))
        body += blob
    with open(path, "wb") as fh:
        fh.write(header + entries + body)

WINDOW_ICON = [16, 20, 24, 32, 40, 48, 64, 256]

def window_frames():
    frames = []
    for n in WINDOW_ICON:
        text = mark_svg(n)
        src = f"slash-window-{n}.svg"
        with open(os.path.join(SRC, src), "w") as fh:
            fh.write(text + "\n")
        image = png(text, n, n)
        assert_small_slash(image, n)
        frames.append((n, image))
    return frames

for n in (16, 24, 32):
    assert_small_slash(png(mark_svg(n), n, n), n)

ICON_DIR = os.path.join(ROOT, "packaging", "icons")
for stale in ("taskbar-dark.ico", "taskbar-light.ico"):
    stale_path = os.path.join(ICON_DIR, stale)
    if os.path.exists(stale_path):
        os.remove(stale_path)

write_ico(os.path.join(ICON_DIR, "obelisk.ico"), window_frames())
png(mark_svg(256), 256, 256).save(os.path.join(ICON_DIR, "obelisk-256.png"))

with open(os.path.join(SRC, "MAP.txt"), "w") as fh:
    fh.write("asset\tsource svg\tpx\n")
    for asset, src, w, h in made:
        fh.write(f"assets/{asset}\t{src}\t{w}x{h}\n")
    sizes = ",".join(str(n) for n in WINDOW_ICON)
    fh.write(f"icons/obelisk.ico\tslash-window-<{sizes}>.svg\tBMP 16,20,24,32,40,48,64; PNG 256\n")
print(len(made), "msix assets;", "window", WINDOW_ICON)
