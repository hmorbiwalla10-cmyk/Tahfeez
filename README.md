# Qism al Tahfeez Dar es Salaam — Institute & Student Portal

Three pages, one website:

| Page | Who uses it | What it does |
|---|---|---|
| `index.html` | Everyone | Choose **Institute** or **Student** |
| `institute.html` | Institute staff | Sign in → mark fees paid (enter the amount), receipts are created automatically, add students by hand or from Excel, set usernames & passwords |
| `student.html` | Students | Sign in with username + password → **Home** (this month paid / not paid, the whole year, hifz progress) and **Receipts** (all receipts saved). A new receipt pops up the moment the institute records a payment. |

Security is enforced by the database itself (Supabase row-level security):
a student account can only ever read **its own** receipts, even if someone opens `institute.html`.
Only the institute account can add students, record payments or reset passwords.

---

## Try it right now (demo mode)

Open `index.html` in a browser. With no Supabase keys filled in, the site runs in **demo mode**
with example students; data is kept only in that browser.

- Institute: `admin` / `admin123`
- Student: `hussein.ahmed` / `zahra2026`

---

## Go live (about 15 minutes, free)

### 1. Create the database
1. Make a free account at **https://supabase.com** → **New project** (choose the region closest to you, e.g. *Frankfurt* or *Mumbai*).
2. **Authentication → Sign In / Providers → Email**: turn **off** *"Allow new users to sign up"*.
   (Students never sign up themselves; the institute creates their logins.)
3. **SQL Editor → New query** → paste the whole of `supabase-setup.sql` → **Run**. Then do the same with `supabase-update-2.sql` (keys, progress, notices, student details, disable, accounts, HR).
4. Create your institute login: open the website, tap **Institute**. The first time, it shows
   **Create institute account**. Choose a username and password and you are signed in.
   This form only appears while no institute account exists; after that, add more staff
   in **Settings → Institute accounts**.

### 2. Connect the website
1. In Supabase open **Project Settings → API Keys** (or **Data API**) and copy:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - the **anon / public** key (or the **publishable** key, `sb_publishable_…`)
2. Open `js/config.js` and paste them:
   ```js
   SUPABASE_URL: 'https://xxxx.supabase.co',
   SUPABASE_ANON_KEY: 'eyJhbGciOi…',
   ```
   These keys are safe to put in a website; the database rules do the protecting.
   **Never** paste the `service_role` / secret key here.

### 3. Put it online
Easiest: **https://app.netlify.com/drop**: drag the whole `tahfeez-daressalaam` folder onto the page.
Then in **Site configuration → Change site name** type `tahfeez-daressalaam`, so the link becomes `https://tahfeez-daressalaam.netlify.app`. If you buy your own domain (for example `tahfeezdaressalaam.com`), add it under **Domain management**.
(GitHub Pages, Vercel or any normal web hosting also work; it is just static files.)

- Give students: `https://your-site/student.html`
- Institute staff use: `https://your-site/institute.html`

On a phone, students can open the link and choose **Add to Home Screen** to get an app icon with your logo.

---

## Everyday use

**Start of the month** → Institute → **Fees** → tap **Paid** next to a student → check the amount
(e.g. 250,000) → **Mark as paid and create receipt**. The receipt (numbered `MZ-26-00001`, …) appears
straight away on the student's Home and Receipts pages. If you made a mistake, tap **Undo** or **Cancel this receipt**.

**Adding students from Excel** → Students → **Import from Excel** → *Download Excel template* (or use your own file).
Only a **Name** column is required. Recognised columns: *Name, Username, Password, Phone, Monthly fee, First month, Juz*.
Missing usernames are made from the name (`Hussein Ahmed` → `hussein.ahmed`); missing passwords use the
default password from **Settings**. After importing, **Download login list** gives you every username and password.

**Forgotten password** → open the student → **Reset password**. For staff: Settings → Institute accounts → Reset password.

**Settings** → institute name, currency (TSh, KSh, UGX…), the day fees are due, and the default password.

---

## Files

```
index.html  institute.html  student.html
css/        style.css, fonts.css
js/         config.js (your keys), core.js, institute.js, student.js
assets/     logo-qt.png (large), logo-qt-sm.png (screens), app icons
fonts/      Amiri, Figtree, IBM Plex Mono (bundled, no Google needed)
vendor/     supabase.js, xlsx.full.min.js (bundled)
supabase-setup.sql
```

---

## Update 2: what's new

**Already live with the first version?** Run `supabase-update-2.sql` once in the SQL Editor **before** uploading the new files.
It only adds to the database; existing students and receipts are kept. Students' juz are converted to pages (juz × 20); correct them under Progress if needed.

