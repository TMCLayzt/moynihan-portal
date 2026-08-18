# Moynihan Center Fellowship Portal

A calendar portal for Moynihan Center fellows (PSC 31180 and PSC 31330), plus a
staff area for managing what fellows see.

**Live:** https://moynihan-portal.onrender.com/ — hosted on Render, auto-deploying
from the `main` branch of this repo.

## How access works

**Fellows** enter one shared access code. There are no student accounts and the
portal stores nothing about individual students — no roster, no emails, no
passwords, no per-student progress. Change `STUDENT_ACCESS_CODE` each semester
and give the new code to that term's fellows.

**Staff** sign in with individual usernames and passwords, and can add or edit
events, announcements, and resources. Staff accounts live in the Airtable
`Users` table; create them from **Admin → Admin users**.

## What fellows see

| Tab | Contents |
| --- | --- |
| Dashboard | Announcements, what's due, upcoming sessions |
| Calendar | Master calendar, filterable to PSC 31180 or TAP 31330 (each includes joint events) |
| Resources | Links and documents, grouped by category |
| About | Program description, instructor contacts, how-to guide |

Events marked **staff-only** or **hidden** are never sent to a fellow's browser —
they're filtered out server-side, not just hidden in the UI.

Fellows can subscribe the calendar to Outlook, Google, or Apple Calendar via the
**Subscribe** button, which uses the live feed at `/api/calendar.ics`.

## Configuration

Every secret comes from an environment variable. **The app refuses to start if
any required variable is missing** rather than falling back to a default — an
earlier version shipped guessable defaults in this public repo, which is exactly
the failure this prevents.

Required:

| Variable | Purpose |
| --- | --- |
| `SECRET_KEY` | Signs the session cookie |
| `AIRTABLE_TOKEN` | Airtable personal access token |
| `AIRTABLE_BASE_ID` | Airtable base ID |
| `STUDENT_ACCESS_CODE` | The shared code fellows use |
| `ICS_PUBLIC_TOKEN` | Calendar feed token for fellows |
| `ICS_STAFF_TOKEN` | Calendar feed token including staff-only events |

Optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SEMESTER_LABEL` | `Fall 2026` | The term named throughout the portal |
| `FLASK_ENV` | — | `production` enables secure cookies; `development` enables the debugger |

### Rolling over to a new semester

The term is named in exactly one place. Change `SEMESTER_LABEL` in the Render
dashboard, and change `STUDENT_ACCESS_CODE` so the previous cohort's code stops
working. No code changes.

## Running locally

Copy `.env.example` to `.env` and fill in the values (`.env` is gitignored):

```bash
cp .env.example .env
```

Generate a `SECRET_KEY` with:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Then:

```bash
python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && python app.py
```

The portal runs at http://localhost:5000 (or `PORT` if set).

## Deploying

Render redeploys automatically on every push to `main`. Set the environment
variables in the Render dashboard under the service's **Environment** tab. A
missing variable makes the app exit at startup with a message naming it, so
check the deploy logs if a release fails to boot.

## Data

All data lives in Airtable, so the app itself is stateless and can be moved
between hosts without data loss. Four tables are used:

| Table | Contents |
| --- | --- |
| Users | Staff accounts only |
| Events | Calendar events |
| Announcements | Notices shown on the dashboard |
| Resources | Links and documents |

To back up, duplicate the Airtable base.

## Notes on the free tier

Render's free tier puts the service to sleep when idle, so the first visit after
a quiet period takes a few seconds to wake. The frontend detects this, shows a
"waking up" message, and retries — rather than failing with a parse error, which
is what it used to do.
