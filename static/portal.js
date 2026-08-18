// ── CONSTANTS ────────────────────────────────────────────────────────────────

const CATS = [
  { id:'lecture',     label:'Lecture / class',     color:'#8B1A1A', bg:'#f5e8e8' },
  { id:'meeting',     label:'Meeting / check-in',  color:'#7B3D8F', bg:'#F3EAF8' },
  { id:'reading',     label:'Reading / prep',      color:'#1D9E75', bg:'#E1F5EE' },
  { id:'homework',    label:'Homework deadline',   color:'#D85A30', bg:'#FAECE7' },
  { id:'application', label:'Application deadline',color:'#A32D2D', bg:'#FCEBEB' },
  { id:'guest',       label:'Guest speaker',       color:'#185FA5', bg:'#E6F1FB' },
  { id:'milestone',   label:'Events',              color:'#BA7517', bg:'#FAEEDA' },
  // CUNY academic calendar, not fellowship programming
  { id:'academic',    label:'CUNY academic date',  color:'#4A5568', bg:'#EDF2F7' },
  { id:'closed',      label:'No classes / closed', color:'#7A7A7A', bg:'#F0F0F0' },
  { id:'general',     label:'Other',               color:'#6b6b6b', bg:'#f4f3f0' },
];
const CAT = {};
CATS.forEach(c => CAT[c.id] = c);

/* Safe lookup: an unrecognised or blank category (e.g. typed straight into
   Airtable) renders as neutral "Other" rather than mislabelling the event. */
function catOf(id) {
  return CAT[id] || CAT.general;
}

const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_SHORT  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const WEEKDAYS    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const ANN_CATS = {
  general:  { label:'General',  border:'#8B1A1A', bg:'#f5e8e8' },
  info:     { label:'Info',     border:'#185FA5', bg:'#E6F1FB' },
  deadline: { label:'Deadline', border:'#D85A30', bg:'#FAECE7' },
  reminder: { label:'Reminder', border:'#BA7517', bg:'#FAEEDA' },
  // backwards compat with old color-named entries
  maroon: { label:'General',  border:'#8B1A1A', bg:'#f5e8e8' },
  blue:   { label:'Info',     border:'#185FA5', bg:'#E6F1FB' },
  orange: { label:'Deadline', border:'#D85A30', bg:'#FAECE7' },
  amber:  { label:'Reminder', border:'#BA7517', bg:'#FAEEDA' },
};

const ROLE_LABELS = {
  admin:       { label:'Admin',       desc:'Full access',                  color:'#8B1A1A', bg:'#f5e8e8' },
  instructor:  { label:'Instructor',  desc:'Announcements & resources', color:'#185FA5', bg:'#E6F1FB' },
  coordinator: { label:'Coordinator', desc:'Events & calendar',               color:'#1D9E75', bg:'#E1F5EE' },
};
const COURSE_LABELS = {
  both:     'Both courses',
  psc31180: 'Year 1 only',
  psc31330: 'Year 2 only',
};

const RESOURCE_CATS = {
  general:  { label:'General',         color:'#6b6b6b' },
  finance:  { label:'Finance & Stipends', color:'#1D9E75' },
  academic: { label:'Academic',         color:'#185FA5' },
  forms:    { label:'Forms & Documents', color:'#D85A30' },
  housing:  { label:'Housing',          color:'#BA7517' },
};

// ── MUTABLE DATA (loaded from the API after sign-in) ──────────────────────────

let ALL_EVENTS    = [];
let announcements = [];
let resources     = [];
let adminUsers    = [];

// Keys match Airtable's Course field values; only labels are display text.
const COURSES = {
  psc31180: {
    id:'psc31180', code:'Year 1',
    title:'Politics, Power, and Policy in New York City',
    location:'SH 107',
    meets:'Mondays & Wednesdays, 3:30–4:45 PM',
    color:'#8B1A1A', bg:'#f5e8e8',
    events:[],
  },
  psc31330: {
    id:'psc31330', code:'Year 2',
    title:'Philanthropy and the Public Good',
    location:'NAC 4/133',
    meets:'Wednesdays, 2:00–4:30 PM',
    color:'#185FA5', bg:'#E6F1FB',
    events:[],
  },
};

// Injected by the server so the term is named in exactly one place.
const CONFIG = window.PORTAL_CONFIG || {};
const SEMESTER = CONFIG.semester || '';


// ── STATE ─────────────────────────────────────────────────────────────────────

let isStudentMode    = false;
let currentRole      = null;
let currentUserName  = '';
let currentFirstName = '';
let activeCourse     = 'all';
let calFilterCourse  = 'all';

// Default calendar to current month
const _now = new Date();
let calYear  = _now.getFullYear();
let calMonth = _now.getMonth();

let panelMode = null, selectedDate = null;
let eventsFilter    = 'all';
let annWeekFilter   = '';
let dashWindow      = 'month'; // 'week' | 'month' | 'all'


// ── DATA TRANSFORMS ───────────────────────────────────────────────────────────

function transformEvent(e) {
  return {
    ...e,
    hidden:    !!e.is_hidden,
    mandatory: !!e.is_mandatory,
    staffOnly: !!e.is_staff_only,
  };
}

function updateCourseEvents() {
  COURSES.psc31180.events = ALL_EVENTS.filter(e => e.course === 'psc31180' || e.course === 'joint');
  COURSES.psc31330.events = ALL_EVENTS.filter(e => e.course === 'psc31330' || e.course === 'joint');
}


// ── API HELPERS ───────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* The host puts this app to sleep when it's idle, and the first request back
   gets the host's own HTML error page rather than our JSON. Detect that and
   retry instead of letting a parse error surface as a dead screen. */
function looksLikeColdStart(status, text) {
  if (status < 500) return false;
  const t = text.trim();
  return !t.startsWith('{') && !t.startsWith('[');
}

function showWakingNotice() {
  const el = document.getElementById('wakingNotice');
  if (el) el.classList.add('visible');
}

function hideWakingNotice() {
  const el = document.getElementById('wakingNotice');
  if (el) el.classList.remove('visible');
}

/* Returns a Response-shaped object. json() never throws — a non-JSON body comes
   back as an { error } object so callers can show a message instead of dying. */
async function api(method, path, body, { retries = 2 } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let status = 0, ok = false, text = '';
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(path, opts);
      status = res.status;
      ok     = res.ok;
      text   = await res.text();
    } catch (networkError) {
      if (attempt >= retries) {
        return {
          ok: false, status: 0,
          json: async () => ({ error: 'Could not reach the server. Check your connection and try again.' }),
        };
      }
      showWakingNotice();
      await sleep(2000 * (attempt + 1));
      continue;
    }

    if (attempt < retries && looksLikeColdStart(status, text)) {
      showWakingNotice();
      await sleep(2500 * (attempt + 1));
      continue;
    }
    break;
  }

  hideWakingNotice();
  return {
    ok, status,
    json: async () => {
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        return { error: 'The server sent an unexpected response. Please try again.' };
      }
    },
  };
}


// ── POST-LOGIN DATA LOADER ────────────────────────────────────────────────────

