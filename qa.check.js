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
  bench: BENCH
})`));
check('view ids are unique', new Set(data.views).size === data.views.length);
check('day ids are unique', new Set([...data.seoul, ...data.tokyo].map((day) => day.id)).size === data.seoul.length + data.tokyo.length);
const allDates = [...data.seoul, ...data.tokyo].map((day) => day.iso);
check('day dates are chronological', allDates.every((date, index) => index === 0 || date >= allDates[index - 1]));
check('Seoul/Tokyo transfer shares one calendar date', allDates.filter((date) => date === '2026-09-02').length === 2);
check('every day has itinerary items', [...data.seoul, ...data.tokyo].every((day) => Array.isArray(day.items) && day.items.length > 0));
check('to-do ids are unique', new Set(data.todos.map((todo) => todo[0])).size === data.todos.length);

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

check('voting feature is absent', !/\b(vote|voting|proposal)\b/i.test(html));
check('retired voting API is absent', !/st26-api|api\/proposals/i.test(html));
check('service worker cache version matches release', /st26-v5/.test(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8')));

dom.window.close();
console.log(`PASS: ${pass}  FAIL: ${failures.length}`);
if (failures.length) {
  failures.forEach((failure) => console.error(`✗ ${failure}`));
  process.exit(1);
}
console.log('✓ ALL CHECKS PASSED');
