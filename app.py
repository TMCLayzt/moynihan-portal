"""Moynihan Center Fellowship Portal.

A read-only calendar portal for fellows, with a staff area for managing content.

Students sign in with a single shared access code — there are no student
accounts and no student records, so the portal holds no personal information.
Staff sign in with individual accounts stored in Airtable.
"""

import atexit
import hmac
import os
import sys
import threading
from datetime import date, datetime, timedelta
from functools import wraps

import bcrypt
from flask import Flask, jsonify, render_template, request, session, Response
from pyairtable import Api

# Load a local .env for development. Absent in production, where the platform
# supplies real environment variables.
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


# ── CONFIGURATION ─────────────────────────────────────────────────────────────

REQUIRED_ENV = {
    'SECRET_KEY':          'Flask session signing key — use a long random string',
    'AIRTABLE_TOKEN':      'Airtable personal access token',
    'AIRTABLE_BASE_ID':    'Airtable base ID (starts with "app")',
    'STUDENT_ACCESS_CODE': 'Shared access code you give to fellows',
    'ICS_PUBLIC_TOKEN':    'Token for the student calendar subscription feed',
    'ICS_STAFF_TOKEN':     'Token for the staff calendar subscription feed',
}

_missing = [name for name in REQUIRED_ENV if not os.environ.get(name)]
if _missing:
    sys.exit(
        'FATAL: refusing to start — these environment variables are not set:\n\n'
        + '\n'.join(f'  {name}\n      {REQUIRED_ENV[name]}' for name in _missing)
        + '\n\nSet them in your hosting platform, or in a local .env file for development.\n'
    )

SECRET_KEY          = os.environ['SECRET_KEY']
AIRTABLE_TOKEN      = os.environ['AIRTABLE_TOKEN']
AIRTABLE_BASE_ID    = os.environ['AIRTABLE_BASE_ID']
STUDENT_ACCESS_CODE = os.environ['STUDENT_ACCESS_CODE']
ICS_PUBLIC_TOKEN    = os.environ['ICS_PUBLIC_TOKEN']
ICS_STAFF_TOKEN     = os.environ['ICS_STAFF_TOKEN']

# The one place the term is named. Everything else reads it from here, so next
# year's rollover is a single environment variable, not a search-and-replace.
SEMESTER_LABEL = os.environ.get('SEMESTER_LABEL', 'Fall 2026')

# Keys are the values stored in Airtable's Course field and must not change —
# renaming them would orphan every existing event. Only the labels change.
COURSES = {
    # Instructor names are deliberately absent — teaching assignments change,
    # and the portal shouldn't need a redeploy when they do.
    'psc31180': {
        'code':     'Y1 NYC Politics',
        'short':    'Y1',
        'title':    'Politics, Power, and Policy in New York City',
        'location': 'SH 107',
        'meets':    'Mondays & Wednesdays, 3:30–4:45 PM',
        'color':    '#8B1A1A',
    },
    'psc31330': {
        'code':     'Y2 Philanthropy',
        'short':    'Y2',
        'title':    'Philanthropy and the Public Good',
        'location': 'NAC 4/133',
        'meets':    'Wednesdays, 2:00–4:30 PM',
        'color':    '#185FA5',
    },
    'seniorfellows': {
        'code':     'Senior Fellows',
        'short':    'Senior',
        'title':    'Moynihan Seminar',
        'location': 'SH-558',
        'meets':    'Tuesdays, 12:00–2:00 PM',
        'color':    '#20785C',
    },
}

# Audience tags, as distinct from a specific cohort. 'joint' reaches everyone;
# 'undergrad' reaches Y1 and Y2 but not Senior Fellows, whose only standing
# commitment is the Tuesday seminar.
JOINT_COURSE      = 'joint'
UNDERGRAD_TAG     = 'undergrad'
UNDERGRAD_COHORTS = ('psc31180', 'psc31330')

AUDIENCE_META = {
    JOINT_COURSE:  {'code': 'All fellows', 'short': 'All',     'color': '#BA7517'},
    UNDERGRAD_TAG: {'code': 'Y1 & Y2',     'short': 'Y1 & Y2', 'color': '#BA7517'},
}

# Programme staff shown on the About page. Kept here rather than in Airtable
# because it changes rarely; if it starts changing often it belongs in a table.
STAFF_DIRECTORY = [
    ('Carlo Invernizzi-Accetti', 'Executive Director',                'caccetti@ccny.cuny.edu'),
    ('Michael Miller',           'Managing Director',                 'mmiller3@ccny.cuny.edu'),
    ('Selena Rodriguez',         'Assistant Director, Operations',    'srodriguez5@ccny.cuny.edu'),
    ('Layana Abu Touq',          'Assistant Director, Fellowships',   'labutouq@ccny.cuny.edu'),
    ('Leanna K. Carroll',        'Fellowship Relations Manager',      'lcarroll@ccny.cuny.edu'),
    ('Eliana Blam',              'Program Coordinator',               'eblam@ccny.cuny.edu'),
    ('Catherine Lovizio',        'Communications Coordinator',        'catherine.lovizio10@login.cuny.edu'),
    ('Kelly Matlock',            'Program Assistant',                 'kmatlock@ccny.cuny.edu'),
    ('Stephanie Njeri',          'Program Assistant',                 'snjeri@ccny.cuny.edu'),
]