async function loadPortalData() {
  const [evRes, annRes, resRes] = await Promise.all([
    api('GET', '/api/events'),
    api('GET', '/api/announcements'),
    api('GET', '/api/resources'),
  ]);

  const evData  = await evRes.json();
  const annData = await annRes.json();
  const resData = await resRes.json();

  ALL_EVENTS    = Array.isArray(evData)  ? evData.map(transformEvent) : [];
  announcements = Array.isArray(annData) ? annData : [];
  resources     = Array.isArray(resData) ? resData : [];

  updateCourseEvents();

  if (!isStudentMode) {
    const staffRes  = await api('GET', '/api/staff');
    const staffData = await staffRes.json();
    adminUsers = Array.isArray(staffData) ? staffData.map(u => ({
      id:       u.id,
      name:     u.display_name,
      username: u.username,
      role:     u.role,
      course:   u.course,
      active:   !!u.is_active,
      you:      !!u.you,
    })) : [];
  }
}


// ── AUTH ──────────────────────────────────────────────────────────────────────

function activeLoginErrorEl() {
  const staffCard = document.getElementById('staffLoginCard');
  const staffVisible = staffCard && staffCard.style.display !== 'none';
  return document.getElementById(staffVisible ? 'staffLoginError' : 'loginError');
}

function showLoginError(message) {
  const err = activeLoginErrorEl();
  if (!err) return;
  err.textContent = message;
  err.classList.add('visible');
}

function clearLoginError() {
  ['loginError', 'staffLoginError'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('visible');
  });
}

/* Fellows sign in with a shared access code — no account, nothing stored about
   them. Staff sign in with a username and password. */
async function attemptStudentLogin() {
  const input = document.getElementById('accessCode');
  const code  = input.value.trim();
  clearLoginError();
  if (!code) {
    showLoginError('Enter the access code your program coordinator gave you.');
    input.focus();
    return;
  }
  await finishLogin(await api('POST', '/api/login', { access_code: code }), () => {
    input.value = '';
    input.focus();
  });
}

async function attemptStaffLogin() {
  const userEl = document.getElementById('loginUser');
  const passEl = document.getElementById('loginPass');
  const username = userEl.value.trim().toLowerCase();
  const password = passEl.value;
  clearLoginError();
  if (!username || !password) {
    showLoginError('Enter your staff username and password.');
    return;
  }
  await finishLogin(await api('POST', '/api/login', { username, password }), () => {
    passEl.value = '';
    passEl.focus();
  });
}

async function finishLogin(res, onFailure) {
  const data = await res.json();
  if (!res.ok) {
    showLoginError(data.error || 'Sign-in failed. Please try again.');
    if (onFailure) onFailure();
    return;
  }

  applySession(data);
  await loadPortalData();
  jumpToFirstMonthWithEvents();

  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('portalApp').classList.add('visible');
  showView(isStudentMode ? 'calendar' : 'admin');
}

/* Shared by a fresh sign-in and by restoring an existing session on reload. */
function applySession(data) {
  currentRole      = data.role;
  isStudentMode    = !data.is_staff;
  currentUserName  = data.display || 'Fellow';
  currentFirstName = currentUserName.split(' ')[0];

  const nameEl = document.getElementById('userName');
  if (nameEl) nameEl.textContent = currentUserName;
  const avatarEl = document.getElementById('userAvatar');
  if (avatarEl) avatarEl.textContent = data.initials || (isStudentMode ? '◆' : '');
  const dropName = document.getElementById('dropdownName');
  if (dropName) dropName.textContent = currentUserName;
  const dropRole = document.getElementById('dropdownRole');
  if (dropRole) dropRole.textContent = isStudentMode ? 'Fellow' : 'Program staff';

  document.body.classList.toggle('student-mode', isStudentMode);
  const addBtn = document.getElementById('panelAddBtn');
  if (addBtn) addBtn.style.display = isStudentMode ? 'none' : '';
}

function showStaffLogin() {
  clearLoginError();
  document.getElementById('studentLoginCard').style.display = 'none';
  document.getElementById('staffLoginCard').style.display   = '';
  const hint = document.getElementById('loginHint');
  if (hint) hint.style.display = 'none';
  document.getElementById('loginUser').focus();
}

function showStudentLogin() {
  clearLoginError();
  document.getElementById('staffLoginCard').style.display   = 'none';
  document.getElementById('studentLoginCard').style.display = '';
  const hint = document.getElementById('loginHint');
  if (hint) hint.style.display = '';
  document.getElementById('accessCode').focus();
}

