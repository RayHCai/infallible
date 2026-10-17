export const meta = {
  id: 'tandem-mobi',
  name: 'Mobi',
  maker: 'Tandem Diabetes Care',
  kind: 'Tubed · phone-controlled',
  size: [51.3, 37.3, 14.2],
  weight: '≈30 g with full cartridge',
  reservoir: '200 U cartridge inserted at the tubing end',
  display: 'None · status LED only',
  controls: 'One physical button (quick bolus). Everything else is on the phone app.',
  power: 'Rechargeable, wireless charging pad',
  water: 'IP28 · 2.4 m for 2 h',
  notes:
    'Worn in a clip or adhesive sleeve. Without a screen, the only on-device feedback is the LED and the button.',
  view: 'front',
};

export function build(h) {
  const { mat, slab, cyl, at, group, decal, text, luerLock, tubing } = h;
  const grey = mat.plastic(0xdcddd9, { roughness: 0.45, clearcoat: 0.4 });
  const body = at(slab(40.3, 37.3, 14.2, 9, 5, grey), [-5.5, 0, 0]);
  // translucent cartridge section with the reservoir visible inside
  const clear = mat.glass(0xf2f4f6, { opacity: 0.42, roughness: 0.1 });
  const cart = at(slab(12.5, 36.5, 13.6, 6.1, 4.2, clear), [19.4, 0, 0]);
  const reservoir = at(cyl(4.6, 11, mat.plastic(0xf7f7f4)), [19.4, 0, 0], [0, 0, Math.PI / 2]);
  const plunger = at(cyl(4.7, 1.2, mat.plastic(0x3a3d42)), [15.2, 0, 0], [0, 0, Math.PI / 2]);
  // face: bolus button, LED, logo
  const button = at(
    cyl(5, 1.6, mat.plastic(0x1b1c1f, { roughness: 0.5 })),
    [-10, 0, 7.5],
    [Math.PI / 2, 0, 0],
  );
  const led = at(cyl(1, 0.3, mat.led(0x3ec1ff)), [-1, 9.5, 7.1], [Math.PI / 2, 0, 0]);
  const logo = at(
    decal(14, 3, text('tandem', { color: '#6f737a', weight: 600, scale: 0.8 })),
    [4, -8, 7.12],
  );
  // luer-lock and tubing leave the cartridge end along +X
  const luer = luerLock({ stub: 3.5 });
  const line = tubing([0, luer.userData.top, 0], -1);
  const outlet = at(group(luer, line), [25.65, 0, 0], [0, 0, -Math.PI / 2]);
  // back: charging coil mark
  const coil = at(
    cyl(9, 0.3, mat.plastic(0xcfd0cc), { seg: 48 }),
    [-5.5, 0, -7.1],
    [Math.PI / 2, 0, 0],
  );
  return group(body, cart, reservoir, plunger, button, led, logo, outlet, coil);
}

// Mobi has no screen of its own: the phone app is the primary interface.
export const companion = {
  side: -1,
  rotationY: 0.3,
  app: {
    title: 'Tandem Mobi',
    accent: '#1e5fd6',
    status: 'Mobi · Connected',
    mode: 'Control-IQ',
    modeDetail: 'Sleep activity until 7:00 AM',
    cgm: '121',
    trend: '→',
    tiles: [
      ['Insulin', '162 u'],
      ['IOB', '1.3 u'],
      ['Pump battery', '84%'],
    ],
    action: 'Bolus',
  },
};
