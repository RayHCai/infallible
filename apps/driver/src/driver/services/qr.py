import base64
import io
from typing import TYPE_CHECKING

import qrcode

if TYPE_CHECKING:
    from infallible_contracts import QrPayload


def qr_png_b64(payload: QrPayload) -> str:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=2)
    qr.add_data(payload.model_dump_json())
    qr.make(fit=True)
    buf = io.BytesIO()
    qr.make_image(fill_color='black', back_color='white').save(buf)
    return base64.b64encode(buf.getvalue()).decode('ascii')
