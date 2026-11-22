"""生成启动器图标：蓝色渐变圆角方块 + 白鱼剪影，输出多尺寸 ico 和 png。"""
from PIL import Image, ImageDraw
import os

OUT = os.path.dirname(os.path.abspath(__file__))
S = 1024


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make(size=S):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # 渐变底
    grad = Image.new("RGBA", (size, size))
    top, bottom = (56, 189, 248), (99, 102, 241)
    px = grad.load()
    for y in range(size):
        for x in range(size):
            t = (x / size * 0.45 + y / size * 0.55)
            px[x, y] = (*lerp(top, bottom, t), 255)

    # 圆角遮罩
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.24), fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    w = size

    def p(v):
        return int(v * w)

    # 鱼身（白色）
    d.ellipse([p(0.24), p(0.33), p(0.76), p(0.70)], fill=(255, 255, 255, 240))
    # 尾巴
    d.polygon(
        [(p(0.20), p(0.51)), (p(0.09), p(0.38)), (p(0.10), p(0.64))],
        fill=(255, 255, 255, 235),
    )
    # 上鳍
    d.polygon(
        [(p(0.38), p(0.36)), (p(0.46), p(0.24)), (p(0.52), p(0.37))],
        fill=(255, 255, 255, 225),
    )
    # 眼睛
    d.ellipse([p(0.60), p(0.44), p(0.665), p(0.505)], fill=(30, 41, 59, 255))
    # 腮红
    d.ellipse([p(0.50), p(0.545), p(0.565), p(0.585)], fill=(251, 191, 183, 200))
    return img


img = make()
img.save(os.path.join(OUT, "icon.png"))
sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
img.save(os.path.join(OUT, "icon.ico"), sizes=sizes)
# 窗口图标
img.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, "icon-256.png"))
print("ok", os.path.join(OUT, "icon.ico"))
