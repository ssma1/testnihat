/* ===================== ОБЩЕЕ ===================== */
const LET = ['A', 'B', 'C', 'D', 'E'];
const EMAIL_DOMAIN = '@mathquiz.app';          // логин ученика превращается в логин@mathquiz.app (настоящая почта не нужна)
const TEACHER_EMAIL = 'teacher' + EMAIL_DOMAIN; // учитель входит с логином teacher
const $ = s => document.querySelector(s);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let db = { students: [], quizzes: [], results: [] };   // копия данных из облака (обновляется автоматически)
let session = null, authReady = false, loginError = '';
let tab = 'quizzes', draft = null, resultsQuiz = '', resultsClass = '', game = null;
let busy = false, studentView = 'list', autoBusy = false;
let auth, fs, unsubs = [];

function friendly(e) {
  const c = (e && (e.code || '')) + '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(c)) return 'Неверный логин или пароль';
  if (c.includes('too-many-requests')) return 'Слишком много попыток. Подождите несколько минут.';
  if (c.includes('network')) return 'Нет связи с интернетом.';
  if (c.includes('permission-denied')) return 'Нет доступа к данным. Проверьте, что правила Firestore опубликованы (см. инструкцию).';
  if (c.includes('email-already-in-use')) return 'Такой логин уже занят (или раньше использовался). Придумайте другой.';
  if (c.includes('weak-password')) return 'Пароль слишком короткий: нужно минимум 6 символов.';
  if (c.includes('requires-recent-login')) return 'Выйдите из аккаунта, войдите заново и повторите.';
  return (e && e.message) || 'Неизвестная ошибка';
}
function fmtMin(m) {
  const h = Math.floor(m / 60), mm = m % 60;
  return ((h ? h + ' ч ' : '') + (mm ? mm + ' мин' : '')).trim() || '0 мин';
}
function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(s).padStart(2, '0');
}
function timeInfo(q) { return q.mode === 'total' ? 'общее время: ' + fmtMin(q.totalMin) : 'таймер на каждый вопрос'; }

/* ===================== FIREBASE ===================== */
function showFatal(msg) {
  $('#app').innerHTML = `<div class="card"><h2>Нужна настройка</h2><p>${msg}</p></div>`;
}
function boot() {
  if (typeof firebase === 'undefined')
    return showFatal('Не загрузилась библиотека Firebase. Проверьте интернет и обновите страницу.');
  if (typeof firebaseConfig === 'undefined' || JSON.stringify(firebaseConfig).includes('ВСТАВЬТЕ'))
    return showFatal('Файл <b>firebase-config.js</b> ещё не заполнен. Вставьте в него настройки вашего проекта Firebase (см. инструкцию).');
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth(); fs = firebase.firestore();
  auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(() => {});   // вход сбрасывается при закрытии вкладки
  auth.onAuthStateChanged(onAuth);
}

async function onAuth(user) {
  stopListeners();
  if (!user) { session = null; authReady = true; render(); return; }
  try {
    if ((user.email || '').toLowerCase() === TEACHER_EMAIL) {
      session = { role: 'teacher', id: user.uid, name: 'Учитель' };
    } else {
      const d = await fs.collection('users').doc(user.uid).get();
      if (!d.exists) { loginError = 'Этот аккаунт удалён учителем.'; await auth.signOut(); return; }
      session = { role: 'student', id: user.uid, name: d.data().name, classes: d.data().classes || [] };
    }
    authReady = true; studentView = 'list'; tab = 'quizzes';
    startListeners(); render();
  } catch (e) { loginError = friendly(e); await auth.signOut(); }
}