async function logout() {
  await api('POST', '/api/logout');
  currentRole   = null;
  isStudentMode = false;
  ALL_EVENTS    = [];
  announcements = [];
  resources     = [];
  adminUsers    = [];
  updateCourseEvents();
  ['accessCode', 'loginUser', 'loginPass'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  clearLoginError();
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('portalApp').classList.remove('visible');
  document.body.classList.remove('student-mode');
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.subnav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.querySelectorAll('.subnav-link').forEach(l => {
    if (l.getAttribute('onclick') && l.getAttribute('onclick').includes("'"+name+"'"))
      l.classList.add('active');
  });
  if (name === 'calendar')  renderCalendar();
  if (name === 'dashboard') renderDashboard();
  if (name === 'resources') renderResources();
  if (name === 'about')     renderAbout();
  if (name === 'admin') {
    renderAdminAnnouncements();
    renderAdminEvents('all');
    const c  = COURSES[activeCourse] || COURSES.psc31180;
    const el = document.getElementById('adminCourseIndicator');
    if (el) el.innerHTML = `${c.code} &mdash; ${c.title}`;
  }
  window.scrollTo(0,0);
}


// ── COURSE SWITCHER ───────────────────────────────────────────────────────────

function switchCourse(id) {
  activeCourse    = id;
  calFilterCourse = id;
  document.querySelectorAll('.syl-course-btn').forEach(b => b.classList.remove('active'));
  const inlineBtn = document.getElementById('syl-tab-' + id);
  if (inlineBtn) inlineBtn.classList.add('active');
  renderDashboard();
  if (document.getElementById('view-calendar').classList.contains('active')) renderCalendar();
}


// ── DASHBOARD ─────────────────────────────────────────────────────────────────

function getActiveCourseData() {
  if (activeCourse === 'all') return { events: ALL_EVENTS, course: null };
  const c = COURSES[activeCourse];
  return { events: c.events, course: c };
}

function renderDashboard() {
  const { events: courseEvents, course } = getActiveCourseData();

  renderDashboardAnnouncements();

  const metaEl = document.querySelector('#view-dashboard .page-hero-meta');
  if (metaEl) {
    if (course) metaEl.textContent = `${course.code} — ${course.title}`;
    else        metaEl.textContent = `All courses — ${SEMESTER}`;
  }
  const h1El = document.querySelector('#view-dashboard h1');
  if (h1El) {
    if (isStudentMode) {
      h1El.innerHTML = `Welcome, <strong>${currentFirstName}.</strong><br>${course ? course.title : SEMESTER}`;
    } else if (course) {
      h1El.innerHTML = `Welcome, <strong>${currentFirstName}.</strong><br>${course.title}`;
    } else {
      h1El.innerHTML = `All <strong>courses</strong><br>${SEMESTER} overview`;
    }
  }

  const today = new Date();
  today.setHours(0,0,0,0);

  // Build "What's due" window toggle
  const windowEl = document.getElementById('dashWindowToggle');
  if (windowEl) {
    windowEl.innerHTML = ['week','month','all'].map(w =>
      `<button class="dash-window-btn${dashWindow===w?' active':''}" onclick="setDashWindow('${w}')">${w==='week'?'This week':w==='month'?'This month':'All upcoming'}</button>`
    ).join('');
  }

  const DELIVERABLE_CATS = new Set(['homework','milestone','application']);
  let dueSoon = courseEvents
    .filter(e => DELIVERABLE_CATS.has(e.cat))
    .sort((a,b) => a.date.localeCompare(b.date));

  // Apply time window filter
  const endDate = new Date(today);
  if (dashWindow === 'week')  endDate.setDate(endDate.getDate() + 7);
  if (dashWindow === 'month') endDate.setDate(endDate.getDate() + 31);
  if (dashWindow !== 'all') {
    dueSoon = dueSoon.filter(e => {
      const [yr,mo,dy] = e.date.split('-').map(Number);
      const d = new Date(yr, mo-1, dy);
      return d >= today && d <= endDate;
    });
  } else {
    dueSoon = dueSoon.filter(e => {
      const [yr,mo,dy] = e.date.split('-').map(Number);
      return new Date(yr, mo-1, dy) >= today;
    });
  }

  const ul = document.getElementById('upcomingDeadlines');
  ul.innerHTML = dueSoon.length === 0
    ? `<div style="font-size:13px;color:var(--gray-mid);padding:1rem 0">No deadlines ${dashWindow==='week'?'this week':dashWindow==='month'?'this month':'coming up'}.</div>`
    : dueSoon.map(e => {
        const cat = catOf(e.cat);
        const cc  = courseColor(e.course);
        const cl  = courseLabel(e.course);
        const [yr,mo,dy] = e.date.split('-').map(Number);
        const eDate   = new Date(yr, mo-1, dy);
        const diffDays = Math.round((eDate - today) / 86400000);
        const mon      = MONTHS_FULL[mo-1].slice(0,3).toUpperCase();
        let daysLabel  = diffDays < 0 ? `${Math.abs(diffDays)}d ago` : diffDays === 0 ? 'Today' : `${diffDays}d away`;
        let daysClass  = diffDays <= 0 ? 'urgent' : diffDays <= 3 ? 'urgent' : diffDays <= 10 ? 'soon' : '';
        const mandatoryBadge = e.mandatory ? `<span class="badge-mandatory">Required</span>` : '';
        const staffBadge     = e.staffOnly  ? `<span class="badge" style="background:#F3EAF8;color:#7B3D8F;font-size:10px">Staff only</span>` : '';
        return `<div class="deadline-timeline-item">
          <div class="dtl-date">
            <div class="dtl-date-num">${dy}</div>
            <div class="dtl-date-mon">${mon}</div>
          </div>
          <div class="dtl-spine">
            <div class="dtl-dot" style="background:${cat.color}"></div>
            <div class="dtl-line"></div>
          </div>
          <div class="dtl-card">
            <div class="dtl-eyebrow" style="color:${cat.color}">
              ${cat.label}${cl ? `<span class="dtl-course-chip" style="background:${cc}18;color:${cc}">${cl}</span>` : ''}${mandatoryBadge}${staffBadge}
            </div>
            <div class="dtl-title">${e.title}</div>
            ${e.note ? `<div class="dtl-note">${e.note.slice(0,80)}${e.note.length>80?'…':''}</div>` : ''}
            <span class="dtl-days-away ${daysClass}">${daysLabel}</span>
          </div>
        </div>`;
      }).join('');

  const SESSION_CATS = new Set(['lecture','guest']);
  const upcomingEvs  = courseEvents
    .filter(e => SESSION_CATS.has(e.cat))
    .sort((a,b) => a.date.localeCompare(b.date))
    .slice(0, 8);

  const strip = document.getElementById('upcomingEvents');
  if (!strip) return;

  function extractLoc(note) {
    if (!note) return '';
    const m = note.match(/(?:Location:\s*|·\s*)([A-Z][^·\n]+?)(?:\s*·|\s*$)/);
    if (m) return m[1].trim();
    const parts = note.split('·');
    for (const p of parts) {
      const t = p.trim();
      if (/\bSH\b|\bNAC\b|\bHall\b|\bRoom\b|\bAuditorium\b|\bTheater\b|\bBallroom\b/i.test(t)) return t;
    }
    return '';
  }

  strip.innerHTML = upcomingEvs.length === 0
    ? `<div style="padding:1.5rem;font-size:13px;color:var(--gray-mid)">No upcoming sessions.</div>`
    : upcomingEvs.map(e => {
        const cat     = catOf(e.cat);
        const cc      = courseColor(e.course);
        const isJoint = e.course === 'joint';
        const [yr,mo,dy] = e.date.split('-').map(Number);
        const mon     = MONTHS_FULL[mo-1].slice(0,3).toUpperCase();
        const loc     = extractLoc(e.note);
        const typeLabel = e.cat === 'guest' ? 'Guest speaker' : isJoint ? 'Joint event' : 'Class session';
        return `<div class="event-card-strip" onclick="showView('calendar')">
          <div class="event-card-strip-band" style="background:${isJoint ? '#BA7517' : cat.color}"></div>
          ${isJoint ? `<span class="event-card-strip-joint">Joint</span>` : ''}
          ${e.mandatory ? `<span class="event-card-strip-required">Required</span>` : ''}
          <div class="event-card-strip-inner">
            <div class="event-card-strip-date">
              <span class="event-card-strip-day">${dy}</span>
              <span class="event-card-strip-mon">${mon}</span>
            </div>
            <div class="event-card-strip-type" style="color:${isJoint ? '#BA7517' : cat.color}">${typeLabel}</div>
            <div class="event-card-strip-title">${e.title}</div>
            ${loc ? `<div class="event-card-strip-loc">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              ${loc}
            </div>` : ''}
          </div>
        </div>`;
      }).join('');

  // Fellowship shared space section
  renderSharedSpace();
}

function setDashWindow(w) {
  dashWindow = w;
  renderDashboard();
}

function renderSharedSpace() {
  const el = document.getElementById('fellowshipSharedSpace');
  if (!el) return;
  // Show joint events visible to all
  const sharedEvents = ALL_EVENTS
    .filter(e => e.course === 'joint' && !e.hidden)
    .sort((a,b) => a.date.localeCompare(b.date))
    .slice(0, 5);
  if (!sharedEvents.length) {
    el.innerHTML = `<div style="font-size:13px;color:var(--gray-mid);padding:0.5rem 0">No upcoming shared events.</div>`;
    return;
  }
  el.innerHTML = sharedEvents.map(e => {
    const cat = catOf(e.cat);
    const [yr,mo,dy] = e.date.split('-').map(Number);
    const mon = MONTHS_FULL[mo-1].slice(0,3).toUpperCase();
    return `<div class="shared-event-row">
      <div class="shared-event-date"><span>${dy}</span><span>${mon}</span></div>
      <div class="shared-event-body">
        <div class="shared-event-title">${e.title}</div>
        <div class="shared-event-cat" style="color:${cat.color}">${cat.label}</div>
      </div>
    </div>`;
  }).join('');
}


// ── ANNOUNCEMENTS ─────────────────────────────────────────────────────────────

function renderDashboardAnnouncements() {
  const el = document.getElementById('dashboardAnnouncements');
  if (!el) return;
  // Filter by week if set
  let visible = announcements;
  if (annWeekFilter) {
    visible = announcements.filter(a => !a.week_tag || a.week_tag === annWeekFilter);
  }
  el.innerHTML = `<div class="section-label">Announcements</div>` +
    (visible.length
      ? visible.map(a => {
          const c = ANN_CATS[a.category] || ANN_CATS.general;
          const weekLabel = a.week_tag ? `<span class="ann-week-badge">Week ${a.week_tag}</span>` : '';
          return `<div class="announcement" style="border-left-color:${c.border};background:${c.bg}">
            <div class="ann-meta-row">
              <span class="ann-cat-label" style="color:${c.border}">${c.label}</span>
              ${weekLabel}
            </div>
            <div class="announcement-title">${a.title}</div>
            <div class="announcement-body">${a.body}</div>
          </div>`;
        }).join('')
      : `<p style="color:var(--gray-mid);font-size:13px;padding:0.5rem 0">No announcements.</p>`
    );
}

function renderAdminAnnouncements() {
  const el = document.getElementById('adminAnnouncementList');
  if (!el) return;
  if (!announcements.length) {
    el.innerHTML = '<p style="color:var(--gray-mid);font-size:13px;padding:1rem 0">No announcements yet.</p>';
    return;
  }
  el.innerHTML = announcements.map(a => {
    const c = ANN_CATS[a.category] || ANN_CATS.general;
    return `<div class="admin-list-row">
      <div class="admin-list-accent" style="background:${c.border}"></div>
      <div class="admin-list-body">
        <div class="admin-list-title">${a.title}${a.week_tag ? ` <span class="ann-week-badge">Week ${a.week_tag}</span>` : ''}</div>
        <div class="admin-list-meta">${a.body.slice(0,90)}${a.body.length>90?'…':''}</div>
      </div>
      <div class="admin-list-actions">
        <span class="badge" style="background:${c.bg};color:${c.border};font-size:10px">${c.label}</span>
        <button class="admin-btn-danger" onclick="deleteAnnouncement('${a.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

async function addAnnouncement() {
  const title    = document.getElementById('ann-title').value.trim();
  const body     = document.getElementById('ann-body').value.trim();
  const color    = document.getElementById('ann-color').value;
  const week_tag = document.getElementById('ann-week').value.trim();
  if (!title || !body) return;
  const res = await api('POST', '/api/announcements', { title, body, color, week_tag });
  if (res.ok) {
    const data = await res.json();
    announcements.unshift(data);
    document.getElementById('ann-title').value = '';
    document.getElementById('ann-body').value  = '';
    document.getElementById('ann-week').value  = '';
    renderAdminAnnouncements();
    renderDashboardAnnouncements();
  }
}

async function deleteAnnouncement(id) {
  const res = await api('DELETE', `/api/announcements/${id}`);
  if (res.ok) {
    announcements = announcements.filter(a => a.id !== id);
    renderAdminAnnouncements();
    renderDashboardAnnouncements();
  }
}


// ── EVENTS (ADMIN) ────────────────────────────────────────────────────────────

async function adminAddEvent() {
  const title          = document.getElementById('ev-title').value.trim();
  const date           = document.getElementById('ev-date').value;
  const cat            = document.getElementById('ev-cat').value;
  const note           = document.getElementById('ev-note').value.trim();
  const description    = document.getElementById('ev-description').value.trim();
  const eventbrite_url = document.getElementById('ev-eventbrite').value.trim();
  const is_mandatory   = document.getElementById('ev-mandatory').checked;
  const is_staff_only  = document.getElementById('ev-staff-only').checked;
  const course         = document.getElementById('ev-course').value;
  if (!title || !date) return;
  const res = await api('POST', '/api/events', { title, date, cat, note, description, eventbrite_url, is_mandatory, is_staff_only, course });
  if (res.ok) {
    const data = await res.json();
    ALL_EVENTS.push(transformEvent(data));
    ALL_EVENTS.sort((a,b) => a.date.localeCompare(b.date));
    updateCourseEvents();
    document.getElementById('ev-title').value          = '';
    document.getElementById('ev-date').value           = '';
    document.getElementById('ev-note').value           = '';
    document.getElementById('ev-description').value    = '';
    document.getElementById('ev-eventbrite').value     = '';
    document.getElementById('ev-mandatory').checked    = false;
    document.getElementById('ev-staff-only').checked   = false;
    renderCalendar();
    renderDashboard();
    renderAdminEvents(eventsFilter);
  }
}

async function adminDeleteEvent(id) {
  const res = await api('DELETE', `/api/events/${id}`);
  if (res.ok) {
    const idx = ALL_EVENTS.findIndex(e => e.id === id);
    if (idx > -1) ALL_EVENTS.splice(idx, 1);
    updateCourseEvents();
    renderCalendar();
    renderDashboard();
    renderAdminEvents(eventsFilter);
  }
}

function filterEvents(filter, btn) {
  eventsFilter = filter;
  document.querySelectorAll('.admin-filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAdminEvents(filter);
}

async function toggleEventHidden(id) {
  const e = ALL_EVENTS.find(ev => ev.id === id);
  if (!e) return;
  const res = await api('PATCH', `/api/events/${id}`, { is_hidden: e.hidden ? 0 : 1 });
  if (res.ok) {
    e.hidden    = !e.hidden;
    e.is_hidden = e.hidden ? 1 : 0;
    renderCalendar();
    renderDashboard();
    renderAdminEvents(eventsFilter);
  }
}

function renderAdminEvents(filter) {
  const list    = document.getElementById('adminEventList');
  const countEl = document.getElementById('eventsCount');
  if (!list) return;
  const filtered = ALL_EVENTS.filter(e => filter === 'all' || e.course === filter)
    .sort((a,b) => a.date.localeCompare(b.date));
  if (countEl) countEl.textContent = `(${filtered.length})`;
  if (!filtered.length) {
    list.innerHTML = '<p style="color:var(--gray-mid);font-size:13px;padding:1rem 0">No events match this filter.</p>';
    return;
  }
  list.innerHTML = filtered.map(e => {
    const cat = catOf(e.cat);
    const cc  = courseColor(e.course);
    const cl  = courseLabel(e.course);
    const [yr,mo,dy] = e.date.split('-').map(Number);
    const mon = MONTHS_FULL[mo-1].slice(0,3).toUpperCase();
    return `<div class="admin-list-row" style="${e.hidden?'opacity:0.5':''}">
      <div class="admin-list-accent" style="background:${e.locked?'#ccc':cat.color}"></div>
      <div style="min-width:48px;text-align:center;flex-shrink:0">
        <div style="font-size:1.2rem;font-weight:700;line-height:1;color:var(--gray-brand)">${dy}</div>
        <div style="font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--gray-mid)">${mon}</div>
      </div>
      <div class="admin-list-body">
        <div class="admin-list-title" style="${e.locked?'text-decoration:line-through':''}">
          ${e.title}
          ${e.mandatory ? `<span class="badge-mandatory" style="margin-left:6px">Required</span>` : ''}
          ${e.staffOnly ? `<span class="badge" style="background:#F3EAF8;color:#7B3D8F;font-size:10px;margin-left:4px">Staff only</span>` : ''}
        </div>
        <div class="admin-list-meta">
          ${cat.label}
          ${cl ? `<span class="badge" style="background:${cc}18;color:${cc};font-size:10px;margin-left:4px">${cl}</span>` : ''}
          ${e.eventbrite_url ? ` · <span style="color:#185FA5;font-size:10px">RSVP link</span>` : ''}
          ${e.note ? ' · ' + e.note.split('·')[0].trim() : ''}
        </div>
      </div>
      <div class="admin-list-actions" style="gap:6px">
        <button class="admin-btn-secondary" style="padding:5px 10px;font-size:10px" onclick="toggleEventHidden('${e.id}')">${e.hidden?'Show':'Hide'}</button>
        <button class="admin-btn-danger" onclick="adminDeleteEvent('${e.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}


// ── ADMIN USERS ───────────────────────────────────────────────────────────────

async function addAdminUser() {
  const name     = document.getElementById('au-name').value.trim();
  const username = document.getElementById('au-username').value.trim().toLowerCase();
  const password = document.getElementById('au-password').value.trim();
  const role     = document.getElementById('au-role').value;
  const course   = document.getElementById('au-course').value;
  if (!name || !username || !password) return;
  const res = await api('POST', '/api/staff', { name, username, password, role, course });
  if (res.ok) {
    const data = await res.json();
    adminUsers.push({ id:data.id, name:data.display_name, username:data.username, role:data.role, course:data.course, active:!!data.is_active, you:false });
    document.getElementById('au-name').value     = '';
    document.getElementById('au-username').value = '';
    document.getElementById('au-password').value = '';
    renderAdminUsers();
  } else {
    const err = await res.json();
    alert(err.error || 'Could not add user');
  }
}

async function toggleAdminUserActive(id) {
  const u = adminUsers.find(u => u.id === id);
  if (!u || u.you) return;
  const res = await api('PATCH', `/api/staff/${id}`, { is_active: u.active ? 0 : 1 });
  if (res.ok) { u.active = !u.active; renderAdminUsers(); }
}

async function removeAdminUser(id) {
  const u = adminUsers.find(u => u.id === id);
  if (!u || u.you) return;
  if (!confirm(`Remove admin access for ${u.name}?`)) return;
  const res = await api('DELETE', `/api/staff/${id}`);
  if (res.ok) { adminUsers = adminUsers.filter(a => a.id !== id); renderAdminUsers(); }
}

async function resetPassword(id) {
  const u = adminUsers.find(u => u.id === id);
  if (!u || u.you) return;
  const newPass = prompt(`Set new password for ${u.name}:`, '');
  if (!newPass || !newPass.trim()) return;
  const res = await api('PATCH', `/api/staff/${id}`, { password: newPass.trim() });
  if (!res.ok) { const err = await res.json(); alert(err.error || 'Could not reset password'); }
}

function renderAdminUsers() {
  const el      = document.getElementById('adminUserList');
  const countEl = document.getElementById('adminUserCount');
  if (!el) return;
  if (countEl) countEl.textContent = `(${adminUsers.length})`;
  el.innerHTML = adminUsers.map(u => {
    const rl = ROLE_LABELS[u.role] || ROLE_LABELS.admin;
    return `<div class="admin-list-row" style="opacity:${u.active?1:0.5}">
      <div class="admin-list-accent" style="background:${rl.color}"></div>
      <div style="width:38px;height:38px;border-radius:50%;background:${rl.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;font-weight:700;color:${rl.color}">
        ${u.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
      </div>
      <div class="admin-list-body">
        <div class="admin-list-title">
          ${u.name}
          ${u.you ? `<span style="font-size:10px;font-weight:700;letter-spacing:0.06em;background:#f5e8e8;color:var(--maroon);padding:2px 7px;margin-left:8px">You</span>` : ''}
          ${!u.active ? `<span style="font-size:10px;font-weight:700;letter-spacing:0.06em;background:var(--gray-light);color:var(--gray-mid);padding:2px 7px;margin-left:8px">Suspended</span>` : ''}
        </div>
        <div class="admin-list-meta" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:4px">
          <span>@${u.username}</span>
          <span class="badge" style="background:${rl.bg};color:${rl.color};font-size:10px">${rl.label}</span>
          <span style="color:var(--gray-mid)">${COURSE_LABELS[u.course]||u.course}</span>
        </div>
      </div>
      <div class="admin-list-actions" style="gap:6px">
        ${!u.you ? `
          <button class="admin-btn-secondary" style="padding:5px 10px;font-size:10px" onclick="resetPassword('${u.id}')">Reset pw</button>
          <button class="admin-btn-secondary" style="padding:5px 10px;font-size:10px" onclick="toggleAdminUserActive('${u.id}')">${u.active?'Suspend':'Restore'}</button>
          <button class="admin-btn-danger" onclick="removeAdminUser('${u.id}')">Remove</button>
        ` : `<span style="font-size:11px;color:var(--gray-mid)">Current session</span>`}
      </div>
    </div>`;
  }).join('');
}


// ── ADMIN TAB SWITCHING ───────────────────────────────────────────────────────

function switchAdminTab(name) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('apanel-'+name).classList.add('active');
  if (name === 'announcements') renderAdminAnnouncements();
  if (name === 'events')        renderAdminEvents(eventsFilter);
  if (name === 'users')         renderAdminUsers();
  if (name === 'resources')     renderAdminResources();
}

function switchAdminTabByName(name) {
  const btn = [...document.querySelectorAll('.admin-tab')].find(b => b.getAttribute('onclick') && b.getAttribute('onclick').includes("'"+name+"'"));
  if (btn) btn.click();
}


// ── CALENDAR ──────────────────────────────────────────────────────────────────

function ds(y,m,d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }

function courseColor(course) {
  if (course === 'joint')    return '#BA7517';
  if (course === 'psc31180') return '#8B1A1A';
  if (course === 'psc31330') return '#185FA5';
  return '#6b6b6b';
}
function courseLabel(course) {
  if (course === 'joint')    return 'Joint';
  if (course === 'psc31180') return 'Year 1';
  if (course === 'psc31330') return 'Year 2';
  return '';
}

function getVisibleEvents() {
  let evs;
  if      (calFilterCourse === 'all')      evs = ALL_EVENTS;
  else if (calFilterCourse === 'psc31180') evs = ALL_EVENTS.filter(e => e.course === 'psc31180' || e.course === 'joint');
  else if (calFilterCourse === 'psc31330') evs = ALL_EVENTS.filter(e => e.course === 'psc31330' || e.course === 'joint');
  else evs = ALL_EVENTS;
  if (isStudentMode) evs = evs.filter(e => !e.hidden);
  return evs;
}
function eventsForDate(dateStr) { return getVisibleEvents().filter(e => e.date === dateStr); }

/* The calendar opens on the current month. Before term starts that month holds
   only a stray registration deadline or two, so the grid reads as empty even
   though nothing is wrong. Land instead on the first month from here that has a
   real calendar, falling back to any month with anything at all. */
const BUSY_MONTH_THRESHOLD = 5;

function jumpToFirstMonthWithEvents() {
  const evs = getVisibleEvents();
  if (!evs.length) return;
  const countIn = (y, m) => evs.filter(e => {
    const [ey, em] = (e.date || '').split('-').map(Number);
    return ey === y && em === m + 1;
  }).length;

  if (countIn(calYear, calMonth) >= BUSY_MONTH_THRESHOLD) return;

  let y = calYear, m = calMonth, firstAny = null;
  for (let i = 0; i < 18; i++) {
    const n = countIn(y, m);
    if (n && firstAny === null) firstAny = { y, m };
    if (n >= BUSY_MONTH_THRESHOLD) { calYear = y; calMonth = m; return; }
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  if (firstAny) { calYear = firstAny.y; calMonth = firstAny.m; }
}

function renderCalendar() {
  document.getElementById('calMonthTitle').textContent = `${MONTHS_FULL[calMonth]} ${calYear}`;
  const filterBar = document.getElementById('calFilterBar');
  if (filterBar) {
    // Master calendar first — it's the default view. The other two narrow it to
    // one class, still including events shared by both.
    const filters = [
      { id:'all',      label:'Master calendar', color:'#BA7517' },
      { id:'psc31180', label:'Year 1',          color:'#8B1A1A' },
      { id:'psc31330', label:'Year 2',          color:'#185FA5' },
    ];
    filterBar.innerHTML = filters.map(f =>
      `<button class="cal-filter-pill${calFilterCourse===f.id?' active':''}" onclick="setCalFilter('${f.id}')">
        <div class="cal-filter-pill-dot" style="background:${f.color}"></div>${f.label}
      </button>`
    ).join('');
  }
  // Heading follows the filter, so it never claims to show one course while
  // displaying both.
  const heroMeta = document.getElementById('calHeroMeta');
  if (heroMeta) {
    const c = COURSES[calFilterCourse];
    heroMeta.textContent = c
      ? `${c.code} — ${c.title}`
      : `${COURSES.psc31180.title}  ·  ${COURSES.psc31330.title}`;
  }
  document.getElementById('calLegend').innerHTML = CATS.map(c =>
    `<div class="cal-legend-item"><span class="cal-legend-badge" style="background:${c.bg};color:${c.color};border-color:${c.color}40">${c.label}</span></div>`
  ).join('');
  document.getElementById('calGridHeader').innerHTML = DAYS_SHORT.map(d => `<div>${d}</div>`).join('');

  const today    = new Date();
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const prevDays = new Date(calYear, calMonth, 0).getDate();
  let cells = [];
  for (let i = firstDay-1; i >= 0; i--) {
    const d = prevDays - i, m = calMonth-1 < 0 ? 11 : calMonth-1, y = calMonth-1 < 0 ? calYear-1 : calYear;
    cells.push({d,m,y,other:true});
  }
  for (let d = 1; d <= daysInMonth; d++) cells.push({d,m:calMonth,y:calYear,other:false});
  while (cells.length % 7 !== 0) {
    const d = cells.length - firstDay - daysInMonth + 1, m = calMonth+1 > 11 ? 0 : calMonth+1, y = calMonth+1 > 11 ? calYear+1 : calYear;
    cells.push({d,m,y,other:true});
  }
  document.getElementById('calGrid').innerHTML = cells.map(c => {
    const dateStr = ds(c.y, c.m, c.d);
    const isToday = !c.other && today.getFullYear()===c.y && today.getMonth()===c.m && today.getDate()===c.d;
    const evs = eventsForDate(dateStr);
    const maxShow = 2;
    const pills = evs.slice(0,maxShow).map(e => {
      const cat = catOf(e.cat);
      const cc  = courseColor(e.course);
      return `<span class="cal-pill" style="background:${e.locked?'#f0f0f0':cat.bg};color:${e.locked?'#999':cat.color};border-left:2px solid ${e.locked?'#ccc':cc};${e.locked?'text-decoration:line-through':''}">
        ${e.hidden?'[hidden] ':''}${e.locked?'🔒 ':''}${e.mandatory?'★ ':''}${e.title}
      </span>`;
    }).join('');
    const more = evs.length > maxShow ? `<span class="cal-more">+${evs.length-maxShow} more</span>` : '';
    return `<div class="cal-cell${c.other?' other-month':''}${isToday?' today':''}" onclick="openDayPanel('${dateStr}')">
      <div class="cal-day-num">${c.d}</div>
      ${pills}${more}
    </div>`;
  }).join('');
}

function setCalFilter(id) { calFilterCourse = id; renderCalendar(); }

function changeMonth(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  renderCalendar();
}


function downloadIcs(eventId) {
  window.location.href = `/api/events/${eventId}/ics`;
}


// ── SIDE PANEL ────────────────────────────────────────────────────────────────

function openDayPanel(dateStr) {
  selectedDate = dateStr;
  panelMode    = 'day';
  const [y,m,d]  = dateStr.split('-');
  const dateObj   = new Date(parseInt(y), parseInt(m)-1, parseInt(d));
  const monthName = MONTHS_FULL[parseInt(m)-1];
  const weekday   = WEEKDAYS[dateObj.getDay()];
  document.getElementById('panelEyebrow').textContent   = weekday;
  document.getElementById('panelDateBig').innerHTML     = `<strong>${monthName}</strong> ${parseInt(d)}`;
  document.getElementById('panelDateYear').textContent  = y;
  document.getElementById('panelGhost').textContent     = parseInt(d);
  const evs   = eventsForDate(dateStr);
  const count = evs.length;
  document.getElementById('panelCountLabel').textContent = count === 0 ? 'No events' : count === 1 ? '1 event' : `${count} events`;
  document.getElementById('panelAddBtn').onclick = showAddForm;
  if (!isStudentMode) document.getElementById('panelAddBtn').style.display = '';
  document.getElementById('panelFooter').style.display = 'none';
  renderDayBody(dateStr);
  document.getElementById('sidePanel').classList.add('open');
  document.getElementById('panelOverlay').classList.add('open');
}

function renderDayBody(dateStr) {
  const evs  = eventsForDate(dateStr);
  const body = document.getElementById('panelBody');
  if (!evs.length) {
    body.innerHTML = `
      <div class="panel-empty">
        <div class="panel-empty-icon">&#9634;</div>
        <div class="panel-empty-title">Nothing scheduled</div>
        <div class="panel-empty-sub">This day has no events yet.</div>
        ${!isStudentMode ? `<button class="btn-sm btn-primary" onclick="showAddForm()">+ Schedule something</button>` : ''}
      </div>`;
    return;
  }
  body.innerHTML = `<div class="panel-event-list">${evs.map(e => {
    const cat   = catOf(e.cat);
    const cc    = courseColor(e.course);
    const cl    = courseLabel(e.course);
    const adminBadges = !isStudentMode ? `
      ${e.hidden ? `<span class="admin-status-chip" style="background:#333;color:#ccc;margin-right:4px">Hidden</span>` : ''}
      ${e.locked ? `<span class="admin-status-chip" style="background:#FAECE7;color:#D85A30;margin-right:4px">🔒 Locked</span>` : ''}
    ` : '';
    const mandatoryBadge = e.mandatory  ? `<span class="badge-mandatory" style="margin-left:4px">Required</span>` : '';
    const staffOnlyBadge = e.staffOnly  ? `<span class="badge" style="background:#F3EAF8;color:#7B3D8F;font-size:10px;margin-left:4px">Staff only</span>` : '';
    const calBtn  = `<button class="btn-sm" onclick="downloadIcs('${e.id}')" style="margin-top:8px;font-size:11px;display:inline-flex;align-items:center;gap:5px">📅 Add to calendar</button>`;
    const ebBtn   = e.eventbrite_url ? `<a href="${e.eventbrite_url}" target="_blank" rel="noopener" class="btn-sm btn-primary" style="margin-top:8px;font-size:11px;display:inline-flex;align-items:center;gap:5px;text-decoration:none">🎟 RSVP / Register ↗</a>` : '';
    const descHtml = e.description ? `<div class="panel-event-desc">${e.description}</div>` : '';
    return `<div class="panel-event-item" style="${e.hidden&&!isStudentMode?'opacity:0.6':''}">
      <div class="panel-event-accent" style="background:${e.locked?'#ccc':cat.color}"></div>
      <div class="panel-event-content">
        <div class="panel-event-cat" style="color:${cat.color}">${cat.label}${cl?`<span class="course-badge" style="background:${cc}22;color:${cc}">${cl}</span>`:''}${mandatoryBadge}${staffOnlyBadge}</div>
        <div class="panel-event-title">${e.title}</div>
        ${adminBadges}
        ${e.note ? `<div class="panel-event-note">${e.note}</div>` : ''}
        ${descHtml}
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
          ${ebBtn}
          ${calBtn}
        </div>
      </div>
      ${!isStudentMode ? `<button class="panel-event-delete" onclick="deleteEvent('${e.id}')" title="Remove">Remove</button>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function showAddForm() {
  if (isStudentMode) return;
  const dateStr  = selectedDate;
  const [y,m,d]  = (dateStr || ds(calYear, calMonth, 1)).split('-');
  const dateObj   = new Date(parseInt(y), parseInt(m)-1, parseInt(d));
  const monthName = MONTHS_FULL[parseInt(m)-1];
  document.getElementById('panelEyebrow').textContent  = 'Add event';
  document.getElementById('panelDateBig').innerHTML    = `<strong>${monthName}</strong> ${parseInt(d)}`;
  document.getElementById('panelDateYear').textContent = y;
  document.getElementById('panelGhost').textContent    = parseInt(d);
  document.getElementById('panelCountLabel').textContent = 'New event';
  document.getElementById('panelAddBtn').style.display = 'none';
  document.getElementById('panelBody').innerHTML = `
    <div class="panel-form-wrap">
      <div class="panel-form-title">Event details</div>
      <div class="form-group">
        <label class="form-label">Title</label>
        <input class="form-input" id="fTitle" type="text" placeholder="e.g. Module 3 lecture" autofocus>
      </div>
      <div class="form-group">
        <label class="form-label">Date</label>
        <input class="form-input" id="fDate" type="date" value="${dateStr || ds(calYear,calMonth,1)}">
      </div>
      <div class="form-group">
        <label class="form-label">Category</label>
        <select class="form-input" id="fCat">
          ${CATS.map(c=>`<option value="${c.id}">${c.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Note <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
        <textarea class="form-input" id="fNote" placeholder="Location, details…"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Description <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
        <textarea class="form-input" id="fDesc" rows="3" placeholder="Longer description or context…"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">RSVP / registration link <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
        <input class="form-input" id="fEventbrite" type="url" placeholder="Google Form, Eventbrite, Calendly…">
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="fMandatory" style="width:16px;height:16px;accent-color:var(--maroon)">
        <label for="fMandatory" class="form-label" style="margin:0;cursor:pointer">Mark as required / mandatory</label>
      </div>
    </div>`;
  document.getElementById('panelFooter').style.display = 'block';
  document.getElementById('panelFooter').innerHTML = `
    <div style="display:flex;gap:10px">
      <button class="btn-sm btn-primary" style="flex:1" onclick="saveEvent()">Save event</button>
      <button class="btn-sm" onclick="backToDay()">Cancel</button>
    </div>`;
}

function backToDay() {
  if (selectedDate) openDayPanel(selectedDate); else closePanel();
}

function openAddForm(dateStr) {
  selectedDate = dateStr; panelMode = 'add';
  openDayPanel(dateStr);
  setTimeout(showAddForm, 10);
}

async function saveEvent() {
  const title          = document.getElementById('fTitle').value.trim();
  const date           = document.getElementById('fDate').value;
  const cat            = document.getElementById('fCat').value;
  const note           = document.getElementById('fNote').value.trim();
  const description    = document.getElementById('fDesc').value.trim();
  const eventbrite_url = document.getElementById('fEventbrite').value.trim();
  const is_mandatory   = document.getElementById('fMandatory').checked;
  if (!title || !date) { document.getElementById('fTitle').style.borderColor = '#A32D2D'; return; }
  const course = activeCourse === 'all' ? 'joint' : activeCourse;
  const res = await api('POST', '/api/events', { title, date, cat, note, description, eventbrite_url, is_mandatory, course });
  if (res.ok) {
    const data = await res.json();
    ALL_EVENTS.push(transformEvent(data));
    ALL_EVENTS.sort((a,b) => a.date.localeCompare(b.date));
    updateCourseEvents();
    renderCalendar(); renderDashboard();
    selectedDate = date;
    openDayPanel(date);
  }
}

async function deleteEvent(id) {
  const res = await api('DELETE', `/api/events/${id}`);
  if (res.ok) {
    const idx = ALL_EVENTS.findIndex(e => e.id === id);
    if (idx > -1) ALL_EVENTS.splice(idx, 1);
    updateCourseEvents();
    renderCalendar(); renderDashboard();
    if (selectedDate) {
      const evs = eventsForDate(selectedDate);
      document.getElementById('panelCountLabel').textContent = evs.length === 0 ? 'No events' : evs.length === 1 ? '1 event' : `${evs.length} events`;
      document.getElementById('panelAddBtn').style.display = '';
      renderDayBody(selectedDate);
    }
  }
}

function closePanel() {
  document.getElementById('sidePanel').classList.remove('open');
  document.getElementById('panelOverlay').classList.remove('open');
  document.getElementById('panelAddBtn').style.display = '';
  panelMode = null; selectedDate = null;
}


// ── RESOURCES ─────────────────────────────────────────────────────────────────

function renderResources() {
  const el = document.getElementById('resourcesList');
  if (!el) return;

  const cats = [...new Set(resources.map(r => r.category))];
  if (!resources.length) {
    el.innerHTML = `<div style="font-size:13px;color:var(--gray-mid);padding:2rem 0;text-align:center">No resources added yet.<br><span style="font-size:12px">Your instructor will add links to forms, guides, and documents here.</span></div>`;
    return;
  }

  // Build category dropdown nav
  const navEl = document.getElementById('resourcesNav');
  if (navEl) {
    navEl.innerHTML = cats.map(cat => {
      const cl = RESOURCE_CATS[cat] || { label: cat, color: '#6b6b6b' };
      return `<a href="#res-cat-${cat}" class="resource-nav-link" style="color:${cl.color}">${cl.label}</a>`;
    }).join('');
  }

  el.innerHTML = cats.map(cat => {
    const cl    = RESOURCE_CATS[cat] || { label: cat, color: '#6b6b6b' };
    const items = resources.filter(r => r.category === cat);
    return `<div class="resource-cat-section" id="res-cat-${cat}">
      <div class="resource-cat-title" style="color:${cl.color}">${cl.label}</div>
      <div class="resource-items-grid">
        ${items.map(r => `
          <a href="${r.url || '#'}" target="_blank" rel="noopener" class="resource-card" style="${!r.url?'pointer-events:none;opacity:0.6':''}">
            <div class="resource-card-title">${r.title}</div>
            ${r.description ? `<div class="resource-card-desc">${r.description}</div>` : ''}
            ${r.url ? `<div class="resource-card-link">Open →</div>` : '<div class="resource-card-link" style="color:var(--gray-mid)">No link yet</div>'}
          </a>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function renderAdminResources() {
  const el = document.getElementById('adminResourceList');
  if (!el) return;
  if (!resources.length) {
    el.innerHTML = '<p style="color:var(--gray-mid);font-size:13px;padding:1rem 0">No resources yet.</p>';
    return;
  }
  el.innerHTML = resources.map(r => {
    const cl = RESOURCE_CATS[r.category] || { label: r.category, color: '#6b6b6b' };
    return `<div class="admin-list-row">
      <div class="admin-list-accent" style="background:${cl.color}"></div>
      <div class="admin-list-body">
        <div class="admin-list-title">${r.title}</div>
        <div class="admin-list-meta">${cl.label}${r.url ? ' · ' + r.url.slice(0,50) : ''}${r.description ? ' · ' + r.description.slice(0,50) : ''}</div>
      </div>
      <div class="admin-list-actions">
        <button class="admin-btn-danger" onclick="deleteResource('${r.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

async function addResource() {
  const title       = document.getElementById('res-title').value.trim();
  const url         = document.getElementById('res-url').value.trim();
  const description = document.getElementById('res-desc').value.trim();
  const category    = document.getElementById('res-cat').value;
  if (!title) return;
  const res = await api('POST', '/api/resources', { title, url, description, category });
  if (res.ok) {
    const data = await res.json();
    resources.push(data);
    document.getElementById('res-title').value = '';
    document.getElementById('res-url').value   = '';
    document.getElementById('res-desc').value  = '';
    renderAdminResources();
    renderResources();
  }
}

async function deleteResource(id) {
  const res = await api('DELETE', `/api/resources/${id}`);
  if (res.ok) {
    resources = resources.filter(r => r.id !== id);
    renderAdminResources();
    renderResources();
  }
}


// ── ABOUT PAGE ────────────────────────────────────────────────────────────────

function renderAbout() {
  const el = document.getElementById('view-about');
  if (!el) return;
  // Content is static HTML, already rendered in the template
}


// ── CHANGE PASSWORD MODAL ─────────────────────────────────────────────────────

function toggleUserDropdown() { document.getElementById('userDropdown').classList.toggle('open'); }
document.addEventListener('click', e => {
  const avatar   = document.getElementById('userAvatar');
  const dropdown = document.getElementById('userDropdown');
  if (dropdown && avatar && !avatar.contains(e.target) && !dropdown.contains(e.target))
    dropdown.classList.remove('open');
});

// ── CALENDAR SUBSCRIBE MODAL ──────────────────────────────────────────────────

function getIcsUrl() {
  const meta = document.querySelector('meta[name="ics-url"]');
  return meta ? meta.content : '';
}

function openCalSubscribeModal() {
  const url = getIcsUrl();
  const el = document.getElementById('icsUrlDisplay');
  if (el) el.value = url;
  document.getElementById('calSubscribeModal').classList.add('open');
}

function closeCalSubscribeModal() {
  document.getElementById('calSubscribeModal').classList.remove('open');
}

function subscribeCalendar(provider) {
  const icsUrl  = getIcsUrl();
  const webcal  = icsUrl.replace(/^https?:/, 'webcal:');
  const encoded = encodeURIComponent(icsUrl);
  const name    = encodeURIComponent('Moynihan Center Fellowship');
  const urls = {
    google:    `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    outlook:   `https://outlook.live.com/calendar/0/addfromweb?url=${encoded}&name=${name}`,
    office365: `https://outlook.office.com/calendar/addfromweb?url=${encoded}&name=${name}`,
    apple:     webcal,
  };
  if (urls[provider]) window.open(urls[provider], '_blank');
}

function copyIcsUrl() {
  const url = getIcsUrl();
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('copyIcsBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
}

function openChangePassword() {
  document.getElementById('userDropdown').classList.remove('open');
  ['cpCurrent','cpNew','cpConfirm'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('cpError').classList.remove('visible');
  document.getElementById('cpSuccess').classList.remove('visible');
  document.getElementById('changePasswordModal').classList.add('open');
}
function closeChangePassword() { document.getElementById('changePasswordModal').classList.remove('open'); }
function handleModalOverlayClick(e) { if (e.target === document.getElementById('changePasswordModal')) closeChangePassword(); }

async function submitChangePassword() {
  const current = document.getElementById('cpCurrent').value;
  const newPass = document.getElementById('cpNew').value;
  const confirm = document.getElementById('cpConfirm').value;
  const errEl   = document.getElementById('cpError');
  const okEl    = document.getElementById('cpSuccess');
  errEl.classList.remove('visible');
  okEl.classList.remove('visible');
  if (newPass.length < 8) {
    errEl.textContent = 'New password must be at least 8 characters.';
    errEl.classList.add('visible'); return;
  }
  if (newPass !== confirm) {
    errEl.textContent = 'New passwords do not match.';
    errEl.classList.add('visible');
    document.getElementById('cpConfirm').value = ''; return;
  }
  const res = await api('POST', '/api/change-password', { current, new: newPass, confirm });
  if (res.ok) {
    ['cpCurrent','cpNew','cpConfirm'].forEach(id => document.getElementById(id).value = '');
    okEl.classList.add('visible');
    setTimeout(closeChangePassword, 1800);
  } else {
    const data = await res.json();
    errEl.textContent = data.error || 'Password update failed.';
    errEl.classList.add('visible');
    document.getElementById('cpCurrent').value = '';
  }
}


// ── INIT ──────────────────────────────────────────────────────────────────────

/* The session cookie outlives a page reload, so check for one before showing the
   sign-in screen — otherwise refreshing would make a fellow re-enter the code. */
async function restoreSession() {
  const res  = await api('GET', '/api/me', undefined, { retries: 1 });
  const data = await res.json();
  if (!res.ok || !data.authenticated) return false;
  applySession(data);
  await loadPortalData();
  jumpToFirstMonthWithEvents();
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('portalApp').classList.add('visible');
  showView(isStudentMode ? 'calendar' : 'admin');
  return true;
}

document.addEventListener('DOMContentLoaded', () => {
  const userEl = document.getElementById('loginUser');
  if (userEl) {
    userEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('loginPass').focus();
    });
  }
  restoreSession();
});
