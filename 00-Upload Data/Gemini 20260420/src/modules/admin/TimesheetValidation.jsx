// File location: src/modules/admin/TimesheetValidation.jsx
// Version: 5.1 - Fixed Imports
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, onSnapshot, query, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '/src/firebase.js'; // Absolute Path
import {
    ChevronDownIcon, ChevronUpIcon,
    MagnifyingGlassIcon, ArrowPathIcon, ListBulletIcon,
    ChartBarIcon,
    UserIcon, WrenchScrewdriverIcon,
    TrashIcon,
    PencilSquareIcon,
    XMarkIcon,
    BarsArrowUpIcon,
    BarsArrowDownIcon,
    ClockIcon,
    CalendarIcon,
    DocumentChartBarIcon,
    TableCellsIcon
} from '@heroicons/react/24/solid';
import { getApp } from 'firebase/app';
import Modal from '/src/components/Modal.jsx'; // Absolute Path
import MonthlyReportGenerator from './MonthlyReportGenerator';

// Initialize functions locally
const functions = getFunctions(getApp());

const validateTimesheets = httpsCallable(functions, 'validateTimesheets');
const updateCalendarEvent = httpsCallable(functions, 'updateCalendarEvent');
const uploadTimesheetEntries = httpsCallable(functions, 'uploadTimesheetEntries');
const deleteTimesheetEntry = httpsCallable(functions, 'deleteTimesheetEntry');
const sendEmailNotification = httpsCallable(functions, 'sendEmailNotification');
const getTimesheetCompletionStatus = httpsCallable(functions, 'getTimesheetCompletionStatus');

// --- Helper: Calendar & Holidays ---
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

const publicHolidays = (year) => {
    const easterDate = getEaster(year);
    const goodFriday = new Date(easterDate);
    goodFriday.setDate(easterDate.getDate() - 2);

    const holidays = {
        '1-1': "New Year's Day", '2-10': "Feast of St. Paul's Shipwreck", '3-19': "Feast of St. Joseph",
        '3-31': "Freedom Day", [`${goodFriday.getMonth() + 1}-${goodFriday.getDate()}`]: "Good Friday",
        '5-1': "Worker's Day", '6-7': "Sette Giugno", '6-29': "Feast of St. Peter & St. Paul",
        '8-15': "Feast of the Assumption", '9-8': "Feast of Our Lady of Victories", '9-21': "Independence Day",
        '12-8': "Feast of the Immaculate Conception", '12-13': "Republic Day", '12-25': "Christmas Day",
    };
    return holidays;
};

// --- Helper: Overlap Check ---
const checkOverlaps = (entries) => {
    const sorted = [...entries].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    const overlaps = new Set();

    for (let i = 0; i < sorted.length; i++) {
        const current = sorted[i];
        const currentStart = new Date(current.startTime).getTime();
        const currentEnd = new Date(current.endTime).getTime();

        for (let j = i + 1; j < sorted.length; j++) {
            const next = sorted[j];
            const nextStart = new Date(next.startTime).getTime();

            if (nextStart >= currentEnd) break;

            overlaps.add(current.eventId);
            overlaps.add(next.eventId);
        }
    }
    return overlaps;
};

// --- Helper: Get Project Type ---
const getProjectType = (code, projectsMap) => {
    const proj = projectsMap[code];
    if (proj && proj.projectType) return proj.projectType;
    // Backward compatibility for legacy special codes if not in DB
    if (code === '0999') return 'misc';
    return 'standard';
};

// --- Helper: Clean Title (UPDATED) ---
const cleanEntryTitle = (rawTitle, projectsMap) => {
    if (!rawTitle) return rawTitle;

    // 1. Identify Project Code
    const projectMatch = rawTitle.match(/^\s*(\d{4})\s*-(.*)/);

    if (!projectMatch) {
        return rawTitle.replace(/\s+/g, '');
    }

    const projectCode = projectMatch[1];
    const remainder = projectMatch[2];
    const type = getProjectType(projectCode, projectsMap);

    // 2. Logic Branch based on Project Type
    if (type === 'misc') {
        // Enforce 4 Segments for MISC: CODE - DEPT/TASK - MISC0000 - Comment
        const specialRegex = /^\s*([A-Za-z0-9]+\s*\/\s*[A-Za-z0-9]+)\s*-\s*([A-Za-z0-9]+)(?:\s*-\s*(.*))?$/;
        const specialMatch = remainder.match(specialRegex);

        if (specialMatch) {
            const taskPart = specialMatch[1].replace(/\s+/g, '');
            const miscPart = specialMatch[2].replace(/\s+/g, '');
            const commentPart = specialMatch[3] ? specialMatch[3].trim() : '';
            return commentPart ? `${projectCode}-${taskPart}-${miscPart}-${commentPart}` : `${projectCode}-${taskPart}-${miscPart}`;
        }
        return rawTitle.replace(/\s+/g, '');

    } else {
        // Enforce 3 Segments for Standard: XXXX - DEPT/TASK - Comment
        const stdRemainderRegex = /^\s*([A-Za-z0-9]+\s*\/\s*[A-Za-z0-9]+)(?:\s*-\s*(.*))?$/;
        const stdMatch = remainder.match(stdRemainderRegex);

        if (stdMatch) {
            const taskPart = stdMatch[1].replace(/\s+/g, '');
            const commentPart = stdMatch[2] ? stdMatch[2].trim() : '';
            return commentPart ? `${projectCode}-${taskPart}-${commentPart}` : `${projectCode}-${taskPart}`;
        }

        const lastDashIndex = rawTitle.lastIndexOf('-');
        if (lastDashIndex === -1) return rawTitle.replace(/\s+/g, '');

        const prefix = rawTitle.substring(0, lastDashIndex);
        const comment = rawTitle.substring(lastDashIndex + 1);
        const cleanPrefix = prefix.replace(/\s+/g, '');
        const cleanComment = comment.trim();
        return `${cleanPrefix}-${cleanComment}`;
    }
};

// --- Helper: Validate Mask (UPDATED) ---
const isValidMask = (title, projectsMap) => {
    if (!title) return false;
    const projectMatch = title.match(/^(\d{4})-/);
    if (!projectMatch) return false;

    const projectCode = projectMatch[1];
    const type = getProjectType(projectCode, projectsMap);

    // Misc Special Mask
    if (type === 'misc') {
        const specialRegex = new RegExp(`^${projectCode}-[A-Z0-9]+\\/[A-Z0-9]+-[A-Z0-9]+(-.*)?$`, 'i');
        return specialRegex.test(title);
    }

    // Standard Mask
    const standardRegex = /^\d{4}-[A-Z0-9]+\/[A-Z0-9]+(-.*)?$/i;
    return standardRegex.test(title);
};

const getErrorTag = (errorType) => {
    switch (errorType) {
        case 'Invalid Format':
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">Invalid Format</span>;
        case 'Invalid 0999 Mask':
        case 'Invalid Misc Mask':
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800">Invalid Misc Mask</span>;
        case 'Invalid Project Code':
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">Bad Project Code</span>;
        case 'Inactive Project':
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">Inactive Project</span>;
        case 'Invalid Task Code':
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800">Bad Task Code</span>;
        case 'Access Error':
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">Access Error</span>;
        case 'Time Overlap':
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-orange-100 text-orange-800">Time Overlap</span>;
        default:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-50 text-red-600">{errorType || 'Unknown Error'}</span>;
    }
};

