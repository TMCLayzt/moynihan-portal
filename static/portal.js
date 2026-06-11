// ── CONSTANTS ────────────────────────────────────────────────────────────────

const CATS = [
  { id:'lecture',     label:'Lecture / class',     color:'#8B1A1A', bg:'#f5e8e8' },
  { id:'reading',     label:'Reading / prep',       color:'#1D9E75', bg:'#E1F5EE' },
  { id:'homework',    label:'Homework deadline',    color:'#D85A30', bg:'#FAECE7' },
  { id:'application', label:'Application deadline', color:'#A32D2D', bg:'#FCEBEB' },
  { id:'guest',       label:'Guest speaker',        color:'#185FA5', bg:'#E6F1FB' },
  { id:'milestone',   label:'Student milestone',    color:'#BA7517', bg:'#FAEEDA' },
];
const CAT = {};
CATS.forEach(c => CAT[c.id] = c);

const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_SHORT  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const WEEKDAYS    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const ANN_COLORS = {
  maroon: { border:'#8B1A1A', bg:'#f5e8e8' },
  blue:   { border:'#185FA5', bg:'#E6F1FB' },
  orange: { border:'#D85A30', bg:'#FAECE7' },
  amber:  { border:'#BA7517', bg:'#FAEEDA' },
};

const ROLE_LABELS = {
  admin:       { label:'Admin',       desc:'Full access',                  color:'#8B1A1A', bg:'#f5e8e8' },
  instructor:  { label:'Instructor',  desc:'Syllabus & announcements',     color:'#185FA5', bg:'#E6F1FB' },
  coordinator: { label:'Coordinator', desc:'Events & RSVPs',               color:'#1D9E75', bg:'#E1F5EE' },
};
const COURSE_LABELS = {
  both:     'Both courses',
  psc31180: 'PSC 31180 only',
  psc31330: 'PSC 31330 only',
};

const RESOURCE_CATS = {
  general:  { label:'General',         color:'#6b6b6b' },
  finance:  { label:'Finance & Stipends', color:'#1D9E75' },
  academic: { label:'Academic',         color:'#185FA5' },
  forms:    { label:'Forms & Documents', color:'#D85A30' },
  housing:  { label:'Housing',          color:'#BA7517' },
};

// ── MUTABLE DATA (loaded from API after login) ────────────────────────────────

let ALL_EVENTS      = [];
let MODULES         = [];
let TAP_MODULES     = [];
let announcements   = [];
let students        = [];
let adminUsers      = [];
let allRsvps        = {};
let financeItems    = [];
let resources       = [];

const rsvpSet       = new Set();
const financeChecked = new Set();

const COURSES = {
  psc31180: {
    id:'psc31180', code:'PSC 31180',
    title:'Power, Politics, and Policy in NYC',
    instructor:'Layana Abu Touq',
    email:'Labutouq@ccny.cuny.edu',
    location:'NAC 4/133',
    color:'#8B1A1A', bg:'#f5e8e8',
    events:[], modules:[],
  },
  psc31330: {
    id:'psc31330', code:'PSC 31330',
    title:'Truth and Politics (TAP)',
    instructor:'Dr. Michael Miller',
    email:'mmiller3@ccny.cuny.edu',
    location:'Shepard Hall 558',
    color:'#185FA5', bg:'#E6F1FB',
    events:[], modules:[],
  },
};

// ── STATE ─────────────────────────────────────────────────────────────────────

let isStudentMode    = false;
let currentRole      = null;
let currentUserName  = '';
let currentFirstName = '';
let activeCourse     = 'psc31180';
let calFilterCourse  = 'psc31180';

// Default calendar to current month
const _now = new Date();
let calYear  = _now.getFullYear();
let calMonth = _now.getMonth();

let panelMode = null, selectedDate = null;
let openModuleId  = null;
let activeTab     = {};
let eventsFilter  = 'all';
let adminSylOpen  = null;
let showPassFor   = new Set();
let annWeekFilter = '';


// ── DATA TRANSFORMS ───────────────────────────────────────────────────────────

function transformEvent(e) {
  return {
    ...e,
    hidden:    !!e.is_hidden,
    locked:    !!e.is_locked,
    mandatory: !!e.is_mandatory,
  };
}

function transformModule(m) {
  return {
    ...m,
    desc: m.description,
    sessions: (m.sessions || []).map(s => ({
      ...s,
      date:    s.date_label,
      isJoint: !!s.is_joint,
    })),
    deliverables: (m.deliverables || []).map(d => ({
      ...d,
      due: d.due_date,
    })),
    readings: (m.readings || []).map(r => ({
      ...r,
      when: r.when_label,
      desc: r.description,
    })),
  };
}

function transformStudent(s) {
  return { ...s, name: s.display_name };
}

function updateCourseEvents() {
  COURSES.psc31180.events = ALL_EVENTS.filter(e => e.course === 'psc31180' || e.course === 'joint');
  COURSES.psc31330.events = ALL_EVENTS.filter(e => e.course === 'psc31330' || e.course === 'joint');
}

function updateCourseModules() {
  COURSES.psc31180.modules = MODULES;
  COURSES.psc31330.modules = TAP_MODULES;
}


// ── API HELPERS ───────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(path, opts);
}


// ── POST-LOGIN DATA LOADER ────────────────────────────────────────────────────

async function loadPortalData() {
  const [evRes, modRes, annRes, rsvpRes, finRes, resRes] = await Promise.all([
    fetch('/api/events'),
    fetch('/api/modules'),
    fetch('/api/announcements'),
    fetch('/api/rsvps'),
    fetch('/api/finance'),
    fetch('/api/resources'),
  ]);

  const evData   = await evRes.json();
  const modData  = await modRes.json();
  const annData  = await annRes.json();
  const rsvpData = await rsvpRes.json();
  const finData  = await finRes.json();
  const resData  = await resRes.json();

  ALL_EVENTS    = evData.map(transformEvent);
  const allMods = modData.map(transformModule);
  MODULES       = allMods.filter(m => m.course === 'psc31180');
  TAP_MODULES   = allMods.filter(m => m.course === 'psc31330');
  announcements = annData;

  rsvpSet.clear();
  rsvpData.forEach(id => rsvpSet.add(id));

  financeItems = finData;
  financeChecked.clear();
  finData.forEach(item => { if (item.checked) financeChecked.add(item.id); });

  resources = resData;

  updateCourseEvents();
  updateCourseModules();

  if (!isStudentMode) {
    const [stuRes, usersRes] = await Promise.all([
      fetch('/api/students'),
      fetch('/api/admin/users'),
    ]);
    const stuData   = await stuRes.json();
    const usersData = await usersRes.json();
    students   = stuData.map(transformStudent);
    adminUsers = usersData.map(u => ({
      id:      u.id,
      name:    u.display_name,
      username: u.username,
      role:    u.role,
      course:  u.course,
      active:  !!u.is_active,
      you:     !!u.you,
    }));
  }
}


