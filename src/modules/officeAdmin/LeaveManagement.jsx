import React, { useState, useEffect, useMemo } from 'react';
import { db, functions } from '../../firebase.js';
import { collection, query, where, onSnapshot, doc, updateDoc, setDoc, getDoc, deleteField, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ChevronLeftIcon, ChevronRightIcon, CheckIcon, XMarkIcon, Cog6ToothIcon, MagnifyingGlassIcon, DocumentArrowDownIcon, ArrowPathIcon } from '@heroicons/react/24/solid';
import Modal from '../../components/Modal.jsx';
import LeaveReport from './LeaveReport.jsx';

// --- Reusable Calendar Logic ---
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
    const goodFriday = new Date(easterDate); goodFriday.setDate(easterDate.getDate() - 2);
    return {
        '1-1': "New Year's Day", '2-10': "Feast of St. Paul's Shipwreck", '3-19': "Feast of St. Joseph",
        '3-31': "Freedom Day", [`${goodFriday.getMonth() + 1}-${goodFriday.getDate()}`]: "Good Friday",
        '5-1': "Worker's Day", '6-7': "Sette Giugno", '6-29': "Feast of St. Peter & St. Paul",
        '8-15': "Feast of the Assumption", '9-8': "Feast of Our Lady of Victories", '9-21': "Independence Day",
        '12-8': "Feast of the Immaculate Conception", '12-13': "Republic Day", '12-25': "Christmas Day",
    };
};

const MonthView = ({ year, month, holidays, shutdowns, leaveRequests, selectedEmployeeData, employeeLeaveMap, onDayClick, managementMode, isEditModeEnabled }) => {
    const monthName = new Date(year, month).toLocaleString('en-US', { month: 'long' });
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const emptyDays = (firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const trailingEmptyDays = 42 - (emptyDays + days.length);
    const isEditMode = !!selectedEmployeeData && isEditModeEnabled;

    const getLeaveInfoForDay = (day, isWeekend, isHoliday, isBaseShutdown) => {
        // VISUAL FIX: If it's a non-working day, don't show leave on it
        if (isWeekend || isHoliday || isBaseShutdown) return null;

        const date = new Date(year, month, day);
        date.setHours(0, 0, 0, 0);
        const leaves = [];
        if (isEditMode) return null;

        for (const request of leaveRequests) {
            let startDate, endDate;
            if (request.startDate && typeof request.startDate.toDate === 'function') {
                startDate = request.startDate.toDate();
            } else {
                startDate = new Date(request.startDate);
            }
            if (request.endDate && typeof request.endDate.toDate === 'function') {
                endDate = request.endDate.toDate();
            } else {
                endDate = new Date(request.endDate);
            }

            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(0, 0, 0, 0);

            if (date >= startDate && date <= endDate) leaves.push(request);
        }
        return leaves.length > 0 ? leaves : null;
    };

    return (
        <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-lg font-semibold text-center mb-2 text-gray-800">{monthName}</h3>
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
                {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => <div key={d} className="font-semibold text-gray-500 pb-2">{d}</div>)}
                {Array.from({ length: emptyDays }).map((_, i) => <div key={`blank-${i}`}></div>)}
                {days.map(day => {
                    const date = new Date(year, month, day);
                    const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const dayKey = `${month + 1}-${day}`;
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                    const isHoliday = !!holidays[dayKey];
                    const dayData = employeeLeaveMap?.[year]?.[dayKey];

                    const isBaseShutdown = shutdowns.includes(dateString);
                    const leaves = !isEditMode ? getLeaveInfoForDay(day, isWeekend, isHoliday, isBaseShutdown) : null;

                    let dayClasses = "w-full aspect-square flex items-center justify-center rounded-full transition-colors duration-200 font-semibold text-sm border-2 border-transparent"; // Added base border-transparent
                    let title = holidays[dayKey] || '';

                    // VISUAL PRIORITY LOGIC
                    if (leaves) {
                        if (leaves.length > 1) {
                            dayClasses += " bg-purple-500 text-white font-bold cursor-help";

                            // NEW: Vertical and Categorized Tooltip
                            const vacationList = leaves.filter(l => l.leaveType === 'Vacation' || l.leaveType === 'leave');
                            const sickList = leaves.filter(l => l.leaveType === 'Sick' || l.leaveType === 'sick');

                            let tooltipLines = [];

                            if (vacationList.length > 0) {
                                tooltipLines.push("--- ON LEAVE ---");
                                vacationList.forEach(l => tooltipLines.push(`• ${l.employeeName}`));
                            }

                            if (sickList.length > 0) {
                                if (tooltipLines.length > 0) tooltipLines.push(""); // Spacer
                                tooltipLines.push("--- SICK LEAVE ---");
                                sickList.forEach(l => tooltipLines.push(`• ${l.employeeName}`));
                            }

                            title = tooltipLines.join('\n');

                        } else {
                            const singleLeave = leaves[0];
                            // Also indicate type in single tooltip
                            title = `${singleLeave.leaveType}: ${singleLeave.employeeName} (${singleLeave.status})`;

                            if (singleLeave.status === 'approved') dayClasses += " bg-green-500 text-white";
                            else if (singleLeave.status === 'pending') dayClasses += " bg-teal-400 text-white";
                        }
                    }

                    // Day Data comes from Employee Profile (Approved Leave, Sick, or Work)
                    if (dayData) {
                        if (dayData.type === 'work') {
                            if (dayData.hours === 4) {
                                dayClasses += " bg-gradient-to-r from-green-500 to-white border-2 border-blue-500 text-gray-800 font-bold border-dashed";
                                title = 'Half Day Work (4h Leave Taken)';
                            } else {
                                dayClasses += " bg-white border-2 border-blue-500 text-blue-700 font-bold";
                                title = 'Full Working Day (Leave Cancelled)';
                            }
                        } else if (dayData.type === 'leave') {
                            // FIX: Check status to distinguish Pending vs Approved in Single View
                            if (dayData.status === 'pending') {
                                dayClasses += " bg-teal-400 text-white";
                                title = `Vacation (Pending)`;
                            } else {
                                if (dayData.hours === 4) {
                                    dayClasses += " half-day-green";
                                    title = `Vacation (4 hrs)`;
                                } else {
                                    dayClasses += " bg-green-500 text-white";
                                    title = `Vacation (8 hrs)`;
                                }
                            }
                        } else if (dayData.type === 'sick') {
                            if (dayData.hours === 4) {
                                dayClasses += " half-day-yellow";
                                title = `Sick Leave (4 hrs)`;
                            } else {
                                dayClasses += " bg-yellow-400 text-white";
                                title = `Sick Leave (8 hrs)`;
                            }
                        }
                    }
                    else if (isBaseShutdown) {
                        dayClasses += " bg-orange-500 text-white";
                        title = 'Company Shutdown';
                    }
                    else if (isHoliday) {
                        dayClasses += " text-red-600 bg-red-50";
                    }
                    else if (isWeekend) {
                        dayClasses += " text-gray-400 bg-gray-50";
                    }
                    else {
                        dayClasses += " text-gray-700 hover:bg-gray-100";
                    }

                    if (isEditMode && !isWeekend) dayClasses += " cursor-pointer";

                    return (
                        <div key={day} className="flex justify-center items-center"
                            onClick={() => isEditMode && onDayClick(dateString, isWeekend, isHoliday, isBaseShutdown)}>
                            <div className={dayClasses} title={title}>{day}</div>
                        </div>
                    );
                })}
                {trailingEmptyDays > 0 && Array.from({ length: trailingEmptyDays }).map((_, i) => <div key={`trailing-blank-${i}`}></div>)}
            </div>
        </div>
    );
};

