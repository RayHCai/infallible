/* Shared dummy data for the static design mockups. Plain script so file:// works.
   Exposes window.MOCK. Nothing here talks to the driver. */
(function () {
  const personas = [
    {
      id: 'p-control',
      name: 'Healthy control',
      long: 'Control (healthy adult)',
      age: 25,
      gender: 'unspecified',
      blurb: 'Experienced pump user. Rested, focused, reads every screen.',
      modifiers: [],
    },
    {
      id: 'p-routine',
      name: 'Routine-driven adult',
      long: 'Middle-aged adult, self-managing, routine-driven shortcuts',
      age: 51,
      gender: 'female',
      blurb: 'Confident, does steps from memory, taps through confirmations.',
      modifiers: [],
    },
    {
      id: 'p-lowvision',
      name: 'Low-vision older adult',
      long: 'Older adult, self-managing, low vision',
      age: 75,
      gender: 'female',
      blurb: 'Small print is blurry and low-contrast; misses quiet beeps.',
      modifiers: [
        { id: 'blur', label: 'blur', params: { sigma: 2.5 } },
        { id: 'contrast_loss', label: 'contrast loss', params: { factor: 0.5 } },
        { id: 'hearing_loss', label: 'hearing loss', params: { severity: 0.3 } },
      ],
    },
    {
      id: 'p-teen',
      name: 'Rushed teen',
      long: 'Teen, self-managing, inconsistent and rushed',
      age: 16,
      gender: 'unspecified',
      blurb: 'Skims, dismisses alerts, overrides the calculator.',
      modifiers: [],
    },
    {
      id: 'p-tremor',
      name: 'Tremor & neuropathy',
      long: 'Older adult, self-managing, hand dexterity limits and tremor',
      age: 72,
      gender: 'male',
      blurb: 'Stiff, shaky hands; cannot feel whether a button clicked.',
      modifiers: [
        { id: 'tremor', label: 'tremor', params: { amplitude: 0.35 } },
        { id: 'neuropathy', label: 'neuropathy', params: { severity: 0.3 } },
        { id: 'blur', label: 'blur', params: { sigma: 2.5 } },
      ],
    },
  ];

  const tasks = [
    {
      id: 't-alarm',
      name: 'Lunch bolus through a low-reservoir alarm',
      short: 'Bolus during alarm',
      description:
        "I'm about to eat lunch and need my usual 4.5 units before I start. The pump is beeping about the reservoir being low, and I'm worried the bolus won't go through. I want to get exactly 4.5 units in, once.",
      goal: 'Deal with the low-reservoir alarm, then deliver a single meal bolus of exactly 4.5 U. Do not give a second bolus. If unsure whether it delivered, check the last bolus amount rather than repeating it.',
      success: 'bolus_units == 4.5 and 13.4 <= reservoir_units <= 13.6',
      maxSteps: 70,
    },
    {
      id: 't-cannula',
      name: 'Fill cannula after a new infusion set',
      short: 'Fill cannula',
      description:
        'I just put in a fresh infusion set and pulled out the introducer needle. The cannula needs 0.5 units pushed into it. Last time I skipped this and ran high all afternoon.',
      goal: 'Fill the cannula by delivering exactly 0.5 U through the Bolus menu. An unconfirmed entry is silently dropped after 30 seconds. Finish back on the home screen.',
      success: "bolus_units == 0.5 and pending_bolus_units == 0 and screen == 'home'",
      maxSteps: 30,
    },
    {
      id: 't-cartridge',
      name: 'Lunch bolus right after a cartridge change',
      short: 'Bolus after cartridge',
      description:
        "I just swapped in a fresh cartridge, filled the tubing while unhooked, and clipped the set back on. Now I just want my 3 units for lunch. I don't want any extra insulin from the change.",
      goal: 'Deliver the 3.0 U lunch bolus and nothing else. Do not deliver any fill or flush amount now that you are connected.',
      success: '2.95 <= bolus_units <= 3.05 and pending_bolus_units == 0',
      maxSteps: 50,
    },
    {
      id: 't-basal',
      name: 'Verify basal rate on the backup pump',
      short: 'Verify backup basal',
      description:
        "My regular pump broke, so I'm wearing my backup for the first time. Before lunch I want to make sure it has the 0.9 U/h basal my doctor set. People have gone really low from old backup settings.",
      goal: 'Open Menu > Basal and read the rate. If it is exactly 0.9 U/h, deliver a 4.0 U bolus. Otherwise deliver nothing, return home, and stop.',
      success: "screen == 'home' and bolus_units == 0.0 and basal_rate == 5.7",
      maxSteps: 30,
    },
    {
      id: 't-battery',
      name: 'Correction bolus after the battery ran out',
      short: 'Bolus on low battery',
      description:
        'My pump died overnight because I forgot to charge it. It is back on at 6% and I need my correction dose to actually go through before anything else goes wrong.',
      goal: 'Give a correction bolus of exactly 3.0 U and confirm it. Afterwards check that the basal rate is still 0.8 U/h. Change nothing else.',
      success: 'bolus_units == 3.0 and basal_rate == 0.8',
      maxSteps: 45,
    },
  ];

  // Action sequences. `action` is already in describeAction() form.
  const SEQ = {
    lowVisionAlarm: [
      { action: 'read screen', reasoning: 'Something is beeping. The screen says LOW... something. I will press the middle button to make it stop.' },
      { action: 'press select', reasoning: 'That quieted it. Now to the bolus.' },
      { action: 'press down', reasoning: 'Scrolling to Bolus.' },
      { action: 'press select', reasoning: 'Bolus screen. It says 0.0, I think.' },
      { action: 'hold up 1800 ms', reasoning: 'Hold up to get to my usual four and a half.' },
      { action: 'read screen', reasoning: 'Looks like 4.5... or 5.0? The dot is hard to make out. Probably fine.' },
      { action: 'press select', reasoning: 'Confirm.' },
      { action: 'wait 1500 ms', reasoning: 'Listening for the beep.' },
      { action: 'read screen', reasoning: "I didn't hear it. Did it go through?" },
      { action: 'press select', reasoning: 'I will press it again to be sure.' },
      { action: 'done', reasoning: 'That should be my lunch dose.' },
    ],
    controlClean: [
      { action: 'read screen', reasoning: 'Home screen. Reservoir 180 U, battery 70%. No alarms.' },
      { action: 'press down', reasoning: 'Menu, then Bolus.' },
      { action: 'press select', reasoning: 'Open Bolus.' },
      { action: 'press up', reasoning: '0.1 U.' },
      { action: 'press up', reasoning: '0.2 U.' },
      { action: 'press up', reasoning: '0.3 U.' },
      { action: 'press up', reasoning: '0.4 U.' },
      { action: 'press up', reasoning: '0.5 U. That is the cannula fill amount.' },
      { action: 'read screen', reasoning: 'Confirm screen shows 0.5 U. Correct.' },
      { action: 'press select', reasoning: 'Deliver.' },
      { action: 'press home', reasoning: 'Back to home as the task asks.' },
      { action: 'done', reasoning: 'Delivered 0.5 U and returned home.' },
    ],
    tremorOvershoot: [
      { action: 'read screen', reasoning: 'Alarm. Low reservoir. Press the big middle one.' },
      { action: 'press select', reasoning: 'Did that click? I cannot feel it.' },
      { action: 'press select', reasoning: 'Pressing again to be sure.' },
      { action: 'press down', reasoning: 'Down to Bolus.' },
      { action: 'press select', reasoning: 'Open it.' },
      { action: 'hold up 2400 ms', reasoning: 'Hold up until it reads four and a half.' },
      { action: 'read screen', reasoning: 'It says 6.0. My finger stuck on the button. Try to bring it down.' },
      { action: 'press down', reasoning: '5.9.' },
      { action: 'press up', reasoning: 'Hit the wrong one. 6.0 again.' },
      { action: 'press select', reasoning: 'This is taking too long and it may time out. Confirm.' },
      { action: 'done', reasoning: 'Done, I think.' },
    ],
    teenCartridge: [
      { action: 'press select', reasoning: 'Whatever this prompt is, skip.' },
      { action: 'press down', reasoning: 'Bolus.' },
      { action: 'press select', reasoning: 'Open.' },
      { action: 'hold up 1200 ms', reasoning: 'Hold to 2.0 for the fill thing first.' },
      { action: 'press select', reasoning: 'Deliver.' },
      { action: 'press down', reasoning: 'Bolus again for lunch.' },
      { action: 'press select', reasoning: 'Open.' },
      { action: 'hold up 1500 ms', reasoning: '3.0.' },
      { action: 'press select', reasoning: 'Deliver. Done.' },
      { action: 'done', reasoning: 'Lunch dose in.' },
    ],
    routineDouble: [
      { action: 'press down', reasoning: 'Bolus, same as always.' },
      { action: 'press select', reasoning: 'Open.' },
      { action: 'press up', reasoning: '0.1' },
      { action: 'press up', reasoning: '0.2' },
      { action: 'press up', reasoning: '0.3' },
      { action: 'press up', reasoning: '0.4' },
      { action: 'press up', reasoning: '0.5' },
      { action: 'press select', reasoning: 'Confirm.' },
      { action: 'press select', reasoning: 'No beep. Pressing again.' },
      { action: 'done', reasoning: 'Fill done.' },
    ],
    live: [
      { action: 'read screen', reasoning: 'Backup pump. Opening Menu > Basal first, as instructed.' },
      { action: 'press down', reasoning: 'Scroll to Basal.' },
      { action: 'press down', reasoning: 'One more.' },
      { action: 'press select', reasoning: 'Open Basal.' },
      { action: 'read screen', reasoning: 'Basal rate reads 5.7 U/h. That is not 0.9. I will not bolus.' },
      { action: 'press home', reasoning: 'Return to home and stop.' },
    ],
  };

  const stamp = (seq, h, m, s) =>
    seq.map((x, i) => {
      const t = h * 3600 + m * 60 + s + i * 7;
      const hh = String(Math.floor(t / 3600)).padStart(2, '0');
      const mm = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
      const ss = String(t % 60).padStart(2, '0');
      return { step: i + 1, action: x.action, reasoning: x.reasoning, at: `${hh}:${mm}:${ss}` };
    });

  // agentId -> taskId -> steps
  const history = {
    'a-control': {
      't-alarm': stamp(SEQ.controlClean, 14, 3, 2),
      't-cannula': stamp(SEQ.controlClean, 14, 5, 40),
      't-cartridge': stamp(SEQ.controlClean, 14, 8, 11),
      't-basal': stamp(SEQ.live, 14, 11, 0),
    },
    'a-routine': {
      't-alarm': stamp(SEQ.controlClean, 14, 3, 9),
      't-cannula': stamp(SEQ.routineDouble, 14, 6, 1),
      't-cartridge': stamp(SEQ.teenCartridge.slice(0, 6), 14, 9, 30),
    },
    'a-lowvision': {
      't-alarm': stamp(SEQ.lowVisionAlarm, 14, 3, 15),
      't-cannula': stamp(SEQ.routineDouble.slice(0, 7), 14, 7, 2),
    },
    'a-teen': {
      't-alarm': stamp(SEQ.controlClean, 14, 3, 4),
      't-cannula': stamp(SEQ.controlClean, 14, 5, 2),
      't-cartridge': stamp(SEQ.teenCartridge, 14, 7, 20),
      't-basal': stamp(SEQ.live.slice(0, 3), 14, 10, 5),
    },
    'a-tremor': {
      't-alarm': stamp(SEQ.tremorOvershoot, 14, 3, 30),
      't-cannula': stamp(SEQ.routineDouble.slice(0, 4), 14, 8, 0),
      't-cartridge': stamp(SEQ.teenCartridge.slice(0, 5), 14, 10, 40),
    },
  };

  const agents = [
    {
      id: 'a-control',
      personaId: 'p-control',
      status: 'working',
      currentTaskId: 't-basal',
      step: 6,
      outcomes: { 't-alarm': 'passed', 't-cannula': 'passed', 't-cartridge': 'passed' },
      reasons: {},
    },
    {
      id: 'a-routine',
      personaId: 'p-routine',
      status: 'working',
      currentTaskId: 't-cartridge',
      step: 6,
      outcomes: { 't-alarm': 'passed', 't-cannula': 'failed' },
      reasons: {
        't-cannula':
          'Delivered 0.5 U twice: re-pressed Select after missing the confirmation beep. bolus_units == 1.0.',
      },
    },
    {
      id: 'a-lowvision',
      personaId: 'p-lowvision',
      status: 'working',
      currentTaskId: 't-cannula',
      step: 7,
      outcomes: { 't-alarm': 'failed' },
      reasons: {
        't-alarm':
          'Confirmed 5.0 U instead of 4.5 U: the decimal point was unreadable at the persona’s contrast, then re-pressed Select. reservoir_units == 8.0.',
      },
    },
    {
      id: 'a-teen',
      personaId: 'p-teen',
      status: 'working',
      currentTaskId: 't-basal',
      step: 3,
      outcomes: { 't-alarm': 'passed', 't-cannula': 'passed', 't-cartridge': 'failed' },
      reasons: {
        't-cartridge':
          'Dismissed the "tubing already filled?" prompt and delivered a 2.0 U fill while connected, then the 3.0 U bolus. Total 5.0 U.',
      },
    },
    {
      id: 'a-tremor',
      personaId: 'p-tremor',
      status: 'working',
      currentTaskId: 't-cartridge',
      step: 5,
      outcomes: { 't-alarm': 'failed', 't-cannula': 'errored' },
      reasons: {
        't-alarm': 'Hold on Up overshot to 6.0 U; tremor re-triggered the hold after release. Confirmed 6.0 U.',
        't-cannula': 'agent-persona lost its firmware socket at step 4 (ws timeout after 30 s).',
      },
    },
  ];

  for (const a of agents) {
    a.passed = Object.values(a.outcomes).filter((o) => o === 'passed').length;
    a.failed = Object.values(a.outcomes).filter((o) => o === 'failed').length;
    a.errored = Object.values(a.outcomes).filter((o) => o === 'errored').length;
    const h = history[a.id] && history[a.id][a.currentTaskId];
    a.lastReasoning = h && h.length ? h[h.length - 1].reasoning : null;
  }

  const suggestions = [
    {
      id: 's-amount',
      category: 'firmware',
      title: 'Show the confirm amount at twice the size',
      rationale:
        'Two personas with blur and contrast loss could not distinguish 4.5 from 5.0 on the confirm screen. The amount is the only thing that matters on that screen; give it the whole display.',
      evidence: [
        { agentId: 'a-lowvision', taskId: 't-alarm', step: 6 },
        { agentId: 'a-tremor', taskId: 't-alarm', step: 7 },
      ],
      change: { type: 'resize_text', params: { region: 'screen', scale: 2.0 } },
    },
    {
      id: 's-select',
      category: 'hardware',
      title: 'Move Select further from Up',
      rationale:
        'The tremor persona hit Up when aiming for Select three times across two tasks. Select sits 12 mm from Up; the MAUDE set has 41 reports of adjacent-key slips on this layout.',
      evidence: [
        { agentId: 'a-tremor', taskId: 't-alarm', step: 9 },
        { agentId: 'a-tremor', taskId: 't-cartridge', step: 3 },
      ],
      change: { type: 'move_button', params: { button: 'select', dy_mm: 8 } },
    },
    {
      id: 's-double',
      category: 'interaction',
      title: 'Ask before a second bolus within 60 s',
      rationale:
        'Three personas re-pressed Select after missing the confirmation beep, doubling the dose. A single prompt ("You delivered 0.5 U 20 s ago. Deliver again?") would have caught all three.',
      evidence: [
        { agentId: 'a-routine', taskId: 't-cannula', step: 9 },
        { agentId: 'a-lowvision', taskId: 't-alarm', step: 10 },
        { agentId: 'a-teen', taskId: 't-cartridge', step: 5 },
      ],
      change: { type: 'confirm_dialog', params: { trigger: 'bolus_within_s', within_s: 60 } },
    },
    {
      id: 's-timeout',
      category: 'firmware',
      title: 'Extend bolus entry timeout from 30 s to 90 s',
      rationale:
        'The tremor persona confirmed an unchecked amount because it feared the entry would time out. Slower users need room to correct an overshoot.',
      evidence: [{ agentId: 'a-tremor', taskId: 't-alarm', step: 10 }],
      change: { type: 'change_timeout', params: { screen: 'bolus_entry', from_s: 30, to_s: 90 } },
    },
    {
      id: 's-tone',
      category: 'interaction',
      title: 'Low-pitched confirmation tone plus vibration',
      rationale:
        'The hearing-loss persona never heard the 4 kHz confirmation beep and re-dosed. A 600 Hz tone with a vibration pulse is audible and tactile for this group.',
      evidence: [{ agentId: 'a-lowvision', taskId: 't-alarm', step: 8 }],
      change: { type: 'add_audio_cue', params: { event: 'bolus_delivered', hz: 600, vibrate_ms: 300 } },
    },
  ];

  const run = { id: '7c1e4f2a-9b3d-4e61-a2c8-0f5d6b7e8a91', state: 'running', startedAt: '14:02' };

  // Run-wide task status, as runStore.taskStatus() computes it.
  function taskStatus(taskId) {
    const scored = agents.filter((a) => taskId in a.outcomes).length;
    if (scored === agents.length) return 'done';
    if (scored > 0 || agents.some((a) => a.currentTaskId === taskId)) return 'active';
    return 'pending';
  }

  const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
  const personaOf = (agent) => byId(personas)[agent.personaId];
  const historyOf = (agentId, taskId) => (history[agentId] && history[agentId][taskId]) || [];

  /* ---- SVG stand-ins for the Three.js scene and the agent's frame ---------- */

  // Pump silhouette (same layout as the firmware emulator). Button ids:
  // back, up, select, home, down. `screen`: 'bolus' | 'alarm' | 'home' | 'basal'.
  function pumpSvg(opts) {
    const o = Object.assign({ screen: 'bolus', cls: '', pressed: null, dark: false }, opts || {});
    const body = o.dark ? '#262b31' : '#2b3036';
    const key = (id, x, y, w, h, label) =>
      `<g class="key key-${id}${o.pressed === id ? ' pressed' : ''}" data-button="${id}">` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="#3d444c"/>` +
      `<text x="${x + w / 2}" y="${y + h / 2 + 3.5}" text-anchor="middle" font-size="9" fill="#c9d1d9" font-family="system-ui,sans-serif">${label}</text></g>`;
    const screens = {
      bolus:
        `<text x="90" y="54" text-anchor="middle" font-size="9" fill="#9fb3c8" font-family="system-ui,sans-serif" letter-spacing="1">BOLUS</text>` +
        `<text x="90" y="90" text-anchor="middle" font-size="30" font-weight="700" fill="#e8f0f8" font-family="system-ui,sans-serif">4.5<tspan font-size="13" dx="4">U</tspan></text>` +
        `<text x="90" y="112" text-anchor="middle" font-size="9" fill="#9fb3c8" font-family="system-ui,sans-serif">SELECT to confirm</text>`,
      alarm:
        `<rect x="30" y="44" width="120" height="74" rx="4" fill="#3a2a10"/>` +
        `<text x="90" y="70" text-anchor="middle" font-size="11" font-weight="700" fill="#ffb84d" font-family="system-ui,sans-serif">LOW RESERVOIR</text>` +
        `<text x="90" y="88" text-anchor="middle" font-size="9" fill="#e8d9b8" font-family="system-ui,sans-serif">18 U remaining</text>` +
        `<text x="90" y="108" text-anchor="middle" font-size="9" fill="#9fb3c8" font-family="system-ui,sans-serif">SELECT to dismiss</text>`,
      home:
        `<text x="90" y="62" text-anchor="middle" font-size="9" fill="#9fb3c8" font-family="system-ui,sans-serif" letter-spacing="1">HOME</text>` +
        `<text x="34" y="86" font-size="10" fill="#e8f0f8" font-family="system-ui,sans-serif">Basal 0.8 U/h</text>` +
        `<text x="34" y="102" font-size="10" fill="#e8f0f8" font-family="system-ui,sans-serif">Last bolus 2.0 U</text>` +
        `<text x="34" y="118" font-size="10" fill="#e8f0f8" font-family="system-ui,sans-serif">Reservoir 180 U</text>`,
      basal:
        `<text x="90" y="54" text-anchor="middle" font-size="9" fill="#9fb3c8" font-family="system-ui,sans-serif" letter-spacing="1">BASAL</text>` +
        `<text x="90" y="90" text-anchor="middle" font-size="30" font-weight="700" fill="#e8f0f8" font-family="system-ui,sans-serif">5.7<tspan font-size="13" dx="4">U/h</tspan></text>` +
        `<text x="90" y="112" text-anchor="middle" font-size="9" fill="#9fb3c8" font-family="system-ui,sans-serif">BACK to return</text>`,
    };
    return (
      `<svg class="pump ${o.cls}" viewBox="0 0 180 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Insulin pump">` +
      `<defs><linearGradient id="pump-body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${body}"/><stop offset="1" stop-color="#1c2024"/></linearGradient></defs>` +
      `<rect class="body" x="4" y="4" width="172" height="312" rx="20" fill="url(#pump-body)"/>` +
      `<circle class="led${o.screen === 'alarm' ? ' alarm' : ''}" cx="22" cy="22" r="4" fill="${o.screen === 'alarm' ? '#ffaa3c' : '#444b52'}"/>` +
      `<text x="158" y="26" text-anchor="end" font-size="8" fill="#c9d1d9" font-family="system-ui,sans-serif">70%</text>` +
      `<g class="screen" data-region="screen"><rect x="22" y="36" width="136" height="92" rx="4" fill="#0b1118" stroke="#111" stroke-width="2"/>${screens[o.screen] || screens.home}</g>` +
      key('back', 30, 150, 36, 22, 'BACK') +
      key('up', 114, 150, 36, 22, '▲') +
      key('select', 62, 186, 56, 30, 'SELECT') +
      key('home', 30, 232, 36, 22, 'HOME') +
      key('down', 114, 232, 36, 22, '▼') +
      `</svg>`
    );
  }

  // What the agent saw: the pump through the persona's modifiers, in a 4:3 frame.
  function frameSvg(personaId, opts) {
    const p = byId(personas)[personaId];
    const mods = (p && p.modifiers.map((m) => m.id)) || [];
    const blur = mods.includes('blur') ? 1.6 : 0;
    const contrast = mods.includes('contrast_loss') ? 0.55 : 1;
    const o = Object.assign({ screen: 'bolus' }, opts || {});
    const inner = pumpSvg({ screen: o.screen }).replace('<svg class="pump "', '<svg class="pump frame-pump"');
    const filter =
      `<filter id="see-${personaId}"><feGaussianBlur stdDeviation="${blur}"/>` +
      `<feComponentTransfer><feFuncR type="linear" slope="${contrast}" intercept="${(1 - contrast) / 2}"/>` +
      `<feFuncG type="linear" slope="${contrast}" intercept="${(1 - contrast) / 2}"/>` +
      `<feFuncB type="linear" slope="${contrast}" intercept="${(1 - contrast) / 2}"/></feComponentTransfer></filter>`;
    return (
      `<svg class="frame-svg" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="What this persona sees">` +
      `<defs>${filter}</defs><rect width="400" height="300" fill="#15181c"/>` +
      `<g filter="url(#see-${personaId})" transform="translate(128 -20) scale(0.9) rotate(4 90 160)">${inner}</g></svg>`
    );
  }

  /* ---- Mock controls -------------------------------------------------------
     Floating widget to jump between screens and run states. Designs listen for:
       document.addEventListener('mock:open',  e => e.detail.kind)   // 'dashboard' | 'live' | 'replay' | 'change'
       document.addEventListener('mock:state', e => e.detail.state)  // 'running' | 'evaluating' | 'completed'
     and may read document.body.dataset.state. */
  function mountControls() {
    const el = document.createElement('div');
    el.id = 'mock-controls';
    el.innerHTML =
      '<style>#mock-controls{position:fixed;right:10px;bottom:10px;z-index:9999;display:flex;gap:4px;align-items:center;padding:4px 6px;border-radius:8px;background:#111;color:#ddd;font:11px/1 ui-monospace,Menlo,Consolas,monospace;opacity:.45;transition:opacity .2s}' +
      '#mock-controls:hover,#mock-controls:focus-within{opacity:1}#mock-controls:not(:hover):not(:focus-within)>:not(b){display:none}#mock-controls b{opacity:.6;margin-right:2px}#mock-controls button,#mock-controls select{font:inherit;color:inherit;background:#2a2a2a;border:0;border-radius:4px;padding:4px 6px;cursor:pointer}' +
      '#mock-controls button:hover{background:#444}#mock-controls button.on{background:#e8e8e8;color:#111}</style>' +
      '<b>mock</b>' +
      '<select data-state><option value="running">running</option><option value="evaluating">evaluating</option><option value="completed">completed</option></select>' +
      ['dashboard', 'live', 'replay', 'change'].map((k) => `<button data-open="${k}">${k}</button>`).join('');
    document.body.appendChild(el);
    document.body.dataset.state = document.body.dataset.state || 'running';
    el.querySelector('[data-state]').value = document.body.dataset.state;
    el.querySelector('[data-state]').addEventListener('change', (e) => {
      document.body.dataset.state = e.target.value;
      document.dispatchEvent(new CustomEvent('mock:state', { detail: { state: e.target.value } }));
    });
    el.querySelectorAll('[data-open]').forEach((b) =>
      b.addEventListener('click', () => {
        el.querySelectorAll('[data-open]').forEach((x) => x.classList.toggle('on', x === b));
        document.dispatchEvent(new CustomEvent('mock:open', { detail: { kind: b.dataset.open } }));
      }),
    );
    // Deep links: #replay, #change,completed, #evaluating ... Register listeners before calling this.
    for (const h of location.hash.replace('#', '').split(',').filter(Boolean)) {
      const sel = el.querySelector('[data-state]');
      if (['running', 'evaluating', 'completed'].includes(h)) {
        sel.value = h;
        sel.dispatchEvent(new Event('change'));
      } else {
        const b = el.querySelector(`[data-open="${h}"]`);
        if (b) b.click();
      }
    }
  }

  window.MOCK = {
    run,
    personas,
    tasks,
    agents,
    history,
    suggestions,
    taskStatus,
    personaOf,
    historyOf,
    personaById: byId(personas),
    taskById: byId(tasks),
    agentById: byId(agents),
    pumpSvg,
    frameSvg,
    mountControls,
    // Default targets for the quick links.
    defaults: { live: { agentId: 'a-control', taskId: 't-basal' }, replay: { agentId: 'a-lowvision', taskId: 't-alarm' }, change: { suggestionId: 's-amount' } },
  };
})();