// ── AUTH ──────────────────────────────────────────────────────────────────────

async function attemptLogin() {
  const username = document.getElementById('loginUser').value.trim().toLowerCase();
  const password = document.getElementById('loginPass').value;
  const err      = document.getElementById('loginError');

  err.classList.remove('visible');

  const res  = await api('POST', '/api/login', { username, password });
  const data = await res.json();

  if (!res.ok) {
    err.classList.add('visible');
    document.getElementById('loginPass').value = '';
    document.getElementById('loginPass').focus();
    return;
  }

  currentRole      = data.role;
  currentUserName  = data.display;
  currentFirstName = data.first_name || data.display.split(' ')[0];
  isStudentMode    = (currentRole === 'student');

  document.getElementById('userName').textContent     = data.display;
  document.getElementById('userAvatar').textContent   = data.initials;
  document.getElementById('dropdownName').textContent = data.display;
  document.getElementById('dropdownRole').textContent = isStudentMode ? 'Student' : 'Administrator';

  document.body.classList.toggle('student-mode', isStudentMode);
  document.getElementById('panelAddBtn').style.display = isStudentMode ? 'none' : '';

  // Default to student's course
  if (data.course && data.course !== 'both') {
    activeCourse     = data.course;
    calFilterCourse  = data.course;
  }

  await loadPortalData();

  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('portalApp').classList.add('visible');

  if (!isStudentMode) showView('admin');
  else showView('dashboard');
}

async function logout() {
  await api('POST', '/api/logout');
  currentRole = null; isStudentMode = false;
  ALL_EVENTS = []; MODULES = []; TAP_MODULES = [];
  announcements = []; students = []; adminUsers = [];
  allRsvps = {}; rsvpSet.clear();
  financeItems = []; financeChecked.clear();
  resources = [];
  updateCourseEvents(); updateCourseModules();
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginError').classList.remove('visible');
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('portalApp').classList.remove('visible');
  document.body.classList.remove('student-mode');
}

function toggleRole() { /* compat stub */ }


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
  if (name === 'modules')   renderModulesList();
  if (name === 'dashboard') renderDashboard();
  if (name === 'finance')   renderFinance();
  if (name === 'resources') renderResources();
  if (name === 'about')     renderAbout();
  if (name === 'admin') {
    renderAdminAnnouncements();
    renderAdminEvents('all');
    const c  = COURSES[activeCourse] || COURSES.psc31180;
    const el = document.getElementById('adminCourseIndicator');
    if (el) el.innerHTML = `<span style="font-size:12px;color:rgba(255,255,255,0.6);font-weight:500">${c.code} &mdash; ${c.instructor}</span>`;
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
  if (document.getElementById('view-modules').classList.contains('active'))  renderModulesList();
}

function switchCourseInline(id) {
  switchCourse(id);
  openModuleId = null;
  renderModulesList();
}


// ── DASHBOARD ─────────────────────────────────────────────────────────────────

function getActiveCourseData() {
  if (activeCourse === 'all') return { events: ALL_EVENTS, modules: [...MODULES, ...TAP_MODULES], course: null };
  const c = COURSES[activeCourse];
  return { events: c.events, modules: c.modules, course: c };
}

