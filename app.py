import os
import csv
import io
from datetime import datetime, timedelta
from functools import wraps

import bcrypt
from flask import Flask, jsonify, render_template, request, session, Response
from pyairtable import Api

app = Flask(__name__)

_secret = os.environ.get('SECRET_KEY')
if not _secret:
    import sys
    if os.environ.get('FLASK_ENV') == 'production':
        sys.exit('FATAL: SECRET_KEY environment variable is not set. Refusing to start.')
    _secret = 'dev-secret-change-in-production'
app.secret_key = _secret

app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=8)
app.config['SESSION_REFRESH_EACH_REQUEST'] = True

DEFAULT_PASSWORD  = os.environ.get('DEFAULT_STUDENT_PASSWORD', 'moynihan2025')
SETUP_KEY         = os.environ.get('SETUP_KEY', 'moynihan-setup-2025')
ICS_STAFF_TOKEN   = os.environ.get('ICS_STAFF_TOKEN',  'staff-cal-2025')
ICS_PUBLIC_TOKEN  = os.environ.get('ICS_PUBLIC_TOKEN', 'moynihan-cal-2025')

AIRTABLE_BASE_ID = os.environ.get('AIRTABLE_BASE_ID', 'appXXXXXXXXXXXXXX')

# ── AIRTABLE CLIENT ───────────────────────────────────────────────────────────

airtable = Api(os.environ.get('AIRTABLE_TOKEN'))

users_table          = airtable.table(AIRTABLE_BASE_ID, 'tbl7gqQHD2AkunIAz')
events_table         = airtable.table(AIRTABLE_BASE_ID, 'tbl3P7neAyuA5gT7w')
announcements_table  = airtable.table(AIRTABLE_BASE_ID, 'tblXu9wY2ybY1NXEO')
modules_table        = airtable.table(AIRTABLE_BASE_ID, 'tblAQkYdFqk0O2u9X')
sessions_table       = airtable.table(AIRTABLE_BASE_ID, 'tbldnqBjclHKUMQ4X')
deliverables_table   = airtable.table(AIRTABLE_BASE_ID, 'tbl4Dh3upHHURfuyp')
readings_table       = airtable.table(AIRTABLE_BASE_ID, 'tblJe1jCoMm2Hra3q')
rsvps_table          = airtable.table(AIRTABLE_BASE_ID, 'tblJuOVydDok5tgUK')
finance_items_table  = airtable.table(AIRTABLE_BASE_ID, 'tblHj4IkpvsL7no8F')
finance_checks_table = airtable.table(AIRTABLE_BASE_ID, 'tbl2rmHJBYWnjfTqk')
resources_table      = airtable.table(AIRTABLE_BASE_ID, 'tblVBg7D1n1WvYN40')
notes_table          = airtable.table(AIRTABLE_BASE_ID, 'tbltRpzpjwcfGwRGr')


# ── HELPERS ───────────────────────────────────────────────────────────────────

def rec_to_dict(rec, id_field='id'):
    """Return a record's fields dict with 'id' set to the Airtable record ID."""
    d = dict(rec.get('fields', {}))
    d[id_field] = rec['id']
    return d


def hash_password(plain):
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def check_password(plain, hashed):
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def make_initials(name):
    parts = name.strip().split()
    return ''.join(p[0] for p in parts if p)[:2].upper()


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Unauthorized'}), 401
        if session.get('role') not in ('admin', 'instructor', 'coordinator'):
            return jsonify({'error': 'Forbidden'}), 403
        return f(*args, **kwargs)
    return decorated


def can_access_course(student_course):
    """True if the current admin has legitimate access to a student's course."""
    my_course = session.get('course')
    if session.get('role') == 'admin':
        return True  # site admin sees everything
    if not my_course or my_course == 'both':
        return True
    return student_course == my_course or student_course == 'both'


# ── PAGES ────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('portal.html')


# ── SEED API ─────────────────────────────────────────────────────────────────

@app.route('/api/seed', methods=['POST'])
def seed():
    """Create default admin users. Protected by SETUP_KEY header or admin session."""
    data = request.get_json(silent=True) or {}
    setup_key = request.headers.get('X-Setup-Key', '') or data.get('setup_key', '')
    is_admin_session = session.get('role') == 'admin'
    if not is_admin_session and setup_key != SETUP_KEY:
        return jsonify({'error': 'Forbidden — provide X-Setup-Key header or log in as admin'}), 403

    defaults = [
        {'username': 'admin',  'name': 'Admin User',      'password': 'admin2025',    'role': 'admin',       'course': 'both'},
        {'username': 'layana', 'name': 'Layana Abu Touq', 'password': 'moynihan2025', 'role': 'coordinator', 'course': 'both'},
        {'username': 'miller', 'name': 'Miller',          'password': 'tap2025',      'role': 'instructor',  'course': 'both'},
    ]
    created = []
    skipped = []
    for u in defaults:
        existing = users_table.first(formula=f"{{Username}}='{u['username']}'")
        if existing:
            skipped.append(u['username'])
            continue
        initials = make_initials(u['name'])
        users_table.create({
            'Name': u['name'],
            'Username': u['username'],
            'Email': '',
            'Password Hash': hash_password(u['password']),
            'Role': u['role'],
            'Course': u['course'],
            'Initials': initials,
            'Is Active': True,
        })
        created.append(u['username'])
    return jsonify({'created': created, 'skipped': skipped}), 201


