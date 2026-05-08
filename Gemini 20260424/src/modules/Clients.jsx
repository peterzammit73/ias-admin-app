// File Path: src/modules/Clients.jsx
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '/src/firebase.js';
import Modal from '/src/components/Modal.jsx';
import { PlusIcon, PencilIcon, TrashIcon, MagnifyingGlassIcon, UserIcon, BuildingOfficeIcon, ClockIcon } from '@heroicons/react/24/outline';

const Clients = ({ permission }) => {
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [currentClient, setCurrentClient] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    // Enhanced Initial State
    const initialFormState = {
        clientNumber: '',
        type: 'company',
        title: '',
        name: '',
        surname: '',
        companyName: '',
        vatNumber: '',
        email: '',
        mobileNumber: '',
        address: '',
        locality: '',
        postCode: '',
        country: '',
        contactActiveFrom: new Date().toISOString().split('T')[0],
        contactHistory: []
    };

    const reservedNumbers = [1000];

    useEffect(() => {
        setLoading(true);
        const q = collection(db, "clients");
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const clientsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            clientsData.sort((a, b) => (a.clientNumber || 0) - (b.clientNumber || 0));
            setClients(clientsData);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setCurrentClient(prevState => ({ ...prevState, [name]: value }));
    };

    const handleTypeChange = (type) => {
        // Prevent switching to individual if editing a company with a name
        if (isEditing && currentClient?.companyName && type === 'individual') {
            return;
        }
        setCurrentClient(prev => ({ ...prev, type }));
    };

    const handleAddNew = () => {
        if (permission !== 'edit') return;

        let nextClientNumber = 1;
        if (clients.length > 0) {
            const existingNumbers = clients
                .map(c => parseInt(c.clientNumber, 10))
                .filter(n => !isNaN(n) && n !== 1000)
                .sort((a, b) => a - b);

            if (existingNumbers.length > 0) {
                const max = existingNumbers[existingNumbers.length - 1];
                if (max === 999) nextClientNumber = 1001;
                else nextClientNumber = max + 1;
            }
        }

        const isTaken = (num) => clients.some(c => parseInt(c.clientNumber, 10) === num);
        while (isTaken(nextClientNumber) || reservedNumbers.includes(nextClientNumber)) {
            nextClientNumber++;
        }

        setIsEditing(false);
        const formattedClientNumber = String(nextClientNumber).padStart(4, '0');
        setCurrentClient({ ...initialFormState, clientNumber: formattedClientNumber });
        setShowModal(true);
    };

    const handleEdit = (client) => {
        if (permission !== 'edit') return;
        setIsEditing(true);
        setCurrentClient({
            ...initialFormState,
            ...client,
            type: client.type || (client.companyName ? 'company' : 'individual'),
            // Fallback for contactActiveFrom if migrating hasn't run yet or for new legacy data
            contactActiveFrom: client.contactActiveFrom || '2004-07-01'
        });
        setShowModal(true);
    };

    const handleDelete = async (id) => {
        if (permission !== 'edit') return;
        if (window.confirm("Are you sure you want to delete this client?")) {
            try {
                await deleteDoc(doc(db, "clients", id));
            } catch (error) {
                console.error("Error deleting client: ", error);
                alert("Failed to delete client.");
            }
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (permission !== 'edit') return;

        // Validation based on Type
        if (currentClient.type === 'company' && !currentClient.companyName) {
            alert("Company Name is required for Company clients.");
            return;
        }
        if (currentClient.type === 'individual' && (!currentClient.name || !currentClient.surname)) {
            alert("Name and Surname are required for Individual clients.");
            return;
        }

        try {
            // Check if contact person changed for Companies (Logic to archive old contact)
            if (isEditing && currentClient.type === 'company') {
                const original = clients.find(c => c.id === currentClient.id);
                if (original) {
                    const nameChanged = original.name !== currentClient.name || original.surname !== currentClient.surname;

                    if (nameChanged) {
                        // Calculate end date for the previous contact (Day before new active date)
                        const newStartDate = new Date(currentClient.contactActiveFrom);
                        const prevEndDate = new Date(newStartDate);
                        prevEndDate.setDate(prevEndDate.getDate() - 1);
                        const prevEndDateStr = prevEndDate.toISOString().split('T')[0];

                        // Determine start date for the OLD record
                        // Use original.contactActiveFrom if available, else fallback to 2004-07-01
                        const oldStartDate = original.contactActiveFrom || '2004-07-01';

                        const oldContact = {
                            name: original.name,
                            surname: original.surname,
                            email: original.email,
                            mobile: original.mobileNumber,
                            startDate: oldStartDate,
                            endDate: prevEndDateStr,
                            archivedAt: new Date().toISOString()
                        };

                        // Push old contact to history
                        currentClient.contactHistory = [
                            ...(currentClient.contactHistory || []),
                            oldContact
                        ];
                    }
                }
            }

            if (isEditing) {
                const clientRef = doc(db, "clients", currentClient.id);
                const { id, ...dataToUpdate } = currentClient;
                await updateDoc(clientRef, dataToUpdate);
            } else {
                await addDoc(collection(db, "clients"), currentClient);
            }
            setShowModal(false);
        } catch (error) {
            console.error("Error saving client: ", error);
            alert("Failed to save client.");
        }
    };

    const filteredClients = clients.filter(client =>
        (client.name && client.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (client.surname && client.surname.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (client.companyName && client.companyName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (client.clientNumber && String(client.clientNumber).padStart(4, '0').includes(searchTerm))
    );

    return (
        <div className="flex flex-col h-[calc(100vh-9rem)] bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {/* Header Section - Fixed */}
            <div className="p-6 border-b border-gray-200 shrink-0">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900">Clients Directory</h2>
                        <p className="mt-1 text-base text-gray-600">
                            {permission === 'edit' ? 'Manage company and individual clients.' : 'A read-only list of clients.'}
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="relative w-full sm:w-auto">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                            </div>
                            <input
                                type="text"
                                placeholder="Search..."
                                className="block w-full sm:w-64 rounded-md border-0 py-2 pl-10 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-orange-500 text-base"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        {permission === 'edit' && (
                            <button onClick={handleAddNew} className="flex items-center justify-center bg-orange-600 text-white py-2 px-4 rounded-md text-base font-medium hover:bg-orange-700">
                                <PlusIcon className="h-5 w-5 mr-2" />
                                Add Client
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Table Section - Scrollable */}
            <div className="flex-1 overflow-auto">
                <table className="min-w-full">
                    <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th scope="col" className="py-2 pl-4 pr-3 text-left text-base font-semibold text-gray-900 sm:pl-2">Client No.</th>
                            <th scope="col" className="px-3 py-2 text-left text-base font-semibold text-gray-900">Type</th>
                            <th scope="col" className="px-3 py-2 text-left text-base font-semibold text-gray-900">Primary Identity</th>
                            <th scope="col" className="px-3 py-2 text-left text-base font-semibold text-gray-900">Contact / Rep</th>
                            {permission === 'edit' && <th scope="col" className="relative py-3 pl-3 pr-4 sm:pr-6"><span className="sr-only">Edit</span></th>}
                        </tr>
                        {/* Faint Orange Line - Visual Separator */}
                        <tr className="h-px bg-orange-100">
                            <th colSpan={permission === 'edit' ? 5 : 4} className="p-0 border-0"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                        {loading ? (
                            <tr><td colSpan={permission === 'edit' ? 5 : 4} className="whitespace-nowrap px-3 py-4 text-base text-gray-500 text-center">Loading clients...</td></tr>
                        ) : filteredClients.length > 0 ? (
                            filteredClients.map((client) => {
                                const isCompany = client.type === 'company' || (!client.type && client.companyName);
                                // COLOR LOGIC: Company -> Orange, Individual -> Black/Dark Gray
                                const textClass = isCompany ? "text-orange-600 font-medium" : "text-gray-900 font-medium";

                                return (
                                    <tr key={client.id} className="hover:bg-gray-50">
                                        <td className={`whitespace-nowrap py-2 pl-4 pr-3 text-base sm:pl-2 ${textClass}`}>
                                            {String(client.clientNumber).padStart(4, '0')}
                                        </td>
                                        <td className="px-3 py-2 text-base text-gray-500">
                                            {isCompany ? <BuildingOfficeIcon className="h-4 w-4 text-gray-400 inline mr-1" title="Company" /> : <UserIcon className="h-4 w-4 text-gray-400 inline mr-1" title="Individual" />}
                                            <span className="text-xs">{isCompany ? 'Company' : 'Individual'}</span>
                                        </td>
                                        <td className={`px-3 py-2 text-base ${textClass}`}>
                                            {isCompany ? client.companyName : `${client.name} ${client.surname}`}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 text-base text-gray-500">
                                            {isCompany ? (
                                                <div className="flex flex-col">
                                                    <span className="text-sm text-gray-700 font-medium">{client.name} {client.surname}</span>
                                                    <span className="text-xs text-gray-400">{client.email}</span>
                                                </div>
                                            ) : (
                                                <span className="text-sm">{client.email}</span>
                                            )}
                                        </td>
                                        {permission === 'edit' && (
                                            <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                                                <button onClick={() => handleEdit(client)} className="text-orange-600 hover:text-orange-900 mr-4"><PencilIcon className="h-5 w-5" /></button>
                                                <button onClick={() => handleDelete(client.id)} className="text-gray-400 hover:text-red-600"><TrashIcon className="h-5 w-5" /></button>
                                            </td>
                                        )}
                                    </tr>
                                );
                            })
                        ) : (
                            <tr><td colSpan={permission === 'edit' ? 5 : 4} className="whitespace-nowrap px-3 py-4 text-base text-gray-500 text-center">No clients found.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <Modal show={showModal} onClose={() => setShowModal(false)} title={isEditing ? "Edit Client" : "Add New Client"} maxWidth="sm:max-w-2xl">
                {currentClient && (
                    <form onSubmit={handleSave} className="space-y-6">

                        {/* Type Selection */}
                        <div className="flex justify-center border-b border-gray-200 pb-4">
                            <div className="flex bg-gray-100 p-1 rounded-lg">
                                <button
                                    type="button"
                                    onClick={() => handleTypeChange('company')}
                                    className={`px-4 py-2 text-sm font-medium rounded-md flex items-center transition-all ${currentClient.type === 'company' ? 'bg-white shadow text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}
                                >
                                    <BuildingOfficeIcon className="h-4 w-4 mr-2" /> Company
                                </button>
                                {/* Disable Individual button if editing a company with a name */}
                                <button
                                    type="button"
                                    onClick={() => handleTypeChange('individual')}
                                    disabled={isEditing && currentClient.companyName && currentClient.companyName.trim() !== ''}
                                    className={`px-4 py-2 text-sm font-medium rounded-md flex items-center transition-all 
                                        ${currentClient.type === 'individual' ? 'bg-white shadow text-indigo-600' : 'text-gray-500 hover:text-gray-900'}
                                        ${(isEditing && currentClient.companyName && currentClient.companyName.trim() !== '') ? 'opacity-50 cursor-not-allowed' : ''}
                                    `}
                                    title={isEditing && currentClient.companyName ? "Cannot change type to Individual while Company Name is present." : ""}
                                >
                                    <UserIcon className="h-4 w-4 mr-2" /> Individual
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-6">
                            {/* Client Number - Row 1 (Full Width) */}
                            <div className="sm:col-span-6">
                                <label className="block text-sm font-medium text-gray-700">Client Number</label>
                                <input type="number" name="clientNumber" value={String(currentClient.clientNumber).padStart(4, '0')} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm bg-gray-100 text-gray-500 cursor-not-allowed" disabled />
                            </div>

                            {/* COMPANY SPECIFIC FIELDS */}
                            {currentClient.type === 'company' && (
                                <>
                                    <div className="sm:col-span-6">
                                        <label className="block text-sm font-bold text-gray-800">Company Name *</label>
                                        <input type="text" name="companyName" value={currentClient.companyName} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500" placeholder="e.g. Acme Corp Ltd" required />
                                    </div>
                                    <div className="sm:col-span-6 border-t border-gray-100 pt-2 mt-2">
                                        <div className="flex justify-between items-center mb-2">
                                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Current Contact Person</label>
                                            <div className="flex items-center text-xs">
                                                <label className="mr-2 text-gray-500">Effective From:</label>
                                                <input
                                                    type="date"
                                                    name="contactActiveFrom"
                                                    value={currentClient.contactActiveFrom}
                                                    onChange={handleInputChange}
                                                    className="p-1 border border-gray-300 rounded text-gray-700 focus:ring-indigo-500"
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-6 gap-4 bg-gray-50 p-3 rounded-md border border-gray-200 relative">
                                            {/* Info Tooltip for Logic */}
                                            <div className="absolute top-2 right-2 group">
                                                <ClockIcon className="h-4 w-4 text-gray-400 cursor-help" />
                                                <div className="hidden group-hover:block absolute right-0 w-64 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-10">
                                                    Changing these fields will automatically archive the previous contact using the "Effective From" date minus one day as the end date.
                                                </div>
                                            </div>

                                            <div className="col-span-3">
                                                <label className="block text-xs text-gray-500">First Name</label>
                                                <input type="text" name="name" value={currentClient.name} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm" placeholder="Contact Name" />
                                            </div>
                                            <div className="col-span-3">
                                                <label className="block text-xs text-gray-500">Surname</label>
                                                <input type="text" name="surname" value={currentClient.surname} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm" placeholder="Contact Surname" />
                                            </div>

                                            {/* Previous Contacts List */}
                                            {currentClient.contactHistory && currentClient.contactHistory.length > 0 && (
                                                <div className="col-span-6 mt-2 border-t pt-2">
                                                    <p className="text-xs font-bold text-gray-400 mb-1 flex items-center">History</p>
                                                    <div className="max-h-32 overflow-y-auto space-y-1">
                                                        {currentClient.contactHistory.slice().reverse().map((contact, idx) => (
                                                            <div key={idx} className="text-xs text-gray-600 bg-white p-2 rounded border border-gray-100 flex justify-between items-center">
                                                                <span className="font-medium">{contact.name} {contact.surname}</span>
                                                                <span className="text-gray-400 text-[10px]">
                                                                    {contact.startDate || '?'} &rarr; {contact.endDate}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* INDIVIDUAL SPECIFIC FIELDS */}
                            {currentClient.type === 'individual' && (
                                <>
                                    {/* Row 2: Title, Name, Surname */}
                                    <div className="sm:col-span-1">
                                        <label className="block text-sm font-medium text-gray-700">Title</label>
                                        <input type="text" name="title" value={currentClient.title} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" placeholder="Mr/Ms" />
                                    </div>
                                    <div className="sm:col-span-2">
                                        <label className="block text-sm font-bold text-gray-800">First Name *</label>
                                        <input type="text" name="name" value={currentClient.name} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500" required />
                                    </div>
                                    <div className="sm:col-span-3">
                                        <label className="block text-sm font-bold text-gray-800">Surname *</label>
                                        <input type="text" name="surname" value={currentClient.surname} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500" required />
                                    </div>
                                </>
                            )}

                            {/* SHARED FIELDS */}
                            <div className="sm:col-span-3">
                                <label className="block text-sm font-medium text-gray-700">Email Address</label>
                                <input type="email" name="email" value={currentClient.email} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" />
                            </div>
                            <div className="sm:col-span-3">
                                <label className="block text-sm font-medium text-gray-700">Mobile Number</label>
                                <input type="text" name="mobileNumber" value={currentClient.mobileNumber} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" />
                            </div>

                            <div className="sm:col-span-6 border-t border-gray-100 pt-4">
                                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Billing Details</h4>
                                <div className="grid grid-cols-6 gap-4">
                                    <div className="col-span-3">
                                        <label className="block text-sm font-medium text-gray-700">VAT Number</label>
                                        <input type="text" name="vatNumber" value={currentClient.vatNumber || ''} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" placeholder="e.g. MT..." />
                                    </div>
                                    <div className="col-span-6">
                                        <label className="block text-sm font-medium text-gray-700">Address</label>
                                        <textarea name="address" rows="2" value={currentClient.address || ''} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" placeholder="Street Address"></textarea>
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium text-gray-700">Locality</label>
                                        <input type="text" name="locality" value={currentClient.locality || ''} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium text-gray-700">Post Code</label>
                                        <input type="text" name="postCode" value={currentClient.postCode || ''} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium text-gray-700">Country</label>
                                        <input type="text" name="country" value={currentClient.country || ''} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end pt-6 border-t border-gray-200 mt-6 gap-3">
                            <button type="button" onClick={() => setShowModal(false)} className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                            <button type="submit" className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500">
                                {isEditing ? "Update Client" : "Create Client"}
                            </button>
                        </div>
                    </form>
                )}
            </Modal>
        </div>
    );
};
export default Clients;