GENERAL_CONTACT = 'moynihancenter@ccny.cuny.edu'

# Where to send a given question. Only routes that follow directly from a job
# title — anything else would be guesswork a fellow would act on.
CONTACT_ROUTING = [
    ('Anything general, or if you are not sure who to ask',
     'Moynihan Center', GENERAL_CONTACT),
    ('Your fellowship, placement, or seminar',
     'Layana Abu Touq — Assistant Director, Fellowships', 'labutouq@ccny.cuny.edu'),
    ('Logistics, rooms, and operations',
     'Selena Rodriguez — Assistant Director, Operations', 'srodriguez5@ccny.cuny.edu'),
    ('Events, scheduling, and day-to-day programme questions',
     'Eliana Blam — Program Coordinator', 'eblam@ccny.cuny.edu'),
    ('Press, social media, and communications',
     'Catherine Lovizio — Communications Coordinator', 'catherine.lovizio10@login.cuny.edu'),
]

STAFF_ROLES = ('admin', 'instructor', 'coordinator')

app = Flask(__name__)
app.secret_key = SECRET_KEY
app.config['PERMANENT_SESSION_LIFETIME']   = timedelta(hours=8)
app.config['SESSION_REFRESH_EACH_REQUEST'] = True
app.config['SESSION_COOKIE_HTTPONLY']      = True
app.config['SESSION_COOKIE_SAMESITE']      = 'Lax'
if os.environ.get('FLASK_ENV') == 'production':
    app.config['SESSION_COOKIE_SECURE'] = True


# ── AIRTABLE ──────────────────────────────────────────────────────────────────

airtable = Api(AIRTABLE_TOKEN)

users_table         = airtable.table(AIRTABLE_BASE_ID, 'tbl7gqQHD2AkunIAz')
events_table        = airtable.table(AIRTABLE_BASE_ID, 'tbl3P7neAyuA5gT7w')
announcements_table = airtable.table(AIRTABLE_BASE_ID, 'tblXu9wY2ybY1NXEO')
resources_table     = airtable.table(AIRTABLE_BASE_ID, 'tblVBg7D1n1WvYN40')
usage_table         = airtable.table(AIRTABLE_BASE_ID, 'tblyJ2iEtU2X49Qr4')


# ── HELPERS ───────────────────────────────────────────────────────────────────

def hash_password(plain):
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def check_password(plain, hashed):
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        # Stored value isn't a valid bcrypt hash.
        return False


def make_initials(name):
    parts = name.strip().split()
    return ''.join(p[0] for p in parts if p)[:2].upper()


def escape_formula_value(value):
    """Escape a value for safe interpolation into an Airtable formula string."""
    return str(value).replace('\\', '\\\\').replace("'", "\\'")


def is_staff():
    return session.get('role') in STAFF_ROLES


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('role'):
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated


def staff_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('role'):
            return jsonify({'error': 'Unauthorized'}), 401
        if not is_staff():
            return jsonify({'error': 'Forbidden'}), 403
        return f(*args, **kwargs)
    return decorated


def course_clause(course):
    """Airtable clause for everything a given cohort should see.

    That is the cohort's own events, anything open to all fellows, and — for the
    two undergraduate cohorts only — anything tagged for undergrads. Untagged
    events are included too, matching the serializer's behaviour, so a blank
    Course field doesn't make an event vanish from every filter.
    """
    tags = [escape_formula_value(course), JOINT_COURSE]
    if course in UNDERGRAD_COHORTS:
        tags.append(UNDERGRAD_TAG)
    clauses = [f"{{Course}}='{t}'" for t in tags] + ['{Course}=BLANK()']
    return 'OR(' + ', '.join(clauses) + ')'


def asset_version():
    """Fingerprint for static assets so a deploy can't leave a browser running
    stale JS or CSS. Recomputed per request; the files are small."""
    stamp = 0
    for name in ('static/portal.js', 'static/portal.css'):
        try:
            stamp = max(stamp, int(os.path.getmtime(os.path.join(app.root_path, name))))
        except OSError:
            pass
    return str(stamp)


def public_ics_url():
    return f"{request.url_root.rstrip('/')}/api/calendar.ics?token={ICS_PUBLIC_TOKEN}"


# ── USAGE COUNTERS ────────────────────────────────────────────────────────────
# Aggregate only: one row per day per metric, no identities and no paths. With a
# shared access code there is nothing to attribute to an individual anyway.
#
# Counts are buffered in memory and flushed on a timer, so a fellow clicking a
# tab never waits on an Airtable write. A restart can lose up to one flush
# interval, which is an acceptable trade for usage figures.

