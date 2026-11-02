// First-run controls tutorial: a small card that walks a new player through the controls, one at a
// time, noticing when each is actually done. Skippable, and it can be replayed with "?".
import * as THREE from 'three';

const KEY = 'drystack.coached';
const read = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
const write = () => { try { localStorage.setItem(KEY, '1'); } catch (e) { /* private window */ } };

const STEPS = [
  {
    title: 'Look around',
    body: `<kbd>Drag</kbd> across the ground with the mouse, or use <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd>.`,
    aside: 'Think of walking a field before you plough it: you learn the land first.',
    begin: (g) => ({ d: g.camera.getWorldDirection(new THREE.Vector3()) }),
    done: (g, b) => g.camera.getWorldDirection(new THREE.Vector3()).angleTo(b.d) > 0.35,
  },
  {
    title: 'Come closer, step back',
    body: `Roll the <kbd>Wheel</kbd> (or pinch) to zoom. <kbd>Double-click</kbd> a stone to look at it closely.`,
    aside: 'Like crouching to read a pebble, then standing to see the whole hillside.',
    begin: (g) => ({ r: g.controls.getDistance() }),
    done: (g, b) => Math.abs(Math.log(g.controls.getDistance() / b.r)) > 0.15,
  },
  {
    title: 'Lift a stone',
    body: `<kbd>Click</kbd> any stone in the pile. It rises into your hands and follows the pointer.`,
    aside: 'It has real weight: heavy stones lag behind your hand, and you cannot shove the wall around with them.',
    begin: () => ({}),
    done: (g) => !!g.interaction.held,
    needsHeld: false,
  },
  {
    title: 'Turn it over in your hands',
    body: `<kbd>Q</kbd><kbd>E</kbd> spin it. <kbd>R</kbd><kbd>F</kbd> tip it. Or <kbd>Right-drag</kbd> (or hold <kbd>Alt</kbd>/<kbd>Option</kbd> and move) to turn it freely. <kbd>T</kbd> sets its length into the wall.`,
    aside: 'A waller does this all day: every stone has a good face and a bad one, and you find the good one like a key finding its lock.',
    begin: (g) => ({ q: g.interaction.targetQ.clone() }),
    done: (g, b) => !!g.interaction.held && g.interaction.targetQ.angleTo(b.q) > 0.6,
    needsHeld: true,
  },
  {
    title: 'Nudge it into place',
    body: `With a stone in hand, <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> slide it a few millimetres. Hold <kbd>Shift</kbd> for even finer.`,
    aside: 'Like tuning a guitar string: the last little bit is all small turns.',
    begin: () => ({ n: 0 }),
    key: (g, b, e) => { if (g.interaction.held && e.key.startsWith('Arrow')) b.n++; },
    done: (g, b) => b.n >= 2,
    needsHeld: true,
  },
  {
    title: 'Pass through the wall',
    body: `Hold <kbd>G</kbd>: the stone becomes an amber ghost that can pass through its neighbours, so you can line it up with a gap. Let go over clear space and it turns solid again.`,
    aside: 'Like holding a jigsaw piece above the puzzle before you commit it.',
    begin: () => ({}),
    done: (g) => !!g.interaction.held && g.interaction.ghosted,
    needsHeld: true,
  },
  {
    title: 'Set it down',
    body: `<kbd>Click</kbd> again to lower it. Hold <kbd>Space</kbd> to press it in, <kbd>L</kbd> shows a fit light (green bears, amber gaps).`,
    aside: 'Then look at it. If it rocks, it is wrong. That is nearly the whole craft.',
    begin: () => ({}),
    done: (g) => !g.interaction.held,
    needsHeld: true,
  },
  {
    title: 'Change your mind',
    body: `<kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Z</kbd> (or <kbd>Backspace</kbd>) undoes the last move or hammer blow.`,
    aside: 'Dry stone has no mortar, so nothing is ever final. Pick it up and try again.',
    begin: (g) => ({ n: (g._undo || []).length }),
    done: (g, b) => (g._undo || []).length < b.n,
  },
  {
    title: 'The hammer',
    body: `Press <kbd>2</kbd> for the walling hammer. <kbd>Click</kbd> strikes where the line shows, <kbd>[</kbd><kbd>]</kbd> sets the size of the bite. <kbd>1</kbd> puts the hammer down.`,
    aside: 'Like a sculptor taking away only what is not the stone you want: gently, and less than you think.',
    begin: () => ({}),
    done: (g) => g.craft && g.craft.tool === 'hammer',
    needsHeld: false,
    mustBeEmpty: true,
  },
  {
    title: 'And the rest',
    body: `<kbd>H</kbd> pour hearting · <kbd>X</kbd> press-test a stone · <kbd>P</kbd> hide the interface · <kbd>N</kbd> notes panel · <kbd>-</kbd><kbd>=</kbd> pace of the seasons (<kbd>0</kbd> pauses) · <kbd>M</kbd> sound.<br>Press <kbd>?</kbd> any time to see this again.`,
    aside: 'The wall will wait. So will the weather.',
    begin: () => ({}),
    final: true,
  },
];

