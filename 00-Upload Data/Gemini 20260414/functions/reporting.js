// Root: functions/reporting.js
// Version: 9.2 - Implemented Deep Aggregation Fallback for Global Report
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { db } = require("./config");
const {
    calculateHourlyRateForDate,
    getApplicableSalaryRecord,
    calculateAnnualTotalCost,
    safePercent,
    isEmployeeActiveInPeriod,
    parseDateUTC,
    safeNumber
} = require("./financialUtils");
const { getCompanyCalendarData, getPublicHolidaysStrings } = require("./utils");

// ============================================================================
// 1. GENERATE FINANCIAL REPORT (Historical Hourly Rates)
// ============================================================================
exports.generateFinancialReport = functions.runWith({
    memory: '2GB',
    timeoutSeconds: 540
}).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

    try {
        console.log("Starting Financial Report Generation...");

        // 1. Fetch All Context Data
        const [overheadsSnap, effHoursSnap, employeesSnap, historySnap] = await Promise.all([
            db.collection('settings').doc('company_settings').collection('overhead_periods').orderBy('startDate', 'desc').get(),
            db.collection('settings').doc('company_settings').collection('effective_hours_periods').orderBy('startDate', 'desc').get(),
            db.collection('employees').get(),
            db.collectionGroup('salary_history').get()
        ]);

        const overheads = overheadsSnap.docs.map(d => ({
            id: d.id, ...d.data(),
            startDate: parseDateUTC(d.data().startDate)
        }));

        const effectiveHours = effHoursSnap.docs.map(d => ({
            id: d.id, ...d.data(),
            startDate: parseDateUTC(d.data().startDate)
        }));

        const employees = [];
        employeesSnap.forEach(doc => {
            const d = doc.data();
            employees.push({ id: doc.id, ...d, isActiveEmployee: d.isEmployed !== false });
        });

        const salaryHistories = {};
        historySnap.forEach(doc => {
            const pid = doc.ref.parent.parent.id;
            if (!salaryHistories[pid]) salaryHistories[pid] = [];
            salaryHistories[pid].push({
                ...doc.data(),
                effectiveDate: parseDateUTC(doc.data().effectiveDate)
            });
        });

        // 2. Determine Year Range
        const startYear = 2004;
        const endYear = new Date().getFullYear() + 1;
        const reportData = {};
        const denominators = {};

        // 3. Pre-calculate Denominators (Sum of Productivity/Billable)
        for (let y = startYear; y <= endYear; y++) {
            for (let m = 0; m < 12; m++) {
                const monthStart = new Date(Date.UTC(y, m, 1));
                const monthEnd = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59));
                const key = `${y}-${m}`;

                let sumProductivity = 0;
                let sumBillable = 0;
                let nonProdPool = 0;

                employees.forEach(emp => {
                    if (!isEmployeeActiveInPeriod(emp, monthStart, monthEnd)) return;
                    const hist = salaryHistories[emp.id];
                    const active = getApplicableSalaryRecord(hist, monthEnd);
                    if (active) {
                        const bill = safePercent(active.billablePercent);
                        if (bill > 0) sumProductivity += safePercent(active.productivityPercent);
                        sumBillable += bill;

                        const cost = calculateAnnualTotalCost(active) / 12;
                        if (active.addToNonProdPool !== false) {
                            nonProdPool += cost * (1 - (bill / 100));
                        }
                    }
                });
                denominators[key] = { sumProductivity, sumBillable, nonProdPool };
            }
        }

        // 4. Calculate Rates per Employee per Month
        for (let y = startYear; y <= endYear; y++) {
            const yearRows = [];

            employees.forEach(emp => {
                const hist = salaryHistories[emp.id];
                if (!hist) return;

                const yearStart = new Date(Date.UTC(y, 0, 1));
                const yearEnd = new Date(Date.UTC(y, 11, 31));
                if (!isEmployeeActiveInPeriod(emp, yearStart, yearEnd)) return;

                const row = {
                    id: emp.id,
                    name: `${emp.name} ${emp.surname}`,
                    isActiveEmployee: emp.isActiveEmployee,
                    months: []
                };

                for (let m = 0; m < 12; m++) {
                    const monthStart = new Date(Date.UTC(y, m, 1));
                    const monthEnd = new Date(Date.UTC(y, m + 1, 0));
                    const key = `${y}-${m}`;

                    if (!isEmployeeActiveInPeriod(emp, monthStart, monthEnd)) {
                        row.months.push({ value: 0, cost: 0, breakdown: null });
                        continue;
                    }

                    const activeRecord = getApplicableSalaryRecord(hist, monthEnd);
                    if (activeRecord) {
                        const result = calculateHourlyRateForDate(
                            monthEnd,
                            activeRecord,
                            effectiveHours,
                            overheads,
                            { [m]: denominators[key] }
                        );

                        const annualEffectiveHours = safeNumber(result.breakdown.effHours);
                        const monthlyEffectiveHours = annualEffectiveHours / 12;
                        const fullyLoadedMonthlyCost = result.totalRate * monthlyEffectiveHours;

                        row.months.push({
                            value: result.totalRate,
                            cost: fullyLoadedMonthlyCost,
                            breakdown: {
                                directRate: result.breakdown.directRate,
                                overheadRate: result.breakdown.overheadRate,
                                nonProdRate: result.breakdown.nonProdRate
                            }
                        });
                    } else {
                        row.months.push({ value: 0, cost: 0, breakdown: null });
                    }
                }
                yearRows.push(row);
            });

            yearRows.sort((a, b) => a.name.localeCompare(b.name));
            reportData[y] = yearRows;
        }

        // 5. Save Reports
        const batch = db.batch();

        // Meta Doc
        const metaRef = db.collection('reports').doc('financial_history_meta');
        batch.set(metaRef, {
            generatedAt: admin.firestore.Timestamp.now(),
            availableYears: Object.keys(reportData).map(Number)
        });

        // Yearly Docs
        for (const [year, rows] of Object.entries(reportData)) {
            const yearRef = db.collection('reports').doc(`financial_history_${year}`);
            batch.set(yearRef, { year: Number(year), rows });
        }

        await batch.commit();

        // Reset Stale Flag
        await db.collection('settings').doc('financial_status').set({ isStale: false }, { merge: true });

        return { status: "success", yearsProcessed: Object.keys(reportData).length };

    } catch (error) {
        console.error("Financial Report Gen Error:", error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});

