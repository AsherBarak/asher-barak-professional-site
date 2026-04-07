(() => {
  const canvas = document.getElementById('neuralCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let width, height, nodes, connections, mouse, waveFronts, waveState, waveTimer;
  const MOUSE_RADIUS = 200;
  const MOUSE_PUSH = 0.08;
  // Wave cycle states: 'forward' -> 'return' -> 'wait' -> 'forward' ...
  const FORWARD_SPEED = 0.072;
  const RETURN_SPEED = 0.040;
  const WAIT_FRAMES = 1200; // ~20 seconds at 60fps

  const LAYERS = [4, 6, 10, 14, 10, 6, 4];
  const TOTAL_LAYERS = LAYERS.length;
  const TOTAL_EDGES = TOTAL_LAYERS - 1; // 6 edge groups

  const theme = window.neuralTheme || {};
  const LAYER_COLORS = theme.layerColors || [
    [99, 102, 241],
    [124, 58, 237],
    [139, 92, 246],
    [167, 139, 250],
    [139, 92, 246],
    [124, 58, 237],
    [99, 102, 241],
  ];
  const FWD_COLOR = (theme.forwardWave && theme.forwardWave.color) || [139, 92, 246];
  const FWD_BRIGHT = (theme.forwardWave && theme.forwardWave.colorBright) || [200, 180, 255];
  const RET_COLOR = (theme.returnWave && theme.returnWave.color) || [59, 180, 200];
  const RET_BRIGHT = (theme.returnWave && theme.returnWave.colorBright) || [140, 230, 240];

  function buildNetwork() {
    nodes = [];
    connections = [];

    const portrait = height > width * 1.2;
    const margin = 80;
    const usableWidth = width - margin * 2;
    const usableHeight = height - margin * 2;
    // In portrait mode, layers go top-to-bottom; in landscape, left-to-right
    const layerSpacing = portrait
      ? usableHeight / (TOTAL_LAYERS - 1)
      : usableWidth / (TOTAL_LAYERS - 1);

    for (let l = 0; l < TOTAL_LAYERS; l++) {
      const count = LAYERS[l];
      const nodeSpacing = portrait
        ? usableWidth / (count + 1)
        : usableHeight / (count + 1);
      const color = LAYER_COLORS[l];

      for (let n = 0; n < count; n++) {
        let x, y;
        if (portrait) {
          y = margin + l * layerSpacing;
          x = margin + (n + 1) * nodeSpacing;
        } else {
          x = margin + l * layerSpacing;
          y = margin + (n + 1) * nodeSpacing;
        }
        const jitterX = (Math.random() - 0.5) * (portrait ? nodeSpacing : layerSpacing) * 0.15;
        const jitterY = (Math.random() - 0.5) * (portrait ? layerSpacing : nodeSpacing) * 0.2;

        nodes.push({
          x: x + jitterX,
          y: y + jitterY,
          homeX: x + jitterX,
          homeY: y + jitterY,
          vx: 0, vy: 0,
          radius: l === 0 || l === TOTAL_LAYERS - 1 ? 1.5 : 1.25 + Math.random() * 0.75,
          layer: l,
          color: [...color],
          baseColor: [...color],
          energy: 0,
          pulsePhase: Math.random() * Math.PI * 2,
          // Idle animation: each node has unique speeds/phases for organic feel
          idleSizePhase: Math.random() * Math.PI * 2,
          idleSizeSpeed: 0.015 + Math.random() * 0.025,
          idleBrightPhase: Math.random() * Math.PI * 2,
          idleBrightSpeed: 0.008 + Math.random() * 0.015,
          idleDriftPhaseX: Math.random() * Math.PI * 2,
          idleDriftPhaseY: Math.random() * Math.PI * 2,
          idleDriftSpeed: 0.0015 + Math.random() * 0.002,
        });
      }
    }

    // Connections between adjacent layers
    let offset = 0;
    for (let l = 0; l < TOTAL_LAYERS - 1; l++) {
      const currentCount = LAYERS[l];
      const nextCount = LAYERS[l + 1];
      const nextOffset = offset + currentCount;

      for (let i = 0; i < currentCount; i++) {
        for (let j = 0; j < nextCount; j++) {
          const skipChance = Math.max(currentCount, nextCount) > 10 ? 0.4 : 0.15;
          if (Math.random() < skipChance) continue;
          connections.push({
            from: offset + i,
            to: nextOffset + j,
            edgeGroup: l, // which layer boundary (0..5)
          });
        }
      }
      offset += currentCount;
    }

    // Sparse skip-connections
    offset = 0;
    for (let l = 0; l < TOTAL_LAYERS - 2; l++) {
      const currentCount = LAYERS[l];
      const skipLayerOffset = offset + currentCount + LAYERS[l + 1];
      const skipCount = LAYERS[l + 2];
      for (let i = 0; i < currentCount; i++) {
        if (Math.random() < 0.85) continue;
        const j = Math.floor(Math.random() * skipCount);
        connections.push({
          from: offset + i,
          to: skipLayerOffset + j,
          edgeGroup: l, // treat as belonging to the first boundary
        });
      }
      offset += currentCount;
    }

    // Random phase offset per connection — larger range for a staggered wave front
    for (const conn of connections) {
      conn.phaseOffset = (Math.random() - 0.5) * 2.5;
    }
  }

  function init() {
    resize();
    mouse = { x: -1000, y: -1000 };
    waveFronts = [];
    waveState = 'forward';
    waveTimer = 0;
    buildNetwork();
    // Start with the forward wave
    waveFronts.push({
      forward: true,
      pos: -0.5,
      speed: FORWARD_SPEED,
      energy: 0.5,
      width: 3.0,
      color: FWD_COLOR,
      colorBright: FWD_BRIGHT,
    });
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    width = canvas.width = rect.width;
    height = canvas.height = rect.height;
  }

  function update() {
    // Wave cycle state machine
    if (waveState === 'forward') {
      if (waveFronts.length === 0) {
        // Shouldn't happen, but recover
        waveFronts.push({ forward: true, pos: -0.3, speed: FORWARD_SPEED, energy: 0.85, width: 1.4 });
      }
      const wave = waveFronts[0];
      wave.pos += wave.speed;
      // When forward wave has fully exited right side
      if (wave.pos > TOTAL_EDGES + wave.width + 0.5) {
        waveFronts = [];
        // Spawn the smaller return wave
        waveFronts.push({
          forward: false,
          pos: TOTAL_EDGES + 0.3,
          speed: RETURN_SPEED,
          energy: 0.3,
          width: 2.2,
          color: RET_COLOR,
          colorBright: RET_BRIGHT,
        });
        waveState = 'return';
      }
    } else if (waveState === 'return') {
      const wave = waveFronts[0];
      wave.pos -= wave.speed;
      wave.energy *= 0.999;
      // When return wave has fully exited left side
      if (wave.pos < -(wave.width + 0.5)) {
        waveFronts = [];
        waveState = 'wait';
        waveTimer = WAIT_FRAMES;
      }
    } else if (waveState === 'wait') {
      waveTimer--;
      if (waveTimer <= 0) {
        waveFronts.push({
          forward: true,
          pos: -0.5,
          speed: FORWARD_SPEED,
          energy: 0.5,
          width: 3.0,
          color: FWD_COLOR,
          colorBright: FWD_BRIGHT,
        });
        waveState = 'forward';
      }
    }

    // Energize nodes that the wave front is passing over
    for (const wave of waveFronts) {
      for (const node of nodes) {
        // Map node's layer to continuous space
        const nodePos = node.layer;
        const dist = Math.abs(nodePos - wave.pos);
        if (dist < wave.width * 0.6) {
          const strength = (1 - dist / (wave.width * 0.6)) * wave.energy * 0.35;
          node.energy = Math.min(node.energy + strength, 1.0);
        }
      }
    }

    // Mouse interaction + node physics
    for (const node of nodes) {
      const dx = node.x - mouse.x;
      const dy = node.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MOUSE_RADIUS && dist > 0) {
        const force = (1 - dist / MOUSE_RADIUS) * MOUSE_PUSH;
        node.vx += (dx / dist) * force;
        node.vy += (dy / dist) * force;
        node.energy = Math.min(node.energy + 0.02, 0.8);
      }

      // Advance idle animation phases
      node.idleSizePhase += node.idleSizeSpeed;
      node.idleBrightPhase += node.idleBrightSpeed;
      node.idleDriftPhaseX += node.idleDriftSpeed;
      node.idleDriftPhaseY += node.idleDriftSpeed * 0.8;

      // Idle drift — target position wanders around home
      const wanderX = node.homeX + Math.sin(node.idleDriftPhaseX) * 4;
      const wanderY = node.homeY + Math.cos(node.idleDriftPhaseY) * 4;
      node.vx += (wanderX - node.x) * 0.008;
      node.vy += (wanderY - node.y) * 0.008;
      node.vx *= 0.94;
      node.vy *= 0.94;

      node.x += node.vx;
      node.y += node.vy;

      // Wave energy decays
      node.energy *= 0.94;
      // Idle brightness is independent — always pulses
      // Range: 0.05 (nearly dark) to 0.7 (clearly glowing)
      node.idleBright = (Math.sin(node.idleBrightPhase) * 0.5 + 0.5) * 0.65 + 0.05;

      for (let c = 0; c < 3; c++) {
        node.color[c] = node.baseColor[c] + (255 - node.baseColor[c]) * node.energy * 0.7;
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    // Draw base connections
    for (const conn of connections) {
      const a = nodes[conn.from];
      const b = nodes[conn.to];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(100, 100, 180, 0.055)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Draw wave effects on connections
    for (const wave of waveFronts) {
      for (const conn of connections) {
        const edgeMid = conn.edgeGroup + 0.5;
        const dist = Math.abs(edgeMid - wave.pos + conn.phaseOffset);

        if (dist > wave.width) continue;

        const a = nodes[conn.from];
        const b = nodes[conn.to];

        // How much of this edge the wave covers
        const intensity = (1 - dist / wave.width) * wave.energy;
        if (intensity < 0.03) continue;

        // t = where the leading edge of the wave is on this connection (0..1)
        // The wave sweeps across the edge
        const edgeStart = conn.edgeGroup;
        const edgeEnd = conn.edgeGroup + 1;
        const waveLeading = wave.forward ? wave.pos : wave.pos;
        const waveTrailing = wave.forward ? wave.pos - wave.width : wave.pos + wave.width;

        // Clamp to 0..1 within this edge's span
        const tLead = Math.max(0, Math.min(1, (waveLeading - edgeStart) / (edgeEnd - edgeStart)));
        const tTrail = Math.max(0, Math.min(1, (waveTrailing - edgeStart) / (edgeEnd - edgeStart)));

        const t0 = Math.min(tLead, tTrail);
        const t1 = Math.max(tLead, tTrail);

        if (t1 - t0 < 0.01) continue;

        const x0 = a.x + (b.x - a.x) * t0;
        const y0 = a.y + (b.y - a.y) * t0;
        const x1 = a.x + (b.x - a.x) * t1;
        const y1 = a.y + (b.y - a.y) * t1;

        // Gradient along the lit segment: bright at leading edge, fading at trailing
        const wc = wave.color;
        const wb = wave.colorBright;
        const midR = Math.round((wc[0] + wb[0]) / 2);
        const midG = Math.round((wc[1] + wb[1]) / 2);
        const midB = Math.round((wc[2] + wb[2]) / 2);

        const gradient = ctx.createLinearGradient(
          a.x + (b.x - a.x) * (wave.forward ? t0 : t1),
          a.y + (b.y - a.y) * (wave.forward ? t0 : t1),
          a.x + (b.x - a.x) * (wave.forward ? t1 : t0),
          a.y + (b.y - a.y) * (wave.forward ? t1 : t0)
        );
        gradient.addColorStop(0, `rgba(${wc[0]}, ${wc[1]}, ${wc[2]}, 0)`);
        gradient.addColorStop(0.6, `rgba(${midR}, ${midG}, ${midB}, ${intensity * 0.3})`);
        gradient.addColorStop(1, `rgba(${wb[0]}, ${wb[1]}, ${wb[2]}, ${intensity * 0.5})`);

        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1 + intensity * 2;
        ctx.stroke();

        // Small bright dot at the leading edge
        const leadX = a.x + (b.x - a.x) * tLead;
        const leadY = a.y + (b.y - a.y) * tLead;
        if (intensity > 0.2) {
          ctx.beginPath();
          ctx.arc(leadX, leadY, 1.2 + intensity * 1.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${wb[0]}, ${wb[1]}, ${wb[2]}, ${intensity * 0.6})`;
          ctx.fill();
        }
      }
    }

    // Draw nodes
    for (const node of nodes) {
      // Combine wave energy + idle brightness
      const vis = Math.max(node.energy, node.idleBright);
      const alpha = 0.15 + vis * 0.75;
      const r = Math.round(node.baseColor[0] + (255 - node.baseColor[0]) * vis * 0.7);
      const g = Math.round(node.baseColor[1] + (255 - node.baseColor[1]) * vis * 0.7);
      const b = Math.round(node.baseColor[2] + (255 - node.baseColor[2]) * vis * 0.7);

      if (vis > 0.05) {
        const glowRadius = node.radius + vis * 20;
        // Blend toward white-pink when wave energy is high
        const waveT = Math.min(1, node.energy * 1.5);
        const glowR = Math.round(r + (255 - r) * waveT);
        const glowG = Math.round(g + (220 - g) * waveT);
        const glowB = Math.round(b + (245 - b) * waveT);
        const gradient = ctx.createRadialGradient(
          node.x, node.y, 0, node.x, node.y, glowRadius
        );
        gradient.addColorStop(0, `rgba(${glowR},${glowG},${glowB},${vis * 0.45})`);
        gradient.addColorStop(0.4, `rgba(${r},${g},${b},${vis * 0.15})`);
        gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      const idleSize = Math.sin(node.idleSizePhase) * 0.5;
      const waveSize = node.energy * node.radius; // doubles radius at full energy
      const drawRadius = Math.max(1.5, node.radius + waveSize + idleSize);
      ctx.beginPath();
      ctx.arc(node.x, node.y, drawRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.fill();

      if (vis > 0.15) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, drawRadius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r},${g},${b},${vis * 0.2})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
  }

  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', () => {
    resize();
    buildNetwork();
    // Reset wave state machine properly so colors are always defined
    waveFronts = [];
    waveState = 'forward';
    waveTimer = 0;
    waveFronts.push({
      forward: true,
      pos: -0.5,
      speed: FORWARD_SPEED,
      energy: 0.5,
      width: 3.0,
      color: FWD_COLOR,
      colorBright: FWD_BRIGHT,
    });
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  });

  canvas.addEventListener('mouseleave', () => {
    mouse.x = -1000;
    mouse.y = -1000;
  });

  init();
  loop();
})();
