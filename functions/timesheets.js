// Root: functions/timesheets.js
// Version: 15.9 - Unmasked Google Calendar API Errors
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { db, getAuthorizedClient, google } = require("./config");
const {
    getValidationData,
    getCompanyCalendarData,
    getPublicHolidaysStrings,
    processInBatches
} = require("./utils");

// Safe Timestamp extraction
const Timestamp = admin.firestore.Timestamp;

// Robust Date Parser (Matches Client Logic)
const safeParseDate = (val) => {
    if (!val) return null;
    if (val.toDate && typeof val.toDate === 'function') return val.toDate();
    if (val instanceof Date) return val;
    if (val._seconds !== undefined) return new Date(val._seconds * 1000);

    if (typeof val === 'string') {
        const cleanVal = val.trim();
        // Handle DD/MM/YYYY (Common legacy format)
        if (cleanVal.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
            const [d, m, y] = cleanVal.split('/');
            // Treat as UTC midnight
            return new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d)));
        }
        // Handle YYYY-MM-DD (ISO)
        if (cleanVal.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return new Date(cleanVal);
        }
        // Fallback for other strings
        const d = new Date(val);
        if (!isNaN(d.getTime())) return d;
    }
    return null;
};

exports.validateTimesheets = functions.runWith({
    memory: '1GB',
    timeoutSeconds: 540
}).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");
    const { emails, startDate, endDate } = data;
    const { projectStatusMap, validTaskCodes } = await getValidationData();
    const startYear = new Date(startDate).getUTCFullYear();
    const endYear = new Date(endDate).getUTCFullYear();
    const { shutdowns } = await getCompanyCalendarData(startYear, endYear);
    const filterMin = new Date(startDate + "T00:00:00Z").getTime();
    const filterMax = new Date(endDate + "T23:59:59.999Z").getTime();
    const results = {};
    for (const email of emails) {
        try {
            const employeeQuery = await db.collection('employees').where('companyEmail', '==', email).limit(1).get();
            const empDoc = employeeQuery.docs[0];
            const empData = empDoc ? empDoc.data() : null;
            const emailLower = email.toLowerCase();
            const emailParts = emailLower.split('@');
            const localPart = emailParts[0];
            const domainPart = emailParts[1] || '';
            const variants = Array.from(new Set([email, emailLower, email.toUpperCase(), localPart.split('.').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('.') + (domainPart ? '@' + domainPart : '')]));
            const queryPromises = variants.map(v => db.collection('timesheet_entries').where('emailAddress', '==', v).get());
            const snapshots = await Promise.all(queryPromises);
            const docMap = new Map();
            snapshots.forEach(snap => snap.forEach(doc => docMap.set(doc.id, doc.data())));
            const loggedEntryIds = new Set();
            const loggedEntryTimes = new Set();
            const loggedEntriesFromDB = [];
            let loggedHoursTotal = 0;
            docMap.forEach((entry, id) => {
                const entryDate = safeParseDate(entry.date || entry.startTime);
                if (!entryDate) return;
                const ts = entryDate.getTime();
                if (ts >= filterMin && ts <= filterMax) {
                    loggedEntryIds.add(id);
                    if (entry.eventId) loggedEntryIds.add(entry.eventId);
                    const sTime = safeParseDate(entry.startTime);
                    if (sTime) loggedEntryTimes.add(sTime.getTime());
                    const formattedDate = `${String(entryDate.getUTCDate()).padStart(2, '0')}/${String(entryDate.getUTCMonth() + 1).padStart(2, '0')}/${entryDate.getUTCFullYear()}`;
                    loggedEntriesFromDB.push({ id, ...entry, date: formattedDate });
                    loggedHoursTotal += parseFloat(entry.duration) || 0;
                }
            });
            let expectedWorkHours = 0, leaveHours = 0, sickHours = 0;
            const publicHols = new Set();
            for (let y = startYear; y <= endYear; y++) getPublicHolidaysStrings(y).forEach(h => publicHols.add(h));
            let currentDay = new Date(startDate + "T12:00:00Z");
            const endLimit = new Date(endDate + "T12:00:00Z");
            while (currentDay <= endLimit) {
                const dayISO = currentDay.toISOString().split('T')[0];
                const dayOfWeek = currentDay.getUTCDay();
                const dKey = `${currentDay.getUTCMonth() + 1}-${currentDay.getUTCDate()}`;
                const ledger = empData?.leave?.[currentDay.getUTCFullYear()]?.[dKey];
                if (dayOfWeek !== 0 && dayOfWeek !== 6 && !publicHols.has(dayISO) && !shutdowns.has(dayISO)) {
                    if (ledger && ledger.status !== 'pending') {
                        const leaveAmt = ledger.hours === 4 ? 4 : 8;
                        expectedWorkHours += (8 - leaveAmt);
                        if (ledger.type === 'sick') sickHours += leaveAmt; else leaveHours += leaveAmt;
                    } else { expectedWorkHours += 8; }
                } else if (ledger?.type === 'work') { expectedWorkHours += 8; }
                currentDay.setUTCDate(currentDay.getUTCDate() + 1);
            }
            let calEvents = [];
            try {
                const authClient = await getAuthorizedClient(email);
                const calendar = google.calendar({ version: "v3", auth: authClient });
                const res = await calendar.events.list({ calendarId: 'primary', timeMin: new Date(startDate + "T00:00:00Z").toISOString(), timeMax: new Date(endDate + "T23:59:59.999Z").toISOString(), singleEvents: true, orderBy: "startTime" });
                calEvents = res.data.items || [];
            } catch (e) { console.error(`Calendar fetch error for ${email}:`, e); }
            const newEntries = [], incorrectEntries = [];
            const stdRegex = /^(\d{4})-(\w\/\w{4})(-.*)?$/;
            const miscRegex = /^0999-([A-Z0-9]+\/[A-Z0-9]+)-([A-Z0-9]+)(?:-(.*))?$/i;
            calEvents.forEach(evt => {
                const startObj = new Date(evt.start.dateTime || evt.start.date);
                if (loggedEntryIds.has(evt.id) || loggedEntryTimes.has(startObj.getTime())) return;
                const title = evt.summary || "";
                let error = null, pCode = null, tCode = null;
                if (title.startsWith('0999')) {
                    const m = title.match(miscRegex);
                    if (!m) error = 'Invalid 0999 Mask'; else { pCode = '0999'; tCode = m[1]; }
                } else {
                    const m = title.match(stdRegex);
                    if (!m) error = 'Invalid Format'; else { pCode = m[1]; tCode = m[2]; }
                }
                if (!error) {
                    if (!projectStatusMap[pCode]) error = 'Invalid Project Code';
                    else if (projectStatusMap[pCode] !== 'Active') error = 'Inactive Project';
                    else if (!validTaskCodes.has(tCode.toUpperCase())) error = 'Invalid Task Code';
                }
                const dateStr = `${String(startObj.getUTCDate()).padStart(2, '0')}/${String(startObj.getUTCMonth() + 1).padStart(2, '0')}/${startObj.getUTCFullYear()}`;
                const entry = { employee: email, date: dateStr, title, eventId: evt.id, startTime: startObj.toISOString(), endTime: (new Date(evt.end.dateTime || evt.end.date)).toISOString() };
                if (error) incorrectEntries.push({ ...entry, errorType: error }); else newEntries.push(entry);
            });
            results[email] = { summary: { expectedWorkHours, leaveHours, sickHours, loggedHours: loggedHoursTotal }, newEntries, incorrectEntries, loggedEntries: loggedEntriesFromDB, allCalendarEvents: calEvents.map(e => ({ id: e.id, summary: e.summary, start: e.start.dateTime || e.start.date, end: e.end.dateTime || e.end.date })) };
        } catch (e) {
            results[email] = { error: e.message, summary: { expectedWorkHours: 0, leaveHours: 0, sickHours: 0, loggedHours: 0 }, newEntries: [], incorrectEntries: [], loggedEntries: [], allCalendarEvents: [] };
        }
    }
    return { status: "success", results };
});

