// ── CONSTANTS ────────────────────────────────────────────────────────────────

const CATS = [
  { id:'lecture',     label:'Lecture / class',     color:'#8B1A1A', bg:'#f5e8e8' },
  { id:'meeting',     label:'Meeting / check-in',  color:'#7B3D8F', bg:'#F3EAF8' },
  { id:'reading',     label:'Reading / prep',      color:'#1D9E75', bg:'#E1F5EE' },
  { id:'homework',    label:'Homework deadline',   color:'#D85A30', bg:'#FAECE7' },
  { id:'application', label:'Application deadline',color:'#A32D2D', bg:'#FCEBEB' },
  { id:'guest',       label:'Guest speaker',       color:'#185FA5', bg:'#E6F1FB' },
  { id:'milestone',   label:'Student milestone',   color:'#BA7517', bg:'#FAEEDA' },
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
let formRequests    = [];

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
let openModuleId    = null;
let activeTab       = {};
let eventsFilter    = 'all';
let adminSylOpen    = null;
let showPassFor     = new Set();
let annWeekFilter   = '';
let dashWindow      = 'month'; // 'week' | 'month' | 'all'


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

  resources     = resData;
  formRequests  = [];

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
  resources = []; formRequests = [];
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
  if (name === 'forms')     renderFormsView();
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
    return `<div class="admin-list-row" style="opacity:${isAlumni?0.6:1};flex-wrap:wrap;align-items:flex-start">
      <div class="admin-list-accent" style="background:${isAlumni?'#bbb':cc}"></div>
      <div style="width:34px;height:34px;border-radius:50%;background:${cc}18;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;font-weight:700;color:${cc};margin-top:2px">
        ${(s.name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
      </div>
      <div class="admin-list-body" style="flex:1;min-width:0">
        <div class="admin-list-title">
          ${s.name}
          ${isAlumni ? `<span style="font-size:10px;font-weight:700;background:var(--gray-light);color:var(--gray-mid);padding:2px 7px;margin-left:6px">Alumni</span>` : ''}
        </div>
        <div class="admin-list-meta">${s.email} &middot; ${c ? c.code : s.course} &middot; <span style="font-family:monospace">@${s.username}</span></div>
      </div>
      <div class="admin-list-actions">
        <button class="admin-btn-secondary" style="padding:5px 10px;font-size:10px" onclick="toggleStudentNotes(${s.id})">Notes</button>
        <button class="admin-btn-secondary" style="padding:5px 10px;font-size:10px" onclick="toggleStudentActive(${s.id})">${isAlumni?'Reactivate':'Deactivate'}</button>
        <button class="admin-btn-danger" onclick="removeStudent(${s.id})">Remove</button>
      </div>
      <div class="student-notes-panel" id="snotes-${s.id}" style="display:none;width:100%;margin-top:0.75rem;padding:0.75rem;background:var(--gray-light);border-radius:6px;margin-left:8px">
        <div id="snotes-list-${s.id}" style="margin-bottom:0.75rem"></div>
        <div style="display:flex;gap:8px">
          <textarea id="snotes-input-${s.id}" placeholder="Add a note…" rows="2" style="flex:1;font-size:12px;padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-family:inherit;resize:vertical"></textarea>
          <button class="admin-btn-primary" style="align-self:flex-end;padding:6px 14px;font-size:12px" onclick="submitStudentNote(${s.id})">Save</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleInactiveStudents() {
  showInactiveStudents = !showInactiveStudents;
  renderAdminStudents();
}

async function toggleStudentNotes(id) {
  const panel = document.getElementById(`snotes-${id}`);
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  if (isOpen) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  await loadStudentNotes(id);
}

async function loadStudentNotes(id) {
  const listEl = document.getElementById(`snotes-list-${id}`);
  if (!listEl) return;
  listEl.innerHTML = '<span style="font-size:12px;color:var(--gray-mid)">Loading…</span>';
  const res = await fetch(`/api/students/${id}/notes`);
  if (!res.ok) { listEl.innerHTML = ''; return; }
  const notes = await res.json();
  if (!notes.length) {
    listEl.innerHTML = '<span style="font-size:12px;color:var(--gray-mid)">No notes yet.</span>';
    return;
  }
  listEl.innerHTML = notes.map(n => {
    const d = new Date(n.created_at + 'Z');
    const ts = d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
             + ' · ' + d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
    return `<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:0.5rem;padding-bottom:0.5rem;border-bottom:1px solid #e8e8e8">
      <span style="flex-shrink:0;background:var(--maroon);color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;margin-top:2px">${escHtml(n.author_initials||'?')}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;line-height:1.4">${escHtml(n.body)}</div>
        <div style="font-size:10px;color:var(--gray-mid);margin-top:2px">${escHtml(n.author_name)} &middot; ${ts}</div>
      </div>
      <button onclick="deleteStudentNote(${n.id},${id})" style="border:none;background:none;cursor:pointer;color:#bbb;font-size:14px;padding:0;line-height:1" title="Delete note">&times;</button>
    </div>`;
  }).join('');
}

async function submitStudentNote(id) {
  const input = document.getElementById(`snotes-input-${id}`);
  const body = (input ? input.value : '').trim();
  if (!body) return;
  const res = await api('POST', `/api/students/${id}/notes`, { body });
  if (res.ok) {
    input.value = '';
    await loadStudentNotes(id);
  } else {
    const err = await res.json();
    alert(err.error || 'Could not save note');
  }
}

async function deleteStudentNote(noteId, studentId) {
  if (!confirm('Delete this note?')) return;
  const res = await api('DELETE', `/api/student-notes/${noteId}`);
  if (res.ok) await loadStudentNotes(studentId);
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
  if (name === 'forms')         renderAdminForms();
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
    el.innerHTML = `<div style="font-size:13px;color:var(--gray-mid);padding:2rem 0;text-align:center">No checklist items have been added yet.<br><span style="font-size:12px">Program staff will add tasks here.</span></div>`;
    return;
  }

  const CAT_LABELS = { finance: 'Finance', survey: 'Survey / Form', general: 'General' };
  const cats = [...new Set(financeItems.map(i => i.category || 'general'))];
  el.innerHTML = cats.map(cat => {
    const items = financeItems.filter(i => (i.category || 'general') === cat);
    return `<div class="finance-cat-group">
      <div class="finance-cat-label">${CAT_LABELS[cat] || cat.charAt(0).toUpperCase() + cat.slice(1)}</div>
      ${items.map(item => {
        const checked = financeChecked.has(item.id);
        return `<div class="finance-item${checked?' checked':''}">
          <button class="finance-checkbox${checked?' checked':''}" onclick="toggleFinanceCheck('${item.id}')" title="${checked?'Mark incomplete':'Mark complete'}">
            ${checked ? '&#10003;' : ''}
          </button>
          <div class="finance-item-body">
            <div class="finance-item-title">${escHtml(item.title)}${item.is_required?` <span class="badge-mandatory">Required</span>`:''}</div>
            ${item.description ? `<div class="finance-item-desc">${escHtml(item.description)}</div>` : ''}
            ${item.due_label ? `<div class="finance-item-due">Due: ${escHtml(item.due_label)}</div>` : ''}
            ${item.link ? `<a href="${escHtml(item.link)}" target="_blank" rel="noopener" class="checklist-open-link">Open &#8599;</a>` : ''}
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
    el.innerHTML = '<p style="color:var(--gray-mid);font-size:13px;padding:1rem 0">No checklist items yet. Add finance tasks, surveys, or general requirements above.</p>';
    return;
  }
  el.innerHTML = financeItems.map(item => `
    <div class="admin-list-row">
      <div class="admin-list-accent" style="background:var(--maroon)"></div>
      <div class="admin-list-body">
        <div class="admin-list-title">${escHtml(item.title)}${item.is_required?` <span class="badge-mandatory">Required</span>`:''}</div>
        <div class="admin-list-meta">${item.category || 'general'}${item.due_label?' · Due: '+escHtml(item.due_label):''}${item.link?' · <a href="'+escHtml(item.link)+'" target="_blank" rel="noopener">Link ↗</a>':''}${item.description?' · '+escHtml(item.description.slice(0,60)):''}</div>
      </div>
      <div class="admin-list-actions">
        <button class="admin-btn-danger" onclick="deleteFinanceItem('${item.id}')">Delete</button>
      </div>
    </div>`).join('');
}

async function addFinanceItem() {
  const title       = document.getElementById('fin-title').value.trim();
  const description = document.getElementById('fin-desc').value.trim();
  const due_label   = document.getElementById('fin-due').value.trim();
  const category    = document.getElementById('fin-cat').value;
  const link        = document.getElementById('fin-link').value.trim();
  const is_required = document.getElementById('fin-required').checked;
  if (!title) return;
  const res = await api('POST', '/api/finance', { title, description, due_label, category, link, is_required });
  if (res.ok) {
    const data = await res.json();
    data.checked = false;
    financeItems.push(data);
    document.getElementById('fin-title').value = '';
    document.getElementById('fin-desc').value  = '';
    document.getElementById('fin-due').value   = '';
    document.getElementById('fin-link').value  = '';
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


// ── FORMS ────────────────────────────────────────────────────────────────────

let currentFormFillId   = null;
let formSigPad          = null;
let currentFormReviewId = null;
let formReviewSigPad    = null;
let adminFormsFilter    = 'all';

function renderFormStatus(status) {
  const map = { pending: ['Awaiting you','pending'], submitted: ['Awaiting review','submitted'], complete: ['Complete','complete'] };
  const [label, cls] = map[status] || [status,'pending'];
  return `<span class="form-status ${cls}">${label}</span>`;
}
function renderFormStatusAdmin(status) {
  const map = { pending: ['Awaiting student','pending'], submitted: ['Awaiting review','submitted'], complete: ['Complete','complete'] };
  const [label, cls] = map[status] || [status,'pending'];
  return `<span class="form-status ${cls}">${label}</span>`;
}

// ── Student forms view ────────────────────────────────────────────────────────

function renderFormsView() {
  if (isStudentMode) {
    const listEl  = document.getElementById('studentFormsList');
    const emptyEl = document.getElementById('studentFormsEmpty');
    if (!listEl) return;
    if (!formRequests.length) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = formRequests.map(f => {
      const typeLabel = f.form_type === 'i9' ? 'I-9 &mdash; Employment Eligibility Verification' : 'W-4 &mdash; Employee&rsquo;s Withholding Certificate';
      const dateStr   = (f.created_at || '').slice(0,10);
      const metaParts = [`Sent ${dateStr}`];
      if (f.due_date) metaParts.push(`Due: ${f.due_date}`);
      if (f.note)     metaParts.push(f.note);
      let action;
      if (f.status === 'pending') {
        action = `<button class="admin-btn-primary" style="font-size:13px;padding:6px 18px;white-space:nowrap" onclick="openFormFill(${f.id})">Fill out</button>`;
      } else {
        action = `<button class="admin-btn-secondary" style="font-size:13px;padding:6px 18px;white-space:nowrap" onclick="openFormView(${f.id})">View</button>`;
      }
      return `<div class="form-list-row">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px;margin-bottom:3px">${typeLabel}</div>
          <div style="font-size:12px;color:var(--gray-mid)">${metaParts.join(' &bull; ')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">${renderFormStatus(f.status)}${action}</div>
      </div>`;
    }).join('');
  }
}

// ── Admin forms ───────────────────────────────────────────────────────────────

function renderAdminForms() {
  renderAdminFormsPicker();
  renderAdminFormsList(adminFormsFilter);
}

function renderAdminFormsPicker() {
  const el = document.getElementById('frmStudentList');
  if (!el) return;
  const active = students.filter(s => s.is_active);
  if (!active.length) {
    el.innerHTML = '<div style="padding:12px;font-size:13px;color:var(--gray-mid)">No active students.</div>';
    return;
  }
  el.innerHTML = active.map(s => {
    const courseTag = s.course === 'psc31180' ? 'PSC 31180' : 'TAP';
    return `<label class="frm-student-item">
      <input type="checkbox" value="${s.id}" class="frm-student-check">
      <span style="flex:1">${s.name}</span>
      <span style="color:var(--gray-mid);font-size:11px">${courseTag}</span>
    </label>`;
  }).join('');
}

function toggleAllFrmStudents(checked) {
  document.querySelectorAll('.frm-student-check').forEach(c => c.checked = checked);
}

function filterAdminForms(filter, btn) {
  adminFormsFilter = filter;
  document.querySelectorAll('#apanel-forms .admin-filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAdminFormsList(filter);
}

function renderAdminFormsList(filter) {
  const el      = document.getElementById('adminFormsList');
  const countEl = document.getElementById('formsAdminCount');
  if (!el) return;
  let forms = formRequests;
  if (filter !== 'all') forms = forms.filter(f => f.status === filter);
  if (countEl) countEl.textContent = `(${formRequests.length})`;
  if (!forms.length) {
    el.innerHTML = `<div style="padding:1rem;color:var(--gray-mid);font-size:14px">No forms${filter !== 'all' ? ' with status "'+filter+'"' : ''}.</div>`;
    return;
  }
  el.innerHTML = forms.map(f => {
    const typeTag   = f.form_type === 'i9' ? 'I-9' : 'W-4';
    const dateStr   = (f.created_at || '').slice(0,10);
    const metaParts = [`Sent ${dateStr}`];
    if (f.due_date) metaParts.push(`Due ${f.due_date}`);
    if (f.note)     metaParts.push(f.note);
    let actions = `<button class="admin-btn-secondary" style="font-size:12px;padding:4px 12px;white-space:nowrap" onclick="openFormView(${f.id})">View</button>`;
    if (f.status === 'submitted') {
      actions = `<button class="admin-btn-primary" style="font-size:12px;padding:4px 14px;white-space:nowrap" onclick="openFormReview(${f.id})">Complete I-9</button> ` + actions;
    }
    actions += ` <button class="admin-btn-secondary" style="font-size:12px;padding:4px 10px;color:var(--maroon);border-color:var(--maroon)" onclick="deleteFormRequest(${f.id})">&#128465;</button>`;
    return `<div class="form-list-row">
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;background:var(--gray-light);padding:3px 8px;color:var(--gray-brand);flex-shrink:0">${typeTag}</div>
        <div>
          <div style="font-size:14px;font-weight:500">${f.student_name || '&mdash;'}</div>
          <div style="font-size:12px;color:var(--gray-mid)">${metaParts.join(' &bull; ')}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">${renderFormStatusAdmin(f.status)}${actions}</div>
    </div>`;
  }).join('');
}

async function sendForms() {
  const type    = document.getElementById('frm-type').value;
  const due     = document.getElementById('frm-due').value;
  const note    = document.getElementById('frm-note').value.trim();
  const checked = [...document.querySelectorAll('.frm-student-check:checked')].map(c => parseInt(c.value));
  const resultEl = document.getElementById('frmSendResult');
  resultEl.textContent = '';
  if (!checked.length) { resultEl.textContent = 'Select at least one student.'; return; }
  const res  = await api('POST', '/api/forms', { form_type: type, student_ids: checked, note, due_date: due });
  const data = await res.json();
  if (!res.ok) { resultEl.textContent = data.error || 'Failed to send.'; return; }
  const frmRes = await fetch('/api/forms');
  formRequests = await frmRes.json();
  document.querySelectorAll('.frm-student-check').forEach(c => c.checked = false);
  document.getElementById('frm-note').value = '';
  document.getElementById('frm-due').value  = '';
  renderAdminFormsList(adminFormsFilter);
  resultEl.style.color = '#1D9E75';
  resultEl.textContent = `&#10003; Form sent to ${data.created.length} student(s).`;
  setTimeout(() => { resultEl.textContent = ''; resultEl.style.color = ''; }, 4000);
}

async function deleteFormRequest(id) {
  if (!confirm('Delete this form request and all submissions? This cannot be undone.')) return;
  const res = await api('DELETE', `/api/forms/${id}`);
  if (!res.ok) { alert('Failed to delete.'); return; }
  const frmRes = await fetch('/api/forms');
  formRequests = await frmRes.json();
  renderAdminFormsList(adminFormsFilter);
}

// ── Form fill (student) ───────────────────────────────────────────────────────

function renderI9Fields() {
  return `
  <div class="form-fill-section">
    <div class="form-fill-subtitle">Section 1 &mdash; Employee Information</div>
    <div class="admin-row-3" style="margin-bottom:0.75rem">
      <div class="form-group" style="margin:0"><label class="form-label">Last Name (Family Name) <span style="color:var(--maroon)">*</span></label><input class="form-input" id="ff-last-name" type="text" required></div>
      <div class="form-group" style="margin:0"><label class="form-label">First Name (Given Name) <span style="color:var(--maroon)">*</span></label><input class="form-input" id="ff-first-name" type="text" required></div>
      <div class="form-group" style="margin:0"><label class="form-label">Middle Initial</label><input class="form-input" id="ff-middle" type="text" maxlength="1"></div>
    </div>
    <div class="form-group"><label class="form-label">Other Last Names Used</label><input class="form-input" id="ff-other-names" type="text" placeholder="Leave blank if none"></div>
    <div class="admin-row-2" style="margin-bottom:0.75rem">
      <div class="form-group" style="margin:0"><label class="form-label">Street Address <span style="color:var(--maroon)">*</span></label><input class="form-input" id="ff-address" type="text" required></div>
      <div class="form-group" style="margin:0"><label class="form-label">Apt. Number</label><input class="form-input" id="ff-apt" type="text"></div>
    </div>
    <div class="admin-row-3" style="margin-bottom:0.75rem">
      <div class="form-group" style="margin:0"><label class="form-label">City or Town <span style="color:var(--maroon)">*</span></label><input class="form-input" id="ff-city" type="text" required></div>
      <div class="form-group" style="margin:0"><label class="form-label">State <span style="color:var(--maroon)">*</span></label><input class="form-input" id="ff-state" type="text" maxlength="2" placeholder="NY" required></div>
      <div class="form-group" style="margin:0"><label class="form-label">ZIP Code <span style="color:var(--maroon)">*</span></label><input class="form-input" id="ff-zip" type="text" maxlength="10" required></div>
    </div>
    <div class="admin-row-3" style="margin-bottom:0.75rem">
      <div class="form-group" style="margin:0"><label class="form-label">Date of Birth <span style="color:var(--maroon)">*</span></label><input class="form-input" id="ff-dob" type="date" required></div>
      <div class="form-group" style="margin:0"><label class="form-label">Social Security Number</label><input class="form-input" id="ff-ssn" type="text" placeholder="XXX-XX-XXXX"></div>
      <div class="form-group" style="margin:0"><label class="form-label">Phone Number</label><input class="form-input" id="ff-phone" type="tel" placeholder="(XXX) XXX-XXXX"></div>
    </div>
    <div class="form-group"><label class="form-label">Email Address</label><input class="form-input" id="ff-email" type="email" placeholder="Optional"></div>
  </div>
  <div class="form-fill-section">
    <div class="form-fill-subtitle">Attestation</div>
    <p class="form-attest-text">I attest, under penalty of perjury, that I am (select one):</p>
    <div class="form-radio-group">
      <label class="form-radio-item"><input type="radio" name="ff-cit" value="1" onchange="toggleCitizenshipExtra()"> A citizen of the United States</label>
      <label class="form-radio-item"><input type="radio" name="ff-cit" value="2" onchange="toggleCitizenshipExtra()"> A noncitizen national of the United States (see instructions)</label>
      <label class="form-radio-item"><input type="radio" name="ff-cit" value="3" onchange="toggleCitizenshipExtra()"> A lawful permanent resident</label>
      <div class="form-cit-extra" id="ff-cit-3-extra" style="display:none">
        <div class="form-group" style="margin-bottom:0"><label class="form-label">Alien Registration / USCIS Number <span style="color:var(--maroon)">*</span></label><input class="form-input" id="ff-alien-reg" type="text" placeholder="A-Number"></div>
      </div>
      <label class="form-radio-item"><input type="radio" name="ff-cit" value="4" onchange="toggleCitizenshipExtra()"> An alien authorized to work</label>
      <div class="form-cit-extra" id="ff-cit-4-extra" style="display:none">
        <div class="admin-row-2" style="margin-bottom:0.75rem">
          <div class="form-group" style="margin:0"><label class="form-label">Work Authorization Expiry (or N/A)</label><input class="form-input" id="ff-work-expiry" type="text" placeholder="MM/DD/YYYY or N/A"></div>
          <div class="form-group" style="margin:0"><label class="form-label">Alien Reg / USCIS Number</label><input class="form-input" id="ff-alien-reg-4" type="text"></div>
        </div>
        <div class="admin-row-2" style="margin-bottom:0">
          <div class="form-group" style="margin:0"><label class="form-label">Form I-94 Admission Number</label><input class="form-input" id="ff-i94" type="text" placeholder="If applicable"></div>
          <div class="form-group" style="margin:0"><label class="form-label">Foreign Passport + Country</label><input class="form-input" id="ff-passport" type="text" placeholder="Number, Country"></div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderW4Fields() {
  return `
  <div class="form-fill-section">
    <div class="form-fill-subtitle">Step 1 &mdash; Personal Information</div>
    <div class="admin-row-3" style="margin-bottom:0.75rem">
      <div class="form-group" style="margin:0"><label class="form-label">First Name &amp; Middle Initial <span style="color:var(--maroon)">*</span></label><input class="form-input" id="ff-first-name" type="text" required placeholder="First M.I."></div>
      <div class="form-group" style="margin:0"><label class="form-label">Last Name <span style="color:var(--maroon)">*</span></label><input class="form-input" id="ff-last-name" type="text" required></div>
      <div class="form-group" style="margin:0"><label class="form-label">Social Security Number</label><input class="form-input" id="ff-ssn" type="text" placeholder="XXX-XX-XXXX"></div>
    </div>
    <div class="form-group"><label class="form-label">Home Address <span style="color:var(--maroon)">*</span></label><input class="form-input" id="ff-address" type="text" required placeholder="Street number and name"></div>
    <div class="admin-row-3" style="margin-bottom:0.75rem">
      <div class="form-group" style="margin:0"><label class="form-label">City or Town <span style="color:var(--maroon)">*</span></label><input class="form-input" id="ff-city" type="text" required></div>
      <div class="form-group" style="margin:0"><label class="form-label">State</label><input class="form-input" id="ff-state" type="text" maxlength="2" placeholder="NY"></div>
      <div class="form-group" style="margin:0"><label class="form-label">ZIP Code</label><input class="form-input" id="ff-zip" type="text" maxlength="10"></div>
    </div>
    <div class="form-fill-subtitle" style="margin-top:1rem;margin-bottom:0.5rem">Filing Status</div>
    <div class="form-radio-group">
      <label class="form-radio-item"><input type="radio" name="ff-filing" value="single"> Single or Married filing separately</label>
      <label class="form-radio-item"><input type="radio" name="ff-filing" value="mfj"> Married filing jointly or Qualifying surviving spouse</label>
      <label class="form-radio-item"><input type="radio" name="ff-filing" value="hoh"> Head of household</label>
    </div>
  </div>
  <div class="form-fill-section">
    <div class="form-fill-subtitle">Step 2 &mdash; Multiple Jobs or Spouse Works</div>
    <p style="font-size:13px;color:var(--gray-mid);margin-bottom:0.75rem">Complete if you hold more than one job at a time, or are married filing jointly and your spouse also works.</p>
    <label class="form-radio-item" style="max-width:420px"><input type="checkbox" id="ff-multi-jobs"> I have multiple jobs or my spouse also works</label>
  </div>
  <div class="form-fill-section">
    <div class="form-fill-subtitle">Step 3 &mdash; Claim Dependents (optional)</div>
    <p style="font-size:13px;color:var(--gray-mid);margin-bottom:0.75rem">If your total income is ≤$200,000 ($400,000 if MFJ), enter the total dollar amount of dependents.</p>
    <div class="admin-row-2">
      <div class="form-group" style="margin:0"><label class="form-label">Qualifying children &times; $2,000</label><input class="form-input" id="ff-dep-children" type="number" min="0" step="2000" placeholder="$0"></div>
      <div class="form-group" style="margin:0"><label class="form-label">Other dependents &times; $500</label><input class="form-input" id="ff-dep-other" type="number" min="0" step="500" placeholder="$0"></div>
    </div>
  </div>
  <div class="form-fill-section">
    <div class="form-fill-subtitle">Step 4 &mdash; Other Adjustments (optional)</div>
    <div class="admin-row-3">
      <div class="form-group" style="margin:0"><label class="form-label">(a) Other income (not from jobs)</label><input class="form-input" id="ff-other-income" type="number" min="0" placeholder="$0"></div>
      <div class="form-group" style="margin:0"><label class="form-label">(b) Deductions</label><input class="form-input" id="ff-deductions" type="number" min="0" placeholder="$0"></div>
      <div class="form-group" style="margin:0"><label class="form-label">(c) Extra withholding / paycheck</label><input class="form-input" id="ff-extra" type="number" min="0" placeholder="$0"></div>
    </div>
  </div>`;
}

function renderSigSection(step) {
  const today = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  return `
  <div class="form-fill-section" style="border-bottom:none">
    <div class="form-fill-subtitle">Step ${step} &mdash; Sign Here</div>
    <p style="font-size:13px;color:var(--gray-mid);margin-bottom:1rem">By signing below I attest, under penalty of perjury, that the information provided is true and correct to the best of my knowledge.</p>
    <div class="sig-wrap" style="margin-bottom:8px"><canvas id="formSigCanvas" class="sig-canvas"></canvas><button class="sig-clear-btn" onclick="clearFormSig()" type="button">Clear</button></div>
    <div style="font-size:12px;color:var(--gray-mid)">Signing electronically on <strong>${today}</strong></div>
  </div>
  <div class="modal-error" id="formFillError" style="margin-top:1rem"></div>
  <button class="admin-btn-primary" style="width:100%;margin-top:1rem" onclick="submitFormFill()">Submit form</button>`;
}

function toggleCitizenshipExtra() {
  const val = document.querySelector('input[name="ff-cit"]:checked')?.value || '';
  const el3 = document.getElementById('ff-cit-3-extra');
  const el4 = document.getElementById('ff-cit-4-extra');
  if (el3) el3.style.display = val === '3' ? 'block' : 'none';
  if (el4) el4.style.display = val === '4' ? 'block' : 'none';
}

function openFormFill(requestId) {
  const form = formRequests.find(f => f.id === requestId);
  if (!form) return;
  currentFormFillId = requestId;
  document.getElementById('formFillTitle').textContent = form.form_type === 'i9'
    ? 'I-9 — Employment Eligibility Verification'
    : 'W-4 — Employee\'s Withholding Certificate';
  const noteEl = document.getElementById('formFillNote');
  const parts  = [];
  if (form.note)     parts.push(form.note);
  if (form.due_date) parts.push('Due: ' + form.due_date);
  noteEl.textContent = parts.join(' · ');
  const step   = form.form_type === 'i9' ? 6 : 5;
  const fields = form.form_type === 'i9' ? renderI9Fields() : renderW4Fields();
  document.getElementById('formFillBody').innerHTML = fields + renderSigSection(step);
  document.getElementById('formFillModal').classList.add('open');
  setTimeout(() => initSigPad('formSigCanvas', pad => formSigPad = pad), 80);
}

function closeFormFill() {
  document.getElementById('formFillModal').classList.remove('open');
  if (formSigPad) { formSigPad.clear(); formSigPad = null; }
  currentFormFillId = null;
}

function handleFormFillOverlayClick(e) { if (e.target.id === 'formFillModal') closeFormFill(); }
function clearFormSig() { if (formSigPad) formSigPad.clear(); }

function initSigPad(canvasId, callback) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof SignaturePad === 'undefined') return;
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width  = canvas.offsetWidth  * ratio;
  canvas.height = canvas.offsetHeight * ratio;
  canvas.getContext('2d').scale(ratio, ratio);
  callback(new SignaturePad(canvas, { backgroundColor: 'rgb(250,250,249)' }));
}

function collectI9Fields() {
  const cit = document.querySelector('input[name="ff-cit"]:checked');
  const gv  = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  return {
    last_name: gv('ff-last-name'), first_name: gv('ff-first-name'), middle: gv('ff-middle'),
    other_names: gv('ff-other-names'), address: gv('ff-address'), apt: gv('ff-apt'),
    city: gv('ff-city'), state: gv('ff-state'), zip: gv('ff-zip'),
    dob: gv('ff-dob'), ssn: gv('ff-ssn'), phone: gv('ff-phone'), email: gv('ff-email'),
    citizenship_status: cit ? cit.value : '',
    alien_reg: gv('ff-alien-reg'), work_expiry: gv('ff-work-expiry'),
    alien_reg_4: gv('ff-alien-reg-4'), i94: gv('ff-i94'), passport: gv('ff-passport'),
  };
}
function validateI9Fields(f) {
  if (!f.last_name)  return 'Last name is required.';
  if (!f.first_name) return 'First name is required.';
  if (!f.address)    return 'Address is required.';
  if (!f.city)       return 'City is required.';
  if (!f.state)      return 'State is required.';
  if (!f.zip)        return 'ZIP code is required.';
  if (!f.dob)        return 'Date of birth is required.';
  if (!f.citizenship_status) return 'Please select your citizenship/work authorization status.';
  if (f.citizenship_status === '3' && !f.alien_reg) return 'Alien Registration / USCIS Number is required for lawful permanent residents.';
  return null;
}
function collectW4Fields() {
  const filing = document.querySelector('input[name="ff-filing"]:checked');
  const gv     = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  return {
    first_name: gv('ff-first-name'), last_name: gv('ff-last-name'), ssn: gv('ff-ssn'),
    address: gv('ff-address'), city: gv('ff-city'), state: gv('ff-state'), zip: gv('ff-zip'),
    filing_status: filing ? filing.value : '',
    multiple_jobs: (document.getElementById('ff-multi-jobs') || {}).checked || false,
    dep_children: gv('ff-dep-children') || '0', dep_other: gv('ff-dep-other') || '0',
    other_income: gv('ff-other-income') || '0', deductions: gv('ff-deductions') || '0',
    extra_withholding: gv('ff-extra') || '0',
  };
}
function validateW4Fields(f) {
  if (!f.first_name)    return 'First name is required.';
  if (!f.last_name)     return 'Last name is required.';
  if (!f.address)       return 'Address is required.';
  if (!f.city)          return 'City is required.';
  if (!f.filing_status) return 'Please select your filing status.';
  return null;
}

async function submitFormFill() {
  const form  = formRequests.find(f => f.id === currentFormFillId);
  if (!form) return;
  const errEl = document.getElementById('formFillError');
  errEl.classList.remove('visible');
  if (!formSigPad || formSigPad.isEmpty()) {
    errEl.textContent = 'Please sign before submitting.'; errEl.classList.add('visible'); return;
  }
  const fields = form.form_type === 'i9' ? collectI9Fields() : collectW4Fields();
  const err    = form.form_type === 'i9' ? validateI9Fields(fields) : validateW4Fields(fields);
  if (err) { errEl.textContent = err; errEl.classList.add('visible'); return; }
  const signature = formSigPad.toDataURL();
  const res  = await api('POST', `/api/forms/${form.id}/submit`, { fields, signature });
  const data = await res.json();
  if (!res.ok) { errEl.textContent = data.error || 'Submission failed.'; errEl.classList.add('visible'); return; }
  closeFormFill();
  const frmRes = await fetch('/api/forms');
  formRequests = await frmRes.json();
  renderFormsView();
  const typeLabel = form.form_type === 'i9' ? 'I-9' : 'W-4';
  alert(`${typeLabel} submitted successfully!${form.form_type === 'i9' ? '\n\nYour coordinator will review your submission and complete Section 2 after verifying your documents.' : ''}`);
}

// ── View form (read-only) ─────────────────────────────────────────────────────

function fmtFieldTable(rows) {
  return `<table class="form-view-table">${rows.filter(Boolean).map(([l,v]) =>
    `<tr><td class="fvt-label">${l}</td><td class="fvt-val">${v||'&mdash;'}</td></tr>`
  ).join('')}</table>`;
}

function sigImg(dataUrl) {
  if (!dataUrl) return '';
  return `<div style="margin-top:1rem"><div style="font-size:11px;color:var(--gray-mid);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em">Signature</div><img src="${dataUrl}" style="border:1px solid var(--gray-border);width:100%;max-width:340px;height:80px;object-fit:contain;background:#fafaf9;display:block"></div>`;
}

function renderI9View(f, sig, submittedAt) {
  const citLabels = {'1':'U.S. Citizen','2':'Noncitizen National','3':'Lawful Permanent Resident','4':'Alien Authorized to Work'};
  const rows = [
    ['Last Name', f.last_name], ['First Name', f.first_name], ['Middle Initial', f.middle],
    f.other_names ? ['Other Names Used', f.other_names] : null,
    ['Address', [f.address, f.apt].filter(Boolean).join(', ')],
    ['City, State ZIP', [f.city, f.state, f.zip].filter(Boolean).join(', ')],
    ['Date of Birth', f.dob], ['SSN', f.ssn ? '***-**-'+String(f.ssn).slice(-4) : null],
    ['Phone', f.phone], ['Email', f.email],
    ['Citizenship/Work Status', citLabels[f.citizenship_status] || f.citizenship_status],
    f.alien_reg ? ['Alien Reg / USCIS #', f.alien_reg] : null,
    f.work_expiry ? ['Work Auth Expiry', f.work_expiry] : null,
    f.i94 ? ['I-94 Number', f.i94] : null,
    f.passport ? ['Foreign Passport', f.passport] : null,
    submittedAt ? ['Submitted', submittedAt.slice(0,10)] : null,
  ];
  return fmtFieldTable(rows) + sigImg(sig);
}

function renderW4View(f, sig, submittedAt) {
  const filingMap = {single:'Single / MFS', mfj:'Married Filing Jointly / QSS', hoh:'Head of Household'};
  const rows = [
    ['Name', `${f.first_name||''} ${f.last_name||''}`.trim()],
    ['SSN', f.ssn ? '***-**-'+String(f.ssn).slice(-4) : null],
    ['Address', [f.address,f.city,f.state,f.zip].filter(Boolean).join(', ')],
    ['Filing Status', filingMap[f.filing_status] || f.filing_status],
    ['Multiple Jobs', f.multiple_jobs ? 'Yes' : 'No'],
    (f.dep_children && f.dep_children !== '0') ? ['Dep. Children Amount', '$'+f.dep_children] : null,
    (f.dep_other && f.dep_other !== '0') ? ['Dep. Other Amount', '$'+f.dep_other] : null,
    (f.other_income && f.other_income !== '0') ? ['Other Income', '$'+f.other_income] : null,
    (f.deductions && f.deductions !== '0') ? ['Deductions', '$'+f.deductions] : null,
    (f.extra_withholding && f.extra_withholding !== '0') ? ['Extra Withholding/Paycheck', '$'+f.extra_withholding] : null,
    submittedAt ? ['Submitted', submittedAt.slice(0,10)] : null,
  ];
  return fmtFieldTable(rows) + sigImg(sig);
}

function renderSection2View(comp) {
  if (!comp) return '';
  const f    = comp.fields || {};
  const rows = [
    ['Document List', f.list_choice === 'a' ? 'List A' : 'List B + C'],
    f.a_title  ? ['List A: Document', f.a_title]           : null,
    f.a_issuer ? ['List A: Issuer', f.a_issuer]            : null,
    f.a_number ? ['List A: Number', f.a_number]            : null,
    f.a_expiry ? ['List A: Expiry', f.a_expiry]            : null,
    f.b_title  ? ['List B (Identity): Document', f.b_title] : null,
    f.b_issuer ? ['List B: Issuer', f.b_issuer]            : null,
    f.b_number ? ['List B: Number', f.b_number]            : null,
    f.c_title  ? ['List C (Work Auth): Document', f.c_title] : null,
    f.c_issuer ? ['List C: Issuer', f.c_issuer]            : null,
    f.c_number ? ['List C: Number', f.c_number]            : null,
    f.start_date ? ['First Day of Employment', f.start_date] : null,
    f.employer_name    ? ['Authorized Representative', f.employer_name]    : null,
    f.employer_title   ? ['Title', f.employer_title]                       : null,
    f.employer_org     ? ['Organization', f.employer_org]                  : null,
    comp.completed_at  ? ['Completed', comp.completed_at.slice(0,10)]      : null,
    comp.completed_by_name ? ['Completed by', comp.completed_by_name]      : null,
  ];
  return `<div class="form-fill-section"><div class="form-fill-subtitle">Section 2 &mdash; Employer Verification</div>${fmtFieldTable(rows)}${sigImg(comp.signature)}</div>`;
}

async function openFormView(requestId) {
  const res = await fetch(`/api/forms/${requestId}`);
  const form = await res.json();
  if (!res.ok) { alert('Could not load form.'); return; }
  currentFormReviewId = requestId;
  const typeLabel = form.form_type === 'i9' ? 'I-9 — Employment Eligibility Verification' : 'W-4 — Employee\'s Withholding Certificate';
  document.getElementById('formReviewTitle').textContent    = typeLabel;
  document.getElementById('formReviewSubtitle').textContent = `${form.student_name} — ${{'pending':'Awaiting student','submitted':'Awaiting review','complete':'Complete'}[form.status]||form.status}`;
  const sub = form.submission;
  let html  = '';
  if (!sub) {
    html = '<p style="color:var(--gray-mid);font-size:14px">No submission yet.</p>';
  } else {
    html = `<div class="form-fill-section">
      <div class="form-fill-subtitle">Section 1 &mdash; ${form.form_type === 'i9' ? 'Employee Submission' : 'Employee Information'}</div>
      ${form.form_type === 'i9' ? renderI9View(sub.fields, sub.signature, sub.submitted_at) : renderW4View(sub.fields, sub.signature, sub.submitted_at)}
    </div>`;
    if (form.form_type === 'i9') html += renderSection2View(form.completion);
  }
  html += `<div style="display:flex;gap:8px;margin-top:1.5rem;justify-content:flex-end">
    <button class="admin-btn-secondary" onclick="window.print()">&#128438; Print</button>
    <button class="admin-btn-secondary" onclick="closeFormReview()">Close</button>
  </div>`;
  document.getElementById('formReviewBody').innerHTML = html;
  document.getElementById('formReviewModal').classList.add('open');
}

// ── Admin review (complete I-9 Section 2) ────────────────────────────────────

async function openFormReview(requestId) {
  const res  = await fetch(`/api/forms/${requestId}`);
  const form = await res.json();
  if (!res.ok) { alert('Could not load form.'); return; }
  currentFormReviewId = requestId;
  document.getElementById('formReviewTitle').textContent    = 'Complete I-9 — Section 2';
  document.getElementById('formReviewSubtitle').textContent = `Reviewing submission from ${form.student_name}`;
  const sub   = form.submission;
  const today = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const html  = `
  <div class="form-fill-section">
    <div class="form-fill-subtitle">Section 1 &mdash; Employee Submission (Read-only)</div>
    ${sub ? renderI9View(sub.fields, sub.signature, sub.submitted_at) : '<p style="color:var(--gray-mid);font-size:13px">No submission available.</p>'}
  </div>
  <div class="form-fill-section">
    <div class="form-fill-subtitle">Section 2 &mdash; Employer Review and Verification</div>
    <p style="font-size:13px;color:var(--gray-mid);margin-bottom:1rem">Examine one List A document OR one List B + one List C document. Record the document information below.</p>
    <div class="form-radio-group" style="margin-bottom:1rem">
      <label class="form-radio-item"><input type="radio" name="rv-list" value="a" onchange="toggleDocLists()"><strong>List A</strong> &mdash; Identity and employment authorization</label>
      <label class="form-radio-item"><input type="radio" name="rv-list" value="bc" onchange="toggleDocLists()"><strong>List B + C</strong> &mdash; Identity (B) and employment authorization (C)</label>
    </div>
    <div id="rv-list-a" style="display:none">
      <div class="admin-row-2" style="margin-bottom:0.75rem">
        <div class="form-group" style="margin:0"><label class="form-label">Document Title</label><input class="form-input" id="rv-a-title" type="text"></div>
        <div class="form-group" style="margin:0"><label class="form-label">Issuing Authority</label><input class="form-input" id="rv-a-issuer" type="text"></div>
      </div>
      <div class="admin-row-2" style="margin-bottom:0">
        <div class="form-group" style="margin:0"><label class="form-label">Document Number</label><input class="form-input" id="rv-a-number" type="text"></div>
        <div class="form-group" style="margin:0"><label class="form-label">Expiration Date</label><input class="form-input" id="rv-a-expiry" type="date"></div>
      </div>
    </div>
    <div id="rv-list-bc" style="display:none">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray-mid);margin-bottom:0.5rem">List B &mdash; Identity</div>
      <div class="admin-row-2" style="margin-bottom:0.75rem">
        <div class="form-group" style="margin:0"><label class="form-label">Document Title</label><input class="form-input" id="rv-b-title" type="text"></div>
        <div class="form-group" style="margin:0"><label class="form-label">Issuing Authority</label><input class="form-input" id="rv-b-issuer" type="text"></div>
      </div>
      <div class="admin-row-2" style="margin-bottom:1rem">
        <div class="form-group" style="margin:0"><label class="form-label">Document Number</label><input class="form-input" id="rv-b-number" type="text"></div>
        <div class="form-group" style="margin:0"><label class="form-label">Expiration Date</label><input class="form-input" id="rv-b-expiry" type="date"></div>
      </div>
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray-mid);margin-bottom:0.5rem">List C &mdash; Employment Authorization</div>
      <div class="admin-row-2" style="margin-bottom:0.75rem">
        <div class="form-group" style="margin:0"><label class="form-label">Document Title</label><input class="form-input" id="rv-c-title" type="text"></div>
        <div class="form-group" style="margin:0"><label class="form-label">Issuing Authority</label><input class="form-input" id="rv-c-issuer" type="text"></div>
      </div>
      <div class="admin-row-2" style="margin-bottom:0">
        <div class="form-group" style="margin:0"><label class="form-label">Document Number</label><input class="form-input" id="rv-c-number" type="text"></div>
        <div class="form-group" style="margin:0"><label class="form-label">Expiration Date</label><input class="form-input" id="rv-c-expiry" type="date"></div>
      </div>
    </div>
    <div class="admin-row-2" style="margin-top:1rem">
      <div class="form-group" style="margin:0"><label class="form-label">First Day of Employment</label><input class="form-input" id="rv-start-date" type="date" style="max-width:180px"></div>
      <div class="form-group" style="margin:0"></div>
    </div>
    <div class="admin-row-2" style="margin-top:0.75rem">
      <div class="form-group" style="margin:0"><label class="form-label">Your Name</label><input class="form-input" id="rv-employer-name" type="text" value="${currentUserName||''}"></div>
      <div class="form-group" style="margin:0"><label class="form-label">Your Title</label><input class="form-input" id="rv-employer-title" type="text" placeholder="e.g. Fellowship Coordinator"></div>
    </div>
    <div class="admin-row-2" style="margin-top:0.75rem">
      <div class="form-group" style="margin:0"><label class="form-label">Organization</label><input class="form-input" id="rv-employer-org" type="text" value="The Moynihan Center, CCNY"></div>
      <div class="form-group" style="margin:0"><label class="form-label">Address</label><input class="form-input" id="rv-employer-address" type="text" placeholder="160 Convent Ave, New York, NY 10031"></div>
    </div>
  </div>
  <div class="form-fill-section" style="border-bottom:none">
    <div class="form-fill-subtitle">Employer Signature</div>
    <p style="font-size:13px;color:var(--gray-mid);margin-bottom:1rem">I attest, under penalty of perjury, that I have examined the document(s) presented and that to the best of my knowledge the above-named employee is authorized to work in the United States.</p>
    <div class="sig-wrap" style="margin-bottom:8px"><canvas id="reviewSigCanvas" class="sig-canvas"></canvas><button class="sig-clear-btn" onclick="clearReviewSig()" type="button">Clear</button></div>
    <div style="font-size:12px;color:var(--gray-mid)">Signing electronically on <strong>${today}</strong></div>
  </div>
  <div class="modal-error" id="formReviewError" style="margin-top:1rem"></div>
  <div style="display:flex;gap:8px;margin-top:1rem">
    <button class="admin-btn-primary" style="flex:1" onclick="completeI9()">Complete I-9</button>
    <button class="admin-btn-secondary" onclick="window.print()">&#128438; Print</button>
    <button class="admin-btn-secondary" onclick="closeFormReview()">Cancel</button>
  </div>`;
  document.getElementById('formReviewBody').innerHTML = html;
  document.getElementById('formReviewModal').classList.add('open');
  setTimeout(() => initSigPad('reviewSigCanvas', pad => formReviewSigPad = pad), 80);
}

function toggleDocLists() {
  const val = document.querySelector('input[name="rv-list"]:checked')?.value || '';
  document.getElementById('rv-list-a').style.display  = val === 'a'  ? 'block' : 'none';
  document.getElementById('rv-list-bc').style.display = val === 'bc' ? 'block' : 'none';
}

function clearReviewSig() { if (formReviewSigPad) formReviewSigPad.clear(); }

function closeFormReview() {
  document.getElementById('formReviewModal').classList.remove('open');
  if (formReviewSigPad) { formReviewSigPad.clear(); formReviewSigPad = null; }
  currentFormReviewId = null;
}

function handleFormReviewOverlayClick(e) { if (e.target.id === 'formReviewModal') closeFormReview(); }

async function completeI9() {
  const errEl = document.getElementById('formReviewError');
  errEl.classList.remove('visible');
  const listChoice = document.querySelector('input[name="rv-list"]:checked');
  if (!listChoice) { errEl.textContent = 'Select List A or List B+C.'; errEl.classList.add('visible'); return; }
  if (!formReviewSigPad || formReviewSigPad.isEmpty()) { errEl.textContent = 'Please sign before completing.'; errEl.classList.add('visible'); return; }
  const gv = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const fields = {
    list_choice:      listChoice.value,
    start_date:       gv('rv-start-date'),
    employer_name:    gv('rv-employer-name'),
    employer_title:   gv('rv-employer-title'),
    employer_org:     gv('rv-employer-org'),
    employer_address: gv('rv-employer-address'),
  };
  if (listChoice.value === 'a') {
    fields.a_title = gv('rv-a-title'); fields.a_issuer = gv('rv-a-issuer');
    fields.a_number = gv('rv-a-number'); fields.a_expiry = gv('rv-a-expiry');
  } else {
    fields.b_title = gv('rv-b-title'); fields.b_issuer = gv('rv-b-issuer');
    fields.b_number = gv('rv-b-number'); fields.b_expiry = gv('rv-b-expiry');
    fields.c_title = gv('rv-c-title'); fields.c_issuer = gv('rv-c-issuer');
    fields.c_number = gv('rv-c-number'); fields.c_expiry = gv('rv-c-expiry');
  }
  const res  = await api('POST', `/api/forms/${currentFormReviewId}/complete`, { fields, signature: formReviewSigPad.toDataURL() });
  const data = await res.json();
  if (!res.ok) { errEl.textContent = data.error || 'Failed to complete I-9.'; errEl.classList.add('visible'); return; }
  closeFormReview();
  const frmRes = await fetch('/api/forms');
  formRequests = await frmRes.json();
  renderAdminFormsList(adminFormsFilter);
  alert('I-9 completed successfully.');
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
