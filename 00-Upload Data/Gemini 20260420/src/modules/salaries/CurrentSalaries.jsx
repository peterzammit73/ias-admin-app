// Root: src/modules/salaries/CurrentSalaries.jsx
// Version: 1.1 - Centralized Firebase Import
import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, orderBy, collectionGroup, doc, updateDoc } from 'firebase/firestore';
import { BarsArrowUpIcon, BarsArrowDownIcon, CheckCircleIcon, XCircleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { db } from '../../firebase.js'; // Fixed imports

const CurrentSalaries = () => {
    const [loading, setLoading] = useState(true);
    const [employees, setEmployees] = useState([]);
    const [latestSalaries, setLatestSalaries] = useState({});
    const [sortConfig, setSortConfig] = useState({ key: 'employeeNumber', direction: 'asc' });
    const [filterActive, setFilterActive] = useState('all'); // 'all', 'active', 'inactive'

    // --- HELPERS ---
    const safeNumber = (val) => {
        if (val === '' || val === null || val === undefined) return 0;
        const num = Number(val);
        return isNaN(num) ? 0 : num;
    };

    const parseDateLocal = (dateStr) => {
        if (!dateStr) return null;
        if (dateStr && typeof dateStr.toDate === 'function') return dateStr.toDate();
        return new Date(dateStr);
    };

    const calculateTotalCost = (data) => {
        if (!data) return 0;
        const base = safeNumber(data.baseSalary);
        const govt = safeNumber(data.govtBonus);
        const bonus = safeNumber(data.bonus);
        const other = safeNumber(data.otherContributions);
        let ni = safeNumber(data.niEmployerAmount);
        
        if (ni === 0 && base > 0) {
             const annualCap = 53.33 * 52; 
             let calculated = base * 0.10;
             if (calculated > annualCap) calculated = annualCap;
             ni = calculated;
        }
        return base + govt + bonus + ni + other;
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            // 1. Fetch Employees
            const empSnap = await getDocs(query(collection(db, 'employees'), orderBy('surname', 'asc')));
            const empData = empSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setEmployees(empData);

            // 2. Fetch ALL Salary Histories (to find the latest)
            const historySnap = await getDocs(query(collectionGroup(db, 'salary_history')));
            const salaryMap = {}; // Key: empId -> Latest Record

            historySnap.docs.forEach(doc => {
                const data = doc.data();
                const empId = doc.ref.parent.parent.id;
                
                const currentLatest = salaryMap[empId];
                const thisDate = parseDateLocal(data.effectiveDate);

                if (!currentLatest || (thisDate && parseDateLocal(currentLatest.effectiveDate) < thisDate)) {
                    salaryMap[empId] = { id: doc.id, ...data };
                }
            });
            setLatestSalaries(salaryMap);

        } catch (error) {
            console.error("Error fetching current salaries:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleToggleActive = async (empId, currentStatus) => {
        const newStatus = !currentStatus;
        try {
            await updateDoc(doc(db, 'employees', empId), {
                isEmployed: newStatus
            });
            // Optimistic update
            setEmployees(prev => prev.map(e => e.id === empId ? { ...e, isEmployed: newStatus } : e));
        } catch (error) {
            console.error("Failed to update status:", error);
            alert("Failed to update employee status.");
        }
    };

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const processedRows = useMemo(() => {
        let rows = employees.map(emp => {
            const salary = latestSalaries[emp.id];
            return {
                id: emp.id,
                employeeNumber: Number(emp.employeeNumber) || 0,
                name: `${emp.surname}, ${emp.name}`,
                isEmployed: emp.isEmployed === true,
                salary: salary || null,
                totalCost: calculateTotalCost(salary)
            };
        });

        // Filter
        if (filterActive === 'active') rows = rows.filter(r => r.isEmployed);
        if (filterActive === 'inactive') rows = rows.filter(r => !r.isEmployed);

        // Sort
        rows.sort((a, b) => {
            if (sortConfig.key === 'employeeNumber') {
                return sortConfig.direction === 'asc' ? a.employeeNumber - b.employeeNumber : b.employeeNumber - a.employeeNumber;
            } else if (sortConfig.key === 'name') {
                return sortConfig.direction === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
            }
            return 0;
        });

        return rows;
    }, [employees, latestSalaries, sortConfig, filterActive]);

    if (loading) return <div className="p-12 text-center text-gray-500">Loading current salary data...</div>;

    return (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col h-full overflow-hidden">
            {/* Header / Controls */}
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                <div className="flex items-center gap-4">
                    <h2 className="text-lg font-bold text-gray-800">Current Salaries Overview</h2>
                    <select 
                        value={filterActive} 
                        onChange={(e) => setFilterActive(e.target.value)}
                        className="text-sm border-gray-300 rounded-md shadow-sm focus:border-orange-500 focus:ring-orange-500"
                    >
                        <option value="all">All Staff</option>
                        <option value="active">Active Only</option>
                        <option value="inactive">Inactive Only</option>
                    </select>
                </div>
                <button onClick={fetchData} className="p-2 hover:bg-gray-200 rounded-full text-gray-500 transition-colors">
                    <ArrowPathIcon className="h-5 w-5" />
                </button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-100 sticky top-0 z-10">
                        <tr>
                            <th 
                                className="px-4 py-3 text-left font-bold text-gray-700 cursor-pointer hover:bg-gray-200 group w-24"
                                onClick={() => handleSort('employeeNumber')}
                            >
                                <div className="flex items-center">
                                    ID
                                    <span className="ml-1 text-gray-400 group-hover:text-gray-600">
                                        {sortConfig.key === 'employeeNumber' && (sortConfig.direction === 'asc' ? <BarsArrowUpIcon className="h-4 w-4"/> : <BarsArrowDownIcon className="h-4 w-4"/>)}
                                    </span>
                                </div>
                            </th>
                            <th 
                                className="px-4 py-3 text-left font-bold text-gray-700 cursor-pointer hover:bg-gray-200 group"
                                onClick={() => handleSort('name')}
                            >
                                <div className="flex items-center">
                                    Employee Name
                                    <span className="ml-1 text-gray-400 group-hover:text-gray-600">
                                        {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? <BarsArrowUpIcon className="h-4 w-4"/> : <BarsArrowDownIcon className="h-4 w-4"/>)}
                                    </span>
                                </div>
                            </th>
                            <th className="px-4 py-3 text-center font-bold text-gray-700 w-24">Active</th>
                            <th className="px-4 py-3 text-right font-bold text-gray-700">Base Salary</th>
                            <th className="px-4 py-3 text-right font-bold text-gray-700">Govt Bonus</th>
                            <th className="px-4 py-3 text-right font-bold text-gray-700">Perf. Bonus</th>
                            <th className="px-4 py-3 text-right font-bold text-gray-700">NI (10%)</th>
                            <th className="px-4 py-3 text-right font-bold text-gray-700">Other</th>
                            <th className="px-4 py-3 text-right font-bold text-gray-900 bg-gray-200">Total Cost</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                        {processedRows.map((row) => (
                            <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-3 font-mono text-gray-500">
                                    {String(row.employeeNumber).padStart(4, '0')}
                                </td>
                                <td className="px-4 py-3 font-medium text-gray-900">
                                    {row.name}
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <button 
                                        onClick={() => handleToggleActive(row.id, row.isEmployed)}
                                        className={`transition-colors focus:outline-none ${row.isEmployed ? 'text-green-600 hover:text-green-800' : 'text-gray-300 hover:text-gray-500'}`}
                                        title={row.isEmployed ? "Mark as Inactive" : "Mark as Active"}
                                    >
                                        {row.isEmployed ? <CheckCircleIcon className="h-6 w-6 mx-auto" /> : <XCircleIcon className="h-6 w-6 mx-auto" />}
                                    </button>
                                </td>
                                
                                {/* Salary Columns */}
                                <td className="px-4 py-3 text-right text-gray-600 font-mono">
                                    {row.salary ? `€${safeNumber(row.salary.baseSalary).toLocaleString()}` : '-'}
                                </td>
                                <td className="px-4 py-3 text-right text-gray-600 font-mono">
                                    {row.salary ? `€${safeNumber(row.salary.govtBonus).toLocaleString()}` : '-'}
                                </td>
                                <td className="px-4 py-3 text-right text-gray-600 font-mono">
                                    {row.salary ? `€${safeNumber(row.salary.bonus).toLocaleString()}` : '-'}
                                </td>
                                <td className="px-4 py-3 text-right text-gray-600 font-mono">
                                    {row.salary ? (
                                        row.salary.niEmployerAmount > 0 
                                            ? `€${safeNumber(row.salary.niEmployerAmount).toLocaleString()}`
                                            : `€${(safeNumber(row.salary.baseSalary) * 0.1).toLocaleString()}`
                                    ) : '-'}
                                </td>
                                <td className="px-4 py-3 text-right text-gray-600 font-mono">
                                    {row.salary ? `€${safeNumber(row.salary.otherContributions).toLocaleString()}` : '-'}
                                </td>
                                <td className="px-4 py-3 text-right font-bold text-gray-900 font-mono bg-gray-50">
                                    {row.totalCost > 0 ? `€${row.totalCost.toLocaleString()}` : '-'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default CurrentSalaries;