function stopListeners() { unsubs.forEach(u => u()); unsubs = []; }
function startListeners() {
  const onErr = e => { $('#app').innerHTML = `<div class="card"><h2>Ошибка доступа</h2><p>${esc(friendly(e))}</p></div>`; };
  unsubs.push(fs.collection('quizzes').onSnapshot(snap => {
    db.quizzes = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    refresh();
  }, onErr));
  unsubs.push(fs.collection('results').onSnapshot(snap => {
    db.results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    refresh();
  }, onErr));
  if (session.role === 'teacher') {
    unsubs.push(fs.collection('users').onSnapshot(snap => {
      db.students = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      refresh();
    }, onErr));
  }
}
// Обновляем экран при изменении данных, но не мешаем, если человек что-то вводит, играет или редактирует тест
function refresh() {
  if (!session || draft || game) return;
  const a = document.activeElement;
  if (a && ['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName)) return;
  render();
}

/* ===================== ВХОД ===================== */
function render() {
  const ub = $('#userbox');
  if (!authReady) { ub.innerHTML = ''; $('#app').innerHTML = '<div class="card"><p class="muted">Загрузка…</p></div>'; return; }
  if (!session) { ub.innerHTML = ''; const e = loginError; loginError = ''; return renderLogin(e); }
  ub.innerHTML = `${session.role === 'teacher' ? '<button class="small green" onclick="openBoard()">🖍 Доска</button>' : ''}<span>👤 ${esc(session.name)}</span><button class="sec small" onclick="logout()">Выйти</button>`;
  session.role === 'teacher' ? renderTeacher() : renderStudent();
}

function renderLogin(err = '') {
  $('#app').innerHTML = `
  <div class="card login">
    <h1>Вход</h1>
    <label>Логин<input id="lg" autocomplete="username" autocapitalize="none"></label>
    <label>Пароль<input id="pw" type="password" autocomplete="current-password"></label>
    <div class="err">${esc(err)}</div>
    <button id="loginBtn" onclick="doLogin()" style="width:100%">Войти</button>
  </div>`;
  $('#pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#lg').focus();
}

async function doLogin() {
  const l = $('#lg').value.trim().toLowerCase(), p = $('#pw').value;
  if (!l || !p) return renderLogin('Введите логин и пароль');
  $('#loginBtn').disabled = true; $('#loginBtn').textContent = 'Входим…';
  try { await auth.signInWithEmailAndPassword(l + EMAIL_DOMAIN, p); }
  catch (e) { renderLogin(friendly(e)); }
}
function logout() {
  if (game) clearInterval(game.timer);
  game = null; draft = null; studentView = 'list';
  auth.signOut();
}

/* ===================== УЧИТЕЛЬ ===================== */
function renderTeacher() {
  if (draft) return renderEditor();
  const tabs = [['quizzes', 'Тесты'], ['students', 'Ученики'], ['results', 'Результаты'], ['settings', 'Настройки']];
  let html = `<div class="tabs">${tabs.map(([k, v]) =>
    `<button class="${tab === k ? 'on' : ''}" onclick="tab='${k}';render()">${v}</button>`).join('')}</div>`;
  if (tab === 'quizzes') html += tabQuizzes();
  if (tab === 'students') html += tabStudents();
  if (tab === 'results') html += tabResults();
  if (tab === 'settings') html += tabSettings();
  $('#app').innerHTML = html;
}

/* ---- Тесты ---- */
function tabQuizzes() {
  return `<div class="card"><div class="row"><h2 class="grow">Мои тесты</h2>
    <button class="green" onclick="newQuiz()">+ Новый тест</button></div>
    ${db.quizzes.length ? '' : '<p class="muted">Пока нет тестов. Нажмите «Новый тест» и выберите фото заданий.</p>'}
    ${db.quizzes.map(q => `
      <div class="quizitem" style="padding:12px 0;border-top:1px solid #eee">
        <div><b>${esc(q.title)}</b> <span class="badge ${q.active ? 'on' : 'off'}">${q.active ? 'открыт' : 'закрыт'}</span> <span class="muted">· ${timeInfo(q)} · классы: ${esc((q.classes || []).join(", ") || "не выбраны")}</span>
        <div class="muted">Вопросов: ${q.count || 0}</div></div>
        <div class="row">
          <button class="small ${q.active ? 'sec' : 'green'}" onclick="toggleQuiz('${q.id}')">${q.active ? 'Закрыть' : 'Открыть ученикам'}</button>
          <button class="small sec" onclick="editQuiz('${q.id}')">Изменить</button>
          <button class="small sec" onclick="resultsQuiz='${q.id}';tab='results';render()">Результаты</button>
          <button class="small danger" onclick="delQuiz('${q.id}')">Удалить</button>
        </div>
      </div>`).join('')}
  </div>`;
}
function toggleQuiz(id) {
  const q = db.quizzes.find(x => x.id === id);
  fs.collection('quizzes').doc(id).update({ active: !q.active }).catch(e => alert(friendly(e)));
}
async function delQuiz(id) {
  if (!confirm('Удалить тест и все его результаты?')) return;
  try {
    const qs = await fs.collection('quizzes').doc(id).collection('questions').get();
    const rs = await fs.collection('results').where('quizId', '==', id).get();
    await Promise.all([...qs.docs, ...rs.docs].map(d => d.ref.delete()));
    await fs.collection('quizzes').doc(id).delete();
  } catch (e) { alert(friendly(e)); }
}
function newQuiz() {
  draft = { id: newId(), title: '', active: false, mode: 'question', totalMin: 60, defTime: 60, classes: [], questions: [], oldIds: [] };
  render();
}
async function loadQuestions(qid) {
  const snap = await fs.collection('quizzes').doc(qid).collection('questions').orderBy('order').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function editQuiz(id) {
  if (busy) return; busy = true;
  try {
    const meta = db.quizzes.find(x => x.id === id);
    const questions = await loadQuestions(id);
    draft = { id, title: meta.title, active: !!meta.active, mode: meta.mode || 'question', totalMin: meta.totalMin || 60, classes: meta.classes || [],
      createdAt: meta.createdAt, defTime: questions[0]?.time || 60, questions, oldIds: questions.map(q => q.id) };
    render();
  } catch (e) { alert(friendly(e)); } finally { busy = false; }
}

/* ---- Редактор теста ---- */
function renderEditor() {
  $('#app').innerHTML = `
  <div class="card">
    <h2>${db.quizzes.some(q => q.id === draft.id) ? 'Редактирование теста' : 'Новый тест'}</h2>
    <label>Название теста
      <input value="${esc(draft.title)}" oninput="draft.title=this.value" placeholder="Например: Дроби, 5 класс"></label>
    <label>Как считать время
      <select onchange="draft.mode=this.value;renderEditor()">
        <option value="question" ${draft.mode === 'question' ? 'selected' : ''}>Таймер на каждый вопрос (как в Kahoot)</option>
        <option value="total" ${draft.mode === 'total' ? 'selected' : ''}>Общее время на весь тест</option>
      </select></label>
    <div style="margin-bottom:12px"><b>Какие классы получат этот тест</b><div class="row" style="margin-top:6px">${allClasses().length ? allClasses().map(c => `<label style="margin:0;font-weight:400"><input type="checkbox" style="width:auto" ${draft.classes.includes(c) ? 'checked' : ''} onchange="toggleClass('${esc(c)}')"> ${esc(c)}</label>`).join('') : '<span class="muted">Сначала добавьте ученикам классы во вкладке «Ученики».</span>'}</div></div>
    ${draft.mode === 'total' ? `
      <label>Общее время на весь тест (минут)
        <input type="number" min="1" max="600" value="${draft.totalMin}" oninput="draft.totalMin=Math.max(1,+this.value||60);document.getElementById('tt').textContent=fmtMin(draft.totalMin)"></label>
      <p class="muted">Это: <b id="tt">${fmtMin(draft.totalMin)}</b> (60 = 1 час, 90 = 1,5 часа). Вопросы идут по порядку, назад вернуться нельзя, после ответа сразу видно «верно/неверно». Баллы: от 100% до 75% по скорости (время на вопрос = общее время ÷ число заданий).</p>
      <div class="row" style="margin-bottom:12px">${[30, 45, 60, 90, 120].map(m => `<button class="small sec" onclick="draft.totalMin=${m};renderEditor()">${fmtMin(m)}</button>`).join('')}</div>`
    : `<label>Время на каждый вопрос (секунд) для новых фото
        <input type="number" min="5" max="600" value="${draft.defTime}" oninput="draft.defTime=Math.max(5,+this.value||60)"></label>`}
    <label class="btn" style="cursor:pointer;width:max-content">📷 Выбрать фото заданий (можно сразу много)
      <input type="file" accept="image/*" multiple hidden onchange="addImages(Array.from(this.files));this.value=''"></label>
    <p class="muted">Для каждого фото автоматически создаётся 5 вариантов A B C D E. Если нужно — впишите свой текст рядом с буквой. Зелёной точкой отметьте правильный ответ.</p>
  </div>
  ${draft.questions.map((q, i) => `
    <div class="qcard">
      <div><b>Вопрос ${i + 1}</b><img src="${q.img}" alt=""></div>
      <div>
        <div class="opts">${q.options.map((t, k) => `
          <div class="opt">
            <input type="radio" name="c${q.id}" ${q.correct === k ? 'checked' : ''} onchange="draft.questions[${i}].correct=${k}" title="Правильный ответ">
            <span class="let L${k}">${LET[k]}</span>
            <input type="text" value="${esc(t)}" placeholder="${LET[k]} (текст можно не писать)" oninput="draft.questions[${i}].options[${k}]=this.value">
          </div>`).join('')}</div>
        <div class="qmeta">
          ${draft.mode === 'question' ? `<label>Время (сек)<input type="number" min="5" max="600" value="${q.time}" oninput="draft.questions[${i}].time=Math.max(5,+this.value||60)"></label>` : ''}
          <label>Баллы<input type="number" min="1" value="${q.points}" oninput="draft.questions[${i}].points=Math.max(1,+this.value||1000)"></label>
          <button class="small sec" onclick="moveQ(${i},-1)">↑</button>
          <button class="small sec" onclick="moveQ(${i},1)">↓</button>
          <button class="small danger" onclick="draft.questions.splice(${i},1);renderEditor()">Удалить</button>
        </div>
      </div>
    </div>`).join('')}
  <div class="row">
    <button class="green" id="saveBtn" onclick="saveQuiz()">💾 Сохранить тест</button>
    <button class="sec" onclick="if(confirm('Выйти без сохранения?')){draft=null;render()}">Отмена</button>
  </div>`;
}
function moveQ(i, d) {
  const j = i + d; if (j < 0 || j >= draft.questions.length) return;
  [draft.questions[i], draft.questions[j]] = [draft.questions[j], draft.questions[i]]; renderEditor();
}
async function addImages(files) {
  for (const f of files) {
    const img = await compressImage(f);
    draft.questions.push({ id: newId(), img, options: ['', '', '', '', ''], correct: 0, time: draft.defTime, points: 1000 });
  }
  renderEditor();
}
function compressImage(file) {   // уменьшаем фото, чтобы тест загружался быстро
  return new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => {
      const im = new Image();
      im.onload = () => {
        const max = 900, k = Math.min(1, max / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.72));
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
async function saveQuiz() {
  if (busy) return;
  if (!draft.title.trim()) return alert('Введите название теста');
  if (!draft.questions.length) return alert('Добавьте хотя бы одно фото задания');
  busy = true; const btn = $('#saveBtn'); btn.disabled = true; btn.textContent = 'Сохраняем…';
  try {
    const quizRef = fs.collection('quizzes').doc(draft.id), qref = quizRef.collection('questions');
    const batch = fs.batch();
    batch.set(quizRef, { title: draft.title.trim(), active: draft.active, mode: draft.mode, totalMin: draft.totalMin,
      count: draft.questions.length, classes: draft.classes || [], createdAt: draft.createdAt || Date.now() });
    const keep = new Set();
    draft.questions.forEach((q, i) => {
      keep.add(q.id);
      batch.set(qref.doc(q.id), { order: i, img: q.img, options: q.options, correct: q.correct, time: q.time, points: q.points });
    });
    (draft.oldIds || []).forEach(id => { if (!keep.has(id)) batch.delete(qref.doc(id)); });
    await batch.commit();
    draft = null; tab = 'quizzes'; render();
  } catch (e) { alert('Не удалось сохранить: ' + friendly(e)); btn.disabled = false; btn.textContent = '💾 Сохранить тест'; }
  finally { busy = false; }
}

/* ---- Ученики ---- */
function tabStudents() {
  return `<div class="card"><h2>Добавить ученика</h2>
    <div class="row">
      <input id="sn" placeholder="Имя и фамилия" class="grow">
      <input id="sl" placeholder="Логин (латиницей)" style="width:180px" autocapitalize="none">
      <input id="sp" placeholder="Пароль (мин. 6)" style="width:160px">
      <input id="sc" placeholder="Классы: 5А, 7Б" style="width:160px">
      <button class="green" id="addBtn" onclick="addStudent()">Добавить</button>
    </div><div class="err" id="serr"></div>
    <p class="muted">Логин — только латинские буквы, цифры, точка, дефис или подчёркивание (например: aziz.2025). Пароль — минимум 6 символов.</p></div>
  <div class="card"><h2>Ученики (${db.students.length})</h2>
    ${db.students.length ? `<table><tr><th>Имя</th><th>Логин</th><th>Пароль</th><th>Классы</th><th></th></tr>
    ${db.students.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.login)}</td><td>${esc(s.pass)}</td><td>${esc((s.classes || []).join(', '))} <button class="small sec" onclick="editClasses('${s.id}')">✎</button></td>
      <td><button class="small danger" onclick="delStudent('${s.id}')">Удалить</button></td></tr>`).join('')}</table>`
      : '<p class="muted">Учеников пока нет.</p>'}</div>`;
}
const parseClasses = v => [...new Set(String(v || '').split(',').map(x => x.replace(/['"\\<>&`]/g, '').trim()).filter(Boolean))];
const allClasses = () => [...new Set([...db.students.flatMap(s => s.classes || []), ...db.quizzes.flatMap(q => q.classes || [])])].sort();
function toggleClass(c) { const a = draft.classes, i = a.indexOf(c); i >= 0 ? a.splice(i, 1) : a.push(c); }
function editClasses(id) {
  const st = db.students.find(x => x.id === id);
  const v = prompt('Классы через запятую (например: 5А, 7Б)', (st.classes || []).join(', '));
  if (v !== null) fs.collection('users').doc(id).update({ classes: parseClasses(v) }).catch(e => alert(friendly(e)));
}
async function createAuthUser(email, pass) {
  // Создаём аккаунт через «второе» подключение, чтобы учитель не вышел из своего аккаунта
  const app2 = firebase.initializeApp(firebaseConfig, 'sec' + Date.now());
  try {
    const cred = await app2.auth().createUserWithEmailAndPassword(email, pass);
    await app2.auth().signOut();
    return cred.user.uid;
  } finally { app2.delete().catch(() => {}); }
}
async function addStudent() {
  const name = $('#sn').value.trim(), login = $('#sl').value.trim().toLowerCase(), pass = $('#sp').value.trim();
  const err = m => { $('#serr').textContent = m; };
  if (!name || !login || !pass) return err('Заполните все поля');
  if (!/^[a-z0-9._-]{2,30}$/.test(login)) return err('Логин: только латинские буквы, цифры, точка, дефис, подчёркивание (от 2 символов)');
  if (pass.length < 6) return err('Пароль должен быть не короче 6 символов');
  if (login === 'teacher' || db.students.some(s => s.login === login)) return err('Такой логин уже занят');
  if (busy) return; busy = true; $('#addBtn').disabled = true; err('Создаём…');
  try {
    const id = await createAuthUser(login + EMAIL_DOMAIN, pass);
    await fs.collection('users').doc(id).set({ name, login, pass, classes: parseClasses($('#sc').value), role: 'student', createdAt: Date.now() });
    busy = false; render();
  } catch (e) { err(friendly(e)); $('#addBtn').disabled = false; busy = false; }
}
async function delStudent(id) {
  if (!confirm('Удалить ученика и его результаты? Этот логин потом использовать повторно нельзя.')) return;
  try {
    const rs = await fs.collection('results').where('uid', '==', id).get();
    await Promise.all(rs.docs.map(d => d.ref.delete()));
    await fs.collection('users').doc(id).delete();
  } catch (e) { alert(friendly(e)); }
}

