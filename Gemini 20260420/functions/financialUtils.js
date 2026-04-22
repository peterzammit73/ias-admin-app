// Root: functions/financialUtils.js
// Version: 1.2 - Removed risky import, purely functional
// Fix: Removed 'require("firebase-admin/firestore")' to prevent module load crashes

// --- Helper: Safe Number Conversion ---
const safeNumber = (val) => {
    const num = Number(val);
    return isNaN(num) ? 0 : num;
};

const safePercent = (val) => {
    const num = Number(val);
    return isNaN(num) ? 100 : num;
};

// --- Helper: Strict UTC Date Parsing ---
const parseDateUTC = (val) => {
    if (!val) return null;

    // 1. Handle Firestore Timestamp (has .toDate())
    if (val.toDate && typeof val.toDate === 'function') {
        return val.toDate();
    }

    // 2. Handle JS Date Object
    if (val instanceof Date) {
        // Create new date to avoid mutation issues, ensure UTC midnight if needed
        return new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate()));
    }

    // 3. Handle Strings (ISO or simple YYYY-MM-DD)
    if (typeof val === 'string') {
        // Try parsing ISO string
        const d = new Date(val);
        if (!isNaN(d.getTime())) {
            return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        }
    }

    // 4. Handle Seconds/Nanoseconds object (raw Firestore JSON)
    if (val._seconds !== undefined) {
        return new Date(val._seconds * 1000);
    }

    return null;
};

// --- Helper: Check if Employee is Active in Period ---
const isEmployeeActiveInPeriod = (emp, periodStart, periodEnd) => {
    if (emp.startDate) {
        const start = parseDateUTC(emp.startDate);
        if (start && start > periodEnd) return false;
    }

    if (emp.endDate) {
        const end = parseDateUTC(emp.endDate);
        if (end && end < periodStart) return false;
    }

    return true;
};

// --- Helper: Get Applicable Salary Record ---
const getApplicableSalaryRecord = (salaryHistory, targetDateUTC) => {
    if (!salaryHistory || salaryHistory.length === 0) return null;

    let validRecords = salaryHistory.filter(r => {
        const effectiveDate = parseDateUTC(r.effectiveDate);
        return effectiveDate && effectiveDate <= targetDateUTC;
    });

    if (validRecords.length > 0) {
        validRecords.sort((a, b) => parseDateUTC(b.effectiveDate) - parseDateUTC(a.effectiveDate));
        return validRecords[0];
    }

    const sortedAsc = [...salaryHistory].sort((a, b) => parseDateUTC(a.effectiveDate) - parseDateUTC(b.effectiveDate));
    return sortedAsc[0];
};

// --- Helper: Calculate Annual Total Cost ---
const calculateAnnualTotalCost = (salaryRecord) => {
    const base = safeNumber(salaryRecord.baseSalary);
    const govt = safeNumber(salaryRecord.govtBonus);
    const bonus = safeNumber(salaryRecord.bonus);
    const other = safeNumber(salaryRecord.otherContributions);
    let ni = safeNumber(salaryRecord.niEmployerAmount);

    if (ni === 0 && base > 0) {
        // Standard Maltese NI Calc
        const weeklyCap = 53.33;
        const annualCap = weeklyCap * 52;
        let calculated = base * 0.10;
        if (calculated > annualCap) calculated = annualCap;
        ni = calculated;
    }
    return base + govt + bonus + ni + other;
};

// --- Main Engine: Calculate Hourly Rate & Components ---
const calculateHourlyRateForDate = (
    entryDateUTC,
    activeSalaryRecord,
    effectiveHoursPeriods,
    overheadPeriods,
    monthlyDenominators
) => {
    if (!activeSalaryRecord) return { totalRate: 0, breakdown: {} };

    // 1. Calculate Direct Rate
    const totalAnnualCost = calculateAnnualTotalCost(activeSalaryRecord);

    let effHours = 2080;
    const matchingPeriod = effectiveHoursPeriods.find(p => {
        const start = parseDateUTC(p.startDate);
        const end = p.endDate ? parseDateUTC(p.endDate) : new Date(Date.UTC(9999, 11, 31));
        return entryDateUTC >= start && entryDateUTC <= end;
    });

    if (matchingPeriod) {
        effHours = safeNumber(matchingPeriod.effectiveHours);
    } else if (safeNumber(activeSalaryRecord.billableHoursTarget) > 0) {
        effHours = safeNumber(activeSalaryRecord.billableHoursTarget);
    }

    const prodPercent = safePercent(activeSalaryRecord.productivityPercent);
    const denom = effHours * (prodPercent / 100);
    const directRate = denom > 0 ? totalAnnualCost / denom : 0;

    // 2. Calculate Overhead Rate
    let overheadRate = 0;
    const monthKey = `${entryDateUTC.getUTCFullYear()}-${String(entryDateUTC.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthIndex = entryDateUTC.getUTCMonth();

    // Try lookup by key first, then index
    const globalStats = monthlyDenominators[monthKey] || monthlyDenominators[monthIndex] || {};

    let overheadDoc = overheadPeriods.find(o => {
        const start = parseDateUTC(o.startDate);
        let end = o.endDate ? parseDateUTC(o.endDate) : new Date(Date.UTC(9999, 11, 31));

        const entryTime = entryDateUTC.getTime();
        const startTime = start.getTime();
        const endTime = end.getTime();

        const entryMonthStart = new Date(Date.UTC(entryDateUTC.getUTCFullYear(), entryDateUTC.getUTCMonth(), 1)).getTime();

        if (entryTime >= startTime && entryTime <= endTime) return true;
        if (entryMonthStart >= startTime && entryMonthStart <= endTime) return true;
        return false;
    });

    const totalOverheadValue = overheadDoc ? safeNumber(overheadDoc.totalAmount !== undefined ? overheadDoc.totalAmount : overheadDoc.amount) : 0;
    const monthlyTotalOverhead = totalOverheadValue / 12;
    const myBillable = safePercent(activeSalaryRecord.billablePercent);

    if (safeNumber(globalStats.sumProductivity) > 0 && monthlyTotalOverhead > 0 && myBillable > 0) {
        const monthlyOverheadShare = (monthlyTotalOverhead * prodPercent) / globalStats.sumProductivity;
        const monthlyUserHours = denom / 12;
        if (monthlyUserHours > 0) {
            overheadRate = (monthlyOverheadShare / monthlyUserHours) / (myBillable / 100);
        }
    }

    // 3. Calculate Non-Productive Rate
    let nonProdRate = 0;
    if (effHours > 0 && safeNumber(globalStats.sumBillable) > 0) {
        const annualNPPool = (safeNumber(globalStats.nonProdPool) || 0) * 12;
        const myShareFactor = safePercent(activeSalaryRecord.billablePercent);
        nonProdRate = (annualNPPool * myShareFactor) / (effHours * globalStats.sumBillable);
    }

    const totalRate = directRate + overheadRate + nonProdRate;

    return {
        totalRate,
        breakdown: { directRate, overheadRate, nonProdRate, effHours, totalAnnualCost }
    };
};

module.exports = {
    safeNumber,
    safePercent,
    parseDateUTC,
    isEmployeeActiveInPeriod,
    getApplicableSalaryRecord,
    calculateAnnualTotalCost,
    calculateHourlyRateForDate
};