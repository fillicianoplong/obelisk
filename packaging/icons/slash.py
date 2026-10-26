"""Slash mark: a bold forward slash on a rounded square.

One colour for light and dark taskbars. The tile is #3B4654 and the slash
is #E6EAF0. The tile fills the 24 px box. Outside the rounded corners is transparent.
"""

TILE = "#3B4654"
SLASH = "#E6EAF0"

# The tile fills the 24 px box. Design 91 sat one unit in (22 px of ink); this
# path moves the edge out to the box and keeps the corner radius in proportion.
TILE_D = (
    "M5.5 0 H18.5 A5.5 5.5 0 0 1 24 5.5 V18.5 A5.5 5.5 0 0 1 18.5 24 "
    "H5.5 A5.5 5.5 0 0 1 0 18.5 V5.5 A5.5 5.5 0 0 1 5.5 0 Z"
)
# Design 91 slash, scaled by 24/22 about (12, 12) so it stays the same size on the tile.
SLASH_D = "M13.03636 3.81818 L17.83636 3.81818 L10.96364 20.18182 L6.16364 20.18182 Z"


def _round_half_up(value):
    return int(value + 0.5) if value >= 0 else int(value - 0.5)


def slash_metrics(n):
    """Pixel-snapped slash for an n px canvas.

    The ends sit on whole rows and the horizontal width stays constant, so
    16 and 24 px do not blur the bar. The slant is the same on both edges.
    The bar is the design-91 slash scaled by 24/22, matching the full-bleed tile.
    """
    height = _round_half_up(15 * n / 22.0)
    width = max(2, _round_half_up(4.4 * n / 22.0))
    shift = max(2, _round_half_up(6.3 * n / 22.0))
    if n % 2 == 0 and height % 2:
        lower = height - 1
        upper = height + 1
        ideal = 15 * n / 22.0
        height = lower if abs(lower - ideal) <= abs(upper - ideal) else upper
    if width % 2 != shift % 2:
        up = shift + 1
        down = shift - 1
        ideal = 6.3 * n / 22.0
        if down >= 2 and abs(down - ideal) <= abs(up - ideal):
            shift = down
        else:
            shift = up
    return _place_slash(n, height, width, shift)


def _place_slash(n, height, width, shift):
    top = (n - height) // 2
    bottom = top + height
    centre = n / 2.0
    top_mid = centre + shift / 2.0
    bot_mid = centre - shift / 2.0
    half = width / 2.0
    return {
        "top": top,
        "bottom": bottom,
        "x_tl": top_mid - half,
        "x_tr": top_mid + half,
        "x_br": bot_mid + half,
        "x_bl": bot_mid - half,
        "width": width,
        "shift": shift,
        "height": height,
    }


def _num(value):
    text = ("%.3f" % value).rstrip("0").rstrip(".")
    return text if text else "0"


def mark_paths(n, snap):
    if not snap:
        return TILE_D, SLASH_D, "0 0 24 24"
    radius = 5.5 * n / 24.0
    left, top = 0.0, 0.0
    right, bot = float(n), float(n)
    tile = (
        f"M{_num(left + radius)} {_num(top)} H{_num(right - radius)} "
        f"A{_num(radius)} {_num(radius)} 0 0 1 {_num(right)} {_num(top + radius)} "
        f"V{_num(bot - radius)} "
        f"A{_num(radius)} {_num(radius)} 0 0 1 {_num(right - radius)} {_num(bot)} "
        f"H{_num(left + radius)} "
        f"A{_num(radius)} {_num(radius)} 0 0 1 {_num(left)} {_num(bot - radius)} "
        f"V{_num(top + radius)} "
        f"A{_num(radius)} {_num(radius)} 0 0 1 {_num(left + radius)} {_num(top)} Z"
    )
    m = slash_metrics(n)
    slash = (
        f"M{_num(m['x_tl'])} {m['top']} L{_num(m['x_tr'])} {m['top']} "
        f"L{_num(m['x_br'])} {m['bottom']} L{_num(m['x_bl'])} {m['bottom']} Z"
    )
    return tile, slash, f"0 0 {n} {n}"


def mark_svg(n, snap=None):
    """Square mark. Small sizes snap the slash; larger sizes use the 24 px paths."""
    if snap is None:
        snap = n <= 96
    tile, slash, view = mark_paths(n, snap)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}">'
        f'<path d="{tile}" fill="{TILE}"/>'
        f'<path d="{slash}" fill="{SLASH}"/>'
        f"</svg>"
    )


def placed_svg(width, height, snap=None):
    """The square mark centred on a wider canvas. The rest stays transparent."""
    side = min(width, height)
    if snap is None:
        snap = side <= 96
    tile, slash, _view = mark_paths(side, snap)
    ox = (width - side) / 2.0
    oy = (height - side) / 2.0
    # Snapped paths are already in pixels. The 24 px source paths need scaling.
    transform = f"translate({_num(ox)} {_num(oy)})"
    if not snap:
        transform += f" scale({_num(side / 24.0)})"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">'
        f'<g transform="{transform}">'
        f'<path d="{tile}" fill="{TILE}"/>'
        f'<path d="{slash}" fill="{SLASH}"/>'
        f"</g></svg>"
    )
