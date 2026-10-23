// HUD: lesson panel, craft notes, hints, tooltips, toolbar.
const $ = (s) => document.querySelector(s);

const CLASS_NAMES = { foundation: 'Footing stone', builder: 'Builder', through: 'Through stone', cope: 'Cope', hearting: 'Hearting', pinning: 'Pinning', shard: 'Flake' };

export class UI {
  constructor(game) {
    this.game = game;
    this.tab = game.cfg.mode === 'lesson' ? 'lesson' : 'notes';
    this.hud = $('#hud');
    document.querySelectorAll('#toolbar button').forEach((b) => b.addEventListener('click', () => game.action(b.dataset.act)));
    document.querySelectorAll('#holdbar button').forEach((b) => b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); game.holdAction(b.dataset.act); }));
    document.querySelectorAll('#panel .tabs button').forEach((b) => b.addEventListener('click', () => this.setTab(b.dataset.tab)));
    $('#panelToggle').addEventListener('click', () => this.togglePanel());
    document.querySelectorAll('#season [data-rate]').forEach((b) => b.addEventListener('click', () => game.setRate(+b.dataset.rate)));
    if (game.cfg.mode !== 'lesson') document.querySelector('#panel .tabs button[data-tab="lesson"]').classList.add('hidden');
    this.setTab(this.tab);
    if (game.cfg.mode === 'focus') this.togglePanel();
    this.hintIdle = `<kbd>Click</kbd> lift a stone &nbsp;·&nbsp; <kbd>Drag</kbd>/<kbd>Right-drag</kbd>/<kbd>←→↑↓</kbd> look around &nbsp;·&nbsp; <kbd>Wheel</kbd> zoom &nbsp;·&nbsp; <kbd>Double-click</kbd> look closely &nbsp;·&nbsp; <kbd>2</kbd> hammer &nbsp;·&nbsp; <kbd>X</kbd> press`;
    this.hintHold = `<kbd>Q</kbd><kbd>E</kbd>/<kbd>Shift+wheel</kbd> turn &nbsp;·&nbsp; <kbd>R</kbd><kbd>F</kbd> tip &nbsp;·&nbsp; <kbd>T</kbd> length in &nbsp;·&nbsp; <kbd>V</kbd> examine &nbsp;·&nbsp; <kbd>←→↑↓</kbd> nudge &nbsp;·&nbsp; hold <kbd>Space</kbd> press in &nbsp;·&nbsp; <kbd>L</kbd> fit light &nbsp;·&nbsp; <kbd>Right-drag</kbd> orbit &nbsp;·&nbsp; <kbd>Click</kbd> set`;
    this.hintHammer = `<kbd>Click</kbd> strike &nbsp;·&nbsp; <kbd>Shift+wheel</kbd> or <kbd>[</kbd><kbd>]</kbd> bite &nbsp;·&nbsp; <kbd>Q</kbd><kbd>E</kbd> angle of the blow &nbsp;·&nbsp; <kbd>Right-drag</kbd> orbit &nbsp;·&nbsp; <kbd>1</kbd> back to hands`;
    $('#hints').innerHTML = this.hintIdle;
  }

  // quiet season readout: the date, and which way the year is leaning
  season(S) {
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const LEN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let d = Math.floor(S.doy), m = 0;
    while (m < 11 && d > LEN[m]) { d -= LEN[m]; m++; }
    const name = S.doy < 80 || S.doy >= 355 ? 'winter' : S.doy < 172 ? 'spring' : S.doy < 266 ? 'summer' : 'autumn';
    const yr = S.year ? ` · year ${S.year + 1}` : '';
    $('#seasonDate').textContent = `${MON[m]} ${d} · ${name}${yr}`;
  }

  seasonRate(S) {
    document.querySelectorAll('#season [data-rate]').forEach((b) => {
      const r = +b.dataset.rate;
      b.classList.toggle('on', r === 0 ? S.paused : !S.paused && r === S.rate);
    });
  }

  setPlace(t) { $('#placeText').textContent = t; }

  setTab(t) {
    this.tab = t;
    document.querySelectorAll('#panel .tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    $('#lessonTab').classList.toggle('hidden', t !== 'lesson');
    $('#notesTab').classList.toggle('hidden', t !== 'notes');
    this.game.showJointMarkers = t === 'notes';
  }

  togglePanel() {
    const p = $('#panel');
    p.classList.toggle('collapsed');
    $('#panelToggle').textContent = p.classList.contains('collapsed') ? '+' : '–';
  }

  hoverStone(s, px) {
    const tip = $('#tip');
    if (!s || !px) { tip.classList.add('hidden'); return; }
    tip.classList.remove('hidden');
    const kg = s.mass < 1 ? `${Math.round(s.mass * 1000)} g` : `${Math.round(s.mass)} kg`;
    const dims = `${Math.round(s.size.x * 100)} × ${Math.round(s.size.z * 100)} × ${Math.round(s.size.y * 100)} cm`;
    tip.innerHTML = `<b>${CLASS_NAMES[s.cls]}</b> &nbsp;${kg}<br><span style="color:var(--ink-3)">${dims}</span>`;
    tip.style.left = px.x + 'px'; tip.style.top = px.y + 'px';
  }

  setHolding(s) {
    const hb = $('#holdbar');
    if (!s) { hb.classList.add('hidden'); $('#hints').innerHTML = this.hintIdle; return; }
    hb.classList.remove('hidden');
    const kg = s.mass < 1 ? `${Math.round(s.mass * 1000)} g` : `${Math.round(s.mass)} kg`;
    $('#holdName').textContent = `${CLASS_NAMES[s.cls]} · ${kg}`;
    $('#hints').innerHTML = this.hintHold;
  }

  toast(msg, ms = 3200) {
    const t = $('#toast');
    t.innerHTML = msg;
    t.classList.remove('hidden');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.add('hidden'), ms);
  }

  renderLesson(steps, idx, result) {
    const el = $('#lessonTab');
    const st = steps[idx];
    const key = idx + '|' + result.progress + '|' + result.done;
    if (this._lessonKey === key) return;
    const structural = this._lessonIdx !== idx;
    this._lessonKey = key; this._lessonIdx = idx;
    if (structural) {
      el.innerHTML = `
        <div class="step-n">Step ${idx + 1} of ${steps.length}</div>
        <h4>${st.title}</h4>
        ${st.body}
        <div class="progress" id="lessonProg"><i class="dot"></i><span></span></div>
        <div class="step-nav"><button id="prevStep" ${idx === 0 ? 'disabled' : ''}>Back</button><button id="nextStep">${idx === steps.length - 1 ? 'Finish' : 'Next'}</button></div>`;
      $('#prevStep').onclick = () => this.game.lessonStep(-1);
      $('#nextStep').onclick = () => this.game.lessonStep(1);
    }
    const p = $('#lessonProg');
    p.classList.toggle('done', !!result.done);
    p.querySelector('span').textContent = result.progress;
    const nb = $('#nextStep');
    nb.classList.toggle('primary', !!result.done);
    nb.textContent = idx === steps.length - 1 ? 'Finish' : (result.done ? 'Next' : 'Skip');
  }

  renderNotes(m, spec) {
    const el = $('#notesTab');
    const pct = (v) => Math.round(v * 100) + '%';
    const cls = (ok, warn) => (ok ? 'good' : warn ? 'warn' : 'bad');
    const faces = Math.max(1, m.faceStones - m.throughs);
    const lenInR = m.lengthIn / faces;
    const H = spec.H;
    const bars = m.heights.map((h) => `<i style="height:${Math.min(100, (h / H) * 100)}%"></i>`).join('');
    el.innerHTML = `
      <p style="margin-top:2px">What a waller would notice, walking your wall.</p>
      <div class="profile">${bars}</div>
      <div class="profile-label"><span>${Math.round(m.height * 100)} cm average</span><span>${Math.round(H * 100)} cm to the copes</span></div>
      <div class="notes-grid">
        <span>Stones in the wall</span><span>${m.inWall}</span>
        <span>Footings, near · far face</span><span class="${cls(Math.min(m.footings.covA, m.footings.covB) > 0.7, Math.min(m.footings.covA, m.footings.covB) > 0.4)}">${pct(m.footings.covA)} · ${pct(m.footings.covB)}</span>
        <span>Length into the wall</span><span class="${cls(lenInR > 0.75, lenInR > 0.5)}">${m.faceStones ? pct(lenInR) : '—'}</span>
        <span>Traced (length along the face)</span><span class="${cls(m.traced === 0, m.traced < 3)}">${m.traced}</span>
        <span>Proud of the line</span><span class="${cls(m.proud === 0, m.proud < 3)}">${m.proud}</span>
        <span>Running joints</span><span class="${cls(m.running === 0, m.running < 3)}">${m.running}</span>
        <span>Hearting packed</span><span class="${cls(m.heartingFill > 0.6, m.heartingFill > 0.4)}">${m.height > 0.05 ? pct(m.heartingFill) : '—'}</span>
        <span>Throughs</span><span class="${cls(m.throughs >= Math.round(spec.L), m.throughs > 0)}">${m.throughs}</span>
        <span>Copes</span><span>${m.copes ? pct(m.copeCov) + ' covered' : '—'}</span>
      </div>
      <p class="aside">Running joints show as red marks on the face while these notes are open.</p>`;
  }

  setPhoto(on) { this.hud.classList.toggle('photo', on); }

  fitReadout(n, margin) {
    let el = document.getElementById('fitRead');
    if (!el) { el = document.createElement('span'); el.id = 'fitRead'; document.getElementById('holdName').after(el); }
    if (n === null || n === undefined) { el.textContent = ''; el.className = ''; return; }
    if (n >= 3 && margin > 0.015) { el.textContent = `bears on ${n} · steady`; el.className = 'good'; }
    else if (n >= 3 && margin > 0) { el.textContent = `bears on ${n} · near the edge`; el.className = 'warn'; }
    else if (n > 0) { el.textContent = `bears on ${n} · would rock`; el.className = 'bad'; }
    else { el.textContent = 'clear of everything'; el.className = ''; }
  }

  effort(e, mass) {
    let el = document.getElementById('effort');
    if (!el) { el = document.createElement('span'); el.id = 'effort'; el.innerHTML = '<i></i><b></b>'; document.getElementById('holdName').after(el); }
    el.firstChild.style.width = Math.round(e * 64) + 'px';
    el.classList.toggle('hot', e > 0.8);
    const w = mass < 15 ? 'light' : mass < 40 ? 'a fair weight' : mass < 90 ? 'heavy' : 'very heavy';
    el.lastChild.textContent = e > 0.8 ? 'straining' : w;
  }

  setTool(t) {
    document.querySelectorAll('#toolbar .tool').forEach((b) => b.classList.toggle('on', b.dataset.act === t));
    $('#hints').innerHTML = t === 'hammer' ? this.hintHammer : this.hintIdle;
    if (t !== 'hammer') this.hammerInfo(null);
  }

  hammerInfo(info) {
    const el = $('#hammerInfo');
    if (!info) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const pct = Math.round(info.frac * 100);
    const cls = info.frac > 0.42 ? 'bad' : info.frac > 0.2 ? 'warn' : '';
    el.innerHTML = `<b>${(info.depth * 100).toFixed(1)} cm</b> bite${info.tilt ? ` · ${Math.round(info.tilt * 57)}°` : ''} <span class="${cls}">· ${pct < 1 ? 'a chip' : pct + '% of the stone'}${info.frac > 0.42 ? ' — too much' : ''}</span>`;
    if (info.pointer) { el.style.left = info.pointer.x + 'px'; el.style.top = info.pointer.y + 'px'; }
  }
}
