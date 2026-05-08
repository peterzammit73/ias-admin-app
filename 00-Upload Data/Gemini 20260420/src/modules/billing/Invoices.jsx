// Root: src/modules/billing/Invoices.jsx
// Version: 17.14 - Fixed import path resolution
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    collection,
    query,
    orderBy,
    onSnapshot,
    doc,
    getDoc,
    getDocs,
    where,
    limit,
    updateDoc,
    writeBatch
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
    CheckBadgeIcon,
    BanknotesIcon,
    MagnifyingGlassIcon,
    CalculatorIcon,
    ArrowPathIcon,
    XCircleIcon,
    PrinterIcon,
    DocumentDuplicateIcon,
    ArrowPathRoundedSquareIcon,
    ChevronDownIcon,
    FunnelIcon,
    CheckIcon,
    ChevronUpIcon,
    ArrowDownTrayIcon,
    BellIcon,
    ArchiveBoxIcon,
    ClockIcon,
    CloudIcon,
    FolderOpenIcon,
    DocumentTextIcon,
    LockClosedIcon
} from '@heroicons/react/24/outline';

import { db, functions } from '/src/firebase.js';
import ProjectCostAuditModal from '/src/modules/billing/ProjectCostAuditModal.jsx';
import Modal from '/src/components/Modal.jsx';
import DocumentTemplate from '/src/modules/billing/DocumentTemplate.jsx';
import UpdateRFPModal from '/src/modules/billing/UpdateRFPModal.jsx';

