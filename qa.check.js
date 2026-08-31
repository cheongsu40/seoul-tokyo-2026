/* Seoul–Tokyo 2026 regression QA. Run with `npm ci && npm test`. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const FILE = path.join(__dirname, 'index.html');
const html = fs.readFileSync(FILE, 'utf8');
let pass = 0;
const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (error) => errors.push(`jsdom: ${error.message}`));
virtualConsole.on('error', (...args) => errors.push(`console: ${args.join(' ')}`));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/index.html',
  virtualConsole,
  beforeParse(window) {
    window.fetch = () => Promise.reject(new Error('offline in QA'));
    window.scrollTo = () => {};
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
  },
});
dom.window.Element.prototype.scrollIntoView = function () {};
const { document } = dom.window;

check('initial render has no runtime errors', errors.length === 0, errors.join(' | '));
check('all eight navigation tabs render', document.querySelectorAll('#tabs .tab').length === 8);
check('Seoul itinerary renders', document.querySelectorAll('#content .day').length > 0);

const data = JSON.parse(dom.window.eval(`JSON.stringify({
  views: VIEWS.map(v => v.id),
  seoul: SEOUL_DAYS,
  tokyo: TOKYO_DAYS,
  todos: TODOS,
  bench: BENCH,
  categories: Object.keys(CAT),
  zones: {seoul: Object.keys(ZONES.seoul), tokyo: Object.keys(ZONES.tokyo)}
})`));
check('view ids are unique', new Set(data.views).size === data.views.length);
check('day ids are unique', new Set([...data.seoul, ...data.tokyo].map((day) => day.id)).size === data.seoul.length + data.tokyo.length);
const allDates = [...data.seoul, ...data.tokyo].map((day) => day.iso);
check('day dates are chronological', allDates.every((date, index) => index === 0 || date >= allDates[index - 1]));
check('Seoul/Tokyo transfer shares one calendar date', allDates.filter((date) => date === '2026-09-02').length === 2);
check('every day has itinerary items', [...data.seoul, ...data.tokyo].every((day) => Array.isArray(day.items) && day.items.length > 0));
check('to-do ids are unique', new Set(data.todos.map((todo) => todo[0])).size === data.todos.length);
check('every to-do has a title and timing cue', data.todos.every((todo) => todo[0] && todo[2] && todo[3]));
check('requested Taecho booking remains actionable', !data.todos.find((todo) => todo[0] === 'c16')[5]);
check('teamLab entry time has a dedicated action', data.todos.some((todo) => todo[0] === 'c26' && !todo[5]));
check('facial details have a dedicated action', data.todos.some((todo) => todo[0] === 'c27' && !todo[5]));
check('flight reconfirmation has a dedicated action', data.todos.some((todo) => todo[0] === 'c28' && !todo[5]));

const itinerary = [
  ...data.seoul.flatMap((day) => day.items.map((item) => ({ city: 'seoul', day, item }))),
  ...data.tokyo.flatMap((day) => day.items.map((item) => ({ city: 'tokyo', day, item }))),
];
const externalTransitZones = new Set(['ich', 'gmp', 'hnd', 'nrt']);
check('every itinerary category is defined', itinerary.every(({ item }) => data.categories.includes(item[2])));
check('every itinerary map zone is defined or an external airport', itinerary.every(({ city, item }) => data.zones[city].includes(item[3]) || externalTransitZones.has(item[3])));
check('every itinerary duration is finite and non-negative', itinerary.every(({ item }) => Number.isFinite(item[8]) && item[8] >= 0));
check('every scheduled shopping stop is capped at 20 minutes', itinerary.every(({ item }) => item[2] !== 'shop' || item[8] <= 20));
check('every itinerary link is an absolute web URL', itinerary.every(({ item }) => !item[10] || /^https:\/\//.test(item[10])));
check('every forced start is a valid minute value', itinerary.every(({ item }) => item[12] == null || (Number.isFinite(item[12]) && item[12] >= 0 && item[12] < 1440)));
check('base itinerary has no duplicate day titles', [...data.seoul, ...data.tokyo].every((day) => new Set(day.items.map((item) => item[1])).size === day.items.length));

for (const city of ['seoul', 'tokyo']) {
  for (const item of data.bench[city].filter(Boolean)) {
    check(`${city} Bench item ${item[1]} has valid category`, data.categories.includes(item[2]));
    check(`${city} Bench item ${item[1]} has valid zone`, data.zones[city].includes(item[3]) || externalTransitZones.has(item[3]));
    check(`${city} Bench item ${item[1]} has valid duration`, Number.isFinite(item[8]) && item[8] >= 0);
    check(`${city} Bench shopping item ${item[1]} is capped at 20 minutes`, item[2] !== 'shop' || item[8] <= 20);
  }
}

for (const day of [...data.seoul, ...data.tokyo]) {
  const computed = JSON.parse(dom.window.eval(`JSON.stringify(compute(findDay(${JSON.stringify(day.id)})))`));
  const starts = computed.rows.filter((row) => row.type === 'item').map((row) => row.start);
  check(`${day.id} computes finite times`, Number.isFinite(computed.end) && Number.isFinite(computed.transit));
  check(`${day.id} item starts are chronological`, starts.every((start, i) => Number.isFinite(start) && (!i || start >= starts[i - 1])));
}

dom.window.eval("window.__fakeNow={date:'2026-09-05',mins:600}");
check('date-aware launch opens Tokyo during Tokyo stay', dom.window.eval('initialView()') === 'tokyo');
dom.window.eval("window.__fakeNow={date:'2026-09-02',mins:420}");
check('transfer morning opens Seoul before landing', dom.window.eval('initialView()') === 'seoul');
dom.window.eval("window.__fakeNow={date:'2026-09-02',mins:615}");
check('transfer day switches to Tokyo at landing', dom.window.eval('initialView()') === 'tokyo');
dom.window.eval('delete window.__fakeNow');

for (const view of data.views) {
  const before = errors.length;
  dom.window.eval(`curView=${JSON.stringify(view)}; renderAll()`);
  check(`view ${view} renders content`, document.querySelector('#content').children.length > 0);
  check(`view ${view} has no runtime error`, errors.length === before, errors.slice(before).join(' | '));
}

dom.window.eval("curView='seoul'; renderAll(); openBench()");
check('Bench sheet opens', Boolean(document.querySelector('#sheet') && document.querySelector('#sheetbg')));
check('Bench offers add controls', document.querySelectorAll('#sheet .add').length > 0);
dom.window.eval('closeBench()');
check('Bench sheet closes', !document.querySelector('#sheet') && !document.querySelector('#sheetbg'));

dom.window.eval("store.extra={};curView='seoul';renderAll();openBench()");
let firstRow = document.querySelector('#sheet .brow');
firstRow.querySelector('.add').click();
firstRow.querySelector('.dp[data-day="s0"]').click();
dom.window.eval('openBench()');
firstRow = document.querySelector('#sheet .brow');
firstRow.querySelector('.add').click();
firstRow.querySelector('.dp[data-day="s0"]').click();
check('Bench prevents duplicate adds to the same day', dom.window.eval('store.extra.s0.length') === 1);

dom.window.eval("store.checks={};curView='todo';renderAll()");
const todoLink = document.querySelector('.todo[data-t="c13"] a');
todoLink.addEventListener('click', (event) => event.preventDefault());
todoLink.click();
check('clicking a to-do link does not toggle completion', !dom.window.eval('store.checks.c13'));

check('City Tour Bus boards after the chicken lunch and before the 4:50 last bus', (() => {
  const tueRows = JSON.parse(dom.window.eval(`JSON.stringify(compute(findDay('s3')).rows.filter(r=>r.type==='item'))`));
  const bus = tueRows.find((row) => row.it[1].includes('City Tour Bus'));
  const lunch = tueRows.find((row) => row.it[1].includes('BBQ Chicken'));
  return bus && lunch && bus.start >= lunch.start + lunch.it[8] && bus.start <= 16 * 60 + 50;
})());
const mondayRows = JSON.parse(dom.window.eval(`JSON.stringify(compute(findDay('s2')).rows.filter(r=>r.type==='item'))`));
check('Monday morning split reconvenes before Twelve', (() => {
  const tracked = mondayRows.filter((row) => row.track);
  const twelve = mondayRows.find((row) => row.it[1].includes('Twelve'));
  return tracked.length === 2 && new Set(tracked.map((r) => r.track)).size === 2 && twelve && tracked.every((r) => r.start + r.it[8] <= twelve.start);
})());
check('Monday afternoon stays single-track', mondayRows.every((row) => !row.track || row.start < 12 * 60));
const bornBredRow = mondayRows.find((row) => row.it[1].includes('Born and Bred'));
check('Monday spa leaves ample buffer before the 6 PM Born and Bred', (() => {
  const spaRow = mondayRows.find((row) => row.it[1].includes('Spa Gogyeol'));
  return spaRow && bornBredRow && bornBredRow.start - (spaRow.start + spaRow.it[8]) >= 45;
})());
check('Ecojardin now opens Tuesday at 9 AM sharp', (() => {
  const tueRows = JSON.parse(dom.window.eval(`JSON.stringify(compute(findDay('s3')).rows.filter(r=>r.type==='item'))`));
  const eco = tueRows.find((row) => row.it[1].includes('Ecojardin'));
  return eco && eco.start === 9 * 60 && !mondayRows.some((row) => row.it[1].includes('Ecojardin'));
})());
check('Dosan golf flagships run inside the Tuesday Rodeo block', (() => {
  const tueRows = JSON.parse(dom.window.eval(`JSON.stringify(compute(findDay('s3')).rows.filter(r=>r.type==='item'))`));
  const names = ['Titleist Dosan', 'Maison Southcape', 'G/FORE Seoul', 'Malbon 6451', 'Haus Dosan'];
  const shops = names.map((name) => tueRows.find((row) => row.it[1].includes(name)));
  return shops.every(Boolean) && shops.every((row) => row.start + row.it[8] <= 20 * 60);
})());
const tuesdayRows = JSON.parse(dom.window.eval(`JSON.stringify(compute(findDay('s3')).rows.filter(r=>r.type==='item'))`));
const manorsRow = tuesdayRows.find((row) => row.it[1].includes('MANORS Golf'));
const vinylRow = tuesdayRows.find((row) => row.it[1].includes('VINYL & PLASTIC'));
check('MANORS Hannam is scheduled before its official 8 PM close', manorsRow && manorsRow.start + manorsRow.it[8] <= 20 * 60);
check('Vinyl & Plastic follows MANORS and closes with ample buffer', vinylRow && manorsRow && vinylRow.start > manorsRow.start && vinylRow.start + vinylRow.it[8] <= 21 * 60);
check('Tokyo baseball matchup is confirmed in the itinerary', /Yakult Swallows vs Chunichi Dragons/.test(html));
const sundayTokyoRows = JSON.parse(dom.window.eval(`JSON.stringify(compute(findDay('t4')).rows.filter(r=>r.type==='item'))`));
const shibuyaSkyRows = JSON.parse(dom.window.eval(`JSON.stringify(TOKYO_DAYS.flatMap(day=>day.items).filter(item=>item[1].includes('Shibuya Sky')))`));
const shibuyaSkyRow = sundayTokyoRows.find((row) => row.it[1].includes('Shibuya Sky'));
check('Shibuya Sky appears once on the confirmed Sunday', shibuyaSkyRows.length === 1 && shibuyaSkyRow);
check('Shibuya Sky is anchored at the booked 3:20 PM slot', shibuyaSkyRow && shibuyaSkyRow.start === 15 * 60 + 20);
check('Shibuya Sky booking details include party size and reference', /Adult \(12\+\) ×6/.test(shibuyaSkyRow?.it[9] || '') && /SXP766439/.test(shibuyaSkyRow?.it[9] || ''));
check('official K-ETA exemption notice is linked', /k-eta\.go\.kr\/.+299707/.test(html));

check('voting feature is absent', !/\b(vote|voting|proposal)\b/i.test(html));
check('retired voting API is absent', !/st26-api|api\/proposals/i.test(html));
const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
check('service worker cache version matches release', /st26-v10/.test(sw));
check('navigation uses network-first freshness', /req\.mode === 'navigate'[\s\S]+fetch\(req, \{ cache: 'no-cache' \}\)/.test(sw));
check('service worker only deletes this app cache family', /k\.startsWith\(CACHE_PREFIX\)/.test(sw));
check('service worker has an offline document fallback', /caches\.match\('\.\/index\.html'\)/.test(sw));

function corruptStoreStillRenders(raw) {
  const localErrors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (error) => localErrors.push(error.message));
  vc.on('error', (...args) => localErrors.push(args.join(' ')));
  const testDom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/index.html', virtualConsole: vc,
    beforeParse(window) {
      window.localStorage.setItem('st26v2', raw);
      window.fetch = () => Promise.reject(new Error('offline in QA'));
      window.scrollTo = () => {};
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    },
  });
  const ok = testDom.window.document.querySelectorAll('#content .day').length > 0 && localErrors.length === 0;
  testDom.window.close();
  return ok;
}
check('null saved state cannot blank the app', corruptStoreStillRenders('null'));
check('wrong-type saved state cannot blank the app', corruptStoreStillRenders('{"extra":[],"checks":"bad","wx":7,"mode":"wide"}'));

dom.window.close();
console.log(`PASS: ${pass}  FAIL: ${failures.length}`);
if (failures.length) {
  failures.forEach((failure) => console.error(`✗ ${failure}`));
  process.exit(1);
}
console.log('✓ ALL CHECKS PASSED');
