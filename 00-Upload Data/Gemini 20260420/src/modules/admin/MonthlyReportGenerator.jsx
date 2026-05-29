// Root: src/modules/admin/MonthlyReportGenerator.jsx
// Version: 4.2 - Added specific Monday-Sunday date ranges for each week and absolute week numbers
import React, { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, Timestamp, doc, getDoc } from 'firebase/firestore';

import {
    ArrowDownTrayIcon,
    TableCellsIcon,
    ArrowPathIcon,
    ExclamationTriangleIcon,
    BugAntIcon,
    ComputerDesktopIcon
} from '@heroicons/react/24/outline';

// --- INLINED FIREBASE INITIALIZATION ---
// This bypasses the "../../firebase.js" import error by getting the existing app instance
const app = getApp();
const db = getFirestore(app);
// Explicitly setting region to 'us-central1' to match your deployment
const functionsInstance = getFunctions(app, 'us-central1');
const getMonthlyReportDataFn = httpsCallable(functionsInstance, 'getMonthlyReportData');

// --- CLIENT SIDE HELPERS ---
const getEaster = (year) => {
    const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
    const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
};

const getPublicHolidaysStrings = (year) => {
    const holidays = new Set();
    const add = (month, day) => holidays.add(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    add(1, 1); add(2, 10); add(3, 19); add(3, 31); add(5, 1); add(6, 7);
    add(6, 29); add(8, 15); add(9, 8); add(9, 21); add(12, 8); add(12, 13); add(12, 25);
    const easterDate = getEaster(year);
    const goodFriday = new Date(easterDate);
    goodFriday.setDate(easterDate.getDate() - 2);
    add(goodFriday.getMonth() + 1, goodFriday.getDate());
    return holidays;
};

// Robust date parser
const safeParseDate = (val) => {
    if (!val) return null;
    if (val.toDate && typeof val.toDate === 'function') return val.toDate();
    if (val instanceof Date) return val;
    if (val.seconds) return new Date(val.seconds * 1000);

    if (typeof val === 'string') {
        const cleanVal = val.trim();
        if (cleanVal.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
            const [d, m, y] = cleanVal.split('/');
            return new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d)));
        }
        if (cleanVal.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return new Date(cleanVal);
        }
        const d = new Date(val);
        if (!isNaN(d.getTime())) return d;
    }
    return null;
};

// Calculate Absolute Week of the Year (ISO 8601)
const getAbsoluteWeekNumber = (dateInput) => {
    const date = safeParseDate(dateInput);
    if (!date) return '';
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7; // Convert Sunday (0) to 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Step to nearest Thursday
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
};