- **Name:** Qism al Tahfeez Dar es Salaam. New receipts are numbered `QT-26-…`.
- **Progress:** monthly goal (for one or everyone), **+1 Jadeed** (+3 keys), **Ikhtibar ✓** (+15), monthly goal reached (+10, automatic), Undo, total pages out of 604, rewards every 100 keys (Reward given).
- **Students see:** keys and next reward, a big "Reward unlocked" celebration, this month's goal, Qur'an progress bar (604 pages) with month-by-month chart, notices, fee reminders.
- **Student Hub** (was "Notices"): upload a Word file (.docx); every student can read it.
- **Excel import** reads: Admission No, Student Name, Program, Father/Husband Name, Date of Birth, Gender, Mobile No, ITS No, Email (any order, blanks fine). Username = ITS No. The ITS password column is ignored on purpose. Students fill in Father/Husband name, mobile and email themselves.
- **Disable** a student (cannot sign in, hidden from fees and progress, nothing deleted). **Enable** again any time.
- **Accounts:** Overview (income head, month or year, Excel download) · Income (sponsorships, donations) · Expenses (Electricity (LUKU), Snacks, Stationery, Travel, Internet, Water, Maintenance, Housing & Cleaning, Food Pantry, Mawaid, Awards & Gifts, Rehlat ilmi / Tafreeh, Workshops / Seminars, Sports Activities, Training, Other) · Fees (total amount, paid, balance due, reminders, discounts) · Receipts.
- **HR:** Teachers · Teacher ratings (Efficiency – Punctuality, Efficiency – Concentration, Listening, Teaching, Coaching, Attitude, Ownership) · Student feedback (students rate their teachers on the same 7 points from their portal; the institute sees averages and comments, not names) · Payroll (paid salaries count as expenses) · Attendance · Leave · Student ratings. Everything has Edit and Delete.

## Update 3: what's new

Run the **latest** `supabase-update-2.sql` again in the SQL Editor (it is safe to run more than once). It adds page goals, the monthly report, ikhtibar dates and notices with any file type.

