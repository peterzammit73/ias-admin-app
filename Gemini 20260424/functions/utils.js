// Root: functions/utils.js
const { db } = require("./config");
const functions = require("firebase-functions");

/**
 * Fetches project statuses and valid task codes for validation.
 */
const getValidationData = async () => {
    try {
        const projectsSnapshot = await db.collection('projects').get();
        const projectStatusMap = {};
        projectsSnapshot.forEach(doc => {
            const d = doc.data();
            const code = String(d.projectNumber).padStart(4, '0');
            projectStatusMap[code] = (d.status || 'Active').trim();
        });

        const departmentsSnapshot = await db.collection('timesheet_departments').get();
        const validTaskCodes = new Set();
        for (const deptDoc of departmentsSnapshot.docs) {
            const deptCode = deptDoc.data().code;
            const tasksSnapshot = await deptDoc.ref.collection('tasks').get();
            tasksSnapshot.forEach(taskDoc => {
                validTaskCodes.add(`${deptCode}/${taskDoc.data().code}`);
            });
        }
        return { projectStatusMap, validTaskCodes };
    } catch (error) {
        console.error("getValidationData error:", error);
        throw new functions.https.HttpsError("internal", "Failed to fetch project/task validation data.");
    }
};

/**
 * Fetches company shutdowns for a given range of years.
 */
const getCompanyCalendarData = async (startYear, endYear) => {
    try {
        const shutdowns = new Set();
        for (let year = startYear; year <= endYear; year++) {
            const docRef = db.collection('company_holidays').doc(year.toString());
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                const yearShutdowns = docSnap.data().shutdowns || [];
                yearShutdowns.forEach(d => shutdowns.add(d));
            }
        }
        return { shutdowns };
    } catch (error) {
        throw new functions.https.HttpsError("internal", "Failed to fetch calendar shutdown data.");
    }
};

/**
 * Generates ISO date strings for Maltese public holidays for a given year.
 */
const getPublicHolidaysStrings = (year) => {
    const holidays = new Set();
    const add = (month, day) => holidays.add(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);

    add(1, 1); add(2, 10); add(3, 19); add(3, 31); add(5, 1); add(6, 7);
    add(6, 29); add(8, 15); add(9, 8); add(9, 21); add(12, 8); add(12, 13); add(12, 25);

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
    const easterMonth = Math.floor((h + l - 7 * m + 114) / 31);
    const easterDay = ((h + l - 7 * m + 114) % 31) + 1;

    const easterDate = new Date(Date.UTC(year, easterMonth - 1, easterDay));
    const goodFriday = new Date(easterDate);
    goodFriday.setUTCDate(easterDate.getUTCDate() - 2);
    add(goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate());

    return holidays;
};

async function processInBatches(items, batchSize, processItem) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(processItem));
        results.push(...batchResults);
    }
    return results;
}

module.exports = {
    getValidationData,
    getCompanyCalendarData,
    getPublicHolidaysStrings,
    processInBatches
};