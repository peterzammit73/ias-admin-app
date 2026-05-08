// File location: src/modules/EmployeesDirectory.jsx
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, runTransaction, addDoc, updateDoc } from 'firebase/firestore';
import { db } from '/src/firebase.js';
import Modal from '/src/components/Modal.jsx';
import { PlusIcon, PencilIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

const EmployeesDirectory = ({ permission }) => {
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [currentEmployee, setCurrentEmployee] = useState(null);
    const [showOnlyActive, setShowOnlyActive] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    const initialNewEmployeeState = {
        name: '',
        middleName: '',
        surname: '',
        companyEmail: '',
        personalEmail: '',
        mobileNumber: '',
        idNumber: '',
        niNumber: '',
        address: '',
        isEmployed: true,
    };

    useEffect(() => {
        setLoading(true);
        const unsubscribe = onSnapshot(collection(db, "employees"), (snapshot) => {
            const employeesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            employeesData.sort((a, b) => (a.employeeNumber || 0) - (b.employeeNumber || 0));
            setEmployees(employeesData);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);
    
    const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        setCurrentEmployee(prevState => ({ ...prevState, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleAddNew = () => {
        setIsEditing(false);
        setCurrentEmployee(initialNewEmployeeState);
        setShowModal(true);
    };
    
    const handleEdit = (employee) => {
        setIsEditing(true);
        setCurrentEmployee(employee);
        setShowModal(true);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!currentEmployee.name || !currentEmployee.surname || !currentEmployee.companyEmail) {
            // A more user-friendly notification can be implemented here instead of alert
            console.error("First Name, Surname, and Company Email are required.");
            return;
        }

        if (isEditing) {
            const employeeRef = doc(db, "employees", currentEmployee.id);
            const { id, ...dataToUpdate } = currentEmployee;
            try {
                await updateDoc(employeeRef, dataToUpdate);
            } catch (error) {
                console.error("Error updating employee: ", error);
            }
        } else {
            const counterRef = doc(db, "counters", "employeeCounter");
            try {
                const newEmployeeNumber = await runTransaction(db, async (transaction) => {
                    const counterDoc = await transaction.get(counterRef);
                    if (!counterDoc.exists()) {
                        // If counter doesn't exist, create it.
                        transaction.set(counterRef, { lastNumber: 1 });
                        return 1;
                    };
                    const newNumber = counterDoc.data().lastNumber + 1;
                    transaction.update(counterRef, { lastNumber: newNumber });
                    return newNumber;
                });

                await addDoc(collection(db, "employees"), {
                    ...currentEmployee,
                    employeeNumber: newEmployeeNumber,
                    createdAt: new Date().toISOString().split('T')[0]
                });
            } catch (error) {
                console.error("Error adding employee: ", error);
            }
        }
        setShowModal(false);
    };

    const filteredEmployees = employees
        .filter(employee => !showOnlyActive || employee.isEmployed)
        .filter(employee => {
            const search = searchTerm.toLowerCase();
            return (employee.name && employee.name.toLowerCase().includes(search)) ||
                   (employee.surname && employee.surname.toLowerCase().includes(search)) ||
                   (employee.companyEmail && employee.companyEmail.toLowerCase().includes(search));
        });

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div className="flex-1">
                    <h2 className="text-lg font-semibold text-gray-900">Manage Employee Directory</h2>
                    <p className="mt-1 text-sm text-gray-600">View, add, or edit employee information.</p>
                </div>
                {permission === 'edit' && (
                     <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full md:w-auto">
                        <div className="relative w-full sm:w-auto">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                            </div>
                            <input
                                type="text"
                                placeholder="Search..."
                                className="block w-full rounded-md border-0 py-2 pl-10 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-orange-500 sm:text-sm sm:leading-6"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                         <div className="relative flex items-start">
                            <div className="flex h-6 items-center">
                                <input id="active-only-toggle" type="checkbox" className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-600" checked={showOnlyActive} onChange={() => setShowOnlyActive(!showOnlyActive)} />
                            </div>
                            <div className="ml-3 text-sm leading-6">
                                <label htmlFor="active-only-toggle" className="font-medium text-gray-900">Show Active Only</label>
                            </div>
                        </div>
                        <button className="flex items-center justify-center bg-orange-600 text-white border-none py-2 px-4 rounded-md text-sm font-medium cursor-pointer hover:bg-orange-700 w-full sm:w-auto" onClick={handleAddNew}>
                            <PlusIcon className="h-5 w-5 mr-2"/>
                            Add Employee
                        </button>
                    </div>
                )}
            </div>
            <div className="border border-gray-200 rounded-lg overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                     <thead className="bg-gray-50">
                        <tr>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Surname</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company Email</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mobile</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th scope="col" className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {loading ? (
                            <tr><td colSpan="7" className="px-6 py-4 text-center text-sm text-gray-500">Loading...</td></tr>
                        ) : filteredEmployees.length > 0 ? (
                            filteredEmployees.map(employee => (
                                <tr key={employee.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{String(employee.employeeNumber).padStart(4, '0')}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{employee.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{employee.surname}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{employee.companyEmail}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{employee.mobileNumber}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${employee.isEmployed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                            {employee.isEmployed ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button className="text-orange-600 hover:text-orange-900" onClick={() => handleEdit(employee)}>
                                            <PencilIcon className="h-5 w-5" />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr><td colSpan="7" className="px-6 py-4 text-center text-sm text-gray-500">No employees found.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            <Modal show={showModal} onClose={() => setShowModal(false)} title={isEditing ? "Edit Employee" : "Add New Employee"}>
                {currentEmployee && (
                    <form onSubmit={handleSave}>
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">First Name</label>
                                <input type="text" name="name" value={currentEmployee.name} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm" required />
                            </div>
                             <div>
                                <label className="block text-sm font-medium text-gray-700">Surname</label>
                                <input type="text" name="surname" value={currentEmployee.surname} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm" required />
                            </div>
                            <div className="sm:col-span-2">
                                <label className="block text-sm font-medium text-gray-700">Company Email</label>
                                <input type="email" name="companyEmail" value={currentEmployee.companyEmail} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm" required />
                            </div>
                             <div>
                                <label className="block text-sm font-medium text-gray-700">Mobile Number</label>
                                <input type="text" name="mobileNumber" value={currentEmployee.mobileNumber} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm" />
                            </div>
                             <div>
                                <label className="block text-sm font-medium text-gray-700">ID Card Number</label>
                                <input type="text" name="idNumber" value={currentEmployee.idNumber} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm" />
                            </div>
                             <div className="sm:col-span-2">
                                <div className="flex items-center">
                                    <input type="checkbox" name="isEmployed" checked={currentEmployee.isEmployed} onChange={handleInputChange} className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
                                    <label htmlFor="isEmployed" className="ml-2 block text-sm text-gray-900">Currently Employed</label>
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end pt-6 border-t border-gray-200 mt-6">
                            <button type="button" onClick={() => setShowModal(false)} className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500">Cancel</button>
                            <button type="submit" className="ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500">{isEditing ? "Save Changes" : "Save Employee"}</button>
                        </div>
                    </form>
                )}
            </Modal>
        </div>
    );
};

export default EmployeesDirectory;

