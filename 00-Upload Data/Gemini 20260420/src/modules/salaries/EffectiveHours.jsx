// File: src/modules/salaries/EffectiveHours.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, doc, setDoc, deleteDoc, query, orderBy, addDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { PlusIcon, TrashIcon, CalendarDaysIcon, ExclamationTriangleIcon, PencilIcon } from '@heroicons/react/24/outline';

const EffectiveHours = () => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [history, setHistory] = useState([]);
    
    // Form state
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [isEditing, setIsEditing] = useState(null); 
    
    // Hours Data
    const [totalWorkingHours, setTotalWorkingHours] = useState(2080); 
    const [vacationLeave, setVacationLeave] = useState(192); 
    const [publicHolidays, setPublicHolidays] = useState(112); 
    const [sickLeave, setSickLeave] = useState(0); 

    // Logic state
    const [pendingClosureId, setPendingClosureId] = useState(null);

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        setLoading(true);
        setPendingClosureId(null);
        try {
            const q = query(collection(db, 'settings', 'company_settings', 'effective_hours_periods'), orderBy('startDate', 'desc'));
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
                setStartDate('2024-01-01');
            }
            setEndDate(''); 

        } catch (error) {
            console.error("Error fetching effective hours history:", error);
        } finally {
            setLoading(false);
        }
    };

    const calculatedEffectiveHours = useMemo(() => {
        const total = Number(totalWorkingHours) || 0;
        const deductions = (Number(vacationLeave) || 0) + (Number(publicHolidays) || 0) + (Number(sickLeave) || 0);
        return total - deductions;
    }, [totalWorkingHours, vacationLeave, publicHolidays, sickLeave]);

    const handleSave = async (e) => {
        e.preventDefault();
        
        if (calculatedEffectiveHours <= 0) {
            alert("Effective hours must be greater than 0.");
            return;
        }
        
        if (endDate && new Date(startDate) > new Date(endDate)) {
            alert("Start date cannot be after end date.");
            return;
        }

        // --- VALIDATION: Chronological Order & Single Record Per Day ---
        if (history.length > 0 && !isEditing) {
            const latestRecord = history[0]; 

            // 1. Check if previous record is closed
            if (!latestRecord.endDate) {
                 alert("The current active period is still open. Please close the previous period by setting an End Date before adding a new one.");
                 return;
            }

            // 2. Check for chronological order (New Start > Old End)
            const newStart = new Date(startDate);
            const latestEnd = new Date(latestRecord.endDate);
            
            // Set times to midnight to avoid timezone edge cases
            newStart.setHours(0,0,0,0);
            latestEnd.setHours(0,0,0,0);

            if (newStart <= latestEnd) {
                 alert(`Invalid Start Date. The new period cannot overlap with or be before the previous period (ends ${latestRecord.endDate}). Please choose a date after ${latestRecord.endDate}.`);
                 return;
            }
        }

        setSaving(true);
        try {
            const dataPayload = {
                startDate,
                endDate: endDate || null, 
                totalWorkingHours: Number(totalWorkingHours),
                vacationLeave: Number(vacationLeave),
                publicHolidays: Number(publicHolidays),
                sickLeave: Number(sickLeave),
                effectiveHours: calculatedEffectiveHours, 
                updatedAt: new Date().toISOString()
            };

            if (isEditing) {
                await setDoc(doc(db, 'settings', 'company_settings', 'effective_hours_periods', isEditing), dataPayload, { merge: true });
                setIsEditing(null);
            } else {
                if (pendingClosureId) {
                    alert("Cannot add new record while the current period is open. Please close it first.");
                    setSaving(false);
                    return;
                }
                await addDoc(collection(db, 'settings', 'company_settings', 'effective_hours_periods'), dataPayload);
            }

            await fetchHistory();
            setTotalWorkingHours(2080);
            setVacationLeave(192);
            setPublicHolidays(112);
            setSickLeave(0);
            alert("Effective hours period saved.");
        } catch (error) {
            console.error("Error saving:", error);
            alert("Failed to save record.");
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
            const docRef = doc(db, 'settings', 'company_settings', 'effective_hours_periods', pendingClosureId);
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
        if (!window.confirm("Delete this period?")) return;
        try {
            await deleteDoc(doc(db, 'settings', 'company_settings', 'effective_hours_periods', id));
            fetchHistory();
        } catch (error) {
            console.error("Error deleting:", error);
        }
    };

    const loadForEdit = (record) => {
        setIsEditing(record.id);
        setStartDate(record.startDate);
        setEndDate(record.endDate || '');
        setTotalWorkingHours(record.totalWorkingHours);
        setVacationLeave(record.vacationLeave);
        setPublicHolidays(record.publicHolidays);
        setSickLeave(record.sickLeave);
        setPendingClosureId(null); 
    };

    const handleCancelEdit = () => {
        setIsEditing(null);
        setTotalWorkingHours(2080);
        setVacationLeave(192);
        setPublicHolidays(112);
        setSickLeave(0);
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
                            {isEditing ? 'Edit Effective Hours' : 'Add New Period'}
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
                                    disabled={!isEditing && pendingClosureId}
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
                                <p className="text-[10px] text-gray-400 mt-1">Leave empty if current.</p>
                            </div>
                        </div>
                        
                        <div className="bg-white p-3 rounded border border-gray-200 space-y-3">
                            <div>
                                <label className="block text-xs font-medium text-gray-500">Total Working Hours (Annual)</label>
                                <input type="number" min="0" value={totalWorkingHours} onChange={(e) => setTotalWorkingHours(e.target.value)} className="w-full p-1 border rounded text-sm"/>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-1 border rounded text-sm bg-gray-100 flex flex-col justify-center items-center">
                                    <label className="block text-[10px] font-medium text-gray-500 uppercase">Vacation</label>
                                    <input type="number" min="0" value={vacationLeave} onChange={(e) => setVacationLeave(e.target.value)} className="w-full bg-transparent text-center font-semibold focus:outline-none"/>
                                </div>
                                <div className="p-1 border rounded text-sm bg-gray-100 flex flex-col justify-center items-center">
                                    <label className="block text-[10px] font-medium text-gray-500 uppercase">Public Holidays</label>
                                    <input type="number" min="0" value={publicHolidays} onChange={(e) => setPublicHolidays(e.target.value)} className="w-full bg-transparent text-center font-semibold focus:outline-none"/>
                                </div>
                                <div className="p-1 border rounded text-sm bg-gray-100 flex flex-col justify-center items-center col-span-2">
                                    <label className="block text-[10px] font-medium text-gray-500 uppercase">Sick Leave</label>
                                    <input type="number" min="0" value={sickLeave} onChange={(e) => setSickLeave(e.target.value)} className="w-full bg-transparent text-center font-semibold focus:outline-none"/>
                                </div>
                            </div>
                        </div>

                        <div className="bg-green-50 p-3 rounded border border-green-200 text-center">
                            <span className="block text-xs font-medium text-green-700 uppercase">Net Effective Hours (Read Only)</span>
                            <span className="text-2xl font-bold text-green-900">{calculatedEffectiveHours}</span>
                            <input type="hidden" value={calculatedEffectiveHours} name="effectiveHours" readOnly />
                        </div>

                        <div className="pt-4 border-t border-gray-200 flex gap-2">
                            <button 
                                type="submit" 
                                disabled={saving || (!isEditing && pendingClosureId)}
                                className="flex-1 flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:bg-gray-400"
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
                        Effective Hours History
                    </h3>
                </div>
                
                <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium text-gray-500">Period</th>
                                <th className="px-2 py-3 text-right font-medium text-gray-500">Total</th>
                                <th className="px-2 py-3 text-right font-medium text-gray-500">Vac</th>
                                <th className="px-2 py-3 text-right font-medium text-gray-500">PH</th>
                                <th className="px-2 py-3 text-right font-medium text-gray-500">Sick</th>
                                <th className="px-4 py-3 text-right font-medium text-gray-900">Effective</th>
                                <th className="px-4 py-3 text-center font-medium text-gray-500">Act</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                            {history.length === 0 ? (
                                <tr>
                                    <td colSpan="7" className="px-4 py-8 text-center text-gray-500">
                                        No records found.
                                    </td>
                                </tr>
                            ) : (
                                history.map((record) => (
                                    <tr key={record.id} className="hover:bg-gray-50 group">
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <div className="font-medium text-gray-900">{formatDate(record.startDate)}</div>
                                            <div className={`text-xs ${!record.endDate ? 'text-green-600 font-bold' : 'text-gray-500'}`}>
                                                {record.endDate ? `to ${formatDate(record.endDate)}` : 'Active'}
                                            </div>
                                        </td>
                                        <td className="px-2 py-3 text-right text-gray-500">{record.totalWorkingHours}</td>
                                        <td className="px-2 py-3 text-right text-gray-500">{record.vacationLeave}</td>
                                        <td className="px-2 py-3 text-right text-gray-500">{record.publicHolidays}</td>
                                        <td className="px-2 py-3 text-right text-gray-500">{record.sickLeave}</td>
                                        <td className="px-4 py-3 text-right font-bold text-gray-800">{record.effectiveHours}</td>
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex justify-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button 
                                                    onClick={() => loadForEdit(record)}
                                                    className="text-blue-600 hover:text-blue-800"
                                                >
                                                    <PencilIcon className="h-4 w-4" />
                                                </button>
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

export default EffectiveHours;