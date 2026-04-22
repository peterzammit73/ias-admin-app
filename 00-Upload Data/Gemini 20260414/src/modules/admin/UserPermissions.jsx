
// File location: src/modules/admin/UserPermissions.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '/src/firebase.js';
import { useData } from '/src/Context/DataProvider.jsx';
import { InformationCircleIcon, ShieldCheckIcon, EyeIcon, PencilIcon, NoSymbolIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

const UserPermissions = ({ currentUserId, user }) => {
    const { employees } = useData(); // Access global employees list
    const [rawUsers, setRawUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');

    // 1. Fetch raw users from the database
    useEffect(() => {
        if (!user) return;

        setLoading(true);
        setErrorMsg('');

        const unsubscribe = onSnapshot(
            collection(db, "users"),
            (snapshot) => {
                const usersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setRawUsers(usersData);
                setLoading(false);
            },
            (error) => {
                console.error("Firestore Permission Error:", error);
                if (error.code === 'permission-denied') {
                    setErrorMsg("Permission Denied: Your Firebase Security Rules are blocking access. Please update your Firestore rules in the Firebase Console to allow admins to read the 'users' collection.");
                } else {
                    setErrorMsg(`Failed to load users: ${error.message}`);
                }
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [user]);

    // 2. Filter out blank rows and inactive employees
    const displayUsers = useMemo(() => {
        // Build a set of emails that belong to ACTIVE employees
        const activeEmails = new Set();
        employees.forEach(emp => {
            if (emp.isEmployed === true) {
                if (emp.companyEmail) activeEmails.add(emp.companyEmail.toLowerCase().trim());
                if (emp.workEmail) activeEmails.add(emp.workEmail.toLowerCase().trim());
            }
        });

        return rawUsers
            .filter(u => {
                // Exclude admins and the current user
                if (u.isAdmin || u.id === currentUserId) return false;

                // Exclude blank or corrupted entries
                if (!u.email || u.email.trim() === '') return false;

                // Exclude anyone not in the active employees set
                const userEmailLower = u.email.toLowerCase().trim();
                return activeEmails.has(userEmailLower);
            })
            .sort((a, b) => a.email.localeCompare(b.email));
    }, [rawUsers, employees, currentUserId]);

    const handlePermissionChange = async (userId, module, value) => {
        const userDocRef = doc(db, "users", userId);
        try {
            await updateDoc(userDocRef, {
                [`permissions.${module}`]: value
            });
        } catch (error) {
            console.error("Error updating permissions: ", error);
            alert("Failed to update permissions. Ensure you have the correct Firestore security rules.");
        }
    };

    // Define all modules available in the sidebar
    const modules = [
        { key: 'employees', label: 'Office Staff' },
        { key: 'designTeam', label: 'Design Team' },
        { key: 'officeAdmin', label: 'Office Admin' },
        { key: 'billing', label: 'Billing' },
        { key: 'salaries', label: 'Salaries' },
        { key: 'webAdmin', label: 'Web Admin' }
    ];

    const permissionLevels = [
        { value: 'no-access', label: 'No Access', icon: NoSymbolIcon },
        { value: 'view', label: 'View Only', icon: EyeIcon },
        { value: 'edit', label: 'Edit (Full)', icon: PencilIcon }
    ];

    const getPermissionColorClass = (level) => {
        switch (level) {
            case 'no-access': return 'bg-gray-100 text-gray-600 border-gray-200';
            case 'view': return 'bg-blue-50 text-blue-700 border-blue-200';
            case 'edit': return 'bg-green-50 text-green-700 border-green-200';
            default: return 'bg-gray-50 text-gray-800 border-gray-200';
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 flex items-center">
                        <ShieldCheckIcon className="h-6 w-6 mr-2 text-indigo-600" />
                        User Access Control
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">Manage visibility and editing rights for active staff members.</p>
                </div>
            </div>

            {/* Permission Legend / Guide */}
            <div className="mb-6 bg-indigo-50 border border-indigo-100 rounded-lg p-4">
                <h4 className="text-sm font-bold text-indigo-900 mb-2 flex items-center">
                    <InformationCircleIcon className="h-5 w-5 mr-1.5" /> Permission Levels Explained
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="flex items-start">
                        <div className="p-1 bg-white rounded border border-gray-200 mr-2 shrink-0">
                            <NoSymbolIcon className="h-4 w-4 text-gray-500" />
                        </div>
                        <div>
                            <span className="font-semibold text-gray-700 block">No Access</span>
                            <span className="text-gray-600 text-xs">Tab is completely hidden from the user.</span>
                        </div>
                    </div>
                    <div className="flex items-start">
                        <div className="p-1 bg-white rounded border border-blue-200 mr-2 shrink-0">
                            <EyeIcon className="h-4 w-4 text-blue-600" />
                        </div>
                        <div>
                            <span className="font-semibold text-blue-700 block">View Only</span>
                            <span className="text-blue-800 text-xs">User can see data but <strong>cannot</strong> make changes, save, or delete.</span>
                        </div>
                    </div>
                    <div className="flex items-start">
                        <div className="p-1 bg-white rounded border border-green-200 mr-2 shrink-0">
                            <PencilIcon className="h-4 w-4 text-green-600" />
                        </div>
                        <div>
                            <span className="font-semibold text-green-700 block">Edit (Full)</span>
                            <span className="text-green-800 text-xs">Full access to add, edit, and delete records in this section.</span>
                        </div>
                    </div>
                </div>
            </div>

            {errorMsg && (
                <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 rounded-md shadow-sm flex items-start">
                    <ExclamationTriangleIcon className="h-6 w-6 mr-3 flex-shrink-0" />
                    <div>
                        <p className="font-bold">Database Access Blocked</p>
                        <p className="text-sm mt-1">{errorMsg}</p>
                    </div>
                </div>
            )}

            {!errorMsg && (
                <div className="border border-gray-200 rounded-lg overflow-x-auto shadow-sm">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 z-10 border-r border-gray-200">
                                    User Email
                                </th>
                                {modules.map(module => (
                                    <th key={module.key} scope="col" className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">
                                        {module.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {loading ? (
                                <tr><td colSpan={modules.length + 1} className="px-6 py-12 text-center text-sm text-gray-500">Loading users...</td></tr>
                            ) : displayUsers.length > 0 ? (
                                displayUsers.map(userItem => (
                                    <tr key={userItem.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 sticky left-0 bg-white border-r border-gray-100 group-hover:bg-gray-50">
                                            {userItem.email}
                                        </td>
                                        {modules.map(module => {
                                            const permission = userItem.permissions?.[module.key] || 'no-access';
                                            const colorClass = getPermissionColorClass(permission);
                                            return (
                                                <td key={module.key} className="px-4 py-3 text-sm text-gray-500 text-center">
                                                    <div className="relative inline-block w-full max-w-[140px]">
                                                        <select
                                                            value={permission}
                                                            onChange={(e) => handlePermissionChange(userItem.id, module.key, e.target.value)}
                                                            className={`block w-full rounded-md border-0 py-1.5 pl-3 pr-8 text-xs font-semibold shadow-sm ring-1 ring-inset focus:ring-2 focus:ring-inset sm:leading-6 cursor-pointer ${colorClass} focus:ring-indigo-600`}
                                                        >
                                                            {permissionLevels.map(level => (
                                                                <option key={level.value} value={level.value}>
                                                                    {level.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))
                            ) : (
                                <tr><td colSpan={modules.length + 1} className="px-6 py-12 text-center text-sm text-gray-500">No active, non-administrative users found.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default UserPermissions;