// Root: src/modules/billing/CreateRFPModal.jsx
// Version: 5.11 - Fixed Override Amount Propagation
import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '/src/firebase.js';
import Modal from '/src/components/Modal.jsx';
import { ArchiveBoxArrowDownIcon, CalendarDaysIcon, ExclamationTriangleIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

const CreateRFPModal = ({ show, onClose, onSuccess, preSelectedItems, projectsMap }) => {
    // Determine the Project ID from passed items
    const selectedProject = preSelectedItems && preSelectedItems.length > 0 ? preSelectedItems[0].project : null;

    const [mode, setMode] = useState('create');
    const [recipient, setRecipient] = useState('');
    const [recipientAddress, setRecipientAddress] = useState('');
    const [recipientVat, setRecipientVat] = useState('');
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [projectTitle, setProjectTitle] = useState('');
    const [timeProfitMargin, setTimeProfitMargin] = useState(20);
    const [overrideAmount, setOverrideAmount] = useState('');
    const [projectCosts, setProjectCosts] = useState([]);
    const [selectedCosts, setSelectedCosts] = useState([]);
    const [nonChargeableIds, setNonChargeableIds] = useState(new Set());
    const [hiddenCostIds, setHiddenCostIds] = useState(new Set());
    const [costManagementFees, setCostManagementFees] = useState({});
    const [baseTimeCost, setBaseTimeCost] = useState(0);
    const [baseExpenseCost, setBaseExpenseCost] = useState(0);

    // NEW STATE: Toggle VAT specifically on Professional Fees
    const [feeVatApplicable, setFeeVatApplicable] = useState(true);

    const [cleanupDate, setCleanupDate] = useState(new Date().toISOString().split('T')[0]);
    const [cleanupLoading, setCleanupLoading] = useState(false);

    useEffect(() => {
        if (show && selectedProject) {
            const timeTotal = (preSelectedItems || []).reduce((sum, e) => sum + (e.calculatedCost || parseFloat(e.cost) || 0), 0);
            setBaseTimeCost(timeTotal);

            const loadData = async () => {
                try {
                    const rawInput = String(selectedProject);
                    const trimmed = rawInput.trim();
                    const padded = trimmed.padStart(4, '0');
                    const numValue = parseInt(trimmed, 10);
                    const stringNum = numValue.toString();

                    const variations = Array.from(new Set([selectedProject, trimmed, padded, numValue, stringNum])).filter(v => v !== undefined && v !== null && v !== "");

                    const costQ = query(collection(db, 'project_costs'), where('projectNumber', 'in', variations), where('billingStatus', '==', 'unbilled'));
                    const costSnap = await getDocs(costQ);
                    const costs = costSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                    setProjectCosts(costs);

                    const allCostIds = costs.map(c => c.id);
                    setSelectedCosts(allCostIds);
                    setNonChargeableIds(new Set());
                    setHiddenCostIds(new Set());
                    const initialFees = {};
                    costs.forEach(c => initialFees[c.id] = 10);
                    setCostManagementFees(initialFees);

                    const projQ = query(collection(db, 'projects'), where('projectNumber', 'in', variations));
                    const projSnap = await getDocs(projQ);

                    if (!projSnap.empty) {
                        const projData = projSnap.docs[0].data();
                        setProjectTitle(projData.projectDescription || '');
                        setDescription(projData.projectDescription || `Professional Services for Project ${selectedProject}`);

                        if (projData.clientNumber) {
                            const clientRaw = String(projData.clientNumber);
                            const clientVars = [clientRaw, parseInt(clientRaw, 10), clientRaw.padStart(4, '0')];
                            const clientQ = query(collection(db, 'clients'), where('clientNumber', 'in', clientVars));
                            const clientSnap = await getDocs(clientQ);
                            if (!clientSnap.empty) {
                                const clientData = clientSnap.docs[0].data();
                                setRecipient(clientData.companyName || `${clientData.name} ${clientData.surname}`);
                                const addrParts = [clientData.address, clientData.locality, clientData.postCode, clientData.country].filter(Boolean).join(',\n');
                                setRecipientAddress(addrParts);
                                setRecipientVat(clientData.vatNumber || '');
                            }
                        }
                    } else {
                        setDescription(`Professional Services for Project ${selectedProject}`);
                    }

                } catch (e) {
                    console.error("Error loading RFP data:", e);
                }
            };
            loadData();
            setTimeProfitMargin(20);
            setOverrideAmount('');
            setFeeVatApplicable(true); // Reset toggle
            setMode('create'); 
        }
    }, [show, selectedProject, preSelectedItems]);

    const totalManagementFee = projectCosts
        .filter(c => selectedCosts.includes(c.id))
        .reduce((sum, c) => {
            const cost = parseFloat(c.amount) || 0;
            const margin = parseFloat(costManagementFees[c.id] || 0);
            return sum + (cost * (margin / 100));
        }, 0);

    useEffect(() => {
        const selectedCostItems = projectCosts.filter(c => selectedCosts.includes(c.id));
        const currentExpenseBase = selectedCostItems.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
        setBaseExpenseCost(currentExpenseBase);
        const timeComponent = baseTimeCost * (1 + (timeProfitMargin / 100));
        const totalNet = timeComponent + currentExpenseBase + totalManagementFee;

        if (overrideAmount !== '' && !isNaN(parseFloat(overrideAmount))) {
            setAmount(parseFloat(overrideAmount));
        } else {
            setAmount(totalNet);
        }
    }, [baseTimeCost, projectCosts, selectedCosts, timeProfitMargin, costManagementFees, overrideAmount, totalManagementFee]);

    const toggleInc = (costId) => {
        if (selectedCosts.includes(costId)) {
            setSelectedCosts(prev => prev.filter(id => id !== costId));
            setHiddenCostIds(prev => { const n = new Set(prev); n.delete(costId); return n; });
        } else {
            setSelectedCosts(prev => [...prev, costId]);
            setNonChargeableIds(prev => { const next = new Set(prev); next.delete(costId); return next; });
        }
    };

    const toggleChargeable = (costId) => {
        setNonChargeableIds(prev => {
            const next = new Set(prev);
            if (next.has(costId)) {
                next.delete(costId);
            } else {
                next.add(costId);
                setSelectedCosts(sel => { const n = new Set(sel); n.delete(costId); return n; });
                setHiddenCostIds(prev => { const n = new Set(prev); n.delete(costId); return n; });
            }
            return next;
        });
    };

    const toggleVisibility = (costId) => {
        setHiddenCostIds(prev => {
            const next = new Set(prev);
            if (next.has(costId)) next.delete(costId); else next.add(costId);
            return next;
        });
    };

    const handleFeeChange = (costId, val) => { setCostManagementFees(prev => ({ ...prev, [costId]: parseFloat(val) || 0 })); };

    const handleCreate = async (e) => {
        e.preventDefault();
        setLoading(true);
        const costsToWriteOff = Array.from(nonChargeableIds);
        const feesToSave = {};
        selectedCosts.forEach(id => { feesToSave[id] = costManagementFees[id] || 0; });
        const hiddenList = Array.from(hiddenCostIds);

        // Fix extraction of Timesheet IDs so they don't break backend items payload mapping
        const timeItemsIds = (preSelectedItems || [])
            .filter(e => !e.isCost)
            .map(e => e.id);

        // BUILD ITEMIZED ARRAY TO SAVE TO DB
        const itemsToSave = [];
        let hiddenCostsSum = 0;
        const visibleCosts = [];

        projectCosts.forEach(c => {
            if (selectedCosts.includes(c.id)) {
                if (hiddenCostIds.has(c.id)) hiddenCostsSum += parseFloat(c.amount) || 0;
                else visibleCosts.push(c);
            }
        });

        const pureFeeAmount = baseTimeCost * (1 + (timeProfitMargin / 100)) + totalManagementFee; 
        let displayFeeAmount = pureFeeAmount + hiddenCostsSum;
        
        // ---> APPLY OVERRIDE LOGIC HERE <---
        if (overrideAmount !== '' && !isNaN(parseFloat(overrideAmount))) {
            const visibleCostsSum = visibleCosts.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
            // Ensure fee absorbs the override amount properly
            displayFeeAmount = Math.max(0, parseFloat(overrideAmount) - visibleCostsSum);
        }
        
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
                projectNumber: selectedProject, 
                recipient, 
                recipientAddress, 
                recipientVat, 
                description, 
                isIndependent: false,
                items: itemsToSave, 
                timeIds: timeItemsIds, 
                costIds: selectedCosts, 
                writeOffCostIds: costsToWriteOff, 
                costManagementFees: feesToSave,
                hiddenCostIds: hiddenList 
            });
            if (onSuccess) onSuccess(selectedProject); else onClose();
        } catch (error) {
            console.error(error);
            alert("Failed to create RFP: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCleanup = async () => {
        if (!window.confirm(`Are you sure you want to mark ALL entries before ${cleanupDate} as billed? This action cannot be undone.`)) return;
        setCleanupLoading(true);
        try {
            const cleanupFn = httpsCallable(functions, 'bulkArchiveEntries');
            const result = await cleanupFn({
                projectNumber: selectedProject,
                cutoffDate: cleanupDate
            });
            alert(result.data.message);
            if (onSuccess) onSuccess(selectedProject); else onClose();
        } catch (error) {
            console.error(error);
            alert("Cleanup failed: " + error.message);
        } finally {
            setCleanupLoading(false);
        }
    };

    if (!show) return null;

    const calculatedTimeTotal = baseTimeCost * (1 + (timeProfitMargin / 100));
    const displayTimeAndFees = calculatedTimeTotal + totalManagementFee;
    const isOverridden = overrideAmount !== '' && !isNaN(parseFloat(overrideAmount));

    return (
        <Modal show={show} onClose={onClose} title={`Manage Project ${selectedProject}`} maxWidth="sm:max-w-6xl">
            <div className="flex border-b border-gray-200 mb-6">
                <button
                    onClick={() => setMode('create')}
                    className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors ${mode === 'create' ? 'border-orange-600 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    Create RFP
                </button>
                <button
                    onClick={() => setMode('cleanup')}
                    className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors flex items-center ${mode === 'cleanup' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    <ArchiveBoxArrowDownIcon className="h-4 w-4 mr-2" /> Clean Up History
                </button>
            </div>

            {mode === 'cleanup' ? (
                <div className="space-y-6 p-4 bg-red-50 rounded-lg border border-red-100">
                    <div className="flex items-start">
                        <ExclamationTriangleIcon className="h-6 w-6 text-red-600 mr-3 flex-shrink-0 mt-1" />
                        <div>
                            <h3 className="text-lg font-bold text-red-800">Bulk Archive Historical Entries</h3>
                            <p className="text-sm text-red-700 mt-1">
                                Use this tool to remove old unbilled hours from your dashboard without generating an invoice.
                                This is useful for "catching up" after importing historical data.
                            </p>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded border border-red-200 shadow-sm">
                        <label className="block text-sm font-bold text-gray-700 mb-2">Archive entries dated on or before:</label>
                        <div className="flex items-center gap-4">
                            <div className="relative flex-1 max-w-xs">
                                <CalendarDaysIcon className="h-5 w-5 absolute left-3 top-2.5 text-gray-400" />
                                <input
                                    type="date"
                                    value={cleanupDate}
                                    onChange={(e) => setCleanupDate(e.target.value)}
                                    className="pl-10 w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500"
                                />
                            </div>
                            <button
                                onClick={handleCleanup}
                                disabled={cleanupLoading}
                                className="px-6 py-2 bg-red-600 text-white font-bold rounded-md hover:bg-red-700 shadow-md flex items-center disabled:opacity-50"
                            >
                                {cleanupLoading ? 'Archiving...' : 'Archive Entries'}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-3 italic">
                            * This will mark all timesheets and expenses for Project {selectedProject} before {cleanupDate} as 'Billed'.
                        </p>
                    </div>
                </div>
            ) : (
                <form onSubmit={handleCreate} className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-1">
                            <label className="block text-xs font-bold text-gray-500 uppercase">Project</label>
                            <div className="flex items-center gap-2">
                                <input type="text" className="w-20 p-2 border rounded bg-gray-100 text-sm text-gray-700 font-mono text-center" value={selectedProject} disabled />
                                <input type="text" className="flex-1 p-2 border rounded bg-gray-100 text-sm text-gray-700" value={projectTitle} disabled placeholder="Project Title" />
                            </div>
                        </div>
                        <div className="col-span-1">
                            <label className="block text-xs font-bold text-gray-500 uppercase">Recipient (Client)</label>
                            <input type="text" className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-orange-500 focus:border-orange-500" value={recipient} onChange={e => setRecipient(e.target.value)} required />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-gray-700">Recipient Address</label>
                            <textarea className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-orange-500 focus:border-orange-500" rows="2" value={recipientAddress} onChange={e => setRecipientAddress(e.target.value)} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Recipient VAT No.</label>
                            <input type="text" className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-orange-500 focus:border-orange-500" value={recipientVat} onChange={e => setRecipientVat(e.target.value)} />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase">Description</label>
                        <textarea className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-orange-500 focus:border-orange-500" rows="2" value={description} onChange={e => setDescription(e.target.value)} required />
                    </div>

                    <div className={`bg-gray-50 p-4 rounded-lg border transition-colors ${isOverridden ? 'border-orange-300 ring-1 ring-orange-200' : 'border-gray-200'}`}>
                        <div className={`flex items-center justify-between transition-opacity ${isOverridden ? 'opacity-50' : 'opacity-100'}`}>
                            <div className="flex-1">
                                <span className="text-sm font-medium text-gray-700">Fees (Time + Mgmt Fees)</span>
                                <div className="text-xs text-gray-500">Base Time: €{baseTimeCost.toFixed(2)} + Mgmt Fees: €{totalManagementFee.toFixed(2)}</div>
                            </div>
                            <div className="flex items-center gap-4">
                                <label className="flex items-center cursor-pointer text-xs font-bold text-gray-600 bg-white border border-gray-300 rounded px-2 py-1 shadow-sm">
                                    <input 
                                        type="checkbox" 
                                        className="h-3 w-3 mr-1.5 rounded text-orange-600 focus:ring-orange-500"
                                        checked={feeVatApplicable}
                                        onChange={(e) => setFeeVatApplicable(e.target.checked)}
                                        disabled={isOverridden}
                                    />
                                    VAT App. (18%)
                                </label>
                                <div className="flex items-center bg-white border border-gray-300 rounded px-2 py-1">
                                    <span className="text-xs text-gray-500 mr-1">Time Margin:</span>
                                    <input type="number" className="w-10 text-right text-sm font-bold text-orange-600 focus:outline-none" value={timeProfitMargin} onChange={e => setTimeProfitMargin(parseFloat(e.target.value) || 0)} disabled={isOverridden} />
                                    <span className="text-xs text-gray-500 ml-1">%</span>
                                </div>
                                <div className="w-20 text-right font-mono font-bold text-gray-800">€{displayTimeAndFees.toFixed(2)}</div>
                            </div>
                        </div>

                        <div className={`border-t border-gray-200 pt-3 mt-3 transition-opacity ${isOverridden ? 'opacity-50' : 'opacity-100'}`}>
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex-1">
                                    <span className="text-sm font-medium text-gray-700">Expenses (Reimbursement Only)</span>
                                    <div className="text-xs text-gray-500">Raw Cost</div>
                                </div>
                                <div className="w-20 text-right font-mono font-bold text-gray-800">€{baseExpenseCost.toFixed(2)}</div>
                            </div>

                            {projectCosts.length > 0 ? (
                                <div className="bg-white border border-gray-200 rounded max-h-64 overflow-y-auto p-0 text-xs shadow-inner">
                                    <table className="w-full text-left">
                                        <thead className="bg-gray-100 text-gray-600 font-bold sticky top-0 z-10">
                                            <tr>
                                                <th className="p-2 w-10 text-center" title="Include?">Inc</th>
                                                <th className="p-2 w-10 text-center" title="Chargeable?">Chg</th>
                                                <th className="p-2 w-10 text-center" title="Visible in RFP?">Vis</th>
                                                <th className="p-2">Description</th>
                                                <th className="p-2 text-right">Cost</th>
                                                <th className="p-2 w-20 text-center">Mgmt %</th>
                                                <th className="p-2 text-right">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {projectCosts.map(cost => {
                                                const isInc = selectedCosts.includes(cost.id);
                                                const isChargeable = !nonChargeableIds.has(cost.id);
                                                const isVisible = !hiddenCostIds.has(cost.id);
                                                const rowClass = !isChargeable ? 'bg-red-50 text-red-700' : 'hover:bg-gray-50';
                                                const costVal = parseFloat(cost.amount) || 0;
                                                const feePct = costManagementFees[cost.id] || 0;
                                                const itemTotalWorth = costVal * (1 + feePct / 100);

                                                return (
                                                    <tr key={cost.id} className={`border-t border-gray-100 transition-colors ${rowClass}`}>
                                                        <td className="p-2 text-center"><input type="checkbox" checked={isInc} onChange={() => toggleInc(cost.id)} className="h-4 w-4 text-green-600 rounded cursor-pointer" /></td>
                                                        <td className="p-2 text-center"><input type="checkbox" checked={isChargeable} onChange={() => toggleChargeable(cost.id)} disabled={isInc} className={`h-4 w-4 rounded cursor-pointer ${isInc ? 'text-gray-400 bg-gray-200' : 'text-blue-600'}`} /></td>
                                                        <td className="p-2 text-center">
                                                            <input
                                                                type="checkbox"
                                                                checked={isVisible}
                                                                onChange={() => toggleVisibility(cost.id)}
                                                                disabled={!isInc || !isChargeable}
                                                                className={`h-4 w-4 rounded cursor-pointer ${(isInc && isChargeable) ? 'text-purple-600' : 'text-gray-300 bg-gray-100'}`}
                                                                title="Uncheck to hide line item from RFP (value remains in total)"
                                                            />
                                                        </td>
                                                        <td className="p-2 truncate max-w-[200px]" title={cost.description}>
                                                            <div className="flex items-center">
                                                                {!isVisible && isInc && <EyeSlashIcon className="h-3 w-3 mr-1 text-purple-500" />}
                                                                <span className="font-bold mr-1">{cost.type}:</span>{cost.description}
                                                            </div>
                                                        </td>
                                                        <td className="p-2 text-right font-mono">€{costVal.toFixed(2)}</td>
                                                        <td className="p-2 text-center"><input type="number" className="w-12 p-1 text-center border rounded text-xs" value={feePct} onChange={(e) => handleFeeChange(cost.id, e.target.value)} disabled={!isInc || isOverridden} /></td>
                                                        <td className="p-2 text-right font-mono font-bold text-gray-500">€{itemTotalWorth.toFixed(2)}<div className="text-[9px] text-orange-600 font-normal">(Fee: €{(itemTotalWorth - costVal).toFixed(2)})</div></td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            ) : <div className="text-xs text-gray-400 italic pl-1">No unbilled expenses recorded.</div>}
                        </div>

                        <div className="border-t border-gray-300 pt-3 mt-3">
                            <div className="flex justify-between items-center mb-2">
                                <label className="block text-xs font-bold text-orange-600 uppercase">Override Total Net</label>
                                {isOverridden && <span className="text-xs text-orange-700 font-medium bg-orange-100 px-2 py-0.5 rounded">Manual Override Active</span>}
                            </div>
                            <input type="number" step="0.01" placeholder="Enter amount to override..." className="w-full p-2 border border-orange-200 rounded text-sm focus:ring-orange-500 focus:border-orange-500 bg-white" value={overrideAmount} onChange={e => setOverrideAmount(e.target.value)} />
                        </div>

                        <div className="border-t-2 border-gray-200 pt-3 mt-3 space-y-1">
                            <div className="flex justify-between text-base font-bold text-gray-900 pt-1">
                                <span>Total Amount (Excl. VAT):</span>
                                <span className="font-mono text-xl">€{amount.toFixed(2)}</span>
                            </div>
                            <p className="text-[10px] text-gray-400 text-right">VAT status determined upon issuing.</p>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button type="button" onClick={onClose} className="mr-3 px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500" disabled={loading}>
                            Cancel
                        </button>
                        <button type="submit" className="inline-flex justify-center px-6 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50" disabled={loading}>
                            {loading ? 'Processing...' : 'Generate RFP'}
                        </button>
                    </div>
                </form>
            )}
        </Modal>
    );
};

export default CreateRFPModal;