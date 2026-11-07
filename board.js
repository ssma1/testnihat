/* ===================== ОНЛАЙН-ДОСКА (только у учителя, ничего не сохраняется) ===================== */
const BW = 1240, BH = 1754;   // лист A4 (книжный), 150 точек на дюйм
let B = null;

const distSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
function shapePaths(t, x1, y1, x2, y2) {
  const P = (x, y) => ({ x, y }), cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const L = Math.min(x1, x2), R = Math.max(x1, x2), T = Math.min(y1, y2), D = Math.max(y1, y2), h = 20;
  if (t === 'line') return [[P(x1, y1), P(x2, y2)]];
  if (t === 'arrow') {
    const a = Math.atan2(y2 - y1, x2 - x1);
    return [[P(x1, y1), P(x2, y2)], [P(x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45)), P(x2, y2), P(x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45))]];
  }
  if (t === 'rect') return [[P(L, T), P(R, T), P(R, D), P(L, D), P(L, T)]];
  if (t === 'tri') return [[P(cx, T), P(R, D), P(L, D), P(cx, T)]];
  if (t === 'triR') return [[P(L, T), P(L, D), P(R, D), P(L, T)]];
  if (t === 'axes') {   // координатная плоскость с делениями
    const o = [[P(L, cy), P(R, cy)], [P(cx, D), P(cx, T)], [P(R - h, cy - h / 2), P(R, cy), P(R - h, cy + h / 2)], [P(cx - h / 2, T + h), P(cx, T), P(cx + h / 2, T + h)]];
    for (let x = cx + 30; x < R - 25; x += 30) o.push([P(x, cy - 6), P(x, cy + 6)]);
    for (let x = cx - 30; x > L + 10; x -= 30) o.push([P(x, cy - 6), P(x, cy + 6)]);
    for (let y = cy + 30; y < D - 10; y += 30) o.push([P(cx - 6, y), P(cx + 6, y)]);
    for (let y = cy - 30; y > T + 25; y -= 30) o.push([P(cx - 6, y), P(cx + 6, y)]);
    return o;
  }
  if (t === 'numl') {   // числовая прямая
    const o = [[P(L, y1), P(R, y1)], [P(R - h, y1 - h / 2), P(R, y1), P(R - h, y1 + h / 2)]];
    for (let x = L + 30; x < R - 20; x += 30) o.push([P(x, y1 - 8), P(x, y1 + 8)]);
    return o;
  }
  const pts = []; for (let i = 0; i <= 72; i++) { const a = i / 72 * 2 * Math.PI; pts.push(P(cx + (R - L) / 2 * Math.cos(a), cy + (D - T) / 2 * Math.sin(a))); }
  return [pts];   // круг / эллипс
}
// «Исправление» фигур: линия, круг и прямоугольник, нарисованные от руки, становятся ровными
function snapStroke(pts) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
  const diag = Math.hypot(x2 - x1, y2 - y1); if (diag < 140) return null;   // мелкие штрихи (цифры, буквы) не трогаем
  const a = pts[0], b = pts[pts.length - 1];
  if (Math.hypot(a.x - b.x, a.y - b.y) >= diag * 0.25)
    return Math.max(...pts.map(p => distSeg(p, a, b))) < diag * 0.06 ? shapePaths('line', a.x, a.y, b.x, b.y) : null;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
  if (rx < 20 || ry < 20) return null;
  const rs = pts.map(p => Math.hypot((p.x - cx) / rx, (p.y - cy) / ry)), m = rs.reduce((s, v) => s + v) / rs.length;
  if (Math.sqrt(rs.reduce((s, v) => s + (v - m) ** 2, 0) / rs.length) < 0.09) return shapePaths('circle', x1, y1, x2, y2);
  const e = pts.map(p => Math.min(Math.abs(p.x - x1), Math.abs(p.x - x2), Math.abs(p.y - y1), Math.abs(p.y - y2)));
  return e.reduce((s, v) => s + v) / e.length < diag * 0.05 ? shapePaths('rect', x1, y1, x2, y2) : null;
}