// --- Main Leave Management Component ---
const LeaveManagement = ({ permission }) => {
    const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
    const [shutdowns, setShutdowns] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [allLeaveRequests, setAllLeaveRequests] = useState([]);
    const [selectedEmployees, setSelectedEmployees] = useState({});
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('requests');
    const [editingEntitlement, setEditingEntitlement] = useState({});
    const [searchTerm, setSearchTerm] = useState('');
    const [bulkStatutoryLeave, setBulkStatutoryLeave] = useState('');

    const [selectedEmployeeData, setSelectedEmployeeData] = useState(null);
    const [managementMode, setManagementMode] = useState('leave');
    const [entitlementYear, setEntitlementYear] = useState(new Date().getFullYear());

    // Notification State
    const [showNotificationModal, setShowNotificationModal] = useState(false);
    const [notificationRecipients, setNotificationRecipients] = useState([]);
    const [recipientSearchTerm, setRecipientSearchTerm] = useState('');

    // Report State
    const [showReportModal, setShowReportModal] = useState(false);

    // Migration State
    const [migrating, setMigrating] = useState(false);

    const holidays = useMemo(() => publicHolidays(currentYear), [currentYear]);
    const numSelected = Object.values(selectedEmployees).filter(Boolean).length;

    // Data Fetching
    useEffect(() => {
        setLoading(true);
        // FETCH ALL EMPLOYEES (Active & Inactive) to support historical viewing
        const unsubEmployees = onSnapshot(collection(db, "employees"), snapshot => {
            setEmployees(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.surname.localeCompare(b.surname)));
            setLoading(false);
        });
        const unsubRequests = onSnapshot(collection(db, "leaveRequests"), snapshot => {
            setAllLeaveRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        return () => { unsubEmployees(); unsubRequests(); };
    }, []);

    // Fetch shutdowns
    useEffect(() => {
        const holidayDocRef = doc(db, 'company_holidays', String(currentYear));
        const unsubShutdowns = onSnapshot(holidayDocRef, (docSnap) => {
            setShutdowns(docSnap.exists() ? docSnap.data().shutdowns || [] : []);
        });
        return () => unsubShutdowns();
    }, [currentYear]);

    // Fetch Notification Settings
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const docRef = doc(db, 'settings', 'leave_notifications');
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    setNotificationRecipients(docSnap.data().recipients || []);
                }
            } catch (err) {
                console.error("Error fetching notification settings:", err);
            }
        };
        fetchSettings();
    }, []);

    // Save Notification Settings
    const handleSaveNotifications = async () => {
        if (permission !== 'edit') return;
        try {
            await setDoc(doc(db, 'settings', 'leave_notifications'), {
                recipients: notificationRecipients
            });
            setShowNotificationModal(false);
            alert("Notification settings saved.");
        } catch (err) {
            console.error("Error saving notification settings:", err);
            alert("Failed to save settings.");
        }
    };

    const toggleRecipient = (email) => {
        setNotificationRecipients(prev =>
            prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]
        );
    };

    // Listen to single employee data
    useEffect(() => {
        let unsubscribe;
        if (numSelected === 1) {
            const selectedId = Object.keys(selectedEmployees).find(id => selectedEmployees[id]);
            if (selectedId) {
                const employeeDocRef = doc(db, 'employees', selectedId);
                unsubscribe = onSnapshot(employeeDocRef, (docSnap) => {
                    if (docSnap.exists()) {
                        setSelectedEmployeeData({ id: docSnap.id, ...docSnap.data() });
                    }
                });
            }
        } else {
            setSelectedEmployeeData(null);
        }
        return () => unsubscribe && unsubscribe();
    }, [selectedEmployees, numSelected]);

    // UTC-Safe Calendar Map (UPDATED for Ledger Model)
    const singleEmployeeCalendarLeave = useMemo(() => {
        if (numSelected !== 1 || !selectedEmployeeData) {
            return null;
        }
        const yearData = {};

        // 1. Process ONLY PENDING leave requests for visualization
        // Approved requests are now stored physically in the employee record
        allLeaveRequests
            .filter(req => req.employeeDocId === selectedEmployeeData.id && req.status === 'pending' && req.startDate.toDate().getFullYear() === currentYear)
            .forEach(req => {
                const startDate = req.startDate.toDate();
                const endDate = req.endDate.toDate();
                const isHalf = req.isHalfDay;

                for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                    if (d.getFullYear() === currentYear) {
                        const dayKey = `${d.getMonth() + 1}-${d.getDate()}`;
                        const dateString = `${currentYear}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

                        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                        const isHoliday = !!holidays[dayKey];
                        const isShutdown = shutdowns.includes(dateString);

                        if (!isWeekend && !isHoliday && !isShutdown) {
                            yearData[dayKey] = {
                                type: req.leaveType === 'Sick' ? 'sick' : 'leave',
                                hours: isHalf ? 4 : 8,
                                status: 'pending' // Force status pending for requests collection
                            };
                        }
                    }
                }
            });

        // 2. Merge existing data from Employee Profile (Approved Leave, Sick, Work Overrides)
        const granularLeaveForYear = selectedEmployeeData.leave?.[currentYear];
        if (granularLeaveForYear) {
            for (const dayKey in granularLeaveForYear) {
                yearData[dayKey] = {
                    ...yearData[dayKey],
                    ...granularLeaveForYear[dayKey]
                };
            }
        }

        return { [currentYear]: yearData };

    }, [selectedEmployeeData, allLeaveRequests, currentYear, numSelected, holidays, shutdowns]);


    const handleEmployeeSelection = (employeeId) => {
        setSelectedEmployees(prev => ({ ...prev, [employeeId]: !prev[employeeId] }));
    };

    const handleSelectAll = (e) => {
        const isChecked = e.target.checked;
        const newSelected = {};
        if (isChecked) employees.forEach(emp => newSelected[emp.id] = true);
        setSelectedEmployees(newSelected);
    };

    // Filter employees based on employment dates in the SELECTED YEAR
    const visibleEmployees = useMemo(() => {
        return employees.filter(emp => {
            const parseYear = (dateVal) => {
                if (!dateVal) return null;
                const d = new Date(dateVal);
                return isNaN(d.getTime()) ? null : d.getFullYear();
            };

            const startYear = parseYear(emp.startDate) || 0;
            const endYear = parseYear(emp.endDate) || 9999;

            const isActiveInYear = startYear <= currentYear && endYear >= currentYear;
            if (!isActiveInYear) return false;

            if (!searchTerm) return true;
            const searchLower = searchTerm.toLowerCase();
            const fullName = `${emp.name} ${emp.surname}`.toLowerCase();
            return fullName.includes(searchLower);
        });
    }, [employees, currentYear, searchTerm]);

    // --- AGGREGATED LEAVE REQUESTS FOR MULTI-VIEW ---
    const filteredLeaveRequests = useMemo(() => {
        if (numSelected <= 1) return [];
        const selectedIds = Object.keys(selectedEmployees).filter(id => selectedEmployees[id]);

        // 1. Formal Requests (ONLY PENDING)
        const yearStartDate = new Date(Date.UTC(currentYear, 0, 1));
        const yearEndDate = new Date(Date.UTC(currentYear, 11, 31, 23, 59, 59));

        const formalRequests = allLeaveRequests.filter(req => {
            const reqStartDate = req.startDate.toDate();
            return req.status === 'pending' && selectedIds.includes(req.employeeDocId) && // Changed to 'pending' only
                reqStartDate >= yearStartDate && reqStartDate <= yearEndDate;
        });

        // 2. Employee Profile Data (Approved & Manual)
        const manualRequests = [];

        selectedIds.forEach(empId => {
            const emp = employees.find(e => e.id === empId);
            if (!emp || !emp.leave || !emp.leave[currentYear]) return;

            Object.entries(emp.leave[currentYear]).forEach(([dayKey, data]) => {
                // Skip 'work' overrides for the list view usually, but here we only care about leave
                if (data.type === 'work') return;

                const [m, d] = dayKey.split('-').map(Number);
                const date = new Date(currentYear, m - 1, d);

                manualRequests.push({
                    id: `profile-${empId}-${dayKey}`,
                    employeeName: `${emp.name} ${emp.surname}`,
                    status: data.status || 'approved',
                    startDate: { toDate: () => date },
                    endDate: { toDate: () => date },
                    leaveType: data.type === 'sick' ? 'Sick' : 'Vacation',
                    isHalfDay: data.hours === 4,
                    isManual: true
                });
            });
        });

        return [...formalRequests, ...manualRequests];

    }, [selectedEmployees, allLeaveRequests, currentYear, numSelected, employees]);

    const updateEmployeeLeave = async (dayKey, data) => {
        if (!selectedEmployeeData || permission !== 'edit') return;
        const employeeRef = doc(db, "employees", selectedEmployeeData.id);
        const fieldPath = `leave.${currentYear}.${dayKey}`;
        try {
            if (data === null) {
                await updateDoc(employeeRef, { [fieldPath]: deleteField() });
            } else {
                await updateDoc(employeeRef, { [fieldPath]: data });
            }
        } catch (error) {
            console.error("Error updating employee leave:", error);
        }
    };

    const handleDayClick = (dateString, isWeekend, isHoliday, isBaseShutdown) => {
        if (!selectedEmployeeData || permission !== 'edit') return;
        if (isWeekend) {
            alert("Weekends cannot be modified.");
            return;
        }

        const date = new Date(dateString);
        const dayKey = `${date.getMonth() + 1}-${date.getDate()}`;
        const currentData = singleEmployeeCalendarLeave?.[currentYear]?.[dayKey];

        if (managementMode === 'sick') {
            if (isBaseShutdown && (!currentData || currentData.type === 'work' || currentData.type === 'leave')) {
                alert("Cannot add sick leave on a company shutdown/vacation."); return;
            }
            if (isHoliday) { alert("Cannot add sick leave on a public holiday."); return; }

            if (!currentData) updateEmployeeLeave(dayKey, { type: 'sick', hours: 4, status: 'approved' });
            else if (currentData.type === 'sick') {
                if (currentData.hours === 4) updateEmployeeLeave(dayKey, { type: 'sick', hours: 8, status: 'approved' });
                else updateEmployeeLeave(dayKey, null);
            }
            return;
        }

        if (managementMode === 'leave') {
            if (currentData?.type === 'sick') {
                alert("This day is Sick Leave. Switch modes to modify."); return;
            }
            if (isBaseShutdown) {
                if (!currentData) updateEmployeeLeave(dayKey, { type: 'work' }); // Override shutdown
                else if (currentData.type === 'work') updateEmployeeLeave(dayKey, { type: 'leave', hours: 4, status: 'approved' });
                else if (currentData.type === 'leave' && currentData.hours === 4) updateEmployeeLeave(dayKey, null);
                return;
            }
            if (isHoliday) { alert("Cannot book leave on a holiday."); return; }

            if (!isBaseShutdown && !isHoliday) {
                if (!currentData) {
                    updateEmployeeLeave(dayKey, { type: 'leave', hours: 4, status: 'approved' });
                } else if (currentData.type === 'leave') {
                    if (currentData.hours === 4) updateEmployeeLeave(dayKey, { type: 'leave', hours: 8, status: 'approved' });
                    else if (currentData.hours === 8) {
                        // Simply delete. No need to check for underlying requests anymore as approved requests are now IN the map.
                        updateEmployeeLeave(dayKey, null);
                    }
                } else if (currentData.type === 'work') {
                    // Logic for cycling Work Overrides
                    if (currentData.hours === 8) {
                        updateEmployeeLeave(dayKey, { type: 'work', hours: 4 });
                    } else {
                        updateEmployeeLeave(dayKey, null);
                    }
                }
            }
        }
    };

    // Updated calculation to handle Half Day correctly (0.5) AND Collect Details for Report
    const employeesWithLeave = useMemo(() => {
        const calculateLeaveForYear = (emp, year, yearShutdowns) => {
            let vacation = 0;
            let sick = 0;
            let overriddenShutdowns = 0;
            const finalLeaveMap = {};

            const vacationDetails = [];
            const sickDetails = [];

            // 1. Only map PENDING requests from the collection
            allLeaveRequests
                .filter(req => req.employeeDocId === emp.id && req.status === 'pending' && req.startDate.toDate().getFullYear() === year)
                .forEach(req => {
                    const startDate = req.startDate.toDate();
                    const endDate = req.endDate.toDate();
                    const isHalf = req.isHalfDay;

                    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                        if (d.getFullYear() === year) {
                            const dayKey = `${d.getMonth() + 1}-${d.getDate()}`;
                            finalLeaveMap[dayKey] = {
                                type: req.leaveType === 'Sick' ? 'sick' : 'leave',
                                hours: isHalf ? 4 : 8,
                                status: 'pending'
                            };
                        }
                    }
                });

            // 2. Map stored Employee Data (Approved Leave + Manual Entries)
            const granularLeaveForYear = emp.leave?.[year] || {};
            for (const dayKey in granularLeaveForYear) {
                finalLeaveMap[dayKey] = { ...finalLeaveMap[dayKey], ...granularLeaveForYear[dayKey] };
            }

            Object.entries(finalLeaveMap).sort((a, b) => {
                const [m1, d1] = a[0].split('-').map(Number);
                const [m2, d2] = b[0].split('-').map(Number);
                return (m1 - m2) || (d1 - d2);
            }).forEach(([dayKey, dayData]) => {
                // Determine deduction amount

                // Case: Work Override
                if (dayData.type === 'work') {
                    const [month, day] = dayKey.split('-').map(Number);
                    const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    if (yearShutdowns.includes(dateString)) {
                        overriddenShutdowns++;
                    }

                    // If work hours is 4, that means 4 hours of leave were still taken (if underlying request exists)
                    if (dayData.hours === 4) {
                        const dateStr = `${day}/${month}`;
                        vacation += 0.5;
                        vacationDetails.push(dateStr + ' (0.5 - Worked Half)');
                    }
                    return;
                }

                // Case: Normal Leave
                if (dayData.status === 'approved' || !dayData.status) {

                    // CALCULATION FIX: Strictly filter out Non-Working Days before counting
                    const [month, day] = dayKey.split('-').map(Number);
                    const date = new Date(year, month - 1, day);
                    const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                    const isHoliday = !!holidays[dayKey];
                    const isShutdown = yearShutdowns.includes(dateString);

                    if (!isWeekend && !isHoliday && !isShutdown) {
                        const deduction = dayData.hours === 4 ? 0.5 : 1;
                        const dateStr = `${day}/${month}`;

                        if (dayData.type === 'leave') {
                            vacation += deduction;
                            vacationDetails.push(dateStr + (deduction === 0.5 ? ' (0.5)' : ''));
                        }
                        else if (dayData.type === 'sick') {
                            sick += deduction;
                            sickDetails.push(dateStr + (deduction === 0.5 ? ' (0.5)' : ''));
                        }
                    }
                }
            });

            const yearEntitlement = emp.entitlements?.[year] || {};
            const totalEntitlement = (parseFloat(yearEntitlement.statutoryLeave) || 0) + (parseFloat(yearEntitlement.leaveCarriedForward) || 0);
            const effectiveShutdowns = yearShutdowns.length - overriddenShutdowns;
            const remainingLeave = totalEntitlement - effectiveShutdowns - vacation;

            return {
                remainingLeave,
                sickLeaveTaken: sick,
                entitlement: totalEntitlement,
                taken: vacation,
                effectiveShutdowns,
                details: { vacation: vacationDetails, sick: sickDetails }
            };
        };

        return employees.map(emp => {
            const currentYearShutdowns = shutdowns.filter(d => d.startsWith(`${currentYear}-`));
            const currentYearLeave = calculateLeaveForYear(emp, currentYear, currentYearShutdowns);
            return {
                ...emp,
                remainingLeave: currentYearLeave.remainingLeave,
                sickLeaveTaken: currentYearLeave.sickLeaveTaken,
                entitlement: currentYearLeave.entitlement,
                taken: currentYearLeave.taken,
                effectiveShutdowns: currentYearLeave.effectiveShutdowns,
                details: currentYearLeave.details
            };
        });
    }, [employees, allLeaveRequests, shutdowns, currentYear, entitlementYear, holidays]);

    // --- UPDATED: HANDLE REQUEST STATUS (Ledger Logic) ---
    const handleRequestStatus = async (requestId, newStatus) => {
        if (permission !== 'edit') return;

        const requestObj = allLeaveRequests.find(r => r.id === requestId);
        if (!requestObj) return;

        try {
            if (newStatus === 'approved') {
                const batch = writeBatch(db);
                const empRef = doc(db, "employees", requestObj.employeeDocId);
                const requestRef = doc(db, "leaveRequests", requestId);

                const startDate = requestObj.startDate.toDate();
                const endDate = requestObj.endDate.toDate();

                const updateMap = {};

                for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                    const currentYear = d.getFullYear();
                    const dayKey = `${d.getMonth() + 1}-${d.getDate()}`;
                    const dateString = `${currentYear}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

                    // Check Weekend
                    const dayOfWeek = d.getDay();
                    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

                    // Check Holiday
                    if (holidays[dayKey]) continue;

                    // Check Shutdown
                    if (shutdowns.includes(dateString)) continue;

                    // Add to map: leave.{year}.{dayKey}
                    const fieldPath = `leave.${currentYear}.${dayKey}`;
                    updateMap[fieldPath] = {
                        type: requestObj.leaveType === 'Sick' ? 'sick' : 'leave',
                        hours: requestObj.isHalfDay ? 4 : 8,
                        status: 'approved',
                        requestId: requestId
                    };
                }

                // Write days to Employee Profile
                if (Object.keys(updateMap).length > 0) {
                    batch.update(empRef, updateMap);
                }

                // Update Status
                batch.update(requestRef, { status: newStatus });

                await batch.commit();

                // Notify if configured
                const settingsRef = doc(db, 'settings', 'leave_notifications');
                const settingsSnap = await getDoc(settingsRef);
                const recipients = settingsSnap.exists() ? settingsSnap.data().recipients : [];
                if (recipients && recipients.length > 0) {
                    const sendLeaveNotification = httpsCallable(functions, 'sendLeaveNotification');
                    // Notification Logic here if desired for approval
                }

            } else {
                // Deny/Cancel
                const requestRef = doc(db, "leaveRequests", requestId);
                await updateDoc(requestRef, { status: newStatus });
            }
        } catch (error) {
            console.error("Error updating request status:", error);
            alert("Failed to update status.");
        }
    };

    // --- MIGRATION UTILITY ---
    const handleMigrateLegacyData = async () => {
        if (!window.confirm("This will process all old 'Approved' requests and write them permanently to employee profiles. This fixes the 'bubble' issue for past leave. Continue?")) return;

        setMigrating(true);
        try {
            const batch = writeBatch(db);
            let opCount = 0;
            const updates = {}; // Key: EmployeeID, Value: Map of updates

            const approvedRequests = allLeaveRequests.filter(r => r.status === 'approved');

            approvedRequests.forEach(req => {
                const startDate = req.startDate.toDate();
                const endDate = req.endDate.toDate();
                const empId = req.employeeDocId;

                for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                    const currentYear = d.getFullYear();
                    const dayKey = `${d.getMonth() + 1}-${d.getDate()}`;

                    // Skip weekends, holidays, shutdowns
                    const dayOfWeek = d.getDay();
                    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

                    // Simple holiday check (might vary by year logic but approximation is okay for migration)
                    // We reuse current year holidays map if year matches, otherwise rough approximation or skip strict check
                    // Ideally we should generate holidays for that specific year.
                    // For safety, let's write it. If it overlaps a holiday, UI will hide it anyway.

                    const fieldPath = `leave.${currentYear}.${dayKey}`;

                    if (!updates[empId]) updates[empId] = {};

                    // Only write if not already there (manual edits take precedence)
                    const emp = employees.find(e => e.id === empId);
                    const existing = emp?.leave?.[currentYear]?.[dayKey];

                    if (!existing) {
                        updates[empId][fieldPath] = {
                            type: req.leaveType === 'Sick' ? 'sick' : 'leave',
                            hours: req.isHalfDay ? 4 : 8,
                            status: 'approved',
                            requestId: req.id,
                            migrated: true
                        };
                    }
                }
            });

            // Commit batches
            for (const [empId, data] of Object.entries(updates)) {
                if (Object.keys(data).length > 0) {
                    const ref = doc(db, 'employees', empId);
                    batch.update(ref, data);
                    opCount++;
                }
            }

            if (opCount > 0) {
                await batch.commit();
                alert(`Migration successful. Updated profiles for ${opCount} employees.`);
            } else {
                alert("No legacy data needed migration.");
            }

        } catch (e) {
            console.error(e);
            alert("Migration failed: " + e.message);
        } finally {
            setMigrating(false);
        }
    };

    const handleEntitlementChange = (employeeId, field, value) => {
        if (permission !== 'edit') return;
        const numericValue = value === '' ? '' : Number(value);
        if (!isNaN(numericValue) && numericValue >= 0) {
            setEditingEntitlement(prev => ({
                ...prev,
                [employeeId]: {
                    ...(prev[employeeId] || (employees.find(e => e.id === employeeId)?.entitlements?.[entitlementYear] || {})),
                    [field]: numericValue
                }
            }));
        }
    };

    const handleSaveEntitlement = async (employeeId) => {
        if (permission !== 'edit') return;
        const entitlementData = editingEntitlement[employeeId];
        if (!entitlementData) return;

        const employeeRef = doc(db, "employees", employeeId);
        try {
            const dataToUpdate = {
                [`entitlements.${entitlementYear}.statutoryLeave`]: entitlementData.statutoryLeave ?? 0,
                [`entitlements.${entitlementYear}.leaveCarriedForward`]: entitlementData.leaveCarriedForward ?? 0,
            };
            await updateDoc(employeeRef, dataToUpdate);
            setEditingEntitlement(prev => {
                const newState = { ...prev };
                delete newState[employeeId];
                return newState;
            });
        } catch (error) {
            console.error("Error saving entitlement:", error);
        }
    };

    const handleBulkSetStatutory = () => {
        if (permission !== 'edit') return;
        const value = Number(bulkStatutoryLeave);
        if (isNaN(value) || value < 0) {
            alert("Please enter a valid non-negative number for statutory leave.");
            return;
        }

        const newEditingEntitlement = {};
        employees.forEach(emp => {
            const existingData = editingEntitlement[emp.id] || emp.entitlements?.[entitlementYear] || {};
            newEditingEntitlement[emp.id] = {
                ...existingData,
                statutoryLeave: value
            };
        });
        setEditingEntitlement(newEditingEntitlement);
    };

    const RequestList = ({ employees, allLeaveRequests, shutdowns, currentYear }) => {
        const selectedIds = Object.keys(selectedEmployees).filter(id => selectedEmployees[id]);

        const calculateRemainingLeave = (employeeId) => {
            const employee = employeesWithLeave.find(e => e.id === employeeId);
            return employee ? employee.remainingLeave : 'N/A';
        };

        const requests = allLeaveRequests
            .filter(r => {
                const matchesStatus = r.status === 'pending'; // Only show pending here
                const matchesEmployee = selectedIds.length > 0 ? selectedIds.includes(r.employeeDocId) : true;
                return matchesStatus && matchesEmployee;
            })
            .sort((a, b) => b.requestedAt.toDate() - a.requestedAt.toDate());

        return (
            <div className="space-y-3">
                {requests.length === 0 ? <p className="text-gray-500 text-center py-4">No pending requests.</p> : requests.map(req => {
                    const remainingLeave = calculateRemainingLeave(req.employeeDocId);
                    return (
                        <div key={req.id} className="bg-gray-50 p-3 rounded-md border border-gray-200">
                            <p className="font-semibold">
                                {req.employeeName}
                                <span className={`ml-2 font-normal text-sm ${remainingLeave < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                    ({Number(remainingLeave).toFixed(1).replace(/\.0$/, '')} days remaining)
                                </span>
                            </p>
                            <p className="text-sm text-gray-600">{req.startDate.toDate().toLocaleDateString('en-GB')} - {req.endDate.toDate().toLocaleDateString('en-GB')} ({req.totalDays} days)</p>
                            {req.isHalfDay && <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full ml-2">Half Day</span>}
                            {req.reason && <p className="text-sm text-gray-500 mt-1 italic">"{req.reason}"</p>}
                            {permission === 'edit' && (
                                <div className="flex justify-end gap-2 mt-2">
                                    <button onClick={() => handleRequestStatus(req.id, 'denied')} className="p-1 text-red-600 hover:bg-red-100 rounded-full"><XMarkIcon className="h-5 w-5" /></button>
                                    <button onClick={() => handleRequestStatus(req.id, 'approved')} className="p-1 text-green-600 hover:bg-green-100 rounded-full"><CheckIcon className="h-5 w-5" /></button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 flex flex-col gap-6">

                {permission === 'edit' && (
                    <div className="bg-white rounded-lg shadow-sm p-4 flex justify-between items-center">
                        <div>
                            <h3 className="font-semibold text-gray-800">Notifications</h3>
                            <p className="text-xs text-gray-500">Configure who gets emailed for new requests.</p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowReportModal(true)}
                                className="p-2 bg-green-50 text-green-600 rounded-full hover:bg-green-100"
                                title="Download Leave Report"
                            >
                                <DocumentArrowDownIcon className="h-5 w-5" />
                            </button>
                            <button
                                onClick={() => setShowNotificationModal(true)}
                                className="p-2 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100"
                                title="Configure Notifications"
                            >
                                <Cog6ToothIcon className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                )}

                <div className="bg-white rounded-lg shadow-sm">
                    <h3 className="p-4 border-b font-semibold text-lg">Filter Calendar by Employee</h3>
                    <div className="p-4">
                        <input
                            type="text"
                            placeholder="Search employees..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
                        />
                    </div>
                    <div className="p-4 max-h-80 overflow-y-auto">
                        <div className="flex items-center mb-2"><input type="checkbox" id="select-all" onChange={handleSelectAll} className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-600 mr-2" /><label htmlFor="select-all">Select All</label></div>
                        {visibleEmployees.map(emp => {
                            const empStats = employeesWithLeave.find(e => e.id === emp.id);
                            const remDisplay = empStats?.remainingLeave !== undefined ? Number(empStats.remainingLeave).toFixed(1).replace(/\.0$/, '') : 'N/A';
                            const sickDisplay = empStats?.sickLeaveTaken !== undefined ? Number(empStats.sickLeaveTaken).toFixed(1).replace(/\.0$/, '') : '0';

                            return (
                                <div key={emp.id} className="flex items-start py-1">
                                    <input type="checkbox" id={emp.id} checked={!!selectedEmployees[emp.id]} onChange={() => handleEmployeeSelection(emp.id)} className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-600 mr-2 mt-1" />
                                    <div>
                                        <label htmlFor={emp.id} className="font-medium">{emp.surname}, {emp.name}</label>
                                        <div className="text-xs mt-0.5">
                                            <span className={empStats?.remainingLeave < 0 ? 'text-red-600 font-semibold' : 'text-gray-500 font-medium'}>
                                                Rem: {remDisplay}
                                            </span> <span className="mx-1 text-gray-300">|</span> <span className="text-yellow-600 font-medium">Sick: {sickDisplay}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div>
                    <div className="border-b border-gray-200">
                        <nav className="-mb-px flex gap-x-6" aria-label="Tabs">
                            <button onClick={() => setActiveTab('requests')} className={`py-3 px-1 border-b-2 text-base font-medium ${activeTab === 'requests' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Leave Requests</button>
                            <button onClick={() => setActiveTab('entitlements')} className={`py-3 px-1 border-b-2 text-base font-medium ${activeTab === 'entitlements' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Entitlements</button>
                        </nav>
                    </div>

                    {activeTab === 'requests' && (
                        <div className="bg-white rounded-b-lg shadow-sm p-4">
                            <h4 className="font-semibold text-gray-700 mt-2 mb-2">Pending</h4>
                            <RequestList employees={employees} allLeaveRequests={allLeaveRequests} shutdowns={shutdowns} currentYear={currentYear} />
                        </div>
                    )}

                    {activeTab === 'entitlements' && (
                        <div className="bg-white rounded-b-lg shadow-sm overflow-x-auto">
                            <div className="p-4 border-b">
                                <label htmlFor="entitlement-year" className="block text-sm font-medium text-gray-700">Year</label>
                                <select id="entitlement-year" value={entitlementYear} onChange={(e) => setEntitlementYear(Number(e.target.value))} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-orange-500 focus:border-orange-500 sm:text-sm rounded-md">
                                    {Array.from({ length: new Date().getFullYear() - 2024 + 2 }, (_, i) => 2024 + i).map(year => (
                                        <option key={year} value={year}>{year}</option>
                                    ))}
                                </select>
                                {permission === 'edit' && (
                                    <div className="mt-4">
                                        <label htmlFor="bulk-statutory" className="block text-sm font-medium text-gray-700">Set Statutory Leave for All</label>
                                        <div className="mt-1 flex rounded-md shadow-sm">
                                            <input type="number" step="0.5" id="bulk-statutory" value={bulkStatutoryLeave} onChange={e => setBulkStatutoryLeave(e.target.value)} className="block w-full min-w-0 flex-1 rounded-none rounded-l-md border-gray-300 px-3 py-2 focus:border-orange-500 focus:ring-orange-500 sm:text-sm" />
                                            <button onClick={handleBulkSetStatutory} type="button" className="inline-flex items-center rounded-r-md border border-l-0 border-gray-300 bg-gray-50 px-4 text-sm text-gray-500 hover:bg-gray-100">Set for All</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="p-3 text-left font-semibold">Employee</th>
                                        <th className="p-3 text-left font-semibold">Statutory</th>
                                        <th className="p-3 text-left font-semibold">Carried</th>
                                        {permission === 'edit' && <th className="p-3 text-left font-semibold">Actions</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {employeesWithLeave.filter(emp => visibleEmployees.find(v => v.id === emp.id)).map(emp => {
                                        const hasSavedCarried = emp.entitlements?.[entitlementYear]?.leaveCarriedForward !== undefined;
                                        const carriedValue = hasSavedCarried ? emp.entitlements[entitlementYear].leaveCarriedForward : 0;

                                        const editedEntitlement = editingEntitlement[emp.id] || {
                                            statutoryLeave: emp.entitlements?.[entitlementYear]?.statutoryLeave ?? '',
                                            leaveCarriedForward: carriedValue
                                        };

                                        return (
                                            <tr key={emp.id} className="border-t">
                                                <td className="p-3 whitespace-nowrap">{emp.surname}, {emp.name}</td>
                                                <td className="p-3"><input type="number" step="0.5" value={editedEntitlement.statutoryLeave} onChange={(e) => handleEntitlementChange(emp.id, 'statutoryLeave', e.target.value)} disabled={permission !== 'edit'} className="w-20 p-1 border rounded disabled:bg-gray-100" /></td>
                                                <td className="p-3"><input type="number" step="0.5" value={editedEntitlement.leaveCarriedForward} onChange={(e) => handleEntitlementChange(emp.id, 'leaveCarriedForward', e.target.value)} disabled={permission !== 'edit'} className={`w-20 p-1 border rounded disabled:bg-gray-100`} /></td>
                                                {permission === 'edit' && (
                                                    <td className="p-3"><button onClick={() => handleSaveEntitlement(emp.id)} disabled={!editingEntitlement[emp.id]} className="px-3 py-1 bg-orange-600 text-white rounded disabled:bg-gray-300">Save</button></td>
                                                )}
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Column for Calendar - Same as before */}
            <div className="lg:col-span-2 bg-gray-50 p-6 rounded-lg shadow-sm">
                <div className="flex justify-between items-center mb-4 px-4">
                    <button onClick={() => setCurrentYear(y => y - 1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronLeftIcon className="h-7 w-7 text-gray-600" /></button>
                    <h2 className="text-3xl font-bold text-gray-800 text-center">
                        {numSelected === 1 && selectedEmployeeData ? `${selectedEmployeeData.name} ${selectedEmployeeData.surname}'s Calendar` : `${currentYear} Combined Calendar`}
                    </h2>
                    <button onClick={() => setCurrentYear(y => y + 1)} className="p-2 rounded-full hover:bg-gray-200"><ChevronRightIcon className="h-7 w-7 text-gray-600" /></button>
                </div>

                {numSelected === 1 && permission === 'edit' && (
                    <div className="flex justify-center items-center gap-6 mb-4 p-2 bg-white rounded-lg shadow-sm">
                        <h3 className="font-semibold">Editing Mode:</h3>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="radio" name="managementMode" value="leave" checked={managementMode === 'leave'} onChange={(e) => setManagementMode(e.target.value)} className="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300" />
                            Vacation Leave
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="radio" name="managementMode" value="sick" checked={managementMode === 'sick'} onChange={(e) => setManagementMode(e.target.value)} className="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300" />
                            Sick Leave
                        </label>
                    </div>
                )}

                <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mb-6 text-base">
                    {/* Legend Update - REMOVED CANCELLED, ADDED MULTIPLE */}
                    <div className="flex items-center"><span className="h-5 w-5 rounded-full bg-teal-400 mr-2"></span> Pending Vacation</div>
                    <div className="flex items-center"><span className="h-5 w-5 rounded-full bg-green-500 mr-2"></span> Full Vacation</div>
                    <div className="flex items-center"><span className="h-5 w-5 rounded-full half-day-green mr-2"></span> Half Vacation</div>
                    <div className="flex items-center"><span className="h-5 w-5 rounded-full bg-yellow-400 mr-2"></span> Full Sick</div>
                    <div className="flex items-center"><span className="h-5 w-5 rounded-full half-day-yellow mr-2"></span> Half Sick</div>
                    <div className="flex items-center"><span className="h-5 w-5 rounded-full bg-orange-500 mr-2"></span> Shutdown</div>
                    <div className="flex items-center"><span className="h-5 w-5 rounded-full bg-purple-500 mr-2"></span> Multiple Staff Off</div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {Array.from({ length: 12 }).map((_, i) => (
                        <MonthView
                            key={i} year={currentYear} month={i} holidays={holidays} shutdowns={shutdowns}
                            leaveRequests={filteredLeaveRequests}
                            selectedEmployeeData={selectedEmployeeData}
                            employeeLeaveMap={singleEmployeeCalendarLeave}
                            onDayClick={handleDayClick}
                            managementMode={managementMode}
                            isEditModeEnabled={permission === 'edit'} // Pass permission down
                        />
                    ))}
                </div>
            </div>

            {/* Notification Modal - Same as before */}
            <Modal show={showNotificationModal} onClose={() => setShowNotificationModal(false)} title="Configure Leave Notifications">
                <div className="space-y-4">
                    <p className="text-sm text-gray-600">Select employees who should receive an email notification when a new leave request is lodged.</p>
                    <div className="relative">
                        <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-2.5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search employees..."
                            value={recipientSearchTerm}
                            onChange={(e) => setRecipientSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500 text-sm"
                        />
                    </div>
                    <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-md p-2">
                        {employees
                            .filter(emp => emp.companyEmail || emp.workEmail)
                            .filter(emp => {
                                const email = emp.companyEmail || emp.workEmail;
                                const name = `${emp.name} ${emp.surname}`;
                                const term = recipientSearchTerm.toLowerCase();
                                return email.toLowerCase().includes(term) || name.toLowerCase().includes(term);
                            })
                            .map(emp => {
                                const email = emp.companyEmail || emp.workEmail;
                                const isSelected = notificationRecipients.includes(email);
                                return (
                                    <div key={emp.id} className="flex items-center p-2 hover:bg-gray-50 cursor-pointer" onClick={() => toggleRecipient(email)}>
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => { }}
                                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded mr-3"
                                        />
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-gray-900">{emp.name} {emp.surname}</div>
                                            <div className="text-xs text-gray-500">{email}</div>
                                        </div>
                                    </div>
                                );
                            })
                        }
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                        <span className="text-xs text-gray-500">{notificationRecipients.length} recipients selected</span>
                        <div className="flex space-x-2">
                            {/* NEW: Migration Button */}
                            <button
                                onClick={handleMigrateLegacyData}
                                disabled={migrating}
                                className="px-3 py-2 bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-md text-sm hover:bg-yellow-100 flex items-center"
                                title="Run this ONCE to fix old leave data format"
                            >
                                {migrating ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : "Migrate Legacy Data"}
                            </button>

                            <button onClick={() => setShowNotificationModal(false)} className="px-3 py-2 bg-white border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
                            <button onClick={handleSaveNotifications} className="px-3 py-2 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700">Save Settings</button>
                        </div>
                    </div>
                </div>
            </Modal>

            {/* Report Modal */}
            <LeaveReport
                show={showReportModal}
                onClose={() => setShowReportModal(false)}
                employees={employeesWithLeave.filter(emp => visibleEmployees.find(v => v.id === emp.id))} // Pass only visible/relevant employees
                year={currentYear}
            />

        </div>
    );
};

export default LeaveManagement;