TRACKED_METRICS = {
    'signin_fellow', 'signin_staff',
    'view_dashboard', 'view_calendar', 'view_resources', 'view_about',
    'calendar_subscribe', 'ics_feed',
}

FLUSH_INTERVAL_SECONDS = 30

_usage_lock    = threading.Lock()
_usage_pending = {}          # (date, metric) -> count not yet written


def track(metric):
    """Record one occurrence. Cheap, non-blocking, never raises."""
    if metric not in TRACKED_METRICS:
        return
    key = (date.today().isoformat(), metric)
    with _usage_lock:
        _usage_pending[key] = _usage_pending.get(key, 0) + 1


def flush_usage():
    """Write buffered counts to Airtable, adding to whatever is already there."""
    with _usage_lock:
        if not _usage_pending:
            return
        batch, _usage_pending_local = dict(_usage_pending), None
        _usage_pending.clear()

    try:
        # One lookup for the days involved, then create or increment.
        days = sorted({d for d, _ in batch})
        clause = ', '.join(f"{{Date}}='{escape_formula_value(d)}'" for d in days)
        formula = f'OR({clause})' if len(days) > 1 else clause
        existing = {r['fields'].get('Key'): r for r in usage_table.all(formula=formula)}

        creates, updates = [], []
        for (day, metric), n in batch.items():
            key = f'{day}|{metric}'
            rec = existing.get(key)
            if rec:
                updates.append({'id': rec['id'],
                                'fields': {'Count': (rec['fields'].get('Count') or 0) + n}})
            else:
                creates.append({'Key': key, 'Date': day, 'Metric': metric, 'Count': n})
        if updates:
            usage_table.batch_update(updates)
        for c in creates:
            usage_table.create(c)
    except Exception:
        # Never let analytics break the app; put the counts back and retry later.
        app.logger.exception('usage flush failed')
        with _usage_lock:
            for k, n in batch.items():
                _usage_pending[k] = _usage_pending.get(k, 0) + n


def _flush_loop():
    while True:
        threading.Event().wait(FLUSH_INTERVAL_SECONDS)
        flush_usage()


threading.Thread(target=_flush_loop, daemon=True).start()
atexit.register(flush_usage)


# ── SERIALIZERS ───────────────────────────────────────────────────────────────

def event_to_dict(rec):
    d = rec['fields']
    return {
        'id':             rec['id'],
        'title':          d.get('Title', ''),
        'date':           d.get('Date', ''),
        # No default of 'lecture' — an untagged event would be mislabelled.
        'cat':            d.get('Category') or 'general',
        # An untagged event shows to everyone rather than being attributed to
        # one course it may not belong to.
        'course':         d.get('Course') or JOINT_COURSE,
        'note':           d.get('Note', ''),
        'start_time':     d.get('Start Time', ''),
        'end_time':       d.get('End Time', ''),
        'description':    d.get('Description', ''),
        'eventbrite_url': d.get('Eventbrite URL', ''),
        # Who must attend, as opposed to who can see it. Falls back to the old
        # Is Mandatory boolean for records predating this field.
        'required_for':   d.get('Required For')
                          or ('all' if d.get('Is Mandatory') else 'none'),
        'on_homepage':    1 if d.get('Show On Homepage') else 0,
        'is_hidden':      1 if d.get('Is Hidden') else 0,
        'is_staff_only':  1 if d.get('Is Staff Only') else 0,
    }


# Events students must never receive: staff-only, or still hidden as a draft.
STUDENT_EVENT_CLAUSES = ['{Is Staff Only}!=1', '{Is Hidden}!=1']


def build_event_formula(include_hidden_and_staff, course='', exclude_cuny=False):
    clauses = [] if include_hidden_and_staff else list(STUDENT_EVENT_CLAUSES)
    if course in COURSES:
        clauses.append(course_clause(course))
    if exclude_cuny:
        # The college calendar is most of a subscription's bulk and is the least
        # useful part in a personal calendar, so it can be left out.
        clauses.append("{Category}!='academic'")
    if len(clauses) > 1:
        return 'AND(' + ', '.join(clauses) + ')'
    return clauses[0] if clauses else None


def announcement_to_dict(rec):
    d = rec['fields']
    return {
        'id':         rec['id'],
        'title':      d.get('Title', ''),
        'body':       d.get('Body', ''),
        'category':   d.get('Category', 'general'),
        'show_until': d.get('Show Until', ''),
        'is_pinned':  1 if d.get('Is Pinned') else 0,
        'created_at': d.get('Created At', ''),
    }


def announcement_is_current(rec):
    """Has this announcement passed its Show Until date? Blank means never."""
    until = rec['fields'].get('Show Until')
    if not until:
        return True
    try:
        return date.fromisoformat(until[:10]) >= date.today()
    except ValueError:
        return True


