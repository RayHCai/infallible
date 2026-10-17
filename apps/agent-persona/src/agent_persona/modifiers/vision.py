from typing import Any

from PIL import Image, ImageEnhance, ImageFilter

# Colour-vision-deficiency simulation matrices (Machado et al. 2009, severity 1.0),
# flattened into PIL's 12-tuple RGB->RGB convert() format.
_CVD: dict[str, tuple[float, ...]] = {
    'protanopia': (0.152, 1.053, -0.205, 0, 0.115, 0.786, 0.099, 0, -0.004, -0.048, 1.052, 0),
    'deuteranopia': (0.367, 0.861, -0.228, 0, 0.280, 0.673, 0.047, 0, -0.012, 0.043, 0.969, 0),
    'tritanopia': (1.256, -0.077, -0.179, 0, -0.078, 0.931, 0.148, 0, 0.005, 0.691, 0.304, 0),
}


def blur(img: Image.Image, sigma: float = 2.0, **_: Any) -> Image.Image:
    return img.filter(ImageFilter.GaussianBlur(radius=sigma))


def contrast_loss(img: Image.Image, factor: float = 0.5, **_: Any) -> Image.Image:
    return ImageEnhance.Contrast(img).enhance(factor)


def color_deficiency(img: Image.Image, kind: str = 'deuteranopia', **_: Any) -> Image.Image:
    return img.convert('RGB').convert('RGB', _CVD[kind])