// ---- 3D-фигуры (каркас), которые можно вращать ----
function solidPaths(t, cx, cy, s, rx, ry) {
  const cA = Math.cos(ry), sA = Math.sin(ry), cB = Math.cos(rx), sB = Math.sin(rx);
  const proj = (x, y, z) => { const x1 = x * cA + z * sA, z1 = -x * sA + z * cA; return { x: cx + x1, y: cy + y * cB - z1 * sB }; };
  const ring = (f, n = 48) => Array.from({ length: n + 1 }, (_, i) => f(i / n * 2 * Math.PI));
  if (t === 'sphere') { const r = s / 2;
    return [ring(a => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })), ring(a => proj(r * Math.cos(a), 0, r * Math.sin(a))),
      ring(a => proj(r * Math.cos(a), r * Math.sin(a), 0)), ring(a => proj(0, r * Math.cos(a), r * Math.sin(a)))]; }
  if (t === 'cyl') { const r = s * 0.4, h = s * 0.5, o = [ring(a => proj(r * Math.cos(a), -h, r * Math.sin(a))), ring(a => proj(r * Math.cos(a), h, r * Math.sin(a)))];
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; o.push([proj(r * Math.cos(a), -h, r * Math.sin(a)), proj(r * Math.cos(a), h, r * Math.sin(a))]); } return o; }
  const d = t === 'cube' ? [s / 2, s / 2, s / 2] : [s * 0.8, s * 0.4, s * 0.5], V = [];   // куб или параллелепипед
  for (let i = 0; i < 8; i++) V.push(proj((i & 1 ? 1 : -1) * d[0], (i & 2 ? 1 : -1) * d[1], (i & 4 ? 1 : -1) * d[2]));
  const o = []; for (let i = 0; i < 8; i++) for (const b of [1, 2, 4]) if (!(i & b)) o.push([{ ...V[i] }, { ...V[i | b] }]);   // копии точек, чтобы перемещение и масштаб не складывались
  return o;
}
const SOLIDS = ['cube', 'cuboid', 'cyl', 'sphere'];
function scaleItem(it, ax, ay, sx, sy) {
  const k = (sx + sy) / 2;
  if (it.img) { it.x = ax + (it.x - ax) * k; it.y = ay + (it.y - ay) * k; it.w *= k; it.h *= k; return; }
  if (it.txt) { it.x = ax + (it.x - ax) * k; it.y = ay + (it.y - ay) * k; it.s *= k; return; }
  const u = it.solid ? [k, k] : [sx, sy];
  it.paths.forEach(pl => pl.forEach(p => { p.x = ax + (p.x - ax) * u[0]; p.y = ay + (p.y - ay) * u[1]; }));
  if (it.solid) { it.cx = ax + (it.cx - ax) * k; it.cy = ay + (it.cy - ay) * k; it.s *= k; }
}
function bbox(it) {
  if (it.img) return { x1: it.x, y1: it.y, x2: it.x + it.w, y2: it.y + it.h };
  if (it.txt) return { x1: it.x, y1: it.y, x2: it.x + it.txt.length * it.s * 0.58, y2: it.y + it.s * 1.25 };
  const q = it.paths.flat(); return { x1: Math.min(...q.map(p => p.x)), y1: Math.min(...q.map(p => p.y)), x2: Math.max(...q.map(p => p.x)), y2: Math.max(...q.map(p => p.y)) };
}
function hitItem(it, p, r) {
  if (it.txt || it.img) { const b = bbox(it); return p.x >= b.x1 - r / 2 && p.x <= b.x2 + r / 2 && p.y >= b.y1 - r / 2 && p.y <= b.y2 + r / 2; }
  return it.paths.some(pl => pl.some((q, i) => distSeg(p, q, pl[i + 1] || q) < r + it.w / 2));
}
function moveItem(it, dx, dy) {
  if (it.txt || it.img) { it.x += dx; it.y += dy; return; }
  it.paths.forEach(pl => pl.forEach(p => { p.x += dx; p.y += dy; }));
  if (it.solid) { it.cx += dx; it.cy += dy; }
}
const bdPage = () => B.pages[B.cur];