def resource_to_dict(rec):
    d = rec['fields']
    return {
        'id':          rec['id'],
        'title':       d.get('Title', ''),
        'url':         d.get('URL', ''),
        'description': d.get('Description', ''),
        'category':    d.get('Category', 'general'),
        # Which cohorts it's for. Empty means everyone.
        'audience':    d.get('Audience') or [],
        'is_required': 1 if d.get('Is Required') else 0,
        'due_label':   d.get('Due Label', ''),
        'is_active':   1 if d.get('Is Active') else 0,
        'order_index': d.get('Order Index', 0),
    }


def requirement_to_dict(rec):
    d = rec['fields']
    return {
        'id':          rec['id'],
        'title':       d.get('Title', ''),
        'description': d.get('Description', ''),
        'category':    d.get('Category', 'general'),
        'link':        d.get('Link', ''),
        'due_label':   d.get('Due Label', ''),
        'is_required': 1 if d.get('Is Required') else 0,
        'order_index': d.get('Order Index', 0),
    }


def staff_user_to_dict(rec):
    d = rec['fields']
    return {
        'id':           rec['id'],
        'username':     d.get('Username', ''),
        'display_name': d.get('Name', ''),
        'role':         d.get('Role', ''),
        'course':       d.get('Course', 'both'),
        'is_active':    1 if d.get('Is Active') else 0,
        'you':          rec['id'] == session.get('user_id'),
    }


# ── PAGE ──────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    html = render_template(
        'portal.html',
        semester=SEMESTER_LABEL,
        courses=COURSES,
        public_ics_url=public_ics_url(),
        current_year=date.today().year,
        asset_version=asset_version(),
        staff_directory=STAFF_DIRECTORY,
        contact_routing=CONTACT_ROUTING,
        general_contact=GENERAL_CONTACT,
    )
    resp = app.make_response(html)
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp


@app.route('/healthz')
def healthz():
    """Lightweight liveness check that doesn't touch Airtable."""
    return jsonify({'ok': True, 'semester': SEMESTER_LABEL})


# ── AUTH ──────────────────────────────────────────────────────────────────────

@app.route('/api/me')
def me():
    """Session bootstrap for the frontend."""
    if not session.get('role'):
        return jsonify({'authenticated': False, 'semester': SEMESTER_LABEL})
    return jsonify({
        'authenticated':  True,
        'role':           session['role'],
        'is_staff':       is_staff(),
        'display':        session.get('name', 'Fellow'),
        'initials':       session.get('initials', ''),
        'semester':       SEMESTER_LABEL,
        'public_ics_url': public_ics_url(),
    })


@app.route('/api/login', methods=['POST'])
def login():
    """Two ways in: a shared student access code, or a staff username/password."""
    data     = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip().lower()
    password = data.get('password') or ''
    code     = (data.get('access_code') or '').strip()

    # Student: shared access code, no account, nothing stored about them.
    if code:
        if not hmac.compare_digest(code.encode(), STUDENT_ACCESS_CODE.encode()):
            return jsonify({'error': 'That access code is not correct.'}), 401
        session.clear()
        session.permanent = True
        session['role']   = 'student'
        session['name']   = 'Fellow'
        track('signin_fellow')
        return jsonify({
            'role':           'student',
            'is_staff':       False,
            'display':        'Fellow',
            'semester':       SEMESTER_LABEL,
            'public_ics_url': public_ics_url(),
        })

    # Staff: individual account.
    if not username or not password:
        return jsonify({'error': 'Enter the access code, or a staff username and password.'}), 400

    safe_username = escape_formula_value(username)
    rec = users_table.first(formula=f"AND({{Username}}='{safe_username}', {{Is Active}}=1)")
    if not rec or not check_password(password, rec['fields'].get('Password Hash', '')):
        return jsonify({'error': 'Incorrect username or password.'}), 401

    fields = rec['fields']
    role   = fields.get('Role', 'student')
    if role not in STAFF_ROLES:
        # Leftover student records from the old per-student login can't sign in.
        return jsonify({'error': 'This account can no longer sign in. Use the fellow access code.'}), 403

    name = fields.get('Name', username)
    session.clear()
    session.permanent     = True
    session['user_id']    = rec['id']
    session['username']   = fields.get('Username', username)
    session['role']       = role
    session['name']       = name
    session['initials']   = fields.get('Initials') or make_initials(name)
    session['course']     = fields.get('Course', 'both')
    track('signin_staff')
    return jsonify({
        'role':           role,
        'is_staff':       True,
        'display':        name,
        'initials':       session['initials'],
        'semester':       SEMESTER_LABEL,
        'public_ics_url': public_ics_url(),
    })


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/change-password', methods=['POST'])
@staff_required
def change_password():
    data    = request.get_json(silent=True) or {}
    current = data.get('current', '')
    new     = data.get('new', '')
    if len(new) < 8:
        return jsonify({'error': 'New password must be at least 8 characters.'}), 400
    rec = users_table.get(session['user_id'])
    if not rec or not check_password(current, rec['fields'].get('Password Hash', '')):
        return jsonify({'error': 'Current password is incorrect.'}), 401
    users_table.update(session['user_id'], {'Password Hash': hash_password(new)})
    return jsonify({'ok': True})


