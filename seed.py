"""
Run once to populate the database with all course data.
Safe to re-run: skips if data already exists.
"""
import sqlite3
import bcrypt
import os

DATABASE = os.environ.get('DATABASE_URL', 'portal.db')
DEFAULT_PASSWORD = os.environ.get('DEFAULT_STUDENT_PASSWORD', 'moynihan2025')

def hash_pw(plain):
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()

def run():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row

    # Skip if already seeded
    if db.execute('SELECT COUNT(*) FROM users').fetchone()[0] > 0:
        db.close()
        return

    print('Seeding database...')

    # ── USERS ────────────────────────────────────────────────────
    users = [
        ('admin',   '',                         'Site Admin',        'SA', hash_pw('admin2025'),    'admin',      'both'),
        ('layana',  'labutouq@ccny.cuny.edu',   'Layana Abu Touq',   'LA', hash_pw('moynihan2025'), 'instructor', 'psc31180'),
        ('miller',  'mmiller3@ccny.cuny.edu',   'Dr. Michael Miller','MM', hash_pw('tap2025'),      'instructor', 'psc31330'),
    ]
    db.executemany(
        'INSERT INTO users (username,email,display_name,initials,password_hash,role,course) VALUES (?,?,?,?,?,?,?)',
        users
    )

    # ── ANNOUNCEMENTS ────────────────────────────────────────────
    announcements = [
        ('Syllabus is a living document',
         'Check back regularly. Sessions with a joint TMC/event marker have special locations — note them carefully as they will not be in NAC 4/133.',
         'maroon'),
        ('Resume meetings: schedule by Sep 20',
         'All initial 1:1 resume review meetings must take place Sep 8–20. Approved resumes are due Oct 6 — assignment isn\'t complete until approved.',
         'orange'),
        ('Mock interviews: Oct 30 – Nov 10 window',
         'Schedule your mock interview with Layana during this window. Students may repeat the session to improve their grade. Final deadline: Nov 10.',
         'blue'),
        ('Policy Memo: two versions required',
         'Due Dec 1. Each student submits a student-written memo AND a ChatGPT-generated memo on the same prompt, plus a comparison paragraph. 600–800 words total.',
         'amber'),
    ]
    db.executemany('INSERT INTO announcements (title,body,color) VALUES (?,?,?)', announcements)

    # ── PSC 31180 EVENTS ─────────────────────────────────────────
    joint_dates = {
        '2025-08-27','2025-09-29','2025-10-06','2025-10-08','2025-10-15',
        '2025-10-24','2025-11-05','2025-11-12','2025-11-19','2025-12-03'
    }

    psc31180_events_raw = [
        ('2025-08-27', 'Moynihan Documentary Screening', 'guest', 'With filmmaker Joe Dorman · Shepard Hall 107 · 3:15–6:00 PM'),
        ('2025-09-03', 'Course intro & interview techniques', 'lecture', 'PSC 31180 · NAC 4/133 · 3:30–4:45 PM'),
        ('2025-09-03', 'Review PAR & STAR methods', 'reading', 'Prep for resume review sessions'),
        ('2025-09-08', 'Introduction to Public Service + Interview Techniques', 'lecture', 'Review nyc.gov jobs board & NYC agencies list'),
        ('2025-09-10', 'Theories of Public Policy + Cover Letter Writing', 'lecture', 'NAC 4/133'),
        ('2025-09-10', 'Reading: Jones, Epp & Baumgartner — Democracy & Policy Punctuations', 'reading', 'Also: Cohen, March & Olsen "Garbage-Can Model"; Balance Careers Cover Letter Guide'),
        ('2025-09-15', 'Guest: Helen Rosenthal, NYC Councilmember (2014–2021)', 'guest', 'NYC Budgeting & Org Chart · Review: NYC Org Chart + Understanding NYC Budget'),
        ('2025-09-17', 'Logic Study: Civic neighborhood walk', 'lecture', 'Wear all-weather clothing — going outside · Guest: Maya Gutierrez, CCNY Public Service Career Hub'),
        ('2025-09-24', '1:1 Resume review deadline', 'milestone', 'All initial meetings must be completed by today (9/8–9/20 window)'),
        ('2025-09-29', 'Guest: Jeff Rodus, CUNY Vice Chancellor', 'guest', 'Location: SH 550 · Review guest profile & prepare questions'),
        ('2025-10-06', 'NYC Elections panel — FAQ NYC', 'guest', 'Guests: Dr. Christina Greer (Fordham) & Harry Siegel (The City) · SH 550 · 3:30–5:00 PM · RESUMES DUE'),
        ('2025-10-06', 'Approved Resume due', 'homework', 'Must be approved by today — email directly to instructor'),
        ('2025-10-08', 'The Taliban Courts in Afghanistan — Baczko & Qaderi', 'guest', 'NAC Atrium Flex Space · 3:30–5:00 PM · Cover Letter DRAFT due today'),
        ('2025-10-08', 'Cover Letter draft due', 'homework', 'Email draft to instructor for review'),
        ('2025-10-14', 'Politics & Government: Problems, Structure, Size', 'lecture', 'Make-up day (Tuesday) · Read: Kraft & Furlong, Public Policy Ch. 2'),
        ('2025-10-15', 'Academic Freedom Panel 1: Conceptual Foundations', 'guest', 'Kaputu, Noori, Qaderi, Zubillaga · SH 550 · 3:30–5:00 PM · Research 5 internship sites (email by this date)'),
        ('2025-10-22', 'NYC Government Administration — DCAS Guests', 'guest', 'Dept. of Citywide Administrative Services · Cover letter FINAL due today (upload to Brightspace)'),
        ('2025-10-22', 'Cover Letter final due', 'homework', 'Upload final version via Brightspace after one revision cycle'),
        ('2025-10-24', 'Volcker Alliance / Next Gen Visit + Lunch', 'guest', 'Make-up day (Friday) · Location: SH 107'),
        ('2025-10-27', 'Understanding Public Policy', 'lecture', 'Read: Kraft & Furlong, Ch. 1 + Ch. 3 pp. 78–88'),
        ('2025-10-29', "NYC Immigration Policy — Mayor's Office of Immigrant Affairs", 'guest', 'Guests: Enrique Chavira, Jemimah Cochrane, Neatric Norwood · Schedule mock interview (10/30–11/10)'),
        ('2025-11-03', 'The Policy Process', 'lecture', 'Read: The Policy Process & Policy Theories; Soule & King, "Stages of the Policy Process"'),
        ('2025-11-05', 'Bryan Garsten — Liberalism and its Presuppositions', 'guest', 'Location: NAC 0/201 · 3:30–5:00 PM · Final date for mock interview: Nov 10'),
        ('2025-11-10', 'Mock Interview deadline', 'milestone', 'Final date to complete mock interview with Layana'),
        ('2025-11-10', 'Midpoint Check-In + Policy Memo + Building Candidacy', 'lecture', 'Read: How To Write A Policy Memo That Matters'),
        ('2025-11-12', 'Mentorship Event', 'guest', 'Location: NAC Ballroom'),
        ('2025-11-17', 'NYC Human Rights Law — NYC Commission on Human Rights', 'guest', 'Guests: Orlando Torres (Outreach & Racial Justice), Ryan DuBois (Native American Communities)'),
        ('2025-11-19', 'Information Wars: Global Battle Against Disinformation', 'guest', 'Richard Stengel · Aaron Davis Hall, Marian Anderson Theater · 3:30–5:00 PM'),
        ('2025-11-24', 'Research and the Policy Process', 'lecture', "Read: Blackmore & Lauder, 'Researching Policy,' Policy Sciences (2006) pp. 97–104"),
        ('2025-12-01', 'NYC Public Sector Careers panel', 'guest', "Commissioner Camara (Intl Affairs), Dep. Commissioner Bobbitt (DYCD), Exec. Director Badi (Children's Cabinet)"),
        ('2025-12-01', 'NYC Policy Memo due', 'homework', '600–800 words · Submit via Brightspace tonight · Includes student-written + ChatGPT versions + comparison paragraph'),
        ('2025-12-03', 'Academic Freedom Panel 2: US Regulatory Context', 'guest', 'NAC Flex Space 1/103 · 3:30–5:00 PM · RSVP required via Eventbrite'),
        ('2025-12-08', 'Professional Development & Summer 2026', 'lecture', 'Planning session for post-semester career moves'),
        ('2025-12-10', 'Internship Search Plan Presentations (Group 1)', 'milestone', '5-min presentations · Slides optional · Submit written plan today'),
        ('2025-12-10', 'Summer Internship Search Plan Report due', 'homework', '2,500 words · 5 sections: Org interests, Career planning, Pursuit strategy, Candidacy, Outcomes'),
        ('2025-12-15', 'Internship Search Plan Presentations (Group 2) + Closing Survey', 'milestone', 'Complete closing survey after presentations'),
    ]

    for date, title, cat, note in psc31180_events_raw:
        course = 'joint' if (cat == 'guest' and date in joint_dates) else 'psc31180'
        db.execute('INSERT INTO events (title,date,cat,note,course) VALUES (?,?,?,?,?)',
                   (title, date, cat, note, course))

    # ── PSC 31330 (TAP) EVENTS ────────────────────────────────────
    tap_events = [
        ('2025-09-03', 'TAP Class 1: Introduction', 'lecture', 'psc31330', 'SH 558 · Readings: Orwell 1984, Newman Julia, Rauch Ch. 1'),
        ('2025-09-07', 'Belief Inventory due', 'homework', 'psc31330', '5% · Individual assignment · Submit by Sunday'),
        ('2025-09-08', 'TAP Class 2: Truth & Politics', 'lecture', 'psc31330', 'SH 558 · Read: Arendt, "Truth and Politics," Between Past and Future pp. 227–264'),
        ('2025-09-10', 'TAP Class 3: Polarization', 'lecture', 'psc31330', 'SH 558 · Guest: Frank Barry (Bloomberg Opinion) · Read: Mason, Uncivil Agreement Ch. 1'),
        ('2025-09-15', 'TAP Class 4: Tribal Truth', 'lecture', 'psc31330', 'SH 558 · Read: Rauch, Constitution of Knowledge Ch. 2'),
        ('2025-09-17', 'TAP Class 5: Cognitive Bias', 'lecture', 'psc31330', 'SH 558 · Read: Kahneman, Thinking Fast and Slow Ch. 1; Barclay, "Science of the Mind and Post-Truth Culture"'),
        ('2025-10-05', 'Belief Origins Analysis due', 'homework', 'psc31330', '20% · Individual assignment · Due Sunday'),
        ('2025-10-14', 'TAP Class 6: Knowledge Producing Institutions', 'lecture', 'psc31330', 'Make-up Tuesday · Read: Rauch Ch. 3 & 4 · Groups assigned in class'),
        ('2025-10-22', 'TAP Class 7: The Attention Economy', 'lecture', 'psc31330', 'SH 558 · Read: Wu "Attention Brokers"; Rauch Ch. 5 "Disinformation Technology"'),
        ('2025-10-27', 'TAP Class 8: Post-Truth', 'lecture', 'psc31330', 'SH 558 · Read: McIntyre Post-Truth Ch. 1; Warzel & Caulfield; Optional: Pomerantsev'),
        ('2025-10-29', 'TAP Class 9: Digital Surrogate Organizations', 'lecture', 'psc31330', 'SH 558 · Guest: Steven Livingston (GWU) · Read: Livingston & Bahador (2025)'),
        ('2025-11-03', 'TAP Class 10: Troll Epistemology', 'lecture', 'psc31330', 'SH 558 · Read: Rauch Ch. 6 "Flood the Zone with Shit"; Sobieraj "Disinformation Democracy" SSRC 2021'),
        ('2025-11-10', 'TAP Class 11: Cancel Culture', 'lecture', 'psc31330', 'SH 558 · Read: Rauch Ch. 7; Lukianoff & Haidt "The Coddling of the American Mind" The Atlantic 2015'),
        ('2025-11-10', 'Knowledge Claim Peer Review due', 'homework', 'psc31330', '15% · Group assignment · Due today'),
        ('2025-11-10', 'Group Project Proposal due', 'homework', 'psc31330', '5% · Group assignment · Due today'),
        ('2025-11-17', 'TAP Class 12: Bullshit', 'lecture', 'psc31330', 'SH 558 · Read: Frankfurt, On Bullshit; Petrocelli TEDx Talk (13 min)'),
        ('2025-11-24', 'TAP Class 13: Conspiracism, Old & New', 'lecture', 'psc31330', 'SH 558 · Read: Muirhead & Rosenblum A Lot of People Are Saying Ch. 1–2; Optional: Hofstadter'),
        ('2025-12-01', 'TAP Class 14: The Death of Expertise', 'lecture', 'psc31330', 'SH 558 or NAC 4/113 · Read: Nichols Death of Expertise Ch. 1–2; Lippmann; Moynihan (1965)'),
        ('2025-12-08', 'TAP Class 15: What is to be done?', 'lecture', 'psc31330', 'SH 558 or NAC 4/113 · Read: Dewey Public and Its Problems Ch. 5–6; Rauch Ch. 8; Lynch'),
        ('2025-12-09', 'Group Policy Briefs due', 'homework', 'psc31330', '25% · Group assignment · Due Tuesday'),
        ('2025-12-10', 'TAP Final Presentations (Day 1)', 'milestone', 'psc31330', 'SH 558 or NAC 4/113'),
        ('2025-12-15', 'TAP Final Presentations (Day 2)', 'milestone', 'psc31330', 'SH 558 or NAC 4/113'),
    ]

    for date, title, cat, course, note in tap_events:
        db.execute('INSERT INTO events (title,date,cat,note,course) VALUES (?,?,?,?,?)',
                   (title, date, cat, note, course))

    # ── PSC 31180 MODULES ─────────────────────────────────────────
    psc_modules = [
        (1, 'Module 1', 'Personal Development',
         'Focused on self-presentation and interviewing techniques, with specific training and evaluation sessions on résumé and cover-letter writing as well as job interview strategy and performance.',
         100, 'Complete', 'Sep 3 – Sep 29', 'psc31180',
         [
             ('Wed Aug 27', 'Moynihan Documentary Screening', 'Shepard Hall 107 · 3:15–6:00 PM', True),
             ('Wed Sep 3',  'Course Introduction & Interview Techniques', 'PAR & STAR method · Schedule 1:1 resume review', False),
             ('Mon Sep 8',  'Introduction to Public Service & Interview Techniques', 'Review nyc.gov jobs board & NYC agencies list', False),
             ('Mon Sep 15', 'NYC Budgeting — Guest: Helen Rosenthal', 'NYC Councilmember (2014–2021)', False),
             ('Wed Sep 17', 'Logic Study: Civic Neighborhood Walk', 'Guest: Maya Gutierrez, CCNY · Wear all-weather clothing', False),
             ('Mon Sep 29', 'Guest: Jeff Rodus, CUNY Vice Chancellor', 'SH 550', True),
         ],
         [
             ('Approved Resume', 'Oct 6', 'homework', '15% · Email to instructor · Initial meeting by Sep 24'),
             ('Cover Letter', 'Oct 22', 'homework', '15% · Draft due Oct 8 · Final via Brightspace'),
             ('Mock Interview', 'Nov 10', 'milestone', '15% · Schedule Oct 30–Nov 10 · May repeat to improve grade'),
             ('1:1 Resume meeting', 'Sep 24', 'milestone', 'Schedule between Sep 8–20'),
         ],
         [
             ('PAR Approach & STAR Method', 'Sep 3', 'Online', 'Frameworks for structuring behavioral interview answers.'),
             ('Jones, Epp & Baumgartner — Democracy, Authoritarianism, and Policy Punctuations', 'Sep 10', 'PDF', 'Foundational text on how policy change occurs and the role of political actors.'),
             ('Cohen, March & Olsen — A Garbage-Can Model of Organizational Choice', 'Sep 10', 'PDF', 'Classic org theory on decision-making in ambiguous institutions.'),
             ('The Balance Careers — Cover Letter Writing Guide', 'Sep 10', 'Online', 'Practical structure guide for cover letters in public service roles.'),
             ("NYC Organizational Chart & Budget Guide", 'Sep 15', 'Online', "Understanding New York City's Budget and NYC Agency org chart."),
             ('How to Make the Most of a Panel', 'Oct 22', 'Online', 'Professional engagement, question prep, and networking at panels.'),
         ]),
        (2, 'Module 2', 'Policy & Power in NYC',
         "Introduces theories and concepts of policy and power as they relate to NYC public service. Deals with policy as a process — not an accomplished fact — examining how power, institutions, and the city's subjects take shape.",
         45, 'In progress', 'Oct 6 – Nov 12', 'psc31180',
         [
             ('Mon Oct 6',  'NYC Elections — FAQ NYC Panel', 'Dr. Christina Greer & Harry Siegel · SH 550 · 3:30–5:00 PM', True),
             ('Wed Oct 8',  'The Taliban Courts in Afghanistan — Baczko & Qaderi', 'NAC Atrium Flex Space · 3:30–5:00 PM', True),
             ('Tue Oct 14', 'Politics & Government: Problems, Structure, Size', 'Make-up day', False),
             ('Wed Oct 15', 'Academic Freedom Panel 1: Conceptual Foundations', 'Kaputu, Noori, Qaderi, Zubillaga · SH 550 · 3:30–5:00 PM', True),
             ('Wed Oct 22', 'NYC Government Administration — DCAS Guests', 'Dept. of Citywide Administrative Services', False),
             ('Fri Oct 24', 'Volcker Alliance / Next Gen Visit + Lunch', 'Make-up day · SH 107', True),
             ('Mon Oct 27', 'Understanding Public Policy', '', False),
             ('Wed Oct 29', "NYC Immigration Policy — Mayor's Office of Immigrant Affairs", 'Chavira, Cochrane, Norwood · Schedule mock interview', False),
             ('Mon Nov 3',  'The Policy Process', '', False),
             ('Wed Nov 5',  'Bryan Garsten — Liberalism and its Presuppositions', 'NAC 0/201 · 3:30–5:00 PM', True),
             ('Mon Nov 10', 'Midpoint Check-In + Policy Memo Workshop', '', False),
             ('Wed Nov 12', 'Mentorship Event', 'NAC Ballroom', True),
         ],
         [
             ('5 Internship Sites Research', 'Oct 15', 'milestone', '1 paragraph per site: why interesting, career fit, one contact · Email to instructor'),
             ('NYC Policy Memo', 'Dec 1', 'homework', '15% · 600–800 words · Student-written + ChatGPT version + comparison paragraph'),
         ],
         [
             ('Kraft & Furlong — Public Policy: Politics, Analysis, and Alternatives, Ch. 2', 'Oct 14', 'PDF', 'Overview of government structures, political actors, and public policy frameworks.'),
             ('Kraft & Furlong — Public Policy, Ch. 1 & Ch. 3 (pp. 78–88)', 'Oct 27', 'PDF', 'Foundational introduction to the policy process and alternatives analysis.'),
             ('Prepare for the Interview', 'Oct 29', 'Online', 'Guide to mock interview prep — review before scheduling with Layana.'),
             ('The Policy Process and Policy Theories', 'Nov 3', 'PDF', 'Survey of major theories: punctuated equilibrium, multiple streams, advocacy coalitions.'),
             ('Soule & King — Stages of the Policy Process and the Equal Rights Amendment, 1972–1982', 'Nov 3', 'PDF', 'Case study applying policy process theory to landmark civil rights legislation.'),
             ('How To Write A Policy Memo That Matters', 'Nov 10', 'Online', 'Practical guide to memo structure, argument framing, and policy recommendations.'),
         ]),
        (3, 'Module 3', 'Career Paths in NYC Public Service',
         'Establishes what career paths are available in NYC Public Service and how to achieve your goals — covering experience-building, networking, information-gathering, and identifying opportunities that fit your talents, values, and aspirations.',
         0, 'Upcoming', 'Nov 17 – Dec 15', 'psc31180',
         [
             ('Mon Nov 17', 'NYC Human Rights Law — Commission on Human Rights', 'Orlando Torres & Ryan DuBois · Prepare 2 questions each', False),
             ('Wed Nov 19', 'Information Wars — Richard Stengel', 'Aaron Davis Hall, Marian Anderson Theater · 3:30–5:00 PM', True),
             ('Mon Nov 24', 'Research and the Policy Process', '', False),
             ('Mon Dec 1',  'NYC Public Sector Careers Panel', 'Camara, Bobbitt, Badi · Policy Memo due tonight', False),
             ('Wed Dec 3',  'Academic Freedom Panel 2: US Regulatory Context', 'NAC Flex Space 1/103 · 3:30–5:00 PM', True),
             ('Mon Dec 8',  'Professional Development & Summer 2026', '', False),
             ('Wed Dec 10', 'Internship Search Plan Presentations (Group 1)', 'Submit written report today', False),
             ('Mon Dec 15', 'Internship Search Plan Presentations (Group 2) + Closing Survey', '', False),
         ],
         [
             ('Summer Internship Search Plan Report', 'Dec 10', 'homework', '15% · 2,500 words · 5 sections · Submit on Brightspace'),
             ('Internship Search Plan Presentation', 'Dec 10 & 15', 'milestone', '5% · 5-min in-class presentation · Slides optional'),
             ('Closing Survey', 'Dec 15', 'milestone', 'Complete at end of final session'),
             ('Class Participation & Engagement', 'Ongoing', 'milestone', '20% · Attendance compulsory · Grade reduced after 3 absences'),
         ],
         [
             ('Blackmore & Lauder — Researching Policy, Policy Sciences (2006) pp. 97–104', 'Nov 24', 'PDF', 'Methodological approaches to policy research in applied social science contexts.'),
             ('NYC.gov Jobs Board', 'Ongoing', 'Online', 'Official NYC government jobs portal — review early and bookmark positions of interest.'),
             ('NYC Agencies Directory', 'Ongoing', 'Online', 'Full list of NYC agencies by topic area — starting point for internship and career research.'),
         ]),
    ]

    # ── TAP MODULES ───────────────────────────────────────────────
    tap_modules = [
        (10, 'Unit 1', 'Foundations: Truth, Politics & the Mind',
         'Establishes the theoretical and philosophical foundations of the course — from Orwell and Arendt to cognitive science. Fellows examine why truth is contested, how tribal identity shapes belief, and how cognitive bias makes us all susceptible to misinformation.',
         100, 'Complete', 'Sep 3 – Sep 17', 'psc31330',
         [
             ('Wed Sep 3',  'Class 1: Introduction', 'Orwell 1984; Newman Julia; Rauch Ch. 1', False),
             ('Mon Sep 8',  'Class 2: Truth & Politics', 'Arendt "Truth and Politics" pp. 227–264', False),
             ('Wed Sep 10', 'Class 3: Polarization', 'Guest: Frank Barry (Bloomberg) · Mason Uncivil Agreement Ch. 1', False),
             ('Mon Sep 15', 'Class 4: Tribal Truth', 'Rauch Ch. 2', False),
             ('Wed Sep 17', 'Class 5: Cognitive Bias', 'Kahneman Ch. 1; Barclay on Post-Truth Culture', False),
         ],
         [
             ('Belief Inventory Survey', 'Sep 7', 'homework', '5% · Individual · Submit online by Sunday'),
         ],
         [
             ('Orwell, George — 1984 (Excerpts)', 'Sep 3', 'PDF', 'Foundational literary exploration of state control over truth and language.'),
             ("Newman, Sandra — Julia (Excerpt)", 'Sep 3', 'PDF', "Contemporary companion to 1984 told from Julia's perspective."),
             ('Rauch — The Constitution of Knowledge, Ch. 1', 'Sep 3', 'Book', '"A Terrible Statement Unless He Gets Away with It" — the course\'s central text.'),
             ('Arendt, Hannah — "Truth and Politics," Between Past and Future pp. 227–264', 'Sep 8', 'PDF', 'Essential essay on the tension between factual truth and political power.'),
             ('Mason, Lilliana — Uncivil Agreement, Ch. 1', 'Sep 10', 'PDF', 'How partisan identity sorting drives polarization beyond policy disagreement.'),
             ('Rauch — The Constitution of Knowledge, Ch. 2: "The State of Nature: Tribal Truth"', 'Sep 15', 'Book', 'The evolutionary and social roots of tribal epistemology.'),
             ('Kahneman, Daniel — Thinking, Fast and Slow, Ch. 1', 'Sep 17', 'PDF', 'Introduction to System 1 / System 2 thinking and cognitive bias.'),
             ('Barclay — "The Science of the Mind and the Post-Truth Culture"', 'Sep 17', 'PDF', 'From Disinformation: The Nature of Facts and Lies in the Post-Truth Era.'),
         ]),
        (11, 'Unit 2', 'Knowledge Systems & Digital Disruption',
         'Investigates how knowledge-producing institutions work, how the attention economy and digital media have disrupted them, and how post-truth politics, troll epistemology, and disinformation campaigns exploit these vulnerabilities.',
         50, 'In progress', 'Oct 14 – Nov 10', 'psc31330',
         [
             ('Tue Oct 14', 'Class 6: Knowledge Producing Institutions', 'Rauch Ch. 3 & 4 · Groups assigned', False),
             ('Wed Oct 22', 'Class 7: The Attention Economy', 'Wu; Rauch Ch. 5', False),
             ('Mon Oct 27', 'Class 8: Post-Truth', 'McIntyre; Warzel & Caulfield', False),
             ('Wed Oct 29', 'Class 9: Digital Surrogate Organizations', 'Guest: Steven Livingston (GWU)', False),
             ('Mon Nov 3',  'Class 10: Troll Epistemology', 'Rauch Ch. 6; Sobieraj', False),
             ('Mon Nov 10', 'Class 11: Cancel Culture', 'Rauch Ch. 7; Lukianoff & Haidt', False),
         ],
         [
             ('Belief Origins Analysis', 'Oct 5', 'homework', '20% · Individual · Due Sunday Oct 5'),
             ('Knowledge Claim Peer Review', 'Nov 10', 'homework', '15% · Group assignment'),
             ('Group Project Proposal', 'Nov 10', 'homework', '5% · Group assignment · Groups assigned Oct 14'),
         ],
         [
             ('Rauch — The Constitution of Knowledge, Ch. 3 & 4', 'Oct 14', 'Book', '"Booting Reality" and "The Constitution of Knowledge."'),
             ('Wu, Tim — "Attention Brokers"', 'Oct 22', 'Online', 'The history of the attention economy and how it shapes media and politics.'),
             ('Rauch — The Constitution of Knowledge, Ch. 5', 'Oct 22', 'Book', '"Disinformation Technology: The Challenge of Digital Media."'),
             ('McIntyre, Lee — Post-Truth, Ch. 1: "What Is Post-Truth?"', 'Oct 27', 'PDF', 'Defining the post-truth moment and its relationship to science denial.'),
             ('Warzel & Caulfield — "January 6 and the Triumph of the Justification Machine"', 'Oct 27', 'Online', 'The Atlantic, January 6, 2024.'),
             ('Livingston & Bahador — "Propaganda feedback loops as communication rituals"', 'Oct 29', 'PDF', 'Media, Culture & Society 47(6), 2025.'),
             ('Rauch — The Constitution of Knowledge, Ch. 6', 'Nov 3', 'Book', '"Troll Epistemology: \'Flood the Zone with Shit\'"'),
             ('Sobieraj — "Disinformation Democracy and the Social Costs of Identity-Based Attacks Online"', 'Nov 3', 'Online', 'Social Science Research Council, 2021.'),
             ('Rauch — The Constitution of Knowledge, Ch. 7', 'Nov 10', 'Book', '"Canceling: Despotism of the Few."'),
             ('Lukianoff & Haidt — "The Coddling of the American Mind"', 'Nov 10', 'Online', 'The Atlantic, September 2015.'),
         ]),
        (12, 'Unit 3', 'Responses: From Bullshit to Rebuilding',
         'Turns from diagnosis to response — examining cancel culture, conspiracism, and the death of expertise before pivoting to constructive defenses of truth-producing institutions. Fellows present group policy briefs on an epistemic challenge of their choosing.',
         0, 'Upcoming', 'Nov 17 – Dec 15', 'psc31330',
         [
             ('Mon Nov 17', 'Class 12: Bullshit', 'Frankfurt; Petrocelli TEDx', False),
             ('Mon Nov 24', 'Class 13: Conspiracism, Old & New', 'Muirhead & Rosenblum Ch. 1–2', False),
             ('Mon Dec 1',  'Class 14: The Death of Expertise', 'Nichols; Lippmann; Moynihan (1965)', False),
             ('Mon Dec 8',  'Class 15: What is to be done?', 'Dewey; Rauch Ch. 8; Lynch', False),
             ('Wed Dec 10', 'Final Presentations (Group 1)', 'SH 558 or NAC 4/113', False),
             ('Mon Dec 15', 'Final Presentations (Group 2)', 'SH 558 or NAC 4/113', False),
         ],
         [
             ('Group Project Policy Brief', 'Dec 9', 'homework', '25% · Group assignment · Primary deliverable'),
             ('Final Presentations', 'Dec 10 & 15', 'milestone', 'In-class presentation of group policy brief'),
             ('Class Participation & Engagement', 'Ongoing', 'milestone', '30% — largest component · Active seminar participation required'),
         ],
         [
             ('Frankfurt, Harry G. — On Bullshit', 'Nov 17', 'PDF', 'The classic philosophical distinction between lying and bullshitting.'),
             ('Petrocelli — "Why BS is more dangerous than a lie" (TEDx Talk, 13 min)', 'Nov 17', 'Online', 'University of Nevada TEDx Talk.'),
             ('Muirhead & Rosenblum — A Lot of People Are Saying, Ch. 1–2', 'Nov 24', 'PDF', 'The new conspiracism and its departure from classical conspiracy theory.'),
             ('Nichols, Tom — The Death of Expertise, Ch. 1–2', 'Dec 1', 'PDF', 'How the collapse of deference to expertise threatens democratic self-governance.'),
             ('Lippmann, Walter — The Phantom Public, Ch. 1', 'Dec 1', 'PDF', "A foundational skeptical account of the democratic public's epistemic limits."),
             ('Moynihan — "The Professionalization of Reform," The Public Interest (Fall 1965)', 'Dec 1', 'PDF', 'Moynihan on expertise, knowledge, and the limits of social science in government.'),
             ('Dewey, John — The Public and Its Problems, Ch. 5–6', 'Dec 8', 'PDF', "Dewey's answer: the Great Community and the role of communication in democracy."),
             ('Rauch — The Constitution of Knowledge, Ch. 8: "Unmute Yourself: Pushing Back"', 'Dec 8', 'Book', 'Constructive strategies for defending knowledge-producing institutions.'),
             ('Lynch — "The Value of Truth," Boston Review, March 1, 2021', 'Dec 8', 'Online', 'Why truth matters intrinsically, not just instrumentally.'),
         ]),
    ]

    all_modules = psc_modules + tap_modules

    for order_i, (orig_id, label, title, desc, progress, status, weeks, course, sessions, deliverables, readings) in enumerate(all_modules):
        cur = db.execute(
            'INSERT INTO modules (label,title,description,progress,status,weeks,course,order_index) VALUES (?,?,?,?,?,?,?,?)',
            (label, title, desc, progress, status, weeks, course, order_i)
        )
        mod_id = cur.lastrowid

        for s_i, (date_label, s_title, note, is_joint) in enumerate(sessions):
            db.execute(
                'INSERT INTO sessions (module_id,date_label,title,note,is_joint,order_index) VALUES (?,?,?,?,?,?)',
                (mod_id, date_label, s_title, note, int(is_joint), s_i)
            )

        for d_title, due, cat, note in deliverables:
            db.execute(
                'INSERT INTO deliverables (module_id,title,due_date,cat,note) VALUES (?,?,?,?,?)',
                (mod_id, d_title, due, cat, note)
            )

        for r_i, (r_title, when, r_type, r_desc) in enumerate(readings):
            db.execute(
                'INSERT INTO readings (module_id,title,when_label,type,description,order_index) VALUES (?,?,?,?,?,?)',
                (mod_id, r_title, when, r_type, r_desc, r_i)
            )

    # ── FINANCE ITEMS ────────────────────────────────────────────────────
    finance_items = [
        ('Complete Direct Deposit Form', 'Submit your bank info to receive stipend payments.', 'Before first disbursement', 'stipend', 1),
        ('Submit W-2 / W-9 Tax Form',   'Required for all paid fellows. Obtain from HR or Bursar.', 'First week of term', 'document', 1),
        ('Verify FAFSA Completion',      'Make sure your FAFSA is filed and processed for this academic year.', 'Sep 30', 'fafsa', 1),
        ('Sign Fellowship Agreement',    'Review and sign the fellowship terms and conditions.', 'First class session', 'document', 1),
        ('Complete Enrollment Verification', 'Confirm full-time enrollment status with the Registrar.', 'Week 2', 'document', 0),
    ]
    for i, (title, desc, due, cat, req) in enumerate(finance_items):
        db.execute(
            'INSERT INTO finance_items (title,description,due_label,category,is_required,order_index) VALUES (?,?,?,?,?,?)',
            (title, desc, due, cat, req, i)
        )

    # ── RESOURCES ────────────────────────────────────────────────────────
    resources_seed = [
        ('CCNY Bursar — Payments & Financial Aid', 'https://www.ccny.cuny.edu/bursar', 'Tuition, fees, and financial aid information.', 'finance', 0),
        ('FAFSA Application Portal', 'https://studentaid.gov/h/apply-for-aid/fafsa', 'File or update your Free Application for Federal Student Aid.', 'fafsa', 1),
        ('CCNY Registrar — Enrollment Verification', 'https://www.ccny.cuny.edu/registrar/enrollment-verification', 'Download proof of enrollment or request official letters.', 'forms', 0),
        ('CUNYfirst Student Portal', 'https://home.cunyfirst.cuny.edu', 'Official student records, registration, and billing.', 'general', 0),
        ('Brightspace (CCNY LMS)', 'https://brightspace.cuny.edu', 'Course materials, grades, and assignments.', 'academic', 0),
        ('CCNY Writing Center', 'https://www.ccny.cuny.edu/writingcenter', 'Free tutoring and writing support for all students.', 'academic', 1),
        ('CCNY Career Development', 'https://www.ccny.cuny.edu/careerdevelopment', 'Internship listings, career coaching, and resume review.', 'academic', 2),
        ('NYC 311 — City Services', 'https://portal.311.nyc.gov', 'Report issues and access New York City government services.', 'general', 1),
    ]
    for r_i, (title, url, desc, cat, order_i) in enumerate(resources_seed):
        db.execute(
            'INSERT INTO resources (title,url,description,category,order_index) VALUES (?,?,?,?,?)',
            (title, url, desc, cat, order_i)
        )

    db.commit()
    db.close()
    print('Done. Database seeded.')

if __name__ == '__main__':
    from app import init_db, migrate_db
    init_db()
    migrate_db()
    run()