function bdPaint(ctx, page, extra, sel) {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, BW, BH); ctx.lineWidth = 1;
  const ln = (a, b, c, d) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); };
  if (B.bg === 'grid') {   // тетрадь в клетку с полем
    ctx.strokeStyle = '#c3d3ee';
    for (let x = 0; x <= BW; x += 30) ln(x, 0, x, BH);
    for (let y = 0; y <= BH; y += 30) ln(0, y, BW, y);
    ctx.strokeStyle = '#e88'; ctx.lineWidth = 2; ln(90, 0, 90, BH);
  } else if (B.bg === 'lines') { ctx.strokeStyle = '#c3d3ee'; for (let y = 60; y <= BH; y += 44) ln(0, y, BW, y); }
  const im = page.img;
  if (im && im.complete && im.width) {
    const k = Math.min((BW - 80) / im.width, 1000 / im.height, 1.6), w = im.width * k, h = im.height * k;
    ctx.drawImage(im, (BW - w) / 2, 40, w, h);
  }
  ctx.lineCap = ctx.lineJoin = 'round';
  [...page.items, ...(extra ? [extra] : [])].forEach(it => {
    if (it.img) { if (it.img.complete) ctx.drawImage(it.img, it.x, it.y, it.w, it.h); return; }
    if (it.txt) { ctx.fillStyle = it.c; ctx.font = `${it.s}px "Segoe UI",Arial,sans-serif`; ctx.textBaseline = 'top'; ctx.fillText(it.txt, it.x, it.y); return; }
    ctx.globalAlpha = it.a || 1; ctx.strokeStyle = it.c; ctx.lineWidth = it.w;
    it.paths.forEach(pl => { ctx.beginPath(); pl.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); if (pl.length === 1) ctx.lineTo(pl[0].x + 0.1, pl[0].y); ctx.stroke(); });
    ctx.globalAlpha = 1;
  });
  if (sel) {   // рамка и 4 уголка для изменения размера
    const b = bbox(sel); ctx.strokeStyle = '#1e88e5'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
    ctx.strokeRect(b.x1 - 8, b.y1 - 8, b.x2 - b.x1 + 16, b.y2 - b.y1 + 16); ctx.setLineDash([]); ctx.fillStyle = '#1e88e5';
    corners(b).forEach(c => ctx.fillRect(c.x - 9, c.y - 9, 18, 18));
  }
}
const corners = b => [{ x: b.x1 - 8, y: b.y1 - 8 }, { x: b.x2 + 8, y: b.y1 - 8 }, { x: b.x2 + 8, y: b.y2 + 8 }, { x: b.x1 - 8, y: b.y2 + 8 }];
const drawPage = p => bdPaint(p.ctx, p, null, B.selPage === p ? B.sel : null);
const drawAll = () => B.pages.forEach(drawPage);
function bdZoom(z) {
  if (B.inp) B.inp.blur();
  B.z = Math.max(0.2, Math.min(3, z));
  B.pages.forEach(p => { p.cv.style.width = BW * B.z + 'px'; p.cv.style.height = BH * B.z + 'px'; });
  $('#bz').textContent = Math.round(B.z * 100) + '%';
}
const DOT = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14'><circle cx='7' cy='7' r='3.5' fill='black' stroke='white'/></svg>") 7 7, crosshair`;
const IC = {
  cube: '<path d="M4 8l8-4 8 4v9l-8 4-8-4zM4 8l8 4 8-4M12 12v9"/>', cuboid: '<path d="M3 9l5-4h13v8l-5 4H3zM3 9h13l5-4M16 9v8"/>',
  cyl: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3 3 7 3s7-1.3 7-3V6"/>', sphere: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/>'
};
const svg = k => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">${IC[k]}</svg>`;