# ── EVENTS ────────────────────────────────────────────────────────────────────

@app.route('/api/events')
@login_required
def get_events():
    """The master calendar. Students never receive staff-only events.

    Filtering by course is normally done in the browser so switching filters is
    instant, but ?course= is supported too.
    """
    formula = build_event_formula(is_staff(), request.args.get('course', ''))
    recs = events_table.all(formula=formula, sort=['Date']) if formula \
        else events_table.all(sort=['Date'])
    return jsonify([event_to_dict(r) for r in recs])


@app.route('/api/events', methods=['POST'])
@staff_required
def create_event():
    data     = request.get_json(silent=True) or {}
    title    = (data.get('title') or '').strip()
    date_val = (data.get('date') or '').strip()
    if not title or not date_val:
        return jsonify({'error': 'Title and date are required.'}), 400
    course = data.get('course', 'psc31180')
    if course not in COURSES and course != JOINT_COURSE:
        return jsonify({'error': 'Unknown course.'}), 400
    rec = events_table.create({
        'Title':          title,
        'Date':           date_val,
        'Category':       data.get('cat', 'lecture'),
        'Note':           data.get('note', ''),
        'Description':    data.get('description', ''),
        'Eventbrite URL': data.get('eventbrite_url', ''),
        'Start Time':     (data.get('start_time') or '').strip(),
        'End Time':       (data.get('end_time') or '').strip(),
        'Required For':   data.get('required_for') or 'none',
        'Show On Homepage': bool(data.get('on_homepage')),
        'Course':         course,
        'Is Hidden':      bool(data.get('is_hidden')),
        'Is Staff Only':  bool(data.get('is_staff_only')),
    })
    return jsonify(event_to_dict(rec)), 201


@app.route('/api/events/<string:event_id>', methods=['PATCH'])
@staff_required
def update_event(event_id):
    data = request.get_json(silent=True) or {}
    if not events_table.get(event_id):
        return jsonify({'error': 'Not found'}), 404

    field_map = {
        'title':          'Title',
        'date':           'Date',
        'cat':            'Category',
        'note':           'Note',
        'description':    'Description',
        'eventbrite_url': 'Eventbrite URL',
        'course':         'Course',
        'required_for':   'Required For',
        'start_time':     'Start Time',
        'end_time':       'End Time',
    }
    bool_map = {
        'on_homepage':   'Show On Homepage',
        'is_hidden':     'Is Hidden',
        'is_staff_only': 'Is Staff Only',
    }
    updates = {}
    for key, at_key in field_map.items():
        if key in data:
            updates[at_key] = data[key]
    for key, at_key in bool_map.items():
        if key in data:
            updates[at_key] = bool(data[key])
    if not updates:
        return jsonify({'error': 'Nothing to update.'}), 400
    return jsonify(event_to_dict(events_table.update(event_id, updates)))


@app.route('/api/events/<string:event_id>', methods=['DELETE'])
@staff_required
def delete_event(event_id):
    if not events_table.get(event_id):
        return jsonify({'error': 'Not found'}), 404
    events_table.delete(event_id)
    return jsonify({'ok': True})


# ── CALENDAR FEED ─────────────────────────────────────────────────────────────

def ics_escape(text):
    return (text or '').replace('\\', '\\\\').replace(';', '\\;') \
                       .replace(',', '\\,').replace('\n', '\\n')


def ics_fold(line):
    """Fold lines longer than 75 octets, per RFC 5545."""
    if len(line.encode('utf-8')) <= 75:
        return line
    out, buf = [], b''
    for char in line:
        c = char.encode('utf-8')
        if len(buf) + len(c) > 75:
            out.append(buf.decode('utf-8'))
            buf = b' ' + c
        else:
            buf += c
    if buf:
        out.append(buf.decode('utf-8'))
    return '\r\n'.join(out)


# Calendar clients need the zone spelled out, or a 3:30 PM seminar lands at the
# reader's local 3:30 PM. New York rules, with DST.
VTIMEZONE_NY = [
    'BEGIN:VTIMEZONE',
    'TZID:America/New_York',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
]


def hhmm(value):
    """'15:30' -> '153000', or None if it isn't a usable time."""
    try:
        h, m = str(value).strip().split(':')
        h, m = int(h), int(m)
    except (ValueError, AttributeError):
        return None
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return f'{h:02d}{m:02d}00'


