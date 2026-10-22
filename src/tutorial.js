// The walling lesson. Each step has a live check against the analysed wall.

const pct = (v) => Math.round(v * 100) + '%';

export function makeSteps(spec, typeName) {
  const L = spec.L, H = spec.H;
  const throughsNeeded = Math.max(1, Math.round(L / 1.0));
  return [
    {
      title: 'Walk the pile',
      body: `<p>A waller starts by looking. The stone has been sorted along the line: <b>footings</b> nearest the trench, <b>builders</b> behind, long <b>throughs</b> and <b>copes</b> at the far ends, and <b>hearting</b> — the small stuff — in heaps.</p>
             <p>Click a stone to lift it. Move it, then click again to set it down. <kbd>Wheel</kbd> or <kbd>Q</kbd>/<kbd>E</kbd> turns it, <kbd>R</kbd> and <kbd>F</kbd> tip it over, <kbd>T</kbd> turns its length into the wall.</p>
             <p class="aside">Drag empty ground to walk around. Right-drag or <kbd>WASD</kbd> to move along the wall.</p>`,
      check: (m, g) => ({ done: g.stats.placed >= 2, progress: `${Math.min(2, g.stats.placed)} / 2 stones moved` }),
    },
    {
      title: 'Footings',
      body: `<p>The biggest, flattest-bedded stones go in the trench first — <b>length into the wall</b>, never along it. One row on each face, set tight to the string, tops roughly level.</p>
             <p>Set each one down and look: if it rocks, it's wrong. Turn it, try another face, or try another stone. That is the whole craft.</p>`,
      check: (m) => {
        const c = Math.min(m.footings.covA, m.footings.covB);
        return { done: c >= 0.7, progress: `Near face ${pct(m.footings.covA)} · far face ${pct(m.footings.covB)} — aim for 70% on both` };
      },
    },
    {
      title: 'Hearting',
      body: `<p>The middle is filled as you go, never after. Small stones packed tight by hand, wedging the backs of the face stones so they can't tip inward. Hearting is not rubble thrown in — it is the wall's spine.</p>
             <p><kbd>H</kbd> pours a handful where you point. Then tuck a few in by hand where there are gaps.</p>`,
      check: (m) => ({ done: m.heartingFill >= 0.55 && m.hearting >= 12, progress: `Core filled ${pct(m.heartingFill)} with ${m.hearting} hearting stones — aim for 55%` }),
    },
    {
      title: 'One over two',
      body: `<p>Now the second course. Every stone must sit <b>across a joint</b> below it — one over two, two over one. A joint that runs straight up through two courses is a <b>running joint</b>, and that is where walls open up and fall.</p>
             <p>Keep the face to the line and the length in. Running joints are marked in red when the notes are open.</p>`,
      check: (m) => ({ done: m.faceAbove >= Math.round(L * 3) && m.running <= 1, progress: `${m.faceAbove} stones above the footings · ${m.running} running joint${m.running === 1 ? '' : 's'}` }),
    },
    {
      title: 'Batter',
      body: `<p>A dry stone wall leans in on itself. The batter frames at each end give the profile; the string runs between them and climbs with the work. Keep each stone's face just inside the line — never proud of it.</p>
             <p>The wall should be getting narrower as it rises. Bring it up to half height.</p>`,
      check: (m) => ({ done: m.height >= H * 0.45 && m.proud <= 2, progress: `Height ${Math.round(m.height * 100)} cm of ${Math.round(H * 50)} · ${m.proud} proud of the line` }),
    },
    {
      title: 'Throughs',
      body: `<p>At about knee height, lay <b>through stones</b> right across the wall so they tie both faces together — about one every metre. They are the long ones at the ends of the pile.</p>
             <p>Seat each on the work below so it bears on both faces, not just on hearting.</p>`,
      check: (m) => ({ done: m.throughs >= throughsNeeded, progress: `${m.throughs} of ${throughsNeeded} throughs` }),
    },
    {
      title: 'Up to height',
      body: `<p>Carry on the same way: face stones to the line, length in, one over two, hearting packed as you go. Smaller builders towards the top. The courses don't have to be perfectly level, but the top should be.</p>`,
      check: (m) => ({ done: m.height >= H * 0.88 && m.minHeight >= H * 0.75, progress: `Average ${Math.round(m.height * 100)} cm · lowest point ${Math.round(m.minHeight * 100)} cm · target ${Math.round(H * 100)} cm` }),
    },
    {
      title: typeName.includes('Fieldstone') ? 'Capstones' : 'Copes',
      body: typeName.includes('Fieldstone')
        ? `<p>Finish with a row of the broadest stones you have left, set across the top and on edge where they'll go, tight together. Their weight pins everything beneath.</p>`
        : `<p>Finish with <b>copes</b>: stones stood on edge across the top, packed tight like books on a shelf, so their weight locks the faces together. Turn each so its flat side faces along the wall.</p>`,
      check: (m) => ({ done: m.copeCov >= 0.6, progress: `Top covered ${pct(m.copeCov)} — aim for 60%` }),
    },
    {
      title: 'A hundred winters',
      body: `<p>A well-built dry stone wall needs no mortar. It stands because every stone is held by others, and it moves a little with the frost and settles again.</p>
             <p>Press <b>Weather the wall</b> to give it a century of frost heave, rain and leaning cattle. Then walk it and see what held.</p>`,
      check: (m, g) => ({ done: !!g.stats.weathered, progress: g.stats.weathered ? g.stats.weathered : 'Not yet weathered' }),
    },
  ];
}