# ── AUTH API ─────────────────────────────────────────────────────────────────

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip().lower()
    password = data.get('password') or ''
    if not username or not password:
        return jsonify({'error': 'Username and password required'}), 400

    rec = users_table.first(formula=f"AND({{Username}}='{username}', {{Is Active}}=1)")
    if not rec:
        return jsonify({'error': 'Incorrect username or password'}), 401
    fields = rec['fields']
    if not check_password(password, fields.get('Password Hash', '')):
        return jsonify({'error': 'Incorrect username or password'}), 401

    session.permanent   = True
    session['user_id']  = rec['id']
    session['username'] = fields.get('Username', username)
    session['role']     = fields.get('Role', 'student')
    session['course']   = fields.get('Course', 'psc31180')
    display_name = fields.get('Name', '')
    return jsonify({
        'role':       fields.get('Role', 'student'),
        'display':    display_name,
        'initials':   fields.get('Initials', make_initials(display_name)),
        'course':     fields.get('Course', 'psc31180'),
        'first_name': display_name.split()[0] if display_name else '',
    })


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/change-password', methods=['POST'])
@login_required
def change_password():
    data = request.get_json(silent=True) or {}
    current  = data.get('current', '')
    new_pass = data.get('new', '')
    confirm  = data.get('confirm', '')

    rec = users_table.get(session['user_id'])
    if not rec:
        return jsonify({'error': 'User not found'}), 404
    if not check_password(current, rec['fields'].get('Password Hash', '')):
        return jsonify({'error': 'Current password is incorrect'}), 400
    if len(new_pass) < 8:
        return jsonify({'error': 'New password must be at least 8 characters'}), 400
    if new_pass != confirm:
        return jsonify({'error': 'New passwords do not match'}), 400
    users_table.update(session['user_id'], {'Password Hash': hash_password(new_pass)})
    return jsonify({'ok': True})


# ── EVENTS API ───────────────────────────────────────────────────────────────

def _event_to_dict(rec):
    d = rec_to_dict(rec)
    # Normalize field names to match frontend expectations
    return {
        'id':             rec['id'],
        'title':          d.get('Title', ''),
        'date':           d.get('Date', ''),
        'cat':            d.get('Category', 'lecture'),
        'course':         d.get('Course', 'psc31180'),
        'note':           d.get('Note', ''),
        'description':    d.get('Description', ''),
        'eventbrite_url': d.get('Eventbrite URL', ''),
        'is_mandatory':   1 if d.get('Is Mandatory') else 0,
        'is_hidden':      1 if d.get('Is Hidden') else 0,
        'is_locked':      1 if d.get('Is Locked') else 0,
        'is_staff_only':  1 if d.get('Is Staff Only') else 0,
    }


@app.route('/api/events')
@login_required
def get_events():
    is_staff = session.get('role') in ('admin', 'instructor', 'coordinator')
    course_filter = request.args.get('course', '')
    base_formula = '' if is_staff else '{Is Staff Only}!=1'
    if course_filter:
        course_formula = f"{{Course}}='{course_filter}'"
        formula = f"AND({base_formula},{course_formula})" if base_formula else course_formula
    else:
        formula = base_formula or None
    if formula:
        recs = events_table.all(formula=formula, sort=['Date'])
    else:
        recs = events_table.all(sort=['Date'])
    return jsonify([_event_to_dict(r) for r in recs])


@app.route('/api/events', methods=['POST'])
@admin_required
def create_event():
    data = request.get_json(silent=True) or {}
    title          = (data.get('title') or '').strip()
    date_val       = (data.get('date') or '').strip()
    cat            = data.get('cat', 'lecture')
    note           = data.get('note', '')
    description    = data.get('description', '')
    eventbrite_url = data.get('eventbrite_url', '')
    is_mandatory   = bool(data.get('is_mandatory'))
    course         = data.get('course', 'psc31180')
    if not title or not date_val:
        return jsonify({'error': 'Title and date required'}), 400
    is_staff_only = bool(data.get('is_staff_only'))
    rec = events_table.create({
        'Title':          title,
        'Date':           date_val,
        'Category':       cat,
        'Note':           note,
        'Description':    description,
        'Eventbrite URL': eventbrite_url,
        'Is Mandatory':   is_mandatory,
        'Course':         course,
        'Is Hidden':      False,
        'Is Locked':      False,
        'Is Staff Only':  is_staff_only,
    })
    return jsonify(_event_to_dict(rec)), 201


@app.route('/api/events/<string:event_id>', methods=['PATCH'])
@admin_required
def update_event(event_id):
    data = request.get_json(silent=True) or {}
    rec = events_table.get(event_id)
    if not rec:
        return jsonify({'error': 'Not found'}), 404

    field_map = {
        'title':          'Title',
        'date':           'Date',
        'cat':            'Category',
        'note':           'Note',
        'description':    'Description',
        'eventbrite_url': 'Eventbrite URL',
        'is_mandatory':   'Is Mandatory',
        'course':         'Course',
        'is_hidden':      'Is Hidden',
        'is_locked':      'Is Locked',
        'is_staff_only':  'Is Staff Only',
    }
    updates = {}
    for client_key, at_key in field_map.items():
        if client_key in data:
            val = data[client_key]
            if client_key in ('is_mandatory', 'is_hidden', 'is_locked', 'is_staff_only'):
                val = bool(val)
            updates[at_key] = val
    if not updates:
        return jsonify({'error': 'No valid fields'}), 400
    updated = events_table.update(event_id, updates)
    return jsonify(_event_to_dict(updated))


@app.route('/api/events/<string:event_id>', methods=['DELETE'])
@admin_required
def delete_event(event_id):
    # Delete associated RSVPs first
    rsvp_recs = rsvps_table.all(formula=f"FIND('{event_id}', ARRAYJOIN({{Event}}, ','))>0")
    for r in rsvp_recs:
        rsvps_table.delete(r['id'])
    events_table.delete(event_id)
    return jsonify({'ok': True})


