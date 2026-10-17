export const meta = {
  id: 'tslim-x2',
  name: 't:slim X2',
  maker: 'Tandem Diabetes Care',
  kind: 'Tubed · touchscreen',
  size: [50.8, 79.5, 15.2],
  weight: '≈112 g with full cartridge',
  reservoir: '300 U cartridge clipped to the back',
  display: 'Colour touchscreen, portrait',
  controls: 'Touchscreen · Screen On/Quick Bolus button on the top edge',
  power: 'Rechargeable, micro-USB on the top edge',
  water: 'IPX7 · 0.9 m for 30 min',
  notes:
    'Tubing leaves the cartridge through a luer-lock at the top-left corner. OPTIONS and BOLUS fill the bottom of the home screen.',
  view: 'front',
};

function drawHome(ctx, w, h) {
  const u = h / 384;
  const font = (px, wt = 600) => (ctx.font = `${wt} ${px * u}px system-ui, sans-serif`);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  // status bar
  ctx.strokeStyle = '#9fa7b2';
  ctx.lineWidth = 2 * u;
  ctx.strokeRect(12 * u, 11 * u, 26 * u, 13 * u);
  ctx.fillStyle = '#9fa7b2';
  ctx.fillRect(38 * u, 14 * u, 3 * u, 7 * u);
  ctx.fillStyle = '#48c774';
  ctx.fillRect(14 * u, 13 * u, 19 * u, 9 * u);
  ctx.fillStyle = '#e6e9ee';
  font(15);
  ctx.textAlign = 'center';
  ctx.fillText('245 u', w / 2, 18 * u);
  ctx.textAlign = 'right';
  ctx.fillText('3:21 PM', w - 12 * u, 18 * u);
  // Control-IQ marker
  ctx.fillStyle = '#3d7bff';
  ctx.beginPath();
  ctx.arc(w / 2, 48 * u, 9 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  font(11, 700);
  ctx.textAlign = 'center';
  ctx.fillText('IQ', w / 2, 48 * u);
  // CGM
  ctx.fillStyle = '#fff';
  font(84, 700);
  ctx.fillText('112', w / 2 - 16 * u, 100 * u);
  ctx.fillStyle = '#d4d8de';
  font(30, 500);
  ctx.fillText('→', w / 2 + 58 * u, 94 * u);
  font(12);
  ctx.fillText('mg/dL', w / 2 + 58 * u, 116 * u);
  // graph
  const gx = 14 * u,
    gy = 146 * u,
    gw = w - 28 * u,
    gh = 84 * u;
  const yOf = (v) => gy + gh - ((v - 40) / 320) * gh;
  ctx.fillStyle = 'rgba(61,123,255,0.16)';
  ctx.fillRect(gx + gw * 0.55, gy, gw * 0.45, gh);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1 * u;
  for (const v of [70, 180]) {
    ctx.beginPath();
    ctx.moveTo(gx, yOf(v));
    ctx.lineTo(gx + gw, yOf(v));
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const v = 140 + 30 * Math.cos(t * 4.5) - 25 * t + 10 * Math.sin(t * 15);
    ctx.beginPath();
    ctx.arc(gx + t * gw, yOf(v), 2 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#8b94a0';
  font(10, 500);
  ctx.textAlign = 'left';
  ctx.fillText('3 HRS', gx, gy + gh + 10 * u);
  ctx.textAlign = 'right';
  ctx.fillText('70 – 180', gx + gw, gy + gh + 10 * u);
  // IOB row
  ctx.fillStyle = '#e6e9ee';
  font(14);
  ctx.textAlign = 'left';
  ctx.fillText('IOB  1.3 u', 14 * u, 258 * u);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8b94a0';
  ctx.fillText('2:30 hrs', w - 14 * u, 258 * u);
  // buttons
  const bh = 44 * u,
    by = 288 * u,
    bw = (w - 36 * u) / 2;
  for (const [i, label, color] of [
    [0, 'OPTIONS', '#2a2f37'],
    [1, 'BOLUS', '#1e4fa8'],
  ]) {
    const x = 12 * u + i * (bw + 12 * u);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, by, bw, bh, 8 * u);
    ctx.fill();
    ctx.fillStyle = '#fff';
    font(16, 700);
    ctx.textAlign = 'center';
    ctx.fillText(label, x + bw / 2, by + bh / 2);
  }
  ctx.fillStyle = '#6b7480';
  font(11, 500);
  ctx.fillText('t:slim X2', w / 2, 358 * u);
}

export function build(h) {
  const { mat, slab, cyl, at, group, screen, decal, text, luerLock, tubing } = h;
  const shell = at(
    slab(50.8, 79.5, 13, 6, 2.6, mat.plastic(0x121315, { roughness: 0.45 })),
    [0, 0, -1.1],
  );
  const rim = at(slab(50.8, 79.5, 2.4, 6, 0.9, mat.metal(0xd2d4d7)), [0, 0, 6.5]);
  const glass = at(
    slab(47.6, 76.3, 1.0, 4.8, 0.4, mat.glass(0x05060a, { opacity: 0.45 })),
    [0, 0, 8.0],
  );
  const lcd = at(screen(38, 48, drawHome), [0, 7, 7.62]);
  const brand = at(
    decal(22, 4.2, text('tandem', { color: '#c9ced6', weight: 600, scale: 0.78 })),
    [0, -32, 7.63],
  );
  // top edge: quick-bolus button, micro-USB, luer-lock from the cartridge
  const bolusBtn = at(cyl(2.8, 1.4, mat.plastic(0x1a1b1e)), [6, 40.4, 0]);
  const usb = at(slab(7.4, 1.2, 2.6, 0.5, 0.4, mat.rubber(0x0b0c0e)), [18, 39.9, 0]);
  const luer = at(luerLock({ stub: 4.5 }), [-17, 39.6, -2]);
  const line = tubing([-17, 39.6 + luer.userData.top, -2], -1);
  // cartridge on the back
  const cartMat = mat.plastic(0x2c2f33, { roughness: 0.75 });
  const cart = at(slab(46, 56, 2.2, 4, 0.9, cartMat), [0, -8, -8.3]);
  const cartLabel = at(
    decal(30, 5, text('t:slim cartridge · 300 u', { color: '#9aa1aa', weight: 500, scale: 0.55 })),
    [0, -20, -9.42],
    [0, Math.PI, 0],
  );
  const fillPort = at(cyl(2.2, 0.8, mat.plastic(0xe8e8e4)), [12, -30, -9.6], [Math.PI / 2, 0, 0]);
  const cartNeck = at(slab(10, 16, 6, 3, 2, cartMat), [-17, 32, -5]);
  return group(
    shell,
    rim,
    glass,
    lcd,
    brand,
    bolusBtn,
    usb,
    luer,
    line,
    cart,
    cartLabel,
    fillPort,
    cartNeck,
  );
}