// Format Date Range (Mon - Sun)
const formatWeekRange = (startInput, endInput) => {
    const s = safeParseDate(startInput);
    const e = safeParseDate(endInput);
    if (!s || !e) return '';
    const format = (date) => `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
    return `${format(s)} - ${format(e)}`;
};

const MonthlyReportGenerator = () => {
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
    const [reportData, setReportData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [weeks, setWeeks] = useState([]);
    const [error, setError] = useState(null);
    const [debugLog, setDebugLog] = useState([]);
    const [generationSource, setGenerationSource] = useState(null);

    // Helper: Filter employees based on selected month
    const filterActiveEmployees = async (employeeList, year, monthIndex) => {
        const startOfMonth = new Date(Date.UTC(year, monthIndex, 1));
        const endOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59));

        const needsFetch = employeeList.some(e => e.startDate === undefined);
        let fullEmployeeMap = new Map();

        if (needsFetch) {
            const allEmployeesSnap = await getDocs(collection(db, 'employees'));
            allEmployeesSnap.docs.forEach(d => fullEmployeeMap.set(d.id, d.data()));
        } else {
            employeeList.forEach(e => fullEmployeeMap.set(e.id, e));
        }

        return employeeList.filter(emp => {
            const fullProfile = fullEmployeeMap.get(emp.id) || emp;
            const startDate = safeParseDate(fullProfile.startDate);
            const endDate = safeParseDate(fullProfile.endDate);

            // 1. Must have started on or before the end of this month
            if (startDate && startDate > endOfMonth) return false;

            // 2. If they have an end date, it must be on or after the start of this month
            if (endDate && endDate < startOfMonth) return false;

            return true;
        });
    };

    // --- CORE LOGIC: Client Generation (Fallback) ---
    const generateClientSide = async (targetMonth, logFn) => {
        const log = logFn || ((msg) => console.log(msg));
        log(`Starting Client Generation for ${targetMonth}...`);

        const [yearStr, monthStr] = targetMonth.split('-');
        const year = parseInt(yearStr);
        const monthIndex = parseInt(monthStr) - 1;

        const startOfMonth = new Date(Date.UTC(year, monthIndex, 1));
        const endOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59));

        // 1. Shutdowns
        const shutdownRef = doc(db, 'company_holidays', String(year));
        const shutdownSnap = await getDoc(shutdownRef);
        const shutdowns = new Set(shutdownSnap.exists() ? (shutdownSnap.data().shutdowns || []) : []);
        const publicHols = getPublicHolidaysStrings(year);

        // 2. Build Weeks
        const generatedWeeks = [];
        let iter = new Date(startOfMonth);
        const day = iter.getUTCDay(); // 0=Sun
        const diff = day === 0 ? -6 : 1 - day; // Adjust to Mon
        iter.setUTCDate(iter.getUTCDate() + diff);

        let safety = 0;
        while (iter <= endOfMonth && safety < 10) {
            safety++;
            const wStart = new Date(iter);
            const wEnd = new Date(iter);
            wEnd.setUTCDate(wEnd.getUTCDate() + 6);
            wEnd.setUTCHours(23, 59, 59);
            generatedWeeks.push({ start: wStart, end: wEnd, label: formatWeekRange(wStart, wEnd) });
            iter.setUTCDate(iter.getUTCDate() + 7);
        }

        // 3. Fetch Entries
        const bufferStart = generatedWeeks[0].start;
        const bufferEnd = generatedWeeks[generatedWeeks.length - 1].end;

        const stringStart = bufferStart.toISOString().split('T')[0];
        const stringEnd = bufferEnd.toISOString().split('T')[0];

        const [tsSnap, strSnap] = await Promise.all([
            getDocs(query(collection(db, 'timesheet_entries'), where('date', '>=', Timestamp.fromDate(bufferStart)), where('date', '<=', Timestamp.fromDate(bufferEnd)))),
            getDocs(query(collection(db, 'timesheet_entries'), where('date', '>=', stringStart), where('date', '<=', stringEnd)))
        ]);

        const entriesByEmail = {};
        const processDoc = (d) => {
            const data = d.data();
            const email = (data.emailAddress || '').toLowerCase();
            const dateVal = safeParseDate(data.date || data.startTime);
            if (dateVal && dateVal >= bufferStart && dateVal <= bufferEnd) {
                if (!entriesByEmail[email]) entriesByEmail[email] = [];
                if (!entriesByEmail[email].some(e => e.id === d.id)) {
                    entriesByEmail[email].push({ id: d.id, date: dateVal, duration: parseFloat(data.duration) || 0 });
                }
            }
        };
        tsSnap.forEach(processDoc);
        strSnap.forEach(processDoc);

        // 4. Employees
        const empSnap = await getDocs(collection(db, 'employees'));
        let employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Filter locally
        employees = await filterActiveEmployees(employees, year, monthIndex);

        // 5. Build Report
        const report = employees.map(emp => {
            const email = (emp.companyEmail || emp.workEmail || '').toLowerCase();
            const empEntries = entriesByEmail[email] || [];

            const weeklyStats = generatedWeeks.map(week => {
                let expected = 0, logged = 0, leave = 0, sick = 0, holiday = 0, shutdown = 0;
                let d = new Date(week.start);
                let loop = 0;
                while (d <= week.end && loop < 8) {
                    loop++;
                    if (d.getUTCMonth() === monthIndex) {
                        const dayISO = d.toISOString().split('T')[0];
                        const dayKey = `${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
                        const dDay = d.getUTCDay();

                        const dailyLogs = empEntries.filter(e => e.date.toISOString().split('T')[0] === dayISO);
                        const dailySum = dailyLogs.reduce((acc, v) => acc + v.duration, 0);
                        logged += dailySum;

                        const ledger = emp.leave?.[year]?.[dayKey];

                        if (publicHols.has(dayISO)) holiday += 8;
                        else if (shutdowns.has(dayISO)) {
                            if (ledger?.type === 'work') expected += 8;
                            else shutdown += 8;
                        }
                        else if (dDay !== 0 && dDay !== 6) {
                            if (ledger) {
                                const amt = ledger.hours === 4 ? 4 : 8;
                                if (ledger.type === 'sick') sick += amt;
                                else leave += amt;
                                expected += (8 - amt);
                            } else {
                                expected += 8;
                            }
                        }
                    }
                    d.setUTCDate(d.getUTCDate() + 1);
                }
                return { expected, logged, leave, sick, holiday, shutdown };
            });

            const totals = weeklyStats.reduce((acc, w) => ({
                expected: acc.expected + w.expected,
                logged: acc.logged + w.logged,
                leave: acc.leave + w.leave,
                sick: acc.sick + w.sick
            }), { expected: 0, logged: 0, leave: 0, sick: 0 });

            let status = 'Missing';
            if (totals.logged >= totals.expected - 0.5 && totals.expected > 0) status = 'Complete';
            else if (totals.logged > 0) status = 'Partial';
            else if (totals.expected === 0) status = 'N/A';

            return { id: emp.id, name: `${emp.name} ${emp.surname}`, email, weeks: weeklyStats, totals, status };
        });

        report.sort((a, b) => a.name.localeCompare(b.name));
        return { report, weeks: generatedWeeks };
    };

    // --- HANDLER: SERVER with FAILOVER ---
    const handleGenerate = async () => {
        setLoading(true);
        setError(null);
        setReportData(null);
        setDebugLog([]);
        setGenerationSource('server');

        try {
            console.log("Calling getMonthlyReportData (Server)...");
            const result = await getMonthlyReportDataFn({ month });

            let rawReport = [];
            let resultWeeks = [];

            if (result.data.status === 'success') {
                rawReport = result.data.report || [];
                resultWeeks = result.data.weeks || [];
            }

            // --- FAILOVER CHECK ---
            if (rawReport.length === 0) {
                console.warn("Server returned 0 records. Falling back to Client Generation.");
                setError("Note: Server data was empty (deployment pending). Report generated using Client Logic.");
                setGenerationSource('client-fallback');

                // Fallback to client logic
                const clientResult = await generateClientSide(month);
                rawReport = clientResult.report;
                resultWeeks = clientResult.weeks;
            } else {
                // Post-Process Server Data (Filter & Sort)
                // This ensures "Active Only" filter works even if server logic is old
                const [yearStr, monthStr] = month.split('-');
                rawReport = await filterActiveEmployees(rawReport, parseInt(yearStr), parseInt(monthStr) - 1);
                rawReport.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            }

            setReportData(rawReport);
            setWeeks(resultWeeks);

        } catch (error) {
            console.error("Server Error:", error);
            // Fallback on crash too
            setError("Server Error. Falling back to Client Logic.");
            setGenerationSource('client-fallback');
            try {
                const clientResult = await generateClientSide(month);
                setReportData(clientResult.report);
                setWeeks(clientResult.weeks);
            } catch (clientErr) {
                setError(`Both Server and Client generation failed: ${clientErr.message}`);
            }
        } finally {
            setLoading(false);
        }
    };

    // --- HANDLER: EXPLICIT DEBUG ---
    const runClientDebug = async () => {
        setLoading(true);
        setGenerationSource('client-debug');
        const logs = [];
        const logFn = (msg) => {
            logs.push(msg);
            setDebugLog([...logs]);
        };

        try {
            const result = await generateClientSide(month, logFn);
            setReportData(result.report);
            setWeeks(result.weeks);
            logFn("Finished.");
        } catch (e) {
            logFn(`Error: ${e.message}`);
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleExportCSV = () => {
        if (!reportData || !weeks.length) return;

        let csvContent = "data:text/csv;charset=utf-8,";

        // Header Row 1
        let headerRow = "Employee,Email,";
        weeks.forEach((w) => {
            headerRow += `Week ${getAbsoluteWeekNumber(w.start)} (${formatWeekRange(w.start, w.end)}),,,,,`;
        });
        headerRow += "Total Expected,Total Logged,Total Leave,Total Sick,Status\n";

        // Header Row 2
        let subHeaderRow = ",,";
        weeks.forEach(() => {
            subHeaderRow += "Expected,Logged,Leave,Sick,Holiday/Shut,";
        });
        subHeaderRow += ",,,,\n";

        csvContent += headerRow + subHeaderRow;

        // Data Rows
        reportData.forEach(emp => {
            let row = `"${emp.name}","${emp.email}",`;

            weeks.forEach((_, index) => {
                const wData = emp.weeks[index] || {};
                const otherOff = (wData.holiday || 0) + (wData.shutdown || 0);
                row += `${wData.expected || 0},${wData.logged || 0},${wData.leave || 0},${wData.sick || 0},${otherOff},`;
            });

            row += `${emp.totals.expected},${emp.totals.logged},${emp.totals.leave},${emp.totals.sick},${emp.status}\n`;
            csvContent += row;
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Timesheet_Report_${month}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="space-y-6">
            {/* Control Bar */}
            <div className="flex flex-col sm:flex-row items-end gap-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Select Month</label>
                    <input
                        type="month"
                        value={month}
                        onChange={(e) => setMonth(e.target.value)}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    />
                </div>

                <button
                    onClick={handleGenerate}
                    disabled={loading}
                    className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm text-sm font-bold"
                >
                    {loading ? <ArrowPathIcon className="h-4 w-4 animate-spin mr-2" /> : <TableCellsIcon className="h-4 w-4 mr-2" />}
                    Generate Report
                </button>

                <button
                    onClick={runClientDebug}
                    disabled={loading}
                    className="flex items-center px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-800 disabled:opacity-50 transition-colors shadow-sm text-sm font-bold"
                    title="Runs the logic locally in your browser to inspect errors"
                >
                    <BugAntIcon className="h-4 w-4 mr-2" />
                    Debug Mode
                </button>

                {reportData && (
                    <button
                        onClick={handleExportCSV}
                        className="flex items-center px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors shadow-sm text-sm font-medium ml-auto"
                    >
                        <ArrowDownTrayIcon className="h-4 w-4 mr-2 text-green-600" />
                        Export CSV
                    </button>
                )}
            </div>

            {/* Status Bar */}
            {generationSource && !loading && (
                <div className={`text-xs px-3 py-1 rounded flex items-center gap-2 ${generationSource.includes('client') ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}`}>
                    {generationSource.includes('client') ? <ComputerDesktopIcon className="h-4 w-4" /> : <TableCellsIcon className="h-4 w-4" />}
                    Generated via {generationSource === 'server' ? 'Server Cloud Function' : 'Client-Side Logic (Fallback)'}
                </div>
            )}

            {/* Debug Console Output */}
            {debugLog.length > 0 && (
                <div className="bg-gray-900 text-green-400 p-4 rounded-md font-mono text-xs max-h-48 overflow-y-auto border border-gray-700 shadow-inner">
                    <p className="font-bold text-white border-b border-gray-700 pb-1 mb-2">Debug Output:</p>
                    {debugLog.map((line, i) => (
                        <div key={i}>{line}</div>
                    ))}
                </div>
            )}

            {/* Error State */}
            {error && (
                <div className="p-4 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded-md flex items-start">
                    <ExclamationTriangleIcon className="h-5 w-5 mr-2 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="font-bold">System Notice</p>
                        <p className="text-sm">{error}</p>
                    </div>
                </div>
            )}

            {/* Loading State */}
            {loading && !debugLog.length && (
                <div className="text-center py-12">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-50 border-t-indigo-500 mb-2"></div>
                    <p className="text-sm text-gray-500 font-medium">Crunching numbers...</p>
                </div>
            )}

            {/* Results Table */}
            {reportData && !loading && (
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-xs">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th rowSpan="2" className="px-3 py-3 text-left font-bold text-gray-700 bg-gray-50 sticky left-0 z-10 border-r">Employee</th>
                                    {weeks.map((w, i) => (
                                        <th key={i} colSpan="3" className="px-1 py-2 text-center font-bold text-gray-500 border-l border-gray-200 uppercase tracking-tight">
                                            Week {getAbsoluteWeekNumber(w.start)} <span className="text-[10px] font-normal lowercase block">{formatWeekRange(w.start, w.end)}</span>
                                        </th>
                                    ))}
                                    <th rowSpan="2" className="px-3 py-3 text-center font-bold text-gray-700 border-l border-gray-200 bg-gray-50">Status</th>
                                </tr>
                                <tr>
                                    {weeks.map((_, i) => (
                                        <React.Fragment key={`sub-${i}`}>
                                            <th className="px-1 py-1 text-center font-medium text-gray-400 border-l border-gray-100 bg-gray-50" title="Expected">Exp</th>
                                            <th className="px-1 py-1 text-center font-medium text-blue-600 bg-blue-50/30" title="Logged">Log</th>
                                            <th className="px-1 py-1 text-center font-medium text-red-400 bg-red-50/30" title="Off (Leave/Sick/Hol)">Off</th>
                                        </React.Fragment>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                                {reportData.map((emp) => (
                                    <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-3 py-2 font-medium text-gray-900 sticky left-0 bg-white border-r border-gray-100 whitespace-nowrap">
                                            {emp.name}
                                        </td>
                                        {weeks.map((_, i) => {
                                            const w = emp.weeks[i] || { expected: 0, logged: 0, leave: 0, sick: 0, holiday: 0, shutdown: 0 };
                                            const totalOff = (w.leave || 0) + (w.sick || 0) + (w.holiday || 0) + (w.shutdown || 0);
                                            const isMissing = w.logged < (w.expected - 0.1) && w.expected > 0;

                                            return (
                                                <React.Fragment key={`${emp.id}-w${i}`}>
                                                    <td className="px-1 py-2 text-center text-gray-400 border-l border-gray-100 font-mono">
                                                        {w.expected > 0 ? w.expected : '-'}
                                                    </td>
                                                    <td className={`px-1 py-2 text-center font-mono font-bold ${isMissing ? 'text-red-600 bg-red-50' : 'text-blue-600'}`}>
                                                        {w.logged > 0 ? w.logged.toFixed(1) : '-'}
                                                    </td>
                                                    <td className="px-1 py-2 text-center text-gray-500 font-mono text-[10px]">
                                                        {totalOff > 0 ? totalOff : '-'}
                                                    </td>
                                                </React.Fragment>
                                            );
                                        })}
                                        <td className="px-3 py-2 text-center border-l border-gray-200">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${emp.status === 'Complete' ? 'bg-green-100 text-green-700' :
                                                emp.status === 'Partial' ? 'bg-yellow-100 text-yellow-700' :
                                                    'bg-red-100 text-red-700'
                                                }`}>
                                                {emp.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MonthlyReportGenerator;