def build_ics(recs, cal_name):
    now_str = datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
    lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Moynihan Center//Fellowship Portal//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        f'X-WR-CALNAME:{ics_escape(cal_name)}',
        'X-WR-TIMEZONE:America/New_York',
    ] + VTIMEZONE_NY
    for rec in recs:
        f = rec['fields']
        raw = (f.get('Date') or '').replace('-', '')
        if len(raw) < 8:
            continue
        try:
            start = date(int(raw[:4]), int(raw[4:6]), int(raw[6:8]))
        except ValueError:
            continue

        st, en = hhmm(f.get('Start Time')), hhmm(f.get('End Time'))
        timed  = bool(st and en and en > st)
        if timed:
            # A real appointment, in New York time.
            dtstart = f'DTSTART;TZID=America/New_York:{raw}T{st}'
            dtend   = f'DTEND;TZID=America/New_York:{raw}T{en}'
        else:
            # No time recorded — a genuine all-day entry, e.g. a college closure.
            nextday = (start + timedelta(days=1)).strftime('%Y%m%d')
            dtstart = f'DTSTART;VALUE=DATE:{raw}'
            dtend   = f'DTEND;VALUE=DATE:{nextday}'

        lines += [
            'BEGIN:VEVENT',
            f"UID:event-{rec['id']}@moynihan-portal",
            f'DTSTAMP:{now_str}',
            dtstart,
            dtend,
            f"SUMMARY:{ics_escape(f.get('Title', ''))}",
        ]

        # Nothing blocks time. Fellows share one access code, so the feed has no
        # idea who is subscribing — and the scope is chosen freely, so an
        # undergraduate can subscribe to the Senior Fellows calendar. Marking
        # anything busy would assert an obligation the portal cannot know about.
        # Entries still show at the right time; they just leave the fellow free.
        # Without an explicit TRANSP, RFC 5545 would default to OPAQUE. The
        # X-MICROSOFT line is for Outlook, which prefers its own property when
        # working out free/busy.
        lines += ['TRANSP:TRANSPARENT', 'X-MICROSOFT-CDO-BUSYSTATUS:FREE']
        if not timed:
            lines += ['X-MICROSOFT-CDO-ALLDAYEVENT:TRUE', 'X-FUNAMBOL-ALLDAY:1']
        location = ics_escape((f.get('Note') or '').split('·')[0].strip())
        if location:
            lines.append(f'LOCATION:{location}')
        desc = ics_escape(f.get('Description') or f.get('Note') or '')
        if desc:
            lines.append(f'DESCRIPTION:{desc}')
        if f.get('Eventbrite URL'):
            lines.append(f"URL:{f['Eventbrite URL']}")
        lines.append('END:VEVENT')
    lines.append('END:VCALENDAR')
    return '\r\n'.join(ics_fold(l) for l in lines) + '\r\n'


