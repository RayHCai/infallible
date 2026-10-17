// Generic 6.1 in smartphone used as the companion controller for
// app-driven pumps. The screen shows that pump's app home screen.
export const meta = {
  id: 'phone',
  name: 'Companion phone',
  maker: 'Generic',
  kind: 'Controller · smartphone',
  size: [71.5, 147, 7.8],
  weight: '≈170 g',
  reservoir: '—',
  display: '6.1 in OLED, edge to edge',
  controls: 'Touchscreen, power and volume keys',
  power: 'Rechargeable, USB-C',
  water: 'IP68',
  notes:
    'Stand-in for whichever phone runs the pump app. Mobi is controlled only from the app; Omnipod 5 from the app or its handheld controller.',
  view: 'front',
};

export const defaultApp = {
  title: 'Pump app',
  accent: '#1f5fd6',
  status: 'Pump · Connected',
  mode: 'Automated delivery',
  modeDetail: 'Target 110 mg/dL',
  cgm: '121',
  trend: '→',
  tiles: [
    ['Insulin', '162 U'],
    ['IOB', '1.3 U'],
    ['Battery', '84%'],
  ],
  action: 'Bolus',
};

export function drawApp(a) {
  return (ctx, w, h) => {
    const u = h / 840;
    const font = (px, wt = 500) =>
      (ctx.font = `${wt} ${px * u}px system-ui, -apple-system, sans-serif`);
    const card = (x, y, cw, ch, fill = '#fff') => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(x, y, cw, ch, 16 * u);
      ctx.fill();
    };
    // rounded screen corners: outside the clip stays transparent
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 42 * u);
    ctx.clip();
    ctx.fillStyle = '#f2f4f7';
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    // status bar + punch-hole camera
    ctx.fillStyle = '#111';
    font(17, 600);
    ctx.textAlign = 'left';
    ctx.fillText('9:41', 28 * u, 30 * u);
    for (let i = 0; i < 4; i++)
      ctx.fillRect(w - (92 - i * 7) * u, (36 - (i + 1) * 3) * u, 5 * u, (i + 1) * 3 * u);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2 * u;
    ctx.strokeRect(w - 54 * u, 22 * u, 26 * u, 14 * u);
    ctx.fillRect(w - 27 * u, 26 * u, 3 * u, 6 * u);
    ctx.fillRect(w - 52 * u, 24 * u, 20 * u, 10 * u);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(w / 2, 30 * u, 9 * u, 0, Math.PI * 2);
    ctx.fill();
    // header + connection pill
    ctx.fillStyle = '#111';
    font(28, 700);
    ctx.fillText(a.title, 24 * u, 86 * u);
    font(15, 600);
    const pw = ctx.measureText(a.status).width + 40 * u;
    ctx.fillStyle = '#e4f5ea';
    ctx.beginPath();
    ctx.roundRect(24 * u, 108 * u, pw, 30 * u, 15 * u);
    ctx.fill();
    ctx.fillStyle = '#1f9d55';
    ctx.beginPath();
    ctx.arc(40 * u, 123 * u, 5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#176b3c';
    ctx.fillText(a.status, 52 * u, 123 * u);
    // mode card
    card(24 * u, 156 * u, w - 48 * u, 64 * u, a.accent);
    ctx.fillStyle = '#fff';
    font(19, 700);
    ctx.fillText(a.mode, 44 * u, 178 * u);
    font(14, 500);
    ctx.globalAlpha = 0.85;
    ctx.fillText(a.modeDetail, 44 * u, 202 * u);
    ctx.globalAlpha = 1;
    // glucose card
    card(24 * u, 236 * u, w - 48 * u, 250 * u);
    ctx.fillStyle = '#6b7280';
    font(14, 600);
    ctx.fillText('GLUCOSE', 44 * u, 262 * u);
    ctx.fillStyle = '#111';
    font(84, 700);
    ctx.fillText(a.cgm, 44 * u, 316 * u);
    const tw = ctx.measureText(a.cgm).width;
    ctx.fillStyle = '#374151';
    font(40, 500);
    ctx.fillText(a.trend, 44 * u + tw + 14 * u, 310 * u);
    ctx.fillStyle = '#6b7280';
    font(14, 500);
    ctx.fillText('mg/dL', 44 * u + tw + 14 * u, 338 * u);
    const gx = 44 * u,
      gy = 366 * u,
      gw = w - 88 * u,
      gh = 96 * u;
    const yOf = (v) => gy + gh - ((v - 40) / 320) * gh;
    ctx.fillStyle = 'rgba(31,157,85,0.12)';
    ctx.fillRect(gx, yOf(180), gw, yOf(70) - yOf(180));
    ctx.strokeStyle = a.accent;
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const v = 135 + 30 * Math.sin(t * 5 + 1) - 15 * t + 8 * Math.sin(t * 17);
      const x = gx + t * gw,
        y = yOf(v);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#9ca3af';
    font(12, 500);
    ctx.textAlign = 'center';
    ['-3h', '-2h', '-1h', 'now'].forEach((l, i) =>
      ctx.fillText(l, gx + (i / 3) * gw, gy + gh + 14 * u),
    );
    // tiles
    const tw3 = (w - 72 * u) / 3;
    a.tiles.forEach(([k, v], i) => {
      const x = 24 * u + i * (tw3 + 12 * u);
      card(x, 502 * u, tw3, 84 * u);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#6b7280';
      font(11, 600);
      ctx.fillText(k.toUpperCase(), x + 14 * u, 526 * u);
      ctx.fillStyle = '#111';
      font(20, 700);
      ctx.fillText(v, x + 14 * u, 558 * u);
    });
    // primary action
    card(24 * u, 606 * u, w - 48 * u, 60 * u, a.accent);
    ctx.fillStyle = '#fff';
    font(20, 700);
    ctx.textAlign = 'center';
    ctx.fillText(a.action, w / 2, 636 * u);
    // tab bar + home indicator
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, h - 90 * u, w, 90 * u);
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(0, h - 90 * u, w, 1 * u);
    ['Home', 'History', 'Settings'].forEach((l, i) => {
      const x = (w / 3) * (i + 0.5);
      ctx.fillStyle = i === 0 ? a.accent : '#9ca3af';
      ctx.beginPath();
      ctx.roundRect(x - 12 * u, h - 76 * u, 24 * u, 24 * u, 6 * u);
      ctx.fill();
      font(12, 600);
      ctx.fillText(l, x, h - 38 * u);
    });
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.roundRect(w / 2 - 60 * u, h - 12 * u, 120 * u, 5 * u, 3 * u);
    ctx.fill();
  };
}

