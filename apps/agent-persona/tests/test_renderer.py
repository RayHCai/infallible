from PIL import Image

from agent_persona.modifiers.vision import blur
from agent_persona.perception import contrast, in_frame
from agent_persona.renderer import OUTPUT_SIZE, Camera, CompositeRenderer
from infallible_contracts import BoxRegion, MeshAnnotations


def _renderer() -> CompositeRenderer:
    return CompositeRenderer(
        MeshAnnotations(
            screen=BoxRegion(id='screen', x=0.1, y=0.1, w=0.8, h=0.35),
            buttons=[BoxRegion(id='ok', x=0.4, y=0.7, w=0.2, h=0.12)],
        )
    )


def test_render_has_fixed_output_size() -> None:
    out = _renderer().render(Image.new('RGB', (240, 160), 'white'), Camera())
    assert out.size == OUTPUT_SIZE


def test_camera_is_clamped() -> None:
    cam = Camera()
    cam.rotate('x', 500)
    cam.zoom(10)
    assert cam.pitch_deg == 80.0
    assert cam.distance == 0.3


def _pump() -> CompositeRenderer:
    return CompositeRenderer(
        MeshAnnotations(
            screen=BoxRegion(id='screen', x=0.1, y=0.1, w=0.8, h=0.35),
            buttons=[
                BoxRegion(id='menu', x=0.1, y=0.52, w=0.2, h=0.12),
                BoxRegion(id='up', x=0.4, y=0.52, w=0.2, h=0.12),
                BoxRegion(id='ok', x=0.7, y=0.72, w=0.2, h=0.12),
            ],
        )
    )


def test_default_view_shows_every_button() -> None:
    assert all(in_frame(b) == 1.0 for b in _pump().button_boxes(Camera()).values())


def test_zooming_in_pushes_outer_buttons_out_of_frame() -> None:
    cam = Camera()
    cam.zoom(10)
    frac = {k: in_frame(b) for k, b in _pump().button_boxes(cam).items()}
    assert frac['up'] == 1.0
    assert frac['menu'] < 0.5
    assert frac['ok'] == 0.0


def test_projection_matches_rendered_pixels() -> None:
    r = _pump()
    cam = Camera(roll_deg=30, distance=0.8)
    out = r.render(Image.new('RGB', (240, 160), 'black'), cam)
    project = r._projector(cam)
    for b in r.annotations.buttons:
        # Left of centre to stay clear of the drawn label.
        x, y = project(b.x + 0.2 * b.w, b.y + b.h / 2)
        assert out.getpixel((int(x), int(y))) == (150, 156, 164), b.id


def test_button_contrast_fades_with_blur() -> None:
    r, cam = _pump(), Camera()
    screen = Image.new('RGB', (240, 160), 'white')
    view, bare = r.render(screen, cam), r.render(screen, cam, buttons=False)
    box = r.button_boxes(cam)['up']
    sharp = contrast(view, bare, box)
    blurred = contrast(blur(view, sigma=20), blur(bare, sigma=20), box)
    assert sharp > 0.9
    assert 0 < blurred < sharp
    assert contrast(bare, bare, box) == 0.0
