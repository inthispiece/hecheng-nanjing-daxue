(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('../vendor/matter.min.js') : root.Matter);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NJUMerge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Matter) {
  'use strict';
  const LEVELS = Object.freeze([
    { id: 'lanxiang', name: '蓝翔技校', short: '蓝翔', radius: 19, color: '#d85a44' },
    { id: 'njust', name: '南京理工大学', short: '南理工', radius: 26, color: '#973c9d' },
    { id: 'seu', name: '东南大学', short: '东南', radius: 34, color: '#327d69' },
    { id: 'xjtu', name: '西安交通大学', short: '西交', radius: 43, color: '#32659a' },
    { id: 'zju', name: '浙江大学', short: '浙大', radius: 53, color: '#2876b5' },
    { id: 'fudan', name: '复旦大学', short: '复旦', radius: 64, color: '#255da1' },
    { id: 'tsinghua', name: '清华大学', short: '清华', radius: 76, color: '#843b9e' },
    { id: 'pku', name: '北京大学', short: '北大', radius: 89, color: '#ae303d' },
    { id: 'nju', name: '南京大学', short: '南大', radius: 103, color: '#6c3288' }
  ].map((level, index) => Object.freeze({ ...level, level: index + 1, points: 2 ** (index + 1), image: 'assets/logos/' + level.id + '.png' })));
  const RULES = Object.freeze({ width: 420, height: 600, wall: 10, spawnY: 48, dangerY: 109, step: 1000 / 60, cooldown: 400, grace: 1000, overflow: 2000 });
  const clamp = (x, low, high) => Math.min(high, Math.max(low, x));
  function chooseLevel(random = Math.random) {
    const roll = random();
    return roll < 0.6 ? 1 : roll < 0.9 ? 2 : 3;
  }
  function selectMerges(pairs, bodies) {
    const used = new Set();
    const result = [];
    const ordered = [...pairs].sort((a, b) => Math.min(a[0], a[1]) - Math.min(b[0], b[1]) || Math.max(a[0], a[1]) - Math.max(b[0], b[1]));
    for (const [aId, bId] of ordered) {
      const a = bodies.get(aId), b = bodies.get(bId);
      if (!a || !b || aId === bId || used.has(aId) || used.has(bId)) continue;
      if (a.plugin.level !== b.plugin.level || a.plugin.level >= LEVELS.length) continue;
      used.add(aId); used.add(bId); result.push([a, b]);
    }
    return result;
  }
  class Game {
    constructor({ random = Math.random, onEvent = () => {} } = {}) {
      this.random = random;
      this.onEvent = onEvent;
      this.restart(false);
    }
    restart(emit = true) {
      if (this.engine) { Matter.Events.off(this.engine); Matter.Composite.clear(this.engine.world, false); Matter.Engine.clear(this.engine); }
      this.engine = Matter.Engine.create({ enableSleeping: true, positionIterations: 8, velocityIterations: 8 });
      this.engine.gravity.y = 1.3;
      this.balls = new Map(); this.pending = new Map(); this.now = 0;
      this.lastDropAt = -Infinity; this.score = 0; this.maxLevel = 1; this.dangerMs = 0;
      this.phase = 'playing'; this.paused = false; this.current = chooseLevel(this.random); this.next = chooseLevel(this.random);
      this.aimX = RULES.width / 2;
      const options = { isStatic: true, friction: 0.45, restitution: 0.08, label: 'wall' };
      Matter.Composite.add(this.engine.world, [
        Matter.Bodies.rectangle(-20, 300, 60, 1600, options),
        Matter.Bodies.rectangle(RULES.width + 20, 300, 60, 1600, options),
        Matter.Bodies.rectangle(RULES.width / 2, RULES.height + 20, RULES.width + 120, 60, options)
      ]);
      const collect = ({ pairs }) => {
        for (const { bodyA, bodyB } of pairs) {
          if (!this.balls.has(bodyA.id) || !this.balls.has(bodyB.id)) continue;
          const ids = [bodyA.id, bodyB.id].sort((a, b) => a - b);
          this.pending.set(ids.join(':'), ids);
        }
      };
      Matter.Events.on(this.engine, 'collisionStart collisionActive', collect);
      if (emit) this.onEvent({ type: 'restart' });
      return this.snapshot();
    }
    aim(x) {
      if (!Number.isFinite(x)) throw new TypeError('投放位置必须是有限数字');
      const r = LEVELS[this.current - 1].radius;
      this.aimX = clamp(x, RULES.wall + r + 1, RULES.width - RULES.wall - r - 1);
      return this.aimX;
    }
    addBall(level, x, y, { immuneUntil = this.now + RULES.grace } = {}) {
      if (!Number.isInteger(level) || level < 1 || level > 9) throw new RangeError('无效的学校等级');
      const data = LEVELS[level - 1];
      const body = Matter.Bodies.circle(x, y, data.radius, {
        restitution: 0.14, friction: 0.35, frictionStatic: 0.6, frictionAir: 0.007,
        density: 0.002, sleepThreshold: 75, label: data.id,
        plugin: { level, createdAt: this.now, immuneUntil, dangerSince: null }
      }, 48);
      this.balls.set(body.id, body); Matter.Composite.add(this.engine.world, body);
      return body;
    }
    drop(x = this.aimX) {
      if (this.phase !== 'playing' || this.paused) return { ok: false, reason: '当前无法投放' };
      if (this.now - this.lastDropAt + 0.001 < RULES.cooldown) return { ok: false, reason: '请等待下一枚校徽' };
      this.aim(x);
      const level = this.current;
      const ball = this.addBall(level, this.aimX, RULES.spawnY);
      this.lastDropAt = this.now; this.current = this.next; this.next = chooseLevel(this.random);
      this.maxLevel = Math.max(this.maxLevel, level); this.aim(this.aimX);
      this.onEvent({ type: 'drop', level, id: ball.id });
      return { ok: true, level, id: ball.id };
    }
    setPaused(paused) {
      if (this.phase !== 'playing') return;
      this.paused = Boolean(paused); this.onEvent({ type: 'pause', paused: this.paused });
    }
    step() {
      if (this.phase !== 'playing' || this.paused) return;
      this.now += RULES.step;
      Matter.Engine.update(this.engine, RULES.step);
      const merges = selectMerges(this.pending.values(), this.balls);
      this.pending.clear();
      for (const [a, b] of merges) {
        const level = a.plugin.level + 1, r = LEVELS[level - 1].radius;
        const x = clamp((a.position.x + b.position.x) / 2, RULES.wall + r + 1, RULES.width - RULES.wall - r - 1);
        const y = Math.min((a.position.y + b.position.y) / 2, RULES.height - RULES.wall - r - 1);
        this.balls.delete(a.id); this.balls.delete(b.id);
        Matter.Composite.remove(this.engine.world, [a, b]);
        const ball = this.addBall(level, x, y, { immuneUntil: Math.max(a.plugin.immuneUntil, b.plugin.immuneUntil) });
        Matter.Body.setVelocity(ball, { x: clamp((a.velocity.x + b.velocity.x) / 2, -3, 3), y: -1.1 });
        this.score += LEVELS[level - 1].points; this.maxLevel = Math.max(this.maxLevel, level);
        this.onEvent({ type: 'merge', level, x, y, points: LEVELS[level - 1].points });
        if (level === LEVELS.length) {
          this.phase = 'won'; this.onEvent({ type: 'won', score: this.score }); break;
        }
      }
      if (this.phase === 'playing') this.checkOverflow();
    }
    checkOverflow() {
      this.dangerMs = 0;
      for (const body of this.balls.values()) {
        const data = body.plugin;
        if (this.now + 0.001 >= data.immuneUntil && body.position.y - LEVELS[data.level - 1].radius < RULES.dangerY) {
          if (data.dangerSince === null) data.dangerSince = this.now;
          this.dangerMs = Math.max(this.dangerMs, this.now - data.dangerSince);
        } else data.dangerSince = null;
      }
      if (this.dangerMs + 0.001 >= RULES.overflow) {
        this.phase = 'lost'; this.onEvent({ type: 'lost', score: this.score });
      }
    }
    snapshot() {
      return { phase: this.phase, paused: this.paused, score: this.score, maxLevel: this.maxLevel,
        current: this.current, next: this.next, aimX: this.aimX,
        cooldownMs: Math.max(0, RULES.cooldown - (this.now - this.lastDropAt)), dangerMs: this.dangerMs,
        balls: [...this.balls.values()].map(b => ({ id: b.id, level: b.plugin.level, x: b.position.x, y: b.position.y, radius: LEVELS[b.plugin.level - 1].radius })) };
    }
  }
  return { Game, LEVELS, RULES, chooseLevel, selectMerges };
});
