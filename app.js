/**
 * Kejar PTN! v2.2 — SMAN 3 Kota Blitar (Kelas XI-2)
 * Unified Offline-First IndexedDB + Google Apps Script Auth & Sync
 * Perbaikan: Sanitasi Escape Quote, Normalisasi Opsi JSON, Auto-Sync Antrean Offline, & Batal/Replay Sesi
 */
(function () {
  'use strict';

  const SYNC_API_URL = 'https://script.google.com/macros/s/AKfycbyO5Kjjq24Bq37pR7PS7kAHs3sXRt350LJ9x9eNlGbvzyD2lRkIJVXSufSvs4s_FJyQ/exec';
  const SESSION_KEY = 'kejarptn_auth_session_v1';
  const PENDING_SYNC_KEY = 'kejarptn_pending_sync_v2';
  const SETTINGS_KEY = 'kp';

  const FF = [
    'Bahasa Indonesia', 'Bahasa Inggris', 'Bahasa Jawa', 'Matematika Wajib',
    'Matematika Lanjut', 'PPKN', 'Agama', 'PJOK', 'Sejarah',
    'Fisika', 'Kimia', 'Biologi', 'Informatika', 'Seni Budaya'
  ];
  const FE = [
    'Agama', 'PPKN', 'Bahasa Indonesia', 'Matematika Wajib', 'IPA Terpadu',
    'IPS Terpadu', 'Bahasa Inggris', 'Bahasa Jawa', 'PJOK', 'Informatika', 'Seni Budaya'
  ];
  const KATS = {
    Tugas: ['LKPD', 'LKM', 'UKB', 'Buku Tulis', 'Folio', 'Buku Paket'],
    'Ulangan Harian': ['Lisan', 'Paper', 'HP'],
    Praktik: 0,
    'STS/PTS': 0,
    PAS: 0
  };

  const JADWAL_ASAS = [
    { id: 'BIN-F', mapel: 'Bahasa Indonesia', hari: 'Senin, 30 Nov 2026', sesi: 'Sesi 1 (07.00–09.00)', menit: 120 },
    { id: 'PPK-F', mapel: 'PKn', hari: 'Senin, 30 Nov 2026', sesi: 'Sesi 2 (10.00–11.00)', menit: 60 },
    { id: 'MTW-F', mapel: 'Matematika Wajib', hari: 'Selasa, 1 Des 2026', sesi: 'Sesi 1 (07.00–09.00)', menit: 120 },
    { id: 'PJK-F', mapel: 'PJOK', hari: 'Selasa, 1 Des 2026', sesi: 'Sesi 2 (10.00–11.00)', menit: 60 },
    { id: 'BIO-F', mapel: 'Biologi', hari: 'Rabu, 2 Des 2026', sesi: 'Sesi 1 (07.00–09.00)', menit: 120 },
    { id: 'AGM-F', mapel: 'Pendidikan Agama', hari: 'Rabu, 2 Des 2026', sesi: 'Sesi 2 (10.00–11.00)', menit: 60 },
    { id: 'FIS-F', mapel: 'Fisika', hari: 'Kamis, 3 Des 2026', sesi: 'Sesi 1 (07.00–09.00)', menit: 120 },
    { id: 'SBD-F', mapel: 'Seni Budaya', hari: 'Kamis, 3 Des 2026', sesi: 'Sesi 2 (10.00–11.00)', menit: 60 },
    { id: 'KIM-F', mapel: 'Kimia', hari: "Jum'at, 4 Des 2026", sesi: 'Sesi 1 (07.00–09.00)', menit: 120 },
    { id: 'SJR-F', mapel: 'Sejarah', hari: "Jum'at, 4 Des 2026", sesi: 'Sesi 2 (10.00–11.00)', menit: 60 },
    { id: 'MTL-F', mapel: 'Matematika Lanjut', hari: 'Senin, 7 Des 2026', sesi: 'Sesi 1 (07.00–09.00)', menit: 120 },
    { id: 'BJW-F', mapel: 'Bahasa Jawa', hari: 'Senin, 7 Des 2026', sesi: 'Sesi 2 (10.00–11.00)', menit: 60 },
    { id: 'BIG-F', mapel: 'Bahasa Inggris', hari: 'Selasa, 8 Des 2026', sesi: 'Sesi 1 (07.00–09.00)', menit: 120 },
    { id: 'INF-F', mapel: 'Informatika', hari: 'Rabu, 9 Des 2026', sesi: 'Sesi 1 (07.00–09.00)', menit: 120 }
  ];

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => '&#' + c.charCodeAt(0) + ';');

  let S = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || {
    nama: 'Wafi',
    jur: '',
    target: 85,
    kktp: 78,
    pins: ['Matematika Lanjut', 'Fisika'],
    sem: 3
  };

  let D = [];          // Grades array
  let BANKS = {};      // { 'BIN-F': { id: 'BIN-F', soal: [...] } }
  let HISTORY = [];    // Exam & Quiz history array

  let T = 'home';
  let UT = 'h';
  let RT = 'F';
  let RS = 1;
  let EX_TAB = 'list'; // 'list' | 'riwayat'
  let OP = new Set();
  let CH = [];
  let cbtSession = null;
  let timerId = null;
  let countdownId = null;

  /* =========================================================
     UNIFIED INDEXEDDB (kejarptn_v2) + MIGRASI DATA LAMA
     ========================================================= */
  const dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('kejarptn_v2', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('grades')) db.createObjectStore('grades', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('banks')) db.createObjectStore('banks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  async function idbGetAll(storeName) {
    const db = await dbPromise;
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async function idbPut(storeName, item) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDelete(storeName, key) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbReplaceAll(storeName, items) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      (items || []).forEach((it) => store.put(it));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function normalizeQuestion(rawQ) {
    if (!rawQ || !rawQ.pertanyaan || !rawQ.opsi || !rawQ.kunci) return null;
    const normOpsi = {};
    Object.keys(rawQ.opsi).forEach((k) => {
      const uk = String(k).trim().toUpperCase();
      if (['A', 'B', 'C', 'D', 'E'].includes(uk) && rawQ.opsi[k] !== undefined && rawQ.opsi[k] !== null) {
        normOpsi[uk] = String(rawQ.opsi[k]);
      }
    });
    const normKunci = String(rawQ.kunci).trim().toUpperCase();
    if (Object.keys(normOpsi).length < 2 || !normKunci) return null;

    return {
      ...rawQ,
      materi: (rawQ.materi && String(rawQ.materi).trim()) ? String(rawQ.materi).trim() : 'Materi Umum',
      opsi: normOpsi,
      kunci: normKunci
    };
  }

  async function migrateLegacyDataIfNeeded() {
    if (D.length === 0 && window.indexedDB) {
      try {
        const legacyGrades = await new Promise((resolve) => {
          const r = indexedDB.open('kejarptn', 1);
          r.onupgradeneeded = () => { r.transaction.abort(); resolve([]); };
          r.onsuccess = () => {
            const oldDb = r.result;
            if (!oldDb.objectStoreNames.contains('s')) { oldDb.close(); resolve([]); return; }
            const q = oldDb.transaction('s', 'readonly').objectStore('s').getAll();
            q.onsuccess = () => { oldDb.close(); resolve(q.result || []); };
            q.onerror = () => { oldDb.close(); resolve([]); };
          };
          r.onerror = () => resolve([]);
        });
        if (legacyGrades.length > 0) {
          for (const g of legacyGrades) {
            const clean = {
              id: g.id, fase: g.fase, sem: g.sem, tgl: g.tgl || '',
              mapel: g.mapel, kat: g.kat, sub: g.sub || '',
              judul: g.judul, nilai: g.nilai, remed: g.remed ?? null
            };
            D.push(clean);
            await idbPut('grades', clean);
          }
        }
      } catch (e) {}
    }

    if (Object.keys(BANKS).length === 0) {
      try {
        const oldExam = JSON.parse(localStorage.getItem('kejarptn_exam_banks_v1') || '{}');
        const oldQuiz = JSON.parse(localStorage.getItem('kejarptn_quiz_banks_v1') || '{}');
        const allIds = new Set([...Object.keys(oldExam), ...Object.keys(oldQuiz)]);
        for (const id of allIds) {
          const merged = [];
          const seen = new Set();
          [...(oldExam[id]?.soal || []), ...(oldQuiz[id]?.soal || [])].forEach((s) => {
            const norm = normalizeQuestion(s);
            if (!norm) return;
            const sig = String(norm.pertanyaan_inti || norm.pertanyaan).trim();
            if (sig && !seen.has(sig)) {
              seen.add(sig);
              merged.push(norm);
            }
          });
          if (merged.length > 0) {
            BANKS[id] = { id, soal: merged };
            await idbPut('banks', BANKS[id]);
          }
        }
      } catch (e) {}
    }

    if (HISTORY.length === 0) {
      try {
        const oldHist = JSON.parse(localStorage.getItem('kejarptn_exam_history_v1') || '[]');
        if (Array.isArray(oldHist) && oldHist.length > 0) {
          for (let i = 0; i < oldHist.length; i++) {
            const h = { id: 'H' + Date.now() + '_' + i, ...oldHist[i] };
            HISTORY.push(h);
            await idbPut('history', h);
          }
        }
      } catch (e) {}
    }
  }

  /* =========================================================
     HELPERS PERHITUNGAN NILAI SNBP & TANGGAL
     ========================================================= */
  const ef = (r) => (r.remed != null ? r.remed : r.nilai);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const fm = (n) => (n == null ? '–' : (+n.toFixed(1)).toString().replace('.', ','));
  const op = (a, s) => a.map((x) => `<option value="${esc(x)}"${x == s ? ' selected' : ''}>${esc(x)}</option>`).join('');
  const bd = (a) => (a != null && a < S.kktp ? 'bad' : '');
  const rec = (m, fa, s) => D.filter((r) => r.fase === fa && r.mapel === m && (!s || r.sem === s));
  const mAvg = (m, fa, s) => avg(rec(m, fa, s).map(ef));
  const semAvg = (n) => avg((n < 3 ? FE : FF).map((m) => mAvg(m, n < 3 ? 'E' : 'F', n)).filter((x) => x != null));
  const cum = () => avg([1, 2, 3, 4, 5].filter((n) => n <= S.sem).map(semAvg).filter((x) => x != null));

  function formatTanggalID(isoDate) {
    if (!isoDate) return '-';
    try {
      const [y, m, d] = isoDate.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      return dt.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return isoDate;
    }
  }

  function toast(msg) {
    const e = $('#t');
    e.textContent = msg;
    e.hidden = false;
    setTimeout(() => { e.hidden = true; }, 2200);
  }

  const pill = (on, l, js, cls = '') =>
    `<button type="button" class="pl${on ? ' on ' + cls : ''}" onclick="${js}">${l}</button>`;

  function formatHMS(totalSec) {
    const s = Math.max(0, Math.floor(totalSec));
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  }

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* =========================================================
     CLOUD SYNC & AUTH (GOOGLE APPS SCRIPT)
     ========================================================= */
  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  function saveSession(u) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(u));
    updateSyncPill();
  }

  function updateSyncPill() {
    const u = getSession();
    const el = $('#sync-pill');
    if (!el) return;
    if (!u) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const hasPending = localStorage.getItem(PENDING_SYNC_KEY) === '1';
    el.textContent = (navigator.onLine ? (hasPending ? '🔄 @' : '☁️ @') : '📴 @') + u.username;
    el.onclick = () => syncPush(false);
  }

  function buildSyncPayload() {
    return JSON.stringify({
      v: 2,
      exportedAt: new Date().toISOString(),
      settings: S,
      grades: D.map(({ foto, ...rest }) => rest),
      banks: BANKS,
      history: HISTORY
    });
  }

  async function applySyncPayload(payloadStr) {
    if (!payloadStr) return false;
    const p = JSON.parse(payloadStr);

    if (p.settings) {
      S = { ...S, ...p.settings };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(S));
    }

    if (Array.isArray(p.grades)) {
      D = p.grades;
      await idbReplaceAll('grades', D);
    } else if (p.indexedDB?.kejarptn?.stores?.s?.records) {
      D = p.indexedDB.kejarptn.stores.s.records.map((r) => {
        const v = r.value || {};
        const { foto, ...clean } = v;
        return clean;
      });
      await idbReplaceAll('grades', D);
    }

    if (p.banks && typeof p.banks === 'object') {
      BANKS = p.banks;
      await idbReplaceAll('banks', Object.values(BANKS));
    } else if (p.localStorage) {
      try {
        const b1 = JSON.parse(p.localStorage.kejarptn_exam_banks_v1 || '{}');
        const b2 = JSON.parse(p.localStorage.kejarptn_quiz_banks_v1 || '{}');
        const ids = new Set([...Object.keys(b1), ...Object.keys(b2)]);
        BANKS = {};
        ids.forEach((id) => {
          const seen = new Set();
          const list = [];
          [...(b1[id]?.soal || []), ...(b2[id]?.soal || [])].forEach((s) => {
            const norm = normalizeQuestion(s);
            if (!norm) return;
            const sig = String(norm.pertanyaan_inti || norm.pertanyaan).trim();
            if (sig && !seen.has(sig)) { seen.add(sig); list.push(norm); }
          });
          if (list.length) BANKS[id] = { id, soal: list };
        });
        await idbReplaceAll('banks', Object.values(BANKS));
      } catch {}
    }

    if (Array.isArray(p.history)) {
      HISTORY = p.history;
      await idbReplaceAll('history', HISTORY);
    }
    return true;
  }

  async function callApi(body) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(SYNC_API_URL, {
        method: 'POST',
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Gagal terhubung ke server.');
      return json;
    } finally {
      clearTimeout(to);
    }
  }

  async function syncPush(silent = true) {
    const u = getSession();
    if (!u) return;
    if (!navigator.onLine) {
      localStorage.setItem(PENDING_SYNC_KEY, '1');
      updateSyncPill();
      if (!silent) toast('Offline: perubahan masuk antrean sync.');
      return;
    }
    const pillEl = $('#sync-pill');
    if (pillEl) pillEl.textContent = '⏳ Sync...';
    try {
      const resp = await callApi({
        action: 'push',
        username: u.username,
        token: u.token,
        payload: buildSyncPayload()
      });
      localStorage.removeItem(PENDING_SYNC_KEY);
      u.lastSync = resp.lastSync;
      saveSession(u);
      if (!silent) toast('Data tersinkron ke Cloud ✓');
    } catch (err) {
      localStorage.setItem(PENDING_SYNC_KEY, '1');
      updateSyncPill();
      if (!silent) toast('Gagal sync: ' + err.message);
    }
  }

  async function syncPull() {
    const u = getSession();
    if (!u) return;
    if (!navigator.onLine) return toast('Butuh koneksi internet untuk menarik data.');
    toast('Mengambil data dari Cloud...');
    try {
      const resp = await callApi({ action: 'pull', username: u.username, token: u.token });
      if (!resp.payload) return toast('Belum ada cadangan di Cloud.');
      await applySyncPayload(resp.payload);
      localStorage.removeItem(PENDING_SYNC_KEY);
      u.lastSync = resp.lastSync;
      saveSession(u);
      toast('Data berhasil dipulihkan ✓');
      go(T, 1);
    } catch (err) {
      toast('Gagal tarik data: ' + err.message);
    }
  }

  function renderAuthGate() {
    const root = $('#auth-root');
    let mode = 'login';

    function draw() {
      root.innerHTML = `
        <div class="auth-gate">
          <div class="auth-card">
            <div style="width:46px;height:46px;border-radius:14px;background:var(--b);color:var(--y);font-size:22px;font-weight:800;display:grid;place-items:center;margin-bottom:12px;">★</div>
            <h2 style="font-size:21px;font-weight:800;margin-bottom:4px;">Kejar PTN!</h2>
            <p class="mu">Masuk untuk sinkronisasi nilai rapor SNBP, bank soal, dan riwayat latihan lintas perangkat.</p>

            <div class="auth-tabs">
              <button type="button" class="auth-tab ${mode === 'login' ? 'on' : ''}" data-m="login">Masuk</button>
              <button type="button" class="auth-tab ${mode === 'register' ? 'on' : ''}" data-m="register">Daftar</button>
            </div>

            <form id="auth-fm" class="fm">
              ${mode === 'register' ? `
                <label>Nama Lengkap / Panggilan
                  <input type="text" id="a-nama" placeholder="Contoh: Wafi" value="${esc(S.nama !== 'Siswa' ? S.nama : '')}" required>
                </label>
              ` : ''}
              <label>Username
                <input type="text" id="a-user" placeholder="Minimal 3 karakter" autocomplete="username" required>
              </label>
              <label>Password
                <input type="password" id="a-pass" placeholder="Minimal 4 karakter" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required>
              </label>
              <div id="a-err" style="color:var(--r);font-size:12px;font-weight:700;"></div>
              <button type="submit" class="bt bt-blue" id="a-btn" style="width:100%;">
                ${mode === 'login' ? 'Masuk ke Beranda' : 'Daftar & Buat Akun'}
              </button>
            </form>
          </div>
        </div>
      `;

      root.querySelectorAll('[data-m]').forEach((b) => {
        b.onclick = () => { mode = b.dataset.m; draw(); };
      });

      root.querySelector('#auth-fm').onsubmit = async (e) => {
        e.preventDefault();
        const btn = $('#a-btn');
        const err = $('#a-err');
        const username = $('#a-user').value.trim();
        const password = $('#a-pass').value;
        const nama = mode === 'register' ? $('#a-nama').value.trim() : username;

        err.textContent = '';
        btn.disabled = true;
        btn.textContent = mode === 'login' ? 'Memeriksa akun...' : 'Mendaftarkan akun...';

        try {
          if (mode === 'register') {
            S.nama = nama || S.nama;
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(S));
            const res = await callApi({
              action: 'register',
              username,
              password,
              nama: S.nama,
              initialPayload: buildSyncPayload()
            });
            saveSession(res.user);
            root.innerHTML = '';
            go('home');
            toast('Akun berhasil dibuat ✓');
          } else {
            const res = await callApi({ action: 'login', username, password });
            saveSession(res.user);
            if (res.payload) {
              await applySyncPayload(res.payload);
            } else if (res.user.nama) {
              S.nama = res.user.nama;
              localStorage.setItem(SETTINGS_KEY, JSON.stringify(S));
              syncPush(true);
            }
            root.innerHTML = '';
            go('home');
            toast('Selamat datang kembali, ' + S.nama + '!');
          }
        } catch (ex) {
          err.textContent = ex.message;
          btn.disabled = false;
          btn.textContent = mode === 'login' ? 'Masuk ke Beranda' : 'Daftar & Buat Akun';
        }
      };
    }

    draw();
  }

  /* =========================================================
     VIEWS (BERANDA, REKAP, INPUT, GRAFIK, EXAM, SETELAN)
     ========================================================= */
  const V = {};
  const AF = {};

  // 1. BERANDA
  V.home = () => {
    const c = cum();
    const d = c != null ? S.target - c : null;
    const n = D.filter((r) => r.kat === 'Tugas').length;
    const p = (m) => mAvg(m, 'F');
    const msg = c == null
      ? 'Isi nilai pertamamu untuk mulai melacak progres menuju PTN impian.'
      : d <= 0.05
        ? `🎉 Rata-ratamu sudah melewati target ${S.target}. Pertahankan, ya!`
        : `Tinggal <b>${fm(d)} poin</b> lagi untuk mencapai target ${S.target}${S.jur ? ' — ' + esc(S.jur) : ''}. Kamu pasti bisa!`;

    return `
      <div class="c">
        <small class="mu">Rata-Rata Kumulatif SNBP</small>
        <div class="big">${fm(c)}</div>
        <small class="mu">Semester 1 – Semester ${S.sem} · Target ${S.target}</small>
      </div>
      <div class="c">
        <small class="mu">Total Tugas Terkumpul</small>
        <div class="big">${n}</div>
        <small class="mu">LKPD, LKM, UKB, Folio, Buku Tulis, dll.</small>
      </div>
      <div class="c w">
        <b>Pin Mapel Pendukung PTN</b>
        ${S.pins.map((m) => `<div class="row"><span><i class="star">★</i> ${esc(m)}</span><b class="${bd(p(m))}">${fm(p(m))}</b></div>`).join('')}
      </div>
      <div class="c w mot">
        <b>💪 Motivasi</b>
        <p style="margin-top:6px;line-height:1.5;">${msg}</p>
      </div>
    `;
  };

  // 2. REKAP (DETAIL, EDIT, UPDATE REMEDIAL, & HAPUS)
  const hi = (r) => {
    const e = ef(r);
    return `
      <div class="hi">
        <div>
          <b>${esc(r.judul)}</b>
          <small>${[r.kat, r.sub, r.tgl].filter(Boolean).join(' · ')}${r.fase === 'F' ? ' · Sem ' + r.sem : ''}</small>
          ${r.remed != null ? `<small class="nt">Awal: ${r.nilai} → Remedial: ${r.remed}</small>` : ''}
          ${e < S.kktp ? '<span class="st">Remedial</span>' : ''}
        </div>
        <b class="n ${bd(e)}">${fm(e)}</b>
        <div class="ac">
          <button type="button" onclick="KP.openGradeSummaryModal('${r.id}', false)">Detail</button>
          <button type="button" class="btn-edit" onclick="KP.openEditGradeModal('${r.id}')">Edit</button>
          <button type="button" onclick="KP.rm('${r.id}')">Update Remedial</button>
          <button type="button" class="btn-del" onclick="KP.confirmDeleteGrade('${r.id}')">Hapus</button>
        </div>
      </div>
    `;
  };

  V.rekap = () => {
    const ms = RT === 'F' ? FF : FE;
    return `
      <div class="c w">
        <div class="tb" style="margin-bottom:8px;">
          ${pill(RT === 'F', 'Fase F (Kelas XI–XII)', "KP.setRT('F')")}
          ${pill(RT === 'E', 'Fase E (Kelas X)', "KP.setRT('E')")}
        </div>
        ${ms.map((m) => {
          const rs = rec(m, RT).sort((a, b) => a.sem - b.sem || (a.tgl || '').localeCompare(b.tgl || ''));
          const a = avg(rs.map(ef));
          return `
            <details${OP.has(m) ? ' open' : ''} ontoggle="KP.tog('${esc(m)}',this.open)">
              <summary><span>${esc(m)}</span><b class="${bd(a)}">${fm(a)}</b></summary>
              ${rs.length ? rs.map(hi).join('') : '<p class="mu" style="padding:8px 0">Belum ada nilai.</p>'}
            </details>
          `;
        }).join('')}
      </div>
    `;
  };

  // 3. INPUT NILAI
  V.up = () => `
    <div class="c w">
      <div class="tb">
        ${pill(UT === 'h', 'Nilai Harian (Sem 3–5)', "KP.setUT('h')")}
        ${pill(UT === 'r', 'Rapor Kelas X (Sem 1–2)', "KP.setUT('r')")}
      </div>
    </div>
  ` + (UT === 'h' ? `
    <form class="c w fm" onsubmit="KP.sv(event)">
      <label>Semester<select name="sem">${op([3, 4, 5], Math.max(3, S.sem))}</select></label>
      <label>Tanggal<input type="date" name="tgl" required value="${new Date().toISOString().slice(0, 10)}"></label>
      <label>Mapel<select name="mapel">${op(FF)}</select></label>
      <label>Kategori<select name="kat" onchange="KP.ks(this.value)">${op(Object.keys(KATS))}</select></label>
      <label id="sl">Sub-Kategori<select name="sub" required>${op(KATS.Tugas)}</select></label>
      <label>Judul<input name="judul" required maxlength="60" placeholder="mis. LKPD Bab 3"></label>
      <label>Nilai (0–100)<input name="nilai" type="number" min="0" max="100" step="any" inputmode="decimal" required></label>
      <button type="submit" class="bt">Simpan Nilai</button>
    </form>
  ` : `
    <div class="c w">
      <label style="margin-bottom:8px;">Semester Rapor
        <select onchange="KP.setRS(+this.value)">${op([1, 2], RS)}</select>
      </label>
      <table class="tbl">
        ${FE.map((m) => {
          const r = D.find((x) => x.id === `R${RS}-${m}`);
          return `<tr><td>${esc(m)}</td><td style="text-align:right;"><input type="number" min="0" max="100" step="any" inputmode="decimal" data-m="${esc(m)}" value="${r ? r.nilai : ''}"></td></tr>`;
        }).join('')}
      </table>
      <button type="button" class="bt" style="width:100%;" onclick="KP.sr()">Simpan Rapor Sem ${RS}</button>
    </div>
  `);

  // 4. GRAFIK (SEMESTER 1–5 & SEMUA)
  V.gr = () => {
    const allMapels = [...new Set([...FF, ...FE])];
    return `
      <div class="c w fm">
        <label>Pilih Mata Pelajaran
          <select id="gm" onchange="KP.dc()">${op(allMapels)}</select>
        </label>
        <label>Pilih Semester
          <select id="gs" onchange="KP.dc()">
            ${op(['Semua', 'Sem 1', 'Sem 2', 'Sem 3', 'Sem 4', 'Sem 5'], 'Semua')}
          </select>
        </label>
      </div>
      <div class="c">
        <b style="display:block;margin-bottom:8px;">Tren SNBP Semester 1–5</b>
        <canvas id="c1"></canvas>
      </div>
      <div class="c">
        <b style="display:block;margin-bottom:8px;">Detail Nilai per Mapel & Semester</b>
        <canvas id="c2"></canvas>
      </div>
    `;
  };

  function dc() {
    if (typeof Chart === 'undefined') return toast('Chart.js belum siap. Buka saat online sekali.');
    CH.forEach((c) => c.destroy());
    CH = [];

    const ln = (l, d, c, x = {}) => ({
      label: l, data: d, borderColor: c, backgroundColor: c,
      tension: 0.3, pointRadius: 4, spanGaps: true, ...x
    });
    const opts = { responsive: true, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { position: 'bottom' } } };
    const L = [1, 2, 3, 4, 5].map((n) => 'Sem ' + n);

    CH.push(new Chart($('#c1'), {
      type: 'line',
      data: {
        labels: L,
        datasets: [
          ln('Rata-rata rapor', L.map((_, i) => semAvg(i + 1)), '#2563EB', { borderWidth: 3 }),
          ln('Target PTN', L.map(() => S.target), '#F59E0B', { borderDash: [6, 6], pointRadius: 0 })
        ]
      },
      options: opts
    }));

    const m = $('#gm').value;
    const s = $('#gs').value;
    const rs = D.filter((r) => r.mapel === m && (s === 'Semua' || 'Sem ' + r.sem === s))
      .sort((a, b) => a.sem - b.sem || (a.tgl || '').localeCompare(b.tgl || ''));

    CH.push(new Chart($('#c2'), {
      type: 'line',
      data: {
        labels: rs.length ? rs.map((r) => (s === 'Semua' ? `S${r.sem}: ` : '') + r.judul.slice(0, 14)) : ['Belum ada data'],
        datasets: [
          ln('Nilai', rs.length ? rs.map(ef) : [null], '#2563EB', { borderWidth: 3 }),
          ln('Batas KKM', rs.length ? rs.map(() => S.kktp) : [S.kktp], '#EF4444', { borderDash: [6, 6], pointRadius: 0 })
        ]
      },
      options: opts
    }));
  }
  AF.gr = dc;

  // 5. EXAM (SIMULASI ASAS & MODE KUIS JADI SATU + RIWAYAT)
  V.exam = () => {
    if (EX_TAB === 'riwayat') {
      return `
        <div class="c w">
          <div class="tb">
            ${pill(false, 'Daftar Mapel (ASAS & Kuis)', "KP.setExTab('list')")}
            ${pill(true, `Riwayat (${HISTORY.length})`, "KP.setExTab('riwayat')", 'on-blue')}
          </div>
        </div>
        ${HISTORY.length === 0 ? `
          <div class="c w" style="text-align:center;padding:28px 16px;">
            <b>Belum ada riwayat ujian atau kuis.</b>
            <p class="mu" style="margin-top:4px;">Tambahkan soal pada mapel lalu klik Mulai Ujian / Kuis.</p>
          </div>
        ` : HISTORY.map((h) => {
          const isQuiz = h.mode === 'KUIS';
          const pass = h.skor >= S.kktp;
          return `
            <div class="c">
              <div class="ex-top">
                <div>
                  <span class="ex-badge ${isQuiz ? 'ex-badge-quiz' : 'ex-badge-ready'}">${isQuiz ? 'MODE KUIS' : 'UJIAN ASAS'}</span>
                  <h4 style="margin-top:6px;font-size:16px;">${esc(h.mapel)}</h4>
                  <small class="mu">${esc(h.tanggal)} · ${isQuiz ? esc(h.materi || 'Semua Bab') : esc(h.durasi)}</small>
                </div>
                <span class="ex-badge" style="font-size:14px;background:${pass ? '#EFF6FF' : '#FEF2F2'};color:${pass ? 'var(--b)' : 'var(--r)'};">
                  Skor: ${h.skor}
                </span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px;">
                <p class="mu">Benar <b>${h.benar}</b> dari <b>${h.total}</b> soal</p>
                <button type="button" class="bt bt-danger" style="padding:5px 12px;font-size:11px;" onclick="KP.deleteHistory('${esc(h.id)}')">Hapus</button>
              </div>
            </div>
          `;
        }).join('')}
      `;
    }

    return `
      <div class="c w">
        <div class="tb">
          ${pill(true, 'Daftar Mapel (ASAS & Kuis)', "KP.setExTab('list')", 'on-blue')}
          ${pill(false, `Riwayat (${HISTORY.length})`, "KP.setExTab('riwayat')")}
        </div>
      </div>
      ${JADWAL_ASAS.map((j) => {
        const bank = BANKS[j.id];
        const total = bank && Array.isArray(bank.soal) ? bank.soal.length : 0;
        return `
          <div class="c ex-card">
            <div class="ex-top">
              <div>
                <h4 style="font-size:16px;font-weight:800;">${esc(j.mapel)}</h4>
                <small class="mu">${esc(j.hari)} · ${esc(j.sesi)}</small>
              </div>
              <span class="ex-badge ${total > 0 ? 'ex-badge-ready' : 'ex-badge-empty'}">
                ${total > 0 ? `Total: ${total} Soal` : '0 Soal'}
              </span>
            </div>
            <div class="ex-actions">
              <button type="button" class="bt bt-soft" onclick="KP.openAddModal('${j.id}')">+ Tambahkan Soal</button>
              <button type="button" class="bt" ${total > 0 ? `onclick="KP.openModePopup('${j.id}')"` : 'disabled'}>
                Mulai Ujian / Kuis
              </button>
            </div>
          </div>
        `;
      }).join('')}
    `;
  };

  // 6. SETELAN
  V.set = () => {
    const u = getSession();
    return `
      <form class="c w fm" onsubmit="KP.ss(event)">
        <label>Nama
          <input name="nama" required value="${esc(S.nama)}">
        </label>
        <label>Target Jurusan / PTN
          <input name="jur" value="${esc(S.jur)}" placeholder="mis. Teknik Informatika — ITS">
        </label>
        <a href="https://snpmb.bppp.kemdikbud.go.id/" target="_blank" rel="noopener" class="bt bt-soft" style="text-decoration:none;font-size:13px;">
          🌐 Cek Daya Tampung & Prodi di Portal Resmi SNPMB ↗
        </a>
        <label>Target Skor SNBP
          <input name="target" type="number" min="0" max="100" step="any" value="${S.target}">
        </label>
        <label>Batas KKM
          <input name="kktp" type="number" min="0" max="100" step="any" value="${S.kktp}">
        </label>
        <label>Semester Aktif
          <select name="sem">${op([1, 2, 3, 4, 5], S.sem)}</select>
        </label>
        <label>Mapel PTN 1
          <select name="p1">${op(FF, S.pins[0])}</select>
        </label>
        <label>Mapel PTN 2
          <select name="p2">${op(FF, S.pins[1])}</select>
        </label>
        <button type="submit" class="bt">Simpan Pengaturan</button>
      </form>

      <div class="c w" style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="bt2" style="flex:1;" onclick="KP.ex()">Ekspor Excel (.CSV)</button>
        <button type="button" class="bt2" style="flex:1;" onclick="KP.pt()">Cetak / Simpan PDF</button>
      </div>

      ${u ? `
        <div class="c w fm">
          <b>Akun & Sinkronisasi Cloud</b>
          <p class="mu">Masuk sebagai <b>@${esc(u.username)}</b></p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="bt bt-blue" style="flex:1;" onclick="KP.syncPush(false)">↑ Sync ke Cloud</button>
            <button type="button" class="bt bt-soft" style="flex:1;" onclick="KP.syncPull()">↓ Pulihkan Data</button>
          </div>
          <button type="button" class="bt bt-danger" onclick="KP.logout()">Keluar Akun</button>
        </div>
      ` : ''}
    `;
  };

  /* =========================================================
     MODALS: POP-UP RINGKASAN TUGAS, EDIT TUGAS, & HAPUS DATA
     ========================================================= */
  function closeModal() {
    if (countdownId) { clearInterval(countdownId); countdownId = null; }
    $('#modal-root').innerHTML = '';
  }

  function openGradeSummaryModal(id, isJustUploaded = true) {
    const r = D.find((x) => x.id === id);
    if (!r) return;
    const nilaiAkhir = ef(r);
    const isTuntas = nilaiAkhir >= S.kktp;
    const rataMapel = mAvg(r.mapel, r.fase, r.sem);
    const waktuCatat = r.uploadedAt || formatTanggalID(r.tgl);

    $('#modal-root').innerHTML = `
      <div class="modal-bg" onclick="if(event.target===this)KP.closeModal()">
        <div class="modal-box">
          <div class="modal-hd">
            <div>
              <span class="ex-badge ${isTuntas ? 'ex-badge-ready' : 'ex-badge-bad'}" style="margin-bottom:6px;">
                ${isJustUploaded ? '✓ TUGAS BERHASIL DISIMPAN' : 'DETAIL PENILAIAN'}
              </span>
              <h3>${esc(r.judul)}</h3>
            </div>
            <button type="button" class="close-x" onclick="KP.closeModal()">✕</button>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;background:${isTuntas ? '#EFF6FF' : '#FEF2F2'};border:1.5px solid ${isTuntas ? '#BFDBFE' : '#FECACA'};border-radius:14px;padding:12px 16px;">
            <div>
              <small style="font-weight:700;color:${isTuntas ? 'var(--b)' : 'var(--r)'};display:block;">
                ${isTuntas ? 'Tuntas (Melampaui KKM ' + S.kktp + ')' : 'Di Bawah KKM (' + S.kktp + ')'}
              </small>
              <span class="mu" style="font-size:12px;">
                ${r.remed != null ? `Nilai Awal: ${fm(r.nilai)} → Remedial: ${fm(r.remed)}` : 'Nilai Efektif Tercatat'}
              </span>
            </div>
            <div style="font-size:32px;font-weight:800;color:${isTuntas ? 'var(--b)' : 'var(--r)'};">
              ${fm(nilaiAkhir)}
            </div>
          </div>

          <div class="summary-box">
            <div class="summary-row">
              <span>Mata Pelajaran</span>
              <b>${esc(r.mapel)}</b>
            </div>
            <div class="summary-row">
              <span>Fase & Semester</span>
              <b>Fase ${esc(r.fase)} · Semester ${r.sem}</b>
            </div>
            <div class="summary-row">
              <span>Kategori</span>
              <b>${esc(r.kat)}${r.sub ? ' · ' + esc(r.sub) : ''}</b>
            </div>
            <div class="summary-row">
              <span>Tanggal Tugas</span>
              <b>${esc(formatTanggalID(r.tgl))}</b>
            </div>
            <div class="summary-row">
              <span>Waktu Upload</span>
              <b>${esc(waktuCatat)}</b>
            </div>
            <div class="summary-row">
              <span>Rata-rata Mapel (Sem ${r.sem})</span>
              <b>${fm(rataMapel)}</b>
            </div>
          </div>

          <div style="display:flex;gap:8px;">
            <button type="button" class="bt bt-soft" style="flex:1;" onclick="KP.closeModal()">
              ${isJustUploaded ? '+ Input Lagi' : 'Tutup'}
            </button>
            <button type="button" class="bt bt-blue" style="flex:1;" onclick="KP.jumpToRekapMapel('${r.fase}','${esc(r.mapel)}')">
              Lihat di Rekap
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function jumpToRekapMapel(fase, mapel) {
    closeModal();
    RT = fase;
    OP.add(mapel);
    go('rekap');
  }

  function openEditGradeModal(id) {
    const r = D.find((x) => x.id === id);
    if (!r) return;

    if (r.fase === 'E') {
      $('#modal-root').innerHTML = `
        <div class="modal-bg" onclick="if(event.target===this)KP.closeModal()">
          <div class="modal-box">
            <div class="modal-hd">
              <h3>Edit Rapor: ${esc(r.mapel)}</h3>
              <button type="button" class="close-x" onclick="KP.closeModal()">✕</button>
            </div>
            <form class="fm" onsubmit="KP.saveEditedGrade(event, '${r.id}')">
              <label>Semester Rapor
                <input type="text" value="Semester ${r.sem} (Fase E)" disabled style="background:#F1F5F9;color:#64748B;">
              </label>
              <label>Nilai Rapor (0–100)
                <input name="nilai" type="number" min="0" max="100" step="any" inputmode="decimal" required value="${r.nilai}">
              </label>
              <label>Nilai Remedial (Kosongkan jika tidak ada)
                <input name="remed" type="number" min="0" max="100" step="any" inputmode="decimal" value="${r.remed ?? ''}" placeholder="Opsional">
              </label>
              <div style="display:flex;gap:8px;margin-top:4px;">
                <button type="button" class="bt bt-gray" style="flex:1;" onclick="KP.closeModal()">Batal</button>
                <button type="submit" class="bt bt-blue" style="flex:1;">Simpan Perubahan</button>
              </div>
            </form>
          </div>
        </div>
      `;
      return;
    }

    const hasSub = !!KATS[r.kat];
    const subOpts = hasSub ? KATS[r.kat] : [];

    $('#modal-root').innerHTML = `
      <div class="modal-bg" onclick="if(event.target===this)KP.closeModal()">
        <div class="modal-box">
          <div class="modal-hd">
            <h3>Edit Informasi Tugas</h3>
            <button type="button" class="close-x" onclick="KP.closeModal()">✕</button>
          </div>
          <form class="fm" onsubmit="KP.saveEditedGrade(event, '${r.id}')">
            <label>Semester
              <select name="sem">${op([3, 4, 5], r.sem)}</select>
            </label>
            <label>Tanggal Tugas
              <input type="date" name="tgl" required value="${esc(r.tgl || new Date().toISOString().slice(0, 10))}">
            </label>
            <label>Mata Pelajaran
              <select name="mapel">${op(FF, r.mapel)}</select>
            </label>
            <label>Kategori
              <select name="kat" onchange="KP.ksEdit(this.value)">${op(Object.keys(KATS), r.kat)}</select>
            </label>
            <label id="edit-sl"${hasSub ? '' : ' hidden'}>Sub-Kategori
              <select name="sub" id="edit-sub"${hasSub ? ' required' : ''}>${op(subOpts, r.sub)}</select>
            </label>
            <label>Judul Tugas / Penilaian
              <input name="judul" required maxlength="60" value="${esc(r.judul)}">
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <label>Nilai Awal (0–100)
                <input name="nilai" type="number" min="0" max="100" step="any" inputmode="decimal" required value="${r.nilai}">
              </label>
              <label>Remedial (Opsional)
                <input name="remed" type="number" min="0" max="100" step="any" inputmode="decimal" value="${r.remed ?? ''}" placeholder="-">
              </label>
            </div>
            <div style="display:flex;gap:8px;margin-top:4px;">
              <button type="button" class="bt bt-gray" style="flex:1;" onclick="KP.closeModal()">Batal</button>
              <button type="submit" class="bt bt-blue" style="flex:1;">Simpan Perubahan</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  async function saveEditedGrade(e, id) {
    e.preventDefault();
    const r = D.find((x) => x.id === id);
    if (!r) return;
    const f = e.target.elements;
    const nilai = +f.nilai.value;
    if (!(nilai >= 0 && nilai <= 100)) return toast('Nilai harus 0–100');

    const remedRaw = f.remed.value.trim();
    let remed = null;
    if (remedRaw !== '') {
      remed = parseFloat(remedRaw.replace(',', '.'));
      if (!(remed >= 0 && remed <= 100)) return toast('Nilai remedial harus 0–100');
    }

    if (r.fase === 'E') {
      r.nilai = nilai;
      r.remed = remed;
    } else {
      const kat = f.kat.value;
      r.sem = +f.sem.value;
      r.tgl = f.tgl.value;
      r.mapel = f.mapel.value;
      r.kat = kat;
      r.sub = KATS[kat] ? f.sub.value : '';
      r.judul = f.judul.value.trim();
      r.nilai = nilai;
      r.remed = remed;
      OP.add(r.mapel);
    }

    await idbPut('grades', r);
    syncPush(true);
    closeModal();
    go(T, 1);
    toast('Informasi tugas berhasil diperbarui ✓');
  }

  function confirmDeleteGrade(id) {
    const r = D.find((x) => x.id === id);
    if (!r) return;

    $('#modal-root').innerHTML = `
      <div class="modal-bg" onclick="if(event.target===this)KP.closeModal()">
        <div class="modal-box" style="text-align:center;">
          <div style="width:52px;height:52px;border-radius:50%;background:#FEF2F2;color:var(--r);font-size:24px;font-weight:800;display:grid;place-items:center;margin:0 auto 12px;">
            ⚠️
          </div>
          <h3 style="font-size:18px;margin-bottom:6px;">Hapus Data Nilai?</h3>
          <p class="mu" style="line-height:1.5;margin-bottom:16px;">
            Apakah kamu yakin ingin menghapus <b>"${esc(r.judul)}"</b> (${esc(r.mapel)} · Nilai <b>${fm(ef(r))}</b>)?<br>
            Data yang dihapus tidak dapat dikembalikan.
          </p>
          <div style="display:flex;gap:8px;">
            <button type="button" class="bt bt-gray" style="flex:1;" onclick="KP.closeModal()">Batal</button>
            <button type="button" class="bt bt-red-solid" style="flex:1;" onclick="KP.deleteGrade('${r.id}')">Ya, Hapus</button>
          </div>
        </div>
      </div>
    `;
  }

  async function deleteGrade(id) {
    const idx = D.findIndex((x) => x.id === id);
    if (idx === -1) return;
    D.splice(idx, 1);
    await idbDelete('grades', id);
    syncPush(true);
    closeModal();
    go(T, 1);
    toast('Data nilai berhasil dihapus ✓');
  }

  /* =========================================================
     MODAL TAMBAH SOAL (AKUMULATIF + HAPUS PER SOAL) & PILIH MODE
     ========================================================= */
  function openAddModal(mapelId) {
    const j = JADWAL_ASAS.find((x) => x.id === mapelId);
    const currentSoal = BANKS[mapelId]?.soal || [];
    const existingCount = currentSoal.length;

    $('#modal-root').innerHTML = `
      <div class="modal-bg" onclick="if(event.target===this)KP.closeModal()">
        <div class="modal-box">
          <div class="modal-hd">
            <h3>+ Tambahkan Soal: ${esc(j.mapel)}</h3>
            <button type="button" class="close-x" onclick="KP.closeModal()">✕</button>
          </div>
          <p class="mu" style="margin-bottom:10px;">
            Soal baru akan <b>ditambahkan</b> ke bank soal yang sudah ada (saat ini: <b>${existingCount} soal</b>). Soal kembar otomatis dilewati.
          </p>
          <div style="display:flex;gap:8px;margin-bottom:10px;">
            <label class="bt bt-soft" style="flex:1;cursor:pointer;">
              Pilih File .JSON
              <input type="file" id="up-json-file" accept=".json,application/json" hidden>
            </label>
            ${existingCount > 0 ? `<button type="button" class="bt bt-danger" onclick="KP.clearBank('${mapelId}')">Reset Semua</button>` : ''}
          </div>
          <textarea id="up-json-txt" rows="6" placeholder='Tempel JSON soal di sini: {"soal":[{"nomor":1,"materi":"Bab 1","pertanyaan":"...","opsi":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"kunci":"A","pembahasan":"..."}]}'></textarea>
          <div id="up-json-err" style="color:var(--r);font-size:12px;font-weight:700;margin-top:6px;"></div>
          <button type="button" class="bt" style="width:100%;margin-top:10px;" onclick="KP.saveAddedQuestions('${mapelId}')">
            Tambahkan ke Bank Soal
          </button>

          ${existingCount > 0 ? `
            <div class="q-bank-list">
              <b style="font-size:13px;">Daftar Soal Tersimpan (${existingCount}):</b>
              ${currentSoal.map((sq, idx) => `
                <div class="q-bank-item">
                  <div style="min-width:0;flex:1;">
                    <b style="color:var(--b);">#${idx + 1}</b> · <span class="mu" style="font-size:11px;">${esc(sq.materi || 'Umum')}</span>
                    <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">
                      ${esc(sq.pertanyaan_inti || sq.pertanyaan)}
                    </div>
                  </div>
                  <button type="button" onclick="KP.deleteSingleQuestion('${mapelId}', ${idx})">Hapus</button>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;

    $('#up-json-file').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => { $('#up-json-txt').value = ev.target.result; };
      r.readAsText(f);
    };
  }

  async function deleteSingleQuestion(mapelId, qIdx) {
    const list = BANKS[mapelId]?.soal;
    if (!list || !list[qIdx]) return;
    if (!confirm(`Apakah kamu yakin ingin menghapus soal nomor ${qIdx + 1} ini?`)) return;
    list.splice(qIdx, 1);
    BANKS[mapelId] = { id: mapelId, soal: list };
    await idbPut('banks', BANKS[mapelId]);
    syncPush(true);
    go('exam', 1);
    openAddModal(mapelId);
    toast('Soal dihapus dari bank ✓');
  }

  async function saveAddedQuestions(mapelId) {
    const raw = $('#up-json-txt').value.replace(/^\uFEFF/, '').trim();
    const err = $('#up-json-err');
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed.soal;
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error('JSON harus berisi daftar "soal" yang tidak kosong.');
      }

      const validNew = list.map(normalizeQuestion).filter(Boolean);

      if (validNew.length === 0) {
        throw new Error('Tidak ditemukan soal pilihan ganda (wajib punya pertanyaan, opsi A–E, dan kunci).');
      }

      const currentList = BANKS[mapelId]?.soal ? [...BANKS[mapelId].soal] : [];
      const seen = new Set(currentList.map((s) => String(s.pertanyaan_inti || s.pertanyaan).trim()));
      let addedCount = 0;

      validNew.forEach((s) => {
        const sig = String(s.pertanyaan_inti || s.pertanyaan).trim();
        if (!seen.has(sig)) {
          seen.add(sig);
          currentList.push(s);
          addedCount += 1;
        }
      });

      BANKS[mapelId] = { id: mapelId, soal: currentList };
      await idbPut('banks', BANKS[mapelId]);
      syncPush(true);
      closeModal();
      go('exam', 1);
      toast(`+${addedCount} soal baru ditambahkan (Total: ${currentList.length} soal)`);
    } catch (ex) {
      err.textContent = 'Gagal: ' + ex.message;
    }
  }

  async function clearBank(mapelId) {
    if (!confirm('Apakah kamu yakin ingin menghapus seluruh bank soal pada mata pelajaran ini?')) return;
    BANKS[mapelId] = { id: mapelId, soal: [] };
    await idbPut('banks', BANKS[mapelId]);
    syncPush(true);
    closeModal();
    go('exam', 1);
    toast('Bank soal dikosongkan.');
  }

  function openModePopup(mapelId) {
    const j = JADWAL_ASAS.find((x) => x.id === mapelId);
    const total = BANKS[mapelId]?.soal?.length || 0;

    $('#modal-root').innerHTML = `
      <div class="modal-bg" onclick="if(event.target===this)KP.closeModal()">
        <div class="modal-box">
          <div class="modal-hd">
            <h3>${esc(j.mapel)} (${total} Soal)</h3>
            <button type="button" class="close-x" onclick="KP.closeModal()">✕</button>
          </div>
          <p class="mu" style="margin-bottom:12px;">Pilih mode pengerjaan yang kamu inginkan:</p>

          <div class="mode-choice" onclick="KP.triggerExamCountdown('${mapelId}')">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <b style="color:var(--b);font-size:15px;">⏱️ Mode Ujian (Simulasi ASAS)</b>
              <span class="ex-badge ex-badge-ready">${j.menit} Menit</span>
            </div>
            <p class="mu" style="margin-top:4px;">Mengerjakan seluruh ${total} soal dengan timer mundur & tombol ragu-ragu seperti ujian asli.</p>
          </div>

          <div class="mode-choice quiz" onclick="KP.openQuizSetup('${mapelId}')">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <b style="color:#EA580C;font-size:15px;">⚡ Mode Kuis Acak</b>
              <span class="ex-badge ex-badge-quiz">Tanpa Timer</span>
            </div>
            <p class="mu" style="margin-top:4px;">Pilih jumlah soal acak dan bab materi yang ingin diujikan. Pembahasan langsung muncul.</p>
          </div>
        </div>
      </div>
    `;
  }

  function triggerExamCountdown(mapelId) {
    const j = JADWAL_ASAS.find((x) => x.id === mapelId);
    let sec = 5;

    $('#modal-root').innerHTML = `
      <div class="modal-bg">
        <div class="modal-box" style="text-align:center;">
          <span class="ex-badge ex-badge-ready">PERSIAPAN UJIAN ASAS</span>
          <h3 style="margin-top:10px;font-size:18px;">${esc(j.mapel)}</h3>
          <p class="mu" style="margin-top:4px;">Ujian akan dimulai dalam</p>
          <div class="cd-circle" id="cd-num">5</div>
          <p class="mu" style="margin-bottom:14px;">Durasi: <b>${j.menit} menit</b> · Jangan keluar halaman saat timer berjalan.</p>
          <button type="button" class="bt bt-soft" style="width:100%;" onclick="KP.closeModal()">Batal</button>
        </div>
      </div>
    `;

    countdownId = setInterval(() => {
      sec -= 1;
      const numEl = $('#cd-num');
      if (numEl) numEl.textContent = sec > 0 ? sec : 'Mulai!';
      if (sec <= 0) {
        clearInterval(countdownId);
        countdownId = null;
        closeModal();
        startSession(mapelId, 'UJIAN', '__ALL__', BANKS[mapelId].soal.length);
      }
    }, 1000);
  }

  function openQuizSetup(initialMapelId) {
    let selMapel = initialMapelId;
    let selBab = '__ALL__';
    let selCount = 10;

    function drawSetup() {
      const availableMapels = JADWAL_ASAS.filter((m) => (BANKS[m.id]?.soal?.length || 0) > 0);
      const pool = BANKS[selMapel]?.soal || [];
      const babs = [...new Set(pool.map((s) => s.materi || 'Materi Umum'))];
      if (selBab !== '__ALL__' && !babs.includes(selBab)) selBab = '__ALL__';

      const filtered = selBab === '__ALL__' ? pool : pool.filter((s) => (s.materi || 'Materi Umum') === selBab);
      const maxDraw = filtered.length;

      $('#modal-root').innerHTML = `
        <div class="modal-bg" onclick="if(event.target===this)KP.closeModal()">
          <div class="modal-box">
            <div class="modal-hd">
              <h3>Pengaturan Mode Kuis</h3>
              <button type="button" class="close-x" onclick="KP.closeModal()">✕</button>
            </div>
            <div class="fm">
              <label>Pilih Pelajaran
                <select id="qz-mapel">
                  ${availableMapels.map((m) => `<option value="${m.id}"${m.id === selMapel ? ' selected' : ''}>${esc(m.mapel)} (${BANKS[m.id].soal.length} Soal)</option>`).join('')}
                </select>
              </label>
              <label>Pilih Bab / Materi
                <select id="qz-bab">
                  <option value="__ALL__"${selBab === '__ALL__' ? ' selected' : ''}>Semua Bab / Campuran (${pool.length} Soal)</option>
                  ${babs.map((b) => `<option value="${esc(b)}"${b === selBab ? ' selected' : ''}>${esc(b)}</option>`).join('')}
                </select>
              </label>
              <label>Mau Berapa Soal?
                <div class="tb" style="margin-top:2px;">
                  ${[5, 10, 15, 20].map((n) => `
                    <button type="button" class="pl${selCount === n ? ' on' : ''}" data-qn="${n}">${n} Soal</button>
                  `).join('')}
                </div>
              </label>
              <button type="button" class="bt" id="qz-go" ${maxDraw === 0 ? 'disabled' : ''}>
                Mulai Kuis (${Math.min(selCount, maxDraw)} Soal Acak)
              </button>
            </div>
          </div>
        </div>
      `;

      $('#qz-mapel').onchange = (e) => { selMapel = e.target.value; selBab = '__ALL__'; drawSetup(); };
      $('#qz-bab').onchange = (e) => { selBab = e.target.value; drawSetup(); };
      document.querySelectorAll('[data-qn]').forEach((b) => {
        b.onclick = () => { selCount = +b.dataset.qn; drawSetup(); };
      });
      $('#qz-go').onclick = () => {
        closeModal();
        startSession(selMapel, 'KUIS', selBab, selCount);
      };
    }

    drawSetup();
  }

  /* =========================================================
     LAYAR PENGERJAAN UJIAN ASAS & MODE KUIS
     ========================================================= */
  function startSession(mapelId, mode, babKey, count) {
    const j = JADWAL_ASAS.find((x) => x.id === mapelId);
    const pool = BANKS[mapelId]?.soal || [];
    const filtered = babKey === '__ALL__' ? pool : pool.filter((s) => (s.materi || 'Materi Umum') === babKey);
    if (filtered.length === 0) return toast('Tidak ada soal untuk pilihan ini.');

    const questions = mode === 'KUIS'
      ? shuffleArray(filtered).slice(0, Math.min(count, filtered.length))
      : filtered.slice();

    const totalSec = j.menit * 60;
    cbtSession = {
      mapelId,
      mapel: j.mapel,
      mode,
      babKey,
      requestedCount: count,
      materiLabel: babKey === '__ALL__' ? 'Semua Bab' : babKey,
      soal: questions,
      idx: 0,
      ans: {},
      ragu: {},
      totalSec,
      remSec: totalSec
    };

    renderCbtScreen();

    if (timerId) clearInterval(timerId);
    if (mode === 'UJIAN') {
      timerId = setInterval(() => {
        if (!cbtSession) return;
        cbtSession.remSec -= 1;
        const p = $('#cbt-timer');
        const h = $('#cbt-hd');
        if (p) p.textContent = formatHMS(cbtSession.remSec);
        if (h) {
          h.classList.remove('warn', 'danger');
          if (cbtSession.remSec < 120) h.classList.add('danger');
          else if (cbtSession.remSec < 600) h.classList.add('warn');
        }
        if (cbtSession.remSec <= 0) {
          clearInterval(timerId);
          finishSession(true);
        }
      }, 1000);
    }
  }

  function renderCbtScreen() {
    const s = cbtSession;
    const q = s.soal[s.idx];
    const isQuiz = s.mode === 'KUIS';
    const picked = s.ans[s.idx] || null;
    const key = String(q.kunci || '').trim().toUpperCase();
    const isRagu = !!s.ragu[s.idx];

    let stimHTML = '';
    let qText = q.pertanyaan || '';
    if (q.stimulus && q.stimulus.trim()) {
      if (qText.startsWith(q.stimulus.trim()) && q.pertanyaan_inti) {
        stimHTML = `<div class="stim-box">${esc(q.stimulus)}</div>`;
        qText = q.pertanyaan_inti;
      } else if (!qText.includes(q.stimulus.trim())) {
        stimHTML = `<div class="stim-box">${esc(q.stimulus)}</div>`;
      }
    }

    const opts = ['A', 'B', 'C', 'D', 'E'].filter((k) => q.opsi && q.opsi[k] !== undefined);
    const optsHTML = opts.map((k) => {
      let cls = 'opt-btn';
      if (isQuiz && picked) {
        if (k === key) cls += ' ok';
        else if (k === picked) cls += ' no';
      } else if (picked === k) {
        cls += ' sel';
      }
      return `
        <button type="button" class="${cls}" onclick="KP.pickOpt('${k}')" ${isQuiz && picked ? 'disabled' : ''}>
          <span class="opt-k">${k}</span>
          <span>${esc(q.opsi[k])}</span>
        </button>
      `;
    }).join('');

    let quizFeedback = '';
    if (isQuiz && picked) {
      const ok = picked === key;
      quizFeedback = `
        <div style="margin-top:10px;padding:12px;border-radius:12px;background:${ok ? '#EFF6FF' : '#FEF2F2'};border:1.5px solid ${ok ? '#93C5FD' : '#FCA5A5'};">
          <b style="color:${ok ? 'var(--b)' : 'var(--r)'};font-size:13px;">
            ${ok ? '✓ Jawaban Tepat!' : `✕ Kurang Tepat (Kunci: ${esc(key)})`}
          </b>
          ${q.pembahasan ? `<p style="font-size:13px;margin-top:4px;line-height:1.5;"><b>Pembahasan:</b> ${esc(q.pembahasan)}</p>` : ''}
        </div>
      `;
    }

    const gridHTML = s.soal.map((item, i) => {
      let cls = 'num-btn';
      const a = s.ans[i];
      if (isQuiz && a) {
        cls += a === String(item.kunci || '').trim().toUpperCase() ? ' ans' : ' wrong';
      } else if (!isQuiz) {
        if (s.ragu[i]) cls += ' ragu';
        else if (a) cls += ' ans';
      }
      if (i === s.idx) cls += ' cur';
      return `<button type="button" class="${cls}" onclick="KP.jumpQ(${i})">${i + 1}</button>`;
    }).join('');

    $('#cbt-root').innerHTML = `
      <div class="cbt-screen">
        <div id="cbt-hd" class="cbt-hd ${isQuiz ? 'quiz' : ''}">
          <div>
            <small style="opacity:.85;font-weight:700;font-size:11px;">${isQuiz ? 'MODE KUIS ACAK' : 'SIMULASI UJIAN ASAS'}</small>
            <div style="font-weight:800;font-size:15px;">${esc(s.mapel)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${!isQuiz ? `<div id="cbt-timer" class="timer-pill">${formatHMS(s.remSec)}</div>` : ''}
            <button type="button" class="timer-pill" style="cursor:pointer;padding:6px 11px;" onclick="KP.abortSession()" title="Keluar">✕</button>
          </div>
        </div>

        <div class="cbt-body">
          <div class="c" style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
              <span class="ex-badge ${isQuiz ? 'ex-badge-quiz' : 'ex-badge-ready'}">No. ${s.idx + 1} / ${s.soal.length}</span>
              <small class="mu">${esc(q.materi || s.materiLabel)}</small>
            </div>
            ${stimHTML}
            <div class="q-text">${esc(qText)}</div>
            ${optsHTML}
            ${quizFeedback}
          </div>

          <div class="c">
            <small class="mu" style="display:block;font-weight:700;margin-bottom:8px;">Navigasi Nomor:</small>
            <div class="num-grid">${gridHTML}</div>
          </div>
        </div>

        <div class="cbt-ft">
          <button type="button" class="bt bt-soft" onclick="KP.jumpQ(${s.idx - 1})" ${s.idx === 0 ? 'disabled' : ''}>← Prev</button>
          ${!isQuiz ? `<button type="button" class="bt bt-ragu ${isRagu ? 'on' : ''}" onclick="KP.togRagu()">${isRagu ? '★ Ragu' : '☆ Ragu'}</button>` : ''}
          ${s.idx < s.soal.length - 1
            ? `<button type="button" class="bt bt-blue" onclick="KP.jumpQ(${s.idx + 1})">Next →</button>`
            : `<button type="button" class="bt" onclick="KP.confirmFinish()">Selesai</button>`
          }
        </div>
      </div>
    `;
  }

  async function finishSession(autoTimeout) {
    if (!cbtSession) return;
    if (timerId) { clearInterval(timerId); timerId = null; }

    const s = cbtSession;
    const isQuiz = s.mode === 'KUIS';
    const total = s.soal.length;
    let benar = 0;

    s.soal.forEach((item, i) => {
      const a = (s.ans[i] || '').toUpperCase();
      const k = String(item.kunci || '').trim().toUpperCase();
      if (a && a === k) benar += 1;
    });

    const skor = Number(((benar / total) * 100).toFixed(1));
    const usedSec = s.totalSec - Math.max(0, s.remSec);

    const record = {
      id: 'H' + Date.now(),
      mode: s.mode,
      mapel: s.mapel,
      materi: s.materiLabel,
      skor,
      benar,
      total,
      durasi: isQuiz ? 'Kuis Acak' : formatHMS(usedSec),
      tanggal: new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    };

    HISTORY.unshift(record);
    await idbPut('history', record);
    syncPush(true);

    const reviewHTML = s.soal.map((item, i) => {
      const uAns = s.ans[i] || '-';
      const kAns = String(item.kunci || '').trim().toUpperCase();
      const ok = uAns === kAns;
      return `
        <div class="c" style="border-left:4px solid ${ok ? 'var(--b)' : 'var(--r)'};margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:800;margin-bottom:6px;">
            <span>No. ${i + 1}</span>
            <span style="color:${ok ? 'var(--b)' : 'var(--r)'};">${ok ? '✓ BENAR' : '✕ SALAH'}</span>
          </div>
          <p style="font-size:13px;font-weight:700;margin-bottom:6px;white-space:pre-line;">${esc(item.pertanyaan_inti || item.pertanyaan)}</p>
          <small class="mu">Jawabanmu: <b>${esc(uAns)}</b> · Kunci: <b style="color:var(--b);">${esc(kAns)}</b></small>
          ${item.pembahasan ? `<div style="margin-top:8px;background:#FEFCE8;border:1px solid #FDE047;border-radius:10px;padding:9px;font-size:12px;color:#713F12;"><b>Pembahasan:</b> ${esc(item.pembahasan)}</div>` : ''}
        </div>
      `;
    }).join('');

    $('#cbt-root').innerHTML = `
      <div class="cbt-screen">
        <div class="cbt-hd ${isQuiz ? 'quiz' : ''}">
          <div>
            <small style="opacity:.85;">HASIL ${s.mode} ${autoTimeout ? '(WAKTU HABIS)' : ''}</small>
            <div style="font-weight:800;font-size:15px;">${esc(s.mapel)}</div>
          </div>
          <button type="button" class="bt" style="padding:8px 16px;background:#fff;color:${isQuiz ? '#EA580C' : 'var(--b)'};" onclick="KP.closeSession()">Tutup</button>
        </div>
        <div class="cbt-body">
          <div class="c" style="text-align:center;background:${isQuiz ? 'linear-gradient(135deg,var(--o),#EA580C)' : 'linear-gradient(160deg,var(--b),var(--b2))'};color:#fff;margin-bottom:14px;">
            <small style="opacity:.9;font-weight:700;">SKOR AKHIR ${isQuiz ? '· ' + esc(s.materiLabel) : ''}</small>
            <div style="font-size:44px;font-weight:800;margin:4px 0;">${skor}</div>
            <div style="font-size:13px;">Benar <b>${benar}</b> · Salah/Kosong <b>${total - benar}</b> · ${esc(record.durasi)}</div>
            ${isQuiz ? `
              <button type="button" class="bt" style="margin-top:12px;background:#FEFCE8;color:#854D0E;padding:9px 18px;font-size:13px;" onclick="KP.replayQuiz()">
                ↻ Main Lagi (${s.requestedCount} Soal Acak Baru)
              </button>
            ` : ''}
          </div>
          <b style="display:block;margin-bottom:10px;">Pembahasan Lengkap</b>
          ${reviewHTML}
        </div>
      </div>
    `;
  }

  /* =========================================================
     NAVIGATION & GLOBAL ACTIONS
     ========================================================= */
  function go(t, keep) {
    T = t;
    CH.forEach((c) => c.destroy());
    CH = [];
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.t === T));
    $('#ttl').textContent = {
      home: `Halo, ${S.nama}! 👋`,
      rekap: 'Rekap Mapel',
      up: 'Input Nilai',
      gr: 'Grafik Nilai',
      exam: 'Exam & Kuis',
      set: 'Pengaturan'
    }[T];
    $('#v').innerHTML = V[T]();
    if (AF[T]) AF[T]();
    if (!keep) window.scrollTo(0, 0);
  }

  window.KP = {
    go,
    setRT: (v) => { RT = v; go('rekap', 1); },
    setUT: (v) => { UT = v; go('up', 1); },
    setRS: (v) => { RS = v; go('up', 1); },
    setExTab: (v) => { EX_TAB = v; go('exam', 1); },
    tog: (m, open) => { open ? OP.add(m) : OP.delete(m); },
    dc,
    ks: (k) => {
      const s = $('[name=sub]');
      s.innerHTML = op(KATS[k] || []);
      s.required = !!KATS[k];
      $('#sl').hidden = !KATS[k];
    },
    ksEdit: (k) => {
      const s = $('#edit-sub');
      const lbl = $('#edit-sl');
      if (!s || !lbl) return;
      s.innerHTML = op(KATS[k] || []);
      s.required = !!KATS[k];
      lbl.hidden = !KATS[k];
    },
    sv: async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const n = +f.nilai.value;
      if (!(n >= 0 && n <= 100)) return toast('Nilai harus 0–100');
      const nowText = new Date().toLocaleDateString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }) + ' WIB';
      const r = {
        id: 'S' + Date.now() + Math.random().toString(36).slice(2, 6),
        fase: 'F',
        sem: +f.sem.value,
        tgl: f.tgl.value,
        mapel: f.mapel.value,
        kat: f.kat.value,
        sub: KATS[f.kat.value] ? f.sub.value : '',
        judul: f.judul.value.trim(),
        nilai: n,
        remed: null,
        uploadedAt: nowText
      };
      await idbPut('grades', r);
      D.push(r);
      syncPush(true);
      go('up', 1);
      openGradeSummaryModal(r.id, true);
    },
    sr: async () => {
      let countSaved = 0;
      for (const i of document.querySelectorAll('[data-m]')) {
        const m = i.dataset.m;
        const id = `R${RS}-${m}`;
        const existingIdx = D.findIndex((x) => x.id === id);
        if (i.value === '' || isNaN(i.value)) {
          if (existingIdx !== -1) {
            D.splice(existingIdx, 1);
            await idbDelete('grades', id);
          }
          continue;
        }
        const o = existingIdx !== -1 ? D[existingIdx] : null;
        const r = {
          id, fase: 'E', sem: RS, tgl: '', mapel: m,
          kat: 'Rapor', sub: '', judul: `Rapor Sem ${RS}`,
          nilai: Math.min(100, Math.max(0, +i.value)),
          remed: o ? o.remed : null
        };
        await idbPut('grades', r);
        o ? Object.assign(o, r) : D.push(r);
        countSaved += 1;
      }
      syncPush(true);
      toast(`Rapor Sem ${RS} tersimpan (${countSaved} mapel) ✓`);
    },
    rm: async (id) => {
      const r = D.find((x) => x.id === id);
      const v = prompt(`Nilai remedial "${r.judul}" (awal ${r.nilai}):`, r.remed ?? '');
      if (v === null) return;
      const n = parseFloat(v.replace(',', '.'));
      if (!(n >= 0 && n <= 100)) return toast('Nilai harus 0–100');
      r.remed = n;
      await idbPut('grades', r);
      syncPush(true);
      go(T, 1);
      toast('Nilai remedial diperbarui ✓');
    },
    openGradeSummaryModal,
    jumpToRekapMapel,
    openEditGradeModal,
    saveEditedGrade,
    confirmDeleteGrade,
    deleteGrade,
    ss: (e) => {
      e.preventDefault();
      const f = e.target.elements;
      if (f.p1.value === f.p2.value) return toast('Pilih 2 mapel PTN yang berbeda');
      S = {
        nama: f.nama.value.trim(),
        jur: f.jur.value.trim(),
        target: +f.target.value,
        kktp: +f.kktp.value,
        sem: +f.sem.value,
        pins: [f.p1.value, f.p2.value]
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(S));
      syncPush(true);
      toast('Pengaturan tersimpan ✓');
      go('home');
    },
    ex: () => {
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const h = ['Semester', 'Tanggal', 'Fase', 'Mapel', 'Kategori', 'Sub', 'Judul', 'Nilai Awal', 'Remedial', 'Nilai Efektif'].join(';');
      const rows = [...D].sort((a, b) => a.sem - b.sem).map((r) => [r.sem, r.tgl, r.fase, r.mapel, r.kat, r.sub, r.judul, r.nilai, r.remed, ef(r)].map(q).join(';'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff' + [h, ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      a.download = 'nilai-kejar-ptn.csv';
      a.click();
    },
    pt: () => {
      const t = (ms, fa) => `<table><tr><th>Mapel</th><th>Rata-rata</th><th>Jml Nilai</th></tr>${ms.map((m) => {
        const a = mAvg(m, fa);
        return `<tr><td>${esc(m)}</td><td class="${bd(a)}">${fm(a)}</td><td>${rec(m, fa).length}</td></tr>`;
      }).join('')}</table>`;
      $('#pr').innerHTML = `
        <h2>Laporan Nilai — Kejar PTN SMAN 3 Blitar</h2>
        <p>Nama: <b>${esc(S.nama)}</b><br>Target: ${esc(S.jur) || '-'} · Skor SNBP ${S.target} · KKM ${S.kktp}<br>Rata-rata kumulatif: <b>${fm(cum())}</b></p>
        <table><tr><th>Semester</th><th>Rata-rata</th></tr>${[1, 2, 3, 4, 5].map((n) => `<tr><td>Sem ${n}</td><td class="${bd(semAvg(n))}">${fm(semAvg(n))}</td></tr>`).join('')}</table>
        <h3>Fase F (Kelas XI–XII)</h3>${t(FF, 'F')}
        <h3>Fase E (Kelas X)</h3>${t(FE, 'E')}
        <small>Dicetak ${new Date().toLocaleDateString('id-ID')}</small>
      `;
      window.print();
    },
    openAddModal,
    saveAddedQuestions,
    deleteSingleQuestion,
    clearBank,
    closeModal,
    openModePopup,
    triggerExamCountdown,
    openQuizSetup,
    deleteHistory: async (id) => {
      if (!confirm('Apakah kamu yakin ingin menghapus riwayat ini?')) return;
      const idx = HISTORY.findIndex((x) => x.id === id);
      if (idx !== -1) HISTORY.splice(idx, 1);
      await idbDelete('history', id);
      syncPush(true);
      go('exam', 1);
      toast('Riwayat dihapus ✓');
    },
    pickOpt: (k) => {
      if (!cbtSession) return;
      if (cbtSession.mode === 'KUIS' && cbtSession.ans[cbtSession.idx]) return;
      cbtSession.ans[cbtSession.idx] = k;
      renderCbtScreen();
    },
    jumpQ: (i) => {
      if (!cbtSession || i < 0 || i >= cbtSession.soal.length) return;
      cbtSession.idx = i;
      renderCbtScreen();
    },
    togRagu: () => {
      if (!cbtSession) return;
      cbtSession.ragu[cbtSession.idx] = !cbtSession.ragu[cbtSession.idx];
      renderCbtScreen();
    },
    confirmFinish: () => {
      if (!cbtSession) return;
      if (cbtSession.mode === 'KUIS') return finishSession(false);
      const sisa = cbtSession.soal.length - Object.keys(cbtSession.ans).length;
      const msg = sisa > 0 ? `Masih ada ${sisa} soal kosong. Kumpulkan ujian sekarang?` : 'Kumpulkan ujian sekarang?';
      if (confirm(msg)) finishSession(false);
    },
    replayQuiz: () => {
      if (!cbtSession) return;
      const { mapelId, babKey, requestedCount } = cbtSession;
      startSession(mapelId, 'KUIS', babKey, requestedCount);
    },
    abortSession: () => {
      if (!cbtSession) return;
      const msg = cbtSession.mode === 'UJIAN'
        ? 'Batalkan simulasi ujian ini? Progres pengerjaan tidak akan disimpan.'
        : 'Keluar dari sesi kuis ini?';
      if (confirm(msg)) {
        if (timerId) { clearInterval(timerId); timerId = null; }
        cbtSession = null;
        $('#cbt-root').innerHTML = '';
      }
    },
    closeSession: () => {
      if (timerId) { clearInterval(timerId); timerId = null; }
      cbtSession = null;
      $('#cbt-root').innerHTML = '';
      go('exam', 1);
    },
    syncPush,
    syncPull,
    logout: () => {
      if (confirm('Keluar dari akun? Pastikan data sudah di-Sync terlebih dahulu.')) {
        localStorage.removeItem(SESSION_KEY);
        updateSyncPill();
        renderAuthGate();
      }
    }
  };

  /* =========================================================
     INIT APP
     ========================================================= */
  $('#nav').innerHTML = [
    ['home', 'Beranda', '🏠'],
    ['rekap', 'Rekap', '📚'],
    ['up', '', '+'],
    ['gr', 'Grafik', '📈'],
    ['exam', 'Exam', '📝'],
    ['set', 'Setelan', '⚙️']
  ].map(([k, l, i]) => k === 'up'
    ? `<button type="button" class="fab" data-t="up" aria-label="Input nilai"><b>+</b><span>Input Nilai</span></button>`
    : `<button type="button" data-t="${k}"><i>${i}</i>${l}</button>`
  ).join('');

  $('#nav').onclick = (e) => {
    const b = e.target.closest('button');
    if (b) go(b.dataset.t);
  };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  window.addEventListener('online', () => {
    updateSyncPill();
    if (localStorage.getItem(PENDING_SYNC_KEY) === '1') syncPush(true);
  });
  window.addEventListener('offline', updateSyncPill);

  (async function boot() {
    D = await idbGetAll('grades');
    const bankArr = await idbGetAll('banks');
    bankArr.forEach((b) => { BANKS[b.id] = b; });
    HISTORY = (await idbGetAll('history')).sort((a, b) => (b.id || '').localeCompare(a.id || ''));

    await migrateLegacyDataIfNeeded();
    updateSyncPill();

    if (!getSession()) {
      renderAuthGate();
    } else {
      go('home');
      if (localStorage.getItem(PENDING_SYNC_KEY) === '1' && navigator.onLine) {
        syncPush(true);
      }
    }
  })();
})();
