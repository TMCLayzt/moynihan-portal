# Moynihan Center Fellowship Portal

## Running locally (first time)

Open Terminal and run these commands one by one:

```bash
cd ~/Desktop/moynihan-portal
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python seed.py
python app.py
```

Then open your browser to: http://localhost:5000

Default logins:
- Admin: `admin` / `admin2025`
- Layana: `layana` / `moynihan2025`
- Dr. Miller: `miller` / `tap2025`

Students log in with their email username (part before @) and the default password `moynihan2025`.

---

## Running locally (after the first time)

```bash
cd ~/Desktop/moynihan-portal
source venv/bin/activate
python app.py
```

---

## Deploying to Railway (free hosting)

1. Create a free account at https://railway.app
2. Install Railway CLI or use the web dashboard
3. In the web dashboard: New Project → Deploy from GitHub repo
   - Push this folder to a GitHub repo first (or use Railway's drag-and-drop)
4. Set these environment variables in Railway:
   - `SECRET_KEY` → any random string, e.g. `moynihan-portal-secret-2025`
   - `DATABASE_URL` → leave blank (Railway will use SQLite by default)
5. Railway will detect it's a Python app and deploy automatically

Your portal will get a URL like `https://moynihan-portal.up.railway.app`

---

## Adding students

**Option 1 — Upload a spreadsheet:**
1. Log in as admin
2. Go to Admin → Students
3. Download the CSV template
4. Fill it in with: name, email (their CCNY email), course (psc31180 or psc31330)
5. Upload the file — students are imported instantly
6. All students get the default password `moynihan2025`

**Option 2 — Add one at a time:**
Use the "Add student manually" form in Admin → Students.

---

## Resetting a student's password

1. Log in as admin
2. Go to Admin → Students
3. There is no password reset button for students yet — you can reset it via Admin → Admin users → Reset pw for admin accounts, or tell the student their password is still `moynihan2025` (they can change it after logging in).

---

## Backing up the database

The database is the file `portal.db` in the project folder. To back it up, just copy that file somewhere safe. To restore, replace it with your backup.

On Railway, you can download the database file from the Railway dashboard under your service's file system.

---

## Changing the default student password

Open `app.py` and find this line near the top:

```python
DEFAULT_PASSWORD = os.environ.get('DEFAULT_STUDENT_PASSWORD', 'moynihan2025')
```

Change `'moynihan2025'` to whatever you want. New students added after this change will get the new default.
