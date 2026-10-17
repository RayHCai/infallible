export const meta = {
  id: 'minimed-780g',
  name: 'MiniMed 780G',
  maker: 'Medtronic',
  kind: 'Tubed · five buttons',
  size: [54, 97, 25],
  weight: '≈106 g without battery',
  reservoir: '300 U cartridge, loaded through the top',
  display: '2.4 in colour LCD, portrait',
  controls: 'Back, Up, Select, Down, Home',
  power: '1 × AA, coin-slot cap on the back',
  water: 'IPX8 · 2.4 m for 30 min',
  notes:
    'Reservoir and tubing connect at the top. SmartGuard auto-mode status sits above the glucose reading.',
  view: 'front',
};

function icon(kind) {
  return (ctx, w, h) => {
    ctx.strokeStyle = ctx.fillStyle = '#e8e9eb';
    ctx.lineWidth = w * 0.09;
    ctx.lineCap = ctx.lineJoin = 'round';
    const c = w / 2,
      m = h / 2,
      s = Math.min(w, h) * 0.3;
    ctx.beginPath();
    if (kind === 'up' || kind === 'down') {
      const d = kind === 'up' ? -1 : 1;
      ctx.moveTo(c - s, m - d * s * 0.6);
      ctx.lineTo(c, m + d * s * 0.6);
      ctx.lineTo(c + s, m - d * s * 0.6);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'select') {
      ctx.arc(c, m, s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c, m, s * 0.45, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'back') {
      ctx.moveTo(c + s, m - s * 0.7);
      ctx.lineTo(c + s, m + s * 0.2);
      ctx.lineTo(c - s * 0.9, m + s * 0.2);
      ctx.moveTo(c - s * 0.2, m - s * 0.5);
      ctx.lineTo(c - s, m + s * 0.2);
      ctx.lineTo(c - s * 0.2, m + s * 0.9);
      ctx.stroke();
    } else if (kind === 'home') {
      ctx.moveTo(c - s, m);
      ctx.lineTo(c, m - s);
      ctx.lineTo(c + s, m);
      ctx.moveTo(c - s * 0.7, m - s * 0.3);
      ctx.lineTo(c - s * 0.7, m + s);
      ctx.lineTo(c + s * 0.7, m + s);
      ctx.lineTo(c + s * 0.7, m - s * 0.3);
      ctx.stroke();
    }
  };
}

function drawHome(ctx, w, h) {
  const u = h / 384;
  const font = (px, wt = 600) => (ctx.font = `${wt} ${px * u}px system-ui, sans-serif`);
  ctx.fillStyle = '#070a0f';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#aab3bd';
  font(18);
  ctx.textAlign = 'left';
  ctx.fillText('10:42', 14 * u, 18 * u);
  // status: reservoir bars, battery
  ctx.fillStyle = '#5fcf7f';
  for (let i = 0; i < 3; i++)
    ctx.fillRect(w - (84 - i * 9) * u, (12 + (2 - i) * 3) * u, 6 * u, (12 - (2 - i) * 3) * u);
  ctx.strokeStyle = '#aab3bd';
  ctx.lineWidth = 2 * u;
  ctx.strokeRect(w - 48 * u, 11 * u, 30 * u, 14 * u);
  ctx.fillRect(w - 17 * u, 14 * u, 3 * u, 8 * u);
  ctx.fillStyle = '#5fcf7f';
  ctx.fillRect(w - 46 * u, 13 * u, 22 * u, 10 * u);
  // SmartGuard shield
  const sx = w / 2,
    sy = 66 * u,
    r = 20 * u;
  ctx.beginPath();
  ctx.moveTo(sx - r, sy - r * 0.9);
  ctx.lineTo(sx + r, sy - r * 0.9);
  ctx.lineTo(sx + r, sy + r * 0.2);
  ctx.quadraticCurveTo(sx + r, sy + r, sx, sy + r * 1.2);
  ctx.quadraticCurveTo(sx - r, sy + r, sx - r, sy + r * 0.2);
  ctx.closePath();
  ctx.fillStyle = '#2fb86a';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4 * u;
  ctx.beginPath();
  ctx.moveTo(sx - 9 * u, sy);
  ctx.lineTo(sx - 2 * u, sy + 8 * u);
  ctx.lineTo(sx + 11 * u, sy - 8 * u);
  ctx.stroke();
  ctx.fillStyle = '#8fd9ab';
  font(13);
  ctx.textAlign = 'center';
  ctx.fillText('SmartGuard', sx, 102 * u);
  // glucose
  ctx.fillStyle = '#ffffff';
  font(92, 700);
  ctx.fillText('121', w / 2 - 14 * u, 150 * u);
  ctx.fillStyle = '#aab3bd';
  font(30, 500);
  ctx.fillText('→', w / 2 + 62 * u, 142 * u);
  font(13);
  ctx.fillText('mg/dL', w / 2 + 62 * u, 166 * u);
  // CGM graph
  const gx = 18 * u,
    gy = 205 * u,
    gw = w - 36 * u,
    gh = 100 * u;
  const yOf = (v) => gy + gh - ((v - 40) / 360) * gh;
  ctx.fillStyle = 'rgba(47,184,106,0.18)';
  ctx.fillRect(gx, yOf(180), gw, yOf(70) - yOf(180));
  ctx.strokeStyle = 'rgba(47,184,106,0.6)';
  ctx.lineWidth = 1.5 * u;
  for (const v of [70, 180]) {
    ctx.beginPath();
    ctx.moveTo(gx, yOf(v));
    ctx.lineTo(gx + gw, yOf(v));
    ctx.stroke();
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3 * u;
  ctx.beginPath();
  for (let i = 0; i <= 36; i++) {
    const t = i / 36;
    const v = 125 + 45 * Math.sin(t * 5.2 + 1) + 18 * Math.sin(t * 13) - 20 * t;
    const x = gx + t * gw,
      y = yOf(v);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#6b7580';
  font(11, 500);
  ['-3h', '-2h', '-1h', 'now'].forEach((l, i) =>
    ctx.fillText(l, gx + (i / 3) * gw, gy + gh + 12 * u),
  );
  // bottom row
  ctx.textAlign = 'left';
  ctx.fillStyle = '#aab3bd';
  font(13);
  ctx.fillText('Active insulin', 18 * u, 348 * u);
  ctx.fillStyle = '#fff';
  font(22, 700);
  ctx.fillText('1.2 U', 18 * u, 368 * u);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#aab3bd';
  font(13);
  ctx.fillText('Last BG 118', w - 18 * u, 348 * u);
}

export function build(h) {
  const { mat, slab, cyl, at, group, screen, decal, text, luerLock, tubing } = h;
  const body = slab(54, 97, 25, 10, 5, mat.plastic(0x1a1c1f));
  const lens = at(slab(44, 54, 1.2, 4, 0.5, mat.glass(0x0a0a0a, { opacity: 0.35 })), [0, 18, 13.1]);
  const lcd = at(screen(36, 48, drawHome), [0, 18, 12.55]);
  const buttonMat = mat.plastic(0x33373c, { roughness: 0.6 });
  const button = (kind, x, y, round) =>
    group(
      at(
        round ? cyl(5.5, 2.2, buttonMat) : slab(10, 8.5, 2.2, 3, 0.9, buttonMat),
        [x, y, 13.4],
        round ? [Math.PI / 2, 0, 0] : [0, 0, 0],
      ),
      at(decal(7, 7, icon(kind)), [x, y, 14.55]),
    );
  const buttons = group(
    button('select', 0, -22, true),
    button('up', 12, -12),
    button('down', 12, -32),
    button('back', -12, -12),
    button('home', -12, -32),
  );
  const brand = at(
    decal(26, 4.5, text('Medtronic', { color: '#cfd3d8', weight: 500, scale: 0.72 })),
    [0, -43.5, 12.56],
  );
  // reservoir port + tubing at the top, offset to the left
  const port = at(cyl(8, 2, mat.plastic(0x2a2d31)), [-12, 49.5, 0]);
  const luer = at(luerLock({ stub: 4 }), [-12, 50.5, 0]);
  const line = tubing([-12, 50.5 + luer.userData.top, 0], 1);
  const sensor = at(cyl(1.2, 0.6, mat.gloss(0x0b0d10)), [16, 48.8, 4]);
  // back: battery cap and belt clip
  const cap = at(cyl(9, 1.4, mat.plastic(0x2b2e32)), [0, -30, -12.6], [Math.PI / 2, 0, 0]);
  const slot = at(slab(12, 1.6, 0.8, 0.5, 0.3, mat.rubber(0x0d0e10)), [0, -30, -13.3]);
  const clipMat = mat.plastic(0x202326, { roughness: 0.55 });
  const clip = group(
    at(slab(16, 10, 4, 2, 1, clipMat), [0, 30, -14.5]),
    at(slab(14, 64, 1.8, 3, 0.8, clipMat), [0, 0, -16.3]),
    at(slab(14, 6, 2.4, 1.5, 0.8, clipMat), [0, -30, -15.9]),
  );
  return group(body, lens, lcd, buttons, brand, port, luer, line, sensor, cap, slot, clip);
}
