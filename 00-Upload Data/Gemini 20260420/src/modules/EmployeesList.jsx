// File Path: src/modules/EmployeesList.jsx
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase.js'; // Fixed import extension
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

const EmployeesList = () => {
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        setLoading(true);
        // Only fetch currently employed staff for the main directory
        const q = query(collection(db, "employees"), where("isEmployed", "==", true));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const employeesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            employeesData.sort((a, b) => {
                if (a.surname < b.surname) return -1;
                if (a.surname > b.surname) return 1;
                return a.name.localeCompare(b.name);
            });
            setEmployees(employeesData);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const filteredEmployees = employees.filter(employee => {
        // Exclude invisible employees
        if (employee.isVisible === false) return false;

        return (
            (employee.name && employee.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (employee.surname && employee.surname.toLowerCase().includes(searchTerm.toLowerCase()))
        );
    });

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900">Active Employees</h2>
                    <p className="mt-1 text-base text-gray-600">A read-only directory of all active employees.</p>
                </div>
                <div className="relative w-full sm:w-auto">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                        <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                    </div>
                    <input
                        type="text"
                        placeholder="Search by name or surname..."
                        className="block w-full sm:w-64 rounded-md border-0 py-2 pl-10 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-orange-500 text-base"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full">
                    <thead className="border-b border-gray-200 bg-gray-50">
                        <tr>
                            <th scope="col" className="py-2 pl-4 pr-3 text-left text-base font-semibold text-gray-900 sm:pl-2">Surname</th>
                            <th scope="col" className="px-3 py-2 text-left text-base font-semibold text-gray-900">Name</th>
                            <th scope="col" className="px-3 py-2 text-left text-base font-semibold text-gray-900">Mobile Number</th>
                            <th scope="col" className="px-3 py-2 text-left text-base font-semibold text-gray-900">Company Email</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {loading ? (
                            <tr><td colSpan="4" className="whitespace-nowrap px-3 py-4 text-base text-gray-500 text-center">Loading...</td></tr>
                        ) : filteredEmployees.length > 0 ? (
                            filteredEmployees.map((employee) => (
                                <tr key={employee.id} className="hover:bg-gray-50">
                                    <td className="whitespace-nowrap py-2 pl-4 pr-3 text-base font-medium text-gray-900 sm:pl-2">{employee.surname}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-base text-gray-500">{employee.name}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-base text-gray-500">{employee.mobileNumber}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-base text-gray-500">{employee.companyEmail}</td>
                                </tr>
                            ))
                        ) : (
                            <tr><td colSpan="4" className="whitespace-nowrap px-3 py-4 text-base text-gray-500 text-center">No employees found matching your search.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
export default EmployeesList;