// Root: src/modules/billing/ProjectCosts.jsx
// Version: 10.3 - Fixed Imports & Lighter Orange Line
import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc, updateDoc, Timestamp, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase.js';
import {
    PlusIcon, TrashIcon, BanknotesIcon, PencilIcon, CheckIcon,
    LockClosedIcon, MagnifyingGlassIcon, EyeIcon,
    ArrowDownTrayIcon, ArchiveBoxXMarkIcon, BarsArrowUpIcon, BarsArrowDownIcon,
    ArrowUturnLeftIcon
} from '@heroicons/react/24/outline';
import Modal from '../../components/Modal.jsx';

const ProjectCosts = () => {
    // --- STATE MANAGEMENT ---
    const [costs, setCosts] = useState([]);
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);
    const [viewCost, setViewCost] = useState(null);
    const [isFormExpanded, setIsFormExpanded] = useState(false);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [filterProject, setFilterProject] = useState('');
    const [filterStart, setFilterStart] = useState('');
    const [filterEnd, setFilterEnd] = useState('');
    const [filterPayment, setFilterPayment] = useState('all');
    const [filterBilling, setFilterBilling] = useState('all');

    // Sorting
    const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });

    // Selection
    const [selectedIds, setSelectedIds] = useState(new Set());

    // Form State
    const [formData, setFormData] = useState({
        projectNumber: '',
        type: 'Sub-Consultancy',
        description: '',
        invoiceRef: '',
        invoiceDate: '',
        amount: '',
        vatApplicable: true,
        isPaid: false,
        paymentDate: '',
        amountPaid: '',
        paymentRef: ''
    });

    // --- HELPERS ---
    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            const [year, month, day] = dateStr.split('-');
            return `${day}/${month}/${year}`;
        }
        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return dateStr;
            return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
        } catch (e) { return dateStr; }
    };

    const formatCurrency = (val) => `\u20AC${parseFloat(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // --- DATA LOADING ---
    useEffect(() => {
        const qProj = query(collection(db, 'projects'), where('status', '==', 'Active'));
        const unsubProj = onSnapshot(qProj, (snap) => {
            const list = snap.docs.map(d => d.data());
            list.sort((a, b) => (parseInt(a.projectNumber) || 0) - (parseInt(b.projectNumber) || 0));
            setProjects(list);
        });

        const qCosts = query(collection(db, 'project_costs'));
        const unsubCosts = onSnapshot(qCosts, (snap) => {
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Initial sort by date desc
            list.sort((a, b) => {
                const dateA = a.invoiceDate || a.date || '';
                const dateB = b.invoiceDate || b.date || '';
                return new Date(dateB) - new Date(dateA);
            });
            setCosts(list);
            setLoading(false);
        });

        return () => { unsubProj(); unsubCosts(); };
    }, []);

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    // --- FILTERING & SORTING ---
    const processedCosts = useMemo(() => {
        // 1. Filter
        let data = costs.filter(cost => {
            // Enhanced Project Filter: Handles string/number mismatch (e.g., '659' vs '0659')
            if (filterProject) {
                const cNum = String(cost.projectNumber || '').trim();
                const fNum = String(filterProject || '').trim();
                // Check for exact string match OR numeric equality
                const isMatch = cNum === fNum || (parseInt(cNum, 10) === parseInt(fNum, 10) && !isNaN(parseInt(cNum, 10)));

                if (!isMatch) return false;
            }

            if (filterStart || filterEnd) {
                const cDate = new Date(cost.invoiceDate || cost.date);
                if (filterStart && cDate < new Date(filterStart)) return false;
                if (filterEnd && cDate > new Date(filterEnd)) return false;
            }

            if (searchTerm.trim()) {
                const term = searchTerm.toLowerCase();
                const desc = (cost.description || '').toLowerCase();
                const ref = (cost.invoiceRef || '').toLowerCase();
                const pNum = String(cost.projectNumber);
                if (!desc.includes(term) && !ref.includes(term) && !pNum.includes(term)) return false;
            }

            if (filterPayment === 'paid' && !cost.isPaid) return false;
            if (filterPayment === 'unpaid' && cost.isPaid) return false;

            const isBilled = cost.billingStatus === 'billed' || cost.billingStatus === 'rfp_pending';
            if (filterBilling === 'billed' && !isBilled) return false;
            if (filterBilling === 'unbilled' && isBilled) return false;

            return true;
        });

        // 2. Sort
        if (sortConfig.key) {
            data.sort((a, b) => {
                let valA, valB;

                if (sortConfig.key === 'date') {
                    valA = new Date(a.invoiceDate || a.date || 0);
                    valB = new Date(b.invoiceDate || b.date || 0);
                } else if (sortConfig.key === 'project') {
                    valA = parseInt(a.projectNumber || 0);
                    valB = parseInt(b.projectNumber || 0);
                } else {
                    return 0;
                }

                if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        return data;
    }, [costs, filterProject, searchTerm, filterStart, filterEnd, filterPayment, filterBilling, sortConfig]);

    // Summary Stats
    const stats = useMemo(() => {
        return processedCosts.reduce((acc, c) => {
            const amt = parseFloat(c.amount) || 0;
            const vat = c.vatApplicable !== false ? amt * 0.18 : 0;
            acc.totalNet += amt;
            acc.totalVat += vat;
            if (!c.isPaid) acc.unpaidLiability += (amt + vat);
            return acc;
        }, { totalNet: 0, totalVat: 0, unpaidLiability: 0 });
    }, [processedCosts]);

    // --- HANDLERS ---
    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => {
            const newState = { ...prev, [name]: type === 'checkbox' ? checked : value };
            if (name === 'isPaid') {
                if (checked) {
                    if (!newState.paymentDate) newState.paymentDate = new Date().toISOString().split('T')[0];
                    if (!newState.amountPaid) newState.amountPaid = newState.amount;
                } else {
                    newState.paymentDate = '';
                    newState.amountPaid = '';
                    newState.paymentRef = '';
                }
            }
            return newState;
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.projectNumber || !formData.amount) return;
        try {
            const payload = {
                ...formData,
                projectNumber: String(formData.projectNumber).trim().padStart(4, '0'),
                amount: parseFloat(formData.amount),
                amountPaid: formData.amountPaid ? parseFloat(formData.amountPaid) : null,
                date: formData.invoiceDate || new Date().toISOString().split('T')[0],
                updatedAt: Timestamp.now()
            };
            if (!editingId) {
                payload.billingStatus = 'unbilled';
                payload.createdAt = Timestamp.now();
                await addDoc(collection(db, 'project_costs'), payload);
            } else {
                await updateDoc(doc(db, 'project_costs', editingId), payload);
                setEditingId(null);
            }
            setFormData({ projectNumber: '', type: 'Sub-Consultancy', description: '', invoiceRef: '', invoiceDate: '', amount: '', vatApplicable: true, isPaid: false, paymentDate: '', amountPaid: '', paymentRef: '' });
            setIsFormExpanded(false);
            setEditingId(null);
        } catch (error) {
            console.error("Error saving cost:", error);
            alert("Failed to save cost record.");
        }
    };

    const isActionable = (cost) => !cost.isPaid && (!cost.billingStatus || cost.billingStatus === 'unbilled');

    const handleEdit = (cost) => {
        if (!isActionable(cost)) return alert("Cannot edit: Item is Paid or Billed.");
        setEditingId(cost.id);
        setFormData({
            projectNumber: cost.projectNumber,
            type: cost.type || 'Sub-Consultancy',
            description: cost.description || '',
            invoiceRef: cost.invoiceRef || '',
            invoiceDate: cost.invoiceDate || cost.date || '',
            amount: cost.amount || '',
            vatApplicable: cost.vatApplicable !== false,
            isPaid: cost.isPaid || false,
            paymentDate: cost.paymentDate || '',
            amountPaid: cost.amountPaid || '',
            paymentRef: cost.paymentRef || ''
        });
        setIsFormExpanded(true);
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setFormData({ projectNumber: '', type: 'Sub-Consultancy', description: '', invoiceRef: '', invoiceDate: '', amount: '', vatApplicable: true, isPaid: false, paymentDate: '', amountPaid: '', paymentRef: '' });
        setIsFormExpanded(false);
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Delete this cost record?")) return;
        try { await deleteDoc(doc(db, 'project_costs', id)); setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; }); } catch (error) { console.error(error); }
    };

    // --- MULTI SELECTION LOGIC ---
    const handleSelectRow = (id) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            const allIds = new Set(processedCosts.map(c => c.id));
            setSelectedIds(allIds);
        } else {
            setSelectedIds(new Set());
        }
    };

    const getSelectedObjects = () => {
        return costs.filter(c => selectedIds.has(c.id));
    };

    const selectedCost = useMemo(() => {
        if (selectedIds.size !== 1) return null;
        const id = [...selectedIds][0];
        return costs.find(c => c.id === id);
    }, [selectedIds, costs]);

    // --- BULK ACTIONS ---
    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;

        // Filter out locked items
        const selectedObjects = getSelectedObjects();
        const lockedItems = selectedObjects.filter(c => !isActionable(c));

        if (lockedItems.length > 0) {
            alert(`Cannot delete ${lockedItems.length} items because they are Paid or Billed.`);
            return;
        }

        if (!window.confirm(`Delete ${selectedIds.size} records?`)) return;

        try {
            const batch = writeBatch(db);
            selectedIds.forEach(id => {
                const ref = doc(db, 'project_costs', id);
                batch.delete(ref);
            });
            await batch.commit();
            setSelectedIds(new Set());
        } catch (e) {
            console.error("Bulk Delete Error", e);
            alert("Failed to delete items.");
        }
    };

    const handleBulkPay = async () => {
        if (selectedIds.size === 0) return;
        const selectedObjects = getSelectedObjects();
        const paidItems = selectedObjects.filter(c => c.isPaid);
        if (paidItems.length > 0) {
            alert(`${paidItems.length} items are already marked as Paid.`);
            return;
        }

        const date = prompt("Enter Payment Date (YYYY-MM-DD):", new Date().toISOString().split('T')[0]);
        if (!date) return;

        try {
            const batch = writeBatch(db);
            selectedObjects.forEach(c => {
                const ref = doc(db, 'project_costs', c.id);
                batch.update(ref, {
                    isPaid: true,
                    paymentDate: date,
                    amountPaid: parseFloat(c.amount),
                    updatedAt: Timestamp.now()
                });
            });
            await batch.commit();
            setSelectedIds(new Set());
        } catch (e) { console.error("Error paying costs:", e); }
    };

    const handleBulkNoRecharge = async () => {
        if (selectedIds.size === 0) return;

        if (!window.confirm(`Mark ${selectedIds.size} items as 'No Recharge'?\n\nThis will effectively remove them from the unbilled list and they will NOT be included in future RFPs.`)) {
            return;
        }

        try {
            const batch = writeBatch(db);
            selectedIds.forEach(id => {
                const ref = doc(db, 'project_costs', id);
                batch.update(ref, {
                    billingStatus: 'non_chargeable',
                    updatedAt: Timestamp.now()
                });
            });
            await batch.commit();
            setSelectedIds(new Set());
        } catch (e) {
            console.error("Error setting no recharge:", e);
            alert("Failed to update items.");
        }
    };

    // NEW: Revert No Recharge Action
    const handleRevertNoRecharge = async () => {
        if (selectedIds.size === 0) return;

        const selectedObjects = getSelectedObjects();
        const nonRechargeItems = selectedObjects.filter(c => c.billingStatus === 'non_chargeable');

        if (nonRechargeItems.length === 0) {
            alert("None of the selected items are marked as 'No Recharge'.");
            return;
        }

        if (!window.confirm(`Revert ${nonRechargeItems.length} items from 'No Recharge' to 'Unbilled'?`)) {
            return;
        }

        try {
            const batch = writeBatch(db);
            nonRechargeItems.forEach(c => {
                const ref = doc(db, 'project_costs', c.id);
                batch.update(ref, {
                    billingStatus: 'unbilled',
                    updatedAt: Timestamp.now()
                });
            });
            await batch.commit();
            setSelectedIds(new Set());
        } catch (e) {
            console.error("Error reverting no recharge:", e);
            alert("Failed to revert items.");
        }
    };

    const handleViewDetails = () => { if (selectedCost) setViewCost(selectedCost); };
    const handleEditSelected = () => { if (selectedCost) handleEdit(selectedCost); };

    const handleExportCSV = () => {
        const headers = ["Project", "Date", "Description", "Supplier", "Ref", "Net Amount", "VAT", "Total", "Status", "Payment"];
        const rows = processedCosts.map(c => {
            const net = parseFloat(c.amount) || 0;
            const vat = c.vatApplicable !== false ? net * 0.18 : 0;
            return [
                c.projectNumber, formatDate(c.invoiceDate || c.date), `"${c.description || ''}"`, `"${c.type || ''}"`, c.invoiceRef || '',
                net.toFixed(2), vat.toFixed(2), (net + vat).toFixed(2), c.billingStatus || 'unbilled', c.isPaid ? `Paid (${c.paymentDate})` : 'Unpaid'
            ].join(",");
        });
        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", "Project_Costs.csv");
        document.body.appendChild(link);
        link.click();
    };

    const getStatusBadge = (status, code) => {
        if (status === 'billed') return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800 border border-green-200"><CheckIcon className="h-3 w-3 mr-1" /> Billed {code && `(${code})`}</span>;
        if (status === 'rfp_pending') return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800 border border-orange-200"><LockClosedIcon className="h-3 w-3 mr-1" /> Pending</span>;

        if (status === 'non_chargeable') return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200">No Recharge</span>;
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-100">Unbilled</span>;
    };

    const SortIcon = ({ columnKey }) => {
        if (sortConfig.key !== columnKey) return <BarsArrowUpIcon className="h-4 w-4 ml-1 opacity-0 group-hover:opacity-30 inline" />;
        return sortConfig.direction === 'asc'
            ? <BarsArrowUpIcon className="h-4 w-4 ml-1 text-orange-600 inline" />
            : <BarsArrowDownIcon className="h-4 w-4 ml-1 text-orange-600 inline" />;
    };

    return (
        <div className="bg-gray-50 h-[calc(100vh-64px)] flex flex-col overflow-hidden">
            {/* Top Fixed Section */}
            <div className="shrink-0 space-y-6 px-6 pt-6 pb-2">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                            <BanknotesIcon className="h-8 w-8 mr-3 text-orange-600" /> Project Expenses
                        </h1>
                        <p className="text-sm text-gray-500 mt-1">Track external costs, supplier invoices, and reimbursements.</p>
                    </div>
                    <div className="grid grid-cols-3 gap-4 w-full lg:w-auto">
                        <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm min-w-[140px]">
                            <p className="text-xs font-bold text-gray-400 uppercase">Total Net</p>
                            <p className="text-lg font-mono font-bold text-gray-900">{formatCurrency(stats.totalNet)}</p>
                        </div>
                        <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm min-w-[140px]">
                            <p className="text-xs font-bold text-gray-400 uppercase">Unpaid Liability</p>
                            <p className="text-lg font-mono font-bold text-red-600">{formatCurrency(stats.unpaidLiability)}</p>
                        </div>
                        <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm min-w-[140px]">
                            <p className="text-xs font-bold text-gray-400 uppercase">VAT Exposure</p>
                            <p className="text-lg font-mono font-bold text-gray-600">{formatCurrency(stats.totalVat)}</p>
                        </div>
                    </div>
                </div>

                {/* ACTION BUTTONS (MULTI-SELECT SUPPORTED) */}
                {selectedIds.size > 0 && (
                    <div className="bg-orange-50 border border-orange-200 p-3 rounded-lg flex items-center justify-between shadow-sm animate-fade-in">
                        <div className="text-sm text-orange-800 font-medium">
                            <span className="font-bold">{selectedIds.size}</span> item(s) selected
                            {selectedCost && <span className="ml-2 opacity-75">({formatCurrency(selectedCost.amount)})</span>}
                        </div>
                        <div className="flex gap-3">
                            {selectedIds.size === 1 && (
                                <>
                                    <button onClick={handleViewDetails} className="flex items-center px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-bold rounded hover:bg-gray-50 shadow-sm">
                                        <EyeIcon className="h-4 w-4 mr-1.5" /> Details
                                    </button>
                                    <button onClick={handleEditSelected} disabled={!selectedCost || !isActionable(selectedCost)} className={`flex items-center px-3 py-1.5 border text-xs font-bold rounded shadow-sm ${(selectedCost && isActionable(selectedCost)) ? 'bg-white border-blue-200 text-blue-700 hover:bg-blue-50' : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'}`}>
                                        <PencilIcon className="h-4 w-4 mr-1.5" /> Edit
                                    </button>
                                </>
                            )}

                            {/* BULK ACTIONS - UPDATED */}
                            <button onClick={handleBulkNoRecharge} className="flex items-center px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-bold rounded hover:bg-gray-50 shadow-sm">
                                <ArchiveBoxXMarkIcon className="h-4 w-4 mr-1.5 text-gray-500" /> Set No Recharge
                            </button>

                            <button onClick={handleRevertNoRecharge} className="flex items-center px-3 py-1.5 bg-white border border-blue-200 text-blue-700 text-xs font-bold rounded hover:bg-blue-50 shadow-sm">
                                <ArrowUturnLeftIcon className="h-4 w-4 mr-1.5" /> Revert No Recharge
                            </button>

                            <button onClick={handleBulkPay} className="flex items-center px-3 py-1.5 bg-white border border-green-200 text-green-700 text-xs font-bold rounded hover:bg-green-50 shadow-sm">
                                <CheckIcon className="h-4 w-4 mr-1.5" /> Mark Paid
                            </button>

                            <button onClick={handleBulkDelete} className="flex items-center px-3 py-1.5 bg-white border border-red-200 text-red-600 text-xs font-bold rounded hover:bg-red-50 shadow-sm">
                                <TrashIcon className="h-4 w-4 mr-1.5" /> Delete
                            </button>
                        </div>
                    </div>
                )}

                <div className="flex flex-col xl:flex-row gap-4">
                    <div className="flex-1 bg-white p-3 rounded-lg border border-gray-200 shadow-sm flex flex-wrap gap-4 items-end">

                        {/* PROJECT FILTER */}
                        <div className="flex-1 min-w-[200px]">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Filter By Project</label>
                            <select className="w-full pl-2 py-2 border rounded-md text-sm focus:ring-orange-500 focus:border-orange-500 bg-white" value={filterProject} onChange={e => setFilterProject(e.target.value)}>
                                <option value="">All Projects</option>
                                {projects.map(p => (<option key={p.id} value={p.projectNumber}>{p.projectNumber} - {p.projectDescription}</option>))}
                            </select>
                        </div>

                        {/* DATE FILTER */}
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Date Range</label>
                            <div className="flex gap-2">
                                <input type="date" className="border rounded-md text-sm py-2 px-2" value={filterStart} onChange={e => setFilterStart(e.target.value)} />
                                <input type="date" className="border rounded-md text-sm py-2 px-2" value={filterEnd} onChange={e => setFilterEnd(e.target.value)} />
                            </div>
                        </div>

                        {/* TEXT SEARCH */}
                        <div className="relative min-w-[200px]">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Text Search</label>
                            <div className="relative">
                                <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
                                <input type="text" className="w-full pl-9 py-2 border rounded-md text-sm focus:ring-orange-500 focus:border-orange-500" placeholder="Desc, Ref..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                            </div>
                        </div>

                        {/* STATUS FILTER */}
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Status</label>
                            <select className="border rounded-md text-sm py-2 px-2 bg-white focus:ring-orange-500 focus:border-orange-500" value={filterBilling} onChange={e => setFilterBilling(e.target.value)}>
                                <option value="all">All Billing</option>
                                <option value="unbilled">Unbilled</option>
                                <option value="billed">Billed/Pending</option>
                            </select>
                        </div>

                        <button onClick={handleExportCSV} className="p-2 border rounded-md hover:bg-gray-50 text-gray-600" title="Export CSV"><ArrowDownTrayIcon className="h-5 w-5" /></button>
                    </div>
                    <button onClick={() => { setIsFormExpanded(!isFormExpanded); setEditingId(null); setSelectedIds(new Set()); }} className={`flex items-center justify-center px-6 py-3 rounded-lg font-bold shadow-sm transition-colors ${isFormExpanded ? 'bg-gray-200 text-gray-700' : 'bg-orange-600 text-white hover:bg-orange-700'}`}>
                        {isFormExpanded ? 'Hide Form' : <><PlusIcon className="h-5 w-5 mr-2" /> New Cost</>}
                    </button>
                </div>

                {(isFormExpanded || editingId) && (
                    <div className="bg-white p-6 rounded-lg border border-orange-200 shadow-md animate-fade-in relative">
                        <div className="absolute top-0 left-0 w-1 h-full bg-orange-500 rounded-l-lg"></div>
                        <div className="flex justify-between items-center mb-6 border-b pb-3">
                            <h3 className="text-base font-bold text-orange-900 uppercase tracking-wide">{editingId ? 'Edit Cost Record' : 'Register New Project Cost'}</h3>
                            {editingId && <span className="text-xs bg-orange-100 text-orange-800 px-3 py-1 rounded-full font-bold">Editing Mode</span>}
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                                <div className="col-span-1"><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Project</label><select name="projectNumber" className="w-full p-2 border rounded text-sm bg-white focus:ring-orange-500 focus:border-orange-500" value={formData.projectNumber} onChange={handleChange} required><option value="">Select Project...</option>{projects.map(p => (<option key={p.id} value={p.projectNumber}>{p.projectNumber} - {p.projectDescription}</option>))}</select></div>
                                <div className="col-span-1"><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Type</label><select name="type" className="w-full p-2 border rounded text-sm bg-white focus:ring-orange-500 focus:border-orange-500" value={formData.type} onChange={handleChange}><option>Sub-Consultancy</option><option>Travel</option><option>Printing</option><option>Permit Fees</option><option>Other</option></select></div>
                                <div className="col-span-2"><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Description / Supplier</label><input type="text" name="description" className="w-full p-2 border rounded text-sm focus:ring-orange-500 focus:border-orange-500" value={formData.description} onChange={handleChange} required /></div>
                                <div className="col-span-1"><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Inv. Ref (Supplier)</label><input type="text" name="invoiceRef" className="w-full p-2 border rounded text-sm focus:ring-orange-500 focus:border-orange-500" value={formData.invoiceRef} onChange={handleChange} /></div>
                                <div className="col-span-1"><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Inv. Date</label><input type="date" name="invoiceDate" className="w-full p-2 border rounded text-sm focus:ring-orange-500 focus:border-orange-500" value={formData.invoiceDate} onChange={handleChange} required /></div>
                                <div className="col-span-1"><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Amount (Excl. VAT)</label><div className="relative"><span className="absolute left-2 top-2 text-gray-500">€</span><input type="number" step="0.01" name="amount" className="w-full p-2 pl-6 border rounded text-sm font-mono focus:ring-orange-500 focus:border-orange-500" value={formData.amount} onChange={handleChange} required /></div></div>
                                <div className="col-span-1 flex items-center pt-6"><label className="flex items-center cursor-pointer"><input type="checkbox" name="vatApplicable" className="mr-2 rounded text-orange-600 focus:ring-orange-500" checked={formData.vatApplicable} onChange={handleChange} /><span className="text-sm text-gray-700">VAT Applicable (18%)</span></label></div>
                            </div>
                            <div className="bg-gray-50 p-4 rounded border border-gray-200 mb-6">
                                <div className="flex items-center mb-4"><label className="flex items-center cursor-pointer"><input type="checkbox" name="isPaid" className="mr-2 rounded text-green-600 h-5 w-5 focus:ring-green-500" checked={formData.isPaid} onChange={handleChange} /><span className="text-sm font-bold text-gray-800">Payment Made?</span></label></div>
                                {formData.isPaid && (<div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in"><div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Payment Date</label><input type="date" name="paymentDate" className="w-full p-2 border rounded text-sm bg-white focus:ring-green-500 focus:border-green-500" value={formData.paymentDate} onChange={handleChange} /></div><div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Amount Paid</label><input type="number" step="0.01" name="amountPaid" className="w-full p-2 border rounded text-sm bg-white focus:ring-green-500 focus:border-green-500" value={formData.amountPaid} onChange={handleChange} /></div><div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Payment Ref</label><input type="text" name="paymentRef" className="w-full p-2 border rounded text-sm bg-white focus:ring-green-500 focus:border-green-500" placeholder="Cheque/Ref No." value={formData.paymentRef} onChange={handleChange} /></div></div>)}
                            </div>
                            <div className="flex justify-end gap-3"><button type="button" onClick={handleCancelEdit} className="px-6 py-2 border border-gray-300 rounded text-sm font-medium hover:bg-gray-50 text-gray-700">Cancel</button><button type="submit" className={`px-8 py-2 rounded shadow-sm text-white font-bold text-sm ${editingId ? 'bg-orange-600 hover:bg-orange-700' : 'bg-green-600 hover:bg-green-700'}`}>{editingId ? 'Update Record' : 'Save Cost Record'}</button></div>
                        </form>
                    </div>
                )}
            </div>

            {/* VISUAL SEPARATOR & SCROLLABLE TABLE */}
            <div className="flex-1 flex flex-col bg-white border border-gray-200 rounded-b-lg shadow-sm min-h-0 relative mx-6 mb-6">
                {/* ORANGE SEPARATOR LINE (Fixed at top of table container) */}
                <div className="h-[2px] bg-orange-200 w-full shrink-0 z-20"></div>

                <div className="flex-1 overflow-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50 text-gray-500 font-medium sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="w-10 py-3 pl-4 bg-gray-50 text-center">
                                    <input
                                        type="checkbox"
                                        className="rounded text-orange-600 focus:ring-orange-500"
                                        checked={processedCosts.length > 0 && selectedIds.size === processedCosts.length}
                                        onChange={handleSelectAll}
                                    />
                                </th>
                                <th onClick={() => handleSort('date')} className="px-3 py-3 text-left bg-gray-50 cursor-pointer hover:bg-gray-100 group">Date <SortIcon columnKey="date" /></th>
                                <th onClick={() => handleSort('project')} className="px-3 py-3 text-left bg-gray-50 cursor-pointer hover:bg-gray-100 group">Project <SortIcon columnKey="project" /></th>
                                <th className="px-3 py-3 text-left bg-gray-50">Description</th>
                                <th className="px-3 py-3 text-right bg-gray-50">Net</th>
                                <th className="px-3 py-3 text-center bg-gray-50">VAT</th>
                                <th className="px-3 py-3 text-center bg-gray-50">Status</th>
                                <th className="px-3 py-3 text-center bg-gray-50">Payment</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {processedCosts.length === 0 ? (
                                <tr><td colSpan="8" className="p-8 text-center text-gray-400 italic">No costs found.</td></tr>
                            ) : processedCosts.map(cost => {
                                return (
                                    <tr key={cost.id} className={`hover:bg-gray-50 group cursor-pointer ${selectedIds.has(cost.id) ? 'bg-orange-50' : ''}`} onClick={() => handleSelectRow(cost.id)}>
                                        <td className="py-3 pl-4 text-center" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(cost.id)}
                                                onChange={() => handleSelectRow(cost.id)}
                                                className="rounded text-orange-600 focus:ring-orange-500 cursor-pointer"
                                            />
                                        </td>
                                        <td className="px-3 py-3 whitespace-nowrap text-gray-500 text-xs">{formatDate(cost.invoiceDate || cost.date)}</td>
                                        <td className="px-3 py-3 whitespace-nowrap font-mono font-bold text-orange-600">{cost.projectNumber}</td>
                                        <td className="px-3 py-3">
                                            <div className="font-medium text-gray-900 truncate max-w-[200px]">{cost.description}</div>
                                            <div className="text-xs text-gray-400">{cost.type} {cost.invoiceRef ? `• #${cost.invoiceRef}` : ''}</div>
                                        </td>
                                        <td className="px-3 py-3 text-right font-mono text-gray-700">{formatCurrency(cost.amount)}</td>
                                        <td className="px-3 py-3 text-center">{cost.vatApplicable !== false ? <CheckIcon className="h-4 w-4 mx-auto text-green-500" /> : <span className="text-xs text-gray-300">-</span>}</td>
                                        <td className="px-3 py-3 text-center">{getStatusBadge(cost.billingStatus, cost.rfpCode)}</td>
                                        <td className="px-3 py-3 text-center">
                                            {cost.isPaid ? <span className="text-[10px] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-100">Paid</span> : <span className="text-[10px] text-gray-400">Pending</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <Modal show={!!viewCost} onClose={() => setViewCost(null)} title="Cost Detail View">
                {viewCost && (
                    <div className="space-y-4 p-2">
                        <div className="flex justify-between border-b pb-2">
                            <span className="text-xs font-bold text-gray-400 uppercase">Project</span>
                            <span className="font-mono text-lg font-bold text-gray-900">{viewCost.projectNumber}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div><span className="block text-xs text-gray-400">Supplier</span>{viewCost.description}</div>
                            <div><span className="block text-xs text-gray-400">Type</span>{viewCost.type}</div>
                            <div><span className="block text-xs text-gray-400">Inv Date</span>{formatDate(viewCost.invoiceDate || viewCost.date)}</div>
                            <div><span className="block text-xs text-gray-400">Ref</span>{viewCost.invoiceRef || '-'}</div>
                        </div>
                        <div className="bg-gray-50 p-3 rounded text-sm space-y-2">
                            <div className="flex justify-between"><span>Net Amount</span><span className="font-mono">{formatCurrency(viewCost.amount)}</span></div>
                            <div className="flex justify-between text-gray-500"><span>VAT (18%)</span><span className="font-mono">{viewCost.vatApplicable !== false ? formatCurrency(viewCost.amount * 0.18) : '\u20AC0.00'}</span></div>
                            <div className="flex justify-between font-bold border-t pt-2 mt-2"><span>Total</span><span className="font-mono">{formatCurrency(parseFloat(viewCost.amount) * (viewCost.vatApplicable !== false ? 1.18 : 1))}</span></div>
                        </div>
                        {viewCost.isPaid && (
                            <div className="bg-green-50 border border-green-200 p-3 rounded text-sm text-green-800">
                                <div className="font-bold flex items-center mb-1"><CheckIcon className="h-4 w-4 mr-1" /> Paid</div>
                                <div className="text-xs space-y-1">
                                    <p>Date: {formatDate(viewCost.paymentDate)}</p>
                                    <p>Ref: {viewCost.paymentRef || 'N/A'}</p>
                                    {viewCost.amountPaid && <p>Amount: {formatCurrency(viewCost.amountPaid)}</p>}
                                </div>
                            </div>
                        )}
                        <div className="flex justify-end pt-4">
                            <button onClick={() => setViewCost(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm font-medium">Close</button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default ProjectCosts;