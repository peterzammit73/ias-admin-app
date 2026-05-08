// src/modules/employee/MyProfile.jsx
// Version: 1.7 - Grey Color Scheme
import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import {
    UserCircleIcon,
    PhoneIcon,
    EnvelopeIcon,
    BriefcaseIcon,
    IdentificationIcon,
    MapPinIcon,
    PencilSquareIcon,
    CheckIcon,
    XMarkIcon
} from '@heroicons/react/24/outline';

const MyProfile = ({ user }) => {
    const [employee, setEmployee] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [saving, setSaving] = useState(false);

    // Editable Form State
    const [formData, setFormData] = useState({
        mobileNumber: '',
        personalEmail: '',
        address: ''
    });

    useEffect(() => {
        const fetchProfile = async () => {
            if (!user?.email) return;
            setLoading(true);
            try {
                // Match by company email which matches the auth email
                const q = query(collection(db, 'employees'), where('companyEmail', '==', user.email));
                const snapshot = await getDocs(q);

                if (!snapshot.empty) {
                    const docSnap = snapshot.docs[0];
                    const data = docSnap.data();
                    setEmployee({ id: docSnap.id, ...data });
                    setFormData({
                        mobileNumber: data.mobileNumber || '',
                        personalEmail: data.personalEmail || '',
                        address: data.address || ''
                    });
                }
            } catch (error) {
                console.error("Error fetching profile:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchProfile();
    }, [user]);

    const handleSave = async () => {
        if (!employee) return;
        setSaving(true);
        try {
            const docRef = doc(db, 'employees', employee.id);
            await updateDoc(docRef, {
                mobileNumber: formData.mobileNumber,
                personalEmail: formData.personalEmail,
                address: formData.address,
                updatedAt: new Date().toISOString() // Track when it was last updated
            });

            // Update local state
            setEmployee(prev => ({ ...prev, ...formData }));
            setIsEditing(false);
        } catch (error) {
            console.error("Error saving profile:", error);
            alert("Failed to save changes.");
        } finally {
            setSaving(false);
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'Present';
        return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    if (loading) return <div className="p-12 text-center text-gray-500">Loading profile...</div>;
    if (!employee) return <div className="p-12 text-center text-gray-500">Employee record not found.</div>;

    return (
        <div className="max-w-4xl mx-auto space-y-6">

            {/* Header Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-gray-400 h-32 w-full"></div>
                <div className="px-6 pb-6">
                    <div className="flex flex-col sm:flex-row items-center sm:items-end -mt-12 mb-4">
                        <div className="h-24 w-24 rounded-full border-4 border-white bg-white shadow-md flex items-center justify-center text-gray-700 text-3xl font-bold uppercase">
                            {employee.name?.[0]}{employee.surname?.[0]}
                        </div>
                        <div className="mt-4 sm:mt-0 sm:ml-4 text-center sm:text-left flex-1">
                            <h1 className="text-2xl font-bold text-gray-900">{employee.name} {employee.surname}</h1>
                            <p className="text-gray-500 font-medium">{employee.jobTitle}</p>
                        </div>
                        <div className="mt-4 sm:mt-0">
                            {/* Updated Badge Colors: Grey/Dark Grey only */}
                            <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${employee.isEmployed ? 'bg-gray-100 text-gray-800 border-gray-300' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                                {employee.isEmployed ? 'Active Employee' : 'Former Employee'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Contact Information (Editable) */}
                <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-bold text-gray-900 flex items-center">
                            <UserCircleIcon className="h-6 w-6 text-gray-600 mr-2" />
                            Personal Details
                        </h2>
                        {!isEditing ? (
                            <button
                                onClick={() => setIsEditing(true)}
                                className="text-gray-600 hover:text-gray-800 flex items-center text-sm font-medium"
                            >
                                <PencilSquareIcon className="h-4 w-4 mr-1" /> Edit
                            </button>
                        ) : (
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { setIsEditing(false); setFormData({ mobileNumber: employee.mobileNumber, personalEmail: employee.personalEmail, address: employee.address }); }}
                                    className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                                    disabled={saving}
                                >
                                    <XMarkIcon className="h-5 w-5" />
                                </button>
                                <button
                                    onClick={handleSave}
                                    // Changed checkmark button to Grey
                                    className="p-1 text-gray-700 hover:bg-gray-200 rounded"
                                    disabled={saving}
                                >
                                    {saving ? '...' : <CheckIcon className="h-5 w-5" />}
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {/* Company Email (Read Only) */}
                        <div className="col-span-1 sm:col-span-2">
                            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Company Email</label>
                            <div className="flex items-center text-gray-700 bg-gray-50 p-2 rounded border border-gray-200">
                                <EnvelopeIcon className="h-4 w-4 mr-2 text-gray-400" />
                                {employee.companyEmail}
                            </div>
                        </div>

                        {/* Mobile */}
                        <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Mobile Number</label>
                            {isEditing ? (
                                <input
                                    type="text"
                                    value={formData.mobileNumber}
                                    onChange={(e) => setFormData({ ...formData, mobileNumber: e.target.value })}
                                    className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-gray-500 focus:border-gray-500"
                                />
                            ) : (
                                <div className="flex items-center text-gray-800">
                                    <PhoneIcon className="h-4 w-4 mr-2 text-gray-400" />
                                    {employee.mobileNumber || <span className="text-gray-400 italic">Not set</span>}
                                </div>
                            )}
                        </div>

                        {/* Personal Email */}
                        <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Personal Email</label>
                            {isEditing ? (
                                <input
                                    type="email"
                                    value={formData.personalEmail}
                                    onChange={(e) => setFormData({ ...formData, personalEmail: e.target.value })}
                                    className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-gray-500 focus:border-gray-500"
                                />
                            ) : (
                                <div className="flex items-center text-gray-800">
                                    <EnvelopeIcon className="h-4 w-4 mr-2 text-gray-400" />
                                    {employee.personalEmail || <span className="text-gray-400 italic">Not set</span>}
                                </div>
                            )}
                        </div>

                        {/* ID Number (Read Only) */}
                        <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">ID Number</label>
                            <div className="flex items-center text-gray-800">
                                <IdentificationIcon className="h-4 w-4 mr-2 text-gray-400" />
                                {employee.idNumber || <span className="text-gray-400 italic">N/A</span>}
                            </div>
                        </div>

                        {/* Address */}
                        <div className="col-span-1 sm:col-span-2">
                            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Home Address</label>
                            {isEditing ? (
                                <textarea
                                    value={formData.address}
                                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                    rows={2}
                                    className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-gray-500 focus:border-gray-500"
                                />
                            ) : (
                                <div className="flex items-start text-gray-800">
                                    <MapPinIcon className="h-4 w-4 mr-2 text-gray-400 mt-0.5" />
                                    <span className="whitespace-pre-wrap">{employee.address || <span className="text-gray-400 italic">Not set</span>}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Employment History (Read Only) */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <h2 className="text-lg font-bold text-gray-900 flex items-center mb-6">
                        <BriefcaseIcon className="h-6 w-6 text-gray-600 mr-2" />
                        Timeline
                    </h2>

                    {employee.employmentHistory && employee.employmentHistory.length > 0 ? (
                        <div className="relative border-l-2 border-gray-200 ml-3 space-y-8">
                            {[...employee.employmentHistory].reverse().map((period, idx) => (
                                <div key={idx} className="relative pl-6">
                                    {/* Timeline Dot: Dark Grey for Active, Light Grey for Past */}
                                    <div className={`absolute -left-[9px] top-0 h-4 w-4 rounded-full border-2 border-white ${!period.endDate ? 'bg-gray-600' : 'bg-gray-400'}`}></div>
                                    <p className="text-sm font-bold text-gray-800">
                                        {!period.endDate ? 'Current Role' : 'Previous Period'}
                                    </p>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Started: <span className="font-medium text-gray-700">{formatDate(period.startDate)}</span>
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {/* Ended Date Text: Dark Grey for Active, Light Grey for Past */}
                                        Ended: <span className={`font-medium ${!period.endDate ? 'text-gray-800' : 'text-gray-600'}`}>{formatDate(period.endDate)}</span>
                                    </p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-gray-500 italic">No history recorded.</p>
                    )}

                    <div className="mt-8 pt-6 border-t border-gray-100">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-gray-500">Employee Number</span>
                            <span className="font-mono font-bold text-gray-900">{String(employee.employeeNumber).padStart(4, '0')}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm mt-2">
                            <span className="text-gray-500">Tax / NI Number</span>
                            <span className="font-medium text-gray-900">{employee.niNumber || '-'}</span>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default MyProfile;