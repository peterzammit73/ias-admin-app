// Root: src/modules/billing/UpdateRFPModal.jsx
// Version: 6.3 - Fixed Imports & Enhanced Legacy RFP Client Data Fallback
import React, { useState, useEffect, useMemo } from 'react';
import { getApp } from 'firebase/app';
import { getFirestore, doc, updateDoc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ExclamationTriangleIcon, BuildingOfficeIcon, UserIcon, UserCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';

// Safely initialize Firebase instances (Bypasses local import resolution issues in preview)
let db, functionsInstance;
try {
    const app = getApp();
    db = getFirestore(app);
    functionsInstance = getFunctions(app, 'us-central1');
} catch (e) {
    console.warn("Firebase app not initialized in this environment.");
}

// Inline Modal component to prevent resolution errors in isolated preview
const Modal = ({ show, onClose, title, children, maxWidth = 'sm:max-w-lg' }) => {
    if (!show) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <div className={`relative bg-white rounded-lg shadow-xl w-full ${maxWidth} max-h-[90vh] flex flex-col`}>
                <div className="flex justify-between items-center p-4 border-b">
                    <h3 className="text-lg font-bold text-gray-900">{title}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                        <XCircleIcon className="h-6 w-6" />
                    </button>
                </div>
                <div className="p-4 overflow-y-auto">{children}</div>
            </div>
        </div>
    );
};

