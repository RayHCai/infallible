"""Offscreen pump GUI renderer.

Pillow keeps the image small (no SDL/Qt). If richer widgets are needed, swap in
a pygame/Qt offscreen renderer behind the same ``frame()`` function.
"""

import base64
import io

from PIL import Image, ImageDraw, ImageFont

from firmware.emulator.pump import MENU_ITEMS, PumpModel, Screen
from infallible_contracts import FirmwareFrame

_BG = (12, 18, 24)
_FG = (225, 235, 240)
_ACCENT = (80, 200, 255)
_WARN = (255, 170, 60)


def render(pump: PumpModel) -> Image.Image:
    ui = pump.config.ui
    img = Image.new('RGB', (ui.screen_width, ui.screen_height), _BG)
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=ui.font_size)
    small = ImageFont.load_default(size=max(8, ui.font_size - 4))
    pad, line = 8, ui.font_size + 6

    draw.text((pad, 4), f'{pump.reservoir_units:5.1f}U', font=small, fill=_FG)
    draw.text((ui.screen_width - 48, 4), f'{pump.battery_pct}%', font=small, fill=_FG)
    y = 4 + line

    def row(i: int, text: str, *, fill: tuple[int, int, int] = _FG, big: bool = True) -> None:
        draw.text((pad, y + i * line), text, font=font if big else small, fill=fill)

    match pump.screen:
        case Screen.HOME:
            row(0, f'Basal {pump.basal_rate:.2f} U/h')
            row(1, f'Last bolus {pump.bolus_units:.1f} U')
        case Screen.MENU:
            for i, item in enumerate(MENU_ITEMS):
                selected = i == pump.menu_index
                row(i, ('> ' if selected else '  ') + item, fill=_ACCENT if selected else _FG)
        case Screen.BOLUS_ENTRY:
            row(0, 'Bolus')
            row(1, f'{pump.pending_bolus:.1f} U', fill=_ACCENT)
        case Screen.BOLUS_CONFIRM:
            row(0, f'Deliver {pump.pending_bolus:.1f} U?')
            row(1, 'OK=yes  BACK=no', big=False)
        case Screen.DELIVERING:
            row(0, 'Delivering...', fill=_ACCENT)
            row(1, f'{pump.delivering_remaining:.2f} U left')
        case Screen.BASAL_VIEW:
            row(0, f'Basal {pump.basal_rate:.2f} U/h')
        case Screen.ALARM:
            row(0, 'ALARM', fill=_WARN)
            row(1, ', '.join(pump.alarms), fill=_WARN, big=False)
    return img


def frame(pump: PumpModel, *, drain_audio: bool = True) -> FirmwareFrame:
    img = render(pump)
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    return FirmwareFrame(
        png_b64=base64.b64encode(buf.getvalue()).decode('ascii'),
        width=img.width,
        height=img.height,
        audio=pump.drain_audio() if drain_audio else [],
    )