// ============================================================================
// 2. GENERATE MONTHLY FINANCIAL REPORT
// ============================================================================
exports.generateMonthlyFinancialReport = functions.runWith({
    memory: '2GB',
    timeoutSeconds: 540
}).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

    const { month } = data; // Format: "YYYY-MM"
    if (!month) throw new functions.https.HttpsError("invalid-argument", "Month is required.");

    try {
        console.log(`Starting Monthly Financial Report for ${month}...`);

        const [yearStr, monthStr] = month.split('-');
        const year = parseInt(yearStr);
        const monthIndex = parseInt(monthStr) - 1; // 0-based

        // 1. Define Date Range (UTC Midnight)
        const startOfMonth = new Date(Date.UTC(year, monthIndex, 1));
        const endOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59));

        // Calendar Context
        const { shutdowns } = await getCompanyCalendarData(year, year);
        const publicHols = getPublicHolidaysStrings(year);

        // 2. Fetch Context Data
        const [overheadsSnap, effHoursSnap, employeesSnap, historySnap, projectsSnap] = await Promise.all([
            db.collection('settings').doc('company_settings').collection('overhead_periods').orderBy('startDate', 'desc').get(),
            db.collection('settings').doc('company_settings').collection('effective_hours_periods').orderBy('startDate', 'desc').get(),
            db.collection('employees').get(),
            db.collectionGroup('salary_history').get(),
            db.collection('projects').get()
        ]);

        // Process Context
        const overheads = overheadsSnap.docs.map(d => ({ id: d.id, ...d.data(), startDate: parseDateUTC(d.data().startDate) }));
        const effectiveHours = effHoursSnap.docs.map(d => ({ id: d.id, ...d.data(), startDate: parseDateUTC(d.data().startDate) }));

        const projectMap = {};
        projectsSnap.forEach(d => {
            const p = d.data();
            projectMap[String(p.projectNumber).padStart(4, '0')] = p.projectDescription || 'Unknown Project';
        });

        const empMap = {};
        const empNameMap = {};
        const employeesList = [];
        const empLeaveMap = {};

        employeesSnap.forEach(doc => {
            const d = doc.data();
            const email = (d.companyEmail || d.workEmail || '').toLowerCase();
            if (email) {
                empMap[email] = doc.id;
                empNameMap[email] = `${d.name} ${d.surname}`;
                empLeaveMap[email] = d.leave?.[year] || {};
            }
            employeesList.push({ id: doc.id, ...d, isActiveEmployee: d.isEmployed !== false });
        });

        const salaryHistories = {};
        historySnap.forEach(doc => {
            const pid = doc.ref.parent.parent.id;
            if (!salaryHistories[pid]) salaryHistories[pid] = [];
            salaryHistories[pid].push({ ...doc.data(), effectiveDate: parseDateUTC(doc.data().effectiveDate) });
        });

        // 3. Pre-calculate Denominators
        let sumProductivity = 0;
        let sumBillable = 0;
        let nonProdPool = 0;

        employeesList.forEach(emp => {
            if (!isEmployeeActiveInPeriod(emp, startOfMonth, endOfMonth)) return;
            const hist = salaryHistories[emp.id];
            const active = getApplicableSalaryRecord(hist, endOfMonth);
            if (active) {
                const bill = safePercent(active.billablePercent);
                if (bill > 0) sumProductivity += safePercent(active.productivityPercent);
                sumBillable += bill;
                const cost = calculateAnnualTotalCost(active) / 12;
                if (active.addToNonProdPool !== false) {
                    nonProdPool += cost * (1 - (bill / 100));
                }
            }
        });
        const poolData = { sumProductivity, sumBillable, nonProdPool };

        // 4. Fetch Timesheets
        const bufferStartStr = startOfMonth.toISOString().split('T')[0];
        const bufferEndStr = endOfMonth.toISOString().split('T')[0];

        const [tsSnapTimestamp, tsSnapString] = await Promise.all([
            db.collection('timesheet_entries')
                .where('date', '>=', admin.firestore.Timestamp.fromDate(startOfMonth))
                .where('date', '<=', admin.firestore.Timestamp.fromDate(endOfMonth))
                .get(),
            db.collection('timesheet_entries')
                .where('date', '>=', bufferStartStr)
                .where('date', '<=', bufferEndStr)
                .get()
        ]);

        const allEntries = new Map();
        const processDoc = (doc) => {
            const d = doc.data();
            const date = parseDateUTC(d.date || d.startTime);
            if (date && date >= startOfMonth && date <= endOfMonth) {
                allEntries.set(doc.id, { ...d, dateObj: date });
            }
        };
        tsSnapTimestamp.forEach(processDoc);
        tsSnapString.forEach(processDoc);

        // 5. Fetch Financial Documents & Aggregate
        const rfpsIssuedSnap = await db.collection('rfps')
            .where('issuedAt', '>=', admin.firestore.Timestamp.fromDate(startOfMonth))
            .where('issuedAt', '<=', admin.firestore.Timestamp.fromDate(endOfMonth))
            .get();

        let rfpValue = 0;
        rfpsIssuedSnap.forEach(doc => { rfpValue += (parseFloat(doc.data().totalAmount) || 0); });

        const invoiceSnap = await db.collection('rfps').where('invoicedAmount', '>', 0).get();
        let invoiceCount = 0;
        let invoiceValue = 0;

        invoiceSnap.forEach(doc => {
            const d = doc.data();
            if (d.payments) {
                Object.values(d.payments).forEach(p => {
                    const pDate = p.date?.toDate ? p.date.toDate() : new Date(p.date);
                    if (pDate >= startOfMonth && pDate <= endOfMonth) {
                        invoiceCount++;
                        invoiceValue += (parseFloat(p.amount) || 0);
                    }
                });
            }
        });

        const creditSnap = await db.collection('rfps').where('creditedAmount', '>', 0).get();
        let creditNoteCount = 0;
        let creditNoteValue = 0;

        creditSnap.forEach(doc => {
            const d = doc.data();
            if (d.credits) {
                Object.values(d.credits).forEach(c => {
                    const cDate = c.date?.toDate ? c.date.toDate() : new Date(c.date);
                    if (cDate >= startOfMonth && cDate <= endOfMonth) {
                        creditNoteCount++;
                        creditNoteValue += (parseFloat(c.amount) || 0);
                    }
                });
            }
        });

        const calculateUserExpectedHours = (email) => {
            let expected = 0;
            const ledger = empLeaveMap[email] || {};
            let currentDay = new Date(startOfMonth);
            while (currentDay <= endOfMonth) {
                const dayISO = currentDay.toISOString().split('T')[0];
                const dayKey = `${currentDay.getUTCMonth() + 1}-${currentDay.getUTCDate()}`;
                const dayOfWeek = currentDay.getUTCDay();
                const dayLedger = ledger[dayKey];
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                if (dayLedger?.type === 'work') {
                    expected += 8;
                } else if (isWeekend || publicHols.has(dayISO) || shutdowns.has(dayISO)) {
                    // Off
                } else {
                    if (dayLedger && (dayLedger.status === 'approved' || !dayLedger.status)) {
                        expected += (8 - (dayLedger.hours === 4 ? 4 : 8));
                    } else {
                        expected += 8;
                    }
                }
                currentDay.setUTCDate(currentDay.getUTCDate() + 1);
            }
            return expected;
        };

        const userSummary = {};
        const projectSummary = {};
        let totalHours = 0;
        let totalCost = 0;
        let totalBaseCost = 0;
        let totalOvertimeCost = 0;
        const rateCache = {};

        for (const entry of allEntries.values()) {
            const email = (entry.emailAddress || 'unknown').toLowerCase();
            const empId = empMap[email];
            const pNum = String(entry.project).padStart(4, '0');

            if (pNum === '2000') continue;

            const duration = parseFloat(entry.duration) || 0;
            let hourlyCost = 0;
            const cacheKey = `${email}_${month}`;

            if (rateCache[cacheKey]) {
                hourlyCost = rateCache[cacheKey];
            } else if (empId && salaryHistories[empId]) {
                const hist = salaryHistories[empId];
                const active = getApplicableSalaryRecord(hist, entry.dateObj);
                if (active) {
                    const res = calculateHourlyRateForDate(
                        entry.dateObj,
                        active,
                        effectiveHours,
                        overheads,
                        { [monthIndex]: poolData }
                    );
                    hourlyCost = res.totalRate;
                    rateCache[cacheKey] = hourlyCost;
                }
            }

            const entryCost = hourlyCost * duration;
            totalHours += duration;
            totalCost += entryCost;

            if (!userSummary[email]) {
                userSummary[email] = {
                    name: empNameMap[email] || email,
                    hours: 0,
                    cost: 0,
                    projects: new Set(),
                    breakdown: {},
                    expectedHours: calculateUserExpectedHours(email),
                    hourlyRate: hourlyCost
                };
            }
            if (userSummary[email].hourlyRate === 0 && hourlyCost > 0) userSummary[email].hourlyRate = hourlyCost;

            userSummary[email].hours += duration;
            userSummary[email].cost += entryCost;
            userSummary[email].projects.add(pNum);

            if (!userSummary[email].breakdown[pNum]) {
                userSummary[email].breakdown[pNum] = {
                    number: pNum,
                    name: projectMap[pNum] || `Project ${pNum}`,
                    hours: 0,
                    cost: 0
                };
            }
            userSummary[email].breakdown[pNum].hours += duration;
            userSummary[email].breakdown[pNum].cost += entryCost;

            if (!projectSummary[pNum]) {
                projectSummary[pNum] = {
                    number: pNum,
                    name: projectMap[pNum] || `Project ${pNum}`,
                    hours: 0,
                    cost: 0,
                    users: new Set()
                };
            }
            projectSummary[pNum].hours += duration;
            projectSummary[pNum].cost += entryCost;
            projectSummary[pNum].users.add(email);
        }

        Object.values(userSummary).forEach(user => {
            const rate = user.hourlyRate || 0;
            const expected = user.expectedHours || 0;
            const actual = user.hours || 0;
            const baseCost = expected * rate;
            let overtimeCost = 0;
            if (actual > expected) overtimeCost = (actual - expected) * rate;
            totalBaseCost += baseCost;
            totalOvertimeCost += overtimeCost;
        });

        const userArray = Object.values(userSummary).map(u => {
            const { projects, breakdown, hourlyRate, ...rest } = u;
            return {
                ...rest,
                projectCount: projects.size,
                breakdown: Object.values(breakdown).sort((a, b) => b.hours - a.hours)
            };
        }).sort((a, b) => b.cost - a.cost);

        const projectArray = Object.values(projectSummary).map(p => {
            const { users, ...rest } = p;
            return { ...rest, userCount: users.size };
        }).sort((a, b) => b.cost - a.cost);

        const reportId = `financial_summary_${year}_${String(monthIndex + 1).padStart(2, '0')}`;
        await db.collection('reports').doc(reportId).set({
            generatedAt: admin.firestore.Timestamp.now(),
            month: month,
            summary: {
                totalHours,
                totalCost,
                totalBaseCost,
                totalOvertimeCost,
                totalEmployees: userArray.length,
                totalProjects: projectArray.length,
                totalRFPsIssued: rfpsIssuedSnap.size,
                totalRFPsValue: rfpValue,
                totalInvoicesPaid: invoiceCount,
                totalInvoicesValue: invoiceValue,
                totalCreditNotes: creditNoteCount,
                totalCreditNotesValue: creditNoteValue
            },
            byUser: userArray,
            byProject: projectArray
        });

        return { status: "success", reportId };

    } catch (error) {
        console.error("Monthly Aggregation Error:", error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});

