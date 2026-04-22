// File: src/modules/salaries/CompanyOverheads.jsx - v4.10
import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, deleteDoc, query, orderBy, addDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase.js'; // Verified relative import
import { PlusIcon, TrashIcon, CalendarDaysIcon, ExclamationTriangleIcon, PencilIcon } from '@heroicons/react/24/outline';

const CompanyOverheads = () => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [history, setHistory] = useState([]);
    
    // Form state
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [amount, setAmount] = useState(0);
    const [isEditing, setIsEditing] = useState(null); 
    
    // Logic state
    const [pendingClosureId, setPendingClosureId] = useState(null);

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        setLoading(true);
        setPendingClosureId(null);
        try {
            const q = query(collection(db, 'settings', 'company_settings', 'overhead_periods'), orderBy('startDate', 'desc'));
            const snapshot = await getDocs(q);
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setHistory(data);
            
            if (data.length > 0) {
                const latestRecord = data[0];
                
                if (!latestRecord.endDate) {
                    setPendingClosureId(latestRecord.id);
                    setStartDate(''); 
                } else {
                    const lastEnd = new Date(latestRecord.endDate);
                    const nextStart = new Date(lastEnd);
                    nextStart.setDate(lastEnd.getDate() + 1); 
                    setStartDate(nextStart.toISOString().split('T')[0]);
                }
            } else {
                setStartDate('2004-01-01');
            }
            setEndDate(''); 

        } catch (error) {
            console.error("Error fetching overhead history:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        
        if (amount <= 0) {
            alert("Please enter a valid amount.");
            return;
        }
        
        if (endDate && new Date(startDate) > new Date(endDate)) {
            alert("Start date cannot be after end date.");
            return;
        }

        setSaving(true);
        try {
            const dataPayload = {
                startDate,
                endDate: endDate || null, 
                totalAmount: Number(amount),
                updatedAt: new Date().toISOString()
            };

            if (isEditing) {
                await setDoc(doc(db, 'settings', 'company_settings', 'overhead_periods', isEditing), dataPayload, { merge: true });
                setIsEditing(null);
            } else {
                if (pendingClosureId) {
                    alert("Logic Error: Should not be able to add new record while previous is open.");
                    setSaving(false);
                    return;
                }
                await addDoc(collection(db, 'settings', 'company_settings', 'overhead_periods'), dataPayload);
            }

            await fetchHistory();
            setAmount(0);
            alert("Overhead period saved.");
        } catch (error) {
            console.error("Error saving:", error);
            alert("Failed to save overhead record.");
        } finally {
            setSaving(false);
        }
    };

    const handleClosePeriod = async () => {
        if (!endDate) {
            alert("Please enter an End Date to close the current period.");
            return;
        }
        const pendingRecord = history.find(h => h.id === pendingClosureId);
        if (new Date(endDate) < new Date(pendingRecord.startDate)) {
             alert("End date cannot be before the start date of the period.");
             return;
        }

        setSaving(true);
        try {
            const docRef = doc(db, 'settings', 'company_settings', 'overhead_periods', pendingClosureId);
            await updateDoc(docRef, { endDate: endDate });
            await fetchHistory();
            setEndDate(''); 
            alert("Previous period closed. You can now add a new record.");
        } catch (err) {
            console.error(err);
            alert("Failed to close period.");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Delete this overhead period?")) return;
        try {
            await deleteDoc(doc(db, 'settings', 'company_settings', 'overhead_periods', id));
            fetchHistory();
        } catch (error) {
            console.error("Error deleting:", error);
        }
    };

    const loadForEdit = (record) => {
        setIsEditing(record.id);
        setStartDate(record.startDate);
        setEndDate(record.endDate || '');
        setAmount(record.totalAmount);
        setPendingClosureId(null); 
    };

    const handleCancelEdit = () => {
        setIsEditing(null);
        setAmount(0);
        fetchHistory(); 
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'Current';
        const [y, m, d] = dateStr.split('-');
        return `${d}/${m}/${y}`;
    };

    if (loading) return <div className="p-8 text-center text-gray-500">Loading history...</div>;

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm h-full flex flex-col md:flex-row gap-6">
            
            <div className="w-full md:w-1/3 bg-gray-50 p-6 rounded-xl border border-gray-200 h-fit">
                
                {!isEditing && pendingClosureId ? (
                     <div className="space-y-4">
                        <div className="flex items-center text-amber-700 bg-amber-50 p-3 rounded-md border border-amber-200 mb-4">
                            <ExclamationTriangleIcon className="h-6 w-6 mr-2 flex-shrink-0"/>
                            <p className="text-sm">
                                The current period (started <strong>{formatDate(history[0].startDate)}</strong>) is open. 
                                <br/><br/>Please enter an <strong>End Date</strong> for it before adding a new period.
                            </p>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase">End Date for Current Period</label>
                            <input 
                                type="date" 
                                value={endDate} 
                                min={history[0].startDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="mt-1 block w-full rounded-md border-amber-300 shadow-sm focus:ring-amber-500 focus:border-amber-500 sm:text-sm"
                            />
                        </div>
                        <button 
                            onClick={handleClosePeriod}
                            disabled={saving}
                            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 focus:outline-none disabled:opacity-50"
                        >
                            {saving ? 'Saving...' : 'Close Period & Continue'}
                        </button>
                     </div>
                ) : (
                    <form onSubmit={handleSave} className="space-y-4">
                        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                            <PlusIcon className="h-5 w-5 mr-2 text-green-600"/>
                            {isEditing ? 'Edit Period' : 'Add New Period'}
                        </h3>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 uppercase">Start Date</label>
                                <input 
                                    type="date" 
                                    value={startDate} 
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:ring-green-500 focus:border-green-500 sm:text-sm"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 uppercase">End Date <span className="text-gray-400 normal-case">(Optional)</span></label>
                                <input 
                                    type="date" 
                                    value={endDate} 
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:ring-green-500 focus:border-green-500 sm:text-sm"
                                    placeholder="Open-ended"
                                />
                                <p className="text-[10px] text-gray-400 mt-1">Leave empty if this is the current active period.</p>
                            </div>
                        </div>
                        
                        <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase">Total Annual Overheads (€)</label>
                            <input 
                                type="number" 
                                min="0" 
                                step="0.01"
                                value={amount} 
                                onChange={(e) => setAmount(e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:ring-green-500 focus:border-green-500 sm:text-sm font-bold text-gray-900"
                                required
                            />
                        </div>

                        <div className="pt-4 border-t border-gray-200 flex gap-2">
                            <button 
                                type="submit" 
                                disabled={saving}
                                className="flex-1 flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
                            >
                                {saving ? 'Saving...' : (isEditing ? 'Update' : 'Add Record')}
                            </button>
                            {isEditing && (
                                <button 
                                    type="button"
                                    onClick={handleCancelEdit}
                                    className="px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-100"
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    </form>
                )}
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center">
                        <CalendarDaysIcon className="h-5 w-5 mr-2 text-gray-500"/>
                        Historical Data
                    </h3>
                </div>
                
                <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium text-gray-500">Period Start</th>
                                <th className="px-4 py-3 text-left font-medium text-gray-500">Period End</th>
                                <th className="px-4 py-3 text-right font-medium text-gray-500">Total Amount</th>
                                <th className="px-4 py-3 text-center font-medium text-gray-500">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                            {history.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="px-4 py-8 text-center text-gray-500">
                                        No overhead records found.<br/>
                                        First entry defaults to <strong>01/01/2004</strong> start.
                                    </td>
                                </tr>
                            ) : (
                                history.map((record) => (
                                    <tr key={record.id} className="hover:bg-gray-50 group">
                                        <td className="px-4 py-3 font-medium text-gray-900">{formatDate(record.startDate)}</td>
                                        <td className={`px-4 py-3 ${!record.endDate ? 'text-green-600 font-bold' : 'text-gray-600'}`}>
                                            {formatDate(record.endDate)}
                                        </td>
                                        <td className="px-4 py-3 text-right font-bold text-gray-800">€{Number(record.totalAmount).toLocaleString()}</td>
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex justify-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button 
                                                    onClick={() => loadForEdit(record)}
                                                    className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                                >
                                                    <PencilIcon className="h-4 w-4" />
                                                </button>
                                                <span className="text-gray-300">|</span>
                                                <button 
                                                    onClick={() => handleDelete(record.id)}
                                                    className="text-red-500 hover:text-red-700"
                                                >
                                                    <TrashIcon className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default CompanyOverheads;