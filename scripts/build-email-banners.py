#!/usr/bin/env python3
"""
Compose the newsletter masthead backgrounds, one per edition photo.

The website fades each edition's photo into the navy with CSS masks. Email
clients support none of that, so the fade is baked into an image here: navy
on the left where the text sits, the photo on the right, fading in. The
newsletter lays live text over it (so it still reads with images blocked) and
falls back to plain navy where a client ignores background images (Outlook
for Windows).

Reads src/_data/editionPhotos.json and src/assets/img/editions/<slug>.jpg;
writes src/assets/img/email-banners/<slug>.jpg. Re-run after changing an
edition photo:

    python3 scripts/build-email-banners.py
"""
import json
import os
import re
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1200, 520                 # 2x a 600px email, roughly the masthead's shape
NAVY = (26, 39, 68)
PHOTO_FROM = 0.34                # the photo starts a third of the way across
FADE_TO = 0.46                   # ... and is fully visible this far into its box
WASH = 0.38                      # navy over the photo, so white text reads on a phone


def cover(img, w, h, pos_y=0.55):
    """Scale to cover w x h, cropping the excess; pos_y picks the vertical slice."""
    s = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    x = (img.width - w) // 2
    y = round((img.height - h) * pos_y)
    return img.crop((x, y, x + w, y + h))


def main():
    photos = json.load(open(os.path.join(ROOT, "src/_data/editionPhotos.json")))
    out_dir = os.path.join(ROOT, "src/assets/img/email-banners")
    os.makedirs(out_dir, exist_ok=True)
    for slug, p in photos.items():
        m = re.search(r"(\d+)%\s*$", p.get("position", "") or "")
        pos_y = int(m.group(1)) / 100 if m else 0.55
        src = Image.open(os.path.join(ROOT, "src/assets/img/editions", p["file"])).convert("RGB")
        x0 = round(W * PHOTO_FROM)
        pw = W - x0
        photo = cover(src, pw, H, pos_y)
        photo = Image.blend(photo, Image.new("RGB", photo.size, NAVY), WASH)

        mask = Image.new("L", (pw, H), 0)
        draw = ImageDraw.Draw(mask)
        fade_px = round(pw * FADE_TO)
        for x in range(pw):
            a = 255 if x >= fade_px else round(255 * (x / fade_px) ** 1.4)
            draw.line([(x, 0), (x, H)], fill=a)

        canvas = Image.new("RGB", (W, H), NAVY)
        canvas.paste(photo, (x0, 0), mask)
        dest = os.path.join(out_dir, f"{slug}.jpg")
        canvas.save(dest, "JPEG", quality=74, optimize=True, progressive=True)
        print(f"{slug:28s} {os.path.getsize(dest) // 1024} KB")


if __name__ == "__main__":
    main()