export function build(h, app = defaultApp) {
  const { mat, slab, cyl, at, group, screen } = h;
  const frameMat = mat.metal(0x3a3d42, { roughness: 0.45, metalness: 0.85 });
  const dark = mat.gloss(0x1d1f23);
  const frame = slab(71.5, 147, 6, 11, 1.2, frameMat);
  const back = at(slab(69, 144.5, 0.9, 10, 0.35, dark), [0, 0, -3.45]);
  const front = at(
    slab(69, 144.5, 0.9, 10, 0.35, mat.glass(0x05060a, { opacity: 0.4 })),
    [0, 0, 3.45],
  );
  const lcd = at(screen(64, 139.5, drawApp(app), { res: 6, transparent: true }), [0, 0, 3.05]);
  const bump = at(slab(26, 26, 1.6, 8, 0.6, dark), [-18, 52, -4.6]);
  const lens = (x, y) =>
    group(
      at(cyl(5.5, 1, mat.gloss(0x0b0c10)), [x, y, -5.6], [Math.PI / 2, 0, 0]),
      at(cyl(3, 0.4, mat.gloss(0x1a2a5c)), [x, y, -6.2], [Math.PI / 2, 0, 0]),
    );
  const flash = at(cyl(2, 0.4, mat.plastic(0xf5e6b8)), [-13, 57, -5.5], [Math.PI / 2, 0, 0]);
  const power = at(slab(1.4, 14, 3.2, 0.6, 0.5, frameMat), [36.2, 30, 0]);
  const volume = group(
    at(slab(1.4, 10, 3.2, 0.6, 0.5, frameMat), [-36.2, 38, 0]),
    at(slab(1.4, 10, 3.2, 0.6, 0.5, frameMat), [-36.2, 24, 0]),
    at(slab(1.4, 6, 3.2, 0.6, 0.5, frameMat), [-36.2, 52, 0]),
  );
  const usb = at(
    slab(9, 3.2, 1.2, 1.5, 0.5, mat.rubber(0x0b0c0e)),
    [0, -73.3, 0],
    [Math.PI / 2, 0, 0],
  );
  return group(
    frame,
    back,
    front,
    lcd,
    bump,
    lens(-23, 57),
    lens(-13, 47),
    flash,
    power,
    volume,
    usb,
  );
}
