import os
import csv
import io
import json
import sqlite3
from datetime import datetime, date, timedelta
from functools import wraps

import bcrypt
from flask import Flask, g, jsonify, render_template, request, session, Response

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

DATABASE = os.environ.get('DATABASE_URL', 'portal.db')
DEFAULT_PASSWORD = os.environ.get('DEFAULT_STUDENT_PASSWORD', 'moynihan2025')


# ── DATABASE ─────────────────────────────────────────────────────────────────

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA foreign_keys=ON')
    return db

@app.teardown_appcontext
def close_db(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    db = sqlite3.connect(DATABASE)
    db.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT    UNIQUE NOT NULL,
            email         TEXT    DEFAULT '',
            display_name  TEXT    NOT NULL,
            initials      TEXT    NOT NULL,
            password_hash TEXT    NOT NULL,
            role          TEXT    NOT NULL DEFAULT 'student',
            course        TEXT    DEFAULT 'psc31180',
            is_active     INTEGER NOT NULL DEFAULT 1,
            created_at    TEXT    DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            title           TEXT    NOT NULL,
            date            TEXT    NOT NULL,
            cat             TEXT    NOT NULL DEFAULT 'lecture',
            note            TEXT    DEFAULT '',
            description     TEXT    DEFAULT '',
            eventbrite_url  TEXT    DEFAULT '',
            is_mandatory    INTEGER NOT NULL DEFAULT 0,
            course          TEXT    NOT NULL DEFAULT 'psc31180',
            is_hidden       INTEGER NOT NULL DEFAULT 0,
            is_locked       INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT    DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS announcements (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT    NOT NULL,
            body       TEXT    NOT NULL,
            color      TEXT    NOT NULL DEFAULT 'maroon',
            week_tag   TEXT    DEFAULT '',
            is_active  INTEGER NOT NULL DEFAULT 1,
            created_at TEXT    DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS modules (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            label           TEXT    NOT NULL,
            title           TEXT    NOT NULL,
            description     TEXT    DEFAULT '',
            progress        INTEGER NOT NULL DEFAULT 0,
            status          TEXT    NOT NULL DEFAULT 'Upcoming',
            weeks           TEXT    DEFAULT '',
            course          TEXT    NOT NULL,
            order_index     INTEGER NOT NULL DEFAULT 0,
            last_updated_at TEXT    DEFAULT NULL,
            last_updated_by TEXT    DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS sessions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id   INTEGER NOT NULL,
            date_label  TEXT    NOT NULL,
            title       TEXT    NOT NULL,
            note        TEXT    DEFAULT '',
            is_joint    INTEGER NOT NULL DEFAULT 0,
            order_index INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (module_id) REFERENCES modules(id)
        );
        CREATE TABLE IF NOT EXISTS deliverables (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id INTEGER NOT NULL,
            title     TEXT    NOT NULL,
            due_date  TEXT    NOT NULL,
            cat       TEXT    NOT NULL DEFAULT 'homework',
            note      TEXT    DEFAULT '',
            FOREIGN KEY (module_id) REFERENCES modules(id)
        );
        CREATE TABLE IF NOT EXISTS readings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id   INTEGER NOT NULL,
            title       TEXT    NOT NULL,
            when_label  TEXT    NOT NULL,
            type        TEXT    DEFAULT 'PDF',
            description TEXT    DEFAULT '',
            order_index INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (module_id) REFERENCES modules(id)
        );
        CREATE TABLE IF NOT EXISTS rsvps (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            event_id   INTEGER NOT NULL,
            created_at TEXT    DEFAULT (datetime('now')),
            UNIQUE (user_id, event_id),
            FOREIGN KEY (user_id)  REFERENCES users(id),
            FOREIGN KEY (event_id) REFERENCES events(id)
        );
        CREATE TABLE IF NOT EXISTS finance_items (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT    NOT NULL,
            description TEXT    DEFAULT '',
            due_label   TEXT    DEFAULT '',
            category    TEXT    DEFAULT 'document',
            is_required INTEGER NOT NULL DEFAULT 1,
            order_index INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT    DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS student_finance_checks (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            item_id    INTEGER NOT NULL,
            checked_at TEXT    DEFAULT (datetime('now')),
            UNIQUE (user_id, item_id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (item_id) REFERENCES finance_items(id)
        );
        CREATE TABLE IF NOT EXISTS resources (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT    NOT NULL,
            url         TEXT    DEFAULT '',
            description TEXT    DEFAULT '',
            category    TEXT    DEFAULT 'general',
            order_index INTEGER NOT NULL DEFAULT 0,
            is_active   INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT    DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS form_requests (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            form_type   TEXT    NOT NULL,
            student_id  INTEGER NOT NULL,
            created_by  INTEGER NOT NULL,
            status      TEXT    NOT NULL DEFAULT 'pending',
            note        TEXT    DEFAULT '',
            due_date    TEXT    DEFAULT '',
            created_at  TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (student_id)  REFERENCES users(id),
            FOREIGN KEY (created_by)  REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS form_submissions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id   INTEGER NOT NULL UNIQUE,
            fields       TEXT    NOT NULL,
            signature    TEXT    NOT NULL,
            submitted_at TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (request_id) REFERENCES form_requests(id)
        );
        CREATE TABLE IF NOT EXISTS form_completions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id   INTEGER NOT NULL UNIQUE,
            fields       TEXT    NOT NULL,
            signature    TEXT    NOT NULL,
            completed_by INTEGER NOT NULL,
            completed_at TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (request_id)  REFERENCES form_requests(id),
            FOREIGN KEY (completed_by) REFERENCES users(id)
        );
    ''')
    db.commit()
    db.close()

def migrate_db():
    """Safely add new columns to existing tables (idempotent)."""
    db = sqlite3.connect(DATABASE)
    migrations = [
        ('events',      'description',    "TEXT DEFAULT ''"),
        ('events',      'eventbrite_url', "TEXT DEFAULT ''"),
        ('events',      'is_mandatory',   'INTEGER NOT NULL DEFAULT 0'),
        ('modules',     'last_updated_at','TEXT DEFAULT NULL'),
        ('modules',     'last_updated_by',"TEXT DEFAULT ''"),
        ('announcements','week_tag',      "TEXT DEFAULT ''"),
    ]
    for table, col, coldef in migrations:
        try:
            db.execute(f'ALTER TABLE {table} ADD COLUMN {col} {coldef}')
        except Exception:
            pass  # column already exists
    db.executescript('''
        CREATE TABLE IF NOT EXISTS student_notes (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id      INTEGER NOT NULL,
            body            TEXT    NOT NULL,
            author_id       INTEGER NOT NULL,
            author_initials TEXT    NOT NULL DEFAULT '',
            author_name     TEXT    NOT NULL DEFAULT '',
            created_at      TEXT    DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS form_requests (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            form_type   TEXT    NOT NULL,
            student_id  INTEGER NOT NULL,
            created_by  INTEGER NOT NULL,
            status      TEXT    NOT NULL DEFAULT 'pending',
            note        TEXT    DEFAULT '',
            due_date    TEXT    DEFAULT '',
            created_at  TEXT    DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS form_submissions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id   INTEGER NOT NULL UNIQUE,
            fields       TEXT    NOT NULL,
            signature    TEXT    NOT NULL,
            submitted_at TEXT    DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS form_completions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id   INTEGER NOT NULL UNIQUE,
            fields       TEXT    NOT NULL,
            signature    TEXT    NOT NULL,
            completed_by INTEGER NOT NULL,
            completed_at TEXT    DEFAULT (datetime('now'))
        );
    ''')
    db.commit()
    db.close()


# ── AUTH HELPERS ─────────────────────────────────────────────────────────────

def hash_password(plain):
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()

def check_password(plain, hashed):
    return bcrypt.checkpw(plain.encode(), hashed.encode())

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Unauthorized'}), 401
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

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Unauthorized'}), 401
        if session.get('role') not in ('admin', 'instructor', 'coordinator'):
            return jsonify({'error': 'Forbidden'}), 403
        return f(*args, **kwargs)
    return decorated

def make_initials(name):
    parts = name.strip().split()
    return ''.join(p[0] for p in parts if p)[:2].upper()


# ── PAGES ────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('portal.html')


# ── AUTH API ─────────────────────────────────────────────────────────────────

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip().lower()
    password = data.get('password') or ''
    if not username or not password:
        return jsonify({'error': 'Username and password required'}), 400
    db = get_db()
    user = db.execute(
        'SELECT * FROM users WHERE username = ? AND is_active = 1', (username,)
    ).fetchone()
    if not user or not check_password(password, user['password_hash']):
        return jsonify({'error': 'Incorrect username or password'}), 401
    session.permanent   = True
    session['user_id']  = user['id']
    session['username'] = user['username']
    session['role']     = user['role']
    session['course']   = user['course']
    return jsonify({
        'role':         user['role'],
        'display':      user['display_name'],
        'initials':     user['initials'],
        'course':       user['course'],
        'first_name':   user['display_name'].split()[0],
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
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE id = ?', (session['user_id'],)).fetchone()
    if not check_password(current, user['password_hash']):
        return jsonify({'error': 'Current password is incorrect'}), 400
    if len(new_pass) < 8:
        return jsonify({'error': 'New password must be at least 8 characters'}), 400
    if new_pass != confirm:
        return jsonify({'error': 'New passwords do not match'}), 400
    db.execute('UPDATE users SET password_hash = ? WHERE id = ?',
               (hash_password(new_pass), session['user_id']))
    db.commit()
    return jsonify({'ok': True})


# ── EVENTS API ───────────────────────────────────────────────────────────────

@app.route('/api/events')
@login_required
def get_events():
    db = get_db()
    course_filter = request.args.get('course', '')
    if course_filter:
        rows = db.execute(
            'SELECT * FROM events WHERE course = ? ORDER BY date', (course_filter,)
        ).fetchall()
    else:
        rows = db.execute('SELECT * FROM events ORDER BY date').fetchall()
    return jsonify([dict(r) for r in rows])

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
    is_mandatory   = 1 if data.get('is_mandatory') else 0
    course         = data.get('course', 'psc31180')
    if not title or not date_val:
        return jsonify({'error': 'Title and date required'}), 400
    db = get_db()
    cur = db.execute(
        'INSERT INTO events (title, date, cat, note, description, eventbrite_url, is_mandatory, course) VALUES (?,?,?,?,?,?,?,?)',
        (title, date_val, cat, note, description, eventbrite_url, is_mandatory, course)
    )
    db.commit()
    row = db.execute('SELECT * FROM events WHERE id = ?', (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201

@app.route('/api/events/<int:event_id>', methods=['PATCH'])
@admin_required
def update_event(event_id):
    data = request.get_json(silent=True) or {}
    db = get_db()
    row = db.execute('SELECT * FROM events WHERE id = ?', (event_id,)).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    allowed = ('title','date','cat','note','description','eventbrite_url',
               'is_mandatory','course','is_hidden','is_locked')
    fields = {k: v for k, v in data.items() if k in allowed}
    if not fields:
        return jsonify({'error': 'No valid fields'}), 400
    set_clause = ', '.join(f'{k} = ?' for k in fields)
    db.execute(f'UPDATE events SET {set_clause} WHERE id = ?', (*fields.values(), event_id))
    db.commit()
    row = db.execute('SELECT * FROM events WHERE id = ?', (event_id,)).fetchone()
    return jsonify(dict(row))

@app.route('/api/events/<int:event_id>', methods=['DELETE'])
@admin_required
def delete_event(event_id):
    db = get_db()
    db.execute('DELETE FROM rsvps WHERE event_id = ?', (event_id,))
    db.execute('DELETE FROM events WHERE id = ?', (event_id,))
    db.commit()
    return jsonify({'ok': True})

@app.route('/api/events/<int:event_id>/ics')
@login_required
def download_ics(event_id):
    db = get_db()
    ev = db.execute('SELECT * FROM events WHERE id = ?', (event_id,)).fetchone()
    if not ev:
        return jsonify({'error': 'Not found'}), 404
    ev = dict(ev)
    # Build .ics content
    dt = ev['date'].replace('-', '')  # YYYYMMDD
    uid = f"event-{event_id}@moynihan-portal"
    summary = ev['title'].replace(',', '\\,').replace(';', '\\;')
    location = (ev.get('note') or '').split('·')[0].strip().replace(',', '\\,')
    desc = (ev.get('description') or ev.get('note') or '').replace('\n', '\\n')
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

@app.route('/api/announcements')
@login_required
def get_announcements():
    db = get_db()
    week_tag = request.args.get('week', '')
    if week_tag:
        rows = db.execute(
            "SELECT * FROM announcements WHERE is_active = 1 AND (week_tag = ? OR week_tag = '') ORDER BY created_at DESC",
            (week_tag,)
        ).fetchall()
    else:
        rows = db.execute(
            'SELECT * FROM announcements WHERE is_active = 1 ORDER BY created_at DESC'
        ).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route('/api/announcements', methods=['POST'])
@admin_required
def create_announcement():
    data = request.get_json(silent=True) or {}
    title    = (data.get('title') or '').strip()
    body     = (data.get('body') or '').strip()
    color    = data.get('color', 'maroon')
    week_tag = (data.get('week_tag') or '').strip()
    if not title or not body:
        return jsonify({'error': 'Title and body required'}), 400
    db = get_db()
    cur = db.execute(
        'INSERT INTO announcements (title, body, color, week_tag) VALUES (?,?,?,?)',
        (title, body, color, week_tag)
    )
    db.commit()
    row = db.execute('SELECT * FROM announcements WHERE id = ?', (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201

@app.route('/api/announcements/<int:ann_id>', methods=['DELETE'])
@admin_required
def delete_announcement(ann_id):
    db = get_db()
    db.execute('UPDATE announcements SET is_active = 0 WHERE id = ?', (ann_id,))
    db.commit()
    return jsonify({'ok': True})


# ── MODULES API ──────────────────────────────────────────────────────────────

@app.route('/api/modules')
@login_required
def get_modules():
    db = get_db()
    course_filter = request.args.get('course', '')
    if course_filter:
        mods = db.execute(
            'SELECT * FROM modules WHERE course = ? ORDER BY order_index', (course_filter,)
        ).fetchall()
    else:
        mods = db.execute('SELECT * FROM modules ORDER BY course, order_index').fetchall()
    result = []
    for m in mods:
        mid = m['id']
        sess = db.execute(
            'SELECT * FROM sessions WHERE module_id = ? ORDER BY order_index', (mid,)
        ).fetchall()
        deliv = db.execute(
            'SELECT * FROM deliverables WHERE module_id = ?', (mid,)
        ).fetchall()
        reads = db.execute(
            'SELECT * FROM readings WHERE module_id = ? ORDER BY order_index', (mid,)
        ).fetchall()
        result.append({
            **dict(m),
            'sessions':     [dict(s) for s in sess],
            'deliverables': [dict(d) for d in deliv],
            'readings':     [dict(r) for r in reads],
        })
    return jsonify(result)

@app.route('/api/modules/<int:mod_id>', methods=['PATCH'])
@admin_required
def update_module(mod_id):
    data = request.get_json(silent=True) or {}
    db = get_db()
    row = db.execute('SELECT id FROM modules WHERE id = ?', (mod_id,)).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    allowed = ('title', 'description', 'progress', 'status', 'weeks')
    fields = {k: v for k, v in data.items() if k in allowed}
    if fields:
        fields['last_updated_at'] = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        fields['last_updated_by'] = session.get('username', '')
        set_clause = ', '.join(f'{k} = ?' for k in fields)
        db.execute(f'UPDATE modules SET {set_clause} WHERE id = ?', (*fields.values(), mod_id))
        db.commit()
    return jsonify({'ok': True})


# ── RSVPs API ────────────────────────────────────────────────────────────────

@app.route('/api/rsvps')
@login_required
def get_rsvps():
    db = get_db()
    rows = db.execute(
        'SELECT event_id FROM rsvps WHERE user_id = ?', (session['user_id'],)
    ).fetchall()
    return jsonify([r['event_id'] for r in rows])

@app.route('/api/rsvps/<int:event_id>', methods=['POST'])
@login_required
def toggle_rsvp(event_id):
    db = get_db()
    existing = db.execute(
        'SELECT id FROM rsvps WHERE user_id = ? AND event_id = ?',
        (session['user_id'], event_id)
    ).fetchone()
    if existing:
        db.execute('DELETE FROM rsvps WHERE user_id = ? AND event_id = ?',
                   (session['user_id'], event_id))
        db.commit()
        return jsonify({'rsvpd': False})
    else:
        db.execute('INSERT INTO rsvps (user_id, event_id) VALUES (?,?)',
                   (session['user_id'], event_id))
        db.commit()
        return jsonify({'rsvpd': True})

@app.route('/api/rsvps/all')
@admin_required
def get_all_rsvps():
    db = get_db()
    my_course = session.get('course')
    if session.get('role') == 'admin' or not my_course or my_course == 'both':
        rows = db.execute('''
            SELECT r.event_id, r.user_id, u.display_name, u.email
            FROM rsvps r JOIN users u ON u.id = r.user_id
            ORDER BY r.event_id
        ''').fetchall()
    else:
        rows = db.execute('''
            SELECT r.event_id, r.user_id, u.display_name, u.email
            FROM rsvps r JOIN users u ON u.id = r.user_id
            WHERE u.course = ? OR u.course = 'both'
            ORDER BY r.event_id
        ''', (my_course,)).fetchall()
    by_event = {}
    for r in rows:
        eid = r['event_id']
        if eid not in by_event:
            by_event[eid] = []
        by_event[eid].append({'user_id': r['user_id'], 'name': r['display_name'], 'email': r['email']})
    return jsonify(by_event)


# ── FINANCE API ──────────────────────────────────────────────────────────────

@app.route('/api/finance')
@login_required
def get_finance():
    db = get_db()
    items = db.execute(
        'SELECT * FROM finance_items ORDER BY order_index, id'
    ).fetchall()
    checked_rows = db.execute(
        'SELECT item_id FROM student_finance_checks WHERE user_id = ?',
        (session['user_id'],)
    ).fetchall()
    checked_ids = {r['item_id'] for r in checked_rows}
    result = []
    for item in items:
        d = dict(item)
        d['checked'] = item['id'] in checked_ids
        result.append(d)
    return jsonify(result)

@app.route('/api/finance', methods=['POST'])
@admin_required
def create_finance_item():
    data = request.get_json(silent=True) or {}
    title       = (data.get('title') or '').strip()
    description = data.get('description', '')
    due_label   = data.get('due_label', '')
    category    = data.get('category', 'document')
    is_required = 1 if data.get('is_required', True) else 0
    if not title:
        return jsonify({'error': 'Title required'}), 400
    db = get_db()
    cur = db.execute(
        'INSERT INTO finance_items (title, description, due_label, category, is_required) VALUES (?,?,?,?,?)',
        (title, description, due_label, category, is_required)
    )
    db.commit()
    row = db.execute('SELECT * FROM finance_items WHERE id = ?', (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201

@app.route('/api/finance/<int:item_id>', methods=['DELETE'])
@admin_required
def delete_finance_item(item_id):
    db = get_db()
    db.execute('DELETE FROM student_finance_checks WHERE item_id = ?', (item_id,))
    db.execute('DELETE FROM finance_items WHERE id = ?', (item_id,))
    db.commit()
    return jsonify({'ok': True})

@app.route('/api/finance/<int:item_id>/check', methods=['POST'])
@login_required
def toggle_finance_check(item_id):
    db = get_db()
    existing = db.execute(
        'SELECT id FROM student_finance_checks WHERE user_id = ? AND item_id = ?',
        (session['user_id'], item_id)
    ).fetchone()
    if existing:
        db.execute('DELETE FROM student_finance_checks WHERE user_id = ? AND item_id = ?',
                   (session['user_id'], item_id))
        db.commit()
        return jsonify({'checked': False})
    else:
        db.execute('INSERT INTO student_finance_checks (user_id, item_id) VALUES (?,?)',
                   (session['user_id'], item_id))
        db.commit()
        return jsonify({'checked': True})

@app.route('/api/finance/all-checks')
@admin_required
def get_all_finance_checks():
    db = get_db()
    my_course = session.get('course')
    if session.get('role') == 'admin' or not my_course or my_course == 'both':
        rows = db.execute('''
            SELECT fc.item_id, fc.user_id, u.display_name, fi.title
            FROM student_finance_checks fc
            JOIN users u ON u.id = fc.user_id
            JOIN finance_items fi ON fi.id = fc.item_id
            ORDER BY fi.order_index, u.display_name
        ''').fetchall()
    else:
        rows = db.execute('''
            SELECT fc.item_id, fc.user_id, u.display_name, fi.title
            FROM student_finance_checks fc
            JOIN users u ON u.id = fc.user_id
            JOIN finance_items fi ON fi.id = fc.item_id
            WHERE u.course = ? OR u.course = 'both'
            ORDER BY fi.order_index, u.display_name
        ''', (my_course,)).fetchall()
    by_item = {}
    for r in rows:
        iid = r['item_id']
        if iid not in by_item:
            by_item[iid] = {'title': r['title'], 'students': []}
        by_item[iid]['students'].append({'user_id': r['user_id'], 'name': r['display_name']})
    return jsonify(by_item)


# ── RESOURCES API ─────────────────────────────────────────────────────────────

@app.route('/api/resources')
@login_required
def get_resources():
    db = get_db()
    rows = db.execute(
        'SELECT * FROM resources WHERE is_active = 1 ORDER BY category, order_index, id'
    ).fetchall()
    return jsonify([dict(r) for r in rows])

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
    db = get_db()
    cur = db.execute(
        'INSERT INTO resources (title, url, description, category) VALUES (?,?,?,?)',
        (title, url, description, category)
    )
    db.commit()
    row = db.execute('SELECT * FROM resources WHERE id = ?', (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201

@app.route('/api/resources/<int:res_id>', methods=['DELETE'])
@admin_required
def delete_resource(res_id):
    db = get_db()
    db.execute('UPDATE resources SET is_active = 0 WHERE id = ?', (res_id,))
    db.commit()
    return jsonify({'ok': True})


# ── STUDENTS API ─────────────────────────────────────────────────────────────

@app.route('/api/students')
@admin_required
def get_students():
    db = get_db()
    my_course = session.get('course')
    if session.get('role') == 'admin' or not my_course or my_course == 'both':
        rows = db.execute(
            "SELECT id, username, email, display_name, course, is_active FROM users WHERE role = 'student' ORDER BY display_name"
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT id, username, email, display_name, course, is_active FROM users WHERE role = 'student' AND (course = ? OR course = 'both') ORDER BY display_name",
            (my_course,)
        ).fetchall()
    return jsonify([dict(r) for r in rows])

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
    db = get_db()
    if db.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone():
        return jsonify({'error': f'Username "{username}" already exists'}), 409
    initials = make_initials(name)
    pw_hash  = hash_password(DEFAULT_PASSWORD)
    cur = db.execute(
        'INSERT INTO users (username, email, display_name, initials, password_hash, role, course) VALUES (?,?,?,?,?,?,?)',
        (username, email, name, initials, pw_hash, 'student', course)
    )
    db.commit()
    row = db.execute("SELECT id, username, email, display_name, course, is_active FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201

@app.route('/api/students/<int:student_id>', methods=['DELETE'])
@admin_required
def delete_student(student_id):
    db = get_db()
    db.execute("DELETE FROM users WHERE id = ? AND role = 'student'", (student_id,))
    db.commit()
    return jsonify({'ok': True})

@app.route('/api/students/<int:student_id>/toggle-active', methods=['POST'])
@admin_required
def toggle_student_active(student_id):
    db = get_db()
    row = db.execute("SELECT is_active FROM users WHERE id = ? AND role = 'student'", (student_id,)).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    new_state = 0 if row['is_active'] else 1
    db.execute("UPDATE users SET is_active = ? WHERE id = ?", (new_state, student_id))
    db.commit()
    return jsonify({'is_active': new_state})

@app.route('/api/students/import', methods=['POST'])
@admin_required
def import_students():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    f = request.files['file']
    content = f.read().decode('utf-8-sig')
    reader = csv.DictReader(io.StringIO(content))
    db = get_db()
    added = 0
    skipped = 0
    errors = []
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
        if db.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone():
            skipped += 1
            continue
        initials = make_initials(name)
        db.execute(
            'INSERT INTO users (username, email, display_name, initials, password_hash, role, course) VALUES (?,?,?,?,?,?,?)',
            (username, email, name, initials, pw_hash, 'student', course)
        )
        added += 1
    db.commit()
    return jsonify({'added': added, 'skipped': skipped, 'errors': errors})

@app.route('/api/students/<int:student_id>/reset-password', methods=['POST'])
@admin_required
def reset_student_password(student_id):
    db = get_db()
    student = db.execute("SELECT course FROM users WHERE id = ? AND role = 'student'", (student_id,)).fetchone()
    if not student:
        return jsonify({'error': 'Student not found'}), 404
    if not can_access_course(student['course']):
        return jsonify({'error': 'Forbidden — student is not in your course'}), 403
    data = request.get_json(silent=True) or {}
    new_pass = (data.get('password') or DEFAULT_PASSWORD).strip()
    if len(new_pass) < 6:
        return jsonify({'error': 'Password too short'}), 400
    db.execute("UPDATE users SET password_hash = ? WHERE id = ? AND role = 'student'",
               (hash_password(new_pass), student_id))
    db.commit()
    return jsonify({'ok': True})


# ── STUDENT NOTES API ────────────────────────────────────────────────────────

@app.route('/api/students/<int:student_id>/notes')
@admin_required
def get_student_notes(student_id):
    db = get_db()
    rows = db.execute(
        'SELECT id, body, author_initials, author_name, created_at FROM student_notes WHERE student_id = ? ORDER BY created_at DESC',
        (student_id,)
    ).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route('/api/students/<int:student_id>/notes', methods=['POST'])
@admin_required
def add_student_note(student_id):
    data = request.get_json(silent=True) or {}
    body = (data.get('body') or '').strip()
    if not body:
        return jsonify({'error': 'Note body required'}), 400
    author_id = session['user_id']
    db = get_db()
    author = db.execute('SELECT display_name, initials FROM users WHERE id = ?', (author_id,)).fetchone()
    author_initials = author['initials'] if author and author['initials'] else ''
    author_name = author['display_name'] if author else ''
    cur = db.execute(
        'INSERT INTO student_notes (student_id, body, author_id, author_initials, author_name) VALUES (?,?,?,?,?)',
        (student_id, body, author_id, author_initials, author_name)
    )
    db.commit()
    row = db.execute('SELECT id, body, author_initials, author_name, created_at FROM student_notes WHERE id = ?', (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201

@app.route('/api/student-notes/<int:note_id>', methods=['DELETE'])
@admin_required
def delete_student_note(note_id):
    db = get_db()
    db.execute('DELETE FROM student_notes WHERE id = ?', (note_id,))
    db.commit()
    return jsonify({'ok': True})


# ── ADMIN USERS API ──────────────────────────────────────────────────────────

@app.route('/api/admin/users')
@admin_required
def get_admin_users():
    db = get_db()
    rows = db.execute(
        "SELECT id, username, email, display_name, role, course, is_active FROM users WHERE role != 'student' ORDER BY display_name"
    ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d['you'] = (r['id'] == session['user_id'])
        result.append(d)
    return jsonify(result)

@app.route('/api/admin/users', methods=['POST'])
@admin_required
def create_admin_user():
    data = request.get_json(silent=True) or {}
    name     = (data.get('name') or '').strip()
    username = (data.get('username') or '').strip().lower()
    password = (data.get('password') or '').strip()
    role     = data.get('role', 'instructor')
    course   = data.get('course', 'both')
    if not name or not username or not password:
        return jsonify({'error': 'Name, username, and password required'}), 400
    db = get_db()
    if db.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone():
        return jsonify({'error': f'Username "{username}" already taken'}), 409
    initials = make_initials(name)
    cur = db.execute(
        'INSERT INTO users (username, email, display_name, initials, password_hash, role, course) VALUES (?,?,?,?,?,?,?)',
        (username, '', name, initials, hash_password(password), role, course)
    )
    db.commit()
    row = db.execute('SELECT id, username, display_name, role, course, is_active FROM users WHERE id = ?', (cur.lastrowid,)).fetchone()
    d = dict(row)
    d['you'] = False
    return jsonify(d), 201

@app.route('/api/admin/users/<int:user_id>', methods=['PATCH'])
@admin_required
def update_admin_user(user_id):
    data = request.get_json(silent=True) or {}
    db = get_db()
    row = db.execute('SELECT id FROM users WHERE id = ?', (user_id,)).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    if 'password' in data:
        new_pw = data['password'].strip()
        if len(new_pw) < 6:
            return jsonify({'error': 'Password too short'}), 400
        db.execute('UPDATE users SET password_hash = ? WHERE id = ?',
                   (hash_password(new_pw), user_id))
    allowed = {k: v for k, v in data.items() if k in ('is_active', 'role', 'course')}
    if allowed:
        set_clause = ', '.join(f'{k} = ?' for k in allowed)
        db.execute(f'UPDATE users SET {set_clause} WHERE id = ?', (*allowed.values(), user_id))
    db.commit()
    row = db.execute('SELECT id, username, display_name, role, course, is_active FROM users WHERE id = ?', (user_id,)).fetchone()
    d = dict(row)
    d['you'] = (user_id == session['user_id'])
    return jsonify(d)

@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_admin_user(user_id):
    if user_id == session['user_id']:
        return jsonify({'error': 'Cannot delete your own account'}), 400
    db = get_db()
    db.execute("DELETE FROM users WHERE id = ? AND role != 'student'", (user_id,))
    db.commit()
    return jsonify({'ok': True})


# ── FORMS API ────────────────────────────────────────────────────────────────

@app.route('/api/forms')
@login_required
def get_forms():
    db = get_db()
    if session.get('role') == 'student':
        rows = db.execute('''
            SELECT fr.*, u.display_name as student_name,
                   fs.submitted_at, fc.completed_at
            FROM form_requests fr
            LEFT JOIN users u ON u.id = fr.student_id
            LEFT JOIN form_submissions fs ON fs.request_id = fr.id
            LEFT JOIN form_completions fc ON fc.request_id = fr.id
            WHERE fr.student_id = ?
            ORDER BY fr.created_at DESC
        ''', (session['user_id'],)).fetchall()
    else:
        rows = db.execute('''
            SELECT fr.*, u.display_name as student_name,
                   fs.submitted_at, fc.completed_at
            FROM form_requests fr
            LEFT JOIN users u ON u.id = fr.student_id
            LEFT JOIN form_submissions fs ON fs.request_id = fr.id
            LEFT JOIN form_completions fc ON fc.request_id = fr.id
            ORDER BY fr.created_at DESC
        ''').fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/forms', methods=['POST'])
@admin_required
def create_form_requests():
    data        = request.get_json(silent=True) or {}
    form_type   = data.get('form_type', 'i9')
    student_ids = data.get('student_ids', [])
    note        = data.get('note', '')
    due_date    = data.get('due_date', '')
    if not student_ids or form_type not in ('i9', 'w4'):
        return jsonify({'error': 'form_type and student_ids required'}), 400
    db = get_db()
    created = []
    for sid in student_ids:
        stu = db.execute("SELECT id FROM users WHERE id = ? AND role = 'student'", (sid,)).fetchone()
        if not stu:
            continue
        cur = db.execute(
            'INSERT INTO form_requests (form_type, student_id, created_by, note, due_date) VALUES (?,?,?,?,?)',
            (form_type, sid, session['user_id'], note, due_date)
        )
        created.append(cur.lastrowid)
    db.commit()
    return jsonify({'created': created}), 201


@app.route('/api/forms/<int:form_id>')
@login_required
def get_form(form_id):
    db = get_db()
    row = db.execute('''
        SELECT fr.*, u.display_name as student_name
        FROM form_requests fr
        LEFT JOIN users u ON u.id = fr.student_id
        WHERE fr.id = ?
    ''', (form_id,)).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    if session.get('role') == 'student' and row['student_id'] != session['user_id']:
        return jsonify({'error': 'Forbidden'}), 403
    result = dict(row)
    sub = db.execute('SELECT * FROM form_submissions WHERE request_id = ?', (form_id,)).fetchone()
    if sub:
        s = dict(sub)
        s['fields'] = json.loads(s['fields'])
        result['submission'] = s
    comp = db.execute('''
        SELECT fc.*, u.display_name as completed_by_name
        FROM form_completions fc
        LEFT JOIN users u ON u.id = fc.completed_by
        WHERE fc.request_id = ?
    ''', (form_id,)).fetchone()
    if comp:
        c = dict(comp)
        c['fields'] = json.loads(c['fields'])
        result['completion'] = c
    return jsonify(result)


@app.route('/api/forms/<int:form_id>/submit', methods=['POST'])
@login_required
def submit_form(form_id):
    db = get_db()
    row = db.execute('SELECT * FROM form_requests WHERE id = ?', (form_id,)).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    if session.get('role') == 'student' and row['student_id'] != session['user_id']:
        return jsonify({'error': 'Forbidden'}), 403
    if row['status'] != 'pending':
        return jsonify({'error': 'Form already submitted'}), 400
    data      = request.get_json(silent=True) or {}
    fields    = data.get('fields', {})
    signature = data.get('signature', '')
    if not signature:
        return jsonify({'error': 'Signature required'}), 400
    db.execute(
        'INSERT INTO form_submissions (request_id, fields, signature) VALUES (?,?,?)',
        (form_id, json.dumps(fields), signature)
    )
    new_status = 'submitted' if row['form_type'] == 'i9' else 'complete'
    db.execute('UPDATE form_requests SET status = ? WHERE id = ?', (new_status, form_id))
    db.commit()
    return jsonify({'ok': True, 'status': new_status})


@app.route('/api/forms/<int:form_id>/complete', methods=['POST'])
@admin_required
def complete_form(form_id):
    db = get_db()
    row = db.execute('SELECT * FROM form_requests WHERE id = ?', (form_id,)).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    if row['status'] != 'submitted':
        return jsonify({'error': 'Form not awaiting completion'}), 400
    data      = request.get_json(silent=True) or {}
    fields    = data.get('fields', {})
    signature = data.get('signature', '')
    if not signature:
        return jsonify({'error': 'Admin signature required'}), 400
    db.execute(
        'INSERT INTO form_completions (request_id, fields, signature, completed_by) VALUES (?,?,?,?)',
        (form_id, json.dumps(fields), signature, session['user_id'])
    )
    db.execute("UPDATE form_requests SET status = 'complete' WHERE id = ?", (form_id,))
    db.commit()
    return jsonify({'ok': True})


@app.route('/api/forms/<int:form_id>', methods=['DELETE'])
@admin_required
def delete_form(form_id):
    db = get_db()
    db.execute('DELETE FROM form_completions WHERE request_id = ?', (form_id,))
    db.execute('DELETE FROM form_submissions WHERE request_id = ?', (form_id,))
    db.execute('DELETE FROM form_requests WHERE id = ?', (form_id,))
    db.commit()
    return jsonify({'ok': True})


# ── STARTUP ──────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    init_db()
    migrate_db()
    import seed
    seed.run()
    port  = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV') == 'development'
    app.run(host='0.0.0.0', port=port, debug=debug)