const DocumentsModal = ({ rfp, onClose }) => {
    const [selectedDocKey, setSelectedDocKey] = useState(null);
    const [rfpChain, setRfpChain] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [masterIssuers, setMasterIssuers] = useState([]);
    const [addressChecking, setAddressChecking] = useState(false);

    useEffect(() => {
        const fetchIssuers = async () => {
            try {
                const snap = await getDoc(doc(db, 'settings', 'rfp_issuers'));
                if (snap.exists()) setMasterIssuers(snap.data().issuers || []);
            } catch (err) { console.error("Error loading issuers:", err); }
        };
        fetchIssuers();
    }, []);

    useEffect(() => {
        const fetchChain = async () => {
            if (!rfp) { setLoadingHistory(false); return; }
            setLoadingHistory(true);
            try {
                if (rfp.status === 'Pending' || !rfp.rfpCode) {
                    setRfpChain([{ id: rfp.id, ...rfp, rfpNumber: rfp.rfpNumber || rfp.rfpCode || `PENDING-${rfp.projectNumber}`, createdAtObj: rfp.createdAt?.toDate ? rfp.createdAt.toDate() : new Date(rfp.createdAt || Date.now()) }]);
                    setLoadingHistory(false);
                    return;
                }
                const currentCode = rfp.rfpCode;
                const baseCode = currentCode.replace(/-R\d+$/, '');
                const q = query(collection(db, 'rfps'), where('projectNumber', '==', String(rfp.projectNumber)));
                const snap = await getDocs(q);
                const chain = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(item => (item.rfpCode || '').startsWith(baseCode)).map(item => ({ ...item, createdAtObj: item.createdAt?.toDate ? item.createdAt.toDate() : new Date(item.createdAt || Date.now()), issuedAtObj: item.issuedAt?.toDate ? item.issuedAt.toDate() : null })).sort((a, b) => (a.issuedAtObj || a.createdAtObj) - (b.issuedAtObj || b.createdAtObj));
                setRfpChain(chain.length > 0 ? chain : [rfp]);
            } catch (e) { console.error(e); setRfpChain([{ ...rfp, rfpNumber: rfp.rfpCode }]); } finally { setLoadingHistory(false); }
        };
        fetchChain();
    }, [rfp]);

    // AUTO-FILL LEGACY ADDRESS LOGIC
    useEffect(() => {
        const checkAddress = async () => {
            if (loadingHistory || rfpChain.length === 0) return;

            const currentRfp = rfpChain.find(r => r.status !== 'Superseded') || rfpChain[rfpChain.length - 1];

            if (!currentRfp.recipientAddress && !currentRfp._addressChecked) {
                setAddressChecking(true);
                try {
                    const q = query(collection(db, 'clients'));
                    const snap = await getDocs(q);
                    const clientsList = snap.docs.map(d => d.data());
                    const getClientName = (c) => c.companyName || `${c.name} ${c.surname}`;

                    let matchedClient = clientsList.find(c => getClientName(c) === currentRfp.recipient);

                    if (!matchedClient && currentRfp.projectNumber) {
                        const projSnap = await getDocs(query(collection(db, 'projects'), where('projectNumber', '==', String(currentRfp.projectNumber))));
                        if (!projSnap.empty) {
                            const pData = projSnap.docs[0].data();
                            if (pData.clientNumber) {
                                matchedClient = clientsList.find(c => String(c.clientNumber) === String(pData.clientNumber));
                            }
                        }
                    }

                    if (matchedClient && (matchedClient.address || matchedClient.locality)) {
                        const addr = [matchedClient.address, matchedClient.locality, matchedClient.postCode, matchedClient.country].filter(Boolean).join(',\n');
                        const vat = matchedClient.vatNumber || currentRfp.recipientVat || '';

                        await updateDoc(doc(db, 'rfps', currentRfp.id), {
                            recipientAddress: addr,
                            recipientVat: vat
                        });

                        setRfpChain(prev => prev.map(item => item.id === currentRfp.id ? { ...item, recipientAddress: addr, recipientVat: vat, _addressChecked: true } : item));
                    } else {
                        alert(`Notice: Address for "${currentRfp.recipient}" is missing and couldn't be auto-filled from the Client list. The document will not show an address.`);
                        setRfpChain(prev => prev.map(item => item.id === currentRfp.id ? { ...item, _addressChecked: true } : item));
                    }
                } catch (e) {
                    console.error("Address auto-fill failed", e);
                }
                setAddressChecking(false);
            }
        };
        checkAddress();
    }, [loadingHistory, rfpChain]);

    const documents = useMemo(() => {
        if (loadingHistory) return [];
        const list = [];
        const getDate = (val) => val?.toDate ? val.toDate() : (val?.seconds ? new Date(val.seconds * 1000) : new Date(val || Date.now()));
        const formatDate = (dateObj) => dateObj?.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) || 'N/A';

        const resolveIssuer = (item) => {
            let term = String(item.issuer || '').trim();

            if (!term && item.rfpCode) {
                const parts = item.rfpCode.split('-');
                if (parts.length >= 3) {
                    const last = parts[parts.length - 1];
                    if (/^R\d+$/i.test(last) && parts.length >= 4) {
                        term = parts[parts.length - 2];
                    } else {
                        term = last;
                    }
                    term = term.replace(/-R\d+$/i, '');
                }
            }

            term = term.trim();
            let found = null;

            if (!term.includes('/')) {
                const legacyDefault = `${term}/01`;
                found = masterIssuers.find(i => i.name === legacyDefault);
                if (!found) {
                    found = masterIssuers.find(i => i.name === `${term}/00`);
                }
            }

            if (!found) {
                found = masterIssuers.find(i => i.name === term);
            }

            if (!found) {
                found = masterIssuers.find(i =>
                    String(i.name || '').toLowerCase() === term.toLowerCase() ||
                    String(i.displayName || '').toLowerCase() === term.toLowerCase() ||
                    (Array.isArray(i.aliases) && i.aliases.some(alias => String(alias).toLowerCase() === term.toLowerCase()))
                );
            }

            return found ? { ...item, issuerDetails: found, issuer: found.name } : item;
        };

        rfpChain.forEach(rawItem => {
            const item = resolveIssuer(rawItem);
            const dateObj = getDate(item.issuedAt || item.createdAt);
            const isSuperseded = item.status === 'Superseded';
            const labelSuffix = isSuperseded ? ' (Superseded)' : item.status === 'Issued - Open' || item.status === 'Paid' ? ' (Active)' : '';
            list.push({ uniqueKey: `RFP_${item.id}`, label: `[${formatDate(dateObj)}] RFP: ${item.rfpCode || 'PENDING'}${labelSuffix}`, type: 'RFP', data: item, dateObj, isSuperseded, styleClass: isSuperseded ? 'bg-gray-50 text-gray-500 border-gray-200' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' });
        });

        const activeRfpRaw = rfpChain.find(r => r.status !== 'Superseded') || rfpChain[rfpChain.length - 1];
        const currentRfp = resolveIssuer(activeRfpRaw);

        if ((currentRfp.status === 'Closed' || currentRfp.status === 'Paid') && (!currentRfp.payments || Object.keys(currentRfp.payments).length === 0)) {
            const dateObj = getDate(currentRfp.paidAt || currentRfp.issuedAt);
            list.push({ uniqueKey: 'INVOICE_MAIN', label: `[${formatDate(dateObj)}] Final Tax Invoice`, type: 'INVOICE', data: currentRfp, dateObj, styleClass: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' });
        }
        if (currentRfp.payments) {
            Object.entries(currentRfp.payments).forEach(([key, p]) => {
                const dateObj = getDate(p.date);
                list.push({ uniqueKey: `PARTIAL_${key}`, label: `[${formatDate(dateObj)}] Invoice ${key} (€${p.amount.toLocaleString()})`, type: 'PARTIAL', data: currentRfp, subData: { ...p, ref: key }, dateObj, styleClass: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' });
            });
        }
        if (currentRfp.credits) {
            Object.entries(currentRfp.credits).forEach(([key, c]) => {
                const dateObj = getDate(c.date);
                list.push({ uniqueKey: `CREDIT_${key}`, label: `[${formatDate(dateObj)}] Credit Note ${key} (€${c.amount.toLocaleString()})`, type: 'CREDIT_NOTE', data: currentRfp, subData: { ...c, ref: key }, dateObj, styleClass: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' });
            });
        }
        if (currentRfp.reminders) {
            Object.entries(currentRfp.reminders).forEach(([key, r]) => {
                const dateObj = getDate(r.date);
                list.push({ uniqueKey: `REMINDER_${key}`, label: `[${formatDate(dateObj)}] Reminder ${r.sequence ? '#' + r.sequence : ''}`, type: 'REMINDER', data: currentRfp, subData: { ...r, ref: key }, dateObj, styleClass: 'bg-yellow-50 text-yellow-800 border-yellow-200 hover:bg-yellow-100' });
            });
        }
        return list.sort((a, b) => b.dateObj - a.dateObj);
    }, [rfpChain, loadingHistory, masterIssuers]);

    const selectedDoc = documents.find(d => d.uniqueKey === selectedDocKey) || documents[0];
    const handlePrint = () => {
        const printContent = document.getElementById('doc-print-area');
        const printWindow = window.open('', '_blank', 'height=1123,width=794');
        if (printWindow && printContent) {
            printWindow.document.write('<html><head><title>Print</title><script src="https://cdn.tailwindcss.com"></script></head><body>' + printContent.outerHTML + '</body></html>');
            printWindow.document.close();
            setTimeout(() => { printWindow.focus(); printWindow.print(); }, 800);
        }
    };

    return (
        <Modal show={true} onClose={onClose} title={`Documents: RFP ${rfp.rfpCode || rfp.projectNumber}`} maxWidth="sm:max-w-6xl">
            <div className="flex flex-col md:flex-row h-[75vh] font-sans text-black">
                <div className="w-full md:w-1/3 border-r pr-4 overflow-y-auto space-y-2 bg-white p-2">
                    <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">Timeline (Newest First)</h3>
                    {addressChecking && <div className="text-xs text-orange-600 mb-2 font-bold animate-pulse">Auto-fetching missing recipient address...</div>}
                    {documents.map((d) => (
                        <button key={d.uniqueKey} onClick={() => setSelectedDocKey(d.uniqueKey)} className={`w-full text-left px-3 py-3 text-xs rounded border transition-all font-medium ${selectedDocKey === d.uniqueKey ? 'ring-2 ring-orange-500 ring-offset-1 z-10 ' + d.styleClass : d.styleClass} ${d.isSuperseded ? 'opacity-70 italic' : ''}`}>{d.label}</button>
                    ))}
                </div>
                <div className="w-full md:w-2/3 pl-0 md:pl-4 flex flex-col">
                    {selectedDoc ? (
                        <>
                            <div className="flex justify-end mb-2">
                                {selectedDoc.isSuperseded && <span className="mr-auto text-xs text-red-500 font-bold uppercase tracking-wider py-1">Superseded Version</span>}
                                <button onClick={handlePrint} className="flex items-center px-3 py-1 bg-gray-800 text-white text-sm rounded hover:bg-black font-medium shadow-sm transition-colors"><PrinterIcon className="h-4 w-4 mr-2" /> Print PDF</button>
                            </div>
                            <div className="flex-1 bg-gray-100 border rounded overflow-auto p-4 flex justify-center items-start shadow-inner">
                                <div className="transform scale-[0.6] lg:scale-[0.75] origin-top"><DocumentTemplate data={selectedDoc.data} type={selectedDoc.type} subData={selectedDoc.subData} /></div>
                            </div>
                        </>
                    ) : <div className="m-auto text-gray-400 text-sm italic">Select a document</div>}
                </div>
            </div>
        </Modal>
    );
};

// ... PaymentActionModal ...
const PaymentActionModal = ({ actionData, onClose, onSuccess }) => {
    const { type, rfp } = actionData;
    const [amount, setAmount] = useState(rfp?.remaining.toFixed(2) || '');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [processing, setProcessing] = useState(false);
    const [releaseItems, setReleaseItems] = useState(false);
    const [addressChecking, setAddressChecking] = useState(false);
    const [isSettleRemaining, setIsSettleRemaining] = useState(false);

    // AUTO-FILL LEGACY ADDRESS LOGIC
    useEffect(() => {
        const checkAddress = async () => {
            if (rfp && !rfp.recipientAddress) {
                setAddressChecking(true);
                try {
                    const q = query(collection(db, 'clients'));
                    const snap = await getDocs(q);
                    const clientsList = snap.docs.map(d => d.data());
                    const getClientName = (c) => c.companyName || `${c.name} ${c.surname}`;

                    let matchedClient = clientsList.find(c => getClientName(c) === rfp.recipient);

                    if (!matchedClient && rfp.projectNumber) {
                        const projSnap = await getDocs(query(collection(db, 'projects'), where('projectNumber', '==', String(rfp.projectNumber))));
                        if (!projSnap.empty) {
                            const pData = projSnap.docs[0].data();
                            if (pData.clientNumber) {
                                matchedClient = clientsList.find(c => String(c.clientNumber) === String(pData.clientNumber));
                            }
                        }
                    }

                    if (matchedClient && (matchedClient.address || matchedClient.locality)) {
                        const addr = [matchedClient.address, matchedClient.locality, matchedClient.postCode, matchedClient.country].filter(Boolean).join(',\n');
                        const vat = matchedClient.vatNumber || rfp.recipientVat || '';

                        await updateDoc(doc(db, 'rfps', rfp.id), {
                            recipientAddress: addr,
                            recipientVat: vat
                        });

                        rfp.recipientAddress = addr;
                        rfp.recipientVat = vat;
                    } else {
                        alert(`Notice: Address for "${rfp.recipient}" is missing and couldn't be auto-filled from the Client list. The generated document will not have an address.`);
                    }
                } catch (e) {
                    console.error("Address auto-fill failed", e);
                }
                setAddressChecking(false);
            }
        };
        checkAddress();
    }, [rfp]);

    useEffect(() => {
        if (isSettleRemaining && rfp) {
            setAmount(rfp.remaining.toFixed(2));
        }
    }, [isSettleRemaining, rfp]);

    const isAlreadyPartial = rfp.invoiced > 0 || rfp.status === 'Partial';
    const showFullToggle = type === 'partial' && isAlreadyPartial;

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (type === 'partial') {
            const inputAmount = parseFloat(amount);
            const remaining = parseFloat(rfp.remaining);

            if (inputAmount > remaining + 0.01) {
                alert("The entered amount exceeds the outstanding balance.");
                return;
            }

            // Only block "Settle" redirection if this is the FIRST payment being made
            if (!isAlreadyPartial && inputAmount >= (remaining - 0.01)) {
                alert("The entered amount covers the entire outstanding balance. \n\nPlease cancel and use the 'Settle (Issue Invoice)' button instead to generate a Final Tax Invoice.");
                return;
            }
        }

        setProcessing(true);
        try {
            const actionName = type === 'full' ? 'full_payment' : type === 'partial' ? 'partial_payment' : type === 'reverse' ? 'partial_credit' : 'issue_reminder';
            const manageFn = httpsCallable(functions, 'managePayment');
            await manageFn({ action: actionName, rfpId: rfp.id, amount: (type === 'partial' || type === 'reverse') ? amount : null, date, releaseItems: type === 'reverse' && releaseItems });

            // AUTO-MARK AS PAID IF PARTIAL PAYMENT SETTLES THE ENTIRE REMAINING BALANCE
            if (type === 'partial') {
                const inputAmount = parseFloat(amount);
                const remaining = parseFloat(rfp.remaining);
                if (inputAmount >= remaining - 0.01) {
                    const rfpRef = doc(db, 'rfps', rfp.id);
                    await updateDoc(rfpRef, {
                        status: 'Paid',
                        paidAt: new Date(date || Date.now())
                    });
                }
            }

            onSuccess();
        } catch (e) {
            alert(e.message);
            setProcessing(false);
        }
    };

    const typeLabel = type === 'reminder' ? 'Payment Reminder' : type.toUpperCase();
    return (
        <Modal show={true} onClose={() => !processing && onClose()} title={`Manage Transaction: ${typeLabel}`}>
            <form onSubmit={handleSubmit} className="space-y-4 font-sans text-black">
                <div className={`p-3 rounded text-sm border ${type === 'reverse' ? 'bg-red-50 text-red-800 border-red-100' : 'bg-orange-50 text-orange-800 border-orange-100'}`}>Processing {typeLabel} for <strong>€{rfp.remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                {(type === 'partial' || type === 'reverse') && (
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                            Value (€) {type === 'partial' && <span className="text-orange-600 normal-case lowercase font-medium">(incl. VAT)</span>}
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            max={rfp.remaining}
                            required
                            className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-orange-500"
                            value={amount}
                            onChange={e => {
                                setAmount(e.target.value);
                                if (isSettleRemaining) setIsSettleRemaining(false);
                            }}
                        />
                        {showFullToggle && (
                            <label className="flex items-center gap-3 cursor-pointer bg-gray-50 p-3 rounded border border-gray-200 hover:bg-gray-100 mt-3 transition-colors">
                                <input
                                    type="checkbox"
                                    checked={isSettleRemaining}
                                    onChange={e => setIsSettleRemaining(e.target.checked)}
                                    className="h-5 w-5 rounded text-indigo-600 focus:ring-indigo-500"
                                />
                                <div className="flex flex-col">
                                    <span className="text-xs font-bold text-gray-900">Settle remaining balance</span>
                                    <span className="text-[10px] text-gray-500">Invoice the full remaining amount of €{rfp.remaining.toFixed(2)}</span>
                                </div>
                            </label>
                        )}
                    </div>
                )}
                {type === 'reverse' && (<label className="flex items-center gap-3 cursor-pointer bg-gray-50 p-3 rounded border border-gray-200 hover:bg-gray-100"><input type="checkbox" checked={releaseItems} onChange={e => setReleaseItems(e.target.checked)} className="h-5 w-5 rounded text-indigo-600" /><div className="flex flex-col"><span className="text-xs font-bold text-gray-900">Release items?</span><span className="text-[10px] text-gray-500">Unlinks original items so they appear in WIP again.</span></div></label>)}
                <div><label className="block text-xs font-bold text-gray-500 uppercase">Effective Date</label><input type="date" required className="mt-1 w-full border rounded p-2 text-sm" value={date} onChange={e => setDate(e.target.value)} /></div>

                <div className="flex justify-end pt-4 gap-2 border-t mt-6">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                    <button type="submit" disabled={processing || addressChecking} className="px-6 py-2 bg-orange-600 text-white rounded text-sm font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
                        {addressChecking ? 'Verifying Address...' : 'Confirm'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

// ... RfpRow ...
const RfpRow = React.memo(({ rfp, isSelected, onSelect }) => {
    // Calculated Values
    const displayVat = rfp.vatApplicable ? (rfp.amount * 0.18) : 0;

    // Ex VAT Values for Paid and Credited
    const paidExVat = rfp.vatApplicable && rfp.invoiced > 0 ? (rfp.invoiced / 1.18) : rfp.invoiced;
    const credExVat = rfp.vatApplicable && rfp.credited > 0 ? (rfp.credited / 1.18) : rfp.credited;

    const formattedDate = rfp.createdAt ? new Date(rfp.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A';

    return (
        <tr onClick={() => onSelect(rfp.id)} className={`cursor-pointer border-b border-gray-100 transition-colors text-sm ${isSelected ? 'bg-orange-50' : 'hover:bg-gray-50'} ${rfp.status === 'Superseded' ? 'opacity-40 grayscale line-through' : ''}`}>
            <td className="w-12 px-2 py-2 text-gray-900 border-r border-gray-100 text-center">{rfp.projectNumber}</td>
            <td className="w-16 px-2 py-2 font-mono text-orange-600 font-medium hidden sm:table-cell border-r border-gray-100">{rfp.rfpCode?.split('-')[0] || 'PENDING'}</td>
            <td className="w-14 px-2 py-2 text-gray-500 truncate hidden md:table-cell border-r border-gray-100 text-center" title={rfp.issuer}>{rfp.issuer}</td>
            <td className="w-24 px-2 py-2 text-gray-500 font-mono text-[11px] border-r border-gray-100 text-center">{formattedDate}</td>
            <td className="px-2 py-2 text-gray-800 max-w-[120px] truncate" title={rfp.recipient}>{rfp.recipient}</td>

            {/* WIDER COLUMNS */}
            {/* NET ex VAT */}
            <td className="w-28 px-2 py-2 text-right font-mono text-gray-600 border-l border-gray-100">€{rfp.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>

            {/* VAT */}
            <td className="w-24 px-2 py-2 text-right font-mono text-gray-400 border-l border-gray-100">€{displayVat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>

            {/* Paid ex VAT */}
            <td className="w-28 px-2 py-2 text-right font-mono text-green-700 bg-green-50/10 border-l border-gray-100">€{paidExVat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>

            {/* CR ex VAT */}
            <td className="w-24 px-2 py-2 text-right font-mono text-red-600 bg-red-50/10 border-l border-gray-100">{credExVat > 0 ? `-€${credExVat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}</td>

            {/* Due (Inc VAT) */}
            <td className={`w-32 px-2 py-2 text-right font-mono border-l border-gray-100 ${isSelected ? 'text-orange-900 font-medium' : 'text-orange-800 bg-orange-50/30'}`}>€{rfp.remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>

            <td className="w-12 px-2 py-2 text-center hidden sm:table-cell"><span className={`px-2 py-0.5 rounded text-[10px] font-normal uppercase border ${rfp.status === 'Paid' || rfp.status === 'Closed' ? 'bg-green-50 text-green-700 border-green-200' : rfp.status === 'Bad Debt' || rfp.status === 'Superseded' ? 'bg-gray-50 text-gray-500 border-gray-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{rfp.status.includes('Open') ? 'Open' : rfp.status}</span></td>
        </tr>
    );
});

const Invoices = () => {
    const [rfps, setRfps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'createdAt', direction: 'desc' });

    // TAB STATE: 'active' or 'archive'
    const [activeTab, setActiveTab] = useState('active');

    // Archive Filter State ('all', 'open', 'closed')
    const [archiveFilter, setArchiveFilter] = useState('all');

    // Deep Search State (Used now for Project Lookup in Archive)
    const [deepSearchResults, setDeepSearchResults] = useState([]);
    const [isDeepSearching, setIsDeepSearching] = useState(false);

    const [selectedRfpId, setSelectedRfpId] = useState(null);
    const [auditRfp, setAuditRfp] = useState(null);
    const [paymentAction, setPaymentAction] = useState(null);
    const [viewDocsRfp, setViewDocsRfp] = useState(null);
    const [reviseRfp, setReviseRfp] = useState(null);
    const [allProjects, setAllProjects] = useState([]); // List for dropdown

    // Fetch Project List for Dropdown
    useEffect(() => {
        const fetchProjects = async () => {
            try {
                // Fetch basic project info for dropdown
                const q = query(collection(db, 'projects'), orderBy('projectNumber', 'asc'));
                const snap = await getDocs(q);
                const projects = snap.docs.map(d => ({
                    number: d.data().projectNumber,
                    description: d.data().projectDescription,
                    id: d.id
                }));
                setAllProjects(projects);
            } catch (err) {
                console.error("Error loading projects list:", err);
            }
        };
        if (activeTab === 'archive') {
            fetchProjects();
        }
    }, [activeTab]);


    // --- MAIN FETCH LOGIC ---
    useEffect(() => {
        let q;

        // MODE 1: ARCHIVE (CLOSED)
        if (activeTab === 'archive') {
            const projectNumber = searchTerm.trim();

            // ARCHIVE ONLY LOADS IF A PROJECT IS SEARCHED
            if (!projectNumber || projectNumber.length < 3) {
                setRfps([]); // Empty state
                setLoading(false);
                return;
            }

            setLoading(true);
            // Fetch ALL history for this specific project WITHOUT ORDER BY
            q = query(collection(db, 'rfps'), where('projectNumber', '==', projectNumber));

        }
        // MODE 2: ACTIVE (OPEN)
        else {
            setLoading(true);

            // SEARCH OVERRIDE: If search term looks like an ID (starts with digit or has hyphen), search ALL statuses by RFP Code
            if (searchTerm && (searchTerm.includes('-') || /^\d/.test(searchTerm))) {
                // Search ALL RFPs (Active & Closed) by Code prefix
                q = query(collection(db, 'rfps'), where('rfpCode', '>=', searchTerm), where('rfpCode', '<=', searchTerm + '\uf8ff'), limit(20));
            } else {
                // Default: Show Only Active RFPs (Allows client-side filtering by name)
                q = query(
                    collection(db, 'rfps'),
                    where('status', 'not-in', ['Paid', 'Closed', 'Paid / Closed', 'Superseded', 'Bad Debt'])
                );
            }
        }

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const list = snapshot.docs.map(mapDocData);
            setRfps(list);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [activeTab, searchTerm]); // Re-run when Tab OR Search changes

    const mapDocData = (doc) => {
        const d = doc.data();
        const amt = parseFloat(d.amount) || 0;
        const vat = d.vatApplicable ? amt * 0.18 : 0;
        const total = amt + vat;
        let inv = parseFloat(d.invoicedAmount) || 0;
        if (inv === 0 && d.payments) inv = Object.values(d.payments).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
        let cred = parseFloat(d.creditedAmount) || 0;
        if (cred === 0 && d.credits) cred = Object.values(d.credits).reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);

        // Calculated Ex VAT Values
        const invExVat = d.vatApplicable && inv > 0 ? (inv / 1.18) : inv;
        const credExVat = d.vatApplicable && cred > 0 ? (cred / 1.18) : cred;

        return {
            id: doc.id,
            ...d,
            amount: amt,
            vat: vat,
            gross: total,
            invoiced: inv, // Gross Invoiced
            credited: cred, // Gross Credited
            invoicedExVat: invExVat,
            creditedExVat: credExVat,
            remaining: Math.max(0, total - inv - cred), // Gross Remaining
            createdAt: d.createdAt?.toDate ? d.createdAt.toDate().getTime() : (d.createdAt || 0)
        };
    };

    const selectedRfp = useMemo(() => rfps.find(r => r.id === selectedRfpId) || null, [rfps, selectedRfpId]);
    const handleSort = (key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));

    // --- CLIENT SIDE FILTERING ---
    const filteredRfps = useMemo(() => {
        const closedStatuses = ['paid', 'closed', 'superseded', 'bad debt'];
        const openStatuses = ['pending', 'issued - open', 'partial', 'open'];

        return rfps.filter(r => {
            const statusRaw = (r.status || '').toLowerCase();

            // Active Tab Logic: Already filtered by query mostly, but search applies
            if (activeTab === 'active') {

                // If search term is present and looks like an ID, we bypass status filters to show the result
                if (searchTerm && (searchTerm.includes('-') || /^\d/.test(searchTerm))) {
                    const term = searchTerm.toLowerCase().trim();
                    return String(r.projectNumber).includes(term) || String(r.rfpCode || '').toLowerCase().includes(term) || String(r.recipient || '').toLowerCase().includes(term);
                }

                if (closedStatuses.includes(statusRaw) || statusRaw.includes('paid')) return false;

                if (searchTerm) {
                    const term = searchTerm.toLowerCase().trim();
                    const matchesSearch = String(r.projectNumber).includes(term) || String(r.rfpCode || '').toLowerCase().includes(term) || String(r.recipient || '').toLowerCase().includes(term);
                    if (!matchesSearch) return false;
                }
                return true;
            }

            // Archive Tab Logic: Filter by selected mode (All/Open/Closed)
            else if (activeTab === 'archive') {
                if (archiveFilter === 'open') {
                    if (!openStatuses.some(s => statusRaw.includes(s)) || closedStatuses.includes(statusRaw)) return false;
                } else if (archiveFilter === 'closed') {
                    if (!closedStatuses.some(s => statusRaw === s || statusRaw.includes('paid'))) return false;
                }
                return true;
            }

            return true;
        }).sort((a, b) => {
            const dir = sortConfig.direction === 'asc' ? 1 : -1;
            const valA = a[sortConfig.key];
            const valB = b[sortConfig.key];
            if (typeof valA === 'string') return valA.localeCompare(valB) * dir;
            return (valA < valB ? -1 : 1) * dir;
        });
    }, [rfps, searchTerm, activeTab, sortConfig, archiveFilter]);

    const totals = useMemo(() => filteredRfps.reduce((acc, r) => ({
        net: acc.net + r.amount,
        vat: acc.vat + r.vat,
        // gross removed from table but kept in data if needed
        paidEx: acc.paidEx + (r.invoicedExVat || 0), // Added fallback to prevent NaN
        crEx: acc.crEx + (r.creditedExVat || 0),     // Added fallback to prevent NaN
        due: acc.due + r.remaining // Gross Due
    }), { net: 0, vat: 0, paidEx: 0, crEx: 0, due: 0 }), [filteredRfps]);

    // ... [Reuse canRevise, canAction, formatCurrency, renderSortIcon from previous] ...
    const canRevise = useMemo(() => { if (!selectedRfp) return false; if (selectedRfp.status === 'Pending') return false; if (selectedRfp.status === 'Superseded') return false; const s = (selectedRfp.status || '').toLowerCase(); const isIssuedStatus = ['issued - open', 'issued', 'open'].includes(s); const invoiced = parseFloat(selectedRfp.invoiced || 0); const credited = parseFloat(selectedRfp.credited || 0); return isIssuedStatus && invoiced < 0.01 && credited < 0.01; }, [selectedRfp]);
    const canAction = useMemo(() => { if (!selectedRfp || selectedRfp.status === 'Pending') return false; return selectedRfp.remaining > 0.01 && selectedRfp.status !== 'Superseded' && selectedRfp.status !== 'Bad Debt'; }, [selectedRfp]);
    const canSettle = useMemo(() => { if (!canAction) return false; return !selectedRfp.invoiced || selectedRfp.invoiced <= 0; }, [canAction, selectedRfp]);
    const formatCurrency = (val) => { const num = parseFloat(val) || 0; return Math.abs(num) < 0.01 ? '-' : `€${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
    const renderSortIcon = (key) => { if (sortConfig.key !== key) return <ChevronDownIcon className="h-3 w-3 ml-1 opacity-20 font-sans" />; return sortConfig.direction === 'asc' ? <ChevronUpIcon className="h-3 w-3 ml-1 text-orange-600 font-sans" /> : <ChevronDownIcon className="h-3 w-3 ml-1 text-orange-600 font-sans" />; };

    // Handle CSV Export
    const handleExportCSV = () => { if (!filteredRfps.length) return; const headers = ["Project", "RFP", "Issuer", "Created", "Recipient", "Net Amount", "VAT", "Paid (Ex VAT)", "Cr (Ex VAT)", "Due (Inc VAT)", "Status"]; const rows = filteredRfps.map(r => [r.projectNumber, r.rfpCode || 'PENDING', r.issuer || 'N/A', new Date(r.createdAt).toLocaleDateString('en-GB'), `"${r.recipient}"`, r.amount.toFixed(2), r.vat.toFixed(2), r.invoicedExVat.toFixed(2), r.creditedExVat.toFixed(2), r.remaining.toFixed(2), r.status]); const totalRow = ["TOTALS", "", "", "", "", totals.net.toFixed(2), totals.vat.toFixed(2), totals.paidEx.toFixed(2), totals.crEx.toFixed(2), totals.due.toFixed(2), ""]; const csvContent = [headers, ...rows, totalRow].map(r => r.join(",")).join("\n"); const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", `RFP_Ledger_${new Date().toISOString().slice(0, 10)}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link); };

    // Handle A4 Report Print
    const handlePrintProjectReport = () => {
        const printContent = document.getElementById('project-ledger-print');
        if (!printContent) return;

        const printWindow = window.open('', '_blank', 'height=1123,width=794');
        if (printWindow) {
            printWindow.document.write('<html><head><title>Project RFP Report</title>');
            printWindow.document.write('<script src="https://cdn.tailwindcss.com"></script>');
            printWindow.document.write(`
                <style>
                    body { background: white; -webkit-print-color-adjust: exact; padding: 20px; font-family: sans-serif; }
                    @page { size: A4 portrait; margin: 10mm; }
                    .print-table { width: 100%; border-collapse: collapse; font-size: 10px; }
                    .print-table th, .print-table td { border: 1px solid #e5e7eb; padding: 5px; text-align: left; }
                    .print-table th { background-color: #f3f4f6; font-weight: bold; text-align: center; }
                    .print-table td.right { text-align: right; font-family: monospace; }
                </style>
            `);
            printWindow.document.write('</head><body>');
            printWindow.document.write(printContent.innerHTML);
            printWindow.document.write('</body></html>');
            printWindow.document.close();

            setTimeout(() => {
                printWindow.focus();
                printWindow.print();
            }, 800);
        }
    };

    // Stats for Active Tab
    const activeStats = useMemo(() => {
        if (activeTab === 'active') {
            return { count: filteredRfps.length, value: totals.due };
        }
        return { count: '-', value: 0 };
    }, [filteredRfps, activeTab, totals]);

    // Handle Tab Change
    const handleTabChange = (tab) => {
        setActiveTab(tab);
        if (tab === 'archive') {
            setSearchTerm('');
            setRfps([]);
        } else {
            setSearchTerm('');
        }
    };

    // Get Project Description for Header
    const currentProjectDescription = useMemo(() => {
        if (activeTab !== 'archive' || !searchTerm) return '';
        const proj = allProjects.find(p => String(p.number) === searchTerm);
        return proj ? proj.description : '';
    }, [searchTerm, allProjects, activeTab]);

    return (
        <div className="bg-white rounded-lg shadow-sm h-[calc(100vh-12rem)] flex flex-col w-full overflow-hidden border border-gray-200 font-sans font-normal text-black font-sans">

            {/* Header Toolbar */}
            <div className="p-6 border-b border-gray-200 bg-gray-50 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 shrink-0 font-sans font-normal">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-8 shrink-0 font-sans">
                    <div className="font-sans">
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight font-sans">RFP Monitor</h1>
                        <div className="flex flex-col gap-0.5 mt-2 font-sans font-normal">
                            <span className="text-sm font-medium text-gray-500 font-sans">
                                {activeTab === 'active' ? 'Active Open Documents:' : `Project History: ${searchTerm || '...'}`}
                                <span className="text-orange-600 font-bold font-sans ml-1">{activeTab === 'active' ? activeStats.count : filteredRfps.length}</span>
                            </span>
                            {activeTab === 'active' && (
                                <span className="text-sm font-medium text-gray-500 font-sans">
                                    Outstanding Balance: <span className="text-orange-600 font-bold font-sans">€{activeStats.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </span>
                            )}
                        </div>
                    </div>
                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 px-4 border-l border-gray-200 h-10 font-sans">
                        <button onClick={() => setViewDocsRfp(selectedRfp)} disabled={!selectedRfp || selectedRfp.status === 'Pending'} title="History & Docs" className={`p-2 rounded-lg transition-all ${selectedRfp && selectedRfp.status !== 'Pending' ? 'text-orange-600 hover:bg-orange-100 bg-white border border-orange-200 shadow-sm' : 'text-gray-300 bg-gray-50 border border-gray-100 cursor-not-allowed'}`}><DocumentDuplicateIcon className="h-6 w-6" /></button>
                        <button onClick={() => setReviseRfp(selectedRfp)} disabled={!canRevise} title="Revise" className={`p-2 rounded-lg transition-all ${canRevise ? 'text-purple-600 hover:bg-purple-100 bg-white border border-purple-200 shadow-sm' : 'text-gray-300 bg-gray-50 border border-gray-100 cursor-not-allowed'}`}><ArrowPathRoundedSquareIcon className="h-6 w-6" /></button>
                        <button onClick={() => setPaymentAction({ rfp: selectedRfp, type: 'full' })} disabled={!canSettle} title="Settle" className={`p-2 rounded-lg transition-all ${canSettle ? 'text-green-600 hover:bg-green-100 bg-white border border-green-200 shadow-sm' : 'text-gray-300 bg-gray-50 border border-gray-100 cursor-not-allowed'}`}><CheckBadgeIcon className="h-6 w-6" /></button>
                        <button onClick={() => setPaymentAction({ rfp: selectedRfp, type: 'partial' })} disabled={!canAction} title="Partial Pay" className={`p-2 rounded-lg transition-all ${canAction ? 'text-blue-600 hover:bg-blue-100 bg-white border border-blue-200 shadow-sm' : 'text-gray-300 bg-gray-50 border border-gray-100 cursor-not-allowed'}`}><BanknotesIcon className="h-6 w-6" /></button>
                        <button onClick={() => setPaymentAction({ rfp: selectedRfp, type: 'reverse' })} disabled={!canAction} title="Credit Note" className={`p-2 rounded-lg transition-all ${canAction ? 'text-red-600 hover:bg-red-100 bg-white border border-red-200 shadow-sm' : 'text-gray-300 bg-gray-50 border border-gray-100 cursor-not-allowed'}`}><XCircleIcon className="h-6 w-6" /></button>
                        <button onClick={() => setPaymentAction({ rfp: selectedRfp, type: 'reminder' })} disabled={!canAction} title="Reminder" className={`p-2 rounded-lg transition-all ${canAction ? 'text-yellow-600 hover:bg-yellow-100 bg-white border border-yellow-200 shadow-sm' : 'text-gray-300 bg-gray-50 border border-gray-100 cursor-not-allowed'}`}><BellIcon className="h-6 w-6" /></button>
                        <button onClick={() => setAuditRfp(selectedRfp)} disabled={!selectedRfp} title="Audit" className={`p-2 rounded-lg transition-all ${selectedRfp ? 'text-gray-600 hover:bg-gray-100 bg-white border border-gray-200 shadow-sm' : 'text-gray-300 bg-gray-50 border border-gray-100 cursor-not-allowed'}`}><CalculatorIcon className="h-6 w-6" /></button>
                    </div>
                </div>

                <div className="flex gap-2 w-full sm:w-auto font-sans font-normal items-center flex-wrap">
                    {/* SPLIT LEDGER TABS */}
                    <div className="flex bg-gray-200 p-1 rounded-lg">
                        <button onClick={() => handleTabChange('active')} className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-md transition-all ${activeTab === 'active' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}><ClockIcon className="h-4 w-4" /> Active</button>
                        <button onClick={() => handleTabChange('archive')} className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-md transition-all ${activeTab === 'archive' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}><FolderOpenIcon className="h-4 w-4" /> Project RFP</button>
                    </div>

                    {/* Filter and Print for Project View */}
                    {activeTab === 'archive' && (
                        <>
                            <select
                                value={archiveFilter}
                                onChange={(e) => setArchiveFilter(e.target.value)}
                                className="px-2 py-2.5 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-700 shadow-sm focus:ring-orange-500 focus:border-orange-500 outline-none"
                            >
                                <option value="all">Show All RFPs</option>
                                <option value="open">Show Open</option>
                                <option value="closed">Show Closed</option>
                            </select>

                            <button onClick={handlePrintProjectReport} disabled={filteredRfps.length === 0} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 shadow-sm transition-all font-sans">
                                <DocumentTextIcon className="h-5 w-5 text-gray-600" /> Print Report
                            </button>
                        </>
                    )}

                    <button onClick={handleExportCSV} disabled={filteredRfps.length === 0} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 shadow-sm transition-all font-sans"><ArrowDownTrayIcon className="h-5 w-5 text-orange-600" /> Export</button>

                    <div className="relative flex-1 sm:w-64 text-black font-sans font-normal font-sans">
                        {activeTab === 'archive' ? (
                            // COMBINED SEARCH AND DROPDOWN
                            <div className="relative group">
                                <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-3 text-gray-400 font-sans z-10" />
                                <input
                                    list="project-options"
                                    type="text"
                                    placeholder="Type or Select Project..."
                                    className={`pl-9 pr-4 py-2.5 w-full rounded-lg border text-sm shadow-sm text-black font-sans focus:ring-orange-500 focus:border-orange-500 border-orange-300 ring-1 ring-orange-100 bg-white`}
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                />
                                <datalist id="project-options">
                                    {allProjects.map(proj => (
                                        <option key={proj.id} value={String(proj.number)}>
                                            {String(proj.number).padStart(4, '0')} - {proj.description}
                                        </option>
                                    ))}
                                </datalist>
                            </div>
                        ) : (
                            // Standard Text Search for Active Tab
                            <div className="relative">
                                <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-3 text-gray-400 font-sans" />
                                <input
                                    type="text"
                                    placeholder="Filter Active..."
                                    className={`pl-9 pr-4 py-2.5 w-full rounded-lg border text-sm shadow-sm text-black font-sans focus:ring-orange-500 focus:border-orange-500 border-gray-300`}
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Main Ledger Table */}
            <div className="flex-1 overflow-auto font-sans font-normal">
                {activeTab === 'archive' && !searchTerm && rfps.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 text-sm font-sans font-normal font-sans space-y-4">
                        <FolderOpenIcon className="h-16 w-16 text-gray-300" />
                        <div className="text-center">
                            <h3 className="font-bold text-gray-600 text-lg">Project Ledger</h3>
                            <p className="max-w-xs mx-auto">Please select a <strong>Project</strong> from the dropdown above to load its full invoice history (Open & Closed).</p>
                        </div>
                    </div>
                ) : loading ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 text-sm font-sans font-normal font-sans">
                        <ArrowPathIcon className="h-10 w-10 animate-spin mb-2 text-orange-500" />
                        <span>Loading {activeTab === 'active' ? 'Active' : 'Project'} Ledger...</span>
                    </div>
                ) : (
                    <table className="min-w-full table-fixed divide-y divide-gray-200 border-separate border-spacing-0 text-black font-sans font-normal">
                        <thead className="sticky top-0 z-10 font-normal uppercase text-gray-500 tracking-wider">
                            <tr className="bg-gray-100 text-[14px] font-normal">
                                {/* Centered Headers */}
                                <th onClick={() => handleSort('projectNumber')} className="w-12 px-2 py-3 text-center border-b border-gray-200 cursor-pointer hover:bg-gray-200 transition-colors font-normal"><div className="flex items-center justify-center">Proj {renderSortIcon('projectNumber')}</div></th>
                                <th onClick={() => handleSort('rfpCode')} className="w-14 px-2 py-3 text-center hidden sm:table-cell border-b border-gray-200 cursor-pointer hover:bg-gray-200 transition-colors font-normal"><div className="flex items-center justify-center">RFP {renderSortIcon('rfpCode')}</div></th>
                                <th onClick={() => handleSort('issuer')} className="w-14 px-2 py-3 text-center hidden md:table-cell border-b border-gray-200 cursor-pointer hover:bg-gray-200 transition-colors font-normal"><div className="flex items-center justify-center">Iss {renderSortIcon('issuer')}</div></th>
                                <th onClick={() => handleSort('createdAt')} className="w-24 px-2 py-3 text-center border-b border-gray-200 cursor-pointer hover:bg-gray-200 transition-colors font-normal whitespace-nowrap"><div className="flex items-center justify-center">Created {renderSortIcon('createdAt')}</div></th>
                                <th onClick={() => handleSort('recipient')} className="px-2 py-3 text-center border-b border-gray-200 cursor-pointer hover:bg-gray-200 transition-colors font-normal"><div className="flex items-center justify-center">Recipient {renderSortIcon('recipient')}</div></th>

                                {/* Centered Financial Headers & Widened Columns */}
                                <th className="w-28 px-2 py-3 text-center border-l border-b border-gray-200 font-normal">NET ex VAT</th>
                                <th className="w-24 px-2 py-3 text-center border-l border-b border-gray-200 font-normal text-gray-400">VAT</th>
                                <th className="w-28 px-2 py-3 text-center border-l border-b border-gray-200 text-green-700 font-normal">Paid ex VAT</th>
                                <th className="w-24 px-2 py-3 text-center border-l border-b border-gray-200 text-red-600 font-normal">CR ex VAT</th>
                                <th className="w-32 px-2 py-3 text-center border-l border-b border-gray-200 bg-orange-50/20 text-orange-900 font-bold">Due (Inc VAT)</th>

                                <th className="w-12 px-2 py-3 text-center hidden sm:table-cell border-b border-gray-200 font-normal">St</th>
                            </tr>
                            <tr className="bg-white border-b-2 border-gray-300 text-[12px] font-bold text-gray-900">
                                <td colSpan={5} className="px-2 py-2 text-right uppercase text-gray-400 tracking-tighter">Current Totals:</td>
                                <td className="px-2 py-2 text-right border-l border-gray-100">{formatCurrency(totals.net)}</td>
                                <td className="px-2 py-2 text-right border-l border-gray-100 text-gray-400">{formatCurrency(totals.vat)}</td>
                                <td className="px-2 py-2 text-right border-l border-gray-100 text-green-700">{formatCurrency(totals.paidEx)}</td>
                                <td className="px-2 py-2 text-right border-l border-gray-100 text-red-600">{formatCurrency(totals.crEx)}</td>
                                <td className="px-2 py-2 text-right border-l border-gray-100 bg-orange-50/30 text-orange-900">{formatCurrency(totals.due)}</td>
                                <td className="hidden sm:table-cell"></td>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white text-black font-sans font-normal">
                            {filteredRfps.length === 0 ? (
                                <tr><td colSpan="11" className="p-12 text-center text-gray-400 italic">No {activeTab === 'archive' ? 'project' : 'active'} RFPs found.</td></tr>
                            ) : (
                                filteredRfps.map(r => (
                                    <RfpRow
                                        key={r.id}
                                        rfp={r}
                                        isSelected={selectedRfpId === r.id}
                                        onSelect={setSelectedRfpId}
                                    />
                                ))
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Hidden Printable Area */}
            <div id="project-ledger-print" className="hidden">
                <div className="flex justify-between items-center mb-6 pb-4 border-b-2 border-orange-500">
                    <img src="/ias-logo.jpg" alt="iAS Logo" className="h-12 w-auto" />
                    <div className="text-right">
                        <h1 className="text-xl font-bold text-gray-900 uppercase">Project RFP Report</h1>
                        <p className="text-sm text-gray-500">Generated: {new Date().toLocaleDateString('en-GB')}</p>
                    </div>
                </div>
                <div className="mb-6">
                    <h2 className="text-lg font-bold text-gray-800">Project: {searchTerm}</h2>
                    <p className="text-sm text-gray-600">{currentProjectDescription}</p>
                    <p className="text-xs text-gray-400 mt-1 uppercase font-bold tracking-wide">Filter: {archiveFilter.toUpperCase()}</p>
                </div>
                <table className="print-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>RFP #</th>
                            <th>Recipient</th>
                            <th className="right">Net ex VAT</th>
                            <th className="right">VAT</th>
                            <th className="right">Paid ex VAT</th>
                            <th className="right">CR ex VAT</th>
                            <th className="right">Due (Inc VAT)</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRfps.map((r, i) => (
                            <tr key={i}>
                                <td>{new Date(r.createdAt).toLocaleDateString('en-GB')}</td>
                                <td>{r.rfpCode || 'PENDING'}</td>
                                <td>{r.recipient}</td>
                                <td className="right">{formatCurrency(r.amount)}</td>
                                <td className="right">{formatCurrency(r.vat)}</td>
                                <td className="right">{formatCurrency(r.invoicedExVat || 0)}</td>
                                <td className="right">{formatCurrency(r.creditedExVat || 0)}</td>
                                <td className="right">{formatCurrency(r.remaining)}</td>
                                <td>{r.status}</td>
                            </tr>
                        ))}
                        <tr style={{ backgroundColor: '#f9fafb', fontWeight: 'bold' }}>
                            <td colSpan={3} className="right">TOTALS:</td>
                            <td className="right">{formatCurrency(totals.net)}</td>
                            <td className="right">{formatCurrency(totals.vat)}</td>
                            <td className="right">{formatCurrency(totals.paidEx)}</td>
                            <td className="right">{formatCurrency(totals.crEx)}</td>
                            <td className="right">{formatCurrency(totals.due)}</td>
                            <td></td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* Overlays */}
            {paymentAction && <PaymentActionModal actionData={paymentAction} onClose={() => setPaymentAction(null)} onSuccess={() => { setPaymentAction(null); }} />}
            {auditRfp && <ProjectCostAuditModal show={true} onClose={() => setAuditRfp(null)} projectNumber={auditRfp.projectNumber} />}
            {viewDocsRfp && <DocumentsModal rfp={viewDocsRfp} onClose={() => setViewDocsRfp(null)} />}
            {reviseRfp && <UpdateRFPModal isOpen={true} onClose={() => setReviseRfp(null)} rfp={reviseRfp} mode="revise" />}
        </div>
    );
};

export default Invoices;