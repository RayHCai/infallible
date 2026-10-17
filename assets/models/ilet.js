export const meta = {
  id: 'ilet',
  name: 'iLet Bionic Pancreas',
  maker: 'Beta Bionics',
  kind: 'Tubed · touchscreen',
  size: [49.8, 90.9, 15],
  weight: '≈110 g with full cartridge',
  reservoir: '180 U cartridge (prefilled or self-filled)',
  display: '3.5 in colour touchscreen',
  controls: 'Touchscreen only. Meals are announced as Usual / More / Less, no carb counting.',
  power: 'Rechargeable',
  water: 'IPX8 · 3.7 m for 30 min',
  notes:
    'Phone-sized body with the display covering almost the whole front. Tubing leaves through a luer-lock at the top.',
  view: 'front',
};

function drawHome(ctx, w, h) {
  const u = h / 608;
  const font = (px, wt = 600) => (ctx.font = `${wt} ${px * u}px system-ui, sans-serif`);
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#c3cad3';
  font(20);
  ctx.textAlign = 'left';
  ctx.fillText('9:41', 22 * u, 28 * u);
  ctx.textAlign = 'right';
  ctx.fillText('132 U', w - 60 * u, 28 * u);
  ctx.strokeStyle = '#c3cad3';
  ctx.lineWidth = 2 * u;
  ctx.strokeRect(w - 50 * u, 20 * u, 28 * u, 16 * u);
  ctx.fillRect(w - 21 * u, 24 * u, 3 * u, 8 * u);
  ctx.fillStyle = '#4ad48a';
  ctx.fillRect(w - 48 * u, 22 * u, 20 * u, 12 * u);
  // glucose
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8c96a3';
  font(18, 500);
  ctx.fillText('GLUCOSE', w / 2, 86 * u);
  ctx.fillStyle = '#fff';
  font(132, 700);
  ctx.fillText('128', w / 2 - 22 * u, 160 * u);
  ctx.fillStyle = '#d4d8de';
  font(44, 500);
  ctx.fillText('↗', w / 2 + 86 * u, 150 * u);
  font(18);
  ctx.fillText('mg/dL', w / 2 + 86 * u, 184 * u);
  // 3h graph
  const gx = 24 * u,
    gy = 236 * u,
    gw = w - 48 * u,
    gh = 130 * u;
  const yOf = (v) => gy + gh - ((v - 40) / 320) * gh;
  ctx.fillStyle = 'rgba(45,180,160,0.16)';
  ctx.fillRect(gx, yOf(180), gw, yOf(70) - yOf(180));
  ctx.strokeStyle = 'rgba(45,180,160,0.7)';
  ctx.lineWidth = 1.5 * u;
  for (const v of [70, 180]) {
    ctx.beginPath();
    ctx.moveTo(gx, yOf(v));
    ctx.lineTo(gx + gw, yOf(v));
    ctx.stroke();
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.5 * u;
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const v = 150 - 40 * t + 25 * Math.sin(t * 6 + 2) + 8 * Math.sin(t * 19);
    const x = gx + t * gw,
      y = yOf(v);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#6f7a87';
  font(14, 500);
  ['-3h', '-2h', '-1h', 'now'].forEach((l, i) =>
    ctx.fillText(l, gx + (i / 3) * gw, gy + gh + 16 * u),
  );
  // status rows
  const row = (y, label, value, color = '#fff') => {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8c96a3';
    font(17, 500);
    ctx.fillText(label, 24 * u, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    font(17, 600);
    ctx.fillText(value, w - 24 * u, y);
    ctx.fillStyle = '#1d2530';
    ctx.fillRect(24 * u, y + 20 * u, w - 48 * u, 1.5 * u);
  };
  row(412 * u, 'Insulin delivery', '● On', '#4ad48a');
  row(456 * u, 'Last meal', 'Usual · 11:50 AM');
  // meal announcement button
  ctx.fillStyle = '#2d7ff9';
  ctx.beginPath();
  ctx.roundRect(24 * u, 508 * u, w - 48 * u, 64 * u, 14 * u);
  ctx.fill();
  ctx.fillStyle = '#fff';
  font(22, 700);
  ctx.textAlign = 'center';
  ctx.fillText('Announce meal', w / 2, 540 * u);
}

export function build(h) {
  const { mat, slab, cyl, at, group, screen, decal, text, luerLock, tubing } = h;
  const body = slab(49.8, 90.9, 15, 8, 3.5, mat.plastic(0x17191c, { roughness: 0.5 }));
  const glass = at(
    slab(47.2, 88.3, 1.0, 6.8, 0.4, mat.glass(0x05060a, { opacity: 0.45 })),
    [0, 0, 7.6],
  );
  const lcd = at(screen(43, 76, drawHome), [0, 2.5, 7.12]);
  const brand = at(
    decal(16, 4, text('iLet', { color: '#aeb4bc', weight: 700, scale: 0.8 })),
    [0, -41.5, 7.13],
  );
  const sideBtn = at(slab(2, 10, 3.2, 0.8, 0.6, mat.plastic(0x2a2d31)), [25.4, 22, 0]);
  const port = at(cyl(7.5, 1.6, mat.plastic(0x2a2d31)), [-12, 45.6, 0]);
  const luer = at(luerLock({ stub: 4 }), [-12, 46.3, 0]);
  const line = tubing([-12, 46.3 + luer.userData.top, 0], 1);
  const speaker = group(
    ...[-6, -3, 0, 3, 6].map((x) =>
      at(cyl(0.6, 0.6, mat.rubber(0x0a0b0d)), [x, -36, -7.3], [Math.PI / 2, 0, 0]),
    ),
  );
  const backLabel = at(
    decal(30, 5, text('Beta Bionics', { color: '#7b8189', weight: 600, scale: 0.6 })),
    [0, 0, -7.52],
    [0, Math.PI, 0],
  );
  return group(body, glass, lcd, brand, sideBtn, port, luer, line, speaker, backLabel);
}
