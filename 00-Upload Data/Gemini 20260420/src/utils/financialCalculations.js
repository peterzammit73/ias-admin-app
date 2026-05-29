// Root: src/utils/financialCalculations.js
// Version: 1.7 - Added Forecasting Helper

// --- Helper: Safe Number Conversion ---
export const safeNumber = (val) => {
    const num = Number(val);
    return isNaN(num) ? 0 : num;
};

export const safePercent = (val) => {
    const num = Number(val);
    return isNaN(num) ? 100 : num;
};

// --- Helper: Strict UTC Date Parsing ---
export const parseDateUTC = (dateStr) => {
    if (!dateStr) return null;

    if (dateStr && typeof dateStr.toDate === 'function') {
        const d = dateStr.toDate();
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    }

    if (dateStr instanceof Date) {
        return new Date(Date.UTC(dateStr.getFullYear(), dateStr.getMonth(), dateStr.getDate()));
    }

    const parts = String(dateStr).split('-');
    if (parts.length === 3) {
        return new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    }

    return new Date(dateStr);
};

// --- Helper: Check if Employee is Active in Period ---
export const isEmployeeActiveInPeriod = (emp, periodStart, periodEnd) => {
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
export const getApplicableSalaryRecord = (salaryHistory, targetDateUTC) => {
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

// --- Helper: Calculate Maltese NI (Standard Class 1 Employer) ---
export const calculateMalteseNI = (annualBase) => {
    const base = safeNumber(annualBase);
    if (base <= 0) return 0;
    const weeklyCap = 53.33;
    const annualCap = weeklyCap * 52;
    let calculated = base * 0.10;
    if (calculated > annualCap) calculated = annualCap;
    return calculated;
};

// --- Helper: Calculate Annual Total Cost (Direct Only) ---
export const calculateAnnualTotalCost = (salaryRecord) => {
    const base = safeNumber(salaryRecord.baseSalary);
    const govt = safeNumber(salaryRecord.govtBonus);
    const bonus = safeNumber(salaryRecord.bonus);
    const other = safeNumber(salaryRecord.otherContributions);
    let ni = safeNumber(salaryRecord.niEmployerAmount);

    // Auto-calculate NI if not overridden
    if (ni === 0 && base > 0) {
        ni = calculateMalteseNI(base);
    }
    return base + govt + bonus + ni + other;
};

// --- Main Engine: Calculate Hourly Rate & Components ---
export const calculateHourlyRateForDate = (
    entryDateUTC,
    activeSalaryRecord,
    effectiveHoursPeriods,
    overheadPeriods,
    monthlyDenominators
) => {
    if (!activeSalaryRecord) return { totalRate: 0, breakdown: {} };

    // 1. Calculate Direct Rate
    const totalAnnualCost = calculateAnnualTotalCost(activeSalaryRecord);

    let effHours = 2080; // Default standard year
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
    // Try string key YYYY-MM
    const monthKey = `${entryDateUTC.getUTCFullYear()}-${String(entryDateUTC.getUTCMonth() + 1).padStart(2, '0')}`;
    // Try number key (month index)
    const monthIndex = entryDateUTC.getUTCMonth();

    const globalStats = monthlyDenominators[monthKey] || monthlyDenominators[monthIndex] || {};

    let overheadDoc = overheadPeriods.find(o => {
        const start = parseDateUTC(o.startDate);
        // FIX: Ensure end date covers the full day or handle strict equality
        let end = o.endDate ? parseDateUTC(o.endDate) : new Date(Date.UTC(9999, 11, 31));

        // If entryDateUTC is exactly the end date, or if end date is just before midnight, ensure we compare correctly.
        // We normalize everything to midnight UTC for comparison to be safe.
        const entryTime = entryDateUTC.getTime();
        const startTime = start.getTime();
        const endTime = end.getTime();

        // Extended Check: If the period covers the START of the month of the entry date, consider it valid for that month
        // This handles cases where a period ends mid-month or on the last day but strict time comparison fails.
        const entryMonthStart = new Date(Date.UTC(entryDateUTC.getUTCFullYear(), entryDateUTC.getUTCMonth(), 1)).getTime();

        // Standard Check
        if (entryTime >= startTime && entryTime <= endTime) return true;

        // Fallback: If the period covers the 1st of the month of the entry date, use it.
        // This ensures that if we are calculating for Nov 30th, and the period is Oct 1 - Nov 30, it matches.
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

/**
 * NEW: Quick Estimator for Planning
 * Uses the latest salary record to project future costs without full historical context.
 * Assumes current overheads/effective hours apply.
 */
export const estimateEmployeeRate = (salaryHistory, effectiveHoursPeriods) => {
    if (!salaryHistory || salaryHistory.length === 0) return 0;

    // Sort descending by date
    const latest = [...salaryHistory].sort((a, b) => parseDateUTC(b.effectiveDate) - parseDateUTC(a.effectiveDate))[0];

    // Get latest effective hours
    let annualHours = 2080;
    if (effectiveHoursPeriods && effectiveHoursPeriods.length > 0) {
        const latestEff = effectiveHoursPeriods.sort((a, b) => parseDateUTC(b.startDate) - parseDateUTC(a.startDate))[0];
        annualHours = safeNumber(latestEff.effectiveHours);
    }

    const totalCost = calculateAnnualTotalCost(latest);
    const prodPercent = safePercent(latest.productivityPercent);
    const denom = annualHours * (prodPercent / 100);

    const directRate = denom > 0 ? totalCost / denom : 0;

    // Add a standard 20% buffer for Overheads/Non-Prod for estimation purposes
    // (Since we don't have the future month's global denominators yet)
    return directRate * 1.20;
};