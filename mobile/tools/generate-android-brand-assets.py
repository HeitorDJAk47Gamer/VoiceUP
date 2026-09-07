from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


WORKSPACE = Path(__file__).resolve().parents[2]
RESOURCE_ROOT = WORKSPACE / "mobile" / "android" / "app" / "src" / "main" / "res"
SOURCE = WORKSPACE / "assets" / "voiceup-logo.png"
BACKGROUND = (7, 20, 28, 255)
RESAMPLING = Image.Resampling.LANCZOS

ICON_SIZES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}

SPLASH_SIZES = {
    "drawable": (480, 320),
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1600, 960),
    "drawable-land-xxxhdpi": (1920, 1280),
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (960, 1600),
    "drawable-port-xxxhdpi": (1280, 1920),
}


def rounded_mask(size: int, radius_ratio: float, circle: bool = False) -> Image.Image:
    scale = 4
    large = Image.new("L", (size * scale, size * scale), 0)
    draw = ImageDraw.Draw(large)
    bounds = (0, 0, size * scale - 1, size * scale - 1)
    if circle:
        draw.ellipse(bounds, fill=255)
    else:
        draw.rounded_rectangle(bounds, radius=round(size * scale * radius_ratio), fill=255)
    return large.resize((size, size), RESAMPLING)


def masked_icon(source: Image.Image, size: int, circle: bool = False) -> Image.Image:
    icon = source.resize((size, size), RESAMPLING).convert("RGBA")
    mask = rounded_mask(size, 0.24, circle)
    icon.putalpha(ImageChops.multiply(icon.getchannel("A"), mask))
    return icon


def adaptive_foreground(source: Image.Image, size: int) -> Image.Image:
    # The source already keeps the headset and microphone in Android's safe zone.
    # Filling the full layer avoids a visible square seam inside adaptive masks.
    return source.resize((size, size), RESAMPLING).convert("RGBA")


def splash(source: Image.Image, size: tuple[int, int]) -> Image.Image:
    width, height = size
    canvas = Image.new("RGBA", size, BACKGROUND)
    icon_size = max(104, round(min(width, height) * 0.28))
    icon = masked_icon(source, icon_size)
    canvas.alpha_composite(icon, ((width - icon_size) // 2, (height - icon_size) // 2))
    return canvas.convert("RGB")


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    for density, size in ICON_SIZES.items():
        folder = RESOURCE_ROOT / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        masked_icon(source, size).save(folder / "ic_launcher.png", optimize=True)
        masked_icon(source, size, circle=True).save(folder / "ic_launcher_round.png", optimize=True)
        adaptive_foreground(source, round(size * 2.25)).save(folder / "ic_launcher_foreground.png", optimize=True)

    for folder_name, size in SPLASH_SIZES.items():
        folder = RESOURCE_ROOT / folder_name
        folder.mkdir(parents=True, exist_ok=True)
        splash(source, size).save(folder / "splash.png", optimize=True)

    print("Icones e telas de abertura do VoiceUP gerados para Android.")


if __name__ == "__main__":
    main()