const CollapsibleSection = ({ title, count, children, rightContent, headerClass = '' }) => {
    const [isOpen, setIsOpen] = useState(true);
    if (!count || count === 0) return null;

    return (
        <div>
            <div className={`flex justify-between items-center mb-2 ${headerClass}`}>
                <button onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-2">
                    <h5 className="font-semibold">{title} ({count})</h5>
                    {isOpen ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
                </button>
                {isOpen && rightContent}
            </div>
            {isOpen && children}
        </div>
    );
};

const WeeklyBreakdown = ({ startDate, endDate, loggedEntries, newEntries, incorrectEntries, employeeProfile, shutdowns }) => {
    const weeks = useMemo(() => {
        const data = {};

        // Normalize Dates
        const sDate = new Date(startDate); sDate.setHours(0, 0, 0, 0);
        const eDate = new Date(endDate); eDate.setHours(23, 59, 59, 999);

        let current = new Date(sDate);

        // Helper to get holidays for a specific year
        const holidayCache = {};
        const getHolidays = (y) => {
            if (!holidayCache[y]) holidayCache[y] = publicHolidays(y);
            return holidayCache[y];
        };

        // 1. Build Weeks & Calculate Expected/Leave/Sick
        while (current <= eDate) {
            // Get Monday of the current week
            const d = new Date(current);
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(d);
            monday.setDate(diff);
            monday.setHours(0, 0, 0, 0);

            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);

            const weekKey = monday.toISOString().split('T')[0];

            if (!data[weekKey]) {
                data[weekKey] = {
                    start: new Date(monday),
                    label: `${monday.getDate()}/${monday.getMonth() + 1} - ${sunday.getDate()}/${sunday.getMonth() + 1}`,
                    expected: 0,
                    logged: 0,
                    newValid: 0,
                    error: 0,
                    leave: 0,
                    sick: 0
                };
            }

            // Daily Logic
            const dayStr = current.toISOString().split('T')[0];
            const y = current.getFullYear();
            const dKey = `${current.getMonth() + 1}-${current.getDate()}`;
            const hols = getHolidays(y);

            const isHol = !!hols[dKey];
            const isShut = shutdowns.includes(dayStr);
            const isWeekend = day === 0 || day === 6;

            // Ledger Lookup
            const ledger = employeeProfile?.leave?.[y]?.[dKey];

            // "Work" overrides shutdown/holiday/weekend
            if (ledger?.type === 'work') {
                data[weekKey].expected += 8;
            } else if (!isWeekend && !isHol && !isShut) {
                // Normal working day
                if (ledger && (ledger.status === 'approved' || !ledger.status)) {
                    const amt = ledger.hours === 4 ? 4 : 8;
                    if (ledger.type === 'sick') data[weekKey].sick += amt;
                    else data[weekKey].leave += amt;
                    data[weekKey].expected += (8 - amt);
                } else {
                    data[weekKey].expected += 8;
                }
            }

            current.setDate(current.getDate() + 1);
        }

        // 2. Aggregate Entries
        const processEntries = (list, field) => {
            if (!list) return;
            list.forEach(entry => {
                let duration = 0;

                // Duration Calculation
                if (entry.duration !== undefined && entry.duration !== '') {
                    duration = parseFloat(entry.duration);
                } else {
                    const s = new Date(entry.startTime);
                    const e = new Date(entry.endTime);
                    if (!isNaN(s) && !isNaN(e)) {
                        duration = (e - s) / (1000 * 60 * 60);
                    }
                }

                // Date determination
                let entryDate;
                if (typeof entry.date === 'string' && entry.date.includes('/')) {
                    const [dd, mm, yyyy] = entry.date.split('/');
                    entryDate = new Date(`${yyyy}-${mm}-${dd}`);
                } else if (entry.startTime) {
                    if (entry.startTime.toDate) entryDate = entry.startTime.toDate(); // Firestore Timestamp
                    else entryDate = new Date(entry.startTime); // ISO String
                } else {
                    entryDate = new Date(); // Fallback
                }

                // Map to Week
                if (!isNaN(entryDate)) {
                    const day = entryDate.getDay();
                    const diff = entryDate.getDate() - day + (day === 0 ? -6 : 1);
                    const monday = new Date(entryDate);
                    monday.setDate(diff);
                    monday.setHours(0, 0, 0, 0);
                    const weekKey = monday.toISOString().split('T')[0];

                    if (data[weekKey]) {
                        data[weekKey][field] += duration;
                    }
                }
            });
        };

        processEntries(loggedEntries, 'logged');
        processEntries(newEntries, 'newValid');
        processEntries(incorrectEntries, 'error');

        return Object.values(data).sort((a, b) => a.start - b.start);
    }, [startDate, endDate, loggedEntries, newEntries, incorrectEntries, employeeProfile, shutdowns]);

    return (
        <CollapsibleSection title="Weekly Summary" count={1} headerClass="text-gray-800 mt-4 border-t pt-4">
            <div className="overflow-x-auto border rounded-lg shadow-sm">
                <table className="min-w-full divide-y divide-gray-200 text-xs sm:text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-3 py-2 text-left font-bold text-gray-700">Week</th>
                            <th className="px-3 py-2 text-right font-bold text-gray-500">Expected</th>
                            <th className="px-3 py-2 text-right font-bold text-blue-700">Logged</th>
                            <th className="px-3 py-2 text-right font-bold text-green-700">New Valid</th>
                            <th className="px-3 py-2 text-right font-bold text-red-700">Error</th>
                            <th className="px-3 py-2 text-right font-bold text-purple-700">Leave</th>
                            <th className="px-3 py-2 text-right font-bold text-yellow-600">Sick</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {weeks.map((week, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                                <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-800">{week.label}</td>
                                <td className="px-3 py-2 text-right text-gray-600">{week.expected.toFixed(2)}h</td>
                                <td className="px-3 py-2 text-right font-medium text-blue-600">{week.logged.toFixed(2)}h</td>
                                <td className="px-3 py-2 text-right font-medium text-green-600">{week.newValid.toFixed(2)}h</td>
                                <td className="px-3 py-2 text-right font-medium text-red-600">{week.error.toFixed(2)}h</td>
                                <td className="px-3 py-2 text-right text-purple-600">{week.leave.toFixed(2)}h</td>
                                <td className="px-3 py-2 text-right text-yellow-600">{week.sick.toFixed(2)}h</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </CollapsibleSection>
    );
};

const CalendarPreview = ({ startDate, endDate, events, hoveredEventId, loggedEntries, incorrectEntries, projectsMap }) => {
    const scrollRef = useRef(null);
    const loggedEventIds = useMemo(() => new Set(loggedEntries.map(e => e.id || e.eventId)), [loggedEntries]);

    // Create a Set of Event IDs that are in the "Incorrect" list to ensure Red highlights trigger
    const incorrectEventIds = useMemo(() => {
        if (!incorrectEntries) return new Set();
        return new Set(incorrectEntries.map(e => e.eventId || e.id));
    }, [incorrectEntries]);

    const days = useMemo(() => {
        const rawStart = new Date(startDate + 'T00:00:00Z');
        const rawEnd = new Date(endDate + 'T00:00:00Z');
        const dayArray = [];
        let currentDate = new Date(rawStart);

        while (currentDate <= rawEnd) {
            dayArray.push(new Date(currentDate));
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        }
        return dayArray;
    }, [startDate, endDate]);

    const isVisualMode = days.length <= 7;

    useEffect(() => {
        if (isVisualMode && scrollRef.current) {
            scrollRef.current.scrollTop = 480;
        }
    }, [isVisualMode, startDate]);

    // MODE A: GRID REPLICA
    if (isVisualMode) {
        const hours = Array.from({ length: 24 }, (_, i) => i);
        const calculateEventPositions = (dayEvents) => {
            const sortedEvents = [...dayEvents].sort((a, b) => {
                const startA = new Date(a.start).getTime();
                const startB = new Date(b.start).getTime();
                if (startA !== startB) return startA - startB;
                const endA = new Date(a.end).getTime();
                const endB = new Date(b.end).getTime();
                return (endB - startB) - (endA - startA);
            });
            const columns = [];
            sortedEvents.forEach(event => {
                let placed = false;
                for (let i = 0; i < columns.length; i++) {
                    const col = columns[i];
                    const lastEventInCol = col[col.length - 1];
                    const lastEnd = new Date(lastEventInCol.end).getTime();
                    const currentStart = new Date(event.start).getTime();
                    if (currentStart >= lastEnd) {
                        col.push(event);
                        event.colIndex = i;
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    columns.push([event]);
                    event.colIndex = columns.length - 1;
                }
            });
            return sortedEvents.map(event => {
                const totalCols = columns.length;
                return {
                    ...event,
                    widthPercent: 100 / totalCols,
                    leftPercent: (event.colIndex * (100 / totalCols))
                };
            });
        };

        return (
            <div className="bg-white rounded-lg shadow-sm border h-full max-h-[80vh] flex flex-col">
                <h3 className="text-sm font-semibold text-gray-800 p-3 border-b text-center bg-gray-50 uppercase tracking-widest">Calendar Replica</h3>
                <div className="flex-1 flex flex-col overflow-hidden relative">
                    <div className="flex bg-gray-50 border-b border-gray-200 z-10 sticky top-0">
                        <div className="w-10 border-r border-gray-200 flex-shrink-0"></div>
                        <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
                            {days.map((day, idx) => (
                                <div key={day.toISOString()} className={`py-1 text-center ${idx < days.length - 1 ? 'border-r border-gray-200' : ''}`}>
                                    <div className="text-[10px] font-bold text-gray-500 uppercase">{day.toLocaleDateString('default', { weekday: 'short' })}</div>
                                    <div className="text-xs font-bold text-gray-700">{day.getUTCDate()}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div ref={scrollRef} className="flex-1 overflow-y-auto relative flex">
                        <div className="w-10 flex-shrink-0 bg-gray-50 border-r border-gray-200 select-none">
                            {hours.map(hour => (
                                <div key={hour} className="h-[60px] text-right pr-1 text-[10px] text-gray-400 relative">
                                    <span className="absolute -top-2 right-1">{hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`}</span>
                                </div>
                            ))}
                        </div>
                        <div className="flex-1 grid relative" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
                            <div className="absolute inset-0 pointer-events-none z-0">
                                {hours.map(hour => <div key={`line-${hour}`} className="h-[60px] border-b border-gray-100 w-full"></div>)}
                            </div>
                            {days.map((day, idx) => {
                                const dayEventsRaw = events.filter(e => {
                                    const eventDate = new Date(e.start);
                                    return eventDate.getUTCFullYear() === day.getUTCFullYear() &&
                                        eventDate.getUTCMonth() === day.getUTCMonth() &&
                                        eventDate.getUTCDate() === day.getUTCDate();
                                });
                                const positionedEvents = calculateEventPositions(dayEventsRaw);
                                return (
                                    <div key={day.toISOString()} className={`relative h-[1440px] ${idx < days.length - 1 ? 'border-r border-gray-100' : ''}`}>
                                        {positionedEvents.map(event => {
                                            const start = new Date(event.start);
                                            const end = new Date(event.end);
                                            const startHour = start.getHours() + (start.getMinutes() / 60);
                                            const endHour = end.getHours() + (end.getMinutes() / 60);
                                            const duration = endHour - startHour;

                                            const isLogged = loggedEventIds.has(event.id);
                                            const isIncorrect = incorrectEventIds.has(event.id);
                                            const isHovered = hoveredEventId === event.id;

                                            // Correct Color Mapping: Red (Error) > Green (Logged) > Purple (Pending/Valid)
                                            let bgColor = 'bg-gray-100 text-gray-600 border-gray-300';
                                            let zIndex = 10;

                                            if (isIncorrect) {
                                                bgColor = 'bg-red-100 text-red-800 border-red-300';
                                            } else if (isLogged) {
                                                bgColor = 'bg-green-100 text-green-800 border-green-300';
                                            } else if (event.summary && isValidMask(cleanEntryTitle(event.summary, projectsMap), projectsMap)) {
                                                bgColor = 'bg-purple-100 text-purple-800 border-purple-300';
                                            } else {
                                                bgColor = 'bg-red-50 text-red-800 border-red-200';
                                            }

                                            if (isHovered) {
                                                bgColor = 'bg-yellow-200 text-yellow-900 border-yellow-400 ring-4 ring-yellow-400 shadow-xl scale-105';
                                                zIndex = 100;
                                            }

                                            return (
                                                <div
                                                    key={event.id}
                                                    className={`absolute rounded border-l-4 text-[9px] leading-tight p-0.5 overflow-hidden transition-all duration-150 ${bgColor}`}
                                                    style={{
                                                        top: `${startHour * 60}px`,
                                                        height: `${duration * 60}px`,
                                                        width: `${event.widthPercent}%`,
                                                        left: `${event.leftPercent}%`,
                                                        zIndex: zIndex + (event.colIndex || 0)
                                                    }}
                                                    title={`${event.summary}`}
                                                >
                                                    <div className="font-bold truncate">{event.summary || '(No Title)'}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // MODE B: CHRONOLOGICAL TIMELINE (FOR LONG RANGES)
    const grouped = events.reduce((acc, event) => {
        const d = new Date(event.start).toISOString().split('T')[0];
        if (!acc[d]) acc[d] = [];
        acc[d].push(event);
        return acc;
    }, {});

    return (
        <div className="bg-white rounded-lg shadow-sm border h-full max-h-[80vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
                <h3 className="text-sm font-bold text-gray-800 uppercase tracking-widest flex items-center gap-2">
                    <ListBulletIcon className="h-4 w-4 text-indigo-600" /> Chronological Timeline Audit
                </h3>
                <span className="text-[10px] font-black text-gray-400 bg-gray-100 px-2 py-0.5 rounded uppercase">{events.length} Items</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar bg-gray-50/20">
                {Object.keys(grouped).sort().map(day => (
                    <div key={day} className="space-y-2">
                        <div className="sticky top-0 z-10 py-1 bg-[#fcfcfc]">
                            <span className="text-[10px] font-black text-indigo-600 uppercase bg-white px-3 py-1 rounded-lg border shadow-sm flex items-center w-fit gap-2">
                                <CalendarIcon className="h-3 w-3" />
                                {new Date(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                            </span>
                        </div>
                        <div className="space-y-1.5 ml-2">
                            {grouped[day].map((e, idx) => {
                                const isLogged = loggedEventIds.has(e.id);
                                const isIncorrect = incorrectEventIds.has(e.id);
                                const isHovered = hoveredEventId === e.id;

                                // Mapping status and colors: Red (Error) > Green (Logged) > Violet (Valid/Pending)
                                let statusClass = isIncorrect ? 'bg-red-50 border-red-200 text-red-700 border-l-red-500' : isLogged ? 'bg-green-50 border-green-200 text-green-700 border-l-green-500' : (e.summary && isValidMask(cleanEntryTitle(e.summary, projectsMap), projectsMap)) ? 'bg-purple-50 border-purple-200 text-purple-700 border-l-purple-500' : 'bg-white border-gray-200 text-gray-600 border-l-gray-400';
                                if (isHovered) statusClass = 'bg-yellow-50 border-yellow-400 ring-2 ring-yellow-400 z-20';

                                return (
                                    <div key={idx} className={`p-3 rounded-xl border flex items-center justify-between group transition-all shadow-sm ${statusClass} border-l-4`}>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-[11px] font-bold truncate leading-none mb-1">{e.summary || '(Untitled)'}</div>
                                            <div className="flex items-center gap-2 text-[9px] opacity-60">
                                                <ClockIcon className="h-3 w-3" />
                                                {new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(e.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                        <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border bg-white/50 ${isLogged ? 'text-green-700' : isIncorrect ? 'text-red-700' : 'text-purple-700'}`}>
                                            {isLogged ? 'Logged' : isIncorrect ? 'Error' : 'Pending'}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};


const EmployeeSection = ({ email, data, onEntryChange, onEntrySave, onUpload, onNotify, setHoveredEventId, onAutoFix, onDeleteEntry, onEditEntry, employeeProfile, shutdowns, startDate, endDate, projectsMap }) => {
    if (data.error) {
        return (
            <div className="border-t">
                <div className="p-4 flex justify-between items-center bg-red-50 text-red-800">
                    <h4 className="text-lg font-semibold">{email}</h4>
                    <p>{data.error}</p>
                </div>
            </div>
        )
    }

    const { summary, newEntries, incorrectEntries, loggedEntries } = data;
    const [selectedNew, setSelectedNew] = useState({});
    const [selectedIncorrect, setSelectedIncorrect] = useState({});

    // --- New Entries Selection ---
    const handleSelectNew = (eventId) => {
        setSelectedNew(prev => ({ ...prev, [eventId]: !prev[eventId] }));
    };

    const handleSelectAllNew = (e) => {
        if (e.target.checked) {
            const all = {};
            newEntries.forEach(entry => all[entry.eventId] = true);
            setSelectedNew(all);
        } else {
            setSelectedNew({});
        }
    };

    const handleUploadSelected = () => {
        const entriesToUpload = newEntries.filter(e => selectedNew[e.eventId]);
        if (entriesToUpload.length > 0) {
            onUpload(entriesToUpload);
            const newSelected = { ...selectedNew };
            entriesToUpload.forEach(e => delete newSelected[e.eventId]);
            setSelectedNew(newSelected);
        }
    }

    // --- Incorrect Entries Selection ---
    const handleSelectIncorrect = (eventId) => {
        setSelectedIncorrect(prev => ({ ...prev, [eventId]: !prev[eventId] }));
    };

    const handleSelectAllIncorrect = (e) => {
        if (e.target.checked) {
            const all = {};
            incorrectEntries.forEach(entry => all[entry.eventId] = true);
            setSelectedIncorrect(all);
        } else {
            setSelectedIncorrect({});
        }
    };

    const handleNotifySelected = () => {
        const selectedIds = Object.keys(selectedIncorrect).filter(id => selectedIncorrect[id]);

        let entriesToNotify = incorrectEntries;
        if (selectedIds.length > 0) {
            entriesToNotify = incorrectEntries.filter(e => selectedIncorrect[e.eventId]);
        }

        if (entriesToNotify.length > 0) {
            onNotify(email, entriesToNotify);
        }
    }

    // --- Enhanced Auto-Fix to include project type logic ---
    const fixableEntries = useMemo(() => {
        // Filter entries where cleaning changes the title AND the result is valid
        return incorrectEntries.filter(e => {
            const clean = cleanEntryTitle(e.title, projectsMap);
            // Must have changed AND be valid now
            return clean !== e.title && isValidMask(clean, projectsMap);
        });
    }, [incorrectEntries, projectsMap]);

    // Adjusted hours (excluding internal type projects)
    const adjustedLoggedHours = useMemo(() => {
        if (!loggedEntries) return 0;
        return loggedEntries.reduce((sum, entry) => {
            // Check project type for exclusion instead of hardcoded '2000'
            const pCode = String(entry.project).padStart(4, '0');
            const pType = getProjectType(pCode, projectsMap);

            if (pType === 'internal') return sum;
            return sum + (parseFloat(entry.duration) || 0);
        }, 0);
    }, [loggedEntries, projectsMap]);

    return (
        <div className="bg-white rounded-lg shadow-sm h-full flex flex-col">
            <div className="p-4 border-b flex justify-between items-center shrink-0">
                <h3 className="text-xl font-semibold text-gray-800">Scan Results for {email}</h3>
            </div>

            {/* Summary Bar */}
            <div className="p-3 bg-gray-50 border-b flex flex-wrap gap-4 text-xs sm:text-sm shrink-0">
                <div className="flex flex-col">
                    <span className="text-gray-500 uppercase font-bold text-[10px]">Expected</span>
                    <span className="font-bold text-blue-700">{summary.expectedWorkHours}h</span>
                </div>
                <div className="flex flex-col border-l pl-4 border-gray-300">
                    <span className="text-gray-500 uppercase font-bold text-[10px]">Logged (Billable)</span>
                    <span className="font-bold text-green-700">{adjustedLoggedHours.toFixed(2)}h</span>
                </div>
                <div className="flex flex-col border-l pl-4 border-gray-300">
                    <span className="text-gray-500 uppercase font-bold text-[10px]">Leave</span>
                    <span className="font-bold text-purple-700">{summary.leaveHours}h</span>
                </div>
                <div className="flex flex-col border-l pl-4 border-gray-300">
                    <span className="text-gray-500 uppercase font-bold text-[10px]">Sick</span>
                    <span className="font-bold text-yellow-600">{summary.sickHours}h</span>
                </div>
            </div>

            <div className="p-4 space-y-6 overflow-y-auto flex-1">
                {/* Weekly Breakdown Table */}
                <WeeklyBreakdown
                    startDate={startDate}
                    endDate={endDate}
                    loggedEntries={loggedEntries}
                    newEntries={newEntries}
                    incorrectEntries={incorrectEntries}
                    employeeProfile={employeeProfile}
                    shutdowns={shutdowns}
                />

                <CollapsibleSection title="Logged Entries" count={loggedEntries?.length} headerClass="text-blue-700">
                    <div className="overflow-x-auto border rounded-lg">
                        <table className="min-w-full divide-y divide-gray-200 text-xs sm:text-sm">
                            <thead className="bg-blue-50">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium text-blue-800">Date</th>
                                    <th className="px-3 py-2 text-left font-medium text-blue-800">Project</th>
                                    <th className="px-3 py-2 text-left font-medium text-blue-800">Task</th>
                                    <th className="px-3 py-2 text-left font-medium text-blue-800">Comment</th>
                                    <th className="px-3 py-2 text-left font-medium text-blue-800">Hrs</th>
                                    <th className="px-3 py-2 text-right"></th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {loggedEntries.sort((a, b) => (a.startTime.seconds || 0) - (b.startTime.seconds || 0)).map(entry => (
                                    <tr key={entry.id}
                                        onMouseEnter={() => setHoveredEventId(entry.id)}
                                        onMouseLeave={() => setHoveredEventId(null)}
                                        className="hover:bg-yellow-50"
                                    >
                                        <td className="px-3 py-2 whitespace-nowrap">{entry.date}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">{entry.project}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">{entry.task}</td>
                                        <td className="px-3 py-2 truncate max-w-[150px]">{entry.comment}</td>
                                        <td className={`px-3 py-2 whitespace-nowrap ${getProjectType(String(entry.project).padStart(4, '0'), projectsMap) === 'internal' ? 'text-gray-400 line-through' : ''}`}>{entry.duration}</td>
                                        <td className="px-3 py-2 text-right">
                                            <button
                                                onClick={() => onDeleteEntry(entry)}
                                                className="text-red-500 hover:text-red-700 p-1"
                                                title="Delete from DB (Keep in Calendar)"
                                            >
                                                <TrashIcon className="h-4 w-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CollapsibleSection>

                <CollapsibleSection
                    title="New Valid Entries"
                    count={newEntries?.length}
                    headerClass="text-green-700"
                    rightContent={
                        <button onClick={handleUploadSelected} className="py-1 px-3 text-xs font-medium rounded-md text-white bg-green-600 hover:bg-green-700">
                            Upload
                        </button>
                    }
                >
                    <div className="overflow-x-auto border rounded-lg">
                        <table className="min-w-full divide-y divide-gray-200 text-xs sm:text-sm">
                            <thead className="bg-green-50">
                                <tr>
                                    <th className="py-2 pl-2 w-8">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 rounded cursor-pointer"
                                            checked={newEntries.length > 0 && newEntries.every(e => selectedNew[e.eventId])}
                                            onChange={handleSelectAllNew}
                                        />
                                    </th>
                                    <th className="px-3 py-2 text-left font-medium text-green-800">Date</th>
                                    <th className="px-3 py-2 text-left font-medium text-green-800">Calendar Title</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {newEntries.map(entry => (
                                    <tr key={entry.eventId}
                                        onMouseEnter={() => setHoveredEventId(entry.eventId)}
                                        onMouseLeave={() => setHoveredEventId(null)}
                                        className="hover:bg-yellow-50"
                                    >
                                        <td className="py-2 pl-4"><input type="checkbox" className="h-4 w-4 rounded cursor-pointer" checked={!!selectedNew[entry.eventId]} onChange={() => handleSelectNew(entry.eventId)} /></td>
                                        <td className="px-3 py-2 whitespace-nowrap">{entry.date}</td>
                                        <td className="px-3 py-2 font-mono truncate max-w-[200px]">{entry.title}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CollapsibleSection>

                <CollapsibleSection
                    title="Incorrect Entries"
                    count={incorrectEntries?.length}
                    headerClass="text-red-700"
                    rightContent={
                        <div className="flex space-x-2">
                            {fixableEntries.length > 0 && (
                                <button
                                    onClick={() => onAutoFix(fixableEntries)}
                                    className="py-1 px-3 text-xs font-medium rounded-md text-white bg-orange-500 hover:bg-orange-600 flex items-center"
                                    title={`Automatically correct spacing for ${fixableEntries.length} entries`}
                                >
                                    <WrenchScrewdriverIcon className="h-3 w-3 mr-1" /> Auto-Fix ({fixableEntries.length})
                                </button>
                            )}
                            <button onClick={handleNotifySelected} className="py-1 px-3 text-xs font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700">
                                Notify
                            </button>
                        </div>
                    }
                >
                    <div className="overflow-x-auto border rounded-lg">
                        <table className="min-w-full divide-y divide-gray-200 text-xs sm:text-sm">
                            <thead className="bg-red-50">
                                <tr>
                                    <th className="py-2 pl-2 w-8">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 rounded cursor-pointer"
                                            checked={incorrectEntries.length > 0 && incorrectEntries.every(e => selectedIncorrect[e.eventId])}
                                            onChange={handleSelectAllIncorrect}
                                        />
                                    </th>
                                    <th className="px-3 py-2 text-left font-medium text-red-800">Date</th>
                                    <th className="px-3 py-2 text-left font-medium text-red-800">Title</th>
                                    <th className="px-3 py-2 text-left font-medium text-red-800">Error</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {incorrectEntries.map(entry => (
                                    <tr key={entry.eventId}
                                        onMouseEnter={() => setHoveredEventId(entry.eventId)}
                                        onMouseLeave={() => setHoveredEventId(null)}
                                        className="hover:bg-yellow-50 cursor-pointer"
                                        onClick={() => onEditEntry(entry)}
                                    >
                                        <td className="py-2 pl-4" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="h-4 w-4 rounded cursor-pointer" checked={!!selectedIncorrect[entry.eventId]} onChange={() => handleSelectIncorrect(entry.eventId)} /></td>
                                        <td className="px-3 py-2 whitespace-nowrap">{entry.date}</td>
                                        <td className="px-3 py-2 font-mono truncate max-w-[200px] hover:text-blue-600 hover:underline">
                                            {entry.title}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap">{getErrorTag(entry.errorType)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CollapsibleSection>

                {(!newEntries || newEntries.length === 0) && (!incorrectEntries || incorrectEntries.length === 0) && (!loggedEntries || loggedEntries.length === 0) &&
                    <p className="text-gray-500 text-center py-4">No timesheet entries found in this period.</p>
                }
            </div>
        </div>
    );
};

const CompletionDashboard = ({ startDate, endDate, onInspect }) => {
    const [report, setReport] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });

    useEffect(() => {
        const fetchReport = async () => {
            setLoading(true);
            try {
                const result = await getTimesheetCompletionStatus({ startDate, endDate });
                if (result.data.status === 'success') {
                    setReport(result.data.report);
                }
            } catch (error) {
                console.error("Error fetching report:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchReport();
    }, [startDate, endDate]);

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const sortedReport = useMemo(() => {
        const sortedData = [...report];
        if (sortConfig.key) {
            sortedData.sort((a, b) => {
                if (a[sortConfig.key] < b[sortConfig.key]) {
                    return sortConfig.direction === 'asc' ? -1 : 1;
                }
                if (a[sortConfig.key] > b[sortConfig.key]) {
                    return sortConfig.direction === 'asc' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortedData;
    }, [report, sortConfig]);

    const SortIcon = ({ columnKey }) => {
        if (sortConfig.key !== columnKey) return <BarsArrowUpIcon className="h-4 w-4 inline ml-1 opacity-20 group-hover:opacity-50" />;
        return sortConfig.direction === 'asc'
            ? <BarsArrowUpIcon className="h-4 w-4 inline ml-1 text-indigo-600" />
            : <BarsArrowDownIcon className="h-4 w-4 inline ml-1 text-indigo-600" />;
    };

    // Animated loading circle
    if (loading) {
        return (
            <div className="bg-white p-32 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center">
                <div className="relative mb-6">
                    <div className="h-24 w-24 rounded-full border-8 border-orange-50 border-t-orange-500 animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <DocumentChartBarIcon className="h-10 w-10 text-orange-200" />
                    </div>
                </div>
                <h3 className="text-xl font-black text-gray-800 tracking-tighter mb-2 animate-pulse">Data being compiled...</h3>
                <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Cross-referencing calendars and leave records</p>
            </div>
        );
    }

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Timesheet Completion Report</h3>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th
                                className="px-4 py-3 text-left font-medium text-gray-500 cursor-pointer group hover:bg-gray-100"
                                onClick={() => handleSort('name')}
                            >
                                Employee <SortIcon columnKey="name" />
                            </th>
                            <th className="px-4 py-3 text-right font-medium text-gray-500">Target</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-500">Logged (DB)</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-500">Calendar Total</th>
                            <th
                                className="px-4 py-3 text-center font-medium text-gray-500 cursor-pointer group hover:bg-gray-100"
                                onClick={() => handleSort('status')}
                            >
                                Status <SortIcon columnKey="status" />
                            </th>
                            <th className="px-4 py-3 text-right font-medium text-gray-500">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                        {sortedReport.map((row) => (
                            <tr key={row.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                                <td className="px-4 py-3 text-right text-gray-600">{row.expectedHours}h</td>
                                <td className="px-4 py-3 text-right font-bold text-indigo-600">{row.loggedHours.toFixed(2)}h</td>
                                <td className="px-4 py-3 text-right text-gray-600">{row.calendarTotalHours.toFixed(2)}h</td>
                                <td className="px-4 py-3 text-center">
                                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${row.status === 'Complete' ? 'bg-green-100 text-green-800' :
                                        row.status === 'Partial' ? 'bg-yellow-100 text-yellow-800' :
                                            'bg-red-100 text-red-800'
                                        }`}>
                                        {row.status}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <button
                                        onClick={() => onInspect(row.email)}
                                        className="text-indigo-600 hover:text-indigo-900 text-xs font-medium"
                                    >
                                        Inspect
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- Main Component ---
const TimesheetValidation = ({ user }) => {
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [dateSelectionMode, setDateSelectionMode] = useState('range');
    const [monthValue, setMonthValue] = useState(new Date().toISOString().slice(0, 7));
    const [weekValue, setWeekValue] = useState('');
    const [users, setUsers] = useState([]);

    // NEW: Load Projects Map for Client-Side Validation Logic
    const [projectsMap, setProjectsMap] = useState({});

    const [shutdowns, setShutdowns] = useState([]);
    const [fullEmployeeProfile, setFullEmployeeProfile] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');

    const [selectedUserEmail, setSelectedUserEmail] = useState('');
    const [scanResults, setScanResults] = useState(null);
    const [loadingScan, setLoadingScan] = useState(false);
    const [errorScan, setErrorScan] = useState('');
    const [globalStatus, setGlobalStatus] = useState('');
    const [hoveredEventId, setHoveredEventId] = useState(null);

    // Edit Modal State
    const [editingEntry, setEditingEntry] = useState(null);
    const [editTitle, setEditTitle] = useState('');

    const currentEmployeeData = scanResults ? scanResults[selectedUserEmail] : null;

    useEffect(() => {
        // Load Projects Map
        const unsub = onSnapshot(collection(db, 'projects'), (snap) => {
            const map = {};
            snap.forEach(d => {
                const data = d.data();
                const code = String(data.projectNumber).padStart(4, '0');
                map[code] = {
                    projectType: data.projectType || 'standard',
                    status: data.status || 'Active'
                };
            });
            // Legacy fallbacks for known hardcoded values if not in DB yet
            if (!map['0999']) map['0999'] = { projectType: 'misc', status: 'Active' };
            if (!map['2000']) map['2000'] = { projectType: 'internal', status: 'Active' };
            setProjectsMap(map);
        });
        return () => unsub();
    }, []);

    useEffect(() => {
        const fetchShutdowns = async () => {
            const startYear = new Date(startDate).getFullYear();
            const endYear = new Date(endDate).getFullYear();
            const years = Array.from(new Set([startYear, endYear]));

            let allShutdowns = [];
            for (const year of years) {
                try {
                    const docRef = doc(db, 'company_holidays', String(year));
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        allShutdowns = [...allShutdowns, ...(docSnap.data().shutdowns || [])];
                    }
                } catch (e) { console.error(e); }
            }
            setShutdowns(allShutdowns);
        };
        fetchShutdowns();
    }, [startDate, endDate]);

    useEffect(() => {
        const fetchEmployeeProfile = async () => {
            if (!selectedUserEmail) {
                setFullEmployeeProfile(null);
                return;
            }
            const emp = users.find(u => u.email === selectedUserEmail);
            if (emp && emp.id) {
                try {
                    const docRef = doc(db, 'employees', emp.id);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        setFullEmployeeProfile({ id: docSnap.id, ...docSnap.data() });
                    }
                } catch (e) { console.error("Error fetching full profile", e); }
            }
        };
        fetchEmployeeProfile();
    }, [selectedUserEmail, users]);

    const dropdownUsers = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return users
            .filter(user => {
                if (user.isEmployed !== false) return true;
                if (!user.endDate) return false;

                let endDate;
                if (typeof user.endDate === 'string' && user.endDate.includes('-')) {
                    const [y, m, d] = user.endDate.split('-').map(Number);
                    endDate = new Date(y, m - 1, d);
                } else {
                    endDate = new Date(user.endDate);
                    endDate.setHours(0, 0, 0, 0);
                }

                const diffTime = today - endDate;
                const daysSinceInactive = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                return daysSinceInactive <= 30;
            })
            .map(user => {
                let displayName = `${user.name} ${user.surname} (${user.email})`;
                let isRed = false;

                if (user.isEmployed === false) {
                    let endDate;
                    if (typeof user.endDate === 'string' && user.endDate.includes('-')) {
                        const [y, m, d] = user.endDate.split('-').map(Number);
                        endDate = new Date(y, m - 1, d);
                    } else {
                        endDate = new Date(user.endDate);
                        endDate.setHours(0, 0, 0, 0);
                    }

                    const diffTime = today - endDate;
                    const daysSinceInactive = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                    const daysRemaining = 30 - daysSinceInactive;

                    displayName = `${user.name} ${user.surname} (${user.email}) [${Math.max(0, daysRemaining)} days remaining]`;
                    isRed = true;
                }

                return { ...user, displayName, isRed };
            })
            .sort((a, b) => a.displayName.localeCompare(b.displayName));
    }, [users]);

    useEffect(() => {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth();
        const day = today.getDate();
        const dayOfWeek = today.getDay();
        const startOfWeek = new Date(year, month, day - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
        const weekNumber = Math.ceil((((startOfWeek - new Date(year, 0, 1)) / 86400000) + 1) / 7);
        setWeekValue(`${year}-W${String(weekNumber).padStart(2, '0')}`);
    }, []);

    useEffect(() => {
        if (dateSelectionMode === 'month') {
            const [year, month] = monthValue.split('-');
            const firstDay = new Date(year, month - 1, 1);
            const lastDay = new Date(year, month, 0);
            setStartDate(firstDay.toISOString().split('T')[0]);
            setEndDate(lastDay.toISOString().split('T')[0]);
        }
    }, [monthValue, dateSelectionMode]);

    useEffect(() => {
        if (dateSelectionMode === 'week' && weekValue) {
            const [year, week] = weekValue.split('-W');
            const date = new Date(year, 0, 1 + (week - 1) * 7);
            const dayOfWeek = date.getDay();
            const startOfWeek = new Date(date);
            startOfWeek.setDate(date.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
            startOfWeek.setHours(12, 0, 0, 0);
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);

            setStartDate(startOfWeek.toISOString().split('T')[0]);
            setEndDate(endOfWeek.toISOString().split('T')[0]);
        }
    }, [weekValue, dateSelectionMode]);

    useEffect(() => {
        if (activeTab === 'scanner' && selectedUserEmail && startDate && endDate) {
            processEmployee(selectedUserEmail);
        }
    }, [startDate, endDate]);

    useEffect(() => {
        if (!user) return;
        const unsubscribe = onSnapshot(query(collection(db, "employees")), (snapshot) => {
            const usersData = snapshot.docs
                .map(doc => {
                    const d = doc.data();
                    return { id: doc.id, ...d, email: d.companyEmail || d.workEmail };
                })
                .filter(u => u.email);
            setUsers(usersData);
        }, (err) => console.error("Could not fetch employee list.", err));
        return () => unsubscribe();
    }, [user]);

    // Handlers
    const handleInspectEmployee = (email) => {
        setSelectedUserEmail(email);
        setActiveTab('scanner');
        processEmployee(email);
    };

    const handleStartScan = (email) => {
        if (!email) return;
        setSelectedUserEmail(email);
        processEmployee(email);
    };

    const handleRefreshScan = () => {
        if (selectedUserEmail) {
            processEmployee(selectedUserEmail);
        }
    };

    const processEmployee = async (email) => {
        if (!email) return;
        setLoadingScan(true);
        setErrorScan('');
        setGlobalStatus(`Scanning ${email}...`);

        try {
            const result = await validateTimesheets({ emails: [email], startDate, endDate });
            if (result.data.status === 'success') {
                setScanResults(result.data.results);
            } else {
                throw new Error('Function returned an error status.');
            }
        } catch (err) {
            setErrorScan(`An error occurred while scanning ${email}.`);
            console.error(err);
            setScanResults({ [email]: { error: `Failed to scan: ${err.message}` } });
        } finally {
            setLoadingScan(false);
            setGlobalStatus('');
        }
    };

    const handleEntryChange = (email, eventId, newTitle) => {
        setScanResults(prev => ({
            ...prev,
            [email]: {
                ...prev[email],
                incorrectEntries: prev[email].incorrectEntries.map(e =>
                    e.eventId === eventId ? { ...e, title: newTitle } : e
                ),
            },
        }));
    };

    const handleEntrySave = async (entry) => {
        const titleToSave = editTitle;

        try {
            await updateCalendarEvent({ userEmail: entry.employee, eventId: entry.eventId, newTitle: titleToSave });

            setEditingEntry(null);

            setScanResults(prev => {
                const updatedResults = { ...prev };
                const employeeData = updatedResults[entry.employee];
                if (!employeeData) return prev;

                const nextAllCalendarEvents = employeeData.allCalendarEvents ? employeeData.allCalendarEvents.map(evt => evt.id === entry.eventId ? { ...evt, summary: titleToSave } : evt) : null;

                const clean = cleanEntryTitle(titleToSave, projectsMap);
                let isValidFormat = isValidMask(clean, projectsMap);

                let nextIncorrectEntries = employeeData.incorrectEntries.filter(e => e.eventId !== entry.eventId);
                let nextNewEntries = employeeData.newEntries;
                const proposedEntry = { ...entry, title: titleToSave, errorType: null };

                if (isValidFormat) {
                    const pool = [...nextNewEntries, proposedEntry];
                    const overlaps = checkOverlaps(pool);
                    const revalidatedNew = [];
                    const revalidatedIncorrect = [];

                    pool.forEach(e => {
                        if (overlaps.has(e.eventId)) revalidatedIncorrect.push({ ...e, errorType: 'Time Overlap' });
                        else revalidatedNew.push({ ...e, errorType: null });
                    });

                    nextNewEntries = revalidatedNew;
                    nextIncorrectEntries = [...nextIncorrectEntries, ...revalidatedIncorrect];
                } else {
                    const type = getProjectType(titleToSave.substring(0, 4), projectsMap);
                    const errorMsg = type === 'misc' ? 'Invalid Misc Mask' : 'Invalid Format';
                    nextIncorrectEntries.push({ ...entry, title: titleToSave, errorType: errorMsg });
                }

                return {
                    ...prev,
                    [entry.employee]: {
                        ...employeeData,
                        incorrectEntries: nextIncorrectEntries,
                        newEntries: nextNewEntries,
                        allCalendarEvents: nextAllCalendarEvents
                    }
                };
            });
        } catch (err) {
            console.error("Failed to save event:", err);
            alert('Failed to save the event. Please try again.');
        }
    };

    const handleAutoFix = async (entriesToFix) => {
        if (!entriesToFix || entriesToFix.length === 0) return;
        setGlobalStatus(`Fixing ${entriesToFix.length} entries...`);
        try {
            const promises = entriesToFix.map(entry => {
                const cleanTitle = cleanEntryTitle(entry.title, projectsMap);
                if (cleanTitle !== entry.title) {
                    return updateCalendarEvent({ userEmail: entry.employee, eventId: entry.eventId, newTitle: cleanTitle })
                        .then(() => ({ ...entry, corrected: true, newTitle: cleanTitle }))
                        .catch(() => ({ ...entry, corrected: false }));
                }
                return Promise.resolve({ ...entry, corrected: false });
            });

            const results = await Promise.all(promises);
            const successfulFixes = results.filter(r => r.corrected);

            setScanResults(prev => {
                const currentData = prev[selectedUserEmail];
                const fixedIds = new Set(successfulFixes.map(f => f.eventId));
                const remainingIncorrect = currentData.incorrectEntries.filter(e => !fixedIds.has(e.eventId));
                const addedNew = successfulFixes.map(f => ({ ...f, title: f.newTitle, errorType: null }));
                const updatedCalendarEvents = currentData.allCalendarEvents.map(evt => { const fix = successfulFixes.find(f => f.eventId === evt.id); return fix ? { ...evt, summary: fix.newTitle } : evt; });
                return { ...prev, [selectedUserEmail]: { ...currentData, incorrectEntries: remainingIncorrect, newEntries: [...currentData.newEntries, ...addedNew], allCalendarEvents: updatedCalendarEvents } };
            });
            setGlobalStatus(`Fixed ${successfulFixes.length} entries successfully.`);
        } catch (error) { console.error("Auto-fix error:", error); setErrorScan("Failed to auto-fix some entries."); }
    };

    const handleUpload = async (entriesToUpload) => {
        if (entriesToUpload.length === 0) return;
        setGlobalStatus('Uploading entries...');
        try {
            const result = await uploadTimesheetEntries({ entries: entriesToUpload });
            setGlobalStatus(result.data.message);
            const uploadedIds = new Set(entriesToUpload.map(e => e.eventId));
            const employeeEmail = entriesToUpload[0].employee;
            const newLoggedEntries = entriesToUpload.map(e => ({ ...e, id: e.eventId }));
            setScanResults(prev => {
                const currentData = prev[employeeEmail];
                const updatedNewEntries = currentData.newEntries.filter(e => !uploadedIds.has(e.eventId));
                const combinedLogged = [...currentData.loggedEntries, ...newLoggedEntries];
                const newDuration = newLoggedEntries.reduce((sum, entry) => sum + (parseFloat(entry.duration) || 0), 0);
                return { ...prev, [employeeEmail]: { ...currentData, summary: { ...currentData.summary, loggedHours: currentData.summary.loggedHours + newDuration }, newEntries: updatedNewEntries, loggedEntries: combinedLogged } };
            });
        } catch (err) { setErrorScan('Failed to upload entries.'); setGlobalStatus(''); }
    };

    const handleNotify = async (email, entries) => {
        setGlobalStatus(`Sending notification to ${email}...`);
        try { await sendEmailNotification({ invalidEntriesByEmployee: { [email]: entries } }); setGlobalStatus(`Notification sent to ${email} successfully!`); } catch (err) { setErrorScan('Failed to send notification email.'); setGlobalStatus(''); }
    };

    const handleDeleteEntry = async (entry) => {
        if (!confirm('Are you sure you want to delete this entry from the system? The calendar event will remain.')) return;
        setGlobalStatus('Deleting entry...');
        try {
            const result = await deleteTimesheetEntry({ entryId: entry.id });
            if (result.data.status === 'success') {
                setGlobalStatus('Entry deleted successfully.');
                setScanResults(prev => {
                    const currentData = prev[selectedUserEmail];
                    const updatedLoggedEntries = currentData.loggedEntries.filter(e => e.id !== entry.id);
                    const restoredEntry = { ...entry, eventId: entry.eventId || entry.id, title: entry.title || `${entry.project}-${entry.task}${entry.comment ? '-' + entry.comment : ''}`, errorType: null };
                    const deletedDuration = parseFloat(entry.duration) || 0;
                    return { ...prev, [selectedUserEmail]: { ...currentData, summary: { ...currentData.summary, loggedHours: Math.max(0, currentData.summary.loggedHours - deletedDuration) }, loggedEntries: updatedLoggedEntries, newEntries: [...currentData.newEntries, restoredEntry] } };
                });
            } else { setErrorScan('Failed to delete entry: ' + result.data.message); }
        } catch (err) { console.error("Delete error:", err); setErrorScan('Error deleting entry.'); }
    };

    const onEditEntry = (entry) => {
        setEditingEntry(entry);
        setEditTitle(entry.title || '');
    };

    const saveEdit = () => {
        if (!editingEntry) return;
        handleEntrySave({ ...editingEntry, title: editTitle });
    };

    return (
        <div className="space-y-8">
            <div className="bg-white p-6 rounded-lg shadow-sm">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                    <h2 className="text-xl font-bold text-gray-900">Timesheet Management</h2>

                    <div className="flex bg-gray-100 p-1 rounded-lg">
                        <button
                            onClick={() => setActiveTab('overview')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'overview' ? 'bg-white text-indigo-600 shadow' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                            <ChartBarIcon className="h-4 w-4 inline mr-2" /> Overview
                        </button>
                        <button
                            onClick={() => setActiveTab('scanner')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'scanner' ? 'bg-white text-indigo-600 shadow' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                            <ListBulletIcon className="h-4 w-4 inline mr-2" /> Validation Scanner
                        </button>
                        <button
                            onClick={() => setActiveTab('report')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'report' ? 'bg-white text-indigo-600 shadow' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                            <TableCellsIcon className="h-4 w-4 inline mr-2" /> Monthly Report
                        </button>
                    </div>
                </div>

                {activeTab !== 'report' && (
                    <div className="flex flex-wrap gap-6 items-end">
                        <div className="flex-1 min-w-[200px]">
                            <label className="block text-sm font-medium text-gray-700">Scan by</label>
                            <select value={dateSelectionMode} onChange={(e) => setDateSelectionMode(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm">
                                <option value="range">Custom Range</option>
                                <option value="month">Month</option>
                                <option value="week">Week</option>
                            </select>
                        </div>
                        {dateSelectionMode === 'range' && (
                            <>
                                <div className="flex-1 min-w-[150px]"><label className="block text-sm font-medium text-gray-700">Start Date</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" /></div>
                                <div className="flex-1 min-w-[150px]"><label className="block text-sm font-medium text-gray-700">End Date</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" /></div>
                            </>
                        )}
                        {dateSelectionMode === 'month' && (
                            <div className="flex-1 min-w-[200px]"><label className="block text-sm font-medium text-gray-700">Select Month</label><input type="month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" /></div>
                        )}
                        {dateSelectionMode === 'week' && (
                            <div className="flex-1 min-w-[200px]"><label className="block text-sm font-medium text-gray-700">Select Week</label><input type="week" value={weekValue} onChange={(e) => setWeekValue(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" /></div>
                        )}

                        {activeTab === 'scanner' && (
                            <div className="flex-1 min-w-[250px] flex items-end gap-2">
                                <div className="flex-grow">
                                    <label className="block text-sm font-medium text-gray-700">Select Employee</label>
                                    <div className="relative mt-1">
                                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                            <UserIcon className="h-5 w-5 text-gray-400" />
                                        </div>
                                        <select
                                            value={selectedUserEmail}
                                            onChange={(e) => handleStartScan(e.target.value)}
                                            className="block w-full rounded-md border-gray-300 pl-10 py-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                        >
                                            <option value="">-- Choose Employee --</option>
                                            {dropdownUsers.map(user => (
                                                <option
                                                    key={user.id}
                                                    value={user.email}
                                                    className={user.isRed ? "text-red-600" : "text-gray-900"}
                                                >
                                                    {user.displayName}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <button
                                    onClick={handleRefreshScan}
                                    disabled={!selectedUserEmail || loadingScan}
                                    className="mb-0.5 p-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md border border-gray-300 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Refresh Scanner"
                                >
                                    <ArrowPathIcon className={`h-5 w-5 ${loadingScan ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {activeTab === 'report' && (
                <MonthlyReportGenerator />
            )}

            {activeTab === 'overview' && (
                <CompletionDashboard startDate={startDate} endDate={endDate} onInspect={handleInspectEmployee} />
            )}

            {activeTab === 'scanner' && (
                <div className="space-y-4">
                    {errorScan && <p className="text-center text-sm text-red-600 p-4 bg-red-50 rounded-lg">{errorScan}</p>}
                    {globalStatus && <p className="text-center text-sm text-blue-600 p-4 bg-blue-50 rounded-lg">{globalStatus}</p>}

                    {!scanResults && !loadingScan && !errorScan && (
                        <div className="text-center p-12 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                            <div className="mx-auto w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                                <MagnifyingGlassIcon className="h-6 w-6 text-gray-400" />
                            </div>
                            <h3 className="text-lg font-medium text-gray-900">Ready to Scan</h3>
                            <p className="mt-1">Select an employee from the dropdown above to view validation details.</p>
                        </div>
                    )}

                    {loadingScan &&
                        <div className="flex justify-center items-center p-12 bg-white rounded-lg shadow-sm border border-gray-200">
                            <div className="flex flex-col items-center">
                                <ArrowPathIcon className="animate-spin mb-4 h-10 w-10 text-indigo-600" />
                                <p className="text-lg font-medium text-gray-900">Scanning Calendar...</p>
                                <p className="text-sm text-gray-500">Fetching {selectedUserEmail}</p>
                            </div>
                        </div>
                    }

                    {scanResults && currentEmployeeData && (
                        <>
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start h-[calc(100vh-300px)]">
                                <div className="h-full overflow-hidden flex flex-col">
                                    <EmployeeSection
                                        key={selectedUserEmail}
                                        email={selectedUserEmail}
                                        data={currentEmployeeData}
                                        onEntryChange={handleEntryChange}
                                        onEntrySave={handleEntrySave}
                                        onUpload={handleUpload}
                                        onNotify={handleNotify}
                                        setHoveredEventId={setHoveredEventId}
                                        onAutoFix={handleAutoFix}
                                        onDeleteEntry={handleDeleteEntry}
                                        onEditEntry={onEditEntry}
                                        employeeProfile={fullEmployeeProfile}
                                        shutdowns={shutdowns}
                                        startDate={startDate}
                                        endDate={endDate}
                                        projectsMap={projectsMap} // Pass the projects map!
                                    />
                                </div>

                                <div className="h-full overflow-hidden">
                                    <CalendarPreview
                                        startDate={startDate}
                                        endDate={endDate}
                                        events={currentEmployeeData.allCalendarEvents || []}
                                        hoveredEventId={hoveredEventId}
                                        loggedEntries={currentEmployeeData.loggedEntries || []}
                                        incorrectEntries={currentEmployeeData.incorrectEntries || []}
                                        projectsMap={projectsMap} // Pass the projects map!
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Edit Modal */}
            <Modal show={!!editingEntry} onClose={() => setEditingEntry(null)} title="Edit Entry Title">
                <div className="space-y-4">
                    <p className="text-sm text-gray-500 font-bold">
                        {editTitle.startsWith(editTitle.substring(0, 4)) && getProjectType(editTitle.substring(0, 4), projectsMap) === 'misc'
                            ? "Mask: CODE-DEPT/TASK-MISCCODE-Comment"
                            : "Mask: CODE-DEPT/TASK-Comment"
                        }
                    </p>
                    <input
                        type="text"
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded font-mono text-sm focus:ring-indigo-500 focus:border-indigo-500"
                        autoFocus
                    />
                    <div className="flex justify-end space-x-2 pt-2">
                        <button onClick={() => setEditingEntry(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                        <button onClick={saveEdit} className="px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded">Save & Re-validate</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default TimesheetValidation;