function renderDashboard() {
  const { events: courseEvents, modules: courseMods, course } = getActiveCourseData();

  renderDashboardAnnouncements();

  const metaEl = document.querySelector('#view-dashboard .page-hero-meta');
  if (metaEl) {
    if (course) metaEl.textContent = `${course.code} — ${course.title}`;
    else        metaEl.textContent = 'All courses — Fall 2025';
  }
  const h1El = document.querySelector('#view-dashboard h1');
  if (h1El) {
    if (isStudentMode) {
      h1El.innerHTML = `Welcome, <strong>${currentFirstName}.</strong><br>${course ? course.title : 'Fall 2025'}`;
    } else if (course) {
      h1El.innerHTML = `Welcome, <strong>${currentFirstName}.</strong><br>${course.title}`;
    } else {
      h1El.innerHTML = `All <strong>courses</strong><br>Fall 2025 overview`;
    }
  }

  const today = new Date();
  today.setHours(0,0,0,0);
  const DELIVERABLE_CATS = new Set(['homework','milestone','application']);
  const dueSoon = courseEvents
    .filter(e => DELIVERABLE_CATS.has(e.cat))
    .sort((a,b) => a.date.localeCompare(b.date))
    .slice(0, 6);

  const ul = document.getElementById('upcomingDeadlines');
  ul.innerHTML = dueSoon.length === 0
    ? `<div style="font-size:13px;color:var(--gray-mid);padding:1rem 0">No upcoming deliverables.</div>`
    : dueSoon.map(e => {
        const cat = CAT[e.cat];
        const cc  = courseColor(e.course);
        const cl  = courseLabel(e.course);
        const [yr,mo,dy] = e.date.split('-').map(Number);
        const eDate   = new Date(yr, mo-1, dy);
        const diffDays = Math.round((eDate - today) / 86400000);
        const mon      = MONTHS_FULL[mo-1].slice(0,3).toUpperCase();
        let daysLabel  = diffDays < 0 ? `${Math.abs(diffDays)}d ago` : diffDays === 0 ? 'Today' : `${diffDays}d away`;
        let daysClass  = diffDays <= 0 ? 'urgent' : diffDays <= 3 ? 'urgent' : diffDays <= 10 ? 'soon' : '';
        const mandatoryBadge = e.mandatory ? `<span class="badge-mandatory">Required</span>` : '';
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
              ${cat.label}${cl ? `<span class="dtl-course-chip" style="background:${cc}18;color:${cc}">${cl}</span>` : ''}${mandatoryBadge}
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
        const cat     = CAT[e.cat];
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
    const cat = CAT[e.cat];
    const [yr,mo,dy] = e.date.split('-').map(Number);
    const mon = MONTHS_FULL[mo-1].slice(0,3).toUpperCase();
    const rsvpd = rsvpSet.has(e.id);
    const needsRsvp = e.cat === 'guest' || e.course === 'joint';
    return `<div class="shared-event-row">
      <div class="shared-event-date"><span>${dy}</span><span>${mon}</span></div>
      <div class="shared-event-body">
        <div class="shared-event-title">${e.title}</div>
        <div class="shared-event-cat" style="color:${cat.color}">${cat.label}</div>
      </div>
      ${needsRsvp ? (e.locked
        ? `<span class="rsvp-btn" style="opacity:0.4;cursor:not-allowed;border-style:dashed">🔒</span>`
        : `<button onclick="toggleRsvp(event,${e.id})" class="rsvp-btn${rsvpd?' rsvpd':''}" id="rsvp-btn-${e.id}">${rsvpd?'✓ Going':'RSVP'}</button>`)
        : ''}
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
          const c = ANN_COLORS[a.color] || ANN_COLORS.maroon;
          const weekLabel = a.week_tag ? `<span class="ann-week-badge">Week ${a.week_tag}</span>` : '';
          return `<div class="announcement" style="border-left-color:${c.border};background:${c.bg}">
            <div class="announcement-title">${a.title}${weekLabel}</div>
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
    const c = ANN_COLORS[a.color] || ANN_COLORS.maroon;
    return `<div class="admin-list-row">
      <div class="admin-list-accent" style="background:${c.border}"></div>
      <div class="admin-list-body">
        <div class="admin-list-title">${a.title}${a.week_tag ? ` <span class="ann-week-badge">Week ${a.week_tag}</span>` : ''}</div>
        <div class="admin-list-meta">${a.body.slice(0,90)}${a.body.length>90?'…':''}</div>
      </div>
      <div class="admin-list-actions">
        <span class="badge" style="background:${c.bg};color:${c.border};font-size:10px">${a.color}</span>
        <button class="admin-btn-danger" onclick="deleteAnnouncement(${a.id})">Delete</button>
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
  const course         = document.getElementById('ev-course').value;
  if (!title || !date) return;
  const res = await api('POST', '/api/events', { title, date, cat, note, description, eventbrite_url, is_mandatory, course });
  if (res.ok) {
    const data = await res.json();
    ALL_EVENTS.push(transformEvent(data));
    ALL_EVENTS.sort((a,b) => a.date.localeCompare(b.date));
    updateCourseEvents();
    document.getElementById('ev-title').value       = '';
    document.getElementById('ev-date').value        = '';
    document.getElementById('ev-note').value        = '';
    document.getElementById('ev-description').value = '';
    document.getElementById('ev-eventbrite').value  = '';
    document.getElementById('ev-mandatory').checked = false;
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

async function toggleEventLocked(id) {
  const e = ALL_EVENTS.find(ev => ev.id === id);
  if (!e) return;
  const res = await api('PATCH', `/api/events/${id}`, { is_locked: e.locked ? 0 : 1 });
  if (res.ok) {
    e.locked    = !e.locked;
    e.is_locked = e.locked ? 1 : 0;
    renderCalendar();
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
    const cat = CAT[e.cat];
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
        </div>
        <div class="admin-list-meta">
          ${cat.label}
          ${cl ? `<span class="badge" style="background:${cc}18;color:${cc};font-size:10px;margin-left:4px">${cl}</span>` : ''}
          ${e.eventbrite_url ? ` · <span style="color:#185FA5;font-size:10px">Eventbrite</span>` : ''}
          ${e.note ? ' · ' + e.note.split('·')[0].trim() : ''}
        </div>
      </div>
      <div class="admin-list-actions" style="gap:6px">
        <button class="admin-btn-secondary" style="padding:5px 10px;font-size:10px" onclick="toggleEventHidden(${e.id})">${e.hidden?'Show':'Hide'}</button>
        <button class="admin-btn-secondary" style="padding:5px 10px;font-size:10px" onclick="toggleEventLocked(${e.id})">${e.locked?'Unlock':'Lock'}</button>
        <button class="admin-btn-danger" onclick="adminDeleteEvent(${e.id})">Delete</button>
      </div>
    </div>`;
  }).join('');
}


// ── RSVP ─────────────────────────────────────────────────────────────────────

async function toggleRsvp(e, eventId) {
  e.stopPropagation();
  const res = await api('POST', `/api/rsvps/${eventId}`);
  if (res.ok) {
    const data = await res.json();
    if (data.rsvpd) rsvpSet.add(eventId); else rsvpSet.delete(eventId);
    document.querySelectorAll(`#rsvp-btn-${eventId}`).forEach(btn => {
      btn.classList.toggle('rsvpd', rsvpSet.has(eventId));
      btn.textContent = rsvpSet.has(eventId) ? '✓ Going' : 'RSVP';
    });
    if (selectedDate) renderDayBody(selectedDate);
  }
}

function downloadIcs(eventId) {
  window.location.href = `/api/events/${eventId}/ics`;
}

function getRsvpableEvents() {
  return ALL_EVENTS.filter(e => e.cat === 'guest' || e.course === 'joint')
    .sort((a,b) => a.date.localeCompare(b.date));
}

async function renderAdminRsvps() {
  const el    = document.getElementById('adminRsvpList');
  const sumEl = document.getElementById('rsvpSummary');
  if (!el) return;

  const res = await fetch('/api/rsvps/all');
  if (res.ok) allRsvps = await res.json();

  const totalRsvpCount = Object.values(allRsvps).reduce((s,a) => s + a.length, 0);
  const rsvpEvents     = getRsvpableEvents();

  if (sumEl) {
    sumEl.innerHTML = `
      <div class="admin-rsvp-card"><div class="admin-rsvp-num">${rsvpEvents.length}</div><div class="admin-rsvp-label">RSVPable events</div></div>
      <div class="admin-rsvp-card"><div class="admin-rsvp-num">${students.length}</div><div class="admin-rsvp-label">Students enrolled</div></div>
      <div class="admin-rsvp-card"><div class="admin-rsvp-num">${totalRsvpCount}</div><div class="admin-rsvp-label">Confirmed RSVPs</div></div>`;
  }

  if (!rsvpEvents.length) {
    el.innerHTML = '<p style="color:var(--gray-mid);font-size:13px">No RSVPable events found.</p>';
    return;
  }

  el.innerHTML = rsvpEvents.map(e => {
    const cat = CAT[e.cat];
    const [yr,mo,dy] = e.date.split('-').map(Number);
    const mon       = MONTHS_FULL[mo-1].slice(0,3).toUpperCase();
    const confirmed = (allRsvps[e.id] || []).length;
    const pct       = students.length > 0 ? Math.round((confirmed / students.length) * 100) : 0;
    const names     = (allRsvps[e.id] || []).map(r => r.name).join(', ');
    return `<div class="admin-list-row">
      <div class="admin-list-accent" style="background:${e.course==='joint'?'#BA7517':cat.color}"></div>
      <div style="min-width:48px;text-align:center;flex-shrink:0">
        <div style="font-size:1.2rem;font-weight:700;line-height:1;color:var(--gray-brand)">${dy}</div>
        <div style="font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--gray-mid)">${mon}</div>
      </div>
      <div class="admin-list-body">
        <div class="admin-list-title">${e.title}</div>
        <div class="admin-list-meta">${cat.label}${e.note?' · '+e.note.split('·')[0].trim():''}</div>
        ${names ? `<div class="admin-list-meta" style="margin-top:4px;font-size:11px;color:var(--maroon)">${names}</div>` : ''}
        <div style="margin-top:8px;display:flex;align-items:center;gap:10px">
          <div style="flex:1;height:4px;background:var(--gray-border)">
            <div style="width:${pct}%;height:100%;background:${e.course==='joint'?'#BA7517':cat.color}"></div>
          </div>
          <span style="font-size:11px;font-weight:700;color:var(--gray-mid);white-space:nowrap">${confirmed} / ${students.length} confirmed</span>
        </div>
      </div>
    </div>`;
  }).join('');
}