- **Page goals:** each month has a *starting page*, a *goal page* and the *page reached* (e.g. on page 300, goal page 400 = 100 pages to complete). Set them for **any month**, past or present: Progress → **Report** (or open the student → *Monthly goal & report*). "Pages to add, everyone" sets goal page = current page + N for all. Reaching the goal page gives the goal keys automatically.
- **Monthly report** (students see it on Home): Ajza to be improved (tap juz 1–30), Ahkaam / Makharij to be improved, Murajaat completed, Dawrat completed, teacher's note. Students also get a *My months* history.
- **Ikhtibar dates:** Progress → **Schedule ikhtibar** (date, what it covers, which students). Students see the date and a countdown. On the day, open it and tap **Cleared** (+keys) or **Not cleared**; "Everyone waiting cleared" does the whole group in one tap. One student's ikhtibars are also in their sheet.
- **Faster fees:** on Fees, tick students (or "Tick all not paid") → **Mark paid**: a receipt is made for each at their monthly fee, and pops up in each student's portal. In a student's fee year you can tick several months and mark them paid together. Undo is offered after.
- **Notices:** type a message, attach any file (PDF, Word, PowerPoint, Excel, pictures, audio, video; up to 50 MB), or both. Pictures show inside the notice, PDFs open in one tap, other files download. Word files are still shown as text too.
- **Arabic:** typing Arabic in any box switches to right-to-left with the **Al Kanz** font (fonts/al-kanz-arabic.woff2, from the Al-Kanz font family by Lisan ud-Dawat; keep its credits if you share the site's files).

## Install as an app (phones and computers)

Once the site is online (it must be **https**, which Netlify, Vercel and GitHub Pages all give you):

- **Android / Chrome:** open `student.html` (or `institute.html`) and tap **Install** on the sign-in page, or Chrome menu → **Install app**. The app *QT Student* or *QT Institute* appears on the home screen with the logo.
- **iPhone / iPad:** open the link in **Safari** → **Share** → **Add to Home Screen**.
- **Computer:** Chrome or Edge shows an install icon in the address bar.

The app opens full screen, starts fast, and still opens when the internet is weak (fees and receipts need a connection to update).
When you change the website files later, also change the version at the top of `sw.js` (e.g. `qt-v12` to `qt-v13`) so every phone picks up the new version.

## Your own key rules

Settings → **Your own key rules**: add anything with a number of keys, e.g. *Discipline +5*, *Helping others +5*, *Late to class −2* (a minus takes keys away; keys never go below 0). Untick **In use** to hide a rule without deleting it.
Give them from **Progress → Give keys** (tick one student, many or everyone), the **Keys** button on a student's row, or **Give keys** inside the student's page. The student sees the keys, the reason and your note straight away, and the rules list on their keys card. Every entry can be undone. Run the latest `supabase-update-2.sql` once more to add this to the database.

## Ikhtibar tab, leaderboard, report cards, certificates

- **Ikhtibar tab:** every ikhtibar in one place. Filter Upcoming / Result needed / Done / Cancelled / All, search by student or title. **Reschedule** moves it to a new date for everyone still waiting (with an optional note), **Cancel** cancels it (students see "Cancelled"), **Restore** brings it back, **Students / Mark results** opens the list to mark Cleared or Not cleared.
- **Leaderboard:** students see the top 10 key earners of the month on their Home page, first names only, with their own place even if they are not in the top 10.
- **Report cards:** Progress → **Report cards (PDF)** for everyone or chosen students, or **Report card (PDF)** in a student's monthly report. One A4 page each: pages and goal, the teacher's report, ikhtibar, keys and fees, with signature lines. In the print window choose **Save as PDF** or print. Students can also print their own from Home.
- **Hifz certificates:** made automatically from the page a student is on (Juz 1 ends on page 21, then every 20 pages, the whole Qur'an at 604). The student's page shows a certificate for every juz completed; teachers get a "Certificate" button when a student finishes a juz, and students get a celebration with "View my certificate". A4 landscape with your logo, ready to print.

Run the latest `supabase-update-2.sql` once more for the leaderboard and ikhtibar cancelling.

## Surah and page (students who start from An-Nas too)

Two things are kept apart, so it works whichever way a student memorises:

- **Where the student is:** surah + page in the mushaf (e.g. *Al-Mulk · page 562*). Type the surah name (Mulk, Maryam, Yasin, or Arabic) or its number; the page fills in with the surah's first page and you can change it.
- **How much is memorised:** a count of pages (0–604), in any order. Progress bars, monthly goals, keys and certificates use this count.

In a student's **Monthly goal & report** enter *Started at*, *Goal* and *Reached* (surah + page). *Pages to memorise* and *Pages memorised this month* fill in by themselves from the pages typed, and you can change them. **Update where the student is** (in the student's page) sets *Now at* and the total pages memorised.
Certificates are given for every juz worth of pages memorised (about 20 pages): "has memorised 5 ajza".
Run the latest `supabase-update-2.sql` once more to add the surah and page columns.

## Design and security

- **Design:** inspired by Fatimid Cairo: keel arches and the fluted shell hood of al-Aqmar, crenellations, eight-pointed stars, tiraz bands and golden lustre on ivory. All ornament is vector (SVG/CSS), so it stays sharp on any screen, including 4K/8K displays. The theme lives in `css/fatimid.css`.
- **Security:**
  - Every page carries a strict Content-Security-Policy (only this site's own scripts can run; data goes only to your Supabase project).
  - `_headers` adds the same protections on Netlify, plus HTTPS-only (HSTS), no framing (clickjacking), no MIME sniffing, no referrer, and no camera/microphone/location access. On another host, copy these headers into its settings.
  - The database enforces who can see what: students only ever see their own records, staff-only functions check the institute role, and teacher feedback stays anonymous.
  - Never put the Supabase `service_role` key in the site.

## Night mode and finishing touches

- **Night mode:** deep indigo and gold. *Automatic* follows the phone or computer; anyone can choose Day or Night with the moon/sun button (top bar, student header, landing page) or under Settings → Appearance (institute) / My account → Appearance (student). Saved per device.
- **Receipts:** marble with a gilt keel-arch frame, a gold "QT" seal and a red "PAID" stamp, on screen and in the saved image.
- **Keys:** when new keys arrive the number counts up with a gold shimmer; rewards open a gift box.
- **Students tab:** on wide screens students appear as arch-framed cards; on phones as a list.
- **Welcome:** the installed app opens with the arch drawing itself and the logo appearing (once per opening).
- **Fatimid detail:** a muqarnas frieze under the top bar and a fine carved-stone grain on cards.
- **Security:** the Sign in button only works once the page has fully loaded, so a password can never end up in the address bar.

## Staff accounts: Admin, Teacher, Accounts

Settings → **Institute accounts** (admin only). Pick a role when you create an account, and change it any time from the list.

| Role | Sees and manages | Cannot |
|---|---|---|
| **Admin** | Everything | — |
| **Teacher** | Progress, Ikhtibar, Students (hifz, monthly report, certificates, report cards without fees), Notices, giving keys | See or change fees, receipts, accounts, HR, settings; add or remove students |
| **Accounts** | Fees (paid / not paid by month, tick to pay, receipts), Accounts → Fees and Receipts, students' fees and discounts, reminders | See or change hifz, ikhtibar, keys, HR, settings |

The database enforces this (row-level security and checked functions), so it holds even if someone tampers with the website.
Staff passwords must be **at least 10 characters with letters and numbers** (new accounts and password resets).
Run the latest `supabase-update-2.sql` once more to turn this on; existing staff accounts stay **Admin** until you change them.

## October update

**View-only accounts.** In Settings → Institute accounts, choose **View only**. That person can open Accounts, HR, Progress, Ikhtibar and Reports, but every add, change and delete button is hidden and blocked. The database blocks them too. Demo login: `viewer.office` / `viewer2026`.

**Teacher profiles (HR → Teachers).** Each teacher record has:
- ITS no
- sanad year
- Tadreeb al Huffaz attended (Yes or No)
- email and phone
- a **Teacher login** link

When a record is linked to a teacher's login, that teacher gets a **My profile** tab. There they edit their own ITS, full name, email, sanad year, phone and Tadreeb al Huffaz. They never see the salary or the admin's notes. If a teacher saves their profile before you've linked one, a record is created and linked for them.

**Reports tab.**
- The **weekly report** (Monday to Sunday) is made automatically from jadeed, ikhtibar and keys.
- The **yearly report** shows every month's jadeed pages, goals reached and ikhtibar for each student.
- Both can be printed or saved as PDF.
- Students see **This week** and **My year** (printable) on their Home page.

**ITS password.** There's a new field in the student's Details, editable by the admin and by the student in "My details". Only those two can ever read it. It is kept in its own table that no other staff account can open.

**Ikhtibar pages.** In Settings → Ikhtibar pages, list the pages where ikhtibars happen (default 582, 542, 502, 101, 201, 301, 401, 501). You can also set the alert distance (default 20 pages) and your eLearning link. When a student's current page is within that distance before one of those pages, an alert appears:
- for the admin: in Progress, in Ikhtibar ("Ikhtibar ahead") and on the student's page
- for the student: on their Home page, with "Go to eLearning and check your ikhtibar history" and a button to eLearning

It works for students going forwards and for students going backwards from An-Nas.

**Goal predictor.** Shown on the student's Home page and on their page in the institute:
- when they will become a haafiz at **1 page a day** and at **½ page a day**, over 150 working days a year (you can change this in Settings)
- when they'll finish at the **monthly takhteet** pages set by the admin, and how many pages they'll have by December

**New enrollments.** Every student you add starts as a **New enrollment**. Students → **New enrollments** lists them. They move to the active students on their own when their first fee is approved, or when you press **Start classes now**.

**Welcome email.** When you add a student with an email address, the fee-instructions email is sent to them automatically. Edit the text in Settings → Welcome email, using {name} for the name and *stars* for bold.

Automatic sending needs a one-time setup:
1. Make a free account at resend.com, add and verify the domain `tahfeezdaressalaam.com`, and create an API key.
2. In Supabase → Edge Functions, deploy the function in `supabase/functions/send-welcome-email`. With the Supabase CLI, run `supabase functions deploy send-welcome-email`.
3. In Supabase → Edge Functions → Secrets, add `RESEND_API_KEY` (your key) and `MAIL_FROM`, for example `Tahfeez Daressalaam <admin@tahfeezdaressalaam.com>`.

Until then, the student's page has a **Welcome message** button. It shows the email and lets you send it from your own email app, on WhatsApp, or copy the text.

## Cashier accounts

Settings → Institute accounts → choose **Cashier**. A cashier can only:
- mark student fees paid (Cash or Bank) — these wait for admin approval,
- add income and add expenses, and see the list of what they entered.

They don't see totals, balances, the cash and bank books, reports, printing, discounts, HR or settings. They can cancel only their own payments that are still waiting. Demo login: `cashier.desk` / `cashier2026`.

## Imperial Lustre design

Headings use a geometric Kufic face (Reem Kufi). All other text (paragraphs, numbers, buttons and menus) uses Plus Jakarta Sans for easy reading, and Arabic text still uses Al Kanz. The colours are Lustre Gold #D4AF37 for buttons and accents, Warm Brass #A67C1E for icons and lines, Fatimid Ivory #F9F6F0 for the background, Cairo Stone #E6DFD3 for cards, and Deep Charcoal #1C1A17 for text. Gold-ruled dividers separate the sections. All the styling is in `css/imperial.css`; remove that one line from the three pages to go back to the previous look.

## Cash and Bank

**Recording a fee.** When you mark a student paid, tap **Cash** or **Bank** (Bank also covers M-Pesa and cheques). The receipt shows how they paid. When you tick several students at once, the same Cash/Bank choice sits next to the "Mark paid" button.

**Accounts → Cash** and **Accounts → Bank** are the two books:
- The big card shows the money in hand or in the bank right now.
- For the month or year you're viewing you see what was brought forward, money in, money out, and what is carried forward.
- Every line is listed with a running balance: student fees (with the student's name), other income, expenses, salaries and transfers.
- At the bottom is a table of which students paid in cash or in the bank, and how much.

**Moving money.** In Cash, press **Deposit cash into the bank** and enter the amount (for example 2,000,000). Cash goes down and Bank goes up. In Bank, press **Withdraw from the bank** to do the opposite. Press **Opening balance** once in each book to set what you had on the day you started.

**Income and expenses** also ask whether the money came into, or was paid from, Cash or Bank. Salaries count by how the payroll was paid.

Fees waiting for admin approval are not counted yet. The book shows them as "waiting".

**The Accounts person** can now also see and add Income and Expenses, and use the Cash and Bank books. They can see salary amounts (to keep the books right), but not the rest of HR.

**Print accounts** can print one month (for example only October), from one month to another (for example October to December), a whole year, or everything since each student joined.

## Breaks, total paid, printing the accounts, income by month

**Breaks (a student goes away and comes back).** Open the student → **Breaks** → choose the month they left and the month they come back. Leave "Back in" empty if you don't know yet, and add it later. Those months show as **On leave** everywhere: no fee is due, they are not counted as unpaid, and reminders skip them. The student sees "On leave" on their Home page and in their fees calendar. Admin and Accounts can add breaks.

**Total paid.** Each student shows **Paid in total** (all months since joining):
- on their card in Students
- in the Accounts → Fees table
- at the top of their fees in the student page, next to their balance, months on leave and anything waiting for approval

**Print accounts.** Use the **Print accounts** button on the Fees tab or in Accounts → Fees.
- Choose one month, a range of months, the year, or since joining.
- Choose all students or only those who owe.
- Print a summary table, one page per student with every month and receipt, or both.
- Choose **Save as PDF** in the print window to keep a file.

**Income by month.** Fees now count in the month they are **for**. September's fee paid in October shows under September (marked "late"), in Overview and in Income.

## Fee approval (Accounts → Admin → Student)

When the **Accounts** person marks a fee paid, the payment is **Waiting for approval**. The student does not see it yet.

- The admin sees a gold banner on the Fees tab with the number of payments, the total and the student names, plus a badge on the Fees tab.
- **Review** opens the list: each student's name, month, amount, method and who recorded it. Untick any you don't want, then **Approve**. Or press **Approve all** (tap twice).
- **Reject** removes the payment, and the month is unpaid again.
- Once approved, the receipt appears in the student's portal straight away.
- Payments the admin records are approved at once.
- Only payments need approval. Fee and discount changes by Accounts apply directly.
- The database enforces this too: Accounts cannot approve, and cannot delete or change a payment after approval.

Run `supabase-update-2.sql` again in Supabase to switch this on.

## Hosting on Vercel

`vercel.json` gives Vercel the same security settings as `_headers` does on Netlify. To update the site, upload the new folder again, or push it to GitHub if the project is connected. Your domain is **tahfeezdaressalaam.com**. In Vercel → your project → **Settings → Domains**, add `tahfeezdaressalaam.com` and `www.tahfeezdaressalaam.com`, then set the DNS records Vercel shows you at the place you bought the domain. HTTPS turns on by itself.

In Supabase → **Authentication → URL Configuration**, set the Site URL to `https://tahfeezdaressalaam.com`.

## App name

The installed app and the browser tab are both called **Tahfeez Daressalaam**. Inside the portal the institute name stays as it is. To get a matching web address, see "Go live" above (`tahfeez-daressalaam.netlify.app`, or your own domain). Phones that already installed the app may keep the old name until it is removed and installed again.

## Logo

The new logo (Qism Tahfeez al-Qur'an al-Kareem, Mahad al-Zahra, Dar es Salaam) is in `assets/logo-qt.png` (large, for receipts, report cards and certificates) and `assets/logo-qt-sm.png` (screens). The frame was redrawn as clean vector lines; the calligraphy comes from the image provided. For the sharpest print, replace these two files with a high-resolution original (PNG with a transparent background, same proportions).

## Email updates to any student

Open a student → **Email update** (under their name) to email them their fees (monthly fee, total paid, amount due and how to pay), Hifz progress (pages, this month's goal, keys, ikhtibar ahead) and the goal predictor. Tick what to include and add a note. The Students tab has **Email updates** to send the same to all active students with an email, or only those with fees due — each student gets their own figures.

Admin and accounts can send. It uses the same `send-welcome-email` Edge Function (kind `update`), so no extra setup. Resend's free plan sends up to 100 emails a day.

## October update (2)

Run `supabase-update-2.sql` again (safe to re-run). It adds:

- **Payment slips.** When you record a payment you can attach the bank slip, M-Pesa message or receipt (JPEG, PNG or PDF, up to 10 MB). Open, replace or remove it from the receipt. The student can open their own slips. Files go to a private Storage bucket, `payment-proofs`.
- **Program-wise view.** Students and Fees have a program filter. Students shows a tile for each program with its count, and Fees has a table of each program's month (expected, collected, paid, not paid).
- **Total received across all months.** This is shown in Accounts → Fees, by year, and follows the program filter.
- **New-notice alerts for students.** A popup the first time they open the portal after a notice, a banner on Home, the red count on Notices, and an optional phone or computer notification ("Turn on alerts" on the Notices page).
- **Roles tab (admin).** Each person's role, who they report to, and their responsibilities. A teacher linked to a login sees their own under My profile.
- **Goals tab (admin).** Yearly goals with an owner, a target date, progress and how often to follow up. Goals that are due a follow-up or past their date are flagged, counted on the tab and announced once a day. **Follow up** saves what was done and sets the next date. **Remind** sends the owner a WhatsApp message or email.
- **Praise badges.** The admin and teachers award them from a student's page (10 kinds, or a custom title). The student gets a popup and sees them under My badges.
- **Mastership badge.** Given automatically for every 100 keys. It shows on Students cards, Progress rows, the Reports tables, the student's page and the student portal.

## October update (3)

Run `supabase-update-2.sql` again (safe to re-run).

- **Teacher Mastership badge (HR → Teachers).** Given automatically for every month the institute rates a teacher 4 or 5 stars in all 7 categories. It shows in the Teachers table with the latest month and remark, in Teacher ratings, and on the teacher's My profile.
- **Schedule tab.** The admin, and teachers marked "Can make schedules: Yes" in HR → Teachers, allocate students to teachers in time slots for one day, every day of a week, or chosen days. They can edit or cancel slots and copy a week to the next one. Double bookings (the same student or teacher at overlapping times) are refused. Each slot shows whether the student has opened it.
  - **Teachers** get a count on the Schedule tab and a notice when students are allocated to them, and see their own slots.
  - **Students** get a popup the next time they open the portal, a "My schedule" card on Home, and an optional phone/computer notification.
  - **Hand over by drag and drop.** In the Day view every teacher has a lane. Drag a student's card onto another teacher to hand them over; on a phone, press and hold the card first. While dragging, free teachers glow gold and teachers who are busy at that time turn red. A toast offers Undo.
  - **"I can't come".** A teacher's own lane has a button that lists that day's students, each with a choice of free teacher (or "give everyone to…"), so for example two students go to one teacher and three to another in one step.
  - **Who can change the schedule** is set per teacher in HR → Teachers → "Schedule permission":
    - **No** (default): the teacher sees only their own students and cannot change anything.
    - **Drag and drop only**: the teacher sees the whole schedule and can move any student between teachers (drag and drop, or "Hand over"), but cannot add, edit or cancel slots.
    - **Yes**: everything, including allocating, editing, cancelling and copying weeks.
  - The admin can always do everything. The new teacher and the student are told, and the slot shows "from (previous teacher)".
- **Home page intro.** An illuminated 3D Qur'an opens with golden light, then reveals the 604 arch. It plays once per visit, can be skipped, and is not shown to people who ask for reduced motion. Add `?nointro` to the address to skip it.

## October update (4)

- **Schedule permission per teacher** (HR → Teachers → "Schedule permission"): **No** = sees only their own students, can't change anything; **Drag and drop only** = sees the whole schedule and can move students between teachers; **Yes** = can also allocate, edit and cancel.
- **Teacher logins are created automatically.** When the admin adds a teacher in HR → Teachers, a login is made at once. The username is the teacher's ITS number, or first.last name (titles like Mulla, Janab, Moallema left out). The password is the default set in Settings → Teacher logins (starts as `Tahfeez2026`; change it there). A card shows the details with Copy and WhatsApp buttons.
- Teachers already in HR without a login get a **Create login** button in their edit sheet.
- The first time anyone signs in with a password someone else set (a new teacher login, or after "Reset password"), they must choose their own before using the portal. Staff can also change their password any time (Settings → My password, or My profile for teachers).
- Run `supabase-update-2.sql` again after uploading this version.

## October update (5)

- **Teachers see only their own students.** A student belongs to a teacher when the admin ticks that teacher on the student (Students → open a student → Teachers), or when the student is in that teacher's Schedule from 14 days ago to 30 days ahead (for example after a hand-over). Progress, keys, ikhtibar, reports, badges and the Students list all follow this, and the database refuses changes to anyone else's student. The admin, accounts, cashier and view-only accounts are not affected. Students → "No teacher yet" shows who still needs a teacher.
- **Teacher alerts.** When students are allocated or handed over to a teacher, the teacher gets:
  - an email (to the email in HR → Teachers or their My profile), and
  - a phone notification, once they press "Turn on phone alerts" (My profile, or the banner on Schedule). On iPhone the portal must first be added to the Home Screen.
  - and the **student** gets an email with their teacher, day and time (or "Your teacher has changed" after a hand-over), if their email is in their details.
- Server side: the `notify-teacher` Edge Function (in `supabase/functions/notify-teacher`). It needs the secret `VAPID_PRIVATE_KEY` (Edge Functions → Secrets) for phone alerts; emails use the existing `RESEND_API_KEY` and `MAIL_FROM`. The matching public key is `VAPID_PUBLIC_KEY` in `js/config.js`.

## October update (6): Goal — "Add New Memorized Pages"

- **One routine action.** In a student's **Goal** (top of the student page), or straight from each row of **Progress**, type the student's **current page number** and tap **Add New Memorized Pages**. Everything else is worked out and saved: current page, reached, pages this month, cumulative pages, pages this year, remaining pages, goal progress, keys, and the Hifz & keys numbers.
- **Directions** (saved on each student, never guessed): **Forward** page 604 → 582, then page 1 → 581; **Reverse** page 604 → 502, then page 1 → 501. Going from page 502 to page 1 counts as continuing (+1 page). A student with no direction shows two buttons to set it.
- **No double counting.** Each entry checks the page it started from: a double tap, a second phone or a refresh cannot add the same pages twice. The same page again says "no new pages". A page behind the current one (or a jump of more than 40 pages) asks first, and a confirmed correction takes back only the keys given for the pages removed.
- **Months and years.** Each month's "Started at" is taken when the month's first entry is made and never changes. Correcting a past month's "Reached" moves the next month's "Started at" with it. "This year" runs from where the year's first month started to the latest page, so nothing is counted twice.
- Page numbers are shown as "Page 59"; totals as "59 pages".
- "Murajaat completed this month" is no longer shown in the monthly goal & report, the student portal or the report card.
- Running `supabase-update-2.sql` clears directions an earlier version had worked out by itself (once), so teachers set each student's direction the first time.


## October update (7): correcting goals, weekly timetable, monthly schedule

**Goal → ✎ Edit or delete (administrators only).** On a student's Goal, the admin can correct the
memorisation direction, *Started at*, the *Monthly goal* and the *Current page* (or *Reached* for a past
month). Corrections give no keys, take back keys for pages that were taken off, and work out the target
page, pages this month, remaining pages, yearly totals and the goal keys again. The admin can also delete
the monthly goal, the starting point (it goes back to where the month before ended) or a single page entry
(a memorisation record). Every delete asks first, and deleting an older entry warns that later totals and
reports change. Each change is kept in the *Change record* with the old value, the new value, who and when
(table `hifz_audit`). Teachers and students cannot do any of this; the database refuses it too.

**Schedule.** Three views of the same saved slots: Day (drag and drop as before), Week and Month.
- *Week* is a timetable from Monday to Sunday with the time slots as rows, the number of classes per day,
  students per day and for the week, and a "Teachers this week" table to open any teacher's timetable.
  On a phone it becomes one day under the other. It can be printed.
- *Month* is a calendar: busy days are darker, clashes are marked in red, and clicking a day shows its
  classes and each teacher's free times.
- Every allocation has an **Edit** button (admin and teachers with schedule permission "Yes"). You can
  change the student, the teacher, the date and the time. A double booking is shown while you type and the
  database refuses it. The student and the teacher are emailed and alerted; when the teacher changes, the
  old teacher is told the student was moved and the new teacher is told they have a new student.
  Cancelling, restoring and deleting a slot also tell everyone affected.

Run the latest `supabase-update-2.sql` and redeploy the `notify-teacher` function for these to work live.

**Student portal.** "Rate" is now "Feedback" for teachers and Musaideen (wording only).

**Target page = Started at + Monthly goal.** Counted in the student's direction: forward 201 + 5 → page 206;
reverse 590 + 5 → page 585, and 504 + 5 → page 3 (503, 502, then 1, 2, 3). The Goal tab shows the new target
while you type the goal (or, for the admin, the starting page), and the database works it out again on every
save (trigger `progress_goal_target`), so the target can never drift from Started at and the goal.

**Forward order changed (October 24).** Forward now means page 604 → 582, then page 1 → 581, as one sequence
(page 604 = 1 page memorised, page 582 = 23 pages, page 1 = 24 pages … page 581 = 604 pages). Reverse is unchanged
(604 → 502, then 1 → 501). When the SQL runs, each forward student keeps the page they are on and every page in their
history; only the number of pages memorised is counted again along the new order (recorded in the change record as
"Forward sequence"). Keys already given stay, and no page earns keys twice.

## October update (8): fees in the welcome email, teacher feedback in HR

**Welcome email.** The email now has a *Your Fees* section built from the student's saved record: program, monthly
fee and currency, discount (and the amount after it), a one-time registration fee if you set one (Settings → Welcome
email), the month fees start and the amount to pay now. Put `{fees}` in your message to choose where it goes; without
it, the section goes just before the payment instructions. If no monthly fee was entered, no amount is shown: the
email says the fee will be confirmed, and the portal flags the student ("Fee not entered: please verify").
Redeploy the `send-welcome-email` function for this to work.

**HR → Teacher ratings** explains what each of the seven ratings means (also shown in the rating form and to students).
**HR → Teacher feedback** shows every teacher with average ratings per category and overall, filtered by teacher and
period (month, last 3 or 6 months, whole year or chosen months). It lists who is consistently positive and who may need
support or training. Each teacher's profile (also from HR → Teachers → Feedback) shows students' anonymous averages
next to the institute's own ratings, month by month, areas needing improvement, strengths and written comments.

## October update (9): Reports rebuilt (weekly, monthly, yearly)

All three reports now use the same records and rules (`MZ.repWeek`, `MZ.repMonth`, `MZ.repYear` in `js/core.js`):
- **Started at / Reached**: the student's place in their own order (forward 604 → 582, then 1 → 581; reverse 604 → 502, then 1 → 501).
- **Pages memorised**: new pages in the period, never a page number subtracted from another, never counted twice.
- **Monthly**: goal, Started at, Target page, Reached, pages, goal reached or not, completion % and remaining, for any month; choose a
  student to see all 12 months.
- **Weekly**: from the page entries (corrections count as minus pages), anchored on the month's own Reached so it agrees with the monthly
  report. Weekly target = monthly goal × 7 ÷ days in the month.
- **Yearly**: every month of the year from the Monthly Reports; the year's pages are the sum of its months. Cells are highlighted when the
  goal is reached, with a legend (reached, in progress, not reached, no goal, no record).
What was wrong before: the weekly table counted an entry with 0 pages as 1 page and showed "NaN" in one column; the yearly table added up the
stored "jadeed" figures instead of the pages actually reached; there was no monthly report; "Gold" is now "Goal".

## October update (10): Schedule for any date, Notify buttons, My Feedback for teachers

**Schedule.** Day, Week, Month and **List** views of the same lessons. A date picker goes to any date (past or future);
quick buttons: Today, This week, Next week, This month, Custom range (List with From/To). Allocate a lesson on one date, several
dates you pick, or **every week** on chosen days until an end date (a weekly series). Every lesson has **Edit** (student, teacher,
date, time, remarks: the same record is updated), **Reschedule** (date and time only), **Cancel** (kept, marked cancelled),
**Restore** and **Delete** (asks twice). In a series you choose "only this lesson" or "this and every later lesson".
Copy schedule… copies a day or a week to any later dates, as many times as you like; clashes are skipped and listed.
Double bookings for a teacher or a student are refused with the reason. Every change is kept in the lesson's Change history
(table `schedule_history`).

**Emails.** After saving you choose: email the student and teacher(s) now, choose who to email, or send nothing.
Each lesson has **Notify Student / Teacher / Admin / All** with the status (Not sent, Sending, Sent, Failed) and a sent-history
(table `schedule_notifications`). Subjects: New Hifz Lesson Schedule, Hifz Lesson Schedule Updated, Hifz Lesson Rescheduled,
Hifz Lesson Cancelled. Missing email addresses are shown and skipped, never guessed. Set the admin address in Settings → Schedule emails.

**Teacher Portal → My Feedback.** Each teacher sees students' feedback about themselves only: overall stars, each of the seven
categories, month by month, and comments by month. No names; teachers cannot change or delete feedback. Refreshes every minute.

Run `sql-oct31.sql` (or the latest `supabase-update-2.sql`) and redeploy the `notify-teacher` function.

## November update (1): badges, Admin/HR feedback for teachers, easier allocation, bulk changes, timetable emails
Run the new part of the database update once: SQL Editor → paste **`sql-nov9.sql`** (or the whole latest `supabase-update-2.sql`, which is safe to run again) → **Run**. Then redeploy the **notify-teacher** Edge Function with the new `supabase/functions/notify-teacher/index.ts` (it now also sends timetables with a PDF copy).

- **Praise badges:** only *Excellent Ahkaam & Makharij* (was Beautiful Tajweed), *Strong Murajaat* and *Hard Worker* can be given. Badges already awarded (Star of the Week and the others) stay on each student's record. No stray colons after badge names.
- **Teacher Portal → My Feedback** has two tabs: *From students* (unchanged, anonymous) and *From Admin / HR* — every rating saved under HR → Teacher ratings for that teacher, with the date, the 7 category scores, *Appreciation*, *Areas to improve* and the comment. Read only; each teacher sees only their own. HR → Teacher ratings has two new optional boxes for Appreciation and Areas to improve.
- **Allocate a student** is now four steps: search a student, search a teacher (shows how many lessons they have that day and whether they are free), pick a date (quick buttons or the calendar), then a lesson length (15, 20, 30, 45, 60 or 90 min) and a start time. Free times are gold; clashing times are crossed out and cannot be chosen. The end time is worked out for you, and a summary (student, teacher, date, start, end, duration) is shown before **Save Schedule** / **Cancel**. Remarks and repeating lessons are under *More options*.
- **Bulk Edit Schedules:** choose a student, tick lessons (or Select All, upcoming or including past, any dates), tick exactly what to change (teacher, start time, length, move dates, remarks, status), review a before/after table with clash checks, then **Apply to All Selected Schedules**. Clashing lessons are never overwritten; you can apply only to the ones without clashes. Emails follow the usual "After saving" choice.
- **Delete All Schedules:** choose a student, see every lesson on every day, untick any to keep, confirm (student name and number shown) and delete in one go. Optionally emails the student and teacher(s) the upcoming lessons that were removed. The change history keeps a record.
- **Timetable emails** (Schedule → Timetable emails): pick a week or other dates, preview exactly what is sent (recipient name and email shown), then **Notify Students**, **Notify Teachers**, **Notify Admin**, **Notify All**, the ticked people, or one person. Each email is a proper table (students: their teacher; teachers: their students; admin: everyone) sorted by day and time, without cancelled lessons, with changed lessons marked, and a PDF copy attached. "Don't resend unchanged timetables" avoids duplicates; a changed timetable can be sent again. The notification history shows recipient, date, period and status. Nothing is sent automatically.
- **Print timetable:** Schedule → *Print timetable* (admin) or *Print my timetable* (teacher), and *Print this week's timetable* in the Student Portal — an A4 page whose headings repeat on every page; the print window can also save it as a PDF. The *Print Timetable* button in the email opens the portal at that spot.
- **Notices is now called Student Hub** in all portals (same posts, files and alerts).

## November update (2): teachers cannot change pages or past months
Run **`sql-nov16.sql`** once in the SQL Editor (also included at the end of `supabase-update-2.sql`).
- In the teacher login, the student's **Current page / Add New Memorized Pages**, **+1 Jadeed / Add pages**, and **Change to reverse/forward** are shown greyed out with a lock. Only the admin can change a student's pages or direction.
- **Monthly goal & report:** teachers can fill in this month and the coming months. Past months are shown locked (read only). The admin can still change any month.
- The database enforces the same rules, so they cannot be bypassed.

## November update (3): student attendance, program filters, HR search, terms, security, iPhone
Run **`sql-nov16b.sql`** once in the SQL Editor (also at the end of `supabase-update-2.sql`).
- **Attendance tab** (admin, teachers, view-only): mark Present / Late / Absent / Excused per student with one tap (saved at once), optional minutes late and a note, "mark the rest present". Teachers see only their students, for today and the last 7 days; the admin sees every student grouped by teacher, live, and can correct any day. Day sheet (A4) and month register (A4 landscape) print or save as PDF. Every change is logged.
- **Students → Download list** asks which program (or All programs) and downloads only those students, same Excel columns.
- **Reports** have a Program filter (weekly, monthly, yearly, and print).
- **HR** lists have a search box (teacher name, phone, email, ITS).
- **Terms and Privacy** page (`terms.html`), linked on the home page and both sign-in screens.
- **Security:** staff signed out after 30 minutes idle; RLS forced on every table; signed-out visitors have no table access; extra security headers.
- **iPhone:** payment slips open on top of the page; text boxes no longer zoom the page when tapped.

## November update (4): teachers can add pages again
Run **`sql-nov16c.sql`** once. Teachers can again use **+1 Jadeed page**, **Add pages** and **Current page no. → Add New Memorized Pages** for their own students; totals, goals and reports update as before. Still admin only: changing the memorisation direction and correcting a total. Past months stay locked for teachers.

## Update: Student Hub is admin only (Nov 16d)
Write a notice, Upload a file and Delete are admin only. Teachers (and students) can still read notices and open files. Enforced in the database (notices table and the notices storage bucket). Run `sql-teacher-fix.sql` once in the Supabase SQL editor.