const UpdateRFPModal = ({ isOpen, onClose, rfp, mode = 'edit' }) => {
    // Helper: Round UP to 2 decimal places (Ceiling)
    const roundUp = (num) => Math.ceil(num * 100) / 100;

    const [formData, setFormData] = useState({
        description: '',
        recipient: '',
        recipientAddress: '',
        recipientVat: ''
    });

    // Recipient Type State
    const [recipientType, setRecipientType] = useState('company'); // 'company' or 'individual'

    // Selected Contact Person Display
    const [contactPerson, setContactPerson] = useState('');

    // Financial State
    const [rfpFee, setRfpFee] = useState(0); // The "Fee" portion only
    const [rfpFeeVat, setRfpFeeVat] = useState(true);

    // Itemized Data
    const [costItems, setCostItems] = useState([]);
    const [itemsLoading, setItemsLoading] = useState(false);

    // UI State
    const [loading, setLoading] = useState(false);
    const [projectTitle, setProjectTitle] = useState('');
    const [clients, setClients] = useState([]);

    const [includeSupersedeText, setIncludeSupersedeText] = useState(true);

    // Validation State
    const [missingDataWarning, setMissingDataWarning] = useState('');

    const isRevision = mode === 'revise';

    const getClientName = (c) => c.companyName || `${c.name} ${c.surname}`;

    useEffect(() => {
        if (rfp && isOpen) {
            let initialDescription = rfp.description || '';

            if (isRevision) {
                initialDescription = initialDescription.replace(/\n\nThis RFP supersedes RFP number .*?(?=\n|$)/g, '');
                initialDescription = initialDescription.replace(/^This RFP supersedes RFP number .*?(?=\n|$)/g, '');
                setIncludeSupersedeText(true);
            }

            // 1. Initial attempt to load from RFP object directly
            const initialRecipient = rfp.recipient || '';
            const initialAddress = rfp.recipientAddress || '';
            const initialVat = rfp.recipientVat || '';

            setFormData({
                description: initialDescription.trim(),
                recipient: initialRecipient,
                recipientAddress: initialAddress,
                recipientVat: initialVat
            });

            setContactPerson(rfp.contactPerson || '');
            setRfpFeeVat(rfp.feeVatApplicable !== undefined ? rfp.feeVatApplicable : (rfp.vatApplicable !== false));
            setProjectTitle('');
            setMissingDataWarning('');

            const fetchDetails = async () => {
                try {
                    // 1. Project Details (Strict Fetch)
                    let pTitle = '';
                    const variations = [
                        String(rfp.projectNumber),
                        parseInt(rfp.projectNumber),
                        String(rfp.projectNumber).padStart(4, '0'),
                        String(rfp.projectNumber).replace(/^0+/, '')
                    ].filter(v => v !== undefined && v !== "");

                    const uniqueVariations = [...new Set(variations)];

                    const q = query(collection(db, 'projects'), where('projectNumber', 'in', uniqueVariations));
                    const snap = await getDocs(q);

                    let linkedClientNumber = null;

                    if (!snap.empty) {
                        const pData = snap.docs[0].data();
                        pTitle = pData.projectDescription || '';
                        setProjectTitle(pTitle);
                        linkedClientNumber = pData.clientNumber; // Needed for fallback
                    }

                    // 2. Clients
                    const clientSnap = await getDocs(query(collection(db, 'clients')));
                    const clientList = clientSnap.docs.map(d => d.data());
                    setClients(clientList);

                    // 3. ROBUST FALLBACK LOGIC
                    let finalRecipient = initialRecipient;
                    let finalAddress = initialAddress;
                    let finalVat = initialVat;
                    let finalContact = rfp.contactPerson || '';
                    let rType = 'company';

                    let matchedClient = null;

                    // A. Try to match by the recipient string on the RFP
                    if (finalRecipient) {
                        matchedClient = clientList.find(c => getClientName(c).toLowerCase() === finalRecipient.toLowerCase().trim());
                    }

                    // B. If no match by name, try to match by Project's Client Number (Legacy Support)
                    if (!matchedClient && linkedClientNumber) {
                        matchedClient = clientList.find(c => String(c.clientNumber) === String(linkedClientNumber));
                    }

                    if (matchedClient) {
                        rType = matchedClient.type || (matchedClient.companyName ? 'company' : 'individual');

                        // Auto-fill missing pieces from matched client
                        if (!finalRecipient) finalRecipient = getClientName(matchedClient);

                        if (!finalAddress) {
                            finalAddress = [matchedClient.address, matchedClient.locality, matchedClient.postCode, matchedClient.country].filter(Boolean).join(',\n');
                        }

                        if (!finalVat) {
                            finalVat = matchedClient.vatNumber || '';
                        }

                        if (rType === 'company' && !finalContact && matchedClient.name && matchedClient.surname) {
                            finalContact = `${matchedClient.name} ${matchedClient.surname}`;
                        }
                    }

                    // Update State with Fallbacks
                    setRecipientType(rType);
                    setContactPerson(finalContact);

                    setFormData(prev => ({
                        ...prev,
                        recipient: finalRecipient,
                        recipientAddress: finalAddress,
                        recipientVat: finalVat
                    }));

                    // C. FINAL VALIDATION CHECK
                    // If we STILL don't have an address or recipient after all fallbacks, warn the user
                    if (!finalRecipient || !finalAddress) {
                        setMissingDataWarning("WARNING: Recipient Name and/or Address are missing. This was likely a legacy RFP. Please select the client manually from the dropdown or fill in the details below before saving.");
                    }

                    // 4. Fetch Linked Costs
                    setItemsLoading(true);
                    const cItems = [];

                    if (rfp.linkedCostIds && rfp.linkedCostIds.length > 0) {
                        const cQ = query(collection(db, 'project_costs'), where('rfpId', '==', rfp.id));
                        const cSnap = await getDocs(cQ);
                        cSnap.forEach(d => {
                            const data = d.data();
                            cItems.push({
                                id: d.id,
                                ...data,
                                applyVat: data.vatApplicable !== undefined ? data.vatApplicable : (rfp.vatApplicable !== false)
                            });
                        });
                    }
                    setCostItems(cItems);

                    // 5. Calculate Initial Fee Portion
                    const totalCosts = cItems.reduce((sum, c) => sum + parseFloat(c.amount || 0), 0);
                    const feeAmount = Math.max(0, (parseFloat(rfp.amount) || 0) - totalCosts);
                    setRfpFee(feeAmount);

                } catch (e) {
                    console.error("Error fetching details:", e);
                } finally {
                    setItemsLoading(false);
                }
            };
            fetchDetails();
        }
    }, [rfp, isOpen, isRevision]);

    // Live Financial Calculations (Rounded Up)
    const financials = useMemo(() => {
        const fees = parseFloat(rfpFee) || 0;
        const feesVat = rfpFeeVat ? roundUp(fees * 0.18) : 0;

        let costsNet = 0;
        let costsVat = 0;

        costItems.forEach(c => {
            const amt = parseFloat(c.amount) || 0;
            costsNet += amt;
            if (c.applyVat) {
                costsVat += roundUp(amt * 0.18);
            }
        });

        const totalNet = roundUp(fees + costsNet);
        const totalVat = roundUp(feesVat + costsVat);
        const totalGross = roundUp(totalNet + totalVat);

        return { totalNet, totalVat, totalGross };
    }, [rfpFee, rfpFeeVat, costItems]);

    // Filter Clients based on selected Type
    const filteredClients = useMemo(() => {
        if (!clients) return [];
        return clients.filter(c => {
            const cType = c.type || (c.companyName ? 'company' : 'individual');
            return cType === recipientType;
        }).sort((a, b) => getClientName(a).localeCompare(getClientName(b)));
    }, [clients, recipientType]);

    const handleClientChange = (e) => {
        const selectedName = e.target.value;
        const client = clients.find(c => getClientName(c) === selectedName);
        if (client) {
            const addr = [client.address, client.locality, client.postCode, client.country].filter(Boolean).join(',\n');
            setFormData(prev => ({ ...prev, recipient: selectedName, recipientAddress: addr, recipientVat: client.vatNumber || '' }));

            // Set Contact Person if Company
            if (recipientType === 'company' && client.name && client.surname) {
                setContactPerson(`${client.name} ${client.surname}`);
            } else {
                setContactPerson('');
            }

            // Clear warning if they selected a valid client
            if (addr) setMissingDataWarning('');

        } else {
            setFormData(prev => ({ ...prev, recipient: selectedName }));
            setContactPerson('');
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));

        // Clear warning if they start typing in the address manually
        if (name === 'recipientAddress' && value.trim()) {
            setMissingDataWarning('');
        }
    };

    const toggleItemVat = (id) => {
        setCostItems(prev => prev.map(item => item.id === id ? { ...item, applyVat: !item.applyVat } : item));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.recipient) return alert("Recipient is required.");
        if (!formData.recipientAddress) return alert("Address is required.");
        if (!formData.description) return alert("Description is required.");

        setLoading(true);
        try {
            // 1. Update individual Cost Items with their new VAT applicability
            if (costItems.length > 0) {
                const batch = writeBatch(db);
                costItems.forEach(item => {
                    const ref = doc(db, 'project_costs', item.id);
                    batch.update(ref, { vatApplicable: item.applyVat });
                });
                await batch.commit();
            }

            let finalDescription = formData.description;
            if (isRevision && includeSupersedeText) {
                finalDescription += `\n\nThis RFP supersedes RFP number ${rfp.rfpNumber}.`;
            }

            // 2. Update RFP Document
            const payload = {
                rfpId: rfp.id,
                amount: financials.totalNet,
                vatAmount: financials.totalVat,
                description: finalDescription,
                projectName: finalDescription, // Explicitly override the old text with the new description
                recipient: formData.recipient,
                recipientAddress: formData.recipientAddress,
                recipientVat: formData.recipientVat,
                vatApplicable: true, // Always true to force backend to use our explicit vatAmount
                feeVatApplicable: rfpFeeVat, // Store the Fee component's VAT status
                contactPerson: contactPerson // Save contact person to RFP
            };

            if (isRevision) {
                const reviseFn = httpsCallable(functionsInstance, 'reviseRFP');
                await reviseFn(payload);
                alert("Revision created.");
            } else {
                const rfpRef = doc(db, 'rfps', rfp.id);
                await updateDoc(rfpRef, { ...payload, totalAmount: financials.totalGross });
            }
            onClose();
        } catch (error) {
            console.error(error);
            alert(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <Modal show={isOpen} onClose={onClose} title={isRevision ? `Revise RFP: ${rfp?.rfpNumber}` : `Edit RFP: ${rfp?.projectNumber}`} maxWidth="sm:max-w-5xl">
            <form onSubmit={handleSubmit} className="space-y-5">
                {isRevision && !missingDataWarning && (
                    <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 rounded-md text-sm flex items-start">
                        <ExclamationTriangleIcon className="h-5 w-5 mr-2 flex-shrink-0" />
                        <div><strong>Revision Mode:</strong> Original will be superseded.</div>
                    </div>
                )}

                {missingDataWarning && (
                    <div className="bg-red-50 border-l-4 border-red-500 text-red-800 p-4 rounded-md shadow-sm flex items-start animate-fade-in">
                        <XCircleIcon className="h-6 w-6 mr-3 flex-shrink-0 text-red-600" />
                        <div className="font-medium text-sm leading-snug">{missingDataWarning}</div>
                    </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-xs font-bold text-gray-500 uppercase">Project Ref</label><input className="w-full p-2 border rounded bg-gray-100 text-sm text-gray-700" value={rfp?.projectNumber} disabled /></div>
                    <div><label className="block text-xs font-bold text-gray-500 uppercase">Project Name</label><input className="w-full p-2 border rounded bg-gray-100 text-sm text-gray-700 font-bold" value={projectTitle || 'Loading...'} disabled /></div>
                </div>

                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <label className="block text-sm font-medium text-gray-700">Recipient</label>
                        {/* Type Toggle */}
                        <div className="flex bg-gray-100 p-0.5 rounded text-[10px]">
                            <button
                                type="button"
                                onClick={() => { setRecipientType('company'); setFormData(prev => ({ ...prev, recipient: '' })); setContactPerson(''); }}
                                className={`px-2 py-1 rounded flex items-center gap-1 transition-all ${recipientType === 'company' ? 'bg-white shadow text-indigo-600 font-bold' : 'text-gray-500'}`}
                            >
                                <BuildingOfficeIcon className="h-3 w-3" /> Company
                            </button>
                            <button
                                type="button"
                                onClick={() => { setRecipientType('individual'); setFormData(prev => ({ ...prev, recipient: '' })); setContactPerson(''); }}
                                className={`px-2 py-1 rounded flex items-center gap-1 transition-all ${recipientType === 'individual' ? 'bg-white shadow text-indigo-600 font-bold' : 'text-gray-500'}`}
                            >
                                <UserIcon className="h-3 w-3" /> Individual
                            </button>
                        </div>
                    </div>

                    <select name="recipient" className={`mt-1 block w-full border-gray-300 rounded-md p-2 bg-white ${missingDataWarning ? 'ring-2 ring-red-500' : ''}`} value={formData.recipient} onChange={handleClientChange} required>
                        <option value="">-- Select {recipientType === 'company' ? 'Company' : 'Individual'} --</option>
                        {/* Always include the current recipient as an option even if not in the DB currently */}
                        {formData.recipient && !filteredClients.find(c => getClientName(c) === formData.recipient) && (
                            <option value={formData.recipient}>{formData.recipient} (Legacy)</option>
                        )}
                        {filteredClients.map(c => {
                            const mainLabel = getClientName(c);
                            return <option key={c.id} value={mainLabel}>{mainLabel}</option>
                        })}
                    </select>

                    {/* Show Contact Person if Company Selected */}
                    {recipientType === 'company' && contactPerson && (
                        <div className="flex items-center text-xs text-gray-500 bg-gray-50 p-2 rounded border border-gray-200 mt-1">
                            <UserCircleIcon className="h-4 w-4 mr-2 text-indigo-500" />
                            <span><strong>Contact Person:</strong> {contactPerson}</span>
                        </div>
                    )}
                </div>

                {/* EDITABLE ADDRESS AND VAT FIELDS */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700">Address</label>
                        <textarea
                            name="recipientAddress"
                            className={`w-full p-2 border border-gray-300 rounded-md bg-white text-gray-700 focus:ring-orange-500 focus:border-orange-500 outline-none text-sm shadow-sm ${missingDataWarning ? 'ring-2 ring-red-500' : ''}`}
                            rows="2"
                            value={formData.recipientAddress}
                            onChange={handleChange}
                            required
                        />
                    </div>
                    <div className="col-span-1">
                        <label className="block text-sm font-medium text-gray-700">VAT No.</label>
                        <input
                            name="recipientVat"
                            className="w-full p-2 border border-gray-300 rounded-md bg-white text-gray-700 focus:ring-orange-500 focus:border-orange-500 outline-none text-sm shadow-sm"
                            value={formData.recipientVat}
                            onChange={handleChange}
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Description</label>
                    <textarea
                        name="description"
                        className="w-full p-2 border rounded text-gray-700 bg-white"
                        rows="4"
                        value={formData.description}
                        onChange={handleChange}
                        required
                    />
                    {isRevision && (
                        <div className="mt-2 flex items-start">
                            <div className="flex items-center h-5">
                                <input
                                    id="supersedeToggle"
                                    type="checkbox"
                                    checked={includeSupersedeText}
                                    onChange={(e) => setIncludeSupersedeText(e.target.checked)}
                                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded cursor-pointer"
                                />
                            </div>
                            <div className="ml-2 text-sm">
                                <label htmlFor="supersedeToggle" className="font-medium text-gray-700 cursor-pointer">
                                    Include superseding note
                                </label>
                                <p className="text-gray-500 text-xs">Appends <span className="italic">"This RFP supersedes RFP number {rfp?.rfpNumber}."</span> to the document.</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* --- ITEMIZED BREAKDOWN --- */}
                <div className="border rounded-lg overflow-hidden border-gray-300">
                    <div className="p-3 bg-gray-50 border-b flex justify-between items-center">
                        <span className="font-bold text-sm text-gray-800">RFP Composition</span>
                        <span className="text-xs text-gray-500">All figures excluding VAT</span>
                    </div>

                    <div className="p-0 bg-white max-h-80 overflow-y-auto">
                        <table className="w-full text-xs text-left">
                            <thead className="bg-gray-100 text-gray-600 font-bold sticky top-0">
                                <tr>
                                    <th className="p-2 w-20">Type</th>
                                    <th className="p-2">Description</th>
                                    <th className="p-2 text-right w-32">Net Value (€)</th>
                                    <th className="p-2 text-center w-16" title="Add 18% VAT?">VAT</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {/* 1. RFP Amount (Fees) */}
                                <tr className="bg-blue-50/20">
                                    <td className="p-2 font-bold text-blue-600">RFP Amount</td>
                                    <td className="p-2">Professional Fees (Time/Labour)</td>
                                    <td className="p-2 text-right">
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={rfpFee}
                                            onChange={(e) => setRfpFee(e.target.value)}
                                            className="w-full border rounded p-1 text-right font-mono"
                                        />
                                    </td>
                                    <td className="p-2 text-center">
                                        <input
                                            type="checkbox"
                                            checked={rfpFeeVat}
                                            onChange={(e) => setRfpFeeVat(e.target.checked)}
                                            className="rounded text-indigo-600 cursor-pointer"
                                        />
                                    </td>
                                </tr>

                                {/* 2. Costs */}
                                {itemsLoading ? <tr><td colSpan="4" className="p-2 text-center text-gray-400">Loading costs...</td></tr> : (
                                    costItems.map(item => (
                                        <tr key={item.id} className="hover:bg-gray-50">
                                            <td className="p-2 font-bold text-orange-600">Cost</td>
                                            <td className="p-2 truncate max-w-[250px]" title={item.description}>{item.type}: {item.description}</td>
                                            <td className="p-2 text-right font-mono">€{parseFloat(item.amount).toFixed(2)}</td>
                                            <td className="p-2 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={item.applyVat}
                                                    onChange={() => toggleItemVat(item.id)}
                                                    className="rounded text-indigo-600 cursor-pointer"
                                                />
                                            </td>
                                        </tr>
                                    ))
                                )}

                                {costItems.length === 0 && !itemsLoading && (
                                    <tr><td colSpan="4" className="p-2 text-center text-gray-400 italic text-[10px]">No linked project costs.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Financial Summary */}
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-2">
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Total Net Amount:</span>
                        <span className="font-mono font-bold">€{financials.totalNet.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Total VAT (Calculated):</span>
                        <span className="font-mono font-medium text-indigo-600">€{financials.totalVat.toFixed(2)}</span>
                    </div>
                    <div className="border-t border-gray-300 pt-2 flex justify-between text-base font-bold">
                        <span className="uppercase text-gray-900">Total Gross</span>
                        <div className="text-xl text-orange-600 font-mono">€{financials.totalGross.toFixed(2)}</div>
                    </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                    <button type="button" onClick={onClose} className="px-4 py-2 border rounded bg-white hover:bg-gray-50" disabled={loading}>Cancel</button>
                    <button type="submit" className={`px-4 py-2 border border-transparent rounded text-white ${isRevision ? 'bg-purple-600 hover:bg-purple-700' : 'bg-orange-600 hover:bg-orange-700'}`} disabled={loading || !formData.recipientAddress}>
                        {loading ? 'Processing...' : (isRevision ? 'Create Revision' : 'Save Changes')}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default UpdateRFPModal;