exports.getTimesheetCompletionStatus = functions.runWith({
    memory: '2GB',
    timeoutSeconds: 540
}).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");
    const { startDate, endDate } = data;
    const timeMin = new Date(startDate + "T00:00:00Z");
    const timeMax = new Date(endDate + "T23:59:59.999Z");
    try {
        const { shutdowns } = await getCompanyCalendarData(timeMin.getUTCFullYear(), timeMax.getUTCFullYear());
        const publicHols = getPublicHolidaysStrings(timeMin.getUTCFullYear());
        const empSnap = await db.collection('employees').get();
        const activeInPeriod = empSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(emp => {
            const s = safeParseDate(emp.startDate);
            const e = safeParseDate(emp.endDate);
            if (s && s > timeMax) return false;
            if (e && e < timeMin) return false;
            return true;
        });
        const entriesByEmail = {};

        // Dual Query Strategy
        const strStart = timeMin.toISOString().split('T')[0];
        const strEnd = timeMax.toISOString().split('T')[0];

        const [tsSnap, strSnap] = await Promise.all([
            db.collection('timesheet_entries')
                .where('date', '>=', Timestamp.fromDate(timeMin))
                .where('date', '<=', Timestamp.fromDate(timeMax))
                .get(),
            db.collection('timesheet_entries')
                .where('date', '>=', strStart)
                .where('date', '<=', strEnd)
                .get()
        ]);

        const processEntry = (doc) => {
            const d = doc.data();
            const dDate = safeParseDate(d.date || d.startTime);
            if (dDate && dDate >= timeMin && dDate <= timeMax) {
                const emailKey = (d.emailAddress || '').toLowerCase();
                if (!entriesByEmail[emailKey]) entriesByEmail[emailKey] = 0;
                entriesByEmail[emailKey] += parseFloat(d.duration) || 0;
            }
        };

        tsSnap.forEach(processEntry);
        strSnap.forEach(processEntry);

        const report = await processInBatches(activeInPeriod, 10, async (emp) => {
            let expected = 0, shutdownHrs = 0;
            const companyEmail = (emp.companyEmail || emp.workEmail || '').toLowerCase();
            const actual = entriesByEmail[companyEmail] || 0;
            let currentDay = new Date(startDate + "T12:00:00Z");
            const limitDay = new Date(endDate + "T12:00:00Z");
            const empS = safeParseDate(emp.startDate);
            const empE = safeParseDate(emp.endDate);
            while (currentDay <= limitDay) {
                if ((empS && empS > currentDay) || (empE && empE < currentDay)) { currentDay.setUTCDate(currentDay.getUTCDate() + 1); continue; }
                const dayISO = currentDay.toISOString().split('T')[0];
                const dayKey = `${currentDay.getUTCMonth() + 1}-${currentDay.getUTCDate()}`;
                const ledger = emp.leave?.[currentDay.getUTCFullYear()]?.[dayKey];
                if (!publicHols.has(dayISO)) {
                    if (shutdowns.has(dayISO)) {
                        if (ledger?.type === 'work') expected += 8; else shutdownHrs += 8;
                    } else if (currentDay.getUTCDay() !== 0 && currentDay.getUTCDay() !== 6) {
                        if (ledger && (ledger.status === 'approved' || !ledger.status)) expected += (8 - (ledger.hours === 4 ? 4 : 8));
                        else expected += 8;
                    }
                }
                currentDay.setUTCDate(currentDay.getUTCDate() + 1);
            }
            return {
                id: emp.id, name: `${emp.name} ${emp.surname}`, email: companyEmail,
                expectedHours: expected, loggedHours: actual, calendarTotalHours: actual,
                status: (actual + shutdownHrs) >= (expected + shutdownHrs - 0.5) ? 'Complete' : (actual > 0 ? 'Partial' : 'Missing')
            };
        });
        return { status: "success", report };
    } catch (error) { throw new functions.https.HttpsError("internal", error.message); }
});