function openBoard() {
  if (B) { B.el.style.display = 'flex'; return; }
  const st = document.createElement('style');
  st.textContent = `#board{position:fixed;inset:0;background:#2b2b3a;z-index:50;display:flex;flex-direction:column}
  #board .bb{display:flex;flex-wrap:wrap;gap:5px;padding:6px 8px;background:#1b1b28;color:#fff;align-items:center}
  #board button{padding:5px 9px;font-size:16px;box-shadow:none;min-width:36px}#board button.on{outline:3px solid #ffd23f}
  #board select{width:auto;padding:4px}#board .bc{flex:1;min-height:0;overflow:auto;padding:12px;background:#555}
  #board .pg{width:max-content;margin:0 auto}#board .pw{position:relative;margin-bottom:18px;box-shadow:0 4px 20px #0008}
  #board canvas{display:block;background:#fff;touch-action:none}
  #board .sw{width:26px;height:26px;border-radius:50%;padding:0;border:2px solid #fff;min-width:0}
  #board .btx{position:absolute;border:2px dashed #1e88e5;background:#fff8;outline:none;min-width:120px;font-family:"Segoe UI",Arial,sans-serif;padding:0}`;
  document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'board';
  const tools = [['select', '↖', 'Выбрать, двигать, менять размер'], ['pen', '●', 'Перо'], ['hl', '▬', 'Маркер'], ['erase', '⌫', 'Ластик'], ['text', 'T', 'Текст'], ['line', '╱', 'Линия'], ['arrow', '→', 'Стрелка'], ['rect', '▭', 'Прямоугольник'], ['circle', '◯', 'Круг'], ['tri', '△', 'Треугольник'], ['triR', '◺', 'Прямоугольный треугольник'], ['axes', '✛', 'Оси координат'], ['numl', '↔', 'Числовая прямая'], ['cube', svg('cube'), 'Куб'], ['cuboid', svg('cuboid'), 'Параллелепипед'], ['cyl', svg('cyl'), 'Цилиндр'], ['sphere', svg('sphere'), 'Шар'], ['rot', '⟳', 'Вращать 3D-фигуру']];
  el.innerHTML = `
  <div class="bb">${tools.map(([k, v, t]) => `<button class="sec" title="${t}" data-tool="${k}" onclick="bd('tool','${k}')">${v}</button>`).join('')}
    <label class="btn sec" title="Добавить фото с устройства" style="cursor:pointer;padding:5px 9px;margin:0">🖼<input type="file" accept="image/*" multiple hidden onchange="bdPhoto(Array.from(this.files));this.value=''"></label></div>
  <div class="bb">${['#111111', '#d32f2f', '#1565c0', '#2e7d32', '#ef6c00', '#7b1fa2'].map(c => `<button class="sw" style="background:${c}" onclick="bd('color','${c}')"></button>`).join('')}
    <span style="margin-left:8px">Толщина: <b id="bwv">4</b></span><input type="range" min="1" max="40" value="4" style="width:130px;padding:0" oninput="bd('w',+this.value)">
    <select onchange="B.fs=+this.value"><option value="30">Текст: мелкий</option><option value="44" selected>Текст: средний</option><option value="64">Текст: крупный</option></select>
    <label style="margin:0;color:#fff;font-weight:400"><input type="checkbox" checked style="width:auto;margin:0" onchange="B.snap=this.checked"> Исправлять фигуры</label>
    <select onchange="B.bg=this.value;drawAll()"><option value="grid">Клетка</option><option value="lines">Линейка</option><option value="blank">Чистый лист</option></select>
    <button class="sec" onclick="bd('undo')">↶</button><button class="sec" onclick="bd('redo')">↷</button>
    <button class="sec" onclick="bd('delsel')">Удалить выбранное</button><button class="sec" onclick="bd('clear')">🗑 Очистить</button></div>
  <div class="bb"><select id="bquiz">${db.quizzes.map(q => `<option value="${q.id}">${esc(q.title)}</option>`).join('')}</select>
    <button class="green" onclick="bd('load')">📥 Задания теста</button><span id="btabs"></span>
    <button class="sec" onclick="bd('add')">+ Страница</button><button class="sec" onclick="bd('del')">− Страница</button>
    <button class="sec" onclick="bdZoom(B.z/1.15)">🔍−</button><b id="bz" style="min-width:44px;text-align:center">100%</b><button class="sec" onclick="bdZoom(B.z*1.15)">🔍+</button>
    <button class="sec" onclick="bd('fit')">Вписать</button>
    <button class="green" onclick="bd('pdf')">⬇ PDF</button><button class="sec" onclick="bd('full')">⛶</button><button class="danger" onclick="bd('close')">✕ Закрыть</button></div>
  <div class="bc"><div class="pg"></div></div>`;
  document.body.appendChild(el);
  const bc = el.querySelector('.bc');
  B = { el, bc, pg: el.querySelector('.pg'), pages: [], cur: 0, tool: 'pen', color: '#111111', w: 4, fs: 44, z: 1, bg: 'grid', snap: true, drag: null, sel: null, selPage: null, inp: null, penSeen: false, touch: new Map() };
  B.kh = e => { if (!B || B.inp) return; if (e.ctrlKey && e.key === 'z') bd('undo'); if (e.key === 'Delete') bd('delsel'); };
  document.addEventListener('keydown', B.kh);
  bc.onwheel = e => { if (e.ctrlKey) { e.preventDefault(); bdZoom(B.z * (e.deltaY < 0 ? 1.1 : 0.9)); } };
  bc.onscroll = () => {   // какая страница сейчас на экране (прокрутка вниз = следующая страница)
    const y = bc.scrollTop + bc.clientHeight / 3, i = B.pages.findIndex(p => p.wrap.offsetTop + p.wrap.offsetHeight > y);
    if (i >= 0 && i !== B.cur) { B.cur = i; bdTabs(); }
  };
  mkPage(null); bdTabs(); bd('tool', 'pen'); bdZoom((bc.clientWidth - 40) / BW);
}
function mkPage(img) {
  const wrap = document.createElement('div'); wrap.className = 'pw';
  const cv = document.createElement('canvas'); cv.width = BW; cv.height = BH; wrap.appendChild(cv); B.pg.appendChild(wrap);
  const page = { items: [], redo: [], img, cv, wrap, ctx: cv.getContext('2d') };
  B.pages.push(page); cv.style.cursor = B.cursor || DOT; cv.style.width = BW * B.z + 'px'; cv.style.height = BH * B.z + 'px';
  const pt = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * BW / r.width, y: (e.clientY - r.top) * BH / r.height }; };
  const R = extra => bdPaint(page.ctx, page, extra, B.selPage === page ? B.sel : null);
  const erase = p => { const n = page.items.length; page.items = page.items.filter(it => !hitItem(it, p, 18)); if (page.items.length !== n) { B.sel = null; R(); } };
  const mk = (d, paths) => ({ c: B.color, w: d.hl ? B.w * 5 : B.w, a: d.hl ? 0.35 : 1, paths });
  const mkSolid = d => { const dx = d.b.x - d.a.x, dy = d.b.y - d.a.y, s = Math.max(60, Math.abs(dx), Math.abs(dy)) * (Math.hypot(dx, dy) < 6 ? 0 : 1) || 200, cx = d.a.x + dx / 2, cy = d.a.y + dy / 2;
    return { c: B.color, w: B.w, solid: d.t, cx, cy, s, rx: -0.5, ry: 0.6, paths: solidPaths(d.t, cx, cy, s, -0.5, 0.6) }; };
  cv.oncontextmenu = e => e.preventDefault();
  cv.onpointerdown = e => {
    cv.setPointerCapture(e.pointerId); B.cur = B.pages.indexOf(page); bdTabs();
    if (e.pointerType === 'pen') B.penSeen = true;
    if (e.pointerType === 'touch') {
      B.touch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (B.touch.size === 2) { const [a, b] = [...B.touch.values()]; B.drag = { pinch: true, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: B.z }; R(); return; }   // два пальца = масштаб
      if (B.penSeen) { B.drag = { pan: true, sx: e.clientX, sy: e.clientY, l: B.bc.scrollLeft, t: B.bc.scrollTop }; return; }
    }
    const p = pt(e);
    const tool = (e.pointerType === 'pen' && ((e.buttons & 32) || (e.buttons & 2) || e.button === 5)) ? 'erase' : B.tool;   // кнопка стилуса стирает
    if (tool === 'erase') { B.drag = { erase: true }; return erase(p); }
    if (tool === 'select') {
      if (B.sel && B.selPage === page) { const b = bbox(B.sel), cs = corners(b), i = cs.findIndex(c => Math.hypot(c.x - p.x, c.y - p.y) < 24);
        if (i >= 0) { const o = cs[(i + 2) % 4]; B.drag = { scale: true, ax: o.x + (i < 2 ? 8 : -8) * (i === 0 || i === 3 ? 1 : 1), ay: o.y + (i === 0 || i === 1 ? 8 : -8), last: p }; return; } }
      const prev = B.selPage; B.sel = [...page.items].reverse().find(it => hitItem(it, p, 14)) || null; B.selPage = B.sel ? page : null;
      B.drag = B.sel ? { move: true, last: p } : null; if (prev && prev !== page) drawPage(prev); return R();
    }
    if (tool === 'rot') { const it = [...page.items].reverse().find(i => i.solid && hitItem(i, p, 10)); B.drag = it ? { rot: it, last: p } : null; return; }
    if (tool === 'text') { B.drag = null; return bdText(page, p.x, p.y); }
    B.drag = (tool === 'pen' || tool === 'hl') ? { pts: [p], hl: tool === 'hl' } : { t: tool, a: p, b: p };
  };
  cv.onpointermove = e => {
    if (B.touch.has(e.pointerId)) B.touch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = B.drag; if (!d) return;
    if (d.pinch) { if (B.touch.size >= 2) { const [a, b] = [...B.touch.values()]; bdZoom(d.z0 * Math.hypot(a.x - b.x, a.y - b.y) / d.d0); } return; }
    if (d.pan) { B.bc.scrollLeft = d.l - (e.clientX - d.sx); B.bc.scrollTop = d.t - (e.clientY - d.sy); return; }
    const p = pt(e);
    if (d.erase) return erase(p);
    if (d.move) { moveItem(B.sel, p.x - d.last.x, p.y - d.last.y); d.last = p; return R(); }
    if (d.scale) { const sx = Math.max(0.1, (p.x - d.ax) / ((d.last.x - d.ax) || 1)), sy = Math.max(0.1, (p.y - d.ay) / ((d.last.y - d.ay) || 1));
      if (sx > 0 && sy > 0 && isFinite(sx) && isFinite(sy)) scaleItem(B.sel, d.ax, d.ay, Math.min(sx, 5), Math.min(sy, 5)); d.last = p; return R(); }
    if (d.rot) { const it = d.rot; it.ry += (p.x - d.last.x) * 0.012; it.rx += (p.y - d.last.y) * 0.012; d.last = p; it.paths = solidPaths(it.solid, it.cx, it.cy, it.s, it.rx, it.ry); return R(); }
    if (d.pts) { d.pts.push(p); R(mk(d, [d.pts])); }
    else { d.b = p; R(SOLIDS.includes(d.t) ? mkSolid(d) : mk(d, shapePaths(d.t, d.a.x, d.a.y, d.b.x, d.b.y))); }
  };
  cv.onpointerup = cv.onpointercancel = e => {
    B.touch.delete(e.pointerId);
    const d = B.drag; if (d && d.pinch) { if (B.touch.size < 2) B.drag = null; return; }
    B.drag = null; if (!d || d.erase || d.pan || d.move || d.scale || d.rot) return;
    if (d.t && SOLIDS.includes(d.t)) page.items.push(mkSolid(d));
    else {
      let paths = d.pts ? [d.pts] : (Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) > 5 ? shapePaths(d.t, d.a.x, d.a.y, d.b.x, d.b.y) : null);
      if (d.pts && B.snap && !d.hl) paths = snapStroke(d.pts) || paths;
      if (paths) page.items.push(mk(d, paths));
    }
    page.redo = []; R();
  };
  drawPage(page); return page;
}
function bdText(page, x, y) {
  if (B.inp) B.inp.blur();
  const inp = document.createElement('input'); inp.className = 'btx';
  inp.style.cssText = `left:${x * B.z}px;top:${y * B.z}px;font-size:${B.fs * B.z}px;color:${B.color}`;
  page.wrap.appendChild(inp); B.inp = inp; inp.focus();
  const done = () => { if (B.inp !== inp) return; B.inp = null; const v = inp.value.trim(); inp.remove(); if (v) { page.items.push({ c: B.color, txt: v, x, y, s: B.fs }); page.redo = []; } drawPage(page); };
  inp.onblur = done; inp.onkeydown = e => { if (e.key === 'Enter') done(); if (e.key === 'Escape') { inp.value = ''; done(); } };
}
function bdPhoto(files) {   // фото с устройства: двигается и растягивается как фигура
  const page = bdPage();
  files.forEach((f, n) => { const fr = new FileReader(); fr.onload = () => { const im = new Image(); im.onload = () => {
    const k = Math.min(600 / im.width, 600 / im.height, 1), it = { img: im, x: 120 + n * 40, y: 120 + n * 40, w: im.width * k, h: im.height * k };
    page.items.push(it); B.sel = it; B.selPage = page; bd('tool', 'select'); drawPage(page); }; im.src = fr.result; }; fr.readAsDataURL(f); });
}
function bdTabs() {
  $('#btabs').innerHTML = B.pages.map((p, i) => `<button class="sec ${i === B.cur ? 'on' : ''}" onclick="B.pages[${i}].wrap.scrollIntoView({behavior:'smooth',block:'start'})">${i + 1}</button>`).join(' ');
}
async function bd(a, v) {
  const pg = bdPage();
  if (a === 'tool') { B.tool = v; B.el.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === v)); B.cursor = v === 'select' ? 'default' : v === 'rot' ? 'grab' : v === 'erase' || v === 'text' ? 'crosshair' : DOT; B.pages.forEach(p => p.cv.style.cursor = B.cursor); }
  if (a === 'color') { B.color = v; if (B.sel && !B.sel.img) { B.sel.c = v; drawPage(B.selPage); } }
  if (a === 'w') { B.w = v; $('#bwv').textContent = v; if (B.sel && B.sel.paths) { B.sel.w = v; drawPage(B.selPage); } }
  if (a === 'undo') { const it = pg.items.pop(); if (it) pg.redo.push(it); B.sel = null; drawPage(pg); }
  if (a === 'redo') { const it = pg.redo.pop(); if (it) pg.items.push(it); drawPage(pg); }
  if (a === 'delsel') { if (B.sel && B.selPage) { const p = B.selPage; p.items = p.items.filter(i => i !== B.sel); B.sel = null; drawPage(p); } }
  if (a === 'clear') { if (confirm('Очистить эту страницу?')) { pg.items = []; pg.redo = []; B.sel = null; drawPage(pg); } }
  if (a === 'add') { const p = mkPage(null); bdTabs(); p.wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  if (a === 'del') { if (B.pages.length > 1 && confirm('Удалить эту страницу?')) { pg.wrap.remove(); B.pages.splice(B.cur, 1); B.cur = Math.max(0, B.cur - 1); B.sel = null; bdTabs(); } }
  if (a === 'fit') bdZoom((B.bc.clientWidth - 40) / BW);
  if (a === 'full') { B.el.requestFullscreen ? B.el.requestFullscreen() : alert('Полноэкранный режим не поддерживается'); }
  if (a === 'close') { if (confirm('Доска не сохраняется. Закрыть и стереть всё? (Сначала можно скачать PDF.)')) { document.removeEventListener('keydown', B.kh); document.fullscreenElement && document.exitFullscreen(); B.el.remove(); B = null; } }
  if (a === 'load') {
    const id = $('#bquiz').value; if (!id) return alert('Сначала создайте тест');
    if (B.pages.some(p => p.items.length) && !confirm('Текущие записи на доске будут стёрты. Продолжить?')) return;
    try {
      const qs = await loadQuestions(id);
      B.pages.forEach(p => p.wrap.remove()); B.pages = []; B.sel = null; B.cur = 0;
      (qs.length ? qs : [{}]).forEach(q => { let im = null; if (q.img) { im = new Image(); im.src = q.img; } const p = mkPage(im); if (im) im.onload = () => drawPage(p); });
      bdTabs(); B.bc.scrollTop = 0;
    } catch (e) { alert(friendly(e)); }
  }
  if (a === 'pdf') {
    if (!window.jspdf) return alert('Не загрузилась библиотека PDF. Проверьте интернет и обновите страницу.');
    const pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    const c = document.createElement('canvas'); c.width = BW; c.height = BH; const x = c.getContext('2d');
    B.pages.forEach((p, i) => { bdPaint(x, p); if (i) pdf.addPage(); pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pw, ph); });
    pdf.save('Доска.pdf');
  }
}