// File location: src/modules/TimesheetGuide.jsx
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, getDocs } from 'firebase/firestore';
import { db } from '/src/firebase.js';
import { ChevronDownIcon } from '@heroicons/react/24/outline';

const DepartmentSection = ({ dept }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="border border-gray-200 rounded-lg mb-4 overflow-hidden last:mb-0">
            <button
                className="w-full flex justify-between items-center p-4 cursor-pointer bg-gray-50 hover:bg-gray-100 focus:outline-none"
                onClick={() => setIsOpen(!isOpen)}
            >
                <h3 className="text-xl font-semibold text-gray-800">
                    {dept.name} <span className="text-gray-500 font-normal">({dept.code})</span>
                </h3>
                <ChevronDownIcon className={`h-6 w-6 text-gray-500 transition-transform duration-300 ${isOpen ? 'transform rotate-180' : ''}`} />
            </button>
            {isOpen && (
                <div className="border-t border-gray-200">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-base font-medium text-gray-500 uppercase tracking-wider">Task Name</th>
                                    <th scope="col" className="px-6 py-3 text-left text-base font-medium text-gray-500 uppercase tracking-wider">Task Code</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {dept.tasks && dept.tasks.length > 0 ? (
                                    dept.tasks.map(task => (
                                        <tr key={task.id}>
                                            <td className="px-6 py-4 whitespace-nowrap text-base text-gray-700">{task.name}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-base">
                                                <span className="font-mono text-gray-700 bg-gray-100 px-2 py-1 rounded-md">{task.code}</span>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan="2" className="px-6 py-4 text-center text-base text-gray-500">No tasks defined for this department.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};


const TimesheetGuide = () => {
    const [departments, setDepartments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        setLoading(true);
        const q = query(collection(db, "timesheet_departments"));

        const unsubscribe = onSnapshot(q, async (querySnapshot) => {
            try {
                const departmentsData = await Promise.all(querySnapshot.docs.map(async (deptDoc) => {
                    const tasksColRef = collection(db, `timesheet_departments/${deptDoc.id}/tasks`);
                    const tasksSnapshot = await getDocs(tasksColRef);
                    const tasks = tasksSnapshot.docs.map(taskDoc => ({ id: taskDoc.id, ...taskDoc.data() }));
                    tasks.sort((a, b) => a.name.localeCompare(b.name));
                    return { id: deptDoc.id, ...deptDoc.data(), tasks };
                }));
                
                departmentsData.sort((a, b) => a.name.localeCompare(b.name));
                setDepartments(departmentsData);
            } catch (err) {
                 console.error("Error processing timesheet guide data:", err);
                 setError("Could not load the timesheet guide.");
            } finally {
                setLoading(false);
            }
        }, (err) => {
            console.error("Error fetching timesheet guide data:", err);
            setError("Could not load the timesheet guide.");
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    if (loading) {
        return <div className="text-center p-8 text-base text-gray-500">Loading timesheet guide...</div>;
    }

    if (error) {
        return <div className="text-center p-8 text-base text-red-600 bg-red-50 rounded-lg">{error}</div>;
    }

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm">
            <p className="text-base text-gray-600 mb-6">Use this guide to find the correct department and task codes for your timesheet entries. Click on a department to expand its task list.</p>
            {departments.length > 0 ? (
                departments.map(dept => (
                    <DepartmentSection key={dept.id} dept={dept} />
                ))
            ) : (
                <div className="text-center p-8 text-gray-500 border-2 border-dashed border-gray-200 rounded-lg">
                    <h3 className="text-xl font-medium text-gray-900">No Departments Found</h3>
                    <p className="mt-1 text-base text-gray-500">The timesheet guide has not been configured yet.</p>
                </div>
            )}
        </div>
    );
};

export default TimesheetGuide;

