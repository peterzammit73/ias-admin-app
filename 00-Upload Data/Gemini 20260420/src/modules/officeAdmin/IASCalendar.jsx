// File location: src/modules/officeAdmin/IASCalendar.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase.js';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/solid';

// --- Helper Functions & Data ---
// ... (Keeping helpers same)
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
        '1-1': "New Year's Day",
        '2-10': "Feast of St. Paul's Shipwreck",
        '3-19': "Feast of St. Joseph",
        '3-31': "Freedom Day",
        [`${goodFriday.getMonth() + 1}-${goodFriday.getDate()}`]: "Good Friday",
        '5-1': "Worker's Day",
        '6-7': "Sette Giugno",
        '6-29': "Feast of St. Peter & St. Paul",
        '8-15': "Feast of the Assumption",
        '9-8': "Feast of Our Lady of Victories",
        '9-21': "Independence Day",
        '12-8': "Feast of the Immaculate Conception",
        '12-13': "Republic Day",
        '12-25': "Christmas Day",
    };
    return holidays;
};

const MonthView = ({ year, month, holidays, shutdowns, onDayDoubleClick }) => {
    const monthName = new Date(year, month).toLocaleString('en-US', { month: 'long' });
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=Sun, 1=Mon...
    const emptyDays = (firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1);

    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const blanks = Array.from({ length: emptyDays }, (_, i) => `blank-${i}`);

    return (
        <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-xl font-semibold text-center mb-3 text-gray-800">{monthName}</h3>
            <div className="grid grid-cols-7 gap-1 text-center text-base">
                {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(day => (
                    <div key={day} className="font-semibold text-gray-500 pb-2">{day}</div>
                ))}
                {blanks.map(blank => <div key={blank}></div>)}
                {days.map(day => {
                    const date = new Date(year, month, day);
                    const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const dayKey = `${month + 1}-${day}`;
                    const weekday = date.getDay(); // 0=Sun, 6=Sat

                    const isWeekend = weekday === 0 || weekday === 6;
                    const isHoliday = !!holidays[dayKey];
                    const isShutdown = shutdowns.includes(dateString);

                    let dayClasses = "w-full aspect-square flex items-center justify-center rounded-full cursor-pointer transition-colors duration-200 font-semibold";
                    if (isShutdown) {
                        dayClasses += " bg-orange-500 text-white font-bold hover:bg-orange-600";
                    } else if (isHoliday) {
                        dayClasses += " text-red-600 bg-red-50 hover:bg-red-100";
                    } else if (isWeekend) {
                        dayClasses += " text-gray-400 bg-gray-50";
                    } else {
                        dayClasses += " text-gray-700 hover:bg-gray-100";
                    }
                    
                    return (
                        <div key={day} className="flex justify-center items-center" onDoubleClick={() => onDayDoubleClick(dateString, isShutdown, isWeekend, isHoliday)}>
                           <div className={dayClasses} title={holidays[dayKey] || ''}>
                                {day}
                           </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};


const IASCalendar = ({ permission }) => {
    const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
    const [shutdowns, setShutdowns] = useState([]);
    const [loading, setLoading] = useState(true);

    const holidays = useMemo(() => publicHolidays(currentYear), [currentYear]);

    useEffect(() => {
        setLoading(true);
        const docRef = doc(db, 'company_holidays', String(currentYear));
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                setShutdowns(docSnap.data().shutdowns || []);
            } else {
                setShutdowns([]);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, [currentYear]);

    const handleDayDoubleClick = async (dateString, isCurrentlyShutdown, isWeekend, isHoliday) => {
        if (permission !== 'edit') {
            alert("You do not have permission to edit company shutdowns.");
            return;
        }

        // Prevent setting a shutdown on a weekend or public holiday
        if (!isCurrentlyShutdown && (isWeekend || isHoliday)) {
            alert("You cannot set a company shutdown on a weekend or a public holiday.");
            return;
        }

        const newShutdowns = isCurrentlyShutdown
            ? shutdowns.filter(d => d !== dateString)
            : [...shutdowns, dateString].sort();

        try {
            const docRef = doc(db, 'company_holidays', String(currentYear));
            await setDoc(docRef, { shutdowns: newShutdowns });
        } catch (error) {
            console.error("Error updating shutdowns:", error);
            alert("Failed to update company shutdowns.");
        }
    };
    
    if (loading) {
        return <div className="p-6 text-center text-lg">Loading calendar...</div>
    }

    return (
        <div className="bg-gray-50 p-6 rounded-lg shadow-sm">
            <div className="flex justify-between items-center mb-6 px-4">
                <button onClick={() => setCurrentYear(y => y - 1)} className="p-2 rounded-full hover:bg-gray-200">
                    <ChevronLeftIcon className="h-7 w-7 text-gray-600"/>
                </button>
                <h2 className="text-3xl font-bold text-gray-800">{currentYear} Company Calendar</h2>
                <button onClick={() => setCurrentYear(y => y + 1)} className="p-2 rounded-full hover:bg-gray-200">
                    <ChevronRightIcon className="h-7 w-7 text-gray-600"/>
                </button>
            </div>
            <div className="text-center mb-4 text-lg font-semibold text-gray-700">
                Total Shutdown Days: {shutdowns.length}
            </div>

             <div className="flex items-center justify-center space-x-8 mb-6 text-base">
                <div className="flex items-center"><span className="h-5 w-5 rounded-full bg-red-50 border border-red-200 mr-2"></span> Public Holiday</div>
                <div className="flex items-center"><span className="h-5 w-5 rounded-full bg-orange-500 mr-2"></span> Company Shutdown</div>
                <div className="flex items-center"><span className="h-5 w-5 rounded-full bg-gray-50 border border-gray-200 mr-2"></span> Weekend</div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {Array.from({ length: 12 }).map((_, i) => (
                    <MonthView
                        key={i}
                        year={currentYear}
                        month={i}
                        holidays={holidays}
                        shutdowns={shutdowns}
                        onDayDoubleClick={handleDayDoubleClick}
                    />
                ))}
            </div>
        </div>
    );
};

export default IASCalendar;