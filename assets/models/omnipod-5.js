export const meta = {
  id: 'omnipod-5',
  name: 'Omnipod 5 Pod',
  maker: 'Insulet',
  kind: 'Tubeless patch pump',
  size: [38.9, 52, 14.5],
  weight: '≈26 g empty',
  reservoir: '200 U, filled by syringe through the fill port',
  display: 'None · controlled from the handheld controller or phone app',
  controls: 'No buttons. Status LED and beeps only.',
  power: 'Built-in battery, 72 h wear then discarded',
  water: 'IP28 · 7.6 m for 60 min',
  notes:
    'Auto-inserting cannula under the viewing window at the narrow end. A pink slide behind the window confirms the cannula fired.',
  view: 'iso',
};

export function build(h) {
  const { mat, slab, cyl, at, group } = h;
  const flat = [-Math.PI / 2, 0, 0]; // slab XY plane -> world XZ, thickness up
  const white = mat.plastic(0xf5f5f3, {
    roughness: 0.32,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
  });
  const adhesive = at(
    slab(58, 74, 0.6, 24, 0.25, mat.rubber(0xefeee9, { roughness: 0.98 })),
    [0, 0.3, 1],
    flat,
  );
  const base = at(slab(38.9, 52, 6, 14, 1, white), [0, 3, 0], flat);
  // the upper shell's lower bevel is buried in the base so only the top edge rounds
  const shell = at(slab(38.9, 52, 14.5, 14, 6, white), [0, 7.25, 0], flat);
  // cannula viewing window at the narrow (-Z) end with the pink fired-indicator behind it
  const window = at(
    slab(8, 4, 3, 1.2, 0.8, mat.glass(0xffffff, { opacity: 0.35 })),
    [5, 2.6, -25.6],
  );
  const pink = at(slab(4, 2, 1.2, 0.5, 0.3, mat.plastic(0xf05a9a)), [5, 2.6, -25.9]);
  const cannula = at(
    cyl(0.3, 2.4, mat.plastic(0x8fd0ff, { transparent: true, opacity: 0.7 })),
    [5, 1.8, -24.2],
  );
  // top plateau: fill port and status LED
  const fillPort = at(cyl(1.8, 0.6, mat.plastic(0x4a4e55)), [-8, 14.4, 17]);
  const fillRing = at(cyl(2.6, 0.3, mat.plastic(0xd9d9d4)), [-8, 14.55, 17]);
  const led = at(cyl(1.2, 0.4, mat.led(0xffb13b, false)), [8, 14.55, 17]);
  const seam = at(cyl(0.01, 0.01, white), [0, 0, 0]); // keeps group non-empty when decals are skipped
  return group(adhesive, base, shell, window, pink, cannula, fillPort, fillRing, led, seam);
}

// The pod is controlled from the Omnipod 5 app or its handheld controller.
export const companion = {
  side: 1,
  rotationY: 0.5,
  app: {
    title: 'Omnipod 5',
    accent: '#4b3fc4',
    status: 'Pod · 2d 4h left',
    mode: 'Automated Mode',
    modeDetail: 'Target 110 mg/dL',
    cgm: '128',
    trend: '↗',
    tiles: [
      ['Insulin left', '120+ U'],
      ['Last bolus', '2.5 U'],
      ['IOB', '0.8 U'],
    ],
    action: 'Bolus',
  },
};