@app.route('/api/calendar.ics')
def calendar_feed():
    """Live feed for Outlook, Google, and Apple Calendar.

    ?token=<ICS_STAFF_TOKEN>   all events, including staff-only
    ?token=<ICS_PUBLIC_TOKEN>  everything except staff-only
    &course=<cohort>           optional, includes shared events too
    &cuny=0                    optional, leaves out the college calendar
    """
    token = request.args.get('token', '')
    if hmac.compare_digest(token.encode(), ICS_STAFF_TOKEN.encode()):
        include_staff_only = True
    elif hmac.compare_digest(token.encode(), ICS_PUBLIC_TOKEN.encode()):
        include_staff_only = False
    else:
        return Response('Unauthorized — missing or invalid token',
                        status=401, mimetype='text/plain')

    course  = request.args.get('course', '')
    # Default is to include the college calendar; only an explicit 0 drops it.
    exclude_cuny = request.args.get('cuny', '1') == '0'
    formula = build_event_formula(include_staff_only, course, exclude_cuny)
    recs = events_table.all(formula=formula, sort=['Date']) if formula \
        else events_table.all(sort=['Date'])

    track('ics_feed')
    name = 'Moynihan Fellowship'
    if course in COURSES:
        name += f' — {COURSES[course]["code"]}'
    name += f' — {SEMESTER_LABEL}'
    if exclude_cuny:
        name += ' (sessions only)'
    if include_staff_only:
        name += ' (Staff)'
    return Response(
        build_ics(recs, name),
        mimetype='text/calendar; charset=utf-8',
        headers={
            'Content-Disposition': 'attachment; filename="moynihan-fellowship.ics"',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
    )


@app.route('/api/events/<string:event_id>/ics')
@login_required
def download_event_ics(event_id):
    rec = events_table.get(event_id)
    if not rec:
        return jsonify({'error': 'Not found'}), 404
    f = rec['fields']
    if (f.get('Is Staff Only') or f.get('Is Hidden')) and not is_staff():
        return jsonify({'error': 'Not found'}), 404
    return Response(
        build_ics([rec], rec['fields'].get('Title', 'Event')),
        mimetype='text/calendar; charset=utf-8',
        headers={'Content-Disposition': f'attachment; filename="event-{event_id}.ics"'},
    )


# ── ANNOUNCEMENTS ─────────────────────────────────────────────────────────────

@app.route('/api/announcements')
@login_required
def get_announcements():
    recs = announcements_table.all(sort=['-Created At'])
    if not is_staff():
        recs = [r for r in recs if announcement_is_current(r)]
    # Pinned first, then newest. Sort is stable, so the date order survives.
    recs.sort(key=lambda r: 0 if r['fields'].get('Is Pinned') else 1)
    return jsonify([announcement_to_dict(r) for r in recs])


@app.route('/api/announcements', methods=['POST'])
@staff_required
def create_announcement():
    data  = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    body  = (data.get('body') or '').strip()
    if not title or not body:
        return jsonify({'error': 'Title and body are required.'}), 400
    rec = announcements_table.create({
        'Title':      title,
        'Body':       body,
        # 'color' is the old key; accepted so a cached script still works.
        'Category':   data.get('category') or data.get('color') or 'general',
        'Show Until': (data.get('show_until') or '') or None,
        'Is Pinned':  bool(data.get('is_pinned')),
        'Created At': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z'),
    }, typecast=True)
    return jsonify(announcement_to_dict(rec)), 201


@app.route('/api/announcements/<string:ann_id>', methods=['PATCH'])
@staff_required
def update_announcement(ann_id):
    data = request.get_json(silent=True) or {}
    if not announcements_table.get(ann_id):
        return jsonify({'error': 'Not found'}), 404
    updates = {}
    for key, at_key in (('title', 'Title'), ('body', 'Body'), ('category', 'Category')):
        if key in data:
            updates[at_key] = data[key]
    if 'show_until' in data:
        updates['Show Until'] = (data['show_until'] or '') or None
    if 'is_pinned' in data:
        updates['Is Pinned'] = bool(data['is_pinned'])
    if not updates:
        return jsonify({'error': 'Nothing to update.'}), 400
    return jsonify(announcement_to_dict(
        announcements_table.update(ann_id, updates, typecast=True)))


@app.route('/api/announcements/<string:ann_id>', methods=['DELETE'])
@staff_required
def delete_announcement(ann_id):
    if not announcements_table.get(ann_id):
        return jsonify({'error': 'Not found'}), 404
    announcements_table.delete(ann_id)
    return jsonify({'ok': True})


# ── RESOURCES ─────────────────────────────────────────────────────────────────

@app.route('/api/resources')
@login_required
def get_resources():
    """Students get live items only. Staff get hidden ones too, flagged, so a
    resource can be parked and brought back from the portal rather than Airtable."""
    if is_staff():
        recs = resources_table.all(sort=['Category', 'Order Index'])
    else:
        recs = resources_table.all(formula='{Is Active}=1',
                                   sort=['Category', 'Order Index'])
    return jsonify([resource_to_dict(r) for r in recs])


@app.route('/api/resources', methods=['POST'])
@staff_required
def create_resource():
    data  = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'Title is required.'}), 400
    audience = data.get('audience') or []
    if not isinstance(audience, list):
        audience = []
    audience = [a for a in audience if a in COURSES]
    existing = resources_table.all()
    next_index = max([r['fields'].get('Order Index', 0) for r in existing] or [0]) + 1
    rec = resources_table.create({
        'Title':       title,
        'URL':         (data.get('url') or '').strip(),
        'Description': data.get('description', ''),
        'Category':    data.get('category', 'general'),
        'Audience':    audience,
        'Is Required': bool(data.get('is_required')),
        'Due Label':   (data.get('due_label') or '').strip(),
        'Is Active':   True,
        'Order Index': next_index,
    }, typecast=True)
    return jsonify(resource_to_dict(rec)), 201


@app.route('/api/resources/<string:res_id>', methods=['PATCH'])
@staff_required
def update_resource(res_id):
    data = request.get_json(silent=True) or {}
    if not resources_table.get(res_id):
        return jsonify({'error': 'Not found'}), 404
    updates = {}
    for key, at_key in (('title', 'Title'), ('url', 'URL'),
                        ('description', 'Description'), ('category', 'Category'),
                        ('due_label', 'Due Label')):
        if key in data:
            updates[at_key] = data[key]
    if 'audience' in data:
        aud = data['audience'] if isinstance(data['audience'], list) else []
        updates['Audience'] = [a for a in aud if a in COURSES]
    if 'is_required' in data:
        updates['Is Required'] = bool(data['is_required'])
    if 'is_active' in data:
        updates['Is Active'] = bool(data['is_active'])
    if 'order_index' in data:
        try:
            updates['Order Index'] = int(data['order_index'])
        except (TypeError, ValueError):
            return jsonify({'error': 'Order must be a whole number.'}), 400
    if not updates:
        return jsonify({'error': 'Nothing to update.'}), 400
    return jsonify(resource_to_dict(
        resources_table.update(res_id, updates, typecast=True)))


@app.route('/api/resources/<string:res_id>', methods=['DELETE'])
@staff_required
def delete_resource(res_id):
    if not resources_table.get(res_id):
        return jsonify({'error': 'Not found'}), 404
    resources_table.update(res_id, {'Is Active': False})
    return jsonify({'ok': True})


# ── USAGE API ─────────────────────────────────────────────────────────────────

@app.route('/api/track', methods=['POST'])
@login_required
def track_event():
    """Frontend reports which tab was opened. Only names on the allowlist count."""
    data = request.get_json(silent=True) or {}
    track((data.get('metric') or '').strip())
    return jsonify({'ok': True})


