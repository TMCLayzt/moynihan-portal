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

DEFAULT_PASSWORD = os.environ.get('DEFAULT_STUDENT_PASSWORD', 'moynihan2025')
SETUP_KEY = os.environ.get('SETUP_KEY', 'moynihan-setup-2025')

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
    }


@app.route('/api/events')
@login_required
def get_events():
    course_filter = request.args.get('course', '')
    if course_filter:
        formula = f"{{Course}}='{course_filter}'"
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
    }
    updates = {}
    for client_key, at_key in field_map.items():
        if client_key in data:
            val = data[client_key]
            if client_key in ('is_mandatory', 'is_hidden', 'is_locked'):
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
        recs = announcements_table.all(formula=formula, sort=[{'field': 'Created At', 'direction': 'desc'}])
    else:
        recs = announcements_table.all(sort=[{'field': 'Created At', 'direction': 'desc'}])
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
    is_required = bool(data.get('is_required', True))
    if not title:
        return jsonify({'error': 'Title required'}), 400
    rec = finance_items_table.create({
        'Title':       title,
        'Description': description,
        'Is Required': is_required,
    })
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
        sort=[{'field': 'Created At', 'direction': 'desc'}]
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


# ── STARTUP ──────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    port  = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV') == 'development'
    app.run(host='0.0.0.0', port=port, debug=debug)
