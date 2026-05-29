// Root: src/modules/officeAdmin/OfficeStaff.jsx
import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, doc, deleteDoc, query, orderBy, runTransaction, getFirestore } from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app'; 
import { 
    PlusIcon, 
    PencilIcon, 
    TrashIcon, 
    BriefcaseIcon, 
    MagnifyingGlassIcon,
    BarsArrowUpIcon,
    BarsArrowDownIcon,
    XMarkIcon,
    CheckIcon,
    CalendarDaysIcon,
    EyeIcon,
    EyeSlashIcon
} from '@heroicons/react/24/outline';

// Using relative path
import { db } from '../../firebase.js';

const OfficeStaff = () => {
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState(null);
    
    // Filters & Sorting
    const [showOnlyActive, setShowOnlyActive] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'surname', direction: 'asc' });

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        surname: '',
        personalEmail: '',
        companyEmail: '', 
        jobTitle: '',
        mobileNumber: '', 
        employmentHistory: [], 
        isEmployed: true,
        isVisible: true // Default visibility
    });

    // Employment History State
    const [newPeriod, setNewPeriod] = useState({ startDate: '', endDate: '' });
    const [editPeriodId, setEditPeriodId] = useState(null);

    useEffect(() => {
        fetchEmployees();
    }, []);

    const fetchEmployees = async () => {
        setLoading(true);
        try {
            const q = query(collection(db, 'employees'), orderBy('surname', 'asc'));
            const snapshot = await getDocs(q);
            const items = snapshot.docs.map(doc => {
                const data = doc.data();
                
                // Backfill logic for legacy data
                let history = Array.isArray(data.employmentHistory) ? data.employmentHistory : [];
                // Clean history of nulls/invalid objects
                history = history.filter(h => h && typeof h === 'object' && h.startDate);

                // If no history but has legacy start date, create entry
                if (history.length === 0 && data.startDate) {
                    history = [{
                        id: 'legacy_entry',
                        startDate: data.startDate,
                        endDate: data.endDate || null
                    }];
                }

                return { 
                    id: doc.id, 
                    ...data,
                    employmentHistory: history
                };
            });
            setEmployees(items);
        } catch (error) {
            console.error("Error fetching employees:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const handleOpenModal = (employee = null) => {
        setEditPeriodId(null);
        setNewPeriod({ startDate: '', endDate: '' });

        if (employee) {
            setEditingEmployee(employee);
            setFormData({
                name: employee.name || '',
                surname: employee.surname || '',
                personalEmail: employee.personalEmail || '',
                companyEmail: employee.companyEmail || employee.workEmail || '',
                jobTitle: employee.jobTitle || '',
                mobileNumber: employee.mobileNumber || employee.mobile || '',
                employmentHistory: Array.isArray(employee.employmentHistory) ? [...employee.employmentHistory] : [],
                isEmployed: employee.isEmployed !== undefined ? employee.isEmployed : true,
                isVisible: employee.isVisible !== undefined ? employee.isVisible : true
            });
        } else {
            setEditingEmployee(null);
            setFormData({
                name: '',
                surname: '',
                personalEmail: '',
                companyEmail: '',
                jobTitle: '',
                mobileNumber: '',
                employmentHistory: [],
                isEmployed: true,
                isVisible: true
            });
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingEmployee(null);
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ 
            ...prev, 
            [name]: type === 'checkbox' ? checked : value 
        }));
    };

    // --- Employment History Logic ---

    const handleEditPeriod = (period) => {
        if (!period) return;
        setNewPeriod({
            startDate: period.startDate || '',
            endDate: period.endDate || ''
        });
        setEditPeriodId(period.id);
    };

    const handleSavePeriod = () => {
        if (!newPeriod.startDate) {
            alert("Start date is required.");
            return;
        }
        if (newPeriod.endDate && new Date(newPeriod.endDate) < new Date(newPeriod.startDate)) {
            alert("End date cannot be before start date.");
            return;
        }

        if (editPeriodId) {
            // Update existing
            setFormData(prev => ({
                ...prev,
                employmentHistory: prev.employmentHistory.map(p => 
                    p.id === editPeriodId 
                        ? { ...p, startDate: newPeriod.startDate, endDate: newPeriod.endDate || null }
                        : p
                ).sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
            }));
            setEditPeriodId(null);
        } else {
            // Add new
            const period = {
                id: Date.now().toString(),
                startDate: newPeriod.startDate,
                endDate: newPeriod.endDate || null
            };
             setFormData(prev => ({
                ...prev,
                employmentHistory: [...prev.employmentHistory, period].sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
            }));
        }
        setNewPeriod({ startDate: '', endDate: '' });
    };

    const cancelEditPeriod = () => {
        setEditPeriodId(null);
        setNewPeriod({ startDate: '', endDate: '' });
    };

    const removeEmploymentPeriod = (periodId) => {
        if (periodId === editPeriodId) cancelEditPeriod();
        setFormData(prev => ({
            ...prev,
            employmentHistory: prev.employmentHistory.filter(p => p.id !== periodId)
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        let finalHistory = [...formData.employmentHistory];

        // --- AUTO-SAVE LOGIC ---
        // If user typed in the box but didn't click "Add/Update", save it anyway
        if (newPeriod.startDate) {
             if (newPeriod.endDate && new Date(newPeriod.endDate) < new Date(newPeriod.startDate)) {
                alert("End date cannot be before start date in the pending entry.");
                return;
            }

            if (editPeriodId) {
                // Update specific entry if we were editing
                finalHistory = finalHistory.map(p => 
                    p.id === editPeriodId 
                        ? { ...p, startDate: newPeriod.startDate, endDate: newPeriod.endDate || null }
                        : p
                 );
            } else {
                // Add as new entry
                const autoPeriod = {
                    id: Date.now().toString(),
                    startDate: newPeriod.startDate,
                    endDate: newPeriod.endDate || null
                };
                finalHistory.push(autoPeriod);
            }
        }

        finalHistory.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

        // Determine main start date (Earliest ever)
        const legacyStartDate = finalHistory.length > 0 ? finalHistory[0].startDate : '';
        
        // Determine end date (Latest, if inactive)
        let legacyEndDate = '';
        if (!formData.isEmployed && finalHistory.length > 0) {
             legacyEndDate = finalHistory[finalHistory.length - 1].endDate || '';
        }

        const payload = {
            ...formData,
            employmentHistory: finalHistory,
            startDate: legacyStartDate,
            endDate: legacyEndDate,
            updatedAt: new Date().toISOString()
        };

        try {
            if (editingEmployee) {
                await updateDoc(doc(db, 'employees', editingEmployee.id), payload);
            } else {
                const counterRef = doc(db, "counters", "employeeCounter");
                const newEmployeeNumber = await runTransaction(db, async (transaction) => {
                    const counterDoc = await transaction.get(counterRef);
                    if (!counterDoc.exists()) {
                        transaction.set(counterRef, { lastNumber: 1 });
                        return 1;
                    };
                    const newNumber = counterDoc.data().lastNumber + 1;
                    transaction.update(counterRef, { lastNumber: newNumber });
                    return newNumber;
                });

                await addDoc(collection(db, 'employees'), {
                    ...payload,
                    employeeNumber: newEmployeeNumber,
                    createdAt: new Date().toISOString()
                });
            }
            handleCloseModal();
            fetchEmployees();
        } catch (error) {
            console.error("Error saving employee:", error);
            alert("Failed to save employee.");
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm("Are you sure you want to delete this employee? This cannot be undone.")) {
            try {
                await deleteDoc(doc(db, 'employees', id));
                fetchEmployees();
            } catch (error) {
                console.error("Error deleting employee:", error);
            }
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'Present';
        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return dateStr;
            return date.toLocaleDateString('en-GB');
        } catch (e) {
            return dateStr;
        }
    };

    const getStatusBadge = (employee) => {
        if (employee.isEmployed !== undefined) {
             return employee.isEmployed 
                ? <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Active</span>
                : <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">Inactive</span>;
        }
        
        let isActive = false;
        try {
            const today = new Date();
            today.setHours(0,0,0,0);
            const history = Array.isArray(employee?.employmentHistory) ? employee.employmentHistory : [];
            
            isActive = history.some(period => {
                if (!period || !period.startDate) return false;
                const start = new Date(period.startDate);
                const end = period.endDate ? new Date(period.endDate) : null;
                return start <= today && (!end || end >= today);
            });
        } catch (e) {
            isActive = false;
        }

        return isActive 
            ? <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Active</span>
            : <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">Inactive</span>;
    };

    const filteredEmployees = employees
        .filter(emp => {
            if (showOnlyActive && !emp.isEmployed) return false;
            
            const searchLower = searchTerm.toLowerCase();
            const fullName = `${emp.name || ''} ${emp.surname || ''}`.toLowerCase();
            const email = (emp.companyEmail || emp.workEmail || '').toLowerCase();
            const empNum = emp.employeeNumber ? String(emp.employeeNumber) : '';
            
            return fullName.includes(searchLower) || email.includes(searchLower) || empNum.includes(searchLower);
        })
        .sort((a, b) => {
            if (sortConfig.key === 'employeeNumber') {
                const numA = a.employeeNumber || 0;
                const numB = b.employeeNumber || 0;
                return sortConfig.direction === 'asc' ? numA - numB : numB - numA;
            } else {
                const nameA = `${a.surname || ''} ${a.name || ''}`.toLowerCase();
                const nameB = `${b.surname || ''} ${b.name || ''}`.toLowerCase();
                if (nameA < nameB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (nameA > nameB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            }
        });

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            {/* Header & Controls */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Office Staff</h1>
                    <p className="text-sm text-gray-500">Manage employee profiles and employment history</p>
                </div>
                
                <div className="flex flex-col sm:flex-row items-center gap-4 w-full lg:w-auto">
                    {/* Search Bar */}
                    <div className="relative w-full sm:w-64">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                        </div>
                        <input
                            type="text"
                            placeholder="Search staff..."
                            className="block w-full rounded-md border-0 py-1.5 pl-10 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    {/* Active Toggle */}
                    <div className="flex items-center bg-white border border-gray-300 rounded-md p-1 shadow-sm shrink-0">
                        <button
                            onClick={() => setShowOnlyActive(true)}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${showOnlyActive ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Active
                        </button>
                        <button
                            onClick={() => setShowOnlyActive(false)}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${!showOnlyActive ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            All
                        </button>
                    </div>

                    <button 
                        onClick={() => handleOpenModal()}
                        className="flex items-center justify-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors shadow-sm w-full sm:w-auto shrink-0"
                    >
                        <PlusIcon className="h-5 w-5 mr-2" />
                        Add Employee
                    </button>
                </div>
            </div>

            {/* List View */}
            <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
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
                                    Name
                                    <span className="ml-2 flex-none rounded bg-gray-200 text-gray-900 group-hover:bg-gray-300">
                                        {sortConfig.key === 'surname' ? (
                                            sortConfig.direction === 'asc' ? <BarsArrowUpIcon className="h-4 w-4" /> : <BarsArrowDownIcon className="h-4 w-4" />
                                        ) : (
                                            <BarsArrowUpIcon className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-50" />
                                        )}
                                    </span>
                                </div>
                            </th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Visible</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">History</th>
                            <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {loading ? (
                            <tr><td colSpan="7" className="px-6 py-4 text-center text-sm text-gray-500">Loading staff...</td></tr>
                        ) : filteredEmployees.length === 0 ? (
                            <tr><td colSpan="7" className="px-6 py-4 text-center text-sm text-gray-500">No employees found.</td></tr>
                        ) : (
                            filteredEmployees.map((emp) => (
                                <tr key={emp.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-mono">
                                        {emp.employeeNumber ? String(emp.employeeNumber).padStart(4, '0') : '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center">
                                            <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs mr-3 ${emp.isEmployed ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-200 text-gray-500'}`}>
                                                {emp.name?.[0]}{emp.surname?.[0]}
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium text-gray-900">{emp.surname}, {emp.name}</div>
                                                <div className="text-xs text-gray-500">{emp.jobTitle}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="text-sm text-gray-900">{emp.companyEmail || emp.workEmail}</div>
                                        <div className="text-xs text-gray-500">{emp.mobileNumber || emp.mobile}</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {getStatusBadge(emp)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {emp.isVisible === false 
                                            ? <span className="inline-flex items-center text-xs font-medium text-gray-400"><EyeSlashIcon className="h-4 w-4 mr-1"/> Hidden</span>
                                            : <span className="inline-flex items-center text-xs font-medium text-green-600"><EyeIcon className="h-4 w-4 mr-1"/> Visible</span>
                                        }
                                    </td>
                                    <td className="px-6 py-4">
                                        {emp.employmentHistory && emp.employmentHistory.length > 0 ? (
                                            <div className="flex flex-col space-y-1">
                                                {emp.employmentHistory.map((period, index) => (
                                                    <div key={index} className="text-xs text-gray-600 flex items-center whitespace-nowrap">
                                                        <CalendarDaysIcon className="h-3 w-3 mr-1 text-gray-400" />
                                                        <span className="font-medium">{formatDate(period.startDate)}</span>
                                                        <span className="mx-1">-</span>
                                                        <span>{period.endDate ? formatDate(period.endDate) : <span className="text-green-600 font-medium">Present</span>}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-gray-400 italic">No history</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button onClick={() => handleOpenModal(emp)} className="text-indigo-600 hover:text-indigo-900 mr-4">
                                            <PencilIcon className="h-5 w-5" />
                                        </button>
                                        <button onClick={() => handleDelete(emp.id)} className="text-red-600 hover:text-red-900">
                                            <TrashIcon className="h-5 w-5" />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Edit/Add Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                    <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={handleCloseModal}></div>

                        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

                        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
                            <form onSubmit={handleSubmit}>
                                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4 max-h-[80vh] overflow-y-auto">
                                    <div className="sm:flex sm:items-start">
                                        <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                                            <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                                                {editingEmployee ? 'Edit Employee' : 'Add New Employee'}
                                            </h3>
                                            
                                            {/* Basic Info Section */}
                                            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700">First Name</label>
                                                    <input type="text" name="name" value={formData.name} onChange={handleChange} required className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:ring-indigo-500 focus:border-indigo-500" />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700">Surname</label>
                                                    <input type="text" name="surname" value={formData.surname} onChange={handleChange} required className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:ring-indigo-500 focus:border-indigo-500" />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700">Job Title</label>
                                                    <input type="text" name="jobTitle" value={formData.jobTitle} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:ring-indigo-500 focus:border-indigo-500" />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700">Mobile Number</label>
                                                    <input type="text" name="mobileNumber" value={formData.mobileNumber} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:ring-indigo-500 focus:border-indigo-500" />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700">Company Email</label>
                                                    <input type="email" name="companyEmail" value={formData.companyEmail} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:ring-indigo-500 focus:border-indigo-500" />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700">Personal Email</label>
                                                    <input type="email" name="personalEmail" value={formData.personalEmail} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:ring-indigo-500 focus:border-indigo-500" />
                                                </div>
                                                
                                                <div className="md:col-span-2 space-y-2">
                                                    <div className="flex items-center mt-2">
                                                        <input 
                                                            id="isEmployed" 
                                                            name="isEmployed" 
                                                            type="checkbox" 
                                                            checked={formData.isEmployed} 
                                                            onChange={handleChange} 
                                                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                                        />
                                                        <label htmlFor="isEmployed" className="ml-2 block text-sm text-gray-900">
                                                            Currently Employed (Active)
                                                        </label>
                                                    </div>
                                                    <div className="flex items-center mt-2">
                                                        <input 
                                                            id="isVisible" 
                                                            name="isVisible" 
                                                            type="checkbox" 
                                                            checked={formData.isVisible} 
                                                            onChange={handleChange} 
                                                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                                        />
                                                        <label htmlFor="isVisible" className="ml-2 block text-sm text-gray-900">
                                                            Visible in Directory & Lists
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Employment History Section */}
                                            <div className="mt-6 border-t pt-4">
                                                <h4 className="text-sm font-bold text-gray-900 mb-2 flex items-center">
                                                    <BriefcaseIcon className="h-4 w-4 mr-1"/> Employment Timeline (Current & Past)
                                                </h4>
                                                <p className="text-xs text-gray-500 mb-3">
                                                    {editPeriodId 
                                                        ? <span className="text-orange-600 font-semibold">Editing selected period. Change dates below.</span>
                                                        : "Add employment periods here. To set a current start date, enter the Start Date and leave End Date blank."
                                                    }
                                                </p>
                                                
                                                <div className={`p-3 rounded-md mb-3 border ${editPeriodId ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200'}`}>
                                                    <div className="grid grid-cols-7 gap-2 items-end">
                                                        <div className="col-span-3">
                                                            <label className={`block text-xs font-medium ${editPeriodId ? 'text-orange-700' : 'text-blue-700'}`}>Start Date</label>
                                                            <input 
                                                                type="date" 
                                                                value={newPeriod.startDate} 
                                                                onChange={(e) => setNewPeriod({...newPeriod, startDate: e.target.value})} 
                                                                className="w-full p-1.5 text-sm border border-gray-300 rounded focus:ring-indigo-500 focus:border-indigo-500"
                                                            />
                                                        </div>
                                                        <div className="col-span-3">
                                                            <label className={`block text-xs font-medium ${editPeriodId ? 'text-orange-700' : 'text-blue-700'}`}>End Date (Leave blank if current)</label>
                                                            <input 
                                                                type="date" 
                                                                value={newPeriod.endDate} 
                                                                onChange={(e) => setNewPeriod({...newPeriod, endDate: e.target.value})} 
                                                                className="w-full p-1.5 text-sm border border-gray-300 rounded focus:ring-indigo-500 focus:border-indigo-500"
                                                            />
                                                        </div>
                                                        <div className="col-span-1 flex gap-1">
                                                            <button 
                                                                type="button" 
                                                                onClick={handleSavePeriod}
                                                                className={`w-full text-white p-1.5 rounded text-xs font-bold transition-colors shadow-sm ${editPeriodId ? 'bg-orange-600 hover:bg-orange-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                                                            >
                                                                {editPeriodId ? <CheckIcon className="h-4 w-4 mx-auto"/> : "Add"}
                                                            </button>
                                                            {editPeriodId && (
                                                                <button 
                                                                    type="button" 
                                                                    onClick={cancelEditPeriod}
                                                                    className="w-full bg-gray-400 text-white p-1.5 rounded text-xs font-bold hover:bg-gray-500 transition-colors shadow-sm"
                                                                >
                                                                    <XMarkIcon className="h-4 w-4 mx-auto"/>
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-md">
                                                    {formData.employmentHistory.length === 0 ? (
                                                        <p className="text-xs text-gray-500 italic text-center py-4">No employment history recorded.</p>
                                                    ) : (
                                                        <table className="min-w-full text-xs">
                                                            <tbody className="divide-y divide-gray-200">
                                                                {formData.employmentHistory.map((period) => (
                                                                    <tr key={period.id} className={`${editPeriodId === period.id ? 'bg-orange-50' : 'hover:bg-gray-50'}`}>
                                                                        <td className="py-2 pl-3 text-gray-900 font-medium">
                                                                            {formatDate(period.startDate)}
                                                                        </td>
                                                                        <td className="py-2 text-center text-gray-500">to</td>
                                                                        <td className="py-2 text-gray-900 font-medium">
                                                                            {formatDate(period.endDate)}
                                                                        </td>
                                                                        <td className="py-2 pr-2 text-right flex justify-end gap-2">
                                                                            <button type="button" onClick={() => handleEditPeriod(period)} className="text-blue-600 hover:text-blue-800">
                                                                                <PencilIcon className="h-4 w-4"/>
                                                                            </button>
                                                                            <button type="button" onClick={() => removeEmploymentPeriod(period.id)} className="text-red-500 hover:text-red-700">
                                                                                <TrashIcon className="h-4 w-4"/>
                                                                            </button>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    )}
                                                </div>
                                            </div>

                                        </div>
                                    </div>
                                </div>
                                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse border-t border-gray-200">
                                    <button type="submit" className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none sm:ml-3 sm:w-auto sm:text-sm">
                                        Save Employee
                                    </button>
                                    <button type="button" onClick={handleCloseModal} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm">
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OfficeStaff;