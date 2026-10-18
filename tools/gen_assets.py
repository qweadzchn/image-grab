"""生成插件图标与演示用示例商品图（PIL）。"""
from PIL import Image, ImageDraw, ImageFilter
import os, math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.makedirs(os.path.join(ROOT, "icons"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "demo", "samples"), exist_ok=True)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size, c1, c2, angle=135):
    w, h = size
    img = Image.new("RGB", (w, h))
    px = img.load()
    rad = math.radians(angle)
    dx, dy = math.cos(rad), math.sin(rad)
    scale = abs(dx) * w + abs(dy) * h
    for y in range(h):
        for x in range(0, w, 1):
            t = ((x * dx + y * dy) / scale) if scale else 0
            t = min(1, max(0, (t + 1) / 2))
            px[x, y] = lerp(c1, c2, t)
    return img


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return mask


def make_icon(px):
    scale = 8
    S = px * scale
    base = gradient((S, S), (37, 99, 235), (124, 58, 237), 130)
    icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    icon.paste(base, (0, 0), rounded_mask((S, S), int(S * 0.28)))

    d = ImageDraw.Draw(icon)
    # 向下箭头
    cx = S / 2
    top = S * 0.26
    shaft_w = S * 0.105
    d.rounded_rectangle([cx - shaft_w / 2, top, cx + shaft_w / 2, S * 0.55], radius=shaft_w / 2, fill=(255, 255, 255, 255))
    arrow = [(cx - S * 0.19, S * 0.49), (cx + S * 0.19, S * 0.49), (cx, S * 0.70)]
    d.polygon(arrow, fill=(255, 255, 255, 255))
    d.rounded_rectangle([cx - S * 0.06, S * 0.44, cx + S * 0.06, S * 0.52], radius=S * 0.02, fill=(255, 255, 255, 255))
    # 托盘
    d.rounded_rectangle(
        [S * 0.24, S * 0.755, S * 0.76, S * 0.815], radius=S * 0.03, fill=(255, 255, 255, 235)
    )
    return icon.resize((px, px), Image.LANCZOS)


for size in (16, 48, 128):
    make_icon(size).save(os.path.join(ROOT, "icons", f"icon{size}.png"))


PALETTES = [
    ((226, 232, 240), (203, 213, 225), (37, 99, 235), "润泽保湿面霜"),
    ((255, 237, 213), (253, 186, 116), (234, 88, 12), "轻氧咖啡杯"),
    ((219, 234, 254), (147, 197, 253), (29, 78, 216), "无线蓝牙耳机"),
    ((220, 252, 231), (134, 239, 172), (5, 150, 105), "自然植物香薰"),
    ((254, 226, 226), (252, 165, 165), (220, 38, 38), "限定礼盒套装"),
    ((237, 233, 254), (196, 181, 253), (109, 40, 217), "极简玻璃水杯"),
]
SIZES = [
    (900, 900), (900, 900), (900, 900),
    (900, 1200), (1200, 800),
    (900, 900), (900, 900), (900, 1200),
    (900, 900), (1200, 800), (900, 900), (900, 900),
]


def shift_color(c, delta):
    return tuple(min(255, max(0, c[i] + delta[i])) for i in range(3))


SHIFTS = [(0, 0, 0), (10, -6, 6), (-8, 8, 4), (6, 4, -10)]


def make_sample(idx, size):
    w, h = size
    bg1, bg2, accent, _name = PALETTES[idx % len(PALETTES)]
    delta = SHIFTS[idx % len(SHIFTS)]
    bg1, bg2, accent = shift_color(bg1, delta), shift_color(bg2, delta), shift_color(accent, delta)
    img = gradient((w, h), bg1, bg2, 120)
    # 柔光
    glow = Image.new("RGB", (w, h), (255, 255, 255))
    glow_mask = Image.new("L", (w, h), 0)
    gd = ImageDraw.Draw(glow_mask)
    gd.ellipse([-w * 0.3, -h * 0.55, w * 1.1, h * 0.75], fill=110)
    glow_mask = glow_mask.filter(ImageFilter.GaussianBlur(w * 0.08))
    img.paste(glow, (0, 0), glow_mask)

    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # 地面阴影
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse([w * 0.16, h * 0.72, w * 0.84, h * 0.84], fill=(15, 23, 42, 90))
    shadow = shadow.filter(ImageFilter.GaussianBlur(w * 0.03))
    layer.alpha_composite(shadow)

    # 主产品：圆角瓶身 + 瓶盖
    bw, bh = w * (0.40 + 0.04 * (idx % 3)), h * (0.44 + 0.03 * (idx % 2))
    x0, y0 = (w - bw) / 2, h * (0.26 + 0.02 * (idx % 2))
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=bw * 0.22, fill=(255, 255, 255, 246))
    d.rounded_rectangle(
        [x0 + bw * 0.22, y0 - bh * 0.16, x0 + bw * 0.78, y0 + bh * 0.04],
        radius=bw * 0.09,
        fill=accent + (255,),
    )
    # 标签区
    d.rounded_rectangle(
        [x0 + bw * 0.16, y0 + bh * 0.34, x0 + bw * 0.84, y0 + bh * 0.82],
        radius=bw * 0.06,
        fill=accent + (28,),
    )
    d.line(
        [x0 + bw * 0.26, y0 + bh * 0.50, x0 + bw * 0.74, y0 + bh * 0.50],
        fill=accent + (170,),
        width=max(2, int(w * 0.004)),
    )
    d.line(
        [x0 + bw * 0.26, y0 + bh * 0.60, x0 + bw * 0.62, y0 + bh * 0.60],
        fill=accent + (120,),
        width=max(2, int(w * 0.004)),
    )
    # 小圆点装饰
    d.ellipse([x0 + bw * 0.44, y0 + bh * 0.68, x0 + bw * 0.56, y0 + bh * 0.78], fill=accent + (200,))

    layer.alpha_composite(layer)
    img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
    return img


for i, size in enumerate(SIZES, start=1):
    make_sample(i - 1, size).save(os.path.join(ROOT, "demo", "samples", f"{i:02d}.png"), optimize=True)

print("assets generated")
