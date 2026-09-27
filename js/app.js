(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!window.Matter || !window.NJUMerge) {
    $('loading-message').textContent = '游戏文件未能加载。请保持整个文件夹完整，再重新打开。';
    return;
  }
  const { Game, LEVELS, RULES } = window.NJUMerge;
  const canvas = $('game-canvas'), ctx = canvas.getContext('2d');
  const textures = new Map(), particles = [], floaters = [];
  const pauseReasons = new Set();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ready = false, activePointer = null, touchMode = false, frameTime = 0, accumulator = 0;
  let best = 0, muted = false, audio = null, lastSound = -Infinity, lastHud = '';
  const storageKey = 'nju-merge-v1';
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    best = Number.isFinite(saved.best) && saved.best >= 0 ? Math.floor(saved.best) : 0;
    muted = saved.muted === true;
  } catch { /* Browsers may block storage for local files; gameplay remains available. */ }
  const save = () => { try { localStorage.setItem(storageKey, JSON.stringify({ best, muted })); } catch {} };
  function updateSoundButton() {
    const button = $('sound-button');
    button.setAttribute('aria-pressed', String(muted));
    button.setAttribute('aria-label', muted ? '开启音效' : '关闭音效'); button.title = muted ? '开启音效' : '关闭音效';
    button.innerHTML = muted
      ? '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4zM15 8c2 2 2 6 0 8M18 5c4 4 4 10 0 14"/></svg>';
  }
  function unlockAudio() {
    if (muted) return;
    try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') void audio.resume().catch(() => {}); } catch {}
  }
  function tone(level, win = false) {
    if (muted || !audio || audio.state !== 'running') return;
    const time = audio.currentTime;
    if (!win && time - lastSound < 0.04) return;
    lastSound = time;
    const notes = win ? [523.25, 659.25, 783.99, 1046.5] : [220 * 2 ** (level / 8), 330 * 2 ** (level / 8)];
    notes.forEach((frequency, i) => {
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      const start = time + i * (win ? 0.13 : 0.055);
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.09, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + (win ? 0.6 : 0.22));
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(start); oscillator.stop(start + 0.65);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  }
  function burst(x, y, level, celebration = false) {
    if (reducedMotion) return;
    const count = celebration ? 100 : 12;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2, speed = celebration ? 100 + Math.random() * 280 : 35 + Math.random() * 100;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - (celebration ? 150 : 25), age: 0,
        life: celebration ? 2.5 + Math.random() : 0.5 + Math.random() * 0.25, size: celebration ? 3 + Math.random() * 4 : 1.5 + Math.random() * 2,
        color: celebration ? ['#d4ad5c', '#9362b1', '#bf99d2', '#eadab1'][i % 4] : LEVELS[level - 1].color, confetti: celebration, rotation: angle });
    }
  }
  const game = new Game({ onEvent(event) {
    if (event.type === 'merge') {
      burst(event.x, event.y, event.level); tone(event.level);
      floaters.push({ x: event.x, y: event.y - LEVELS[event.level - 1].radius, age: 0, text: '+' + event.points });
      $('score').classList.remove('score-pop'); void $('score').offsetWidth; $('score').classList.add('score-pop');
      if (game.score > best) { best = game.score; save(); }
      $('announcement').textContent = '合成' + LEVELS[event.level - 1].name + '，获得' + event.points + '分';
    }
    if (event.type === 'won' || event.type === 'lost') showResult(event.type === 'won');
    updateHUD();
  } });

  $('level-list').innerHTML = LEVELS.map((level, i) => `<li class="level-item${i === 8 ? ' final' : ''}" data-level="${i + 1}"><div class="level-image"><img src="${level.image}" alt="${level.name}校徽" width="31" height="31"></div><div class="level-info"><span class="level-name">${level.name}</span><span class="level-code">${i === 8 ? '终极目标' : 'LEVEL 0' + (i + 1)}</span></div><span class="level-number">${i === 8 ? '✦' : '0' + (i + 1)}</span></li>`).join('');
  function updateHUD() {
    $('score').textContent = String(game.score); $('best').textContent = String(best);
    const next = LEVELS[game.next - 1];
    $('next-name').textContent = next.name;
    if ($('next-image').getAttribute('src') !== next.image) $('next-image').src = next.image;
    $('next-image').alt = '下一枚：' + next.name;
    $('current-label').textContent = LEVELS[game.current - 1].name;
    $('progress-count').textContent = String(game.maxLevel).padStart(2, '0') + ' / 09';
    document.querySelectorAll('.level-item').forEach((el, i) => {
      el.classList.toggle('current', i + 1 === game.maxLevel);
      if (i + 1 === game.maxLevel) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
    });
    $('empty-hint').style.opacity = game.balls.size ? '0' : '1';
    $('pause-panel').hidden = !game.paused || $('help-dialog').open || game.phase !== 'playing';
    $('pause-button').disabled = !ready || game.phase !== 'playing';
    $('pause-button').setAttribute('aria-label', game.paused ? '继续游戏' : '暂停游戏');
    $('pause-button').innerHTML = game.paused ? '<svg viewBox="0 0 24 24"><path d="m8 5 10 7-10 7z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>';
    lastHud = '';
  }
  function showResult(won) {
    const panel = $('result-panel'); panel.hidden = false; panel.classList.toggle('won', won);
    $('result-kicker').textContent = won ? 'WELCOME TO NJU' : '这一站，暂时停靠';
    $('result-title').textContent = won ? '你好，南京大学！' : '下次，再近一步。';
    $('result-copy').textContent = won ? '从蓝翔出发，你的南大时刻到了。' : '这次抵达了' + LEVELS[game.maxLevel - 1].name + '，再试一次吧。';
    const logo = LEVELS[(won ? 9 : game.maxLevel) - 1];
    $('result-logo').src = logo.image; $('result-logo').alt = logo.name + '校徽';
    $('result-score').textContent = String(game.score);
    $('announcement').textContent = (won ? '成功合成南京大学！' : '本局结束。') + '得分' + game.score;
    if (won) { burst(RULES.width / 2, RULES.height / 3, 9, true); tone(9, true); }
    activePointer = null;
  }
  function setPause(reason, paused) {
    if (paused) pauseReasons.add(reason); else pauseReasons.delete(reason);
    game.setPaused(pauseReasons.size > 0); accumulator = 0; frameTime = 0;
  }
  function restart() {
    if ($('help-dialog').open) $('help-dialog').close();
    particles.length = 0; floaters.length = 0; activePointer = null;
    pauseReasons.clear(); if (document.hidden) pauseReasons.add('visibility');
    $('result-panel').hidden = true; game.restart(); game.setPaused(pauseReasons.size > 0);
    accumulator = 0; frameTime = 0; updateHUD();
  }
  function pointerX(event) {
    const rect = canvas.getBoundingClientRect();
    return (event.clientX - rect.left) / rect.width * RULES.width;
  }
  canvas.addEventListener('pointerdown', event => {
    if (!ready || activePointer !== null || event.button !== 0 || !event.isPrimary || game.paused || game.phase !== 'playing') return;
    event.preventDefault(); touchMode = event.pointerType !== 'mouse'; activePointer = event.pointerId;
    canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId); unlockAudio(); game.aim(pointerX(event));
  });
  canvas.addEventListener('pointermove', event => {
    if (!ready || game.paused || game.phase !== 'playing') return;
    if (event.pointerType === 'mouse' && activePointer === null || activePointer === event.pointerId) game.aim(pointerX(event));
  });
  canvas.addEventListener('pointerup', event => {
    if (activePointer !== event.pointerId) return;
    activePointer = null; event.preventDefault();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    const bounds = canvas.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
    if (ready) game.drop(pointerX(event));
  });
  canvas.addEventListener('pointercancel', () => { activePointer = null; });
  canvas.addEventListener('lostpointercapture', () => { activePointer = null; });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  document.addEventListener('keydown', event => {
    if (!ready || $('help-dialog').open || /^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (['ArrowLeft', 'ArrowRight', ' ', 'p', 'P'].includes(event.key)) event.preventDefault();
    if (event.key.toLowerCase() === 'p' && !event.repeat) { setPause('manual', !pauseReasons.has('manual')); return; }
    if (game.phase !== 'playing' || game.paused) return;
    if (event.key === 'ArrowLeft') game.aim(game.aimX - 13);
    if (event.key === 'ArrowRight') game.aim(game.aimX + 13);
    if (event.key === ' ' && !event.repeat) { unlockAudio(); game.drop(); }
  });
  document.addEventListener('visibilitychange', () => { activePointer = null; setPause('visibility', document.hidden); });
  window.addEventListener('blur', () => { activePointer = null; setPause('window', true); });
  window.addEventListener('focus', () => setPause('window', false));
  $('restart-button').addEventListener('click', restart); $('play-again').addEventListener('click', restart);
  $('pause-button').addEventListener('click', () => setPause('manual', !pauseReasons.has('manual')));
  $('resume-button').addEventListener('click', () => { pauseReasons.delete('window'); setPause('manual', false); canvas.focus({ preventScroll: true }); });
  $('sound-button').addEventListener('click', () => { muted = !muted; save(); updateSoundButton(); unlockAudio(); });
  $('help-button').addEventListener('click', () => { $('help-dialog').showModal(); setPause('help', true); });
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  $('understood-button').addEventListener('click', () => $('help-dialog').close());
  $('help-dialog').addEventListener('close', () => { setPause('help', false); canvas.focus({ preventScroll: true }); });

  function drawBadge(x, y, level, angle = 0, scale = 1, alpha = 1) {
    const data = LEVELS[level - 1], radius = data.radius;
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.globalAlpha = alpha;
    ctx.shadowColor = '#48245320'; ctx.shadowBlur = 7; ctx.shadowOffsetY = 3;
    ctx.beginPath(); ctx.arc(0, 0, radius - 0.7, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = data.color + '66'; ctx.lineWidth = level === 9 ? 3 : 1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, radius - 3.3, 0, Math.PI * 2); ctx.strokeStyle = data.color + '16'; ctx.lineWidth = 1; ctx.stroke();
    const img = textures.get(level);
    if (img) {
      ctx.rotate(angle);
      const edge = radius * 1.49, fit = Math.min(edge / img.width, edge / img.height);
      ctx.drawImage(img, -img.width * fit / 2, -img.height * fit / 2, img.width * fit, img.height * fit);
    }
    ctx.restore();
  }
  function draw(delta) {
    ctx.clearRect(0, 0, RULES.width, RULES.height);
    ctx.fillStyle = '#faf7fd'; ctx.fillRect(0, 0, RULES.width, RULES.dangerY);
    const danger = game.dangerMs > 0;
    ctx.save(); ctx.setLineDash([5, 7]); ctx.lineWidth = 1;
    ctx.strokeStyle = danger ? '#cc6969' : '#d4bfdc';
    ctx.beginPath(); ctx.moveTo(16, RULES.dangerY); ctx.lineTo(RULES.width - 16, RULES.dangerY); ctx.stroke(); ctx.restore();
    ctx.font = '11px "Microsoft YaHei",sans-serif'; ctx.fillStyle = danger ? '#bd5959' : '#b8a0c5'; ctx.textAlign = 'right';
    ctx.fillText(danger ? '越线警告 · ' + Math.max(0, (RULES.overflow - game.dangerMs) / 1000).toFixed(1) + 's' : '警戒线', RULES.width - 19, RULES.dangerY - 8);
    if (ready && game.phase === 'playing') {
      const r = LEVELS[game.current - 1].radius, x = game.aimX;
      let target = RULES.height - RULES.wall - r;
      for (const ball of game.balls.values()) {
        const reach = r + LEVELS[ball.plugin.level - 1].radius, dx = Math.abs(ball.position.x - x);
        if (dx < reach) target = Math.min(target, ball.position.y - Math.sqrt(reach * reach - dx * dx));
      }
      ctx.save(); ctx.setLineDash([2, 7]); ctx.strokeStyle = '#bba0cd88'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, RULES.spawnY + r + 8); ctx.lineTo(x, Math.max(RULES.spawnY + r + 8, target)); ctx.stroke(); ctx.restore();
      if (target > RULES.spawnY + r * 2) {
        ctx.beginPath(); ctx.ellipse(x, Math.min(target + r, RULES.height - RULES.wall), r * 0.55, 3, 0, 0, Math.PI * 2); ctx.fillStyle = '#6c328815'; ctx.fill();
      }
      const cooled = game.now - game.lastDropAt >= RULES.cooldown - 0.001;
      drawBadge(x, RULES.spawnY, game.current, 0, 1, cooled ? 1 : 0.38);
      ctx.fillStyle = '#a78cb8'; ctx.beginPath(); ctx.moveTo(x - 3, 8); ctx.lineTo(x + 3, 8); ctx.lineTo(x, 12); ctx.fill();
    }
    for (const ball of game.balls.values()) {
      const age = game.now - ball.plugin.createdAt;
      const pop = !reducedMotion && age < 230 ? 1 + Math.sin(age / 230 * Math.PI) * 0.07 : 1;
      drawBadge(ball.position.x, ball.position.y, ball.plugin.level, ball.angle, pop);
    }
    const effectDelta = game.paused ? 0 : delta;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.age += effectDelta;
      if (p.age > p.life) { particles.splice(i, 1); continue; }
      p.x += p.vx * effectDelta; p.y += p.vy * effectDelta; p.vy += (p.confetti ? 190 : 120) * effectDelta;
      ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = Math.max(0, 1 - p.age / p.life); ctx.fillStyle = p.color;
      if (p.confetti) { ctx.rotate(p.rotation + p.age * 3); ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5); }
      else { ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i]; f.age += effectDelta;
      if (f.age > 0.85) { floaters.splice(i, 1); continue; }
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - f.age / 0.85); ctx.fillStyle = '#81469b';
      ctx.font = 'bold 17px Georgia,serif'; ctx.textAlign = 'center'; ctx.fillText(f.text, f.x, f.y - f.age * 38); ctx.restore();
    }
    const state = !ready ? '准备出发' : game.phase === 'won' ? '已抵达南京大学' : game.phase === 'lost' ? '本局结束' : game.paused ? '已暂停' : danger ? '留意堆叠高度' : game.now - game.lastDropAt < RULES.cooldown ? '校徽投放中' : '等待投放';
    if (state !== lastHud) { $('game-status').textContent = state; lastHud = state; }
    const hint = touchMode || matchMedia('(pointer:coarse)').matches ? '按住拖动瞄准，松手投放' : '移动瞄准，点击投放';
    if ($('play-hint').textContent !== hint) $('play-hint').textContent = hint;
  }
  function resize() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, canvas.clientWidth), scale = width / RULES.width * pixelRatio;
    canvas.width = Math.round(RULES.width * scale); canvas.height = Math.round(RULES.height * scale);
    ctx.setTransform(canvas.width / RULES.width, 0, 0, canvas.height / RULES.height, 0, 0);
  }
  new ResizeObserver(resize).observe($('board-shell')); resize();
  function frame(time) {
    const elapsed = frameTime ? Math.min((time - frameTime) / 1000, 0.1) : 0; frameTime = time;
    if (ready && !game.paused && game.phase === 'playing') {
      accumulator += elapsed * 1000;
      let updates = 0;
      while (accumulator + 0.001 >= RULES.step && updates < 6) { game.step(); accumulator -= RULES.step; updates++; }
    } else accumulator = 0;
    draw(elapsed); requestAnimationFrame(frame);
  }
  async function loadAssets() {
    ready = false; $('loading-panel').hidden = false; $('retry-assets').hidden = true;
    $('loading-message').textContent = '正在准备校徽…';
    try {
      await Promise.all(LEVELS.map(level => new Promise((resolve, reject) => {
        const img = new Image(); const timer = setTimeout(() => reject(new Error(level.name)), 15000);
        img.onload = () => { clearTimeout(timer); textures.set(level.level, img); resolve(); };
        img.onerror = () => { clearTimeout(timer); reject(new Error(level.name)); };
        img.src = level.image;
      })));
      ready = true; $('loading-panel').hidden = true; updateHUD();
    } catch (error) {
      $('loading-message').textContent = error.message + '校徽加载失败，请确认 assets 文件夹完整。'; $('retry-assets').hidden = false;
    }
  }
  $('retry-assets').addEventListener('click', loadAssets);
  updateSoundButton(); updateHUD(); void loadAssets(); requestAnimationFrame(frame);

  // The agent-facing actions share the exact state and controls used by players.
  const modelContext = document.modelContext;
  if (modelContext?.registerTool) {
    const lifecycle = new AbortController();
    const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
    const validateEmpty = input => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new TypeError('不接受额外参数'); };
    const read = () => ({ ready, width: RULES.width, height: RULES.height, ...game.snapshot() });
    const tools = [
      { name: 'get_game_state', title: '读取合成游戏状态', description: '读取当前校徽、下一枚、得分、球的位置和胜负状态。', inputSchema: emptySchema, annotations: { readOnlyHint: true }, execute(input) { validateEmpty(input); return read(); } },
      { name: 'drop_ball', title: '投放一枚校徽', description: '在横向位置 x 投放当前校徽；x 为 0 到 1，冷却或暂停时不可投放。', inputSchema: { type: 'object', properties: { x: { type: 'number', minimum: 0, maximum: 1 } }, required: ['x'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => k !== 'x') || typeof input.x !== 'number' || !Number.isFinite(input.x) || input.x < 0 || input.x > 1) throw new TypeError('x 必须是 0 到 1 之间的数字');
        if (!ready) throw new Error('校徽尚未准备好');
        const result = game.drop(input.x * RULES.width); if (!result.ok) throw new Error(result.reason);
        return { result, state: read() };
      } },
      { name: 'restart_game', title: '重新开始合成游戏', description: '立即清空当前棋盘和本局分数，开始新的一局；保留最佳纪录。', inputSchema: emptySchema, annotations: { readOnlyHint: false }, execute(input) { validateEmpty(input); restart(); return read(); } }
    ];
    for (const tool of tools) {
      try { void Promise.resolve(modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch {}
    }
    window.addEventListener('pagehide', event => { if (!event.persisted) lifecycle.abort(); });
  }
})();