// FIXED: getMonthlyReportData with Robust Date Parsing and ISO Strings
exports.getMonthlyReportData = functions.runWith({
    memory: '4GB',
    timeoutSeconds: 540
}).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

    try {
        console.log("[STEP 1] Starting Report Generation for:", data.month);

        if (!data.month || !data.month.includes('-')) throw new Error("Invalid month format. Expected YYYY-MM.");

        const [yearStr, monthStr] = data.month.split('-');
        const year = parseInt(yearStr);
        const monthIndex = parseInt(monthStr) - 1;

        if (isNaN(year) || isNaN(monthIndex)) throw new Error("Invalid year or month parsed.");

        const startOfMonth = new Date(Date.UTC(year, monthIndex, 1));
        const endOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59));

        console.log(`[STEP 2] Dates Calculated: Start ${startOfMonth.toISOString()}, End ${endOfMonth.toISOString()}`);

        // 2. Context Data
        const { shutdowns } = await getCompanyCalendarData(year, year);
        const publicHols = getPublicHolidaysStrings(year);
        console.log("[STEP 3] Calendar data fetched.");

        // 3. Build Weeks
        const weeks = [];
        let iter = new Date(startOfMonth);
        const day = iter.getUTCDay();
        const diff = day === 0 ? -6 : 1 - day;
        iter.setUTCDate(iter.getUTCDate() + diff);

        let safetyLoop = 0;
        while (iter <= endOfMonth && safetyLoop < 10) {
            safetyLoop++;
            const wStart = new Date(iter);
            const wEnd = new Date(iter);
            wEnd.setUTCDate(wEnd.getUTCDate() + 6);
            wEnd.setUTCHours(23, 59, 59);
            const label = `${wStart.getUTCDate()}/${wStart.getUTCMonth() + 1} - ${wEnd.getUTCDate()}/${wEnd.getUTCMonth() + 1}`;

            // Convert to ISO string to ensure safe transfer over the HTTPS Callable JSON payload
            weeks.push({ start: wStart.toISOString(), end: wEnd.toISOString(), label });

            iter.setUTCDate(iter.getUTCDate() + 7);
        }

        console.log(`[STEP 4] Generated ${weeks.length} weeks.`);
        if (weeks.length === 0) return { status: "success", report: [], weeks: [] };

        // 4. Employees
        const empSnap = await db.collection('employees').get();
        const activeInPeriod = empSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(emp => {
            const s = safeParseDate(emp.startDate);
            const e = safeParseDate(emp.endDate);
            if (s && s > endOfMonth) return false;
            if (e && e < startOfMonth) return false;
            return true;
        });

        console.log(`[STEP 5] Found ${activeInPeriod.length} active employees.`);

        // 5. Timesheet Entries - DUAL QUERY STRATEGY
        const bufferStart = new Date(weeks[0].start);
        const bufferEnd = new Date(weeks[weeks.length - 1].end);

        // Define string range for legacy data
        const strStart = bufferStart.toISOString().split('T')[0];
        const strEnd = bufferEnd.toISOString().split('T')[0];

        console.log(`[STEP 6] Querying timesheets: Buffer ${bufferStart.toISOString()} - ${bufferEnd.toISOString()}`);

        const entriesByEmail = {};

        try {
            // Parallel execution for speed
            const [tsSnap, strSnap] = await Promise.all([
                // Query 1: Timestamps
                db.collection('timesheet_entries')
                    .where('date', '>=', Timestamp.fromDate(bufferStart))
                    .where('date', '<=', Timestamp.fromDate(bufferEnd))
                    .get(),
                // Query 2: Strings
                db.collection('timesheet_entries')
                    .where('date', '>=', strStart)
                    .where('date', '<=', strEnd)
                    .get()
            ]);

            console.log(`[STEP 7] Fetched: ${tsSnap.size} (Timestamp) + ${strSnap.size} (String) entries.`);

            const processDoc = (doc) => {
                const d = doc.data();
                const dDate = safeParseDate(d.date || d.startTime);

                // Double check range because string query might include edge days due to timezone offset
                if (dDate && dDate >= bufferStart && dDate <= bufferEnd) {
                    const emailKey = (d.emailAddress || '').toLowerCase();
                    if (!entriesByEmail[emailKey]) entriesByEmail[emailKey] = [];
                    entriesByEmail[emailKey].push({ date: dDate, duration: parseFloat(d.duration) || 0 });
                }
            };

            tsSnap.forEach(processDoc);
            strSnap.forEach(processDoc);

        } catch (queryErr) {
            console.error("Query Error:", queryErr);
            throw new Error(`Database Query Failed. Check Logs. ${queryErr.message}`);
        }

        console.log("[STEP 8] Processing employee data...");

        // 6. Report Generation
        const report = activeInPeriod.map(emp => {
            const companyEmail = (emp.companyEmail || emp.workEmail || '').toLowerCase();
            const empEntries = entriesByEmail[companyEmail] || [];

            const weeklyStats = weeks.map(week => {
                let expected = 0, logged = 0, leave = 0, sick = 0, holiday = 0, shutdown = 0;
                let d = new Date(week.start);
                let dayLoop = 0;

                while (d <= new Date(week.end) && dayLoop < 8) {
                    dayLoop++;
                    if (d.getUTCMonth() === monthIndex) {
                        const dayISO = d.toISOString().split('T')[0];
                        const dayKey = `${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
                        const ledger = emp.leave?.[d.getUTCFullYear()]?.[dayKey];
                        const dayOfWeek = d.getUTCDay();

                        const daysLog = empEntries
                            .filter(e => e.date.toISOString().split('T')[0] === dayISO)
                            .reduce((sum, e) => sum + e.duration, 0);
                        logged += daysLog;

                        if (publicHols.has(dayISO)) { holiday += 8; }
                        else if (shutdowns.has(dayISO)) { if (ledger?.type === 'work') expected += 8; else shutdown += 8; }
                        else if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                            if (ledger && (ledger.status === 'approved' || !ledger.status)) {
                                const amt = ledger.hours === 4 ? 4 : 8;
                                if (ledger.type === 'sick') sick += amt; else leave += amt;
                                expected += (8 - amt);
                            } else { expected += 8; }
                        } else if (ledger?.type === 'work') { expected += 8; }
                    }
                    d.setUTCDate(d.getUTCDate() + 1);
                }
                return { expected, logged, leave, sick, holiday, shutdown };
            });

            const totals = weeklyStats.reduce((acc, w) => ({ expected: acc.expected + w.expected, logged: acc.logged + w.logged, leave: acc.leave + w.leave, sick: acc.sick + w.sick, other: acc.other + w.holiday + w.shutdown }), { expected: 0, logged: 0, leave: 0, sick: 0, other: 0 });
            let status = 'Missing';
            const totalRequired = totals.expected;
            if (totals.logged >= (totalRequired - 0.5) && totalRequired > 0) status = 'Complete';
            else if (totals.logged > 0) status = 'Partial';
            else if (totalRequired === 0) status = 'N/A';

            return { id: emp.id, name: `${emp.name} ${emp.surname}`, email: companyEmail, weeks: weeklyStats, totals, status };
        });

        console.log("[STEP 9] Sorting and returning...");
        report.sort((a, b) => a.name.localeCompare(b.name));
        return { status: "success", report, weeks };

    } catch (error) {
        console.error("CRITICAL REPORT ERROR:", error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});

exports.uploadTimesheetEntries = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");
    const batch = db.batch();
    const stdRegex = /^(\d{4})-(\w\/\w{4})(-.*)?$/;
    const miscRegex = /^0999-([A-Z0-9]+\/[A-Z0-9]+)-([A-Z0-9]+)(?:-(.*))?$/i;

    data.entries.forEach(entry => {
        let p, t, c, m;
        if (entry.title.startsWith('0999')) {
            m = entry.title.match(miscRegex);
            if (m) { p = '0999'; t = m[1]; c = m[3] ? `[${m[2]}] ${m[3]}` : `[${m[2]}]`; }
        } else {
            m = entry.title.match(stdRegex);
            if (m) { p = m[1]; t = m[2]; c = m[3] ? m[3].substring(1) : ''; }
        }

        if (p && t) {
            const start = new Date(entry.startTime);
            const end = new Date(entry.endTime);
            const utcDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));

            batch.set(db.collection('timesheet_entries').doc(entry.eventId), {
                emailAddress: entry.employee,
                project: p,
                task: t.toUpperCase(),
                comment: c || '',
                startTime: Timestamp.fromDate(start),
                endTime: Timestamp.fromDate(end),
                date: Timestamp.fromDate(utcDate),
                duration: parseFloat(((end - start) / 3600000).toFixed(2)),
                billingStatus: 'unbilled',
                eventId: entry.eventId
            });
        }
    });

    await batch.commit();
    return { status: "success" };
});

exports.deleteTimesheetEntry = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");
    await db.collection('timesheet_entries').doc(data.entryId).delete();
    return { status: "success" };
});