// Root: src/modules/salaries/SalaryProfile.jsx
// Version: 3.3 - Smart adjustment for Overhead Periods ending on the 1st
import React, { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, collection, getDocs, addDoc, query, orderBy, deleteDoc, updateDoc, collectionGroup } from 'firebase/firestore';
import { ArrowLeftIcon, PlusIcon, TrashIcon, PencilIcon, TableCellsIcon, ClipboardDocumentListIcon, EyeIcon, EyeSlashIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { db } from '../../firebase.js';
import {
    safeNumber,
    safePercent,
    parseDateUTC,
    calculateAnnualTotalCost,
    calculateMalteseNI,
    calculateHourlyRateForDate,
    isEmployeeActiveInPeriod
} from '../../utils/financialCalculations.js';

const SalaryProfile = ({ employee, onBack }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [salaryHistory, setSalaryHistory] = useState([]);

    // Context Data for Accurate Calculations
    const [effectiveHoursPeriods, setEffectiveHoursPeriods] = useState([]);
    const [overheadPeriods, setOverheadPeriods] = useState([]);
    const [monthlyDenominators, setMonthlyDenominators] = useState({});
    const [contextLoading, setContextLoading] = useState(false);

    const [viewMode, setViewMode] = useState('records');

    // UI State
    const [showOverheadDebug, setShowOverheadDebug] = useState(false);
    const [showNonProdDebug, setShowNonProdDebug] = useState(false);

    // Form State
    const [isEditingId, setIsEditingId] = useState(null);
    const [formData, setFormData] = useState({
        effectiveDate: new Date().toISOString().split('T')[0],
        baseSalary: 0,
        govtBonus: 512,
        bonus: 0,
        niRateType: 'A',
        niEmployerAmount: 0,
        otherContributions: 0,
        billableHoursTarget: 0,
        productivityPercent: 100,
        billablePercent: 100,
        addToNonProdPool: true,
        allocateOverheads: 'Yes'
    });

    useEffect(() => {
        let isMounted = true;
        if (employee?.id) {
            const loadData = async () => {
                setLoading(true);
                try {
                    await Promise.all([
                        fetchHistory(),
                        fetchContextData() // Load global context for accurate calcs
                    ]);
                } catch (error) {
                    console.error("Error loading salary profile:", error);
                } finally {
                    if (isMounted) setLoading(false);
                }
            };
            loadData();
        }
        return () => { isMounted = false; };
    }, [employee]);

    // --- DATA FETCHING ---

    const fetchContextData = async () => {
        setContextLoading(true);
        try {
            // 1. Fetch Settings
            const effHoursSnap = await getDocs(query(collection(db, 'settings', 'company_settings', 'effective_hours_periods'), orderBy('startDate', 'desc')));
            const overheadsSnap = await getDocs(query(collection(db, 'settings', 'company_settings', 'overhead_periods'), orderBy('startDate', 'desc')));

            const effHours = effHoursSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            const overheads = overheadsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            setEffectiveHoursPeriods(effHours);
            setOverheadPeriods(overheads);

            // 2. Fetch ALL Employees & History for Global Denominators
            const employeesSnap = await getDocs(collection(db, 'employees'));
            const employees = employeesSnap.docs.map(d => ({ id: d.id, ...d.data(), isActiveEmployee: d.data().isEmployed !== false }));

            const historyQuery = query(collectionGroup(db, 'salary_history'));
            const historySnap = await getDocs(historyQuery);
            const salaryHistories = {};
            historySnap.docs.forEach(doc => {
                const data = doc.data();
                const parentId = doc.ref.parent.parent.id;
                if (!salaryHistories[parentId]) salaryHistories[parentId] = [];
                salaryHistories[parentId].push({ id: doc.id, ...data });
            });

            // 3. Calculate Denominators (2004 - 2030) - Expanded Range
            const denominators = {};
            const startYear = 2004;
            const endYear = new Date().getFullYear() + 2;

            for (let y = startYear; y <= endYear; y++) {
                for (let m = 0; m < 12; m++) {
                    const monthStart = new Date(Date.UTC(y, m, 1));
                    const monthEnd = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59));
                    const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`;

                    let sumProductivity = 0;
                    let sumBillable = 0;
                    let nonProdPool = 0;

                    employees.forEach(emp => {
                        if (!isEmployeeActiveInPeriod(emp, monthStart, monthEnd)) return;

                        const hist = salaryHistories[emp.id];
                        if (hist) {
                            // Find active record for this specific month
                            const sorted = hist.sort((a, b) => parseDateUTC(b.effectiveDate) - parseDateUTC(a.effectiveDate));
                            const activeRecord = sorted.find(r => parseDateUTC(r.effectiveDate) <= monthEnd);

                            if (activeRecord) {
                                const bill = safePercent(activeRecord.billablePercent);
                                const prod = safePercent(activeRecord.productivityPercent);
                                if (bill > 0) sumProductivity += prod;
                                sumBillable += bill;

                                const cost = calculateAnnualTotalCost(activeRecord) / 12;
                                if (activeRecord.addToNonProdPool !== false) {
                                    nonProdPool += cost * (1 - (bill / 100));
                                }
                            }
                        }
                    });
                    denominators[monthKey] = { sumProductivity, sumBillable, nonProdPool };
                }
            }
            setMonthlyDenominators(denominators);

        } catch (error) {
            console.error("Error calculating overhead context:", error);
        } finally {
            setContextLoading(false);
        }
    };

    const fetchHistory = async () => {
        try {
            const q = query(collection(db, 'employees', employee.id, 'salary_history'), orderBy('effectiveDate', 'desc'));
            const snapshot = await getDocs(q);
            const history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setSalaryHistory(history);

            if (!isEditingId && history.length > 0) {
                const latest = history[0];
                setFormData(prev => ({
                    ...prev,
                    baseSalary: Number(latest.baseSalary) || 0,
                    govtBonus: Number(latest.govtBonus) || 512,
                    bonus: Number(latest.bonus) || 0,
                    niRateType: latest.niRateType || 'A',
                    niEmployerAmount: Number(latest.niEmployerAmount) || 0,
                    otherContributions: Number(latest.otherContributions) || 0,
                    productivityPercent: safePercent(latest.productivityPercent),
                    billablePercent: safePercent(latest.billablePercent),
                    addToNonProdPool: latest.addToNonProdPool !== false,
                    allocateOverheads: latest.allocateOverheads || 'Yes',
                    effectiveDate: latest.effectiveDate || new Date().toISOString().split('T')[0]
                }));
            }
        } catch (error) {
            console.error("Error fetching salary history:", error);
        }
    };

    // Auto-update Billable Hours based on Effective Hours Period
    useEffect(() => {
        if (effectiveHoursPeriods.length === 0) return;
        const targetDate = parseDateUTC(formData.effectiveDate);

        const matchingPeriod = effectiveHoursPeriods.find(period => {
            const start = parseDateUTC(period.startDate);
            const end = period.endDate ? parseDateUTC(period.endDate) : new Date(Date.UTC(9999, 11, 31));
            return targetDate >= start && targetDate <= end;
        });

        if (matchingPeriod) {
            setFormData(prev => ({ ...prev, billableHoursTarget: Number(matchingPeriod.effectiveHours) }));
        } else {
            setFormData(prev => ({ ...prev, billableHoursTarget: 2080 }));
        }
    }, [formData.effectiveDate, effectiveHoursPeriods]);

    const metrics = useMemo(() => {
        const totalCostToCompany = calculateAnnualTotalCost(formData);
        const monthlyCost = totalCostToCompany / 12;
        return {
            ni: formData.niEmployerAmount > 0 ? formData.niEmployerAmount : calculateMalteseNI(formData.baseSalary),
            totalCostToCompany,
            monthlyCost
        };
    }, [formData]);

    // --- MONTHLY COST CALCULATION (USING SHARED UTIL) ---
    const monthlyCosts = useMemo(() => {
        if (!employee || !salaryHistory.length) return [];

        // Start from first record or 2004
        const earliest = salaryHistory[salaryHistory.length - 1];
        let iterDate = parseDateUTC(earliest.effectiveDate) || new Date(Date.UTC(2004, 0, 1));

        // Ensure we start from a reasonable year (2004) if earliest record is very old or undefined
        if (iterDate.getUTCFullYear() < 2004) iterDate = new Date(Date.UTC(2004, 0, 1));

        iterDate.setUTCDate(1); // Start of month

        const now = new Date();
        const endIterDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));

        const costs = [];
        let loopCount = 0;

        // --- SMART ADJUSTMENT FOR OVERHEAD PERIODS ---
        // If an overhead period ends on the 1st of a month (e.g., Dec 1), 
        // we extend it to the end of that month (Dec 31) for calculation purposes.
        // This ensures the month isn't counted as "0 overheads" just because we calculate on the 31st.
        const adjustedOverheadPeriods = overheadPeriods.map(p => {
            if (!p.endDate) return p;
            const end = new Date(p.endDate);
            if (end.getDate() === 1) {
                const extended = new Date(Date.UTC(end.getFullYear(), end.getMonth() + 1, 0));
                return { ...p, endDate: extended.toISOString().split('T')[0] };
            }
            return p;
        });

        while (iterDate <= endIterDate && loopCount < 1200) {
            loopCount++;

            // We calculate using the END of the month to capture the state active in that month
            const endOfMonth = new Date(Date.UTC(iterDate.getUTCFullYear(), iterDate.getUTCMonth() + 1, 0, 23, 59, 59));
            const monthKey = `${iterDate.getUTCFullYear()}-${String(iterDate.getUTCMonth() + 1).padStart(2, '0')}`;

            // Find active record for this month
            const sortedHistory = [...salaryHistory].sort((a, b) => parseDateUTC(b.effectiveDate) - parseDateUTC(a.effectiveDate));
            const activeRecord = sortedHistory.find(rec => parseDateUTC(rec.effectiveDate) <= endOfMonth);

            let rowData = {
                monthKey,
                monthLabel: iterDate.toLocaleString('default', { month: 'short', year: 'numeric' }),
                directCostRate: 0,
                overheadCostRate: 0,
                nonProdCostRate: 0,
                totalHourlyRate: 0,
                monthlyCost: 0
            };

            if (activeRecord) {
                // Use Shared Utility
                const denomMap = { [iterDate.getUTCMonth()]: monthlyDenominators[monthKey] };

                const result = calculateHourlyRateForDate(
                    endOfMonth,
                    activeRecord,
                    effectiveHoursPeriods,
                    adjustedOverheadPeriods, // Use the adjusted periods
                    denomMap // Pass denominator for this month
                );

                const hoursWorkedPercent = safePercent(activeRecord.productivityPercent) / 100;
                const effHours = safeNumber(result.breakdown.effHours);
                const monthlyHours = (effHours * hoursWorkedPercent) / 12;

                rowData = {
                    ...rowData,
                    directCostRate: result.breakdown.directRate,
                    overheadCostRate: result.breakdown.overheadRate,
                    nonProdCostRate: result.breakdown.nonProdRate,
                    totalHourlyRate: result.totalRate,
                    // Monthly Cost = Total Rate * (Effective Hours / 12)
                    monthlyCost: result.totalRate * monthlyHours
                };
            }

            costs.push(rowData);
            iterDate.setUTCMonth(iterDate.getUTCMonth() + 1);
        }

        return costs.reverse();
    }, [salaryHistory, employee, effectiveHoursPeriods, overheadPeriods, monthlyDenominators]);


    // --- HANDLERS ---
    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : ((name === 'effectiveDate' || name === 'niRateType' || name === 'allocateOverheads') ? value : Number(value))
        }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const payload = {
                ...formData,
                updatedAt: new Date().toISOString(),
            };

            if (isEditingId) {
                await updateDoc(doc(db, 'employees', employee.id, 'salary_history', isEditingId), payload);
            } else {
                await addDoc(collection(db, 'employees', employee.id, 'salary_history'), {
                    ...payload,
                    createdAt: new Date().toISOString()
                });
            }

            setIsEditingId(null);
            await fetchHistory();
            // Re-fetch context to update global denominators if salary changed significantly
            fetchContextData();
            alert("Record saved.");
        } catch (error) {
            console.error("Error saving:", error);
            alert("Failed to save.");
        } finally {
            setSaving(false);
        }
    };

    const handleEdit = (record) => {
        setIsEditingId(record.id);
        setFormData({
            effectiveDate: record.effectiveDate,
            baseSalary: safeNumber(record.baseSalary),
            govtBonus: safeNumber(record.govtBonus),
            bonus: safeNumber(record.bonus),
            niRateType: record.niRateType || 'A',
            niEmployerAmount: safeNumber(record.niEmployerAmount),
            otherContributions: safeNumber(record.otherContributions),
            billableHoursTarget: safeNumber(record.billableHoursTarget),
            productivityPercent: safePercent(record.productivityPercent),
            billablePercent: safePercent(record.billablePercent),
            addToNonProdPool: record.addToNonProdPool !== false,
            allocateOverheads: record.allocateOverheads || 'Yes',
        });
        setViewMode('records');
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Delete this record?")) return;
        try {
            await deleteDoc(doc(db, 'employees', employee.id, 'salary_history', id));
            fetchHistory();
        } catch (error) {
            console.error(error);
        }
    };

    if (!employee) return null;
    if (loading) return <div className="p-8 text-center text-gray-500">Loading profile...</div>;

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm h-full flex flex-col max-h-screen overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-6 border-b pb-4 flex-shrink-0">
                <div className="flex items-center">
                    <button onClick={onBack} className="mr-4 p-2 rounded-full hover:bg-gray-100 text-gray-500">
                        <ArrowLeftIcon className="h-6 w-6" />
                    </button>
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900">{employee.name} {employee.surname}</h2>
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${employee.isEmployed ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                                {employee.isEmployed ? 'Active' : 'Inactive'}
                            </span>
                            <span>{employee.jobTitle}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col md:flex-row gap-6 flex-1 overflow-hidden">

                {/* LEFT: Input Form */}
                <div className="w-full md:w-1/3 bg-gray-50 p-5 rounded-xl border border-gray-200 overflow-y-auto">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-gray-900 flex items-center">
                            {isEditingId ? <PencilIcon className="h-5 w-5 mr-2 text-orange-600" /> : <PlusIcon className="h-5 w-5 mr-2 text-green-600" />}
                            {isEditingId ? 'Edit Record' : 'New Salary Record'}
                        </h3>
                        {isEditingId && (
                            <button onClick={() => { setIsEditingId(null); fetchHistory(); }} className="text-xs text-gray-500 underline">Cancel</button>
                        )}
                    </div>

                    <form onSubmit={handleSave} className="space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase">Effective Date</label>
                            <input type="date" name="effectiveDate" value={formData.effectiveDate} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" required />
                        </div>

                        <div className="bg-white p-3 rounded border border-gray-200 space-y-3">
                            <h4 className="font-semibold text-sm text-gray-700">Direct Cost Inputs</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="text-xs text-gray-500">Base Salary</label><input type="number" name="baseSalary" value={formData.baseSalary} onChange={handleChange} className="w-full p-1 border rounded text-sm" /></div>
                                <div><label className="text-xs text-gray-500">Govt Bonus</label><input type="number" name="govtBonus" value={formData.govtBonus} onChange={handleChange} className="w-full p-1 border rounded text-sm" /></div>
                                <div><label className="text-xs text-gray-500">Co. Bonus</label><input type="number" name="bonus" value={formData.bonus} onChange={handleChange} className="w-full p-1 border rounded text-sm" /></div>
                                <div><label className="text-xs text-gray-500">Employer NI</label><input type="number" name="niEmployerAmount" value={formData.niEmployerAmount} onChange={handleChange} className="w-full p-1 border rounded text-sm" placeholder="Override" /></div>
                                <div className="col-span-2"><label className="text-xs text-gray-500">Other Contributions</label><input type="number" name="otherContributions" value={formData.otherContributions} onChange={handleChange} className="w-full p-1 border rounded text-sm" /></div>
                            </div>
                        </div>

                        <div className="bg-white p-3 rounded border border-gray-200 space-y-3">
                            <h4 className="font-semibold text-sm text-gray-700">Productivity & Billability</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2">
                                    <label className="text-xs text-gray-500">Base Effective Hrs</label>
                                    <input
                                        type="number"
                                        name="billableHoursTarget"
                                        value={formData.billableHoursTarget}
                                        readOnly
                                        className="w-full p-1 border rounded text-sm bg-gray-100 text-gray-600 cursor-not-allowed"
                                        title="Fetched from Effective Hours settings based on Date"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500">% Hours Worked</label>
                                    <input type="number" name="productivityPercent" value={formData.productivityPercent} onChange={handleChange} className="w-full p-1 border rounded text-sm" />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500">% Prod. Billable</label>
                                    <input type="number" name="billablePercent" value={formData.billablePercent} onChange={handleChange} className="w-full p-1 border rounded text-sm" />
                                </div>
                                <div className="col-span-2 flex items-center pt-2">
                                    <input type="checkbox" name="addToNonProdPool" checked={formData.addToNonProdPool} onChange={handleChange} className="mr-2 h-4 w-4" />
                                    <label className="text-xs text-gray-600">Add remainder to Non-Billable Pool?</label>
                                </div>
                            </div>
                        </div>

                        <button type="submit" disabled={saving} className={`w-full py-2 rounded-md shadow-sm text-white text-sm font-medium ${isEditingId ? 'bg-orange-600' : 'bg-green-600'}`}>
                            {saving ? 'Saving...' : (isEditingId ? 'Update' : 'Add')}
                        </button>
                    </form>
                </div>

                {/* RIGHT: History Table / Monthly Costs */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="flex justify-between items-center mb-4 flex-shrink-0">
                        <h3 className="text-lg font-bold text-gray-900">
                            {viewMode === 'records' ? 'Salary History' : 'Monthly Cost Analysis'}
                        </h3>
                        <div className="flex bg-gray-200 p-1 rounded-lg">
                            <button onClick={() => setViewMode('records')} className={`px-4 py-1 text-sm font-medium rounded ${viewMode === 'records' ? 'bg-white shadow' : ''}`}>Records</button>
                            <button onClick={() => setViewMode('monthly')} className={`px-4 py-1 text-sm font-medium rounded ${viewMode === 'monthly' ? 'bg-white shadow' : ''}`}>Monthly Costs</button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg shadow-sm bg-white">
                        {viewMode === 'records' ? (
                            <table className="min-w-full divide-y divide-gray-200 text-xs">
                                <thead className="bg-gray-50 sticky top-0 z-10">
                                    <tr>
                                        <th className="px-2 py-2 text-left">Date</th>
                                        <th className="px-2 py-2 text-right">Base</th>
                                        <th className="px-2 py-2 text-right">Bonuses</th>
                                        <th className="px-2 py-2 text-right">NI</th>
                                        <th className="px-2 py-2 text-center">% Work</th>
                                        <th className="px-2 py-2 text-center">% Bill</th>
                                        <th className="px-2 py-2 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {salaryHistory.map((rec) => {
                                        const displayNI = rec.niEmployerAmount > 0 ? rec.niEmployerAmount : calculateMalteseNI(rec.baseSalary);
                                        return (
                                            <tr key={rec.id} className="hover:bg-gray-50">
                                                <td className="px-2 py-2 font-medium">{rec.effectiveDate}</td>
                                                <td className="px-2 py-2 text-right">€{safeNumber(rec.baseSalary).toLocaleString()}</td>
                                                <td className="px-2 py-2 text-right">€{(safeNumber(rec.govtBonus) + safeNumber(rec.bonus)).toLocaleString()}</td>
                                                <td className="px-2 py-2 text-right">€{displayNI.toFixed(2)}</td>
                                                <td className="px-2 py-2 text-center">{safePercent(rec.productivityPercent)}%</td>
                                                <td className="px-2 py-2 text-center">{safePercent(rec.billablePercent)}%</td>
                                                <td className="px-2 py-2 text-right">
                                                    <button onClick={() => handleEdit(rec)} className="text-blue-600 mr-2"><PencilIcon className="h-4 w-4" /></button>
                                                    <button onClick={() => handleDelete(rec.id)} className="text-red-600"><TrashIcon className="h-4 w-4" /></button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : (
                            <table className="min-w-full divide-y divide-gray-200 text-xs">
                                <thead className="bg-gray-50 sticky top-0 z-10">
                                    <tr>
                                        <th className="px-4 py-3 text-left">Month</th>
                                        <th className="px-4 py-3 text-right">Direct Rate</th>
                                        <th className="px-4 py-3 text-right">Overhead Rate</th>
                                        <th className="px-4 py-3 text-right">Non-Prod Rate</th>
                                        <th className="px-4 py-3 text-right font-bold text-gray-900">Total Rate</th>
                                        <th className="px-4 py-3 text-right font-bold text-indigo-600">Monthly Cost</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {contextLoading ? (
                                        <tr><td colSpan="6" className="p-4 text-center">Loading calculation context...</td></tr>
                                    ) : monthlyCosts.map((item) => (
                                        <tr key={item.monthKey} className="hover:bg-gray-50">
                                            <td className="px-4 py-2 font-medium">{item.monthLabel}</td>
                                            <td className="px-4 py-2 text-right">€{item.directCostRate.toFixed(2)}</td>
                                            <td className="px-4 py-2 text-right">€{item.overheadCostRate.toFixed(2)}</td>
                                            <td className="px-4 py-2 text-right">€{item.nonProdCostRate.toFixed(2)}</td>
                                            <td className="px-4 py-2 text-right font-bold">€{item.totalHourlyRate.toFixed(2)}</td>
                                            <td className="px-4 py-2 text-right font-bold text-indigo-600">€{item.monthlyCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SalaryProfile;