// ── SYLLABUS ──────────────────────────────────────────────────────────────────

function accentForMod(mod) {
  const courseId = mod.course || (mod.id >= 10 ? 'psc31330' : 'psc31180');
  const c = COURSES[activeCourse === 'all' ? courseId : activeCourse];
  return c ? c.color : 'var(--maroon)';
}

function renderModulesList() {
  const { modules: courseMods, course } = getActiveCourseData();
  const metaEl = document.getElementById('syllabusHeroMeta');
  const h1El   = document.getElementById('syllabusHeroTitle');
  const subEl  = document.getElementById('syllabusHeroSub');
  if (course) {
    if (metaEl) metaEl.textContent = course.code + ' — ' + course.instructor;
    if (h1El)  h1El.innerHTML = `${course.code} <strong>Syllabus</strong>`;
    if (subEl) subEl.textContent = course.location + ' · Mon/Wed 3:30–4:45 PM';
  } else {
    if (metaEl) metaEl.textContent = 'All courses — Fall 2025';
    if (h1El)  h1El.innerHTML = `All courses <strong>Syllabus</strong>`;
    if (subEl) subEl.textContent = '';
  }
  const acc = document.getElementById('syllabusAccordion');
  if (!acc) return;
  acc.innerHTML = courseMods.map(mod => renderModuleRow(mod)).join('');
}

function renderModuleRow(mod) {
  const accent = accentForMod(mod);
  const isOpen = openModuleId === mod.id;
  const tab    = activeTab[mod.id] || 'overview';
  const statusColor = mod.status==='Complete' ? '#1D9E75' : mod.status==='In progress' ? accent : '#888';
  const updatedStr = mod.last_updated_at
    ? `<span style="font-size:10px;color:var(--gray-mid);margin-left:8px">Updated ${mod.last_updated_at.split(' ')[0]}${mod.last_updated_by?' by '+mod.last_updated_by:''}</span>`
    : '';
  return `<div class="syl-module${isOpen?' open':''}" id="syl-mod-${mod.id}">
    <div class="syl-module-header" onclick="toggleModule(${mod.id})">
      <div class="syl-module-accent" style="background:${accent}"></div>
      <div class="syl-module-header-inner">
        <div class="syl-module-left">
          <span class="syl-module-label" style="color:${accent}">${mod.label}</span>
          <span class="syl-module-title">${mod.title}</span>
          ${updatedStr}
        </div>
        <div class="syl-module-meta">
          <div class="syl-module-progress-bar"><div class="syl-module-progress-fill" style="width:${mod.progress}%;background:${accent}"></div></div>
          <span class="badge" style="background:${accent}18;color:${statusColor};font-size:10px">${mod.status}</span>
          <span class="syl-module-weeks">${mod.weeks}</span>
        </div>
      </div>
      <div class="syl-module-chevron">&#9654;</div>
    </div>
    <div class="syl-module-body">
      <div class="syl-tabs">
        ${['overview','sessions','deliverables','readings','events'].map(t =>
          `<button class="syl-tab${tab===t?' active':''}" onclick="switchTab(event,${mod.id},'${t}')">${t.charAt(0).toUpperCase()+t.slice(1)}</button>`
        ).join('')}
      </div>
      <div class="syl-tab-panels">
        ${renderTabPanel(mod,'overview',     tab==='overview')}
        ${renderTabPanel(mod,'sessions',     tab==='sessions')}
        ${renderTabPanel(mod,'deliverables', tab==='deliverables')}
        ${renderTabPanel(mod,'readings',     tab==='readings')}
        ${renderTabPanel(mod,'events',       tab==='events')}
      </div>
    </div>
  </div>`;
}