exports.generateDailyDashboard = functions.https.onRequest(async (req, res) => {
    try {
        const today = new Date();
        const currentYear = today.getFullYear();
        const dayKey = `${today.getMonth() + 1}-${today.getDate()}`;

        const staffQ = await db.collection('employees').where('isEmployed', '==', true).get();
        const staffOffToday = [];

        staffQ.forEach(doc => {
            const emp = doc.data();
            const leaveEntry = emp.leave?.[currentYear]?.[dayKey];

            if (leaveEntry && leaveEntry.type !== 'work') {
                staffOffToday.push({
                    id: doc.id,
                    name: `${emp.name} ${emp.surname}`,
                    type: leaveEntry.type === 'sick' ? 'Sick Leave' : 'Vacation',
                    duration: leaveEntry.hours === 4 ? 'Half Day' : 'Full Day',
                    status: leaveEntry.status || 'approved'
                });
            }
        });

        await db.collection('reports').doc('dashboard_daily').set({
            generatedAt: admin.firestore.Timestamp.now(),
            date: today.toISOString().split('T')[0],
            staffOffToday
        });

        if (res) res.json({ status: "success", count: staffOffToday.length });
    } catch (e) {
        console.error(e);
        if (res) res.status(500).send(e.message);
    }
});

// ============================================================================
// 4. GENERATE GLOBAL PROJECT REPORT (Aggregated Ledger - Actual Calculation)
// ============================================================================
exports.generateGlobalProjectReport = functions.runWith({
    memory: '2GB',
    timeoutSeconds: 540
}).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

    try {
        console.log("Starting Global Project Report Generation (Calculated)...");

        // 1. Fetch All Context Data (High Read Operation)
        const [projectsSnap, rfpsSnap, costsSnap, timesheetsSnap, overheadsSnap, effHoursSnap, employeesSnap, historySnap] = await Promise.all([
            db.collection('projects').get(),
            db.collection('rfps').get(),
            db.collection('project_costs').get(),
            db.collection('timesheet_entries').get(),
            db.collection('settings').doc('company_settings').collection('overhead_periods').get(),
            db.collection('settings').doc('company_settings').collection('effective_hours_periods').get(),
            db.collection('employees').get(),
            db.collectionGroup('salary_history').get()
        ]);

        // Process Settings & Context
        const overheads = overheadsSnap.docs.map(d => ({ id: d.id, ...d.data(), startDate: parseDateUTC(d.data().startDate) }));
        const effectiveHours = effHoursSnap.docs.map(d => ({ id: d.id, ...d.data(), startDate: parseDateUTC(d.data().startDate) }));

        const empMap = {}; // Email -> ID
        const employeesList = [];
        employeesSnap.forEach(d => {
            const e = d.data();
            employeesList.push({ id: d.id, ...e });
            if (e.companyEmail) empMap[e.companyEmail.toLowerCase()] = d.id;
            if (e.workEmail) empMap[e.workEmail.toLowerCase()] = d.id;
        });

        const salaryHistories = {};
        historySnap.forEach(d => {
            const pid = d.ref.parent.parent.id;
            if (!salaryHistories[pid]) salaryHistories[pid] = [];
            salaryHistories[pid].push({ ...d.data(), effectiveDate: parseDateUTC(d.data().effectiveDate) });
        });

        // 2. Identify Date Range for Pools (Denominators)
        const allDates = [];
        timesheetsSnap.forEach(d => {
            const date = parseDateUTC(d.data().date || d.data().startTime);
            if (date) allDates.push(date);
        });

        // Determine distinct months needed for calculation
        const relevantMonths = new Set();
        allDates.forEach(d => relevantMonths.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`));

        // Calculate Pools for relevant months
        const poolCache = {};
        relevantMonths.forEach(monthKey => {
            const [y, m] = monthKey.split('-').map(Number);
            const mStart = new Date(Date.UTC(y, m - 1, 1));
            const mEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59));

            let sumProd = 0, sumBill = 0, nonProdPool = 0;
            employeesList.forEach(emp => {
                if (!isEmployeeActiveInPeriod(emp, mStart, mEnd)) return;
                const hist = salaryHistories[emp.id];
                const active = getApplicableSalaryRecord(hist, mEnd);
                if (active) {
                    const bill = safePercent(active.billablePercent);
                    if (bill > 0) sumProd += safePercent(active.productivityPercent);
                    sumBill += bill;
                    const cost = calculateAnnualTotalCost(active) / 12;
                    if (active.addToNonProdPool !== false) nonProdPool += cost * (1 - (bill / 100));
                }
            });
            poolCache[monthKey] = { sumProductivity: sumProd, sumBillable: sumBill, nonProdPool };
        });

        const projectsMap = {};

        // 3. Process Projects (Base)
        projectsSnap.forEach(doc => {
            const d = doc.data();
            const pNum = String(d.projectNumber).padStart(4, '0');
            projectsMap[pNum] = {
                projectNumber: pNum,
                name: d.projectDescription || 'Unknown Project',
                status: d.status || 'Active',
                client: d.clientNumber || '',
                hours: 0,
                laborCostStored: 0, // Now calculated exact
                expenses: 0,
                rfpIssued: 0,
                invoiced: 0,
                credited: 0
            };
        });

        // 4. Process RFPs
        rfpsSnap.forEach(doc => {
            const r = doc.data();
            if (r.status === 'Superseded') return;

            const pNum = String(r.projectNumber).padStart(4, '0');

            if (!projectsMap[pNum]) {
                projectsMap[pNum] = {
                    projectNumber: pNum,
                    name: r.projectName || `Project ${pNum}`,
                    status: 'Unknown',
                    hours: 0, laborCostStored: 0, expenses: 0, rfpIssued: 0, invoiced: 0, credited: 0
                };
            }

            const gross = parseFloat(r.totalAmount) || (parseFloat(r.amount) * (r.vatApplicable ? 1.18 : 1)) || 0;

            // Deep Ledger Parsing for Total Amounts
            let inv = parseFloat(r.invoicedAmount) || 0;
            if (inv === 0 && r.payments) {
                Object.values(r.payments).forEach(p => inv += parseFloat(p.amount));
            }

            let cred = parseFloat(r.creditedAmount) || 0;
            if (cred === 0 && r.credits) {
                Object.values(r.credits).forEach(c => cred += parseFloat(c.amount));
            }

            projectsMap[pNum].rfpIssued += gross;
            projectsMap[pNum].invoiced += inv;
            projectsMap[pNum].credited += cred;
        });

        // 5. Process Costs
        costsSnap.forEach(doc => {
            const c = doc.data();
            const pNum = String(c.projectNumber).padStart(4, '0');

            if (projectsMap[pNum]) {
                projectsMap[pNum].expenses += (parseFloat(c.amount) || 0);
            }
        });

        // 6. Process Timesheets with Calculation
        const rateCache = {}; // Optimization: Cache rates per email+month

        timesheetsSnap.forEach(doc => {
            const t = doc.data();
            const pNum = String(t.project).padStart(4, '0');
            const email = (t.emailAddress || 'unknown').toLowerCase();
            const duration = parseFloat(t.duration) || 0;
            const date = parseDateUTC(t.date || t.startTime);

            if (projectsMap[pNum] && date) {
                projectsMap[pNum].hours += duration;

                let hourlyCost = 0;
                // If the timesheet has a hard-saved cost, prefer it (e.g. frozen rate)
                if (t.cost && parseFloat(t.cost) > 0) {
                    hourlyCost = parseFloat(t.cost) / duration; // deduce rate
                } else {
                    // Calculate dynamically
                    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    const cacheKey = `${email}_${monthKey}`;

                    if (rateCache[cacheKey] !== undefined) {
                        hourlyCost = rateCache[cacheKey];
                    } else {
                        const empId = empMap[email];
                        if (empId && salaryHistories[empId]) {
                            const hist = salaryHistories[empId];
                            const active = getApplicableSalaryRecord(hist, date);
                            if (active) {
                                const res = calculateHourlyRateForDate(
                                    date,
                                    active,
                                    effectiveHours,
                                    overheads,
                                    { [date.getMonth()]: poolCache[monthKey] }
                                );
                                hourlyCost = res.totalRate;
                                rateCache[cacheKey] = hourlyCost;
                            }
                        }
                    }
                }

                projectsMap[pNum].laborCostStored += (hourlyCost * duration);
            }
        });

        // Convert Map to Array
        const reportArray = Object.values(projectsMap).sort((a, b) =>
            parseInt(a.projectNumber) - parseInt(b.projectNumber)
        );

        // Save to Single Document
        await db.collection('reports').doc('global_project_financials').set({
            generatedAt: admin.firestore.Timestamp.now(),
            generatedBy: context.auth.token.email || 'system',
            projects: reportArray
        });

        return { status: "success", count: reportArray.length };

    } catch (error) {
        console.error("Global Report Gen Error:", error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});

// ============================================================================
// 11. GENERATE REVENUE REPORT (Optimized Server-Side Sharding)
// ============================================================================
exports.generateRevenueReport = functions.runWith({
    memory: '4GB',  // INCREASED MEMORY TO 4GB
    timeoutSeconds: 540 // MAX TIMEOUT
}).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

    try {
        console.log("Starting Revenue Report Generation (Sharded)...");

        // 1. Fetch All RFPs and Projects
        const [rfpsSnap, projectsSnap] = await Promise.all([
            db.collection('rfps')
                .select('projectNumber', 'issuer', 'status', 'issuedAt', 'createdAt', 'amount', 'totalAmount', 'vatApplicable', 'credits', 'creditedAmount', 'creditedAt', 'payments', 'invoicedAmount', 'paidAt', 'rfpNumber', 'rfpCode')
                .get(),
            db.collection('projects').select('projectNumber', 'projectDescription').get()
        ]);

        console.log(`Fetched ${rfpsSnap.size} RFPs and ${projectsSnap.size} Projects.`);

        // 2. Build Project Map (Number -> Description)
        const projectMap = {};
        projectsSnap.forEach(doc => {
            const d = doc.data();
            const pNum = String(d.projectNumber).padStart(4, '0');
            projectMap[pNum] = d.projectDescription || 'No Description';
        });

        const rfpData = [];
        const yearsSet = new Set();
        const issuersSet = new Set();

        rfpsSnap.forEach(doc => {
            const d = doc.data();

            // Basic Fields
            const issuer = d.issuer || 'Unknown';
            const project = String(d.projectNumber || '');
            const status = d.status;

            // Dates
            const issueDateObj = parseDateUTC(d.issuedAt || d.createdAt);
            const issueDate = issueDateObj ? issueDateObj.toISOString() : null;
            if (issueDateObj) yearsSet.add(issueDateObj.getFullYear());

            // Financials (Net Calculation)
            const divider = d.vatApplicable ? 1.18 : 1;
            let netAmount = parseFloat(d.amount);
            if (isNaN(netAmount)) netAmount = (parseFloat(d.totalAmount) || 0) / divider;

            // Credits
            const credits = [];
            if (d.credits) {
                Object.values(d.credits).forEach(c => {
                    const dateObj = parseDateUTC(c.date);
                    credits.push({
                        date: dateObj ? dateObj.toISOString() : null,
                        amount: (parseFloat(c.amount) || 0) / divider
                    });
                });
            } else if (d.creditedAmount > 0) {
                const dateObj = parseDateUTC(d.creditedAt || new Date());
                credits.push({
                    date: dateObj ? dateObj.toISOString() : null,
                    amount: (parseFloat(d.creditedAmount) || 0) / divider
                });
            }

            // Payments
            const payments = [];
            if (d.payments) {
                Object.values(d.payments).forEach(p => {
                    const dateObj = parseDateUTC(p.date);
                    if (dateObj) yearsSet.add(dateObj.getFullYear());
                    payments.push({
                        date: dateObj ? dateObj.toISOString() : null,
                        amount: (parseFloat(p.amount) || 0) / divider
                    });
                });
            } else if (d.invoicedAmount > 0) {
                const dateObj = parseDateUTC(d.paidAt || d.issuedAt);
                if (dateObj) yearsSet.add(dateObj.getFullYear());
                payments.push({
                    date: dateObj ? dateObj.toISOString() : null,
                    amount: (parseFloat(d.invoicedAmount) || 0) / divider
                });
            }

            if (issuer) issuersSet.add(issuer);

            rfpData.push({
                id: doc.id,
                rfpNumber: d.rfpNumber || d.rfpCode || 'PENDING',
                project,
                issuer,
                status,
                isSuperseded: status === 'Superseded',
                isPending: status === 'Pending',
                issueDate,
                netAmount,
                credits,
                payments
            });
        });

        // 3. Save Report - SHARDED STRATEGY
        const CHUNK_SIZE = 500;
        const shards = [];
        for (let i = 0; i < rfpData.length; i += CHUNK_SIZE) {
            shards.push(rfpData.slice(i, i + CHUNK_SIZE));
        }

        const meta = {
            generatedAt: admin.firestore.Timestamp.now(),
            availableYears: Array.from(yearsSet).sort((a, b) => b - a),
            availableIssuers: Array.from(issuersSet).sort(),
            projectMap,
            shardCount: shards.length,
            totalRecords: rfpData.length
        };

        console.log(`Saving revenue report: ${rfpData.length} records in ${shards.length} shards.`);

        const batch = db.batch();

        // Save Meta
        const metaRef = db.collection('reports').doc('revenue_comparison_meta');
        batch.set(metaRef, meta);

        // Save Shards
        shards.forEach((shardData, index) => {
            const shardRef = db.collection('reports').doc(`revenue_comparison_shard_${index}`);
            batch.set(shardRef, { items: shardData, index });
        });

        await batch.commit();
        console.log("Report saved successfully.");

        return { status: "success", count: rfpData.length, shards: shards.length };

    } catch (e) {
        console.error("Revenue Report Error:", e);
        throw new functions.https.HttpsError("internal", e.message);
    }
});