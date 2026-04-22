// File Path: src/utils/dateUtils.js
// Version: 1.1 - Added excludeDates support for resource planning

// --- PUBLIC HOLIDAYS (Simplified for Client-Side Calculation) ---
const getFixedHolidays = (year) => {
    return [
        `${year}-01-01`, `${year}-02-10`, `${year}-03-19`, `${year}-03-31`,
        `${year}-05-01`, `${year}-06-07`, `${year}-06-29`, `${year}-08-15`,
        `${year}-09-08`, `${year}-09-21`, `${year}-12-08`, `${year}-12-13`, `${year}-12-25`
    ];
};

/**
 * Calculates the end date by adding working hours to a start date.
 * Skips weekends and any dates in the excludeDates array (YYYY-MM-DD strings).
 */
export const addWorkingDays = (startDateStr, hoursRequired, hoursPerDay = 8, excludeDates = []) => {
    if (!startDateStr || !hoursRequired) return startDateStr;

    let currentDate = new Date(startDateStr);
    let hoursRemaining = parseFloat(hoursRequired);

    // Safety break to prevent infinite loops
    let loops = 0;
    const maxLoops = 1000; // Allow for longer tasks (approx 3 years)

    while (hoursRemaining > 0 && loops < maxLoops) {
        const year = currentDate.getFullYear();
        const holidays = getFixedHolidays(year);
        const dateString = currentDate.toISOString().split('T')[0];
        const day = currentDate.getDay();

        const isWeekend = (day === 0 || day === 6);
        const isHoliday = holidays.includes(dateString);
        const isExcluded = excludeDates.includes(dateString);

        // If it's a working day (not weekend, not holiday, not excluded)
        if (!isWeekend && !isHoliday && !isExcluded) {
            hoursRemaining -= hoursPerDay;
        }

        // If we still have hours left, move to next day
        // If hoursRemaining <= 0, we stop, and currentDate is the End Date
        if (hoursRemaining > 0) {
            currentDate.setDate(currentDate.getDate() + 1);
        }
        loops++;
    }

    return currentDate.toISOString().split('T')[0];
};

export const getDaysArray = (start, end) => {
    const arr = [];
    const dt = new Date(start);
    const endDt = new Date(end);
    while (dt <= endDt) {
        arr.push(new Date(dt));
        dt.setDate(dt.getDate() + 1);
    }
    return arr;
};

export const getMonthWeeks = (year, month) => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days = getDaysArray(firstDay, lastDay);
    return days;
};