export class Coach {
  constructor(game) {
    this.game = game;
    this.i = -1; this.active = false; this.b = null; this.doneAt = 0;
    const el = document.createElement('div');
    el.id = 'coach'; el.className = 'hidden';
    document.querySelector('#hud').appendChild(el);
    this.el = el;
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-c]'); if (!a) return;
      const c = a.dataset.c;
      if (c === 'next') this.go(this.i + 1);
      else if (c === 'back') this.go(this.i - 1);
      else if (c === 'end') this.end();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === '?' && !e.target.closest?.('input,textarea')) { this.active ? this.end() : this.start(); return; }
      if (!this.active) return;
      const s = STEPS[this.i];
      if (s && s.key && this.b) s.key(this.game, this.b, e);
    });
  }

  static shouldAutoStart() {
    return new URLSearchParams(location.search).get('tutorial') === '1' || (!read() && !new URLSearchParams(location.search).has('go') && !(matchMedia && matchMedia('(pointer:coarse)').matches));
  }

  start() { this.active = true; this.go(0); }

  end() {
    this.active = false; this.el.classList.add('hidden'); write();
  }

  go(i) {
    if (i < 0) i = 0;
    if (i >= STEPS.length) { this.end(); return; }
    this.i = i; this.doneAt = 0;
    const s = STEPS[i];
    this.b = s.begin(this.game);
    this.render();
    this.el.classList.remove('hidden', 'ok');
  }

  render() {
    const s = STEPS[this.i], n = STEPS.length;
    const dots = STEPS.map((_, k) => `<i class="${k < this.i ? 'd' : k === this.i ? 'c' : ''}"></i>`).join('');
    this.el.innerHTML = `
      <div class="c-top"><span class="c-step">${this.i + 1} of ${n}</span><span class="c-dots">${dots}</span><button data-c="end" class="c-x" title="Close the tutorial (?)">×</button></div>
      <h3>${s.title}</h3>
      <p class="c-body">${s.body}</p>
      <p class="c-aside">${s.aside}</p>
      <div class="c-foot">
        <button data-c="back" ${this.i === 0 ? 'disabled' : ''}>Back</button>
        <span class="c-wait"></span>
        <button data-c="next" class="c-next">${s.final ? 'Done' : 'Skip'}</button>
      </div>`;
  }

  // called every frame
  update() {
    if (!this.active || this.i < 0) return;
    const g = this.game, s = STEPS[this.i], it = g.interaction;
    if (s.final) return;
    const wait = this.el.querySelector('.c-wait');
    if (this.doneAt) {
      if (performance.now() - this.doneAt > 1300) this.go(this.i + 1);
      return;
    }
    // some steps need a stone in hand first; say so instead of waiting in silence
    if (wait) wait.textContent = s.needsHeld && !it.held ? 'Lift a stone first' : s.mustBeEmpty && it.held ? 'Set your stone down first' : '';
    let ok = false;
    try { ok = s.done(g, this.b); } catch (e) { ok = false; }
    if (ok) {
      this.doneAt = performance.now();
      this.el.classList.add('ok');
      if (wait) wait.textContent = '✓ Good';
      if (this.i === STEPS.length - 2) write();
    }
  }
}
