Attendance import first-week patch

Copy/overwrite these files into the root of your current canteen-app repo:

- public/app.js
- public/import.js

What changed:
- After CSV attendance import, the app selects the first ISO week that contains imported attendance.
- After monthly XLSX attendance roster import, the app selects the first ISO week that contains imported attendance.
- The attendance year/week dropdowns are rebuilt when the imported week is in a different year.
- The imported week is loaded back from Supabase before rendering, so the UI shows saved DB data, not only parsed local data.
- The app switches to the Docházka tab and scrolls to the attendance grid.

Validation performed:
- node --check passed for all project JavaScript files.
