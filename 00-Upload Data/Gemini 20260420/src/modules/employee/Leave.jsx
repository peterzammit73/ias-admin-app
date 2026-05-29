import React, { useState, useEffect, useMemo } from 'react';
import { db, functions } from '../../firebase.js'; 
import { collection, query, where, onSnapshot, doc, addDoc, Timestamp, getDoc } from 'firebase/firestore'; 
import { httpsCallable } from 'firebase/functions'; 
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/solid';
import Modal from '../../components/Modal.jsx';

// --- Helper: Format Date to YYYY-MM-DD ---
const toDateKey = (date) => {
    if (!date) return '';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// --- Calendar Helper Functions ---
const getEaster = (year) => {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
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

const MonthView = ({ year, month, holidays, shutdowns, employeeLeaveMap }) => {
    const monthName = new Date(year, month).toLocaleString('en-US', { month: 'long' });
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const emptyDays = (firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1);

    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const blanks = Array.from({ length: emptyDays }, (_, i) => `blank-${i}`);

    return (
        <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-xl font-semibold text-center mb-3 text-gray-800">{monthName}</h3>
            <div className="grid grid-cols-7 gap-1 text-center text-base">
                {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(day => <div key={day} className="font-semibold text-gray-500 pb-2">{day}</div>)}
                {blanks.map(blank => <div key={blank}></div>)}
                {days.map(day => {
                    const date = new Date(year, month, day);
                    const dateString = toDateKey(date);
                    const dayKey = `${month + 1}-${day}`;
                    
                    const weekday = date.getDay();
                    const isWeekend = weekday === 0 || weekday === 6;
                    const isHoliday = !!holidays[dayKey];
                    const dayData = employeeLeaveMap?.[dateString];
                    const isShutdown = shutdowns.includes(dateString);

                    let dayClasses = "w-full aspect-square flex items-center justify-center rounded-full transition-colors duration-200 font-semibold";
                    let title = holidays[dayKey] || '';

                    if (dayData) {
                        if (dayData.type === 'work') {
                            // Work Override (e.g. working on a shutdown/leave day)
                            if (dayData.hours === 4) {
                                dayClasses += " bg-gradient-to-r from-green-500 to-white border-2 border-blue-500 text-gray-800 font-bold border-dashed"; 
                                title = 'Half Day Work (4h Leave Taken)';
                            } else {
                                dayClasses += " bg-white border-2 border-blue-500 text-blue-700 font-bold";
                                title = 'Working Day (Override)';
                            }
                        } else if (dayData.type === 'leave') {
                            if (dayData.status === 'pending') {
                                dayClasses += " bg-teal-400 text-white font-bold";
                                title = "Vacation Leave (Pending)";
                            } else {
                                // APPROVED LEAVE (From Ledger)
                                if (dayData.hours === 4) {
                                     dayClasses += " half-day-green"; 
                                     title = `Vacation (4 hrs)`;
                                } else {
                                     dayClasses += " bg-green-500 text-white font-bold";
                                     title = `Vacation (8 hrs)`;
                                }
                            }
                        } else if (dayData.type === 'sick') {
                             if (dayData.hours === 4) {
                                 dayClasses += " half-day-yellow"; 
                                 title = `Sick Leave (4 hrs)`;
                             } else {
                                 dayClasses += " bg-yellow-400 text-white font-bold";
                                 title = `Sick Leave (8 hrs)`;
                             }
                        }
                    } else if (isShutdown) {
                        dayClasses += " bg-orange-500 text-white font-bold";
                        title = "Company Shutdown";
                    } else if (isHoliday) {
                        dayClasses += " text-red-600 bg-red-50";
                    } else if (isWeekend) {
                        dayClasses += " text-gray-400 bg-gray-50";
                    } else {
                        dayClasses += " text-gray-700";
                    }

                    return (
                        <div key={day} className="flex justify-center items-center">
                           <div className={dayClasses} title={title}>{day}</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};


const Leave = ({ user }) => {
    const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
    const [shutdowns, setShutdowns] = useState([]);
    const [employeeData, setEmployeeData] = useState(null);
    const [leaveRequests, setLeaveRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showRequestModal, setShowRequestModal] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    
    // Form state
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [reason, setReason] = useState('');
    const [isHalfDay, setIsHalfDay] = useState(false);
    const [calculatedDays, setCalculatedDays] = useState(0);
    const [formError, setFormError] = useState('');

    const minYear = 2024;
    const maxYear = new Date().getFullYear() + 1;

    const holidays = useMemo(() => publicHolidays(currentYear), [currentYear]);

    // Fetch employee data (Real-time listener for Ledger Updates)
    useEffect(() => {
        if (!user) return;
        const q = query(collection(db, "employees"), where("companyEmail", "==", user.email));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!snapshot.empty) {
                const empData = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
                setEmployeeData(empData);
            }
        });
        return () => unsubscribe();
    }, [user]);

    // Fetch shutdowns and leave requests
    useEffect(() => {
        if (!employeeData) return;
        
        if (leaveRequests.length === 0 && shutdowns.length === 0) setLoading(true);

        const yearsToLoad = [currentYear, currentYear + 1];
        const unsubs = [];
        const shutdownResults = {};
        
        yearsToLoad.forEach(year => {
            const docRef = doc(db, 'company_holidays', String(year));
            const unsub = onSnapshot(docRef, (docSnap) => {
                shutdownResults[year] = docSnap.exists() ? (docSnap.data().shutdowns || []) : [];
                const allShutdowns = Array.from(new Set(Object.values(shutdownResults).flat()));
                setShutdowns(allShutdowns);
            });
            unsubs.push(unsub);
        });

        // Only fetch PENDING requests for the calendar visualization
        // Approved requests are now read directly from employeeData.leave
        const yearStartDate = new Date(Date.UTC(currentYear, 0, 1));
        const yearEndDate = new Date(Date.UTC(currentYear, 11, 31, 23, 59, 59));
        
        const leaveQuery = query(
            collection(db, "leaveRequests"),
            where("employeeDocId", "==", employeeData.id),
            where("status", "==", "pending"), // FILTER: Only Pending
            where("startDate", ">=", Timestamp.fromDate(yearStartDate)),
            where("startDate", "<=", Timestamp.fromDate(yearEndDate))
        );
        
        const unsubLeave = onSnapshot(leaveQuery, snapshot => {
            const requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setLeaveRequests(requests);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching leave requests:", error);
        });

        return () => {
            unsubs.forEach(u => u());
            unsubLeave();
        };
    }, [currentYear, employeeData]);
    
    // Calendar Calculation (Updated Logic)
    const employeeCalendarLeave = useMemo(() => {
        if (!employeeData) return null;
    
        const yearData = {}; 
    
        // 1. Process PENDING requests from 'leaveRequests'
        leaveRequests.forEach(req => {
            // Redundant check since we filter in query, but good for safety
            if (req.status !== 'pending') return;

            let s, e;
            try {
                if (req.startDate && typeof req.startDate.toDate === 'function') s = req.startDate.toDate();
                else if (req.startDate) s = new Date(req.startDate);
                
                if (req.endDate && typeof req.endDate.toDate === 'function') e = req.endDate.toDate();
                else if (req.endDate) e = new Date(req.endDate);

                if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) return; 
            } catch (err) { return; }
            
            const current = new Date(s);
            while (current <= e) {
                const year = current.getFullYear();
                if (year === currentYear) {
                    const dateString = toDateKey(current);
                    // const dayKey = `${current.getMonth() + 1}-${current.getDate()}`; // Unused
                    
                    const currentYearHolidays = publicHolidays(year);
                    const dayOfWeek = current.getDay();
                    const dayKey = `${current.getMonth() + 1}-${current.getDate()}`;
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                    const isHoliday = !!currentYearHolidays[dayKey];
                    const isShutdown = shutdowns.includes(dateString);

                    if (!isWeekend && !isHoliday && !isShutdown) {
                        yearData[dateString] = {
                            type: req.leaveType === 'Sick' ? 'sick' : 'leave',
                            hours: req.isHalfDay ? 4 : 8,
                            status: 'pending' 
                        };
                    }
                }
                current.setDate(current.getDate() + 1);
            }
        });
    
        // 2. Process APPROVED/LEDGER data from employee profile
        // This overwrites any pending calculation if a conflict exists (though strictly shouldn't happen)
        const granularLeaveForYear = employeeData.leave?.[currentYear];
        if (granularLeaveForYear) {
            for (const dayKey in granularLeaveForYear) {
                const [m, d] = dayKey.split('-').map(Number);
                const dateString = `${currentYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                
                const manualEntry = granularLeaveForYear[dayKey];
                yearData[dateString] = {
                    ...yearData[dateString], 
                    ...manualEntry,
                    status: manualEntry.status || 'approved' // Ledger items are approved by default
                };
            }
        }
    
        return yearData;
    
    }, [employeeData, leaveRequests, currentYear, shutdowns]);

    // Calculate working days for a new request
    useEffect(() => {
        if (startDate && endDate && startDate !== endDate && isHalfDay) {
            setIsHalfDay(false); 
        }

        if (startDate && endDate && employeeData) {
            const start = new Date(startDate); 
            const end = new Date(endDate);
            
            if (start > end) {
                setCalculatedDays(0);
                return;
            }

            let count = 0;
            const current = new Date(start);

            while (current <= end) {
                const year = current.getFullYear();
                const dateString = toDateKey(current);
                const dayKey = `${current.getMonth() + 1}-${current.getDate()}`;
                
                const currentYearHolidays = publicHolidays(year);
                const isWeekend = current.getDay() === 0 || current.getDay() === 6;
                const isHoliday = !!currentYearHolidays[dayKey];
                const isShutdown = shutdowns.includes(dateString);
                
                // Check if already booked in ledger
                const existingLedgerEntry = employeeData.leave?.[year]?.[dayKey];
                
                if (existingLedgerEntry?.type === 'work') {
                    count++; // Explicitly working
                } else if (existingLedgerEntry) {
                    // Already booked as leave/sick - Do not count as 'available to book'
                    // In fact, validation on submit will block this.
                } else if (!isWeekend && !isShutdown && !isHoliday) {
                    count++;
                }
                current.setDate(current.getDate() + 1);
            }
            
            if (isHalfDay) {
                setCalculatedDays(count * 0.5);
            } else {
                setCalculatedDays(count);
            }

        } else {
            setCalculatedDays(0);
        }
    }, [startDate, endDate, shutdowns, employeeData, isHalfDay]);

    const handleLeaveSubmit = async (e) => {
        e.preventDefault();
        setFormError('');
        if (submitting) return; 
        
        const start = new Date(startDate); 
        const end = new Date(endDate);
        const current = new Date(start);
        
        while (current <= end) {
            const dateString = toDateKey(current);
            const dayData = employeeCalendarLeave?.[dateString];
            
            // Check conflicts with Pending or Approved Ledger items
            if (dayData && (dayData.status === 'pending' || dayData.status === 'approved')) {
                 // Allow overlap only if it is a WORK override (meaning they are working that day)
                 if (dayData.type !== 'work') {
                     setFormError(`You already have a request or approved leave on ${dateString}.`);
                     return;
                 }
            }
            current.setDate(current.getDate() + 1);
        }

        if (!startDate || !endDate || calculatedDays <= 0) {
            setFormError('Please select a valid date range.');
            return;
        }
        if (calculatedDays > remainingLeave) {
            setFormError('You do not have enough remaining leave for this request.');
            return;
        }

        setSubmitting(true);

        try {
            const s = new Date(startDate); s.setHours(12,0,0,0);
            const eDate = new Date(endDate); eDate.setHours(12,0,0,0);

            await addDoc(collection(db, 'leaveRequests'), {
                employeeId: user.uid,
                employeeDocId: employeeData.id,
                employeeName: `${employeeData.name} ${employeeData.surname}`,
                employeeEmail: user.email,
                leaveType: 'Vacation',
                startDate: Timestamp.fromDate(s),
                endDate: Timestamp.fromDate(eDate),
                totalDays: calculatedDays,
                isHalfDay: isHalfDay, 
                reason,
                status: 'pending',
                requestedAt: Timestamp.now()
            });

            // Trigger Notification (Fire-and-forget)
            try {
                const settingsRef = doc(db, 'settings', 'leave_notifications');
                const settingsSnap = await getDoc(settingsRef);
                const recipients = settingsSnap.exists() ? settingsSnap.data().recipients : [];
                if (recipients && recipients.length > 0) {
                    const sendLeaveNotification = httpsCallable(functions, 'sendLeaveNotification');
                    sendLeaveNotification({
                        recipients,
                        requesterName: `${employeeData.name} ${employeeData.surname}`,
                        startDate: startDate, 
                        endDate: endDate      
                    }).catch(err => console.error("Notify failed", err));
                }
            } catch (notifyError) {
                console.error("Failed to trigger notification:", notifyError);
            }

            setShowRequestModal(false);
            setStartDate('');
            setEndDate('');
            setReason('');
            setIsHalfDay(false);

        } catch (error) {
            console.error("Error submitting leave request:", error);
            setFormError('Failed to submit leave request. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    // --- Summary Calculations (Updated for Ledger) ---
    const totalLeaveEntitlement = useMemo(() => {
        if (!employeeData) return 0;
        const yearEntitlement = employeeData.entitlements?.[currentYear] || {};
        return (yearEntitlement.statutoryLeave || 0) + (yearEntitlement.leaveCarriedForward || 0);
    }, [employeeData, currentYear]);

    const { approvedVacationDays, approvedSickDays, effectiveShutdownDays } = useMemo(() => {
        // Source of Truth for Approved Days is now the Ledger (employeeCalendarLeave)
        // Note: employeeCalendarLeave merges Pending + Ledger. We need to filter for 'approved' status/default.
        
        if (!employeeCalendarLeave) {
            return { approvedVacationDays: 0, approvedSickDays: 0, effectiveShutdownDays: shutdowns.length };
        }

        let vacation = 0;
        let sick = 0;
        let overriddenShutdowns = 0;

        Object.entries(employeeCalendarLeave).forEach(([dateString, dayData]) => {
             // Only count APPROVED items towards balance
             const isApproved = dayData.status === 'approved' || !dayData.status; // Manual entries might lack status but are approved

             if (isApproved) {
                if (dayData.type === 'leave') {
                    vacation += (dayData.hours === 4 ? 0.5 : 1);
                } else if (dayData.type === 'sick') {
                    sick += (dayData.hours === 4 ? 0.5 : 1);
                }
            }
            
            // Check for Work Overrides on Shutdown Days
            if (shutdowns.includes(dateString) && (dayData.type === 'work')) {
                 overriddenShutdowns++;
            }
        });
        
        const currentYearShutdowns = shutdowns.filter(d => d.startsWith(`${currentYear}-`));

        return { 
            approvedVacationDays: vacation, 
            approvedSickDays: sick,
            effectiveShutdownDays: currentYearShutdowns.length - overriddenShutdowns
        };

    }, [employeeCalendarLeave, currentYear, shutdowns]);

    const remainingLeave = useMemo(() => {
        if (totalLeaveEntitlement === 'N/A') return 'N/A';
        return totalLeaveEntitlement - effectiveShutdownDays - approvedVacationDays;
    }, [totalLeaveEntitlement, effectiveShutdownDays, approvedVacationDays]);
    
    const yearlyEntitlement = employeeData?.entitlements?.[currentYear] || {};

    return (
        <div className="space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-center">
                 <div className="bg-white p-4 rounded-lg shadow-sm">
                    <p className="text-base text-gray-500">Total Entitlement</p>
                    <p className="text-3xl font-bold text-gray-800">{totalLeaveEntitlement}</p>
                    <p className="text-sm text-gray-400 mt-1">
                        Statutory: {yearlyEntitlement.statutoryLeave || 0} + Carried: {yearlyEntitlement.leaveCarriedForward || 0}
                    </p>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm">
                    <p className="text-base text-gray-500">Shutdown Days</p>
                    <p className="text-3xl font-bold text-gray-800">{effectiveShutdownDays}</p>
                </div>
                 <div className="bg-white p-4 rounded-lg shadow-sm">
                    <p className="text-base text-gray-500">Vacation Taken</p>
                    <p className="text-3xl font-bold text-gray-800">{approvedVacationDays}</p>
                </div>
                 <div className="bg-white p-4 rounded-lg shadow-sm">
                    <p className="text-base text-gray-500">Remaining Vacation</p>
                    <p className="text-3xl font-bold text-green-600">{remainingLeave}</p>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm">
                    <p className="text-base text-gray-500">Sick Leave Taken</p>
                    <p className="text-3xl font-bold text-gray-800">{approvedSickDays}</p>
                </div>
            </div>

            <div className="bg-gray-50 p-6 rounded-lg shadow-sm">
                 <div className="flex justify-between items-center mb-6 px-4">
                    <button onClick={() => setCurrentYear(y => Math.max(minYear, y - 1))} disabled={currentYear <= minYear} className="p-2 rounded-full hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed">
                        <ChevronLeftIcon className="h-7 w-7 text-gray-600"/>
                    </button>
                    <div className="text-center">
                        <h2 className="text-3xl font-bold text-gray-800">{currentYear} Leave Calendar</h2>
                    </div>
                    <button onClick={() => setCurrentYear(y => Math.min(maxYear, y + 1))} disabled={currentYear >= maxYear} className="p-2 rounded-full hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed">
                        <ChevronRightIcon className="h-7 w-7 text-gray-600"/>
                    </button>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mb-6 text-base">
                    <div className="flex items-center"><span className="h-5 w-5 rounded-full bg-red-50 border border-red-200 mr-2"></span> Public Holiday</div>
                    <div className="flex items-center"><span className="h-5 w-5 rounded-full bg-orange-500 mr-2"></span> Company Shutdown</div>
                    <div className="flex items-center"><span className="h-5 w-5 rounded-full bg-teal-400 mr-2"></span> Pending Vacation</div>
                    <div className="flex items-center"><span className="h-5 w-5 rounded-full bg-green-500 mr-2"></span> Approved Vacation</div>
                    <div className="flex items-center"><span className="h-5 w-5 rounded-full bg-yellow-400 mr-2"></span> Approved Sick</div>
                </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                    {Array.from({ length: 12 }).map((_, i) => (
                        <MonthView
                            key={i} year={currentYear} month={i}
                            holidays={holidays} shutdowns={shutdowns} 
                            employeeLeaveMap={employeeCalendarLeave}
                        />
                    ))}
                </div>
            </div>
            
             <div className="text-center">
                <button onClick={() => setShowRequestModal(true)} className="bg-orange-600 text-white font-bold py-3 px-6 rounded-lg shadow-md hover:bg-orange-700 transition-colors">
                    Apply for Leave
                </button>
            </div>

            <Modal show={showRequestModal} onClose={() => setShowRequestModal(false)} title="Apply for Vacation Leave">
                <form onSubmit={handleLeaveSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-base font-medium text-gray-700">Start Date</label>
                            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 text-base" />
                        </div>
                        <div>
                            <label className="block text-base font-medium text-gray-700">End Date</label>
                            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 text-base" />
                             <p className="mt-2 text-sm text-gray-500">
                                This is your last day of leave. You will return to work on the next working day.
                            </p>
                        </div>
                    </div>

                    {/* HALF DAY OPTION: Only visible if Single Day Selected */}
                    {startDate && endDate && startDate === endDate && (
                        <div className="flex items-center bg-gray-50 p-2 rounded-md">
                            <input 
                                id="half-day" 
                                type="checkbox" 
                                checked={isHalfDay} 
                                onChange={(e) => setIsHalfDay(e.target.checked)}
                                className="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
                            />
                            <label htmlFor="half-day" className="ml-2 block text-sm text-gray-900 font-medium">
                                Request Half Day (0.5 days)
                            </label>
                        </div>
                    )}

                    <div className="bg-gray-50 p-4 rounded-lg text-center">
                        <p className="text-base font-medium text-gray-600">Total Working Days Requested</p>
                        <p className="text-2xl font-bold text-orange-600">{calculatedDays}</p>
                    </div>
                    <div>
                        <label className="block text-base font-medium text-gray-700">Reason (Optional)</label>
                        <textarea value={reason} onChange={e => setReason(e.target.value)} rows="3" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 text-base"></textarea>
                    </div>
                    
                    {formError && <p className="text-base text-center text-red-600">{formError}</p>}
                    
                    <div className="flex justify-end pt-6 border-t border-gray-200 mt-6">
                        <button type="button" onClick={() => setShowRequestModal(false)} className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-base font-medium text-gray-700 hover:bg-gray-50" disabled={submitting}>Cancel</button>
                        <button type="submit" className="ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-base font-medium rounded-md text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50" disabled={submitting}>
                            {submitting ? 'Submitting...' : 'Submit Request'}
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default Leave;