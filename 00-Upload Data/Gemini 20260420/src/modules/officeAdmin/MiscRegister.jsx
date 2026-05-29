// Root: src/modules/officeAdmin/MiscRegister.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '/src/firebase.js';
import Modal from '/src/components/Modal.jsx';
import { useData } from '/src/Context/DataProvider.jsx';
import {
    PlusIcon,
    PencilIcon,
    TrashIcon,
    MagnifyingGlassIcon,
    FolderOpenIcon,
    BarsArrowUpIcon,
    BarsArrowDownIcon
} from '@heroicons/react/24/outline';

const MiscRegister = ({ permission }) => {
    const { clients } = useData(); // Fetch global clients list
    const [miscFiles, setMiscFiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [currentFile, setCurrentFile] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [sortConfig, setSortConfig] = useState({ key: 'code', direction: 'desc' });

    const initialFormState = {
        code: '',
        client: '',
        description: '',
        status: 'Active'
    };

    useEffect(() => {
        setLoading(true);
        const q = collection(db, "misc_register");
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const filesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMiscFiles(filesData);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        if (name === 'statusToggle') {
            setCurrentFile(prevState => ({ ...prevState, status: checked ? 'Active' : 'Closed' }));
        } else {
            setCurrentFile(prevState => ({ ...prevState, [name]: value }));
        }
    };

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const handleToggleStatus = async (id, currentStatus) => {
        if (permission !== 'edit') return;
        const newStatus = currentStatus === 'Active' ? 'Closed' : 'Active';
        try {
            await updateDoc(doc(db, "misc_register", id), { status: newStatus });
        } catch (error) {
            console.error("Error toggling status:", error);
            alert("Failed to update status.");
        }
    };

    const handleAddNew = () => {
        if (permission !== 'edit') return;

        // Baseline set to 777 so the first generated code is 778
        let lastCodeNum = 777;

        if (miscFiles.length > 0) {
            const validCodes = miscFiles
                .map(f => parseInt(f.code, 10))
                .filter(n => !isNaN(n));

            if (validCodes.length > 0) {
                // Use the highest existing code, but never drop below the 777 baseline
                lastCodeNum = Math.max(lastCodeNum, ...validCodes);
            }
        }

        const nextCode = lastCodeNum + 1;
        setIsEditing(false);
        const formattedCode = String(nextCode).padStart(4, '0');

        setCurrentFile({ ...initialFormState, code: formattedCode });
        setShowModal(true);
    };

    const handleEdit = (file) => {
        if (permission !== 'edit') return;
        setIsEditing(true);
        setCurrentFile({
            ...file
        });
        setShowModal(true);
    };

    const handleDelete = async (id) => {
        if (permission !== 'edit') return;
        if (window.confirm("Are you sure you want to delete this miscellaneous file?")) {
            try {
                await deleteDoc(doc(db, "misc_register", id));
            } catch (error) {
                console.error("Error deleting file:", error);
                alert("Failed to delete file.");
            }
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (permission !== 'edit') return;

        if (!currentFile.code || !currentFile.client || !currentFile.description) {
            alert("Please fill in the Code, Client, and Description.");
            return;
        }

        try {
            const dataToSave = {
                ...currentFile,
                code: String(currentFile.code).padStart(4, '0'),
                updatedAt: new Date().toISOString()
            };

            if (isEditing) {
                const docRef = doc(db, "misc_register", currentFile.id);
                const { id, ...dataToUpdate } = dataToSave;
                await updateDoc(docRef, dataToUpdate);
            } else {
                dataToSave.createdAt = new Date().toISOString();
                await addDoc(collection(db, "misc_register"), dataToSave);
            }
            setShowModal(false);
        } catch (error) {
            console.error("Error saving file:", error);
            alert("Failed to save file.");
        }
    };

    const filteredFiles = useMemo(() => {
        let data = miscFiles.filter(file => {
            if (statusFilter !== 'all' && file.status !== statusFilter) {
                return false;
            }
            const searchTermLower = searchTerm.toLowerCase();
            return (
                (file.code && file.code.toLowerCase().includes(searchTermLower)) ||
                (file.client && file.client.toLowerCase().includes(searchTermLower)) ||
                (file.description && file.description.toLowerCase().includes(searchTermLower))
            );
        });

        if (sortConfig.key) {
            data.sort((a, b) => {
                let aValue = a[sortConfig.key] || '';
                let bValue = b[sortConfig.key] || '';

                if (sortConfig.key === 'code') {
                    aValue = parseInt(aValue, 10) || 0;
                    bValue = parseInt(bValue, 10) || 0;
                } else {
                    aValue = String(aValue).toLowerCase();
                    bValue = String(bValue).toLowerCase();
                }

                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return data;
    }, [miscFiles, searchTerm, sortConfig, statusFilter]);

    const SortIcon = ({ columnKey }) => {
        if (sortConfig.key !== columnKey) {
            return <BarsArrowUpIcon className="h-4 w-4 text-gray-300 opacity-0 group-hover:opacity-100 inline ml-1" />;
        }
        return sortConfig.direction === 'asc'
            ? <BarsArrowUpIcon className="h-4 w-4 text-orange-600 inline ml-1" />
            : <BarsArrowDownIcon className="h-4 w-4 text-orange-600 inline ml-1" />;
    };

    return (
        <div className="flex flex-col h-[calc(100vh-9rem)] bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {/* Header Section */}
            <div className="p-6 border-b border-gray-200 shrink-0">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900 flex items-center">
                            <FolderOpenIcon className="h-6 w-6 mr-2 text-orange-600" />
                            0999 Misc Register
                        </h2>
                        <p className="mt-1 text-base text-gray-600">
                            {permission === 'edit' ? 'Manage sub-files for the 0999 Miscellaneous project.' : 'A read-only directory of 0999 miscellaneous files.'}
                        </p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
                        <div className="relative min-w-[140px]">
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="block w-full rounded-md border-gray-300 py-2 pl-3 text-gray-900 focus:ring-2 focus:ring-orange-500 sm:text-base outline-none"
                            >
                                <option value="all">All Statuses</option>
                                <option value="Active">Active Only</option>
                                <option value="Closed">Closed Only</option>
                            </select>
                        </div>
                        <div className="relative w-full sm:w-64">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                            </div>
                            <input
                                type="text"
                                placeholder="Search..."
                                className="block w-full rounded-md border-gray-300 py-2 pl-10 text-gray-900 focus:ring-2 focus:ring-orange-500 text-base outline-none"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        {permission === 'edit' && (
                            <button onClick={handleAddNew} className="flex items-center justify-center bg-orange-600 text-white py-2 px-4 rounded-md text-base font-medium hover:bg-orange-700 w-full sm:w-auto transition-colors">
                                <PlusIcon className="h-5 w-5 mr-2" />
                                Add Misc File
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Table Section */}
            <div className="flex-1 overflow-auto">
                <table className="min-w-full">
                    <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm border-b border-gray-200">
                        <tr>
                            <th scope="col" className="py-3 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6 cursor-pointer hover:bg-gray-100 group w-32" onClick={() => handleSort('code')}>
                                Code <SortIcon columnKey="code" />
                            </th>
                            <th scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100 group" onClick={() => handleSort('client')}>
                                Client <SortIcon columnKey="client" />
                            </th>
                            <th scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100 group" onClick={() => handleSort('description')}>
                                Description <SortIcon columnKey="description" />
                            </th>
                            <th scope="col" className="px-3 py-3 text-center text-sm font-semibold text-gray-900 w-32">
                                Status
                            </th>
                            {permission === 'edit' && <th scope="col" className="relative py-3 pl-3 pr-4 sm:pr-6 w-24"><span className="sr-only">Edit</span></th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                        {loading ? (
                            <tr><td colSpan={permission === 'edit' ? 5 : 4} className="whitespace-nowrap px-3 py-12 text-base text-gray-500 text-center">Loading files...</td></tr>
                        ) : filteredFiles.length > 0 ? (
                            filteredFiles.map((file) => (
                                <tr key={file.id} className="hover:bg-orange-50">
                                    <td className="whitespace-nowrap py-3 pl-4 pr-3 text-sm font-medium text-orange-600 sm:pl-6 font-mono">
                                        {file.code}
                                    </td>
                                    <td className="px-3 py-3 text-sm text-gray-900 font-medium">
                                        {file.client}
                                    </td>
                                    <td className="px-3 py-3 text-sm text-gray-500">
                                        {file.description}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-3 text-center">
                                        {permission === 'edit' ? (
                                            <input
                                                type="checkbox"
                                                className="h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-600 cursor-pointer"
                                                checked={file.status === 'Active'}
                                                onChange={() => handleToggleStatus(file.id, file.status)}
                                                title="Toggle Active/Closed Status"
                                            />
                                        ) : (
                                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded ${file.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                                                {file.status}
                                            </span>
                                        )}
                                    </td>
                                    {permission === 'edit' && (
                                        <td className="relative whitespace-nowrap py-3 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                                            <button onClick={() => handleEdit(file)} className="text-orange-600 hover:text-orange-900 mr-4"><PencilIcon className="h-5 w-5" /></button>
                                            <button onClick={() => handleDelete(file.id)} className="text-gray-400 hover:text-red-600"><TrashIcon className="h-5 w-5" /></button>
                                        </td>
                                    )}
                                </tr>
                            ))
                        ) : (
                            <tr><td colSpan={permission === 'edit' ? 5 : 4} className="whitespace-nowrap px-3 py-12 text-base text-gray-500 text-center">No files found.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal for Add/Edit */}
            <Modal show={showModal} onClose={() => setShowModal(false)} title={isEditing ? "Edit Misc File" : "New Misc File"} maxWidth="sm:max-w-xl">
                {currentFile && (
                    <form onSubmit={handleSave} className="space-y-4">
                        <div className="bg-orange-50 p-3 rounded border border-orange-200 mb-4 text-sm text-orange-800">
                            You are managing sub-files for the <strong>0999 Miscellaneous</strong> project.
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Misc Code</label>
                                <input type="text" name="code" value={currentFile.code} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm bg-gray-100 text-gray-600 font-mono focus:ring-0" required disabled={isEditing} title="Code is auto-generated and locked" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Client</label>
                                <input
                                    list="misc-clients-datalist"
                                    type="text"
                                    name="client"
                                    value={currentFile.client}
                                    onChange={handleInputChange}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500"
                                    placeholder="Select or type client..."
                                    required
                                />
                                <datalist id="misc-clients-datalist">
                                    {clients.map(c => {
                                        const clientName = c.companyName || `${c.name || ''} ${c.surname || ''}`.trim();
                                        return clientName ? <option key={c.id} value={clientName} /> : null;
                                    })}
                                </datalist>
                            </div>
                            <div className="sm:col-span-2">
                                <label className="block text-sm font-medium text-gray-700">Description of Works</label>
                                <textarea name="description" rows="3" value={currentFile.description} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500" placeholder="Brief details about the task..." required />
                            </div>
                            <div className="sm:col-span-2 mt-2">
                                <div className="flex items-center">
                                    <input type="checkbox" id="statusToggle" name="statusToggle" checked={currentFile.status === 'Active'} onChange={handleInputChange} className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
                                    <label htmlFor="statusToggle" className="ml-2 block text-sm text-gray-900 font-medium">Set as Active</label>
                                </div>
                                <p className="text-xs text-gray-500 mt-1 ml-6">Only active codes will appear in the timesheet dropdown.</p>
                            </div>
                        </div>

                        <div className="flex justify-end pt-4 border-t border-gray-200 mt-6 gap-3">
                            <button type="button" onClick={() => setShowModal(false)} className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                            <button type="submit" className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500">
                                {isEditing ? "Save Changes" : "Create File"}
                            </button>
                        </div>
                    </form>
                )}
            </Modal>
        </div>
    );
};

export default MiscRegister;