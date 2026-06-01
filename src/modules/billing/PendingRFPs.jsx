// Root: src/modules/billing/PendingRFPs.jsx
// Version: 4.18 - Fixed mapping logic and undefined variables
import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, doc, deleteDoc, getDocs, updateDoc, getDoc, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '/src/firebase.js'; 
import {
    PrinterIcon,
    PencilSquareIcon,
    PaperAirplaneIcon,
    TrashIcon,
    MagnifyingGlassIcon,
    PlusIcon,
    ExclamationTriangleIcon,
    BuildingOfficeIcon,
    UserIcon,
    EyeSlashIcon
} from '@heroicons/react/24/outline';
import Modal from '/src/components/Modal.jsx'; 
import DocumentTemplate from '/src/modules/billing/DocumentTemplate.jsx'; 
import UpdateRFPModal from '/src/modules/billing/UpdateRFPModal.jsx'; 

const CreateManualRFPModal = ({ isOpen, onClose }) => {
    const [loading, setLoading] = useState(false);
    const [projects, setProjects] = useState([]);
    const [allClients, setAllClients] = useState([]);

    const [projectNumber, setProjectNumber] = useState('');
    const [recipientType, setRecipientType] = useState('company');
    const [recipient, setRecipient] = useState('');
    const [recipientAddress, setRecipientAddress] = useState('');
    const [recipientVat, setRecipientVat] = useState('');
    const [description, setDescription] = useState('');

    const [feeAmount, setFeeAmount] = useState('');
    const [feeVatApplicable, setFeeVatApplicable] = useState(true);

    const [availableCosts, setAvailableCosts] = useState([]);
    const [selectedCostIds, setSelectedCostIds] = useState(new Set());
    const [nonChargeableIds, setNonChargeableIds] = useState(new Set());
    const [hiddenCostIds, setHiddenCostIds] = useState(new Set());
    const [costSettings, setCostSettings] = useState({});

    useEffect(() => {
        if (isOpen) {
            const fetchInitialData = async () => {
                const qProj = query(collection(db, 'projects'), where('status', '==', 'Active'));
                const snapProj = await getDocs(qProj);
                const listProj = snapProj.docs.map(d => d.data());
                listProj.sort((a, b) => (parseInt(a.projectNumber) || 0) - (parseInt(b.projectNumber) || 0));
                setProjects(listProj);

                const qClients = query(collection(db, 'clients'));
                const snapClients = await getDocs(qClients);
                const listClients = snapClients.docs.map(d => ({ id: d.id, ...d.data() }));
                setAllClients(listClients);
            };
            fetchInitialData();

            setProjectNumber('');
            setRecipientType('company');
            setRecipient('');
            setRecipientAddress('');
            setRecipientVat('');
            setDescription('');
            setFeeAmount('');
            setFeeVatApplicable(true);
            setAvailableCosts([]);
            setSelectedCostIds(new Set());
            setNonChargeableIds(new Set());
            setHiddenCostIds(new Set());
            setCostSettings({});
        }
    }, [isOpen]);

    const filteredClients = useMemo(() => {
        if (!allClients) return [];
        return allClients.filter(c => {
            const cType = c.type || (c.companyName ? 'company' : 'individual');
            return cType === recipientType;
        }).sort((a, b) => {
            const nameA = a.companyName || `${a.name} ${a.surname}`;
            const nameB = b.companyName || `${b.name} ${b.surname}`;
            return nameA.localeCompare(nameB);
        });
    }, [allClients, recipientType]);

    const handleRecipientChange = (e) => {
        const val = e.target.value;
        setRecipient(val);

        const match = filteredClients.find(c => {
            const name = c.companyName || `${c.name} ${c.surname}`;
            return name === val;
        });

        if (match) {
            const addrParts = [match.address, match.locality, match.postCode, match.country].filter(Boolean).join(',\n');
            setRecipientAddress(addrParts);
            setRecipientVat(match.vatNumber || '');
        }
    };

    useEffect(() => {
        const fetchProjectData = async () => {
            if (!projectNumber) {
                setAvailableCosts([]);
                return;
            }
            setLoading(true);

            try {
                const rawInput = String(projectNumber).trim();
                const numValue = parseInt(rawInput, 10);
                const distinctValues = new Set();

                if (!isNaN(numValue)) {
                    distinctValues.add(numValue);
                    distinctValues.add(String(numValue));
                    distinctValues.add(String(numValue).padStart(4, '0'));
                    distinctValues.add(rawInput);
                } else {
                    distinctValues.add(rawInput);
                }

                const variations = Array.from(distinctValues);

                const proj = projects.find(p => {
                    const pNum = String(p.projectNumber);
                    return variations.some(v => String(v) === pNum);
                });

                if (proj && proj.clientNumber) {
                    const clientRaw = String(proj.clientNumber);
                    const matchedClient = allClients.find(c =>
                        String(c.clientNumber) === clientRaw ||
                        parseInt(c.clientNumber) === parseInt(clientRaw)
                    );

                    if (matchedClient) {
                        const cType = matchedClient.type || (matchedClient.companyName ? 'company' : 'individual');
                        setRecipientType(cType);
                        const cName = matchedClient.companyName || `${matchedClient.name} ${matchedClient.surname}`;
                        setRecipient(cName);
                        const addrParts = [matchedClient.address, matchedClient.locality, matchedClient.postCode, matchedClient.country].filter(Boolean).join(',\n');
                        setRecipientAddress(addrParts);
                        setRecipientVat(matchedClient.vatNumber || '');
                    }
                }

                const costsQ = query(
                    collection(db, 'project_costs'),
                    where('projectNumber', 'in', variations),
                    where('billingStatus', '==', 'unbilled')
                );

                const costsSnap = await getDocs(costsQ);
                const costs = costsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setAvailableCosts(costs);

                const initialSettings = {};
                costs.forEach(c => {
                    initialSettings[c.id] = { fee: 10 };
                });
                setCostSettings(initialSettings);

            } catch (err) {
                console.error("Error fetching project data:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchProjectData();
    }, [projectNumber, projects, allClients]);

    const financials = useMemo(() => {
        const baseFee = parseFloat(feeAmount) || 0;
        let costsNet = 0;
        let managementFeesTotal = 0;

        selectedCostIds.forEach(id => {
            const cost = availableCosts.find(c => c.id === id);
            const settings = costSettings[id] || { fee: 0 };
            if (cost) {
                const amount = parseFloat(cost.amount) || 0;
                const mgmtFee = amount * (settings.fee / 100);
                costsNet += amount;
                managementFeesTotal += mgmtFee;
            }
        });

        const totalProfessionalFees = baseFee + managementFeesTotal;
        const totalNet = totalProfessionalFees + costsNet;

        return { baseFee, managementFeesTotal, totalProfessionalFees, costsNet, totalNet };
    }, [feeAmount, selectedCostIds, availableCosts, costSettings]);

    const toggleCostSelection = (id) => {
        const next = new Set(selectedCostIds);
        if (next.has(id)) {
            next.delete(id);
            setHiddenCostIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        } else {
            next.add(id);
            setNonChargeableIds(prev => { const next = new Set(prev); next.delete(id); return next; });
        }
        setSelectedCostIds(next);
    };

    const toggleChargeable = (id) => {
        setNonChargeableIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
                setSelectedCostIds(sel => { const n = new Set(sel); n.delete(id); return n; });
                setHiddenCostIds(prev => { const n = new Set(prev); n.delete(id); return n; });
            }
            return next;
        });
    };

    const toggleVisibility = (id) => {
        setHiddenCostIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const updateCostSetting = (id, field, value) => {
        setCostSettings(prev => ({
            ...prev,
            [id]: { ...prev[id], [field]: value }
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!projectNumber || !recipient) return;
        setLoading(true);

        const costIds = Array.from(selectedCostIds);
        const writeOffCostIds = Array.from(nonChargeableIds);
        const hiddenList = Array.from(hiddenCostIds);
        const costManagementFees = {};
        costIds.forEach(id => {
            costManagementFees[id] = costSettings[id]?.fee || 0;
        });

        const itemsToSave = [];
        let hiddenCostsSum = 0;
        const visibleCosts = [];

        availableCosts.forEach(c => {
            if (selectedCostIds.has(c.id)) {
                if (hiddenCostIds.has(c.id)) hiddenCostsSum += parseFloat(c.amount) || 0;
                else visibleCosts.push(c);
            }
        });

        const displayFeeAmount = financials.totalProfessionalFees + hiddenCostsSum;
        
        if (displayFeeAmount > 0) {
             itemsToSave.push({
                 description: "Professional Services (Fees)",
                 net: displayFeeAmount,
                 vatRate: feeVatApplicable ? 0.18 : 0
             });
        }

        visibleCosts.forEach(c => {
             const amt = parseFloat(c.amount) || 0;
             itemsToSave.push({
                 description: `${c.type || 'Expense'}: ${c.description}`,
                 net: amt,
                 vatRate: c.vatApplicable !== false ? 0.18 : 0
             });
        });

        try {
            const createFn = httpsCallable(functions, 'createRFP');
            await createFn({
                projectNumber,
                recipient,
                recipientAddress,
                recipientVat,
                description,
                isIndependent: true,
                items: itemsToSave,
                timeIds: [], 
                costIds: costIds,
                writeOffCostIds: writeOffCostIds,
                costManagementFees: costManagementFees,
                hiddenCostIds: hiddenList 
            });
            onClose();
        } catch (error) {
            console.error(error);
            alert("Failed to create manual RFP.");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <Modal show={isOpen} onClose={onClose} title="Create New RFP (Manual)" maxWidth="max-w-5xl">
            <form onSubmit={handleSubmit} className="space-y-6">

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase">Project</label>
                            <select className="w-full p-2 border border-gray-300 rounded-md text-sm mt-1 focus:ring-orange-500 focus:border-orange-500 outline-none bg-white" value={projectNumber} onChange={e => setProjectNumber(e.target.value)} required>
                                <option value="">Select Project...</option>
                                {projects.map(p => <option key={p.projectNumber} value={p.projectNumber}>{p.projectNumber} - {p.projectDescription}</option>)}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className="block text-xs font-bold text-gray-500 uppercase">Recipient</label>
                                <div className="flex bg-gray-100 p-0.5 rounded text-[10px]">
                                    <button
                                        type="button"
                                        onClick={() => { setRecipientType('company'); setRecipient(''); }}
                                        className={`px-2 py-1 rounded flex items-center gap-1 transition-all ${recipientType === 'company' ? 'bg-white shadow text-indigo-600 font-bold' : 'text-gray-500'}`}
                                    >
                                        <BuildingOfficeIcon className="h-3 w-3" /> Company
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setRecipientType('individual'); setRecipient(''); }}
                                        className={`px-2 py-1 rounded flex items-center gap-1 transition-all ${recipientType === 'individual' ? 'bg-white shadow text-indigo-600 font-bold' : 'text-gray-500'}`}
                                    >
                                        <UserIcon className="h-3 w-3" /> Individual
                                    </button>
                                </div>
                            </div>

                            <input
                                list="recipient-suggestions"
                                className="w-full p-2 border border-gray-300 rounded-md text-sm focus:ring-orange-500 focus:border-orange-500 outline-none"
                                value={recipient}
                                onChange={handleRecipientChange}
                                placeholder={recipientType === 'company' ? "Search Companies..." : "Search Individuals..."}
                                required
                            />
                            <datalist id="recipient-suggestions">
                                {filteredClients.map(c => {
                                    const name = c.companyName || `${c.name} ${c.surname}`;
                                    const code = String(c.clientNumber).padStart(4, '0');
                                    return <option key={c.id} value={name}>{code} - {name}</option>
                                })}
                            </datalist>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase">Description</label>
                            <textarea className="w-full p-2 border border-gray-300 rounded-md text-sm mt-1 focus:ring-orange-500 focus:border-orange-500 outline-none" rows="3" value={description} onChange={e => setDescription(e.target.value)} required />
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase">Address</label>
                            <textarea className="w-full p-2 border border-gray-300 rounded-md text-sm mt-1 focus:ring-orange-500 focus:border-orange-500 outline-none" rows="3" value={recipientAddress} onChange={e => setRecipientAddress(e.target.value)} />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase">VAT No.</label>
                            <input className="w-full p-2 border border-gray-300 rounded-md text-sm mt-1 focus:ring-orange-500 focus:border-orange-500 outline-none" value={recipientVat} onChange={e => setRecipientVat(e.target.value)} />
                        </div>
                    </div>
                </div>

                <hr className="border-gray-200" />

                <div>
                    <h4 className="text-sm font-bold text-gray-800 mb-3 uppercase tracking-wider">1. Professional Fees</h4>
                    <div className="bg-gray-50 p-4 rounded border border-gray-200 space-y-3">
                        <div className="flex items-center gap-4">
                            <div className="flex-1">
                                <label className="block text-xs text-gray-500 uppercase font-bold">Manual Fee Amount (Excl. VAT)</label>
                                <input type="number" step="0.01" className="w-full p-2 border border-gray-300 rounded text-sm font-mono mt-1 focus:ring-orange-500 focus:border-orange-500 outline-none" value={feeAmount} onChange={e => setFeeAmount(e.target.value)} placeholder="0.00" />
                            </div>
                            <div className="flex flex-col pt-5">
                                <label className="flex items-center cursor-pointer text-xs font-bold text-gray-600 bg-white border border-gray-300 rounded px-3 py-2 shadow-sm">
                                    <input 
                                        type="checkbox" 
                                        className="h-4 w-4 mr-2 rounded text-orange-600 focus:ring-orange-500"
                                        checked={feeVatApplicable}
                                        onChange={(e) => setFeeVatApplicable(e.target.checked)}
                                    />
                                    VAT App. (18%)
                                </label>
                            </div>
                        </div>

                        {financials.managementFeesTotal > 0 && (
                            <div className="flex justify-between items-center text-xs text-gray-600 border-t border-gray-200 pt-2 mt-2">
                                <span>+ Management Fees (from Expenses):</span>
                                <span className="font-mono font-bold">€{financials.managementFeesTotal.toFixed(2)}</span>
                            </div>
                        )}

                        <div className="flex justify-between items-center text-sm font-bold text-gray-800 border-t border-gray-200 pt-2 mt-2">
                            <span>Total Professional Fees:</span>
                            <span className="font-mono text-lg text-orange-600">€{financials.totalProfessionalFees.toFixed(2)}</span>
                        </div>
                    </div>
                </div>

                <div>
                    <h4 className="text-sm font-bold text-gray-800 mb-3 uppercase tracking-wider flex justify-between">
                        <span>2. Project Costs (Reimbursements)</span>
                        <span className="text-xs text-gray-500 normal-case font-normal">Found {availableCosts.length} unbilled items</span>
                    </h4>

                    {availableCosts.length > 0 ? (
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-gray-100 font-bold text-gray-600">
                                    <tr>
                                        <th className="p-3 w-10 text-center" title="Include in RFP?">Inc</th>
                                        <th className="p-3 w-10 text-center" title="Is Chargeable? Uncheck to write off.">Chg</th>
                                        <th className="p-3 w-10 text-center" title="Visible on PDF?">Vis</th>
                                        <th className="p-3">Description</th>
                                        <th className="p-3 text-right w-24">Cost</th>
                                        <th className="p-3 w-20 text-center">Mgmt %</th>
                                        <th className="p-3 text-right w-24">Fee</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {availableCosts.map(cost => {
                                        const isSelected = selectedCostIds.has(cost.id);
                                        const isChargeable = !nonChargeableIds.has(cost.id);
                                        const isVisible = !hiddenCostIds.has(cost.id);
                                        const settings = costSettings[cost.id] || { fee: 10 };
                                        const base = parseFloat(cost.amount);
                                        const feeVal = base * (settings.fee / 100);

                                        const rowClass = !isChargeable ? 'bg-red-50 text-red-700' : isSelected ? 'bg-orange-50' : 'hover:bg-gray-50';

                                        return (
                                            <tr key={cost.id} className={rowClass}>
                                                <td className="p-3 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleCostSelection(cost.id)}
                                                        className="rounded text-orange-600 focus:ring-orange-500 cursor-pointer"
                                                        disabled={!isChargeable}
                                                    />
                                                </td>
                                                <td className="p-3 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={isChargeable}
                                                        onChange={() => toggleChargeable(cost.id)}
                                                        className={`rounded cursor-pointer ${isSelected ? 'text-gray-400 bg-gray-100 border-gray-300' : 'text-blue-600 focus:ring-blue-500'}`}
                                                        disabled={isSelected}
                                                        title={isSelected ? "Deselect from 'Inc' first to change chargeability" : "Uncheck to mark as Non-Chargeable (Write Off)"}
                                                    />
                                                </td>
                                                <td className="p-3 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={isVisible}
                                                        onChange={() => toggleVisibility(cost.id)}
                                                        className={`rounded cursor-pointer ${(isSelected && isChargeable) ? 'text-purple-600' : 'text-gray-300 bg-gray-100'}`}
                                                        disabled={!isSelected || !isChargeable}
                                                        title="Uncheck to hide line item from RFP PDF (value remains in total)"
                                                    />
                                                </td>
                                                <td className="p-3 truncate max-w-[200px]" title={cost.description}>
                                                    <div className="flex items-center">
                                                        {!isVisible && isSelected && <EyeSlashIcon className="h-3 w-3 mr-1 text-purple-500" />}
                                                        <span className="font-medium">{cost.description}</span>
                                                    </div>
                                                    <div className={`text-[10px] ${!isChargeable ? 'text-red-500' : 'text-gray-500'}`}>
                                                        {cost.type} {!isChargeable && "(Write Off)"}
                                                    </div>
                                                </td>
                                                <td className="p-3 text-right font-mono">€{base.toFixed(2)}</td>
                                                <td className="p-3 text-center">
                                                    <input
                                                        type="number"
                                                        className="w-12 text-center border border-gray-300 rounded p-1 text-xs focus:ring-orange-500 focus:border-orange-500 outline-none"
                                                        value={settings.fee}
                                                        onChange={e => updateCostSetting(cost.id, 'fee', parseFloat(e.target.value) || 0)}
                                                        disabled={!isSelected}
                                                    />
                                                </td>
                                                <td className="p-3 text-right font-mono font-medium opacity-70">
                                                    {isSelected ? `€${feeVal.toFixed(2)}` : '-'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="text-sm text-gray-400 italic p-6 border border-dashed border-gray-300 rounded bg-gray-50 text-center">
                            No unbilled costs found for this project.
                        </div>
                    )}
                </div>

                <div className="bg-gray-50 border border-gray-200 p-5 rounded-lg flex flex-col sm:flex-row justify-between items-center shadow-sm">
                    <div className="text-xs text-gray-500 space-y-1 w-full sm:w-auto mb-4 sm:mb-0">
                        <div className="flex justify-between sm:justify-start gap-4"><span>Total Fees (incl. Mgmt):</span> <span className="font-mono text-gray-900 font-medium">€{financials.totalProfessionalFees.toFixed(2)}</span></div>
                        <div className="flex justify-between sm:justify-start gap-4"><span>Reimbursable Costs:</span> <span className="font-mono text-gray-900 font-medium">€{financials.costsNet.toFixed(2)}</span></div>
                        <div className="flex justify-between sm:justify-start gap-4 text-orange-600/70"><span>VAT:</span> <span>(Determined on Issue)</span></div>
                    </div>
                    <div className="text-right w-full sm:w-auto border-t sm:border-t-0 border-gray-200 pt-3 sm:pt-0">
                        <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Total Net Amount</div>
                        <div className="text-3xl font-bold font-mono text-orange-600">€{financials.totalNet.toFixed(2)}</div>
                    </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500" disabled={loading}>
                        Cancel
                    </button>
                    <button type="submit" className="inline-flex justify-center px-6 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50" disabled={loading}>
                        {loading ? 'Processing...' : 'Generate RFP'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

const IssuePreviewModal = ({ rfp, issuer, onClose, onConfirm, isProcessing }) => {
    const [previewData, setPreviewData] = useState(null);
    const [calculating, setCalculating] = useState(true);

    const roundUp = (num) => Math.ceil(num * 100) / 100;

    useEffect(() => {
        const buildPreview = async () => {
            setCalculating(true);
            try {
                let finalItems = Array.isArray(rfp.items) ? rfp.items : [];
                const hasValidItemBreakdown = finalItems.length > 0 && typeof finalItems[0] === 'object' && finalItems[0] !== null && 'net' in finalItems[0];
                
                let grandNet = 0;
                let grandVat = 0;
                let grandTotal = 0;

                if (hasValidItemBreakdown) {
                    grandNet = finalItems.reduce((s, i) => s + (parseFloat(i.net) || 0), 0);
                    grandVat = finalItems.reduce((s, i) => {
                        if (i.vat !== undefined && i.vat !== null) return s + parseFloat(i.vat);
                        if (i.vatRate !== undefined && i.vatRate !== null) return s + (parseFloat(i.net || 0) * parseFloat(i.vatRate));
                        const applies = rfp.vatApplicable !== false;
                        return s + (applies ? parseFloat(i.net || 0) * 0.18 : 0);
                    }, 0);
                    grandTotal = finalItems.reduce((s, i) => {
                        if (i.total !== undefined && i.total !== null) return s + parseFloat(i.total);
                        let iVat = 0;
                        if (i.vat !== undefined && i.vat !== null) iVat = parseFloat(i.vat);
                        else if (i.vatRate !== undefined && i.vatRate !== null) iVat = parseFloat(i.net || 0) * parseFloat(i.vatRate);
                        else iVat = rfp.vatApplicable !== false ? parseFloat(i.net || 0) * 0.18 : 0;
                        return s + parseFloat(i.net || 0) + iVat;
                    }, 0);
                } else {
                    // Fallback: If no items array exists, or it is an array of legacy string IDs, rebuild it
                    finalItems = [];
                    let costs = [];
                    if (rfp.linkedCostIds && rfp.linkedCostIds.length > 0) {
                        const cQ = query(collection(db, 'project_costs'), where('rfpId', '==', rfp.id));
                        const cSnap = await getDocs(cQ);
                        costs = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                    }

                    let hiddenCostsSum = 0;
                    const visibleCosts = [];

                    costs.forEach(c => {
                        const amt = parseFloat(c.amount) || 0;
                        if (c.isVisibleInRfp !== false) {
                            visibleCosts.push(c);
                        } else {
                            hiddenCostsSum += amt;
                        }
                    });

                    const totalAllCosts = costs.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
                    const pureFeeAmount = Math.max(0, (parseFloat(rfp.amount) || 0) - totalAllCosts);
                    const displayFeeAmount = pureFeeAmount + hiddenCostsSum;

                    const feeVatApply = rfp.feeVatApplicable !== undefined ? rfp.feeVatApplicable : (rfp.vatApplicable !== false);
                    const feeVat = feeVatApply ? roundUp(displayFeeAmount * 0.18) : 0;

                    if (displayFeeAmount > 0) {
                        finalItems.push({
                            description: "Professional Services (Fees)",
                            net: displayFeeAmount,
                            vatRate: feeVatApply ? 0.18 : 0,
                            vat: feeVat,
                            total: displayFeeAmount + feeVat
                        });
                    }

                    visibleCosts.forEach(c => {
                        const amt = parseFloat(c.amount) || 0;
                        const costVatApply = c.vatApplicable !== false;
                        const costVat = costVatApply ? roundUp(amt * 0.18) : 0;

                        finalItems.push({
                            description: `${c.type || 'Expense'}: ${c.description}`,
                            net: amt,
                            vatRate: costVatApply ? 0.18 : 0,
                            vat: costVat,
                            total: amt + costVat
                        });
                    });

                    grandNet = finalItems.reduce((s, i) => s + i.net, 0);
                    grandVat = finalItems.reduce((s, i) => s + i.vat, 0);
                    grandTotal = finalItems.reduce((s, i) => s + i.total, 0);
                }

                setPreviewData({
                    ...rfp,
                    status: 'Issued - Preview',
                    issuer: issuer.name,
                    issuerDetails: issuer,
                    rfpNumber: 'DRAFT-PREVIEW',
                    issuedAt: new Date(),
                    items: finalItems, 
                    amount: grandNet,
                    vatAmount: grandVat,
                    totalAmount: grandTotal,
                    vatApplicable: grandVat > 0 
                });

            } catch (e) {
                console.error("Preview calc error", e);
            } finally {
                setCalculating(false);
            }
        };

        buildPreview();
    }, [rfp, issuer]);

    return (
        <Modal show={true} onClose={onClose} title="Review Before Issuing" maxWidth="5xl">
            <div className="flex flex-col h-[75vh]">
                <div className="bg-yellow-50 border-b border-yellow-200 p-3 text-sm text-yellow-800 flex items-center justify-center shrink-0">
                    <ExclamationTriangleIcon className="h-5 w-5 mr-2" />
                    Please review the financial breakdown below. This document is a draft preview.
                </div>

                <div className="flex-1 bg-gray-200 p-4 overflow-y-auto flex justify-center">
                    {calculating ? (
                        <div className="text-gray-500 font-bold self-center">Calculating Financial Breakdown...</div>
                    ) : (
                        <div className="transform scale-90 origin-top shadow-lg">
                            {previewData && <DocumentTemplate data={previewData} type="RFP" />}
                        </div>
                    )}
                </div>

                <div className="border-t border-gray-200 p-4 flex justify-between items-center bg-white shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                        disabled={isProcessing}
                    >
                        Cancel & Edit
                    </button>
                    <button
                        onClick={() => onConfirm(previewData)} 
                        className="inline-flex items-center px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                        disabled={isProcessing || calculating}
                    >
                        {isProcessing ? 'Issuing...' : 'Confirm & Issue RFP'}
                        {!isProcessing && <PaperAirplaneIcon className="ml-2 h-4 w-4" />}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

const PendingRFPs = () => {
    const [rfps, setRfps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [issuers, setIssuers] = useState([]);
    const [issuerDetailsMap, setIssuerDetailsMap] = useState({});

    const [selectedIssuers, setSelectedIssuers] = useState({});

    const [selectedRfpForUpdate, setSelectedRfpForUpdate] = useState(null);
    const [showManualCreate, setShowManualCreate] = useState(false);

    const [rfpToIssue, setRfpToIssue] = useState(null);
    const [processingIssue, setProcessingIssue] = useState(false);
    const [finalizedRfpForPrint, setFinalizedRfpForPrint] = useState(null);

    useEffect(() => {
        const fetchIssuers = async () => {
            try {
                const settingsRef = doc(db, 'settings', 'rfp_issuers');
                const settingsSnap = await getDoc(settingsRef);
                if (settingsSnap.exists()) {
                    const data = settingsSnap.data();
                    if (data.issuers && Array.isArray(data.issuers)) {
                        const issuerList = data.issuers.map(i => ({
                            ...i,
                            displayName: i.displayName || i.name
                        }));
                        setIssuers(issuerList);

                        const map = {};
                        issuerList.forEach(i => map[i.name] = i);
                        setIssuerDetailsMap(map);
                    } else if (data.names && Array.isArray(data.names)) {
                        const legacyList = data.names.map(n => ({ name: n, displayName: n }));
                        setIssuers(legacyList);
                        const map = {};
                        legacyList.forEach(i => map[i.name] = i);
                        setIssuerDetailsMap(map);
                    }
                }
            } catch (e) {
                console.error("Failed to load issuers", e);
            }
        };
        fetchIssuers();

        const q = query(collection(db, 'rfps'), where('status', '==', 'Pending'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const rfpList = snapshot.docs.map(doc => {
                const d = doc.data();
                let amt = parseFloat(d.amount) || 0;
                let vatAmount = 0;
                let totalAmount = 0;
                let vatApp = d.vatApplicable !== false;

                // 1. If it has a valid item breakdown, calculate it perfectly from the items to ensure row accuracy
                const hasValidItemBreakdown = d.items && d.items.length > 0 && typeof d.items[0] === 'object' && d.items[0] !== null && 'net' in d.items[0];

                if (hasValidItemBreakdown) {
                    amt = d.items.reduce((s, i) => s + (parseFloat(i.net) || 0), 0);
                    vatAmount = d.items.reduce((s, i) => {
                        if (i.vat !== undefined && i.vat !== null) return s + parseFloat(i.vat);
                        if (i.vatRate !== undefined && i.vatRate !== null) return s + (parseFloat(i.net || 0) * parseFloat(i.vatRate));
                        return s + (d.vatApplicable !== false ? parseFloat(i.net || 0) * 0.18 : 0);
                    }, 0);
                    totalAmount = d.items.reduce((s, i) => {
                        if (i.total !== undefined && i.total !== null) return s + parseFloat(i.total);
                        let iVat = 0;
                        if (i.vat !== undefined && i.vat !== null) iVat = parseFloat(i.vat);
                        else if (i.vatRate !== undefined && i.vatRate !== null) iVat = parseFloat(i.net || 0) * parseFloat(i.vatRate);
                        else iVat = d.vatApplicable !== false ? parseFloat(i.net || 0) * 0.18 : 0;
                        return s + parseFloat(i.net || 0) + iVat;
                    }, 0);
                    vatApp = vatAmount > 0;
                } else {
                    // 2. Fallback to explicitly defined DB fields (handles valid stored amounts)
                    if (d.vatAmount !== undefined && d.vatAmount !== null) {
                        vatAmount = parseFloat(d.vatAmount);
                        vatApp = vatAmount > 0;
                    } else if (d.vatApplicable !== false) {
                        vatAmount = amt * 0.18;
                        vatApp = true;
                    } else {
                        vatAmount = 0;
                        vatApp = false;
                    }

                    if (d.totalAmount !== undefined && d.totalAmount !== null) {
                        totalAmount = parseFloat(d.totalAmount);
                    } else {
                        totalAmount = amt + vatAmount;
                    }
                }

                let createdDate = null;
                if (d.createdAt) {
                    if (d.createdAt.toDate) {
                        createdDate = d.createdAt.toDate();
                    } else if (d.createdAt.seconds) {
                        createdDate = new Date(d.createdAt.seconds * 1000);
                    } else if (typeof d.createdAt === 'string' || typeof d.createdAt === 'number') {
                        createdDate = new Date(d.createdAt);
                    }
                }
                if (createdDate && isNaN(createdDate.getTime())) createdDate = null;

                return {
                    id: doc.id,
                    ...d,
                    amount: amt,
                    vatAmount,
                    totalAmount,
                    vatApplicable: vatApp,
                    createdDateObj: createdDate
                };
            });
            rfpList.sort((a, b) => (b.createdDateObj || 0) - (a.createdDateObj || 0));
            setRfps(rfpList);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const handleDelete = async (rfpId) => {
        if (!window.confirm("Are you sure you want to delete this Pending RFP? The items linked to it will be marked as 'unbilled' again.")) {
            return;
        }

        try {
            const rfpRef = doc(db, 'rfps', rfpId);
            const batch = writeBatch(db);

            const entriesQuery = query(collection(db, 'timesheet_entries'), where('rfpId', '==', rfpId));
            const entriesSnap = await getDocs(entriesQuery);

            entriesSnap.forEach(docSnap => {
                batch.update(docSnap.ref, {
                    billingStatus: 'unbilled',
                    rfpId: null
                });
            });

            const costsQuery = query(collection(db, 'project_costs'), where('rfpId', '==', rfpId));
            const costsSnap = await getDocs(costsQuery);

            costsSnap.forEach(docSnap => {
                batch.update(docSnap.ref, {
                    billingStatus: 'unbilled',
                    rfpId: null
                });
            });

            batch.delete(rfpRef);

            await batch.commit();
            console.log("RFP deleted and items reverted successfully.");

        } catch (error) {
            console.error("Delete failed:", error);
            if (error.code === 'not-found' || error.toString().includes('No document to update')) {
                if (window.confirm("Could not revert linked items (documents not found). Delete RFP anyway?")) {
                    await deleteDoc(doc(db, 'rfps', rfpId));
                }
            } else {
                alert("Failed to delete RFP: " + error.message);
            }
        }
    };

    const handleIssuerSelect = (rfpId, value) => {
        setSelectedIssuers(prev => ({ ...prev, [rfpId]: value }));
    };

    const initiateIssueWorkflow = (rfp) => {
        const chosenIssuer = selectedIssuers[rfp.id];
        if (!chosenIssuer) {
            alert("Please select an Issuer from the dropdown first.");
            return;
        }
        if (!rfp.recipient || !rfp.recipientAddress) {
            alert("Recipient Name and Address are required to issue. Please edit the details.");
            return;
        }
        setRfpToIssue(rfp);
    };

    const handleConfirmIssue = async (previewData) => {
        if (!rfpToIssue || !previewData) return;
        const chosenIssuerName = selectedIssuers[rfpToIssue.id];

        setProcessingIssue(true);
        try {
            const issueFn = httpsCallable(functions, 'issueRFP');
            const result = await issueFn({
                rfpId: rfpToIssue.id,
                issuer: chosenIssuerName,
                recipientAddress: rfpToIssue.recipientAddress || '',
                recipientVat: rfpToIssue.recipientVat || ''
            });

            const rfpCode = result.data.rfpCode;

            // SAVE THE ITEM BREAKDOWN TO THE DATABASE
            const rfpRef = doc(db, 'rfps', rfpToIssue.id);
            await updateDoc(rfpRef, {
                items: previewData.items,
                amount: previewData.amount,
                vatAmount: previewData.vatAmount,
                totalAmount: previewData.totalAmount,
                vatApplicable: previewData.vatApplicable // Explicitly mark if VAT applies overall
            });

            const finalized = {
                ...previewData, 
                status: 'Issued - Open',
                rfpNumber: rfpCode,
                rfpCode: rfpCode,
                issuedAt: new Date()
            };

            setFinalizedRfpForPrint(finalized);
            setRfpToIssue(null);

            setTimeout(() => {
                printFinalized(finalized);
                setProcessingIssue(false);
            }, 500);

        } catch (error) {
            console.error("Issue failed:", error);
            alert("Failed to issue RFP. " + error.message);
            setProcessingIssue(false);
        }
    };

    const printFinalized = (dataToPrint) => {
        const printContent = document.getElementById('hidden-rfp-preview');
        if (!printContent) return;

        const printWindow = window.open('', '_blank', 'height=1123,width=794');
        if (printWindow) {
            printWindow.document.write('<html><head><title>RFP ' + dataToPrint.rfpNumber + '</title>');
            printWindow.document.write('<script src="https://cdn.tailwindcss.com"></script>');
            printWindow.document.write(`
                <style>
                    body { margin: 0; padding: 0; background: #e5e5e5; }
                    @media print {
                        body { background: white; -webkit-print-color-adjust: exact; }
                        @page { size: A4; margin: 0; }
                    }
                    body > div { margin: 0 auto; } 
                </style>
            `);
            printWindow.document.write('</head><body>');
            printWindow.document.write(printContent.innerHTML);
            printWindow.document.write('</body></html>');
            printWindow.document.close();

            setTimeout(() => {
                printWindow.focus();
                printWindow.print();
            }, 1000);
        }
        setTimeout(() => setFinalizedRfpForPrint(null), 2000);
    };

    const filteredRfps = useMemo(() => {
        const term = searchTerm.toLowerCase().trim();
        if (!term) return rfps;
        return rfps.filter(rfp =>
            String(rfp.projectNumber).toLowerCase().includes(term) ||
            String(rfp.projectName).toLowerCase().includes(term) ||
            String(rfp.recipient).toLowerCase().includes(term)
        );
    }, [rfps, searchTerm]);

    if (loading) return <div className="p-8 text-center text-gray-500">Loading Pending RFPs...</div>;

    return (
        <div className="bg-white rounded-lg shadow border border-gray-200 h-[calc(100vh-12rem)] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-4">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900">Pending Requests for Payment</h2>
                        <div className="text-sm text-gray-500">Showing {filteredRfps.length} pending items</div>
                    </div>
                    <button
                        onClick={() => setShowManualCreate(true)}
                        className="flex items-center px-3 py-1.5 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-md hover:bg-indigo-100 border border-indigo-200 transition-colors"
                    >
                        <PlusIcon className="h-4 w-4 mr-1.5" />
                        New Manual RFP
                    </button>
                </div>

                <div className="relative">
                    <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search project..."
                        className="pl-9 py-1.5 block w-64 rounded-md border-gray-300 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="flex-1 overflow-auto">
                <table className="min-w-full divide-y divide-gray-200 table-auto">
                    <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Project</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Recipient</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Amount<br /><span className="text-[10px] text-gray-400">(Excl VAT)</span></th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">VAT<br /><span className="text-[10px] text-gray-400">(18%)</span></th>
                            <th className="px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider bg-gray-100">Total</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 w-48">Select Issuer</th>
                            <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {filteredRfps.map((rfp) => {
                            const hasIssuer = !!selectedIssuers[rfp.id];
                            const hasRecipientData = rfp.recipient && rfp.recipientAddress;
                            const isReady = hasIssuer && hasRecipientData;

                            return (
                                <tr key={rfp.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 align-top">
                                        {rfp.createdDateObj ? rfp.createdDateObj.toLocaleDateString('en-GB') : 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-500 align-top">
                                        <div className="font-medium text-gray-900 flex items-center">
                                            {rfp.projectNumber}
                                            {rfp.isManual && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 border border-gray-200">Manual</span>}
                                        </div>
                                        <div className="text-xs text-gray-400 mt-1">{rfp.projectName}</div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-500 align-top">
                                        <div className="font-medium text-gray-900">{rfp.recipient}</div>
                                        {(rfp.recipientAddress || rfp.recipientVat) ? (
                                            <div className="text-xs text-gray-400 mt-1">
                                                {rfp.recipientAddress && <div className="whitespace-pre-line">{rfp.recipientAddress}</div>}
                                                {rfp.recipientVat && <div className="mt-0.5 font-mono text-gray-500">{rfp.recipientVat}</div>}
                                            </div>
                                        ) : (
                                            <div className="text-xs text-red-500 mt-1 italic flex items-center">
                                                <ExclamationTriangleIcon className="h-3 w-3 mr-1" />
                                                Address missing
                                            </div>
                                        )}
                                    </td>

                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-right text-gray-600 font-mono align-top">
                                        €{rfp.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-right text-gray-500 font-mono align-top">
                                        €{rfp.vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-right font-bold text-gray-900 font-mono bg-gray-50 align-top">
                                        €{rfp.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>

                                    <td className="px-4 py-4 align-top w-48">
                                        <select
                                            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-xs py-1 truncate"
                                            value={selectedIssuers[rfp.id] || ''}
                                            onChange={(e) => handleIssuerSelect(rfp.id, e.target.value)}
                                            style={{ maxWidth: '100%' }}
                                        >
                                            <option value="">-- Select --</option>
                                            {issuers.map(iss => (
                                                <option key={iss.name} value={iss.name} title={`${iss.name} (${iss.displayName || iss.name})`}>
                                                    {`${iss.name} (${iss.displayName || iss.name})`}
                                                </option>
                                            ))}
                                        </select>
                                    </td>

                                    <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium align-top">
                                        <div className="flex justify-center items-center space-x-3">
                                            <button onClick={() => setSelectedRfpForUpdate(rfp)} className="text-gray-500 hover:text-blue-600" title="Edit Details">
                                                <PencilSquareIcon className="h-5 w-5" />
                                            </button>

                                            <div className="relative group">
                                                <button
                                                    onClick={() => initiateIssueWorkflow(rfp)}
                                                    className={`
                                                        ${isReady
                                                            ? 'text-green-600 hover:text-green-800'
                                                            : 'text-gray-300 cursor-not-allowed'}
                                                    `}
                                                    title={isReady ? "Issue RFP" : "Select Issuer & Check Address first"}
                                                    disabled={!isReady}
                                                >
                                                    <PaperAirplaneIcon className="h-5 w-5" />
                                                </button>
                                            </div>

                                            <button onClick={() => handleDelete(rfp.id)} className="text-gray-500 hover:text-red-600" title="Delete RFP">
                                                <TrashIcon className="h-5 w-5" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredRfps.length === 0 && (
                            <tr>
                                <td colSpan="9" className="px-6 py-8 text-center text-gray-500 italic">
                                    No pending RFPs found matching your search.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {rfpToIssue && selectedIssuers[rfpToIssue.id] && (
                <IssuePreviewModal
                    rfp={rfpToIssue}
                    issuer={issuerDetailsMap[selectedIssuers[rfpToIssue.id]] || { name: selectedIssuers[rfpToIssue.id] }}
                    onClose={() => setRfpToIssue(null)}
                    onConfirm={handleConfirmIssue}
                    isProcessing={processingIssue}
                />
            )}

            {selectedRfpForUpdate && <UpdateRFPModal isOpen={true} onClose={() => setSelectedRfpForUpdate(null)} rfp={selectedRfpForUpdate} />}
            {showManualCreate && <CreateManualRFPModal isOpen={true} onClose={() => setShowManualCreate(false)} />}

            {finalizedRfpForPrint && (
                <div id="hidden-rfp-preview" className="hidden">
                    <DocumentTemplate data={finalizedRfpForPrint} type="RFP" />
                </div>
            )}
        </div>
    );
};

export default PendingRFPs;