function renderTabPanel(mod, name, isActive) {
  const accent = accentForMod(mod);
  let html = '';

  if (name === 'overview') {
    html = `<div class="syl-overview-grid">
      <div class="syl-overview-desc">${mod.desc || mod.description || ''}</div>
      <div class="syl-status-block">
        <div class="syl-status-row"><span class="syl-status-key">Period</span><span class="syl-status-val">${mod.weeks}</span></div>
        <div class="syl-status-row"><span class="syl-status-key">Status</span><span class="syl-status-val">${mod.status}</span></div>
        <div class="syl-status-row"><span class="syl-status-key">Sessions</span><span class="syl-status-val">${mod.sessions.length}</span></div>
        <div class="syl-status-row"><span class="syl-status-key">Deliverables</span><span class="syl-status-val">${mod.deliverables.length}</span></div>
        <div class="syl-status-row"><span class="syl-status-key">Readings</span><span class="syl-status-val">${(mod.readings||[]).length}</span></div>
        ${mod.last_updated_at ? `<div class="syl-status-row"><span class="syl-status-key">Updated</span><span class="syl-status-val">${mod.last_updated_at.split(' ')[0]}</span></div>` : ''}
      </div>
    </div>`;
  }
  else if (name === 'sessions') {
    if (!mod.sessions.length) { html = '<p style="color:var(--gray-mid);font-size:13px">No sessions listed.</p>'; }
    else html = mod.sessions.map(s => `
      <div class="syl-session-row">
        <div class="syl-session-date">${s.date || s.date_label}</div>
        <div style="flex:1">
          <div class="syl-session-title">${s.title}</div>
          ${s.note ? `<div class="syl-session-note">${s.note}</div>` : ''}
        </div>
        ${(s.isJoint || s.is_joint) ? `<span class="syl-joint-badge">Joint</span>` : ''}
      </div>`).join('');
  }
  else if (name === 'deliverables') {
    if (!mod.deliverables.length) { html = '<p style="color:var(--gray-mid);font-size:13px">No deliverables listed.</p>'; }
    else html = mod.deliverables.map(d => {
      const cat = CAT[d.cat] || CAT.homework;
      return `<div class="syl-deliv-row">
        <div class="syl-deliv-dot" style="background:${cat.color}"></div>
        <div style="flex:1">
          <div class="syl-deliv-title">${d.title}</div>
          <div class="syl-deliv-meta">${cat.label}${d.note ? ' · ' + d.note : ''}</div>
        </div>
        <div class="syl-deliv-due">Due ${d.due || d.due_date}</div>
      </div>`;
    }).join('');
  }
  else if (name === 'readings') {
    const readings = mod.readings || [];
    if (!readings.length) { html = '<p style="color:var(--gray-mid);font-size:13px">No readings listed.</p>'; }
    else html = readings.map(r => {
      const typeBg    = r.type==='PDF' ? '#E1F5EE' : r.type==='Book' ? '#f5e8e8' : '#E6F1FB';
      const typeColor = r.type==='PDF' ? '#085041' : r.type==='Book' ? '#6B1313'  : '#0C447C';
      return `<div class="syl-reading-row">
        <span class="syl-reading-type" style="background:${typeBg};color:${typeColor}">${r.type}</span>
        <div class="syl-reading-body">
          <div class="syl-reading-title">${r.title}</div>
          <div class="syl-reading-when">For ${r.when || r.when_label}</div>
          ${(r.desc || r.description) ? `<div class="syl-reading-desc">${r.desc || r.description}</div>` : ''}
        </div>
        <button class="syl-reading-open">Open
          <svg width="28" height="11" viewBox="0 0 90 37"><path d="M68.303 33.788l3.203 3.202L90 18.496 71.506 0l-3.203 3.202 13.028 13.029H0v4.528h81.331L68.303 33.788z" fill="currentColor"/></svg>
        </button>
      </div>`;
    }).join('');
  }
  else if (name === 'events') {
    const courseId = mod.course || (mod.id >= 10 ? 'psc31330' : 'psc31180');
    const sessionTitles = new Set(mod.sessions.map(s => s.title.toLowerCase().slice(0,30)));
    const linkedEvents  = ALL_EVENTS
      .filter(e =>
        (e.course === courseId || e.course === 'joint') &&
        (sessionTitles.has(e.title.toLowerCase().slice(0,30)) ||
         mod.sessions.some(s => e.date && s.date && s.date.replace(/^[A-Z][a-z]+ /,'').split(' ').some(part => e.date.endsWith(String(part).replace(/^0/,'').padStart(2,'0')))))
      )
      .sort((a,b) => a.date.localeCompare(b.date));

    if (!linkedEvents.length) {
      html = `<div style="padding:0.5rem 0">
        <p style="color:var(--gray-mid);font-size:13px;margin-bottom:1rem">No linked events found for this module.</p>
        <button class="cta-arrow" onclick="showView('calendar')" style="font-size:11px;display:inline-flex;gap:8px">View full calendar <svg width="30" height="12" viewBox="0 0 90 37"><path d="M68.303 33.788l3.203 3.202L90 18.496 71.506 0l-3.203 3.202 13.028 13.029H0v4.528h81.331L68.303 33.788z" fill="currentColor"/></svg></button>
      </div>`;
    } else {
      html = linkedEvents.map(e => {
        const cat     = CAT[e.cat];
        const isJoint = e.course === 'joint';
        const [yr,mo,dy] = e.date.split('-').map(Number);
        const mon     = MONTHS_FULL[mo-1].slice(0,3).toUpperCase();
        const needsRsvp = e.cat === 'guest' || isJoint;
        const rsvpd   = rsvpSet.has(e.id);
        return `<div class="syl-session-row" style="align-items:center">
          <div class="syl-session-date" style="min-width:64px">
            <span style="font-size:1.3rem;font-weight:700;line-height:1;color:var(--gray-brand);display:block;letter-spacing:-0.5px">${dy}</span>
            <span style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--gray-mid)">${mon}</span>
          </div>
          <div style="flex:1;min-width:0">
            <div class="syl-session-title">${e.title}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap">
              <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${isJoint?'#BA7517':cat.color}">${cat.label}</span>
              ${isJoint ? `<span class="syl-joint-badge">Joint</span>` : ''}
              ${e.mandatory ? `<span class="badge-mandatory">Required</span>` : ''}
              ${e.note ? `<span style="font-size:11px;color:var(--gray-mid)">${e.note.split('·')[0].trim()}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;margin-left:8px">
            ${needsRsvp ? (e.locked
              ? `<span class="rsvp-btn" style="opacity:0.4;cursor:not-allowed;border-style:dashed">🔒 Locked</span>`
              : `<button onclick="toggleRsvp(event,${e.id})" class="rsvp-btn${rsvpd?' rsvpd':''}" id="rsvp-btn-${e.id}">${rsvpd?'✓ Going':'RSVP'}</button>`)
              : ''}
            <button class="syl-reading-open" onclick="openDayPanel('${e.date}')" style="white-space:nowrap">
              View <svg width="24" height="10" viewBox="0 0 90 37"><path d="M68.303 33.788l3.203 3.202L90 18.496 71.506 0l-3.203 3.202 13.028 13.029H0v4.528h81.331L68.303 33.788z" fill="currentColor"/></svg>
            </button>
          </div>
        </div>`;
      }).join('');
    }
  }

  return `<div class="syl-tab-panel${isActive?' active':''}" id="syl-panel-${mod.id}-${name}">${html}</div>`;
}

function toggleModule(id) {
  openModuleId = openModuleId === id ? null : id;
  if (openModuleId && !activeTab[id]) activeTab[id] = 'overview';
  renderModulesList();
  if (openModuleId) {
    setTimeout(() => {
      const el = document.getElementById(`syl-mod-${id}`);
      if (el) el.scrollIntoView({behavior:'smooth', block:'nearest'});
    }, 50);
  }
}

function switchTab(e, modId, tab) {
  e.stopPropagation();
  activeTab[modId] = tab;
  const modEl = document.getElementById(`syl-mod-${modId}`);
  if (!modEl) return;
  modEl.querySelectorAll('.syl-tab').forEach((t,i) => {
    const tabs = ['overview','sessions','deliverables','readings','events'];
    t.classList.toggle('active', tabs[i] === tab);
  });
  modEl.querySelectorAll('.syl-tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `syl-panel-${modId}-${tab}`);
  });
}

function openModuleDetail(id) { toggleModule(id); }
function closeModuleDetail() {
  openModuleId = null;
  document.getElementById('modules-list-view').style.display  = 'block';
  document.getElementById('module-detail-view').style.display = 'none';
  renderModulesList();
}

// ── ADMIN SYLLABUS EDITOR ─────────────────────────────────────────────────────

function renderAdminSyllabus() {
  const el = document.getElementById('adminSyllabusList');
  if (!el) return;
  const { modules } = getActiveCourseData();
  el.innerHTML = modules.map(mod => {
    const accent = accentForMod(mod);
    const isOpen = adminSylOpen === mod.id;
    return `<div class="admin-syl-row${isOpen?' open':''}" id="asyl-${mod.id}">
      <div class="admin-syl-header" onclick="toggleAdminSyl(${mod.id})">
        <div style="width:4px;height:28px;background:${accent};flex-shrink:0"></div>
        <div style="flex:1">
          <span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${accent};margin-right:10px">${mod.label}</span>
          <span style="font-size:13px;font-weight:600;color:var(--gray-brand)">${mod.title}</span>
        </div>
        <span class="badge" style="background:${accent}18;color:${accent};font-size:10px">${mod.status}</span>
        <span class="admin-syl-chevron">&#9654;</span>
      </div>
      <div class="admin-syl-body">
        <div class="admin-row-2" style="margin-bottom:1rem">
          <div class="form-group">
            <label class="form-label">Title</label>
            <input class="form-input" id="asyl-title-${mod.id}" value="${mod.title}">
          </div>
          <div class="form-group">
            <label class="form-label">Period (weeks)</label>
            <input class="form-input" id="asyl-weeks-${mod.id}" value="${mod.weeks}">
          </div>
        </div>
        <div class="form-group" style="margin-bottom:1rem">
          <label class="form-label">Description</label>
          <textarea class="form-input" id="asyl-desc-${mod.id}" rows="3">${mod.desc || mod.description || ''}</textarea>
        </div>
        <div class="admin-row-3" style="margin-bottom:1rem">
          <div class="form-group">
            <label class="form-label">Status</label>
            <select class="form-input" id="asyl-status-${mod.id}">
              <option${mod.status==='Complete'?' selected':''}>Complete</option>
              <option${mod.status==='In progress'?' selected':''}>In progress</option>
              <option${mod.status==='Upcoming'?' selected':''}>Upcoming</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Progress (%)</label>
            <input class="form-input" type="number" min="0" max="100" id="asyl-prog-${mod.id}" value="${mod.progress}">
          </div>
        </div>
        ${mod.last_updated_at ? `<p style="font-size:11px;color:var(--gray-mid);margin-bottom:1rem">Last saved: ${mod.last_updated_at.split(' ')[0]}${mod.last_updated_by?' by '+mod.last_updated_by:''}</p>` : ''}
        <button class="admin-btn-primary" onclick="saveModuleEdit(${mod.id})">Save changes</button>
      </div>
    </div>`;
  }).join('');
}

function toggleAdminSyl(id) {
  adminSylOpen = adminSylOpen === id ? null : id;
  renderAdminSyllabus();
}

async function saveModuleEdit(id) {
  const allMods = [...MODULES, ...TAP_MODULES];
  const mod = allMods.find(m => m.id === id);
  if (!mod) return;
  const title       = document.getElementById(`asyl-title-${id}`).value.trim() || mod.title;
  const weeks       = document.getElementById(`asyl-weeks-${id}`).value.trim() || mod.weeks;
  const description = document.getElementById(`asyl-desc-${id}`).value.trim();
  const status      = document.getElementById(`asyl-status-${id}`).value;
  const progress    = parseInt(document.getElementById(`asyl-prog-${id}`).value) || 0;
  const res = await api('PATCH', `/api/modules/${id}`, { title, weeks, description, status, progress });
  if (res.ok) {
    mod.title = title; mod.weeks = weeks; mod.description = description;
    mod.desc  = description; mod.status = status; mod.progress = progress;
    mod.last_updated_at = new Date().toISOString().slice(0,10);
    renderModulesList();
    renderAdminSyllabus();
    const btn = document.querySelector(`#asyl-${id} .admin-btn-primary`);
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Saved'; setTimeout(() => btn.textContent = orig, 1500); }
  }
}


// ── STUDENTS ──────────────────────────────────────────────────────────────────

async function addStudent() {
  const name   = document.getElementById('stu-name').value.trim();
  const email  = document.getElementById('stu-email').value.trim();
  const course = document.getElementById('stu-course').value;
  if (!name || !email) return;
  const res = await api('POST', '/api/students', { name, email, course });
  if (res.ok) {
    const data = await res.json();
    students.push(transformStudent(data));
    document.getElementById('stu-name').value  = '';
    document.getElementById('stu-email').value = '';
    renderAdminStudents();
  } else {
    const err = await res.json();
    alert(err.error || 'Could not add student');
  }
}

async function removeStudent(id) {
  if (!confirm('Permanently delete this student? Use "Deactivate" to keep their data as alumni.')) return;
  const res = await api('DELETE', `/api/students/${id}`);
  if (res.ok) {
    students = students.filter(s => s.id !== id);
    renderAdminStudents();
  }
}

async function toggleStudentActive(id) {
  const s = students.find(s => s.id === id);
  if (!s) return;
  const res = await api('POST', `/api/students/${id}/toggle-active`);
  if (res.ok) {
    const data = await res.json();
    s.is_active = data.is_active;
    renderAdminStudents();
  }
}

async function importStudentsCSV() {
  const fileInput = document.getElementById('csvFileInput');
  const resultEl  = document.getElementById('csvImportResult');
  if (!fileInput.files.length) {
    resultEl.textContent = 'Please select a CSV file first.';
    resultEl.style.color = '#A32D2D';
    return;
  }
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  const res  = await fetch('/api/students/import', { method:'POST', body: formData });
  const data = await res.json();
  if (res.ok) {
    resultEl.style.color = '#1D9E75';
    resultEl.textContent = `✓ Imported ${data.added} student${data.added !== 1 ? 's' : ''}. ${data.skipped ? data.skipped + ' skipped (already exist). ' : ''}${data.errors.length ? data.errors.join('; ') : ''}`;
    const stuRes  = await fetch('/api/students');
    const stuData = await stuRes.json();
    students = stuData.map(transformStudent);
    renderAdminStudents();
  } else {
    resultEl.style.color = '#A32D2D';
    resultEl.textContent = data.error || 'Import failed.';
  }
}

function downloadCsvTemplate(e) {
  e.preventDefault();
  const csv  = 'name,email,course\nJane Smith,jsmith@ccny.cuny.edu,psc31180\nJohn Doe,jdoe@ccny.cuny.edu,psc31330\n';
  const blob = new Blob([csv], { type:'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'moynihan_students_template.csv'; a.click();
  URL.revokeObjectURL(url);
}

let showInactiveStudents = false;

function renderAdminStudents() {
  const el      = document.getElementById('adminStudentList');
  const countEl = document.getElementById('studentCount');
  if (!el) return;
  const active   = students.filter(s => s.is_active);
  const inactive = students.filter(s => !s.is_active);
  if (countEl) countEl.textContent = `(${active.length} active${inactive.length ? ', ' + inactive.length + ' alumni' : ''})`;

  const visible = showInactiveStudents ? students : active;
  if (!visible.length) {
    el.innerHTML = '<p style="color:var(--gray-mid);font-size:13px;padding:1rem 0">No students enrolled yet.</p>';
    return;
  }

  const toggleBtn = document.getElementById('toggleInactiveBtn');
  if (toggleBtn) {
    toggleBtn.textContent = showInactiveStudents
      ? `Hide alumni (${inactive.length})`
      : `Show alumni (${inactive.length})`;
    toggleBtn.style.display = inactive.length ? '' : 'none';
  }

  el.innerHTML = visible.map(s => {
    const c   = COURSES[s.course];
    const cc  = c ? c.color : 'var(--gray-mid)';
    const isAlumni = !s.is_active;
    return `<div class="admin-list-row" style="opacity:${isAlumni?0.6:1}">
      <div class="admin-list-accent" style="background:${isAlumni?'#bbb':cc}"></div>
      <div style="width:34px;height:34px;border-radius:50%;background:${cc}18;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;font-weight:700;color:${cc}">
        ${(s.name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
      </div>
      <div class="admin-list-body">
        <div class="admin-list-title">
          ${s.name}
          ${isAlumni ? `<span style="font-size:10px;font-weight:700;background:var(--gray-light);color:var(--gray-mid);padding:2px 7px;margin-left:6px">Alumni</span>` : ''}
        </div>
        <div class="admin-list-meta">${s.email} &middot; ${c ? c.code : s.course} &middot; <span style="font-family:monospace">@${s.username}</span></div>
      </div>
      <div class="admin-list-actions">
        <button class="admin-btn-secondary" style="padding:5px 10px;font-size:10px" onclick="toggleStudentActive(${s.id})">${isAlumni?'Reactivate':'Deactivate'}</button>
        <button class="admin-btn-danger" onclick="removeStudent(${s.id})">Remove</button>
      </div>
    </div>`;
  }).join('');
}

function toggleInactiveStudents() {
  showInactiveStudents = !showInactiveStudents;
  renderAdminStudents();
}


// ── ADMIN USERS ───────────────────────────────────────────────────────────────

async function addAdminUser() {
  const name     = document.getElementById('au-name').value.trim();
  const username = document.getElementById('au-username').value.trim().toLowerCase();
  const password = document.getElementById('au-password').value.trim();
  const role     = document.getElementById('au-role').value;
  const course   = document.getElementById('au-course').value;
  if (!name || !username || !password) return;
  const res = await api('POST', '/api/admin/users', { name, username, password, role, course });
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
  const res = await api('PATCH', `/api/admin/users/${id}`, { is_active: u.active ? 0 : 1 });
  if (res.ok) { u.active = !u.active; renderAdminUsers(); }
}

async function removeAdminUser(id) {
  const u = adminUsers.find(u => u.id === id);
  if (!u || u.you) return;
  if (!confirm(`Remove admin access for ${u.name}?`)) return;
  const res = await api('DELETE', `/api/admin/users/${id}`);
  if (res.ok) { adminUsers = adminUsers.filter(a => a.id !== id); renderAdminUsers(); }
}

async function resetPassword(id) {
  const u = adminUsers.find(u => u.id === id);
  if (!u || u.you) return;
  const newPass = prompt(`Set new password for ${u.name}:`, '');
  if (!newPass || !newPass.trim()) return;
  const res = await api('PATCH', `/api/admin/users/${id}`, { password: newPass.trim() });
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
          <button class="admin-btn-secondary" style="padding:5px 10px;font-size:10px" onclick="resetPassword(${u.id})">Reset pw</button>
          <button class="admin-btn-secondary" style="padding:5px 10px;font-size:10px" onclick="toggleAdminUserActive(${u.id})">${u.active?'Suspend':'Restore'}</button>
          <button class="admin-btn-danger" onclick="removeAdminUser(${u.id})">Remove</button>
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
  if (name === 'rsvps')         renderAdminRsvps();
  if (name === 'syllabus')      renderAdminSyllabus();
  if (name === 'students')      renderAdminStudents();
  if (name === 'users')         renderAdminUsers();
  if (name === 'finance')       renderAdminFinance();
  if (name === 'resources')     renderAdminResources();
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
  if (course === 'psc31180') return '31180';
  if (course === 'psc31330') return 'TAP';
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

function renderCalendar() {
  document.getElementById('calMonthTitle').textContent = `${MONTHS_FULL[calMonth]} ${calYear}`;
  const filterBar = document.getElementById('calFilterBar');
  if (filterBar) {
    const filters = [
      { id:'psc31180', label:'PSC 31180', color:'#8B1A1A' },
      { id:'psc31330', label:'TAP 31330', color:'#185FA5' },
      { id:'all',      label:'All courses', color:'#BA7517' },
    ];
    filterBar.innerHTML = filters.map(f =>
      `<button class="cal-filter-pill${calFilterCourse===f.id?' active':''}" onclick="setCalFilter('${f.id}')">
        <div class="cal-filter-pill-dot" style="background:${f.color}"></div>${f.label}
      </button>`
    ).join('');
  }
  document.getElementById('calLegend').innerHTML = CATS.map(c =>
    `<div class="cal-legend-item"><div class="cal-legend-dot" style="background:${c.color}"></div>${c.label}</div>`
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
      const cat = CAT[e.cat];
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
    const cat   = CAT[e.cat];
    const cc    = courseColor(e.course);
    const cl    = courseLabel(e.course);
    const needsRsvp = e.cat === 'guest' || e.course === 'joint';
    const rsvpd = rsvpSet.has(e.id);
    const adminBadges = !isStudentMode ? `
      ${e.hidden ? `<span class="admin-status-chip" style="background:#333;color:#ccc;margin-right:4px">Hidden</span>` : ''}
      ${e.locked ? `<span class="admin-status-chip" style="background:#FAECE7;color:#D85A30;margin-right:4px">🔒 Locked</span>` : ''}
    ` : '';
    const mandatoryBadge = e.mandatory ? `<span class="badge-mandatory" style="margin-left:4px">Required</span>` : '';
    const rsvpBtn = needsRsvp
      ? (e.locked
          ? `<span class="rsvp-btn" style="opacity:0.4;cursor:not-allowed;border-style:dashed;display:inline-block;margin-top:10px">🔒 Locked</span>`
          : `<button onclick="toggleRsvp(event,${e.id})" class="rsvp-btn${rsvpd?' rsvpd':''}" id="rsvp-btn-${e.id}" style="margin-top:10px">${rsvpd?'✓ Going':'RSVP'}</button>`)
      : '';
    const calBtn  = `<button class="btn-sm" onclick="downloadIcs(${e.id})" style="margin-top:8px;font-size:11px;display:inline-flex;align-items:center;gap:5px">📅 Add to calendar</button>`;
    const ebBtn   = e.eventbrite_url ? `<a href="${e.eventbrite_url}" target="_blank" rel="noopener" class="btn-sm btn-primary" style="margin-top:8px;font-size:11px;display:inline-flex;align-items:center;gap:5px;text-decoration:none">🎟 Register on Eventbrite</a>` : '';
    const descHtml = e.description ? `<div class="panel-event-desc">${e.description}</div>` : '';
    return `<div class="panel-event-item" style="${e.hidden&&!isStudentMode?'opacity:0.6':''}">
      <div class="panel-event-accent" style="background:${e.locked?'#ccc':cat.color}"></div>
      <div class="panel-event-content">
        <div class="panel-event-cat" style="color:${cat.color}">${cat.label}${cl?`<span class="course-badge" style="background:${cc}22;color:${cc}">${cl}</span>`:''}${mandatoryBadge}</div>
        <div class="panel-event-title">${e.title}</div>
        ${adminBadges}
        ${e.note ? `<div class="panel-event-note">${e.note}</div>` : ''}
        ${descHtml}
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
          ${rsvpBtn}
          ${ebBtn}
          ${calBtn}
        </div>
      </div>
      ${!isStudentMode ? `<button class="panel-event-delete" onclick="deleteEvent(${e.id})" title="Remove">Remove</button>` : ''}
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
        <label class="form-label">Eventbrite URL <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
        <input class="form-input" id="fEventbrite" type="url" placeholder="https://www.eventbrite.com/e/...">
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


// ── FINANCE ───────────────────────────────────────────────────────────────────

function renderFinance() {
  const el = document.getElementById('financeChecklist');
  if (!el) return;
  const done  = financeItems.filter(i => financeChecked.has(i.id)).length;
  const total = financeItems.length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  const progressEl = document.getElementById('financeProgress');
  if (progressEl) {
    progressEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:13px;font-weight:600;color:var(--gray-brand)">${done} of ${total} completed</span>
        <span style="font-size:13px;font-weight:700;color:var(--maroon)">${pct}%</span>
      </div>
      <div style="height:6px;background:var(--gray-border);border-radius:3px">
        <div style="width:${pct}%;height:100%;background:var(--maroon);border-radius:3px;transition:width 0.3s"></div>
      </div>`;
  }

  if (!financeItems.length) {
    el.innerHTML = `<div style="font-size:13px;color:var(--gray-mid);padding:2rem 0;text-align:center">No finance items have been added yet.<br><span style="font-size:12px">Your instructor will add W-2s, stipend info, and FAFSA reminders here.</span></div>`;
    return;
  }

  const cats = [...new Set(financeItems.map(i => i.category))];
  el.innerHTML = cats.map(cat => {
    const items = financeItems.filter(i => i.category === cat);
    return `<div class="finance-cat-group">
      <div class="finance-cat-label">${cat.charAt(0).toUpperCase() + cat.slice(1)}</div>
      ${items.map(item => {
        const checked = financeChecked.has(item.id);
        return `<div class="finance-item${checked?' checked':''}">
          <button class="finance-checkbox${checked?' checked':''}" onclick="toggleFinanceCheck(${item.id})" title="${checked?'Mark incomplete':'Mark complete'}">
            ${checked ? '&#10003;' : ''}
          </button>
          <div class="finance-item-body">
            <div class="finance-item-title">${item.title}${item.is_required?` <span class="badge-mandatory">Required</span>`:''}</div>
            ${item.description ? `<div class="finance-item-desc">${item.description}</div>` : ''}
            ${item.due_label ? `<div class="finance-item-due">Due: ${item.due_label}</div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

async function toggleFinanceCheck(itemId) {
  const res = await api('POST', `/api/finance/${itemId}/check`);
  if (res.ok) {
    const data = await res.json();
    if (data.checked) financeChecked.add(itemId);
    else financeChecked.delete(itemId);
    const item = financeItems.find(i => i.id === itemId);
    if (item) item.checked = data.checked;
    renderFinance();
  }
}

// Admin finance management
function renderAdminFinance() {
  const el = document.getElementById('adminFinanceList');
  if (!el) return;
  if (!financeItems.length) {
    el.innerHTML = '<p style="color:var(--gray-mid);font-size:13px;padding:1rem 0">No finance items yet. Add W-2 reminders, FAFSA deadlines, stipend info, etc.</p>';
    return;
  }
  el.innerHTML = financeItems.map(item => `
    <div class="admin-list-row">
      <div class="admin-list-accent" style="background:var(--maroon)"></div>
      <div class="admin-list-body">
        <div class="admin-list-title">${item.title}${item.is_required?` <span class="badge-mandatory">Required</span>`:''}</div>
        <div class="admin-list-meta">${item.category}${item.due_label?' · Due: '+item.due_label:''}${item.description?' · '+item.description.slice(0,60):''}</div>
      </div>
      <div class="admin-list-actions">
        <button class="admin-btn-danger" onclick="deleteFinanceItem(${item.id})">Delete</button>
      </div>
    </div>`).join('');
}

async function addFinanceItem() {
  const title       = document.getElementById('fin-title').value.trim();
  const description = document.getElementById('fin-desc').value.trim();
  const due_label   = document.getElementById('fin-due').value.trim();
  const category    = document.getElementById('fin-cat').value;
  const is_required = document.getElementById('fin-required').checked;
  if (!title) return;
  const res = await api('POST', '/api/finance', { title, description, due_label, category, is_required });
  if (res.ok) {
    const data = await res.json();
    data.checked = false;
    financeItems.push(data);
    document.getElementById('fin-title').value = '';
    document.getElementById('fin-desc').value  = '';
    document.getElementById('fin-due').value   = '';
    renderAdminFinance();
  }
}

async function deleteFinanceItem(id) {
  const res = await api('DELETE', `/api/finance/${id}`);
  if (res.ok) {
    financeItems = financeItems.filter(i => i.id !== id);
    financeChecked.delete(id);
    renderAdminFinance();
    renderFinance();
  }
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
        <button class="admin-btn-danger" onclick="deleteResource(${r.id})">Delete</button>
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

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loginUser').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('loginPass').focus();
  });
  document.getElementById('loginPass').addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptLogin();
  });
});
