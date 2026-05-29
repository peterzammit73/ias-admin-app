// Root: src/modules/employee/MyTimesheet.jsx
// Version: 6.23 - Fixed Syntax Error & Added Misc Register Dropdown
import React, { useState, useEffect, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { addDoc, collection, doc, updateDoc, Timestamp, deleteDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { auth, functions, db } from '/src/firebase.js';
import {
    ArrowPathIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    XMarkIcon,
    CalendarDaysIcon,
    TableCellsIcon,
    BookOpenIcon,
    PlusIcon,
    TrashIcon,
    PencilIcon,
    MagnifyingGlassIcon,
    LockClosedIcon,
    InformationCircleIcon,
    WrenchScrewdriverIcon
} from '@heroicons/react/24/outline';
import TimesheetGuide from '/src/modules/TimesheetGuide.jsx';
import Modal from '/src/components/Modal.jsx';

const MyTimesheet = ({ user }) => {
    const [viewMode, setViewMode] = useState('week');

    // Data State
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [viewDate, setViewDate] = useState(new Date());
    const [summary, setSummary] = useState(null);
    const [scanResults, setScanResults] = useState(null);

    // Dropdown Data State
    const [projectsList, setProjectsList] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [miscCodes, setMiscCodes] = useState([]);

    // UI State
    const [selectedEvent, setSelectedEvent] = useState(null);
    const [showAddModal, setShowAddModal] = useState(false);

    // Form State
    const [entryForm, setEntryForm] = useState({
        date: '',
        startTime: '08:00',
        duration: 1,
        project: '',
        departmentCode: '',
        task: '',
        comment: '',
        title: '',
        miscCode: '' // New field for 0999 misc segment
    });
    const [updating, setUpdating] = useState(false);

    // Monthly View State
    const [monthViewDate, setMonthViewDate] = useState(new Date());
    const [monthlyData, setMonthlyData] = useState([]);
    const [loadingMonth, setLoadingMonth] = useState(false);

    const scrollContainerRef = useRef(null);

    // --- DATA LOADING FOR DROPDOWNS ---
    useEffect(() => {
        // Fetch Active Projects Only
        const qProjects = query(collection(db, 'projects'), where('status', '==', 'Active'));
        const unsubProjects = onSnapshot(qProjects, (snapshot) => {
            const list = snapshot.docs.map(d => d.data())
                .sort((a, b) => (a.projectNumber || 0) - (b.projectNumber || 0));
            setProjectsList(list);
        });

        // Fetch Tasks
        const fetchTasks = async () => {
            try {
                const deptSnap = await getDocs(collection(db, 'timesheet_departments'));
                const deptData = [];

                await Promise.all(deptSnap.docs.map(async (deptDoc) => {
                    const dept = deptDoc.data();
                    const tasksSnap = await getDocs(collection(db, `timesheet_departments/${deptDoc.id}/tasks`));
                    const tasks = tasksSnap.docs.map(t => t.data()).sort((a, b) => a.code.localeCompare(b.code));
                    deptData.push({
                        id: deptDoc.id,
                        name: dept.name,
                        code: dept.code,
                        tasks: tasks
                    });
                }));

                deptData.sort((a, b) => a.name.localeCompare(b.name));
                setDepartments(deptData);
            } catch (e) {
                console.error("Error loading tasks:", e);
            }
        };
        fetchTasks();

        // Fetch Active Misc Codes
        const qMisc = query(collection(db, 'misc_register'), where('status', '==', 'Active'));
        const unsubMisc = onSnapshot(qMisc, (snapshot) => {
            const list = snapshot.docs.map(d => d.data()).sort((a, b) => a.code.localeCompare(b.code));
            setMiscCodes(list);
        });

        return () => {
            unsubProjects();
            unsubMisc();
        };
    }, []);

    // --- HELPERS ---
    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const getStartOfWeek = (date) => {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(d.setDate(diff));
    };

    const getWeekInputValue = (date) => {
        if (!date) return '';
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
        const week1 = new Date(d.getFullYear(), 0, 4);
        const weekNumber = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
        return `${d.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
    };

    const getMonthInputValue = (date) => {
        if (!date) return '';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}`;
    };

    const calculateTotalHours = (entries) => {
        if (!entries || !Array.isArray(entries)) return 0;
        return entries.reduce((total, entry) => {
            if (entry.duration !== undefined) {
                return total + (parseFloat(entry.duration) || 0);
            }
            const start = new Date(entry.startTime);
            const end = new Date(entry.endTime);
            const duration = (end - start) / (1000 * 60 * 60);
            return total + (isNaN(duration) ? 0 : duration);
        }, 0);
    };

    // --- HELPER: CLEAN TITLE ---
    const cleanEntryTitle = (rawTitle) => {
        if (!rawTitle) return rawTitle;

        // 1. Identify Project Code
        const projectMatch = rawTitle.match(/^\s*(\d{4})\s*-(.*)/);

        if (!projectMatch) {
            // Fallback: If structure is totally broken, just strip all spaces
            return rawTitle.replace(/\s+/g, '');
        }

        const projectCode = projectMatch[1];
        const remainder = projectMatch[2];

        // 2. Logic Branch based on Project Code
        if (projectCode === '0999') {
            // SPECIAL MASK: 0999-$/$$$$-misc0000[-Comment]
            // Regex to capture: (TaskMask) - (MiscCode) - (CommentOptional)
            const specialRegex = /^\s*([A-Za-z0-9]+\s*\/\s*[A-Za-z0-9]+)\s*-\s*([A-Za-z0-9]+)(?:\s*-\s*(.*))?$/;
            const specialMatch = remainder.match(specialRegex);

            if (specialMatch) {
                const taskPart = specialMatch[1].replace(/\s+/g, '');
                const miscPart = specialMatch[2].replace(/\s+/g, '');
                const commentPart = specialMatch[3] ? specialMatch[3].trim() : '';
                if (commentPart) {
                    return `0999-${taskPart}-${miscPart}-${commentPart}`;
                } else {
                    return `0999-${taskPart}-${miscPart}`;
                }
            }
            return rawTitle; // No auto-fix if missing parts

        } else {
            // STANDARD MASK: 0000-$/$$$$-Comment
            const lastDashIndex = rawTitle.lastIndexOf('-');
            if (lastDashIndex === -1) return rawTitle.replace(/\s+/g, '');

            const prefix = rawTitle.substring(0, lastDashIndex);
            const comment = rawTitle.substring(lastDashIndex + 1);

            const cleanPrefix = prefix.replace(/\s+/g, '');
            const cleanComment = comment.trim();

            return `${cleanPrefix}-${cleanComment}`;
        }
    };

    // --- HELPER: VALIDATE TITLE ---
    const isValidMask = (title) => {
        if (!title) return false;

        // 0999 Special Mask: 0999-DEPT/TASK-MISCXXXX[-Comment]
        if (title.startsWith('0999-')) {
            // Updated Regex: Make the comment group (-.*) optional using ?
            const specialRegex = /^0999-[A-Z0-9]+\/[A-Z0-9]+-[A-Za-z0-9]+(-.*)?$/i;
            return specialRegex.test(title);
        }

        // Standard Mask: 0000-DEPT/TASK-Comment
        const standardRegex = /^\d{4}-[A-Z0-9]+\/[A-Z0-9]+-.*$/i;
        return standardRegex.test(title);
    };

    // --- API CALLS ---
    const handleFetchWeek = async () => {
        if (!auth.currentUser) return;
        setLoading(true);
        const start = getStartOfWeek(viewDate);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);

        try {
            const validateFn = httpsCallable(functions, 'validateTimesheets');
            const response = await validateFn({
                emails: [auth.currentUser.email],
                startDate: formatDate(start),
                endDate: formatDate(end)
            });

            const result = response.data.results[auth.currentUser.email];
            if (result) {
                setSummary(result.summary);
                setScanResults(result);

                const calendarEvents = [];
                if (result.newEntries) {
                    result.newEntries.forEach(entry => calendarEvents.push({
                        id: entry.eventId,
                        title: entry.title,
                        start: new Date(entry.startTime),
                        end: new Date(entry.endTime),
                        type: 'new',
                        resource: entry
                    }));
                }
                if (result.incorrectEntries) {
                    result.incorrectEntries.forEach(entry => {
                        let displayTitle = `⚠ ${entry.title}`;
                        let errorType = entry.errorType;

                        // Custom check for 0999 mask failure
                        if (entry.title.startsWith('0999')) {
                            if (!isValidMask(cleanEntryTitle(entry.title))) {
                                errorType = 'Invalid 0999 Mask';
                                displayTitle = `🚫 ${entry.title}`;
                            }
                        } else if (entry.errorType === 'Inactive Project') {
                            displayTitle = `🚫 ${entry.title}`;
                        }

                        calendarEvents.push({
                            id: entry.eventId,
                            title: entry.title,
                            displayTitle: displayTitle,
                            start: new Date(entry.startTime),
                            end: new Date(entry.endTime),
                            type: 'error',
                            resource: entry,
                            errorType: errorType
                        });
                    });
                }
                if (result.loggedEntries) {
                    result.loggedEntries.forEach(entry => calendarEvents.push({
                        id: entry.eventId || entry.id,
                        title: `✓ ${entry.project}/${entry.task}`,
                        displayTitle: `✓ ${entry.project}/${entry.task}`,
                        start: new Date(entry.startTime._seconds ? entry.startTime._seconds * 1000 : entry.startTime),
                        end: new Date(entry.endTime._seconds ? entry.endTime._seconds * 1000 : entry.endTime),
                        type: 'logged',
                        resource: entry,
                        firestoreId: entry.id
                    }));
                }
                setEvents(calendarEvents);
            }
        } catch (error) {
            console.error("Error fetching timesheets:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleFetchMonth = async () => {
        if (!auth.currentUser) return;
        setLoadingMonth(true);
        setMonthlyData([]);

        const year = monthViewDate.getFullYear();
        const month = monthViewDate.getMonth();
        const weeks = [];
        let current = new Date(year, month, 1);
        let startOfWeek = getStartOfWeek(current);

        while (startOfWeek.getMonth() === month || startOfWeek < new Date(year, month + 1, 0)) {
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(endOfWeek.getDate() + 6);
            if (weeks.length === 0 || weeks[weeks.length - 1].start.getTime() !== startOfWeek.getTime()) {
                weeks.push({ start: new Date(startOfWeek), end: endOfWeek });
            }
            const nextWeek = new Date(startOfWeek);
            nextWeek.setDate(nextWeek.getDate() + 7);
            startOfWeek = nextWeek;
            if (startOfWeek.getMonth() > month && startOfWeek.getFullYear() === year) break;
            if (startOfWeek.getFullYear() > year) break;
        }

        try {
            const validateFn = httpsCallable(functions, 'validateTimesheets');
            const promises = weeks.map(week =>
                validateFn({
                    emails: [auth.currentUser.email],
                    startDate: formatDate(week.start),
                    endDate: formatDate(week.end)
                }).then(res => ({
                    weekStart: week.start,
                    weekEnd: week.end,
                    result: res.data.results[auth.currentUser.email]
                })).catch(err => ({
                    weekStart: week.start,
                    weekEnd: week.end,
                    error: true
                }))
            );
            const results = await Promise.all(promises);
            setMonthlyData(results);
        } catch (e) {
            console.error(e);
            alert("Failed to load month view.");
        } finally {
            setLoadingMonth(false);
        }
    }

    // --- ACTIONS ---
    const handleGlobalAutoFix = async () => {
        if (!scanResults || !scanResults.incorrectEntries || scanResults.incorrectEntries.length === 0) {
            alert("No incorrect entries found to fix in this view.");
            return;
        }

        const entriesToFix = scanResults.incorrectEntries.filter(entry => {
            const clean = cleanEntryTitle(entry.title);
            return (clean !== entry.title) && isValidMask(clean);
        });

        if (entriesToFix.length === 0) {
            alert("No entries found where correcting spaces results in a valid format. Entries with missing parts (e.g. missing 'misc' code for project 0999) cannot be auto-fixed.");
            return;
        }

        if (!window.confirm(`Found ${entriesToFix.length} entries where removing spaces creates a valid code. Fix them now?`)) {
            return;
        }

        setLoading(true);
        try {
            const updateFn = httpsCallable(functions, 'updateCalendarEvent');
            await Promise.all(entriesToFix.map(entry => {
                const newTitle = cleanEntryTitle(entry.title);
                return updateFn({
                    userEmail: auth.currentUser.email,
                    eventId: entry.eventId,
                    newTitle: newTitle
                });
            }));
            await handleFetchWeek();
            alert(`Successfully corrected ${entriesToFix.length} entries.`);
        } catch (error) {
            console.error("Auto-fix failed:", error);
            alert("Failed to fix some entries. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleAddEntry = async (e) => {
        e.preventDefault();
        setUpdating(true);
        try {
            const project = entryForm.project;
            const taskCode = entryForm.task;
            const deptCode = entryForm.departmentCode;

            const comment = entryForm.comment ? `-${entryForm.comment}` : '';
            let fullTitle = '';

            // Handle 0999 Logic for Manual Entry
            if (project === '0999') {
                if (!entryForm.miscCode) {
                    alert("Please select the 'Misc Code' for project 0999.");
                    setUpdating(false);
                    return;
                }
                // Format: 0999-DEPT/TASK-MISC[-COMMENT]
                fullTitle = `${project}-${deptCode}/${taskCode}-${entryForm.miscCode}${comment}`;
            } else {
                // Standard Format: PROJECT-DEPT/TASK-COMMENT
                fullTitle = `${project}-${deptCode}/${taskCode}${comment}`;
            }

            const dateStr = entryForm.date || formatDate(new Date());
            const startDateTime = new Date(`${dateStr}T${entryForm.startTime}:00`);
            const durationHours = parseFloat(entryForm.duration) || 1;
            const endDateTime = new Date(startDateTime.getTime() + (durationHours * 60 * 60 * 1000));

            const addFn = httpsCallable(functions, 'addCalendarEvent');
            await addFn({
                userEmail: auth.currentUser.email,
                title: fullTitle,
                startTime: startDateTime.toISOString(),
                endTime: endDateTime.toISOString()
            });

            setShowAddModal(false);
            setEntryForm({
                title: '',
                date: '',
                startTime: '08:00',
                duration: 1,
                project: '',
                departmentCode: '',
                task: '',
                comment: '',
                miscCode: ''
            });
            handleFetchWeek();
        } catch (error) {
            alert("Failed to add event to calendar.");
        } finally {
            setUpdating(false);
        }
    };

    const handleDeleteEntry = async () => {
        if (selectedEvent?.type === 'logged') {
            alert("This entry is already logged in the system and cannot be deleted.");
            return;
        }

        if (!selectedEvent) return;
        if (!window.confirm("Are you sure? This will delete the entry from your Google Calendar.")) return;
        setUpdating(true);
        try {
            const deleteFn = httpsCallable(functions, 'deleteCalendarEvent');
            await deleteFn({ userEmail: auth.currentUser.email, eventId: selectedEvent.id });
            setSelectedEvent(null);
            handleFetchWeek();
        } catch (error) {
            alert("Failed to delete event.");
        } finally {
            setUpdating(false);
        }
    };

    const handleUpdateEvent = async (e) => {
        e.preventDefault();
        if (selectedEvent?.type === 'logged') {
            alert("This entry is already logged in the system and cannot be edited.");
            return;
        }

        if (!selectedEvent || !entryForm.title) return;
        setUpdating(true);
        try {
            const updateFn = httpsCallable(functions, 'updateCalendarEvent');
            await updateFn({ userEmail: auth.currentUser.email, eventId: selectedEvent.id, newTitle: entryForm.title });
            setSelectedEvent(null);
            handleFetchWeek();
        } catch (error) {
            alert("Failed to update event.");
        } finally {
            setUpdating(false);
        }
    };

    // --- VIEW LOGIC ---
    useEffect(() => {
        if (viewMode === 'week') handleFetchWeek();
        if (viewMode === 'month') handleFetchMonth();
    }, [viewDate, viewMode, monthViewDate]);

    const changeWeek = (offset) => {
        const newDate = new Date(viewDate);
        newDate.setDate(newDate.getDate() + (offset * 7));
        setViewDate(newDate);
    };

    const handleEventClick = (event) => {
        setSelectedEvent(event);
        setEntryForm({ ...entryForm, title: event.title || '' });
    };

    const openAddModal = () => {
        setEntryForm({
            title: '',
            date: formatDate(viewDate),
            startTime: '08:00',
            duration: 1,
            project: '',
            departmentCode: '',
            task: '',
            comment: '',
            miscCode: ''
        });
        setShowAddModal(true);
    };

    const handleWeekPickerChange = (e) => {
        if (!e.target.value) return;
        const [year, week] = e.target.value.split('-W');
        const simpleDate = new Date(year, 0, 1 + (week - 1) * 7);
        const dayOfWeek = simpleDate.getDay();
        const startOfWeek = new Date(simpleDate);
        startOfWeek.setDate(simpleDate.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
        setViewDate(startOfWeek);
    };

    const handleMonthPickerChange = (e) => {
        if (!e.target.value) return;
        const [year, month] = e.target.value.split('-').map(Number);
        const newDate = new Date(year, month - 1, 1);
        setMonthViewDate(newDate);
    };

    const handleWeekRowClick = (weekStart) => {
        setViewDate(new Date(weekStart));
        setViewMode('week');
    };

    const calculateEventPositions = (dayEvents) => {
        const sortedEvents = [...dayEvents].sort((a, b) => {
            if (a.start < b.start) return -1;
            if (a.start > b.start) return 1;
            return (b.end - b.start) - (a.end - a.start);
        });

        const columns = [];
        sortedEvents.forEach(event => {
            let placed = false;
            for (let i = 0; i < columns.length; i++) {
                const col = columns[i];
                const lastEventInCol = col[col.length - 1];
                if (event.start >= lastEventInCol.end) {
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
            let maxColInCluster = 0;
            sortedEvents.forEach(other => {
                if (event.start < other.end && event.end > other.start) {
                    if (other.colIndex > maxColInCluster) maxColInCluster = other.colIndex;
                }
            });
            const widthPercent = 100 / (maxColInCluster + 1);
            const leftPercent = event.colIndex * widthPercent;
            return { ...event, widthPercent: widthPercent, leftPercent: leftPercent };
        });
    };

    const getEventStyle = (event, date) => {
        const start = new Date(event.start);
        if (start.getDate() !== date.getDate()) return null;
        const startHour = start.getHours() + (start.getMinutes() / 60);
        const end = new Date(event.end);
        const endHour = end.getHours() + (end.getMinutes() / 60);
        const duration = endHour - startHour;
        const top = startHour * 60;
        const height = duration * 60;

        let bg = '#bfdbfe', border = '#60a5fa', text = '#1e3a8a';
        if (event.type === 'error') {
            if (event.errorType === 'Inactive Project') { bg = '#e5e7eb'; border = '#4b5563'; text = '#1f2937'; }
            else { bg = '#fecaca'; border = '#f87171'; text = '#7f1d1d'; }
        }
        else if (event.type === 'logged') { bg = '#bbf7d0'; border = '#4ade80'; text = '#14532d'; }
        else if (event.type === 'new') { bg = '#e9d5ff'; border = '#c084fc'; text = '#581c87'; }

        return {
            top: `${top}px`, height: `${height}px`, width: `${event.widthPercent}%`, left: `${event.leftPercent}%`,
            backgroundColor: bg, borderColor: border, color: text, position: 'absolute', borderRadius: '4px', borderLeftWidth: '4px',
            padding: '2px 4px', fontSize: '10px', overflow: 'hidden', zIndex: 10 + (event.colIndex || 0),
            cursor: 'pointer', opacity: 0.95, boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', borderRight: '1px solid white'
        };
    };

    const days = Array.from({ length: 7 }, (_, i) => {
        const d = getStartOfWeek(viewDate);
        d.setDate(d.getDate() + i);
        return d;
    });
    const hours = Array.from({ length: 24 }, (_, i) => i);

    return (
        <div className="flex flex-col bg-white p-2 sm:p-4 rounded-lg shadow overflow-hidden relative" style={{ height: 'calc(100vh - 9rem)' }}>

            {/* Top Bar */}
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-4">
                    <h2 className="text-2xl font-bold text-gray-900">My Timesheet</h2>
                    <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200 gap-1">
                        <button onClick={() => setViewMode('week')} className={`px-3 py-1.5 rounded-md text-sm font-medium ${viewMode === 'week' ? 'bg-white text-indigo-600 shadow' : 'text-gray-500'}`}>Week</button>
                        <button onClick={() => setViewMode('month')} className={`px-3 py-1.5 rounded-md text-sm font-medium ${viewMode === 'month' ? 'bg-white text-indigo-600 shadow' : 'text-gray-500'}`}>Month</button>
                        <button onClick={() => setViewMode('guide')} className={`px-3 py-1.5 rounded-md text-sm font-medium ${viewMode === 'guide' ? 'bg-white text-indigo-600 shadow' : 'text-gray-500'}`}>Guide</button>

                        {/* Fix Spaces Button - Positioned in the tabs group */}
                        <button
                            onClick={handleGlobalAutoFix}
                            className="flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-orange-100 text-orange-700 hover:bg-orange-200 border border-orange-200 transition-colors"
                            title="Auto-fix spacing in project codes"
                        >
                            <WrenchScrewdriverIcon className="h-4 w-4 mr-1.5" />
                            Fix Spaces
                        </button>
                    </div>
                </div>
                {viewMode !== 'guide' && (
                    <div className="flex gap-2 items-center">
                        <div className="flex items-center bg-gray-100 rounded-lg p-1 border">
                            {viewMode === 'week' ? (
                                <>
                                    <button onClick={() => changeWeek(-1)} className="p-1.5 hover:bg-white rounded text-gray-600"><ChevronLeftIcon className="h-5 w-5" /></button>
                                    <input type="week" value={getWeekInputValue(viewDate)} onChange={handleWeekPickerChange} className="block w-32 border-0 bg-transparent py-1 text-gray-900 text-center text-sm font-semibold focus:ring-0 cursor-pointer" />
                                    <button onClick={() => changeWeek(1)} className="p-1.5 hover:bg-white rounded text-gray-600"><ChevronRightIcon className="h-5 w-5" /></button>
                                </>
                            ) : (
                                <input type="month" value={getMonthInputValue(monthViewDate)} onChange={handleMonthPickerChange} className="block w-32 border-0 bg-transparent py-1 text-gray-900 text-center text-sm font-semibold focus:ring-0 cursor-pointer" />
                            )}
                        </div>
                        <button onClick={viewMode === 'week' ? handleFetchWeek : handleFetchMonth} disabled={loading || loadingMonth} className="p-2 bg-gray-100 text-gray-700 rounded border border-gray-300 shadow-sm hover:bg-gray-200">
                            <ArrowPathIcon className={`h-5 w-5 ${loading || loadingMonth ? 'animate-spin' : ''}`} />
                        </button>

                        {/* CONDITIONAL ADD BUTTON: Only visible in WEEK view */}
                        {viewMode === 'week' && (
                            <button onClick={openAddModal} className="flex items-center px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm font-medium shadow-sm">
                                <PlusIcon className="h-5 w-5 mr-1" /> Add
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Dashboard Summary (Week) */}
            {viewMode === 'week' && summary && (
                <div className="mb-4">
                    <div className="flex gap-2 p-3 bg-gray-50 rounded border text-center text-sm mb-2">
                        <div className="flex-1" title="Includes Leave, Sick, & Public Holidays"><p className="text-gray-500 text-xs uppercase font-bold">Expected</p><p className="font-bold text-gray-700">{summary.expectedWorkHours.toFixed(2)}h</p></div>
                        <div className="flex-1 border-l border-gray-300"><p className="text-gray-500 text-xs uppercase font-bold">Logged</p><p className="font-bold text-green-600">{summary.loggedHours.toFixed(2)}h</p></div>
                        <div className="flex-1 border-l border-gray-300"><p className="text-gray-500 text-xs uppercase font-bold">New Correct</p><p className="font-bold text-purple-600">{calculateTotalHours(scanResults?.newEntries).toFixed(2)}h</p></div>
                        <div className="flex-1 border-l border-gray-300"><p className="text-gray-500 text-xs uppercase font-bold">Error</p><p className="font-bold text-red-600">{calculateTotalHours(scanResults?.incorrectEntries).toFixed(2)}h</p></div>
                    </div>
                    {/* LEGEND */}
                    <div className="flex flex-wrap gap-4 text-xs text-gray-600 px-2 justify-center">
                        <div className="flex items-center"><span className="w-3 h-3 bg-[#bbf7d0] border border-[#4ade80] rounded mr-1"></span> Logged (Saved)</div>
                        <div className="flex items-center"><span className="w-3 h-3 bg-[#e9d5ff] border border-[#c084fc] rounded mr-1"></span> New Correct (Pending Upload)</div>
                        <div className="flex items-center"><span className="w-3 h-3 bg-[#fecaca] border border-[#f87171] rounded mr-1"></span> Error (Invalid Format/Code)</div>
                        <div className="flex items-center"><span className="w-3 h-3 bg-[#e5e7eb] border border-[#4b5563] rounded mr-1"></span> Inactive Project</div>
                    </div>
                </div>
            )}

            {/* Calendar Grid */}
            {viewMode === 'week' && (
                <div className="flex-1 overflow-auto border rounded-lg relative">
                    <div className="flex bg-gray-50 border-b border-gray-300 z-20 sticky top-0">
                        <div className="w-12 border-r border-gray-400 flex-shrink-0 bg-gray-100 z-30"></div>
                        <div className="flex-1 flex" ref={el => { if (el && scrollContainerRef.current) el.scrollLeft = scrollContainerRef.current.scrollLeft }}>
                            <div className="flex min-w-[700px] w-full">
                                {days.map(day => (
                                    <div key={day.toISOString()} className="flex-1 py-2 text-center bg-gray-50 border-r border-gray-300 last:border-r-0">
                                        <div className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wider">{day.toLocaleString('default', { weekday: 'short' })}</div>
                                        <div className={`text-xs sm:text-sm font-bold ${new Date().toDateString() === day.toDateString() ? 'text-blue-600' : 'text-gray-700'}`}>{day.getDate()}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div ref={scrollContainerRef} className="flex-1 overflow-auto relative flex">
                        <div className="w-12 flex-shrink-0 bg-gray-50 border-r border-gray-400 select-none z-10 sticky left-0">
                            {hours.map(h => <div key={h} className="h-[60px] text-right pr-2 text-[10px] sm:text-xs text-gray-400 relative border-b border-gray-100/0"><span className="absolute -top-2 right-1 sm:right-2 bg-gray-50 px-1">{h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}</span></div>)}
                        </div>
                        <div className="flex-1 flex relative min-w-[700px]">
                            <div className="absolute inset-0 z-0 w-full">{hours.map(h => <div key={h} className="h-[60px] border-b border-gray-100 w-full"></div>)}</div>
                            {days.map(d => (
                                <div key={d.toISOString()} className="flex-1 border-r border-gray-300 relative last:border-r-0">
                                    <div className="h-[1440px] relative">
                                        {calculateEventPositions(events.filter(e => new Date(e.start).getDate() === d.getDate())).map(ev => {
                                            const style = getEventStyle(ev, d);
                                            if (!style) return null;
                                            return <div key={ev.id} style={style} onClick={() => handleEventClick(ev)} title={ev.displayTitle || ev.title} className="shadow-sm hover:z-20 transition-all hover:brightness-95"><div className="font-bold truncate leading-tight">{ev.displayTitle || ev.title}</div><div className="text-[9px] opacity-90 truncate hidden sm:block">{ev.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - {ev.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div></div>
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Month View (Table) */}
            {viewMode === 'month' && (
                <div className="flex-1 overflow-auto border border-gray-200 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200 text-xs sm:text-sm">
                        <thead className="bg-gray-50 sticky top-0 shadow-sm z-10">
                            <tr>
                                <th className="px-3 py-3 text-left font-medium text-gray-600 uppercase tracking-wider">Week</th>
                                <th className="px-2 py-3 text-right font-medium text-gray-500 uppercase tracking-wider">Exp</th>
                                <th className="px-2 py-3 text-right font-bold text-gray-700 uppercase tracking-wider border-l border-gray-200 pl-4">Log</th>
                                <th className="px-2 py-3 text-right font-medium text-purple-600 uppercase tracking-wider hidden sm:table-cell">New</th>
                                <th className="px-2 py-3 text-right font-bold text-red-600 uppercase tracking-wider border-r border-gray-100 pr-4">Err</th>
                                <th className="px-2 py-3 text-right font-medium text-blue-600 uppercase tracking-wider hidden sm:table-cell">Leave</th>
                                <th className="px-2 py-3 text-right font-medium text-yellow-600 uppercase tracking-wider hidden sm:table-cell">Sick</th>
                                <th className="px-4 py-3 text-right font-medium text-gray-400"></th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {loadingMonth ? (
                                <tr><td colSpan="8" className="px-6 py-12 text-center text-gray-500"><ArrowPathIcon className="h-8 w-8 animate-spin mx-auto text-indigo-500" /></td></tr>
                            ) : monthlyData.map((week, idx) => {
                                if (week.error) return <tr key={idx} className="bg-red-50"><td className="px-4 py-3 text-red-600" colSpan="8">Error loading</td></tr>;
                                const res = week.result;
                                if (!res || !res.summary) {
                                    return (
                                        <tr key={idx} className="hover:bg-gray-50">
                                            <td className="px-3 py-3 whitespace-nowrap font-medium text-gray-900">{week.weekStart.getDate()}/{week.weekStart.getMonth() + 1} - {week.weekEnd.getDate()}/{week.weekEnd.getMonth() + 1}</td>
                                            <td colSpan="7" className="px-3 py-3 text-center text-gray-400 italic">No data</td>
                                        </tr>
                                    );
                                }
                                const summary = res.summary;
                                const newHrs = calculateTotalHours(res.newEntries);
                                const errHrs = calculateTotalHours(res.incorrectEntries);
                                return (
                                    <tr key={idx} onClick={() => handleWeekRowClick(week.weekStart)} className="hover:bg-indigo-50 cursor-pointer transition-colors group">
                                        <td className="px-3 py-3 whitespace-nowrap font-medium text-gray-900">{week.weekStart.getDate()}/{week.weekStart.getMonth() + 1} - {week.weekEnd.getDate()}/{week.weekEnd.getMonth() + 1}</td>
                                        <td className="px-2 py-3 text-right text-gray-500">{summary.expectedWorkHours?.toFixed(1) || '0.0'}</td>
                                        <td className="px-2 py-3 text-right font-bold text-gray-800 border-l border-gray-100 pl-4">{summary.loggedHours?.toFixed(1) || '0.0'}</td>
                                        <td className="px-2 py-3 text-right font-medium text-purple-600 hidden sm:table-cell">{newHrs > 0 ? newHrs.toFixed(1) : '-'}</td>
                                        <td className="px-2 py-3 text-right font-bold text-red-600 border-r border-gray-100 pr-4">{errHrs > 0 ? errHrs.toFixed(1) : '-'}</td>
                                        <td className="px-2 py-3 text-right text-blue-600 hidden sm:table-cell">{summary.leaveHours?.toFixed(1) || '0.0'}</td>
                                        <td className="px-2 py-3 text-right text-yellow-600 hidden sm:table-cell">{summary.sickHours?.toFixed(1) || '0.0'}</td>
                                        <td className="px-4 py-3 text-right"><MagnifyingGlassIcon className="h-5 w-5 text-gray-400 group-hover:text-indigo-600 inline-block stroke-2" /></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {viewMode === 'guide' && <div className="flex-1 overflow-auto border border-gray-200 rounded-lg"><TimesheetGuide /></div>}

            <Modal show={!!selectedEvent} onClose={() => setSelectedEvent(null)} title={selectedEvent?.type === 'error' ? 'Fix Entry' : 'Edit Entry'}>
                <div className="space-y-4">
                    <div className="text-sm text-gray-500 mb-2">{selectedEvent?.start?.toLocaleDateString()} {selectedEvent?.start?.toLocaleTimeString()}</div>
                    {selectedEvent?.errorType && <div className="bg-red-50 text-red-700 p-2 rounded text-sm mb-2"><strong>Error:</strong> {selectedEvent.errorType}</div>}

                    {selectedEvent?.type === 'logged' ? (
                        <div className="bg-yellow-50 text-yellow-800 p-3 rounded-md text-sm flex items-center">
                            <LockClosedIcon className="h-5 w-5 mr-2" />
                            <span>This entry is logged in the database and cannot be modified or deleted.</span>
                        </div>
                    ) : (
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Title</label>
                            <div className="flex gap-2 mt-1">
                                <input
                                    type="text"
                                    className="flex-1 p-2 border rounded font-mono text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                    value={entryForm.title}
                                    onChange={e => setEntryForm({ ...entryForm, title: e.target.value })}
                                />
                                {/* Button removed as requested */}
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                {entryForm.title && entryForm.title.startsWith('0999')
                                    ? "Format: 0999-DEPT/TASK-MISCXXXX[-COMMENT]"
                                    : "Format: PROJECT-TASK-COMMENT"}
                            </p>
                        </div>
                    )}

                    <div className="flex justify-between pt-4 border-t">
                        <button
                            onClick={handleDeleteEntry}
                            className={`px-3 py-2 rounded text-sm font-medium flex items-center ${selectedEvent?.type === 'logged' ? 'text-gray-400 cursor-not-allowed' : 'text-red-600 hover:bg-red-50'}`}
                            disabled={updating || selectedEvent?.type === 'logged'}
                        >
                            <TrashIcon className="h-4 w-4 mr-1" /> Delete
                        </button>
                        <div className="flex gap-2">
                            <button onClick={() => setSelectedEvent(null)} className="px-3 py-2 text-gray-600 hover:bg-gray-50 rounded">Cancel</button>
                            <button
                                onClick={handleUpdateEvent}
                                className={`px-4 py-2 rounded text-sm flex items-center ${selectedEvent?.type === 'logged' ? 'bg-gray-300 text-white cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                                disabled={updating || selectedEvent?.type === 'logged'}
                            >
                                {updating ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : 'Update'}
                            </button>
                        </div>
                    </div>
                </div>
            </Modal>

            <Modal show={showAddModal} onClose={() => setShowAddModal(false)} title="Add Manual Entry">
                <form onSubmit={handleAddEntry} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="block text-sm font-medium text-gray-700">Date</label><input type="date" className="w-full p-2 border rounded text-sm" required value={entryForm.date} onChange={e => setEntryForm({ ...entryForm, date: e.target.value })} /></div>
                        <div><label className="block text-sm font-medium text-gray-700">Start Time</label><input type="time" className="w-full p-2 border rounded text-sm" required value={entryForm.startTime} onChange={e => setEntryForm({ ...entryForm, startTime: e.target.value })} /></div>
                    </div>
                    <div><label className="block text-sm font-medium text-gray-700">Duration (Hours)</label><input type="number" step="0.25" min="0.25" className="w-full p-2 border rounded text-sm" required value={entryForm.duration} onChange={e => setEntryForm({ ...entryForm, duration: e.target.value })} /></div>

                    {/* Project Dropdown */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Project</label>
                        <select className="w-full p-2 border rounded text-sm bg-white" required value={entryForm.project} onChange={e => setEntryForm({ ...entryForm, project: e.target.value })}>
                            <option value="">Select Project...</option>
                            {projectsList.map(p => (<option key={p.id} value={String(p.projectNumber).padStart(4, '0')}>{String(p.projectNumber).padStart(4, '0')} - {p.projectDescription}</option>))}
                        </select>
                    </div>

                    {/* Department Filter */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Department</label>
                        <select className="w-full p-2 border rounded text-sm bg-white" required value={entryForm.departmentCode} onChange={e => setEntryForm({ ...entryForm, departmentCode: e.target.value, task: '' })}>
                            <option value="">Select Department...</option>
                            {departments.map(dept => (
                                <option key={dept.id} value={dept.code}>{dept.name} ({dept.code})</option>
                            ))}
                        </select>
                    </div>

                    {/* Filtered Task Dropdown */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Task Code</label>
                        <select className="w-full p-2 border rounded text-sm bg-white font-mono" required value={entryForm.task} onChange={e => setEntryForm({ ...entryForm, task: e.target.value })} disabled={!entryForm.departmentCode}>
                            <option value="">{entryForm.departmentCode ? 'Select Task...' : 'Select Department First'}</option>
                            {/* Filter departments to find the selected one, then map its tasks */}
                            {departments.filter(d => d.code === entryForm.departmentCode).map(dept => (
                                dept.tasks.map(t => (
                                    <option key={t.code} value={t.code}>
                                        {dept.code}/{t.code} - {t.name}
                                    </option>
                                ))
                            ))}
                        </select>
                    </div>

                    {/* CONDITIONAL MISC CODE FOR 0999 */}
                    {entryForm.project === '0999' && (
                        <div>
                            <label className="block text-sm font-medium text-orange-700">Misc Code (Required for 0999)</label>
                            <select
                                className="w-full p-2 border border-orange-300 rounded text-sm focus:ring-orange-500 focus:border-orange-500 bg-orange-50"
                                value={entryForm.miscCode}
                                onChange={e => setEntryForm({ ...entryForm, miscCode: e.target.value })}
                                required
                            >
                                <option value="">Select Misc Code...</option>
                                {miscCodes.map(m => (
                                    <option key={m.code} value={m.code}>
                                        {m.code} - {m.description} ({m.client})
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div><label className="block text-sm font-medium text-gray-700">Comment (Optional)</label><input type="text" className="w-full p-2 border rounded text-sm" value={entryForm.comment} onChange={e => setEntryForm({ ...entryForm, comment: e.target.value })} placeholder="e.g. Meeting" /></div>
                    <div className="flex justify-end pt-4 gap-2">
                        <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded text-sm">Cancel</button>
                        <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 text-sm font-medium flex items-center" disabled={updating}>{updating ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : 'Add to Calendar'}</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default MyTimesheet;