@app.route('/api/usage')
@staff_required
def get_usage():
    """Aggregate counts, newest day first. Staff only."""
    flush_usage()          # so the numbers include the current buffer
    recs = usage_table.all()
    by_metric, by_day = {}, {}
    for r in recs:
        f = r['fields']
        metric, day = f.get('Metric'), f.get('Date')
        n = f.get('Count') or 0
        if not metric or not day:
            continue
        by_metric[metric] = by_metric.get(metric, 0) + n
        by_day.setdefault(day, {})[metric] = n
    return jsonify({
        'totals': by_metric,
        'days':   [{'date': d, 'metrics': by_day[d]} for d in sorted(by_day, reverse=True)],
        'tracked': sorted(TRACKED_METRICS),
    })


# ── STAFF ACCOUNTS ────────────────────────────────────────────────────────────

@app.route('/api/staff')
@staff_required
def get_staff():
    recs = users_table.all(formula="{Role}!='student'", sort=['Name'])
    return jsonify([staff_user_to_dict(r) for r in recs])


@app.route('/api/staff', methods=['POST'])
@staff_required
def create_staff():
    data     = request.get_json(silent=True) or {}
    name     = (data.get('name') or '').strip()
    username = (data.get('username') or '').strip().lower()
    password = (data.get('password') or '').strip()
    role     = data.get('role', 'instructor')
    if not name or not username or not password:
        return jsonify({'error': 'Name, username, and password are required.'}), 400
    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters.'}), 400
    if role not in STAFF_ROLES:
        return jsonify({'error': 'Unknown role.'}), 400
    safe = escape_formula_value(username)
    if users_table.first(formula=f"{{Username}}='{safe}'"):
        return jsonify({'error': f'Username "{username}" is already taken.'}), 409
    rec = users_table.create({
        'Name':          name,
        'Username':      username,
        'Password Hash': hash_password(password),
        'Role':          role,
        'Course':        data.get('course', 'both'),
        'Initials':      make_initials(name),
        'Is Active':     True,
    })
    return jsonify(staff_user_to_dict(rec)), 201


@app.route('/api/staff/<string:user_id>', methods=['PATCH'])
@staff_required
def update_staff(user_id):
    data = request.get_json(silent=True) or {}
    rec  = users_table.get(user_id)
    if not rec or rec['fields'].get('Role') not in STAFF_ROLES:
        return jsonify({'error': 'Not found'}), 404

    updates = {}
    if 'password' in data:
        new_pw = (data['password'] or '').strip()
        if len(new_pw) < 8:
            return jsonify({'error': 'Password must be at least 8 characters.'}), 400
        updates['Password Hash'] = hash_password(new_pw)
    if 'is_active' in data:
        if user_id == session.get('user_id') and not data['is_active']:
            return jsonify({'error': 'You cannot deactivate your own account.'}), 400
        updates['Is Active'] = bool(data['is_active'])
    if 'role' in data:
        if data['role'] not in STAFF_ROLES:
            return jsonify({'error': 'Unknown role.'}), 400
        updates['Role'] = data['role']
    if 'course' in data:
        updates['Course'] = data['course']
    if not updates:
        return jsonify({'error': 'Nothing to update.'}), 400

    users_table.update(user_id, updates)
    return jsonify(staff_user_to_dict(users_table.get(user_id)))


@app.route('/api/staff/<string:user_id>', methods=['DELETE'])
@staff_required
def delete_staff(user_id):
    if user_id == session.get('user_id'):
        return jsonify({'error': 'You cannot delete your own account.'}), 400
    rec = users_table.get(user_id)
    if not rec or rec['fields'].get('Role') not in STAFF_ROLES:
        return jsonify({'error': 'Not found'}), 404
    users_table.delete(user_id)
    return jsonify({'ok': True})


# ── ERROR HANDLERS ────────────────────────────────────────────────────────────
# Always answer /api/ with JSON so the frontend never tries to parse an HTML
# error page.

@app.errorhandler(404)
def handle_404(e):
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Not found'}), 404
    return render_template(
        'portal.html',
        semester=SEMESTER_LABEL,
        courses=COURSES,
        public_ics_url=public_ics_url(),
        current_year=date.today().year,
        asset_version=asset_version(),
        staff_directory=STAFF_DIRECTORY,
        contact_routing=CONTACT_ROUTING,
        general_contact=GENERAL_CONTACT,
    ), 404


@app.errorhandler(500)
def handle_500(e):
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Something went wrong on the server.'}), 500
    return 'Something went wrong on the server.', 500


@app.errorhandler(Exception)
def handle_unexpected(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return e
    app.logger.exception('Unhandled error on %s', request.path)
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Something went wrong on the server.'}), 500
    return 'Something went wrong on the server.', 500


if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=int(os.environ.get('PORT', 5000)),
        debug=os.environ.get('FLASK_ENV') == 'development',
    )