/* ---- Результаты ---- */
function leaderboard(quizId, onlyFinished, ok) {
  const list = db.results.filter(r => r.quizId === quizId && (!onlyFinished || r.finished) && (!ok || ok(r)))
    .sort((a, b) => b.score - a.score || a.time - b.time);
  list.forEach(r => { r.place = 1 + list.filter(o => o.score > r.score).length; });
  return list;
}
function tabResults() {
  if (!db.quizzes.length) return '<div class="card"><p class="muted">Тестов пока нет.</p></div>';
  if (!db.quizzes.some(q => q.id === resultsQuiz)) resultsQuiz = db.quizzes[0].id;
  const q = db.quizzes.find(x => x.id === resultsQuiz);
  const inCls = r => !resultsClass || ((db.students.find(s => s.id === r.uid) || {}).classes || []).includes(resultsClass);
  const lb = leaderboard(q.id, false, inCls);
  const done = new Set(lb.map(r => r.uid));
  const notYet = db.students.filter(s => !done.has(s.id) && (!resultsClass || (s.classes || []).includes(resultsClass)));
  return `<div class="card">
    <div class="row"><h2 class="grow">Рейтинг</h2>
      <select onchange="resultsQuiz=this.value;render()" style="width:auto">
        ${db.quizzes.map(x => `<option value="${x.id}" ${x.id === resultsQuiz ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}
      </select>
      <select onchange="resultsClass=this.value;render()" style="width:auto"><option value="">Все классы</option>${allClasses().map(c => `<option ${c === resultsClass ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <button class="sec small" onclick="finalizeQuiz('${q.id}')">✅ ${q.finalPlaces ? 'Обновить итоги' : 'Подвести итоги'}</button>
      <button class="green small" onclick="certs('${q.id}')">🏆 Грамоты (топ-3)</button>
      <button class="sec small" onclick="exportCSV('${q.id}')">⬇ Скачать CSV</button>
    </div>
    ${lb.length ? `<table><tr><th>Место</th><th>Ученик</th><th>Баллы</th><th>Правильно</th><th>Ошибки (№)</th><th>Статус</th><th></th></tr>
    ${lb.map(r => `<tr><td><b>${r.place}</b></td><td>${esc(r.name)}</td><td><b>${r.score}</b></td>
      <td>${r.correct} из ${r.total}</td><td>${wrongList(r).map(i => i + 1).join(', ') || '—'}</td><td>${r.finished ? 'завершил' : 'идёт: ' + (r.answered || 0) + ' из ' + r.total}</td>
      <td>${r.finished && r.place <= 3 ? `<button class="small green" onclick="certs('${r.quizId}','${r.uid}')">🏆 Грамота</button> ` : ''}<button class="small sec" onclick="resetResult('${r.quizId}','${r.uid}')" title="Разрешить пройти заново">Сбросить</button></td></tr>`).join('')}</table>`
      : '<p class="muted">Пока никто не прошёл этот тест.</p>'}
    ${qStats(lb)}
    ${notYet.length ? `<p class="muted">Ещё не проходили: ${notYet.map(s => esc(s.name)).join(', ')}</p>` : ''}
  </div>`;
}
function finalizeQuiz(qid) {
  if (!confirm('Подвести итоги? Места зафиксируются, а призёры смогут скачать грамоты.')) return;
  const fp = {}; leaderboard(qid, true).forEach(r => { fp[r.uid] = r.place; });
  fs.collection('quizzes').doc(qid).update({ finalPlaces: fp, finalAt: Date.now() }).then(() => alert('Итоги подведены')).catch(e => alert(friendly(e)));
}
function resetResult(qid, sid) {
  if (!confirm('Сбросить результат? Ученик сможет пройти тест заново.')) return;
  fs.collection('results').doc(qid + '_' + sid).delete().catch(e => alert(friendly(e)));
}
function exportCSV(qid) {
  const q = db.quizzes.find(x => x.id === qid);
  const rows = [['Место', 'Ученик', 'Баллы', 'Правильных', 'Всего вопросов']]
    .concat(leaderboard(qid, false).map(r => [r.place, r.name, r.score, r.correct, r.total]));
  const csv = '\ufeff' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${q.title}.csv`; a.click();
}

/* ---- Настройки ---- */
function tabSettings() {
  return `<div class="card" style="max-width:420px"><h2>Пароль учителя</h2>
    <p class="muted">Логин учителя: <b>teacher</b></p>
    <label>Новый пароль (минимум 6 символов)<input id="tp" type="password"></label>
    <button class="green" onclick="saveTeacherPass()">Сменить пароль</button></div>`;
}
async function saveTeacherPass() {
  const p = $('#tp').value;
  if (p.length < 6) return alert('Пароль должен быть не короче 6 символов');
  try { await auth.currentUser.updatePassword(p); alert('Пароль изменён'); $('#tp').value = ''; }
  catch (e) { alert(friendly(e)); }
}

/* ===================== УЧЕНИК ===================== */
const myResult = qid => db.results.find(x => x.quizId === qid && x.uid === session.id);

function saveResult(r) {   // сохраняем результат ученика в облако
  upsertLocal(r);
  const { id, place, ...data } = r;
  return fs.collection('results').doc(r.quizId + '_' + r.uid).set(data);
}
function upsertLocal(r) {
  const i = db.results.findIndex(x => x.quizId === r.quizId && x.uid === r.uid);
  if (i >= 0) db.results[i] = r; else db.results.push(r);
}

function renderStudent() {
  if (game) return;
  if (studentView.startsWith('result:')) return drawResult(studentView.slice(7));
  const list = db.quizzes.filter(q => q.active && (q.classes || []).some(c => session.classes.includes(c)));
  list.forEach(q => { const r = myResult(q.id); if (q.mode === 'total' && r && !r.finished && Date.now() >= (r.deadline || 0)) finishTotal(r); });
  $('#app').innerHTML = `<div class="card"><h2>Доступные задания</h2>
    ${list.length ? '' : '<p class="muted">Сейчас нет открытых тестов. Подожди, пока учитель откроет задание.</p>'}
    ${list.map(q => {
      const r = myResult(q.id);
      let btn = `<button class="green" onclick="startQuiz('${q.id}')">▶ Начать</button>`;
      if (r && !r.finished && q.mode === 'total' && Date.now() < (r.deadline || 0)) btn = `<button class="green" onclick="resumeQuiz('${q.id}')">Продолжить</button>`;
      else if (r) btn = `<button class="sec" onclick="showResult('${q.id}')">Мой результат: ${r.score}</button>`;
      return `<div class="quizitem" style="padding:12px 0;border-top:1px solid #eee">
        <div><b>${esc(q.title)}</b><div class="muted">Вопросов: ${q.count || 0} · ${timeInfo(q)}</div></div>${btn}</div>`;
    }).join('')}</div>`;
}

async function startQuiz(qid) {
  if (busy) return;
  const meta = db.quizzes.find(x => x.id === qid);
  if (myResult(qid)) return renderStudent();
  if (meta.mode === 'total' && !confirm(`На весь тест даётся ${fmtMin(meta.totalMin)}. Время пойдёт сразу. Начать?`)) return;
  busy = true;
  try {
    const questions = await loadQuestions(qid);
    if (!questions.length) throw new Error('В этом тесте нет вопросов');
    const q = { ...meta, questions };
    const res = { quizId: qid, uid: session.id, name: session.name, score: 0, correct: 0, answered: 0,
      total: questions.length, finished: false, time: 0 };
    res.answers = questions.map(() => -1); res.key = questions.map(x => x.correct);
    if (q.mode === 'total') { res.start = Date.now(); res.deadline = res.start + q.totalMin * 60000; }
    await saveResult(res);
    if (q.mode === 'total') openTotal(q, res);
    else { game = { quiz: q, res, i: 0, locked: false, timer: null, t0: 0 }; showQuestion(); }
  } catch (e) { alert(friendly(e)); } finally { busy = false; }
}

/* ---- Таймер на каждый вопрос (как в Kahoot) ---- */
function showQuestion() {
  const g = game, q = g.quiz.questions[g.i];
  g.locked = false;
  $('#app').innerHTML = `<div class="game">
    <div class="gtop"><span>Вопрос ${g.i + 1} / ${g.quiz.questions.length}</span>
      <div class="clock" id="clock">${q.time}</div><span>⭐ ${g.res.score}</span></div>
    <div class="timer"><div id="bar"></div></div>
    <div class="qimg"><img src="${q.img}" alt="Задание"></div>
    <div class="answers">${q.options.map((t, k) => `
      <button class="ans ${LET[k]}" id="a${k}" onclick="answer(${k})"><b>${LET[k]}</b><span>${esc(t)}</span></button>`).join('')}</div>
    <div class="feedback" id="fb"></div></div>`;
  g.t0 = Date.now();
  g.timer = setInterval(() => {
    const left = Math.max(0, q.time - (Date.now() - g.t0) / 1000);
    $('#clock').textContent = Math.ceil(left);
    $('#bar').style.width = (left / q.time * 100) + '%';
    if (left <= 0) answer(-1);
  }, 100);
}
function answer(k) {
  const g = game; if (!g || g.locked) return;
  g.locked = true; clearInterval(g.timer);
  const q = g.quiz.questions[g.i];
  const elapsed = Math.min(q.time, (Date.now() - g.t0) / 1000);
  const ok = k === q.correct;
  g.res.answers[g.i] = k;
  let gain = 0;
  if (ok) { gain = Math.round(q.points * (0.5 + 0.5 * (1 - elapsed / q.time))); g.res.correct++; }  // чем быстрее — тем больше баллов
  g.res.score += gain; g.res.answered++; g.res.time += elapsed;
  const last = g.i + 1 >= g.quiz.questions.length;
  if (last) g.res.finished = true;
  saveResult(g.res).catch(console.error);
  document.querySelectorAll('.ans').forEach((b, i) => {
    b.disabled = true;
    if (i === q.correct) b.classList.add('right'); else b.classList.add('dim');
  });
  $('#fb').textContent = k === -1 ? '⏰ Время вышло!' : ok ? `✅ Верно! +${gain}` : '❌ Неверно';
  setTimeout(() => {
    g.i++;
    if (!last) showQuestion();
    else { const id = g.quiz.id; game = null; showResult(id); }
  }, 1800);
}

/* ---- Тест с общим временем: по порядку, сразу «верно/неверно», баллы 100% → 75% ---- */
async function resumeQuiz(qid) {
  if (busy) return; busy = true;
  try {
    const meta = db.quizzes.find(x => x.id === qid), r = myResult(qid);
    const q = { ...meta, questions: await loadQuestions(qid) };
    if (Date.now() >= r.deadline) { finishTotal(r); return showResult(qid); }
    openTotal(q, r);
  } catch (e) { alert(friendly(e)); } finally { busy = false; }
}
function openTotal(q, r) {
  const res = { ...r, answers: [...r.answers] };
  const i = res.answers.findIndex(a => a < 0);
  if (i < 0) { finishTotal(res); return showResult(q.id); }
  game = { mode: 'total', quiz: q, res, i, shown: false, msg: '', qStart: Date.now(), timer: null, per: q.totalMin * 60 / q.questions.length };
  drawTotal(); game.timer = setInterval(tickTotal, 500);
}
function tickTotal() {
  const g = game; if (!g || g.mode !== 'total') return;
  const left = (g.res.deadline - Date.now()) / 1000;
  const c = $('#tclock'); if (c) c.textContent = fmtClock(left);
  const b = $('#bar'); if (b) b.style.width = Math.max(0, left / (g.quiz.totalMin * 60) * 100) + '%';
  if (left <= 0) endTotal(true);
}
function drawTotal() {
  const g = game, q = g.quiz, qq = q.questions[g.i], a = g.res.answers[g.i], last = g.i === q.questions.length - 1;
  $('#app').innerHTML = `<div class="game">
    <div class="gtop"><span>Вопрос ${g.i + 1} / ${q.questions.length}</span>
      <div class="clock wide" id="tclock"></div><span>⭐ ${g.res.score}</span></div>
    <div class="timer"><div id="bar"></div></div>
    <div class="qimg"><img src="${qq.img}" alt="Задание"></div>
    <div class="answers">${qq.options.map((t, k) => `
      <button class="ans ${LET[k]} ${g.shown ? (k === qq.correct ? 'right' : k === a ? '' : 'dim') : ''}" ${g.shown ? 'disabled' : ''} onclick="pick(${k})"><b>${LET[k]}</b><span>${esc(t)}</span></button>`).join('')}</div>
    <div class="feedback">${g.msg}</div>
    ${g.shown ? `<div style="text-align:center;margin-top:12px"><button class="green" onclick="nextQ()">${last ? 'Завершить тест' : 'Далее →'}</button></div>` : ''}</div>`;
  tickTotal();
}
function pick(k) {
  const g = game; if (!g || g.shown) return; g.shown = true;
  const qq = g.quiz.questions[g.i], r = g.res, e = (Date.now() - g.qStart) / 1000;
  const ok = k === qq.correct; let gain = 0;
  if (ok) { gain = Math.round(qq.points * (1 - 0.25 * Math.min(1, e / g.per))); r.correct++; }
  r.answers[g.i] = k; r.score += gain; r.answered++;
  g.msg = ok ? `✅ Верно! +${gain}` : '❌ Неверно';
  saveResult(r).catch(console.error); drawTotal();
}
function nextQ() {
  const g = game; if (!g) return;
  if (g.i + 1 >= g.quiz.questions.length) return endTotal(true, true);
  g.i++; g.shown = false; g.msg = ''; g.qStart = Date.now(); drawTotal();
}
function endTotal(auto, silent) {
  const g = game; if (!g || g.ending) return;
  g.ending = true; clearInterval(g.timer);
  finishTotal(g.res); const id = g.quiz.id; game = null;
  if (auto && !silent) alert('Время вышло! Тест завершён.');
  showResult(id);
}
function finishTotal(r) {
  r.time = Math.min((r.deadline - r.start) / 1000, (Date.now() - r.start) / 1000);
  r.finished = true; saveResult(r).catch(console.error);
}

/* ---- Итоги ---- */
function showResult(qid) { studentView = 'result:' + qid; render(); }
function wrongList(r) { return r.key && r.answers ? r.key.map((c, i) => i).filter(i => r.answers[i] !== r.key[i] && (r.finished || r.answers[i] >= 0)) : []; }
function wrongHtml(r) {
  if (!r.finished || !r.key) return '';
  const w = wrongList(r);
  return `<div class="card"><h3>Разбор ошибок</h3>${w.length ? w.map(i => `<div style="padding:4px 0">Вопрос ${i + 1}: ${r.answers[i] >= 0 ? 'твой ответ ' + LET[r.answers[i]] : 'нет ответа'}, верный ответ <b>${LET[r.key[i]]}</b></div>`).join('') : '<p>Ошибок нет! 🎉</p>'}</div>`;
}
function qStats(lb) {
  const L = lb.filter(r => r.key); if (!L.length) return '';
  return `<h3 style="margin-top:18px">Ошибки по вопросам</h3>${L[0].key.map((_, j) => {
    const done = L.filter(r => r.finished || r.answers[j] >= 0).length, bad = L.filter(r => wrongList(r).includes(j)).length;
    return `<div style="padding:3px 0">Вопрос ${j + 1}: ошиблись <b>${bad}</b> из ${done}</div>`; }).join('')}`;
}
function drawResult(qid) {
  const q = db.quizzes.find(x => x.id === qid) || { title: '' };
  const mine = myResult(qid);
  if (!mine) { studentView = 'list'; return renderStudent(); }
  const fp = q.finalPlaces || null, fin = !!(fp && fp[session.id] !== undefined);
  const pre = leaderboard(qid, true).find(r => r.uid === session.id);
  const lb = fin ? db.results.filter(r => r.quizId === qid && r.finished && fp[r.uid] !== undefined).sort((a, b) => fp[a.uid] - fp[b.uid]) : [];
  const place = fin ? fp[session.id] : (pre ? pre.place : 0);
  $('#app').innerHTML = `<div class="card" style="text-align:center">
    <h2>${esc(q.title)}</h2>
    <div class="big">${mine.score}</div><div class="muted">баллов · правильных ответов: ${mine.correct} из ${mine.total}</div>
    ${!mine.finished ? '<div class="muted">Тест ещё не завершён</div>' : fin
      ? `<div class="place">🏆 Твоё место: ${place} из ${lb.length}</div>${place <= 3 ? `<div style="margin-top:12px"><button class="green" onclick="certs('${qid}','${session.id}')">🎓 Скачать грамоту</button></div>` : ''}`
      : `<div class="place">Предварительное место: ${place}</div><div class="muted">Итоги будут объявлены позже, когда все закончат.</div>`}
  </div>
  ${fin ? `<div class="card"><h3>Рейтинг класса</h3><table><tr><th>Место</th><th>Ученик</th><th>Баллы</th></tr>
    ${lb.map(r => `<tr class="${r.uid === session.id ? 'me' : ''}"><td>${fp[r.uid]}</td><td>${esc(r.name)}</td><td>${r.score}</td></tr>`).join('')}</table></div>` : ''}
  ${wrongHtml(mine)}
  <button onclick="studentView='list';render()">← К заданиям</button>`;
}

/* ===================== ГРАМОТЫ (PDF) ===================== */
const loadImg = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
function certCanvas(r, title, logo) {
  const W = 1754, H = 1240, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), mid = W / 2, F = '"Georgia","Times New Roman",serif';
  const fit = (txt, size, maxW, style = '') => { do { x.font = `${style} ${size}px ${F}`; size -= 2; } while (x.measureText(txt).width > maxW && size > 20); };
  const say = (txt, y, size, col, style = '', maxW = 1300) => { fit(txt, size, maxW, style); x.fillStyle = col; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt, mid, y); };
  x.fillStyle = '#46178f'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#fffdf5'; x.fillRect(36, 36, W - 72, H - 72);
  x.strokeStyle = '#d4a017'; x.lineWidth = 8; x.strokeRect(62, 62, W - 124, H - 124);
  x.strokeStyle = '#7b2ff7'; x.lineWidth = 3; x.strokeRect(80, 80, W - 160, H - 160);
  if (logo) { x.save(); x.beginPath(); x.arc(mid, 190, 80, 0, 7); x.clip(); x.drawImage(logo, mid - 80, 110, 160, 160); x.restore(); x.strokeStyle = '#d4a017'; x.lineWidth = 6; x.beginPath(); x.arc(mid, 190, 80, 0, 7); x.stroke(); }
  say('ГРАМОТА', 340, 130, '#46178f', 'bold');
  say('награждается', 440, 44, '#6b6785', 'italic');
  say(r.name, 560, 110, '#1f1a33', 'bold', 1350);
  x.strokeStyle = '#d4a017'; x.lineWidth = 3; x.beginPath(); x.moveTo(mid - 520, 625); x.lineTo(mid + 520, 625); x.stroke();
  say(`за ${r.place} место`, 710, 78, '#7b2ff7', 'bold');
  say(`в тесте «${title}»`, 800, 52, '#1f1a33', '', 1350);
  say(`Набрано баллов: ${r.score}  ·  Правильных ответов: ${r.correct} из ${r.total}`, 880, 38, '#6b6785');
  const medal = ['#d4a017', '#9e9e9e', '#b8722c'][r.place - 1] || '#d4a017';
  x.fillStyle = medal; x.beginPath(); x.arc(mid, 1010, 64, 0, 7); x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 6; x.stroke();
  x.fillStyle = '#fff'; x.font = `bold 72px ${F}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(r.place), mid, 1014);
  x.fillStyle = '#6b6785'; x.font = `32px ${F}`; x.textAlign = 'left'; x.fillText(new Date().toLocaleDateString('ru-RU'), 180, 1080);
  x.textAlign = 'center'; x.strokeStyle = '#1f1a33'; x.lineWidth = 2; x.beginPath(); x.moveTo(W - 640, 1060); x.lineTo(W - 180, 1060); x.stroke();
  x.fillStyle = '#1f1a33'; x.font = `30px ${F}`; x.fillText('От преподавателя математики', W - 410, 1090); x.font = `bold 34px ${F}`; x.fillText('Nihat Yolçuyev', W - 410, 1130);
  return c;
}
async function certs(qid, uid) {
  const q = db.quizzes.find(x => x.id === qid) || { title: '' };
  const ok = session.role === 'teacher' ? (r => !resultsClass || ((db.students.find(s => s.id === r.uid) || {}).classes || []).includes(resultsClass)) : null;
  let list;
  if (session.role === 'teacher') list = leaderboard(qid, true, ok).filter(r => r.place <= 3);
  else { const fp = q.finalPlaces || {}, mine = myResult(qid); list = mine && mine.finished && fp[session.id] <= 3 ? [{ ...mine, place: fp[session.id] }] : []; }
  if (uid) list = list.filter(r => r.uid === uid);
  if (!list.length) return alert('Пока нет призёров, для которых можно сделать грамоту.');
  if (!window.jspdf) return alert('Не загрузилась библиотека PDF. Проверьте интернет и обновите страницу.');
  try {
    const logo = await loadImg('logo.png');
    const pdf = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    list.forEach((r, i) => { if (i) pdf.addPage(); pdf.addImage(certCanvas(r, q.title, logo).toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pw, ph); });
    pdf.save(uid ? `Грамота ${list[0].name}.pdf` : 'Грамоты.pdf');
  } catch (e) { alert('Не удалось создать PDF: ' + e.message); }
}

boot();