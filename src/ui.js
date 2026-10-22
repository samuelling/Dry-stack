// HUD: lesson panel, craft notes, hints, tooltips, toolbar.
const $ = (s) => document.querySelector(s);

const CLASS_NAMES = { foundation: 'Footing stone', builder: 'Builder', through: 'Through stone', cope: 'Cope', hearting: 'Hearting' };

export class UI {
  constructor(game) {
    this.game = game;
    this.tab = game.cfg.mode === 'lesson' ? 'lesson' : 'notes';
    this.hud = $('#hud');
    document.querySelectorAll('#toolbar button').forEach((b) => b.addEventListener('click', () => game.action(b.dataset.act)));
    document.querySelectorAll('#holdbar button').forEach((b) => b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); game.holdAction(b.dataset.act); }));
    document.querySelectorAll('#panel .tabs button').forEach((b) => b.addEventListener('click', () => this.setTab(b.dataset.tab)));
    $('#panelToggle').addEventListener('click', () => this.togglePanel());
    if (game.cfg.mode !== 'lesson') document.querySelector('#panel .tabs button[data-tab="lesson"]').classList.add('hidden');
    this.setTab(this.tab);
    this.hintIdle = `<kbd>Click</kbd> a stone to lift it &nbsp;·&nbsp; <kbd>Drag</kbd> to look around &nbsp;·&nbsp; <kbd>WASD</kbd> walk the line &nbsp;·&nbsp; <kbd>H</kbd> hearting`;
    this.hintHold = `<kbd>Wheel</kbd>/<kbd>Q</kbd><kbd>E</kbd> turn &nbsp;·&nbsp; <kbd>R</kbd><kbd>F</kbd> tip &nbsp;·&nbsp; <kbd>T</kbd> length in &nbsp;·&nbsp; <kbd>C</kbd> on edge &nbsp;·&nbsp; hold <kbd>Space</kbd> press in &nbsp;·&nbsp; <kbd>Click</kbd> set down &nbsp;·&nbsp; <kbd>Shift</kbd> fine`;
    $('#hints').innerHTML = this.hintIdle;
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
}
