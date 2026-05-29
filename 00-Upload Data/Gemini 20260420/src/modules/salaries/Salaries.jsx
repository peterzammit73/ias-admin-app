// Root: src/modules/salaries/Salaries.jsx
// Version: 3.0 - Added CSV Export for Active Salaries
import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, query, orderBy, onSnapshot, collectionGroup } from 'firebase/firestore';
import {
    CurrencyEuroIcon,
    UserIcon,
    MagnifyingGlassIcon,
    ChevronRightIcon,
    BarsArrowUpIcon,
    BarsArrowDownIcon,
    ArrowDownTrayIcon // Imported for download button
} from '@heroicons/react/24/outline';
import SalaryProfile from './SalaryProfile.jsx';
import { db } from '../../firebase.js';

const Salaries = () => {
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [showOnlyActive, setShowOnlyActive] = useState(true);
    const [sortConfig, setSortConfig] = useState({ key: 'surname', direction: 'asc' });

    // Store latest salary data for export
    const [salaryMap, setSalaryMap] = useState({});

    useEffect(() => {
        const q = query(collection(db, 'employees'), orderBy('surname', 'asc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const items = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setEmployees(items);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching employees:", error);
            setLoading(false);
        });

        // Also fetch salary history to have data ready for export
        const fetchSalaries = async () => {
            const historySnap = await getDocs(query(collectionGroup(db, 'salary_history')));
            const map = {};
            // Logic to find latest record for each employee
            historySnap.docs.forEach(doc => {
                const data = doc.data();
                const empId = doc.ref.parent.parent.id;

                const currentLatest = map[empId];
                // Simple string date comparison YYYY-MM-DD
                if (!currentLatest || (data.effectiveDate > currentLatest.effectiveDate)) {
                    map[empId] = { ...data };
                }
            });
            setSalaryMap(map);
        };
        fetchSalaries();

        return () => unsubscribe();
    }, []);

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const getStatusBadge = (employee) => {
        let isActive = true;
        if (employee.isEmployed !== undefined) {
            isActive = employee.isEmployed;
        } else {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (employee.employmentHistory && employee.employmentHistory.length > 0) {
                isActive = employee.employmentHistory.some(period => {
                    const start = new Date(period.startDate);
                    const end = period.endDate ? new Date(period.endDate) : null;
                    return start <= today && (!end || end >= today);
                });
            } else if (employee.endDate) {
                isActive = new Date(employee.endDate) >= today;
            }
        }

        return isActive
            ? <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Active</span>
            : <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">Inactive</span>;
    };

    const isActiveEmployee = (emp) => {
        if (emp.isEmployed !== undefined) return emp.isEmployed;
        if (emp.endDate) return new Date(emp.endDate) >= new Date();
        return true;
    };

    const filteredEmployees = employees
        .filter(emp => {
            let isActive = isActiveEmployee(emp);
            if (showOnlyActive && !isActive) return false;

            const searchLower = searchTerm.toLowerCase();
            const fullName = `${emp.name} ${emp.surname}`.toLowerCase();
            const empNum = emp.employeeNumber ? String(emp.employeeNumber) : '';
            return fullName.includes(searchLower) || empNum.includes(searchLower);
        })
        .sort((a, b) => {
            if (sortConfig.key === 'employeeNumber') {
                const numA = a.employeeNumber || 0;
                const numB = b.employeeNumber || 0;
                return sortConfig.direction === 'asc' ? numA - numB : numB - numA;
            } else {
                const nameA = `${a.surname} ${a.name}`.toLowerCase();
                const nameB = `${b.surname} ${b.name}`.toLowerCase();
                if (nameA < nameB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (nameA > nameB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            }
        });

    // --- CSV Export Function ---
    const handleExportCSV = () => {
        // Filter for ONLY active employees for the report
        const activeStaff = employees.filter(e => isActiveEmployee(e));

        if (activeStaff.length === 0) {
            alert("No active employees found to export.");
            return;
        }

        let csvContent = "data:text/csv;charset=utf-8,";
        // Header Row
        csvContent += "Employee Number,Surname,Name,Job Title,Base Salary,Govt Bonus,Company Bonus,NI Employer,Other Contributions,Total Annual Cost\n";

        activeStaff.forEach(emp => {
            const salary = salaryMap[emp.id] || {};

            // Safe Number Helpers
            const base = Number(salary.baseSalary) || 0;
            const govt = Number(salary.govtBonus) || 0;
            const bonus = Number(salary.bonus) || 0;
            const other = Number(salary.otherContributions) || 0;
            let ni = Number(salary.niEmployerAmount) || 0;

            // Auto-calculate NI if missing (Standard 10% rule as fallback)
            if (ni === 0 && base > 0) {
                const weeklyCap = 53.33;
                const annualCap = weeklyCap * 52;
                let calculated = base * 0.10;
                if (calculated > annualCap) calculated = annualCap;
                ni = calculated;
            }

            const total = base + govt + bonus + ni + other;

            const row = [
                emp.employeeNumber || '',
                `"${emp.surname}"`,
                `"${emp.name}"`,
                `"${emp.jobTitle || ''}"`,
                base.toFixed(2),
                govt.toFixed(2),
                bonus.toFixed(2),
                ni.toFixed(2),
                other.toFixed(2),
                total.toFixed(2)
            ].join(",");
            csvContent += row + "\n";
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Active_Salaries_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (selectedEmployee) {
        return (
            <div className="space-y-6">
                <button
                    onClick={() => setSelectedEmployee(null)}
                    className="flex items-center text-sm text-gray-500 hover:text-gray-700"
                >
                    <ChevronRightIcon className="h-4 w-4 rotate-180 mr-1" /> Back to Employee List
                </button>
                <div className="bg-white rounded-lg shadow p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center">
                            <div className="h-12 w-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-lg mr-4">
                                {selectedEmployee.name?.[0]}{selectedEmployee.surname?.[0]}
                            </div>
                            <div>
                                <h2 className="text-2xl font-bold text-gray-900">{selectedEmployee.name} {selectedEmployee.surname}</h2>
                                <p className="text-sm text-gray-500">{selectedEmployee.jobTitle}</p>
                            </div>
                        </div>
                    </div>
                    <SalaryProfile employee={selectedEmployee} onBack={() => setSelectedEmployee(null)} />
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Salaries & Profiles</h1>
                    <p className="text-sm text-gray-500">Manage employee salary profiles and monthly costs</p>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
                    {/* Export Button */}
                    <button
                        onClick={handleExportCSV}
                        className="flex items-center px-3 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
                        title="Download CSV of current active salaries"
                    >
                        <ArrowDownTrayIcon className="h-4 w-4 mr-2 text-gray-500" />
                        Export Active Salaries
                    </button>

                    <div className="relative w-full sm:w-64">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                        </div>
                        <input
                            type="text"
                            className="block w-full rounded-md border-0 py-1.5 pl-10 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                            placeholder="Search by name or number..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center bg-white border border-gray-300 rounded-md p-1 shadow-sm shrink-0">
                        <button
                            onClick={() => setShowOnlyActive(true)}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${showOnlyActive ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Active Only
                        </button>
                        <button
                            onClick={() => setShowOnlyActive(false)}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${!showOnlyActive ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            All Staff
                        </button>
                    </div>
                </div>
            </div>

            <div className="bg-white shadow overflow-hidden sm:rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th
                                scope="col"
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 group"
                                onClick={() => handleSort('employeeNumber')}
                            >
                                <div className="flex items-center">
                                    Emp. No
                                    <span className="ml-2 flex-none rounded bg-gray-200 text-gray-900 group-hover:bg-gray-300">
                                        {sortConfig.key === 'employeeNumber' ? (
                                            sortConfig.direction === 'asc' ? <BarsArrowUpIcon className="h-4 w-4" /> : <BarsArrowDownIcon className="h-4 w-4" />
                                        ) : (
                                            <BarsArrowUpIcon className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-50" />
                                        )}
                                    </span>
                                </div>
                            </th>
                            <th
                                scope="col"
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 group"
                                onClick={() => handleSort('surname')}
                            >
                                <div className="flex items-center">
                                    Surname & Name
                                    <span className="ml-2 flex-none rounded bg-gray-200 text-gray-900 group-hover:bg-gray-300">
                                        {sortConfig.key === 'surname' ? (
                                            sortConfig.direction === 'asc' ? <BarsArrowUpIcon className="h-4 w-4" /> : <BarsArrowDownIcon className="h-4 w-4" />
                                        ) : (
                                            <BarsArrowUpIcon className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-50" />
                                        )}
                                    </span>
                                </div>
                            </th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Job Title
                            </th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Status
                            </th>
                            <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {loading ? (
                            <tr><td colSpan="5" className="px-6 py-4 text-center text-sm text-gray-500">Loading...</td></tr>
                        ) : filteredEmployees.length === 0 ? (
                            <tr><td colSpan="5" className="px-6 py-4 text-center text-sm text-gray-500">No employees found.</td></tr>
                        ) : (
                            filteredEmployees.map((employee) => (
                                <tr key={employee.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedEmployee(employee)}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-mono">
                                        {employee.employeeNumber ? String(employee.employeeNumber).padStart(4, '0') : '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center">
                                            <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-xs mr-3">
                                                {employee.name?.[0]}{employee.surname?.[0]}
                                            </div>
                                            <div className="text-sm font-medium text-gray-900">
                                                {employee.surname}, {employee.name}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {employee.jobTitle}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {getStatusBadge(employee)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setSelectedEmployee(employee); }}
                                            className="text-indigo-600 hover:text-indigo-900 flex items-center justify-end"
                                        >
                                            Manage <ChevronRightIcon className="h-4 w-4 ml-1" />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Salaries;