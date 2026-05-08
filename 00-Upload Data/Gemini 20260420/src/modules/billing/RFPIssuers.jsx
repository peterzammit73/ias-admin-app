// Root: src/modules/billing/RFPIssuers.jsx
// Version: 2.22 - Fix Import (No Ext), Remove Migration Button, Start /01
import React, { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { TrashIcon, PlusIcon, BuildingLibraryIcon, TagIcon, HashtagIcon } from '@heroicons/react/24/outline';

const RFPIssuers = () => {
    const [issuers, setIssuers] = useState([]);
    const [loading, setLoading] = useState(true);

    // Form State
    const [mode, setMode] = useState('new'); // 'new' (completely new entity) or 'sub' (sub-issuer of existing)
    const [parentIssuerName, setParentIssuerName] = useState('');

    const [newIssuer, setNewIssuer] = useState({
        name: '', // Internal ID / Name
        displayName: '', // New field for PDF "From" section
        // sequenceSuffix is calculated automatically
        address: '',
        vatNumber: '',
        bankName: '',
        accountHolder: '',
        iban: '',
        swift: ''
    });
    const [processing, setProcessing] = useState(false);

    useEffect(() => {
        const unsubscribe = onSnapshot(doc(db, 'settings', 'rfp_issuers'), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.issuers && Array.isArray(data.issuers)) {
                    setIssuers(data.issuers);
                } else if (data.names) {
                    // Migration support for old format
                    setIssuers(data.names.map(n => ({ name: n, displayName: n, address: '', vatNumber: '' })));
                }
            } else {
                setIssuers([]);
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // Get unique "Main" issuers (strictly those without a suffix, or those that serve as the 'root' of a group)
    const mainIssuers = useMemo(() => {
        return issuers.filter(i => {
            // A Main Issuer is one that serves as a parent.
            // 1. If it has no suffix, it's a legacy main issuer.
            // 2. If it has suffix /01 (new standard) or /00 (old standard), it's a main issuer.
            // 3. We exclude anything that looks like a sub-issuer > 01 (e.g. /02) to keep the list clean.
            if (!i.sequenceSuffix || i.sequenceSuffix === '') return true;
            if (i.sequenceSuffix === '/01') return true;
            if (i.sequenceSuffix === '/00') return true; // Maintain compatibility
            return false;
        });
    }, [issuers]);

    const handleParentChange = (e) => {
        const parentName = e.target.value;
        setParentIssuerName(parentName);

        if (parentName) {
            const parent = issuers.find(i => i.name === parentName);
            if (parent) {
                setNewIssuer(prev => ({
                    ...prev,
                    name: '', // Will be auto-generated
                    displayName: parent.displayName, // Pre-fill but editable
                    address: parent.address || '',
                    vatNumber: parent.vatNumber || '',
                    bankName: parent.bankName || '',
                    accountHolder: parent.accountHolder || '',
                    iban: parent.iban || '',
                    swift: parent.swift || ''
                }));
            }
        } else {
            // Reset if cleared
            setNewIssuer({ name: '', displayName: '', address: '', vatNumber: '', bankName: '', accountHolder: '', iban: '', swift: '' });
        }
    };

    const handleAdd = async (e) => {
        e.preventDefault();

        // Validation
        if (mode === 'new' && !newIssuer.name) return;
        if (mode === 'sub' && !parentIssuerName) return;

        setProcessing(true);
        try {
            const manageFn = httpsCallable(functions, 'manageRFPIssuer');

            let id, finalName, sequenceSuffix = '';

            if (mode === 'new') {
                // Completely new entity -> Start at /01
                const baseName = newIssuer.name.trim();
                sequenceSuffix = '/01';
                finalName = `${baseName}${sequenceSuffix}`;
                id = finalName.toLowerCase().replace('/', '_');
            } else {
                // Sub-Issuer Logic
                const parent = issuers.find(i => i.name === parentIssuerName);
                if (!parent) throw new Error("Parent issuer not found");

                // Determine base name by stripping existing suffix if present
                // e.g. "PZA/01" -> "PZA", "Sai" -> "Sai"
                let baseName = parent.name;
                if (parent.sequenceSuffix && baseName.endsWith(parent.sequenceSuffix)) {
                    baseName = baseName.substring(0, baseName.length - parent.sequenceSuffix.length);
                }

                // Count existing variations that start with this base name
                const siblings = issuers.filter(i => i.name.startsWith(baseName));

                // Find the next available index by checking existing suffixes
                let maxIndex = 0;
                siblings.forEach(s => {
                    if (s.sequenceSuffix) {
                        const num = parseInt(s.sequenceSuffix.replace('/', ''), 10);
                        if (!isNaN(num) && num > maxIndex) maxIndex = num;
                    }
                });

                const nextIndex = maxIndex + 1;

                // Format suffix as /02, /03, etc. using two digits
                const suffixNumber = String(nextIndex).padStart(2, '0');
                sequenceSuffix = `/${suffixNumber}`;

                // Construct ID: ParentName/02
                finalName = `${baseName}${sequenceSuffix}`;
                id = finalName.toLowerCase().replace('/', '_');
            }

            const issuerToAdd = {
                ...newIssuer,
                id,
                name: finalName, // e.g. PZA/01 or PZA/02
                displayName: newIssuer.displayName || finalName,
                sequenceSuffix,
                address: newIssuer.address,
                vatNumber: newIssuer.vatNumber,
                bankName: newIssuer.bankName,
                accountHolder: newIssuer.accountHolder,
                iban: newIssuer.iban,
                swift: newIssuer.swift
            };

            await manageFn({
                action: 'add',
                issuer: issuerToAdd
            });

            // Reset Form
            setNewIssuer({ name: '', displayName: '', address: '', vatNumber: '', bankName: '', accountHolder: '', iban: '', swift: '' });
            setParentIssuerName('');
            setMode('new');

        } catch (error) {
            console.error(error);
            alert("Failed to add issuer.");
        } finally {
            setProcessing(false);
        }
    };

    const handleRemove = async (issuerId) => {
        if (!window.confirm("Remove this issuer?")) return;
        setProcessing(true);
        try {
            const manageFn = httpsCallable(functions, 'manageRFPIssuer');
            await manageFn({ action: 'remove', issuerId });
        } catch (error) {
            console.error(error);
            alert("Failed to remove issuer.");
        } finally {
            setProcessing(false);
        }
    };

    if (loading) return <div className="p-8 text-gray-500">Loading settings...</div>;

    return (
        <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-6 border-b pb-4">
                <div className="flex items-center gap-2">
                    <BuildingLibraryIcon className="h-6 w-6 text-indigo-600" />
                    <h2 className="text-xl font-bold text-gray-800">RFP Issuers & Bank Details</h2>
                </div>
            </div>

            {/* List */}
            <div className="space-y-4 mb-8">
                {issuers.map((iss) => (
                    <div key={iss.id || iss.name} className="flex justify-between items-start p-4 bg-gray-50 rounded border border-gray-200">
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-bold text-gray-900">{iss.name}</h3>
                                {/* Suffix badge removed as requested */}
                                {iss.displayName && iss.displayName !== iss.name && (
                                    <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full">
                                        Display: {iss.displayName}
                                    </span>
                                )}
                            </div>
                            <div className="text-sm text-gray-600 mt-1 whitespace-pre-line">{iss.address}</div>
                            {iss.vatNumber && <div className="text-xs text-gray-500 mt-1">VAT: {iss.vatNumber}</div>}

                            {(iss.bankName || iss.iban) && (
                                <div className="mt-3 text-xs bg-white p-2 rounded border border-gray-200">
                                    <div className="font-semibold text-indigo-700 mb-1">Bank Details</div>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                        {iss.accountHolder && (
                                            <>
                                                <span className="text-gray-500">Account Holder:</span> <span>{iss.accountHolder}</span>
                                            </>
                                        )}
                                        <span className="text-gray-500">Bank:</span> <span>{iss.bankName}</span>
                                        <span className="text-gray-500">IBAN:</span> <span className="font-mono">{iss.iban}</span>
                                        <span className="text-gray-500">SWIFT:</span> <span className="font-mono">{iss.swift}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                        <button onClick={() => handleRemove(iss.id || iss.name)} className="text-red-500 hover:text-red-700 p-2" disabled={processing}>
                            <TrashIcon className="h-5 w-5" />
                        </button>
                    </div>
                ))}
                {issuers.length === 0 && <p className="text-gray-500 italic text-sm">No issuers configured.</p>}
            </div>

            {/* Add Form */}
            <form onSubmit={handleAdd} className="border-t pt-6">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Add Issuer / Sub-Entity</h3>

                    {/* Mode Toggle */}
                    <div className="flex bg-gray-100 p-1 rounded-lg text-xs font-bold">
                        <button
                            type="button"
                            onClick={() => setMode('new')}
                            className={`px-3 py-1 rounded-md transition-all ${mode === 'new' ? 'bg-white shadow text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            New Entity
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('sub')}
                            className={`px-3 py-1 rounded-md transition-all ${mode === 'sub' ? 'bg-white shadow text-orange-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Sub-Issuer
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

                    {/* MODE SPECIFIC INPUTS */}
                    {mode === 'new' ? (
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Internal Name (ID)</label>
                            <input type="text" className="w-full p-2 border rounded text-sm" placeholder="e.g. Sai" value={newIssuer.name} onChange={e => setNewIssuer({ ...newIssuer, name: e.target.value })} required />
                            <p className="text-[10px] text-gray-400 mt-1">Unique identifier. Will be saved as Name/01.</p>
                        </div>
                    ) : (
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Parent Entity</label>
                            <select
                                className="w-full p-2 border rounded text-sm bg-orange-50 border-orange-200"
                                value={parentIssuerName}
                                onChange={handleParentChange}
                                required
                            >
                                <option value="">-- Select Existing Issuer --</option>
                                {mainIssuers.map(i => (
                                    <option key={i.id || i.name} value={i.name}>{i.name} ({i.displayName})</option>
                                ))}
                            </select>
                            <p className="text-[10px] text-orange-600 mt-1">Details will be copied. Only Display Name changes.</p>
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Displayed Name (On PDF)</label>
                        <input type="text" className="w-full p-2 border rounded text-sm font-bold" placeholder="e.g. Sai Consulting Ltd" value={newIssuer.displayName} onChange={e => setNewIssuer({ ...newIssuer, displayName: e.target.value })} />
                    </div>

                    <div className="md:col-span-2 border-t border-gray-100 pt-4 mt-2">
                        <p className="text-xs font-bold text-gray-400 uppercase mb-3">Financial Details {mode === 'sub' && '(Auto-filled from Parent)'}</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">VAT Number</label>
                                <input type="text" className={`w-full p-2 border rounded text-sm ${mode === 'sub' ? 'bg-gray-50 text-gray-500' : ''}`} placeholder="MT..." value={newIssuer.vatNumber} onChange={e => setNewIssuer({ ...newIssuer, vatNumber: e.target.value })} readOnly={mode === 'sub'} />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
                                <textarea className={`w-full p-2 border rounded text-sm ${mode === 'sub' ? 'bg-gray-50 text-gray-500' : ''}`} rows="2" placeholder="Full address..." value={newIssuer.address} onChange={e => setNewIssuer({ ...newIssuer, address: e.target.value })} readOnly={mode === 'sub'} />
                            </div>

                            {/* Bank Details Section */}
                            <div className="md:col-span-2">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Bank Information</label>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">Account Holder Name</label>
                                        <input type="text" className={`w-full p-2 border rounded text-sm ${mode === 'sub' ? 'bg-gray-50 text-gray-500' : ''}`} placeholder="e.g. iAS Ltd" value={newIssuer.accountHolder} onChange={e => setNewIssuer({ ...newIssuer, accountHolder: e.target.value })} readOnly={mode === 'sub'} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">Bank Name</label>
                                        <input type="text" className={`w-full p-2 border rounded text-sm ${mode === 'sub' ? 'bg-gray-50 text-gray-500' : ''}`} placeholder="e.g. Bank of Valletta" value={newIssuer.bankName} onChange={e => setNewIssuer({ ...newIssuer, bankName: e.target.value })} readOnly={mode === 'sub'} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">IBAN</label>
                                        <input type="text" className={`w-full p-2 border rounded text-sm font-mono ${mode === 'sub' ? 'bg-gray-50 text-gray-500' : ''}`} placeholder="MT..." value={newIssuer.iban} onChange={e => setNewIssuer({ ...newIssuer, iban: e.target.value })} readOnly={mode === 'sub'} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">SWIFT / BIC</label>
                                        <input type="text" className={`w-full p-2 border rounded text-sm font-mono ${mode === 'sub' ? 'bg-gray-50 text-gray-500' : ''}`} placeholder="BOV..." value={newIssuer.swift} onChange={e => setNewIssuer({ ...newIssuer, swift: e.target.value })} readOnly={mode === 'sub'} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <button type="submit" className={`flex items-center justify-center w-full md:w-auto px-4 py-2 text-white text-sm font-medium rounded ${mode === 'new' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-orange-600 hover:bg-orange-700'}`} disabled={processing}>
                    <PlusIcon className="h-4 w-4 mr-2" /> {processing ? 'Saving...' : (mode === 'new' ? 'Add New Entity' : 'Add Sub-Issuer')}
                </button>
            </form>
        </div>
    );
};

export default RFPIssuers;