@app.route('/api/events/<string:event_id>/ics')
@login_required
def download_ics(event_id):
    rec = events_table.get(event_id)
    if not rec:
        return jsonify({'error': 'Not found'}), 404
    ev = rec['fields']
    dt = (ev.get('Date') or '').replace('-', '')  # YYYYMMDD
    uid = f"event-{event_id}@moynihan-portal"
    summary = (ev.get('Title') or '').replace(',', '\\,').replace(';', '\\;')
    location = (ev.get('Note') or '').split('·')[0].strip().replace(',', '\\,')
    desc = (ev.get('Description') or ev.get('Note') or '').replace('\n', '\\n')
    now_str = datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
    ics = f"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Moynihan Center//Fellowship Portal//EN
BEGIN:VEVENT
UID:{uid}
DTSTAMP:{now_str}
DTSTART;VALUE=DATE:{dt}
DTEND;VALUE=DATE:{dt}
SUMMARY:{summary}
LOCATION:{location}
DESCRIPTION:{desc}
END:VEVENT
END:VCALENDAR"""
    return Response(
        ics,
        mimetype='text/calendar',
        headers={'Content-Disposition': f'attachment; filename="event-{event_id}.ics"'}
    )


@app.route('/api/calendar.ics')
def calendar_feed():
    """Live ICS calendar feed for Outlook/Google/Apple Calendar subscription.

    ?token=<ICS_STAFF_TOKEN>   — all events including staff-only
    ?token=<ICS_PUBLIC_TOKEN>  — all events except staff-only
    &course=psc31180|psc31330  — optional course filter
    """
    token = request.args.get('token', '')
    if token == ICS_STAFF_TOKEN:
        include_staff_only = True
    elif token == ICS_PUBLIC_TOKEN:
        include_staff_only = False
    else:
        return Response('Unauthorized — missing or invalid token', status=401, mimetype='text/plain')

    course_filter = request.args.get('course', '')

    clauses = []
    if not include_staff_only:
        clauses.append('{Is Staff Only}!=1')
    if course_filter:
        clauses.append(f"OR({{Course}}='{course_filter}', {{Course}}='joint')")

    if len(clauses) == 2:
        formula = f'AND({clauses[0]}, {clauses[1]})'
    elif clauses:
        formula = clauses[0]
    else:
        formula = None

    recs = events_table.all(formula=formula, sort=['Date']) if formula else events_table.all(sort=['Date'])

    def ics_escape(text):
        return (text or '').replace('\\', '\\\\').replace(';', '\\;').replace(',', '\\,').replace('\n', '\\n')

    def ics_fold(line):
        """Fold lines longer than 75 octets per RFC 5545."""
        encoded = line.encode('utf-8')
        if len(encoded) <= 75:
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

    now_str = datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
    cal_name = 'Moynihan Center Fellowship (Staff)' if include_staff_only else 'Moynihan Center Fellowship'

    lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Moynihan Center//Fellowship Portal//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        f'X-WR-CALNAME:{cal_name}',
        'X-WR-TIMEZONE:America/New_York',
    ]

    for rec in recs:
        f = rec['fields']
        date_raw = (f.get('Date') or '').replace('-', '')
        if not date_raw or len(date_raw) < 8:
            continue
        try:
            from datetime import date as _date
            y, mo, d = int(date_raw[:4]), int(date_raw[4:6]), int(date_raw[6:8])
            dtend_str = (_date(y, mo, d) + timedelta(days=1)).strftime('%Y%m%d')
        except Exception:
            dtend_str = date_raw

        summary  = ics_escape(f.get('Title', ''))
        location = ics_escape((f.get('Note') or '').split('·')[0].strip())
        desc     = ics_escape(f.get('Description') or f.get('Note') or '')
        uid      = f"event-{rec['id']}@moynihan-portal"

        vevent = [
            'BEGIN:VEVENT',
            f'UID:{uid}',
            f'DTSTAMP:{now_str}',
            f'DTSTART;VALUE=DATE:{date_raw}',
            f'DTEND;VALUE=DATE:{dtend_str}',
            f'SUMMARY:{summary}',
        ]
        if location:
            vevent.append(f'LOCATION:{location}')
        if desc:
            vevent.append(f'DESCRIPTION:{desc}')
        if f.get('Eventbrite URL'):
            vevent.append(f"URL:{f['Eventbrite URL']}")
        vevent.append('END:VEVENT')
        lines.extend(vevent)

    lines.append('END:VCALENDAR')
    ics_body = '\r\n'.join(ics_fold(l) for l in lines) + '\r\n'

    return Response(
        ics_body,
        mimetype='text/calendar; charset=utf-8',
        headers={
            'Content-Disposition': 'attachment; filename="moynihan-fellowship.ics"',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
        }
    )


# ── ANNOUNCEMENTS API ────────────────────────────────────────────────────────

def _ann_to_dict(rec):
    d = rec['fields']
    return {
        'id':         rec['id'],
        'title':      d.get('Title', ''),
        'body':       d.get('Body', ''),
        'category':   d.get('Category', 'maroon'),
        'week_tag':   d.get('Week Tag', ''),
        'created_at': d.get('Created At', ''),
    }


@app.route('/api/announcements')
@login_required
def get_announcements():
    week_tag = request.args.get('week', '')
    if week_tag:
        formula = f"OR({{Week Tag}}='{week_tag}', {{Week Tag}}='')"
        recs = announcements_table.all(formula=formula, sort=['-Created At'])
    else:
        recs = announcements_table.all(sort=['-Created At'])
    return jsonify([_ann_to_dict(r) for r in recs])


@app.route('/api/announcements', methods=['POST'])
@admin_required
def create_announcement():
    data = request.get_json(silent=True) or {}
    title    = (data.get('title') or '').strip()
    body     = (data.get('body') or '').strip()
    category = data.get('color', data.get('category', 'maroon'))
    week_tag = (data.get('week_tag') or '').strip()
    if not title or not body:
        return jsonify({'error': 'Title and body required'}), 400
    rec = announcements_table.create({
        'Title':      title,
        'Body':       body,
        'Category':   category,
        'Week Tag':   week_tag,
        'Created At': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z'),
    })
    return jsonify(_ann_to_dict(rec)), 201


@app.route('/api/announcements/<string:ann_id>', methods=['DELETE'])
@admin_required
def delete_announcement(ann_id):
    announcements_table.delete(ann_id)
    return jsonify({'ok': True})


# ── MODULES API ──────────────────────────────────────────────────────────────

def _session_to_dict(rec):
    d = rec['fields']
    return {
        'id':          rec['id'],
        'module_id':   d.get('Module', [None])[0] if d.get('Module') else None,
        'title':       d.get('Title', ''),
        'date_label':  d.get('Date', ''),
        'note':        d.get('Note', ''),
        'is_joint':    1 if d.get('Type') == 'Joint' else 0,
        'order_index': d.get('Order Index', 0),
    }


def _deliverable_to_dict(rec):
    d = rec['fields']
    return {
        'id':          rec['id'],
        'module_id':   d.get('Module', [None])[0] if d.get('Module') else None,
        'title':       d.get('Title', ''),
        'due_date':    d.get('Due Date', ''),
        'cat':         d.get('Category', 'homework'),
        'note':        d.get('Note', ''),
        'order_index': d.get('Order Index', 0),
    }


def _reading_to_dict(rec):
    d = rec['fields']
    return {
        'id':          rec['id'],
        'module_id':   d.get('Module', [None])[0] if d.get('Module') else None,
        'title':       d.get('Title', ''),
        'when_label':  d.get('Author', ''),
        'type':        'PDF',
        'description': d.get('URL', d.get('Note', '')),
        'order_index': d.get('Order Index', 0),
    }


def _module_to_dict(rec):
    d = rec['fields']
    return {
        'id':             rec['id'],
        'title':          d.get('Title', ''),
        'label':          d.get('Title', ''),
        'description':    d.get('Overview', ''),
        'course':         d.get('Course', ''),
        'order_index':    d.get('Order Index', 0),
        'last_updated_at': d.get('Last Updated At', ''),
        'last_updated_by': d.get('Last Updated By', ''),
        'week_number':    d.get('Week Number', ''),
    }


@app.route('/api/modules')
@login_required
def get_modules():
    course_filter = request.args.get('course', '')
    if course_filter:
        mods = modules_table.all(formula=f"{{Course}}='{course_filter}'", sort=['Order Index'])
    else:
        mods = modules_table.all(sort=['Order Index'])

    # Fetch all child records in bulk
    all_sessions     = sessions_table.all(sort=['Order Index'])
    all_deliverables = deliverables_table.all()
    all_readings     = readings_table.all(sort=['Order Index'])

    result = []
    for m in mods:
        mid = m['id']
        mod_dict = _module_to_dict(m)

        mod_sessions = [
            _session_to_dict(s) for s in all_sessions
            if mid in (s['fields'].get('Module') or [])
        ]
        mod_deliverables = [
            _deliverable_to_dict(d) for d in all_deliverables
            if mid in (d['fields'].get('Module') or [])
        ]
        mod_readings = [
            _reading_to_dict(r) for r in all_readings
            if mid in (r['fields'].get('Module') or [])
        ]

        mod_dict['sessions']     = mod_sessions
        mod_dict['deliverables'] = mod_deliverables
        mod_dict['readings']     = mod_readings
        result.append(mod_dict)

    return jsonify(result)


@app.route('/api/modules/<string:mod_id>', methods=['PATCH'])
@admin_required
def update_module(mod_id):
    data = request.get_json(silent=True) or {}
    rec = modules_table.get(mod_id)
    if not rec:
        return jsonify({'error': 'Not found'}), 404

    field_map = {
        'title':       'Title',
        'description': 'Overview',
        'weeks':       'Week Number',
    }
    updates = {}
    for client_key, at_key in field_map.items():
        if client_key in data:
            updates[at_key] = data[client_key]

    if updates:
        updates['Last Updated At'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')
        updates['Last Updated By'] = session.get('username', '')
        modules_table.update(mod_id, updates)
    return jsonify({'ok': True})


# ── RSVPs API ────────────────────────────────────────────────────────────────

@app.route('/api/rsvps')
@login_required
def get_rsvps():
    uid = session['user_id']
    recs = rsvps_table.all(formula=f"FIND('{uid}', ARRAYJOIN({{User}}, ','))>0")
    event_ids = []
    for r in recs:
        event_list = r['fields'].get('Event') or []
        if event_list:
            event_ids.append(event_list[0])
    return jsonify(event_ids)


@app.route('/api/rsvps/<string:event_id>', methods=['POST'])
@login_required
def toggle_rsvp(event_id):
    uid = session['user_id']
    key = f"{uid}_{event_id}"
    existing = rsvps_table.first(formula=f"{{Key}}='{key}'")
    if existing:
        rsvps_table.delete(existing['id'])
        return jsonify({'rsvpd': False})
    else:
        rsvps_table.create({
            'Key':        key,
            'User':       [uid],
            'Event':      [event_id],
            'Created At': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z'),
        })
        return jsonify({'rsvpd': True})


@app.route('/api/rsvps/all')
@admin_required
def get_all_rsvps():
    my_course = session.get('course')
    all_rsvps = rsvps_table.all()

    # Build a lookup of user record IDs -> user info
    if session.get('role') == 'admin' or not my_course or my_course == 'both':
        user_recs = users_table.all(formula="OR({Role}='student', {Role}='student')")
        # Actually fetch all users to build lookup
        user_recs = users_table.all()
    else:
        user_recs = users_table.all(
            formula=f"OR({{Course}}='{my_course}', {{Course}}='both')"
        )

    user_lookup = {}
    for u in user_recs:
        user_lookup[u['id']] = {
            'name':  u['fields'].get('Name', ''),
            'email': u['fields'].get('Email', ''),
            'course': u['fields'].get('Course', ''),
        }

    by_event = {}
    for r in all_rsvps:
        f = r['fields']
        user_list  = f.get('User') or []
        event_list = f.get('Event') or []
        if not user_list or not event_list:
            continue
        user_rec_id  = user_list[0]
        event_rec_id = event_list[0]
        user_info = user_lookup.get(user_rec_id)
        if not user_info:
            continue
        # Apply course filter for non-global admins
        if session.get('role') != 'admin' and my_course and my_course != 'both':
            if user_info['course'] not in (my_course, 'both'):
                continue
        if event_rec_id not in by_event:
            by_event[event_rec_id] = []
        by_event[event_rec_id].append({
            'user_id': user_rec_id,
            'name':    user_info['name'],
            'email':   user_info['email'],
        })
    return jsonify(by_event)


# ── FINANCE API ──────────────────────────────────────────────────────────────

def _finance_item_to_dict(rec):
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


@app.route('/api/finance')
@login_required
def get_finance():
    uid = session['user_id']
    items = finance_items_table.all(sort=['Order Index'])
    checks = finance_checks_table.all(
        formula=f"FIND('{uid}', ARRAYJOIN({{User}}, ','))>0"
    )
    checked_item_ids = set()
    for c in checks:
        item_list = c['fields'].get('Finance Item') or []
        if item_list:
            checked_item_ids.add(item_list[0])

    result = []
    for item in items:
        d = _finance_item_to_dict(item)
        d['checked'] = item['id'] in checked_item_ids
        result.append(d)
    return jsonify(result)


@app.route('/api/finance', methods=['POST'])
@admin_required
def create_finance_item():
    data = request.get_json(silent=True) or {}
    title       = (data.get('title') or '').strip()
    description = data.get('description', '')
    category    = data.get('category', 'general')
    link        = (data.get('link') or '').strip()
    due_label   = (data.get('due_label') or '').strip()
    is_required = bool(data.get('is_required', True))
    if not title:
        return jsonify({'error': 'Title required'}), 400
    fields = {
        'Title':       title,
        'Description': description,
        'Category':    category,
        'Is Required': is_required,
    }
    if link:
        fields['Link'] = link
    if due_label:
        fields['Due Label'] = due_label
    rec = finance_items_table.create(fields)
    return jsonify(_finance_item_to_dict(rec)), 201


@app.route('/api/finance/<string:item_id>', methods=['DELETE'])
@admin_required
def delete_finance_item(item_id):
    # Delete associated checks first
    check_recs = finance_checks_table.all(
        formula=f"FIND('{item_id}', ARRAYJOIN({{Finance Item}}, ','))>0"
    )
    for c in check_recs:
        finance_checks_table.delete(c['id'])
    finance_items_table.delete(item_id)
    return jsonify({'ok': True})


@app.route('/api/finance/<string:item_id>/check', methods=['POST'])
@login_required
def toggle_finance_check(item_id):
    uid = session['user_id']
    key = f"{uid}_{item_id}"
    existing = finance_checks_table.first(formula=f"{{Key}}='{key}'")
    if existing:
        finance_checks_table.delete(existing['id'])
        return jsonify({'checked': False})
    else:
        finance_checks_table.create({
            'Key':          key,
            'User':         [uid],
            'Finance Item': [item_id],
            'Checked At':   datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z'),
        })
        return jsonify({'checked': True})


@app.route('/api/finance/all-checks')
@admin_required
def get_all_finance_checks():
    my_course = session.get('course')
    all_checks = finance_checks_table.all()
    all_items  = finance_items_table.all(sort=['Order Index'])

    if session.get('role') == 'admin' or not my_course or my_course == 'both':
        user_recs = users_table.all()
    else:
        user_recs = users_table.all(
            formula=f"OR({{Course}}='{my_course}', {{Course}}='both')"
        )

    user_lookup = {u['id']: u['fields'] for u in user_recs}
    item_lookup = {i['id']: i['fields'].get('Title', '') for i in all_items}

    by_item = {}
    for c in all_checks:
        f = c['fields']
        user_list = f.get('User') or []
        item_list = f.get('Finance Item') or []
        if not user_list or not item_list:
            continue
        user_rec_id = user_list[0]
        item_rec_id = item_list[0]
        user_info = user_lookup.get(user_rec_id)
        if not user_info:
            continue
        if session.get('role') != 'admin' and my_course and my_course != 'both':
            if user_info.get('Course') not in (my_course, 'both'):
                continue
        if item_rec_id not in by_item:
            by_item[item_rec_id] = {
                'title':    item_lookup.get(item_rec_id, ''),
                'students': [],
            }
        by_item[item_rec_id]['students'].append({
            'user_id': user_rec_id,
            'name':    user_info.get('Name', ''),
        })
    return jsonify(by_item)


# ── RESOURCES API ─────────────────────────────────────────────────────────────

def _resource_to_dict(rec):
    d = rec['fields']
    return {
        'id':          rec['id'],
        'title':       d.get('Title', ''),
        'url':         d.get('URL', ''),
        'description': d.get('Description', ''),
        'category':    d.get('Category', 'general'),
        'is_active':   1 if d.get('Is Active') else 0,
        'order_index': d.get('Order Index', 0),
    }


@app.route('/api/resources')
@login_required
def get_resources():
    recs = resources_table.all(
        formula='{Is Active}=1',
        sort=['Category', 'Order Index']
    )
    return jsonify([_resource_to_dict(r) for r in recs])


@app.route('/api/resources', methods=['POST'])
@admin_required
def create_resource():
    data = request.get_json(silent=True) or {}
    title       = (data.get('title') or '').strip()
    url         = (data.get('url') or '').strip()
    description = data.get('description', '')
    category    = data.get('category', 'general')
    if not title:
        return jsonify({'error': 'Title required'}), 400
    rec = resources_table.create({
        'Title':       title,
        'URL':         url,
        'Description': description,
        'Category':    category,
        'Is Active':   True,
    })
    return jsonify(_resource_to_dict(rec)), 201


@app.route('/api/resources/<string:res_id>', methods=['DELETE'])
@admin_required
def delete_resource(res_id):
    resources_table.update(res_id, {'Is Active': False})
    return jsonify({'ok': True})


# ── STUDENTS API ─────────────────────────────────────────────────────────────

def _student_to_dict(rec):
    d = rec['fields']
    return {
        'id':           rec['id'],
        'username':     d.get('Username', ''),
        'email':        d.get('Email', ''),
        'display_name': d.get('Name', ''),
        'course':       d.get('Course', 'psc31180'),
        'is_active':    1 if d.get('Is Active') else 0,
    }


@app.route('/api/students')
@admin_required
def get_students():
    my_course = session.get('course')
    if session.get('role') == 'admin' or not my_course or my_course == 'both':
        recs = users_table.all(formula="{Role}='student'", sort=['Name'])
    else:
        formula = f"AND({{Role}}='student', OR({{Course}}='{my_course}', {{Course}}='both'))"
        recs = users_table.all(formula=formula, sort=['Name'])
    return jsonify([_student_to_dict(r) for r in recs])


@app.route('/api/students', methods=['POST'])
@admin_required
def create_student():
    data = request.get_json(silent=True) or {}
    name   = (data.get('name') or '').strip()
    email  = (data.get('email') or '').strip().lower()
    course = data.get('course', 'psc31180')
    if not name or not email:
        return jsonify({'error': 'Name and email required'}), 400
    username = email.split('@')[0].lower().replace('.', '').replace(' ', '')
    existing = users_table.first(formula=f"{{Username}}='{username}'")
    if existing:
        return jsonify({'error': f'Username "{username}" already exists'}), 409
    initials = make_initials(name)
    pw_hash  = hash_password(DEFAULT_PASSWORD)
    rec = users_table.create({
        'Name':          name,
        'Username':      username,
        'Email':         email,
        'Password Hash': pw_hash,
        'Role':          'student',
        'Course':        course,
        'Initials':      initials,
        'Is Active':     True,
    })
    return jsonify(_student_to_dict(rec)), 201


@app.route('/api/students/<string:student_id>', methods=['DELETE'])
@admin_required
def delete_student(student_id):
    rec = users_table.get(student_id)
    if not rec or rec['fields'].get('Role') != 'student':
        return jsonify({'error': 'Not found'}), 404
    users_table.delete(student_id)
    return jsonify({'ok': True})


@app.route('/api/students/<string:student_id>/toggle-active', methods=['POST'])
@admin_required
def toggle_student_active(student_id):
    rec = users_table.get(student_id)
    if not rec or rec['fields'].get('Role') != 'student':
        return jsonify({'error': 'Not found'}), 404
    current = rec['fields'].get('Is Active', False)
    new_state = not current
    users_table.update(student_id, {'Is Active': new_state})
    return jsonify({'is_active': 1 if new_state else 0})


@app.route('/api/students/import', methods=['POST'])
@admin_required
def import_students():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    f = request.files['file']
    content = f.read().decode('utf-8-sig')
    reader  = csv.DictReader(io.StringIO(content))
    added   = 0
    skipped = 0
    errors  = []
    pw_hash = hash_password(DEFAULT_PASSWORD)
    for i, row in enumerate(reader, start=2):
        name   = (row.get('name') or row.get('Name') or '').strip()
        email  = (row.get('email') or row.get('Email') or '').strip().lower()
        course = (row.get('course') or row.get('Course') or 'psc31180').strip().lower()
        if not name or not email:
            errors.append(f'Row {i}: missing name or email')
            continue
        if course not in ('psc31180', 'psc31330'):
            course = 'psc31180'
        username = email.split('@')[0].lower().replace('.', '').replace(' ', '')
        existing = users_table.first(formula=f"{{Username}}='{username}'")
        if existing:
            skipped += 1
            continue
        initials = make_initials(name)
        users_table.create({
            'Name':          name,
            'Username':      username,
            'Email':         email,
            'Password Hash': pw_hash,
            'Role':          'student',
            'Course':        course,
            'Initials':      initials,
            'Is Active':     True,
        })
        added += 1
    return jsonify({'added': added, 'skipped': skipped, 'errors': errors})


@app.route('/api/students/<string:student_id>/reset-password', methods=['POST'])
@admin_required
def reset_student_password(student_id):
    rec = users_table.get(student_id)
    if not rec or rec['fields'].get('Role') != 'student':
        return jsonify({'error': 'Student not found'}), 404
    student_course = rec['fields'].get('Course', '')
    if not can_access_course(student_course):
        return jsonify({'error': 'Forbidden — student is not in your course'}), 403
    data = request.get_json(silent=True) or {}
    new_pass = (data.get('password') or DEFAULT_PASSWORD).strip()
    if len(new_pass) < 6:
        return jsonify({'error': 'Password too short'}), 400
    users_table.update(student_id, {'Password Hash': hash_password(new_pass)})
    return jsonify({'ok': True})


# ── STUDENT NOTES API ────────────────────────────────────────────────────────

def _note_to_dict(rec):
    d = rec['fields']
    return {
        'id':              rec['id'],
        'body':            d.get('Body', ''),
        'author_initials': d.get('Author Initials', ''),
        'author_name':     d.get('Author Name', ''),
        'created_at':      d.get('Created At', ''),
    }


@app.route('/api/students/<string:student_id>/notes')
@admin_required
def get_student_notes(student_id):
    recs = notes_table.all(
        formula=f"FIND('{student_id}', ARRAYJOIN({{Student}}, ','))>0",
        sort=['-Created At']
    )
    return jsonify([_note_to_dict(r) for r in recs])


@app.route('/api/students/<string:student_id>/notes', methods=['POST'])
@admin_required
def add_student_note(student_id):
    data = request.get_json(silent=True) or {}
    body = (data.get('body') or '').strip()
    if not body:
        return jsonify({'error': 'Note body required'}), 400
    author_rec = users_table.get(session['user_id'])
    if author_rec:
        author_fields    = author_rec['fields']
        author_initials  = author_fields.get('Initials', '')
        author_name      = author_fields.get('Name', '')
    else:
        author_initials = ''
        author_name     = ''
    rec = notes_table.create({
        'Body':            body,
        'Student':         [student_id],
        'Author Name':     author_name,
        'Author Initials': author_initials,
        'Created At':      datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z'),
    })
    return jsonify(_note_to_dict(rec)), 201


@app.route('/api/student-notes/<string:note_id>', methods=['DELETE'])
@admin_required
def delete_student_note(note_id):
    notes_table.delete(note_id)
    return jsonify({'ok': True})


# ── ADMIN USERS API ──────────────────────────────────────────────────────────

def _admin_user_to_dict(rec, current_uid):
    d = rec['fields']
    return {
        'id':           rec['id'],
        'username':     d.get('Username', ''),
        'email':        d.get('Email', ''),
        'display_name': d.get('Name', ''),
        'role':         d.get('Role', ''),
        'course':       d.get('Course', 'both'),
        'is_active':    1 if d.get('Is Active') else 0,
        'you':          rec['id'] == current_uid,
    }


@app.route('/api/admin/users')
@admin_required
def get_admin_users():
    recs = users_table.all(formula="{Role}!='student'", sort=['Name'])
    current_uid = session['user_id']
    return jsonify([_admin_user_to_dict(r, current_uid) for r in recs])


@app.route('/api/admin/users', methods=['POST'])
@admin_required
def create_admin_user():
    data     = request.get_json(silent=True) or {}
    name     = (data.get('name') or '').strip()
    username = (data.get('username') or '').strip().lower()
    password = (data.get('password') or '').strip()
    role     = data.get('role', 'instructor')
    course   = data.get('course', 'both')
    if not name or not username or not password:
        return jsonify({'error': 'Name, username, and password required'}), 400
    existing = users_table.first(formula=f"{{Username}}='{username}'")
    if existing:
        return jsonify({'error': f'Username "{username}" already taken'}), 409
    initials = make_initials(name)
    rec = users_table.create({
        'Name':          name,
        'Username':      username,
        'Email':         '',
        'Password Hash': hash_password(password),
        'Role':          role,
        'Course':        course,
        'Initials':      initials,
        'Is Active':     True,
    })
    return jsonify(_admin_user_to_dict(rec, session['user_id'])), 201


@app.route('/api/admin/users/<string:user_id>', methods=['PATCH'])
@admin_required
def update_admin_user(user_id):
    data = request.get_json(silent=True) or {}
    rec = users_table.get(user_id)
    if not rec:
        return jsonify({'error': 'Not found'}), 404

    updates = {}
    if 'password' in data:
        new_pw = data['password'].strip()
        if len(new_pw) < 6:
            return jsonify({'error': 'Password too short'}), 400
        updates['Password Hash'] = hash_password(new_pw)
    if 'is_active' in data:
        updates['Is Active'] = bool(data['is_active'])
    if 'role' in data:
        updates['Role'] = data['role']
    if 'course' in data:
        updates['Course'] = data['course']

    if updates:
        users_table.update(user_id, updates)

    updated = users_table.get(user_id)
    return jsonify(_admin_user_to_dict(updated, session['user_id']))


@app.route('/api/admin/users/<string:user_id>', methods=['DELETE'])
@admin_required
def delete_admin_user(user_id):
    if user_id == session['user_id']:
        return jsonify({'error': 'Cannot delete your own account'}), 400
    rec = users_table.get(user_id)
    if not rec or rec['fields'].get('Role') == 'student':
        return jsonify({'error': 'Not found or cannot delete student via this endpoint'}), 404
    users_table.delete(user_id)
    return jsonify({'ok': True})


# ── SEED CONTENT ─────────────────────────────────────────────────────────────

@app.route('/api/seed-content', methods=['POST'])
def seed_content():
    """Populate all content tables with starter placeholder data.
    Safe to call multiple times — skips any section that already has records."""
    data = request.get_json(silent=True) or {}
    setup_key = request.headers.get('X-Setup-Key', '') or data.get('setup_key', '')
    is_admin_session = session.get('role') in ('admin', 'coordinator', 'instructor')
    if not is_admin_session and setup_key != SETUP_KEY:
        return jsonify({'error': 'Forbidden — log in as admin or provide X-Setup-Key header'}), 403

    now = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')
    report = {}

    # ── Announcements ─────────────────────────────────────────────────────────
    if announcements_table.first():
        report['announcements'] = 'skipped'
    else:
        for ann in [
            {
                'Title':      'Welcome to the Fellowship Portal',
                'Body':       'This portal is your central hub for fellowship updates, calendar events, and resources. Check back regularly for announcements from program staff.',
                'Category':   'info',
                'Week Tag':   '',
                'Created At': now,
            },
            {
                'Title':      'Finance Documents & Deadlines',
                'Body':       'All fellowship finance requirements and deadlines will be posted here. Use the Finance tab to track your checklist progress.',
                'Category':   'deadline',
                'Week Tag':   '',
                'Created At': now,
            },
            {
                'Title':      'Questions? Reach Out.',
                'Body':       'Contact the Moynihan Center staff with any questions about the fellowship program. Contact info is available in the Resources tab.',
                'Category':   'reminder',
                'Week Tag':   '',
                'Created At': now,
            },
        ]:
            announcements_table.create(ann)
        report['announcements'] = 'created 3'

    # ── Finance checklist ─────────────────────────────────────────────────────
    if finance_items_table.first():
        report['finance_items'] = 'skipped'
    else:
        items = [
            # (title, description, category, link, due_label, required, order)
            ('Complete fellowship onboarding paperwork',  'Download, fill out, and submit all required onboarding documents to the Moynihan Center office.',                    'finance', '', '',  True,  1),
            ('Sign participation agreement',              'Read and sign the fellowship participation agreement acknowledging program expectations and responsibilities.',        'finance', '', '',  True,  2),
            ('Set up CUNY direct deposit',               'Log into CUNYfirst and complete direct deposit setup so your stipend is deposited to the correct account.',           'finance', '', '',  True,  3),
            ('Submit W-9 tax form',                      'Submit a completed W-9 form to the financial office. Required for stipend processing.',                              'finance', '', '',  True,  4),
            ('Complete onboarding survey',               'Fill out the onboarding survey so we can learn about your goals and background.',                                    'survey',  '', '',  True,  5),
            ('Submit mid-year reflection',               'Complete the mid-year reflection form by the posted deadline.',                                                       'survey',  '', '',  True,  6),
            ('Submit end-of-year final report',          'Complete your final fellowship report summarizing your work and learning over the year.',                             'survey',  '', '',  True,  7),
            ('Attend fellowship orientation',             'Attend the mandatory orientation session to meet staff, other fellows, and learn program expectations.',             'general', '', '',  True,  8),
            ('Return any borrowed program materials',     'Return all borrowed equipment, keys, or materials to the Moynihan Center by the end of the fellowship term.',        'general', '', '',  False, 9),
        ]
        for title, desc, cat, link, due_label, req, idx in items:
            fields = {
                'Title':       title,
                'Description': desc,
                'Category':    cat,
                'Is Required': req,
                'Order Index': idx,
            }
            if link:
                fields['Link'] = link
            if due_label:
                fields['Due Label'] = due_label
            finance_items_table.create(fields)
        report['finance_items'] = f'created {len(items)}'

    # ── Events ────────────────────────────────────────────────────────────────
    if events_table.first():
        report['events'] = 'skipped'
    else:
        events = [
            ('Fellowship Orientation',          '2025-09-05', 'milestone',   'joint',    'All fellows required — location TBD', True),
            ('First Meeting — PSC 31180',        '2025-09-10', 'lecture',     'psc31180', 'Update with room and time',           True),
            ('First Meeting — PSC 31330',        '2025-09-11', 'lecture',     'psc31330', 'Update with room and time',           True),
            ('Guest Speaker (TBD)',              '2025-10-15', 'guest',       'joint',    'Speaker and location TBD',            False),
            ('Mid-Semester Fellow Check-In',     '2025-11-05', 'milestone',   'joint',    'Individual meetings with coordinator', True),
            ('Spring Application Deadline',      '2025-11-15', 'application', 'joint',    'Submit via program portal',           True),
            ('End-of-Semester Showcase',         '2025-12-10', 'milestone',   'joint',    'Location TBD',                        True),
        ]
        for title, date, cat, course, note, mandatory in events:
            events_table.create({
                'Title':        title,
                'Date':         date,
                'Category':     cat,
                'Course':       course,
                'Note':         note,
                'Is Mandatory': mandatory,
                'Is Hidden':    False,
                'Is Locked':    False,
            })
        report['events'] = f'created {len(events)}'

    # ── Resources ─────────────────────────────────────────────────────────────
    if resources_table.first(formula='{Is Active}=1'):
        report['resources'] = 'skipped'
    else:
        resources = [
            ('CUNY Student Portal',      'https://www.cuny.edu',                                 'Main CUNY student portal — course registration, records, and services.',          'general',  1),
            ('CUNYfirst',                'https://home.cunyfirst.cuny.edu',                      'Access financial aid, course enrollment, and your student account.',               'general',  2),
            ('Moynihan Center Website',  'https://www.ccny.cuny.edu/moynihan',                   'Official Moynihan Center site with program information and staff contacts.',        'general',  3),
            ('CCNY Financial Aid',       'https://www.ccny.cuny.edu/financialaid',               'CCNY Financial Aid office — questions about stipends and funding.',                'finance',  1),
            ('CUNY Bursar Office',       'https://www.ccny.cuny.edu/bursar',                     'Tuition, payments, and financial account management.',                             'finance',  2),
            ('CUNY Academic Calendar',   'https://www.cuny.edu/academics/academic-calendars/',   'Official CUNY academic calendar with deadlines, holidays, and semester dates.',    'academic', 1),
            ('CCNY Cohen Library',       'https://library.ccny.cuny.edu',                        'Research databases, course reserves, and study spaces.',                           'academic', 2),
        ]
        for title, url, desc, cat, order in resources:
            resources_table.create({
                'Title':       title,
                'URL':         url,
                'Description': desc,
                'Category':    cat,
                'Is Active':   True,
                'Order Index': order,
            })
        report['resources'] = f'created {len(resources)}'

    return jsonify({'ok': True, 'report': report})


# ── STARTUP ──────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    port  = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV') == 'development'
    app.run(host='0.0.0.0', port=port, debug=debug)
