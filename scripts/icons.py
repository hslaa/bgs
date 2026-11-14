"""Draws the app icons: three "departure lines", the top one orange. Run: npm run icons"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
BG = "#0c0a09"
BARS = [("#fb923c", 240), ("#e7e5e4", 180), ("#a8a29e", 120)]  # colour, width (on a 512 scale)
BAR_H, GAP, LEFT = 48, 40, 136


def draw(size: int, scale: float = 1.0, radius: float = 0.22) -> Image.Image:
    s = size / 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if radius:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size * radius, fill=BG)
    else:
        d.rectangle([0, 0, size, size], fill=BG)
    total = len(BARS) * BAR_H + (len(BARS) - 1) * GAP
    c = 256
    y = c - total * scale / 2
    x0 = c - (c - LEFT) * scale
    for color, w in BARS:
        h = BAR_H * scale
        d.rounded_rectangle([x0 * s, y * s, (x0 + w * scale) * s, (y + h) * s], radius=h * s / 2, fill=color)
        y += h + GAP * scale
    return img


OUT.mkdir(parents=True, exist_ok=True)
draw(512).save(OUT / "icon-512.png")
draw(512).resize((192, 192), Image.LANCZOS).save(OUT / "icon-192.png")
draw(512, scale=0.8, radius=0).save(OUT / "icon-maskable-512.png")
draw(512, radius=0).convert("RGB").resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png")
draw(512).resize((32, 32), Image.LANCZOS).save(OUT / "favicon-32.png")

rects = []
y = 256 - (len(BARS) * BAR_H + (len(BARS) - 1) * GAP) / 2
for color, w in BARS:
    rects.append(f'<rect x="{LEFT}" y="{y:g}" width="{w}" height="{BAR_H}" rx="{BAR_H / 2:g}" fill="{color}"/>')
    y += BAR_H + GAP
(OUT / "icon.svg").write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="113" fill="{BG}"/>{"".join(rects)}</svg>\n'
)
print("icons written to", OUT)
