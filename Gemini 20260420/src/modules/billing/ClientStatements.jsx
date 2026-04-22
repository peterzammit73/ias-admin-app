// Root: src/modules/billing/ClientStatements.jsx
// Version: 6.6 - Fixed z-index stacking for Recipient Dropdown to overlap table header

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    collection,
    query,
    where,
    onSnapshot,
    getDocs
} from 'firebase/firestore';
import {
    onAuthStateChanged,
    signInAnonymously,
    signInWithCustomToken
} from 'firebase/auth';
import {
    DocumentChartBarIcon,
    PrinterIcon,
    MagnifyingGlassIcon,
    CalendarDaysIcon,
    UserGroupIcon,
    ArrowDownTrayIcon,
    BriefcaseIcon,
    FunnelIcon,
    InboxIcon,
    ChevronDownIcon
} from '@heroicons/react/24/outline';

import { db, auth } from '/src/firebase.js';

const appId = typeof __app_id !== 'undefined' ? __app_id : 'ias-production';

const App = () => {
    // --- Authentication & Initialization State ---
    const [user, setUser] = useState(auth?.currentUser || null);
    const [authLoading, setAuthLoading] = useState(true);

    // --- Global Data Contexts ---
    const [loading, setLoading] = useState(true);
    const [projects, setProjects] = useState([]);
    const [recipients, setRecipients] = useState([]);
    const [openRfpProjects, setOpenRfpProjects] = useState(new Set());

    // --- View & Filter State ---
    const [viewMode, setViewMode] = useState('project');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterOpenOnly, setFilterOpenOnly] = useState(false);

    // --- Statement Specific Filters ---
    const [selectedStatementRecipients, setSelectedStatementRecipients] = useState([]); // Empty = All Recipients
    const [statementFilterMode, setStatementFilterMode] = useState('all'); // 'all' or 'open_only'
    const [isRecipientDropdownOpen, setIsRecipientDropdownOpen] = useState(false);
    const recipientDropdownRef = useRef(null);

    // --- Ledger Data State ---
    const [selectedId, setSelectedId] = useState(null);
    const [rfps, setRfps] = useState([]);
    const [activeSelectionLabel, setActiveSelectionLabel] = useState('');

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (recipientDropdownRef.current && !recipientDropdownRef.current.contains(event.target)) {
                setIsRecipientDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    /**
     * 1. SESSION MANAGEMENT
     */
    useEffect(() => {
        if (!auth) {
            setAuthLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setAuthLoading(false);

            if (!currentUser) {
                const initAuth = async () => {
                    try {
                        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                            await signInWithCustomToken(auth, __initial_auth_token);
                        } else {
                            await signInAnonymously(auth);
                        }
                    } catch (err) {
                        console.error("Statement Auth Initialization Error:", err);
                    }
                };
                initAuth();
            }
        });

        return () => unsubscribe();
    }, []);

    /**
     * 2. DATA REGISTRY HYDRATION
     */
    useEffect(() => {
        if (!user || !db) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const [pSnap, rfpSnap, cSnap] = await Promise.all([
                    getDocs(collection(db, 'projects')),
                    getDocs(collection(db, 'rfps')),
                    getDocs(collection(db, 'clients'))
                ]);

                // Track which projects have open RFPs
                const openProjs = new Set();
                rfpSnap.docs.forEach(d => {
                    const data = d.data();
                    const status = (data.status || '').toLowerCase();
                    if (status.includes('open') || status.includes('partial')) {
                        if (data.projectNumber) openProjs.add(String(data.projectNumber).trim());
                    }
                });
                setOpenRfpProjects(openProjs);

                // Build Projects List
                const pList = pSnap.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })).sort((a, b) => {
                    const numA = parseInt(a.projectNumber) || 0;
                    const numB = parseInt(b.projectNumber) || 0;
                    return numA - numB;
                });
                setProjects(pList);

                // Build Recipients (Clients) List accurately
                const clientsList = cSnap.docs.map(doc => {
                    const data = doc.data();
                    const displayName = data.companyName || `${data.name || ''} ${data.surname || ''}`.trim();
                    return {
                        id: doc.id,
                        name: displayName
                    };
                }).filter(c => c.name).sort((a, b) => a.name.localeCompare(b.name));
                setRecipients(clientsList);

            } catch (err) {
                console.error("Data Load Error in Statements:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [user]);

    /**
     * 3. LEDGER TRANSACTION STREAM
     */
    useEffect(() => {
        if (!user || !db || !selectedId) {
            setRfps([]);
            return;
        }

        // Reset statement specific filters on new selection
        setSelectedStatementRecipients([]);
        setStatementFilterMode('all');

        let q;
        if (viewMode === 'project') {
            const proj = projects.find(p => p.id === selectedId);
            if (!proj) return;
            setActiveSelectionLabel(`${proj.projectNumber} - ${proj.projectDescription}`);
            q = query(collection(db, 'rfps'), where('projectNumber', '==', String(proj.projectNumber)));
        } else {
            const recObj = recipients.find(r => r.id === selectedId);
            if (!recObj) return;
            setActiveSelectionLabel(recObj.name);
            q = query(collection(db, 'rfps'), where('recipient', '==', recObj.name));
        }

        const unsubscribe = onSnapshot(q, (snapshot) => {
            setRfps(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        }, (err) => {
            console.error("Ledger Real-time Error:", err);
        });

        return () => unsubscribe();
    }, [user, selectedId, viewMode, projects, recipients]);

    /**
     * Helper: Transaction Reference Normalization
     */
    const normalizeReference = (ref, parentRfpCode) => {
        if (!ref) return parentRfpCode || 'N/A';
        let str = String(ref).trim();
        const baseRfp = parentRfpCode || '';

        if (str === baseRfp) return str;

        const flippedMatch = str.match(/^(Part\s*\d+)\s*[-\s]+\s*(.*)$/i);
        if (flippedMatch) {
            return `${flippedMatch[2]} - ${flippedMatch[1]}`;
        }

        const sequenceMatch = str.match(/^(?:Part\s*)?(\d{1,2})$/i);
        if (sequenceMatch && baseRfp) {
            const partNum = sequenceMatch[1].padStart(2, '0');
            if (baseRfp.toLowerCase().includes(`part ${partNum}`)) return baseRfp;
            return `${baseRfp} - Part ${partNum}`;
        }

        return str;
    };

    /**
     * 4. LEDGER RECONSTRUCTION ENGINE
     */

    // Determine unique recipients for the current project view
    const projectRecipients = useMemo(() => {
        if (viewMode !== 'project') return [];
        const recs = new Set();
        rfps.forEach(rfp => {
            const rec = rfp.recipient || rfp.clientName || rfp.client;
            if (rec && typeof rec === 'string') recs.add(rec.trim());
        });
        return Array.from(recs).sort();
    }, [rfps, viewMode]);

    // Pre-filter RFPs based on statement controls (Recipient & Outstanding Only)
    const filteredRfpsForLedger = useMemo(() => {
        return rfps.filter(rfp => {
            const status = (rfp.status || '').toLowerCase();
            // Never include superseded or bad debt in statements
            if (status === 'superseded' || status === 'bad debt') return false;

            // Recipient Filter (Multi-select array checking)
            if (viewMode === 'project' && selectedStatementRecipients.length > 0) {
                const rfpRecipient = (rfp.recipient || rfp.clientName || rfp.client || '').trim();
                if (!selectedStatementRecipients.includes(rfpRecipient)) return false;
            }

            // Open Only Filter (Outstanding Balance Statement)
            if (statementFilterMode === 'open_only') {
                const net = parseFloat(rfp.amount) || 0;
                const vat = rfp.vatApplicable ? (net * 0.18) : 0;
                const total = rfp.totalAmount || (net + vat);

                let paid = 0;
                if (rfp.payments) paid = Object.values(rfp.payments).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);

                let cred = 0;
                if (rfp.credits) cred = Object.values(rfp.credits).reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);

                const remaining = total - paid - cred;
                // If it's fully paid (remaining is basically 0), exclude it from the "Outstanding" statement
                if (remaining <= 0.01) return false;
            }

            return true;
        });
    }, [rfps, viewMode, selectedStatementRecipients, statementFilterMode]);

    // Build the line-by-line ledger
    const statementLedger = useMemo(() => {
        if (!filteredRfpsForLedger.length) return [];
        const entries = [];

        const getProjInfo = (pNum) => projects.find(p => String(p.projectNumber).trim() === String(pNum).trim());

        filteredRfpsForLedger.forEach(rfp => {
            const rfpCode = rfp.rfpCode || rfp.rfpNumber || 'PENDING';
            const rfpDate = rfp.issuedAt?.toDate ? rfp.issuedAt.toDate() :
                (rfp.createdAt?.toDate ? rfp.createdAt.toDate() : new Date(rfp.createdAt || Date.now()));

            const proj = getProjInfo(rfp.projectNumber);
            const recipient = rfp.recipient || rfp.clientName || rfp.client || proj?.clientName || proj?.recipient || 'N/A';
            const projectDisplay = proj ? `${rfp.projectNumber} - ${proj.projectDescription}` : rfp.projectNumber;

            const net = parseFloat(rfp.amount) || 0;
            const vat = rfp.vatApplicable ? (net * 0.18) : 0;
            const total = rfp.totalAmount || (net + vat);

            // A. RFP (Debit)
            entries.push({
                date: rfpDate,
                type: 'RFP',
                reference: rfpCode,
                recipient,
                projectDisplay,
                description: rfp.description || 'Professional Services',
                net, vat, debit: total,
                paid: 0,
                credited: 0
            });

            // B. Payments (Credits)
            if (rfp.payments) {
                Object.entries(rfp.payments).forEach(([key, p]) => {
                    const pDate = p.date?.toDate ? p.date.toDate() : new Date(p.date);
                    entries.push({
                        date: pDate,
                        type: 'INVOICE',
                        reference: normalizeReference(key, rfpCode),
                        recipient,
                        projectDisplay,
                        description: `Payment Received`,
                        net: 0, vat: 0, debit: 0,
                        paid: parseFloat(p.amount) || 0,
                        credited: 0
                    });
                });
            }

            // C. Credit Notes (Credits)
            if (rfp.credits) {
                Object.entries(rfp.credits).forEach(([key, c]) => {
                    const cDate = c.date?.toDate ? c.date.toDate() : new Date(c.date);
                    entries.push({
                        date: cDate,
                        type: 'CN',
                        reference: normalizeReference(key, rfpCode),
                        recipient,
                        projectDisplay,
                        description: `Credit Note Adjustment`,
                        net: 0, vat: 0, debit: 0,
                        paid: 0,
                        credited: parseFloat(c.amount) || 0
                    });
                });
            }
        });

        entries.sort((a, b) => a.date - b.date);

        let runningBal = 0;
        return entries.map(e => {
            runningBal += (e.debit - e.paid - e.credited);
            return { ...e, balance: runningBal };
        });
    }, [filteredRfpsForLedger, projects]);

    /**
     * 5. AGGREGATION TOTALS
     */
    const totals = useMemo(() => {
        return statementLedger.reduce((acc, row) => ({
            net: acc.net + row.net,
            vat: acc.vat + row.vat,
            total: acc.total + row.debit,
            paid: acc.paid + row.paid,
            credited: acc.credited + row.credited,
            due: row.balance
        }), { net: 0, vat: 0, total: 0, paid: 0, credited: 0, due: 0 });
    }, [statementLedger]);

    const formatCurrency = (val) => {
        const num = parseFloat(val) || 0;
        return Math.abs(num) < 0.01 ? '-' : `\u20AC${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    /**
     * 6. SIDEBAR FILTERING
     */
    const sidebarItems = useMemo(() => {
        const term = searchTerm.toLowerCase();
        let items = viewMode === 'project' ? projects : recipients;

        items = items.filter(i =>
            (i.projectNumber?.toString() || '').includes(term) ||
            (i.name || i.projectDescription || '').toLowerCase().includes(term)
        );

        if (viewMode === 'project' && filterOpenOnly) {
            items = items.filter(p => openRfpProjects.has(String(p.projectNumber).trim()));
        }

        return items;
    }, [viewMode, projects, recipients, searchTerm, filterOpenOnly, openRfpProjects]);

    /**
     * 7. PRINT TO A4 LOGIC
     */
    const handlePrint = () => {
        const printContent = document.getElementById('statement-print-area');
        if (!printContent) return;

        const printWindow = window.open('', '_blank', 'height=1123,width=794');
        if (printWindow) {
            printWindow.document.write('<html><head><title>Account Statement</title>');
            printWindow.document.write('<script src="https://cdn.tailwindcss.com"></script>');
            printWindow.document.write(`
                <style>
                    body { background: white; -webkit-print-color-adjust: exact; padding: 10mm; font-family: sans-serif; }
                    @page { size: A4 portrait; margin: 10mm; }
                    
                    /* Hide unwanted UI elements from the extract */
                    .no-print { display: none !important; }
                    
                    /* Force layout expansion to fit A4 */
                    #statement-print-area { border: none !important; box-shadow: none !important; border-radius: 0 !important; height: auto !important; overflow: visible !important; display: block !important; }
                    .overflow-auto, .overflow-hidden { overflow: visible !important; height: auto !important; }
                    .flex-1 { flex: none !important; }
                    
                    /* Table styling to ensure borders and full width */
                    table { width: 100% !important; border-collapse: collapse !important; border: 1px solid #e5e7eb !important; }
                    th, td { border: 1px solid #e5e7eb !important; padding: 8px 6px !important; }
                    thead tr { background-color: #f3f4f6 !important; }
                    
                    /* Refine text sizes for physical printing */
                    .text-xs { font-size: 10px !important; }
                    .text-sm { font-size: 11px !important; }
                    .text-lg { font-size: 14px !important; }
                    .text-xl { font-size: 16px !important; }
                    .text-2xl { font-size: 18px !important; }
                </style>
            `);
            printWindow.document.write('</head><body>');

            // Add a clean, professional header with Logo
            printWindow.document.write(`
                <div style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #ea580c; padding-bottom: 10px; margin-bottom: 20px;">
                    <img src="${window.location.origin}/ias-logo.jpg" alt="iAS" style="height: 48px; width: auto;" />
                    <div style="text-align: right; color: #374151;">
                        <h1 style="font-size: 18px; font-weight: bold; margin: 0; text-transform: uppercase;">Account Statement</h1>
                        <p style="font-size: 12px; margin: 2px 0 0 0;">Generated: ${new Date().toLocaleDateString('en-GB')}</p>
                    </div>
                </div>
            `);

            // Inject the isolated Table & Summary
            printWindow.document.write(printContent.outerHTML);
            printWindow.document.write('</body></html>');
            printWindow.document.close();

            setTimeout(() => {
                printWindow.focus();
                printWindow.print();
            }, 800);
        }
    };

    /**
     * 8. CSV EXPORT
     */
    const handleExportCSV = () => {
        if (!statementLedger.length) return;
        const headers = ["Date", "Type", "Reference", "Recipient", "Project", "Description", "Total inc VAT", "Paid", "CR", "Balance"];
        const rows = statementLedger.map(e => [
            e.date.toLocaleDateString('en-GB'), e.type, `"${e.reference}"`, `"${e.recipient}"`, `"${e.projectDisplay}"`, `"${e.description.replace(/"/g, '""')}"`,
            e.debit.toFixed(2), e.paid.toFixed(2), e.credited.toFixed(2), e.balance.toFixed(2)
        ]);
        const totalRow = ["TOTALS", "", "", "", "", "", totals.total.toFixed(2), totals.paid.toFixed(2), totals.credited.toFixed(2), totals.due.toFixed(2)];

        const csvContent = [headers, ...rows, totalRow].map(r => r.join(",")).join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.setAttribute("href", URL.createObjectURL(blob));
        link.setAttribute("download", `Statement_${activeSelectionLabel.replace(/[^a-z0-9]/gi, '_')}.csv`);
        link.click();
    };

    if (authLoading) return <div className="h-screen flex items-center justify-center font-sans text-gray-400 font-medium">Verifying authorization...</div>;

    return (
        <div className="flex h-[calc(100vh-12rem)] gap-4 font-sans text-black overflow-hidden font-normal">

            {/* Sidebar Navigation */}
            <div className="w-80 bg-white rounded-lg shadow border border-gray-200 flex flex-col shrink-0">
                <div className="p-4 border-b border-gray-100 bg-gray-50 space-y-3">
                    <div className="flex p-1 bg-gray-200 rounded-lg shadow-inner font-bold">
                        <button onClick={() => { setViewMode('project'); setSelectedId(null); }} className={`flex-1 flex items-center justify-center py-1.5 text-xs font-bold rounded-md transition-all ${viewMode === 'project' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                            <BriefcaseIcon className="h-4 w-4 mr-1.5" /> Project
                        </button>
                        <button onClick={() => { setViewMode('client'); setSelectedId(null); }} className={`flex-1 flex items-center justify-center py-1.5 text-xs font-bold rounded-md transition-all ${viewMode === 'client' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                            <UserGroupIcon className="h-4 w-4 mr-1.5" /> Recipient
                        </button>
                    </div>

                    <div className="space-y-2">
                        <div className="relative font-normal">
                            <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
                            <input
                                type="text"
                                placeholder={`Search ${viewMode}...`}
                                className="pl-9 w-full rounded-md border-gray-300 text-sm focus:ring-orange-500 outline-none text-black font-normal"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>

                        {viewMode === 'project' && (
                            <button
                                onClick={() => setFilterOpenOnly(!filterOpenOnly)}
                                className={`w-full flex items-center justify-center gap-2 py-1.5 rounded border text-[10px] font-bold transition-all uppercase tracking-tight ${filterOpenOnly ? 'bg-red-50 text-red-600 border-red-200 shadow-sm' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'}`}
                            >
                                <FunnelIcon className="h-3 w-3" />
                                {filterOpenOnly ? 'Showing Open Only' : 'Show All Projects'}
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-white font-sans">
                    {loading ? (
                        <div className="p-8 text-center text-gray-400 text-xs animate-pulse font-normal">Loading registries...</div>
                    ) : sidebarItems.length === 0 ? (
                        <div className="p-12 text-center text-gray-400 flex flex-col items-center">
                            <MagnifyingGlassIcon className="h-8 w-8 mb-2 opacity-20" />
                            <span className="text-[11px] italic font-normal">No results found.</span>
                        </div>
                    ) : sidebarItems.map(item => (
                        <button
                            key={item.id}
                            onClick={() => setSelectedId(item.id)}
                            className={`w-full text-left px-3 py-3 rounded-md text-sm transition-all group ${selectedId === item.id ? 'bg-orange-600 text-white font-bold shadow-md' : 'text-gray-600 hover:bg-orange-50 font-normal'}`}
                        >
                            <div className="flex flex-col flex-1 min-w-0 font-normal">
                                <div className="flex items-center gap-2 font-normal">
                                    {viewMode === 'project' && (
                                        <span className={`font-mono text-xs shrink-0 ${selectedId === item.id ? 'text-orange-100' : 'text-orange-600 font-bold'}`}>
                                            {String(item.projectNumber || '').padStart(4, '0')}
                                        </span>
                                    )}
                                    {viewMode === 'project' && openRfpProjects.has(String(item.projectNumber || '').trim()) && (
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase tracking-tighter border ${selectedId === item.id ? 'bg-white text-orange-600 border-white' : 'bg-red-500 text-white border-red-600 animate-pulse'}`}>OPEN</span>
                                    )}
                                </div>
                                <span className="whitespace-normal leading-tight mt-1 font-sans text-[13px] font-normal">
                                    {item.projectDescription || item.name}
                                </span>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Account Display Area */}
            <div id="statement-print-area" className="flex-1 bg-white rounded-lg shadow border border-gray-200 flex flex-col overflow-hidden font-sans font-normal">
                {!selectedId ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-12 text-center no-print font-normal opacity-50">
                        <DocumentChartBarIcon className="h-16 w-16 mb-4 text-gray-200" />
                        <h3 className="text-lg font-bold text-gray-500 font-sans uppercase tracking-tight">Financial Generator</h3>
                        <p className="text-sm font-normal max-w-xs mt-1 font-sans">Select a record from the sidebar to compile the account ledger.</p>
                    </div>
                ) : (
                    <>
                        <div className="p-6 border-b border-gray-200 bg-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0 font-sans">
                            <div>
                                <span className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-1 block font-sans">Account Transaction Statement</span>
                                <h2 className="text-xl font-bold text-gray-900 tracking-tight leading-tight font-sans">
                                    {activeSelectionLabel}
                                    {viewMode === 'project' && selectedStatementRecipients.length > 0 && (
                                        <span className="block text-sm text-gray-600 font-normal mt-1">Recipient(s): {selectedStatementRecipients.join(', ')}</span>
                                    )}
                                </h2>
                                <div className="flex items-center gap-4 mt-1 text-xs text-gray-500 font-normal font-sans">
                                    <span className="flex items-center font-normal font-bold">
                                        <CalendarDaysIcon className="h-4 w-4 mr-1.5 text-gray-400" /> Compiled {new Date().toLocaleDateString('en-GB')}
                                    </span>
                                    {statementFilterMode === 'open_only' && (
                                        <span className="bg-orange-100 text-orange-800 px-2 py-0.5 rounded font-bold">Outstanding Balance Only</span>
                                    )}
                                </div>
                            </div>
                            <div className="flex gap-2 w-full md:w-auto no-print font-bold">
                                <button onClick={handlePrint} className="flex-1 md:flex-none flex items-center justify-center px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-bold text-gray-700 hover:bg-gray-50 shadow-sm transition-colors font-sans font-normal font-bold">
                                    <PrinterIcon className="h-5 w-5 mr-2 text-gray-500" /> Print A4
                                </button>
                                <button onClick={handleExportCSV} className="flex-1 md:flex-none flex items-center justify-center px-4 py-2 bg-orange-600 text-white rounded-md text-sm font-bold hover:bg-orange-700 shadow-md transition-colors font-sans font-normal font-bold font-sans">
                                    <ArrowDownTrayIcon className="h-5 w-5 mr-2" /> Export CSV
                                </button>
                            </div>
                        </div>

                        {/* Filters Bar for Statement Specifics */}
                        <div className="bg-gray-100 border-b border-gray-200 p-2 flex flex-wrap gap-4 items-center no-print shadow-inner relative z-30 shrink-0 px-6">
                            {viewMode === 'project' && projectRecipients.length > 0 && (
                                <div className="flex items-center gap-2 relative" ref={recipientDropdownRef}>
                                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Recipients:</label>
                                    <div className="relative">
                                        <button
                                            onClick={() => setIsRecipientDropdownOpen(!isRecipientDropdownOpen)}
                                            className="border border-gray-300 rounded p-1.5 text-xs font-medium focus:ring-orange-500 focus:border-orange-500 outline-none bg-white min-w-[150px] flex justify-between items-center"
                                        >
                                            <span className="truncate max-w-[150px]">
                                                {selectedStatementRecipients.length === 0
                                                    ? 'All Recipients'
                                                    : `${selectedStatementRecipients.length} Selected`}
                                            </span>
                                            <ChevronDownIcon className="h-3 w-3 ml-2 text-gray-400" />
                                        </button>
                                        {isRecipientDropdownOpen && (
                                            <div className="absolute z-50 mt-1 w-64 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                                                <div
                                                    className="px-3 py-2 border-b border-gray-100 hover:bg-gray-50 cursor-pointer text-xs font-bold text-gray-700"
                                                    onClick={() => {
                                                        setSelectedStatementRecipients([]);
                                                        setIsRecipientDropdownOpen(false);
                                                    }}
                                                >
                                                    Clear Selection (Show All)
                                                </div>
                                                {projectRecipients.map(r => (
                                                    <label key={r} className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer text-xs">
                                                        <input
                                                            type="checkbox"
                                                            className="mr-2 rounded text-orange-600 focus:ring-orange-500"
                                                            checked={selectedStatementRecipients.includes(r)}
                                                            onChange={() => {
                                                                setSelectedStatementRecipients(prev =>
                                                                    prev.includes(r) ? prev.filter(item => item !== r) : [...prev, r]
                                                                );
                                                            }}
                                                        />
                                                        <span className="truncate">{r}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            <div className="flex items-center gap-2">
                                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Statement Type:</label>
                                <select
                                    value={statementFilterMode}
                                    onChange={e => setStatementFilterMode(e.target.value)}
                                    className="border border-gray-300 rounded p-1 text-xs font-medium focus:ring-orange-500 focus:border-orange-500 outline-none bg-white"
                                >
                                    <option value="all">Complete Ledger</option>
                                    <option value="open_only">Outstanding Balance Only</option>
                                </select>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto bg-white">
                            <table className="min-w-full border-separate border-spacing-0 font-sans">
                                <thead className="sticky top-0 z-20 shadow-sm font-bold text-gray-500 text-[10px] uppercase tracking-wider font-normal">
                                    {/* Header Row 1: Logical Labels */}
                                    <tr className="bg-gray-50 font-normal">
                                        <th className="w-24 px-4 py-3 text-left border-b border-gray-200 font-bold">Date</th>
                                        <th className="w-44 px-4 py-3 text-left border-b border-gray-200 font-bold">Reference</th>
                                        <th className="w-48 px-4 py-3 text-left border-b border-gray-200 font-bold font-sans">Recipient / Project</th>
                                        <th className="px-4 py-3 text-left border-b border-gray-200 font-bold">Details</th>
                                        <th className="w-32 px-3 py-3 text-right border-b border-gray-200 text-black font-bold font-sans">Total inc VAT</th>
                                        <th className="w-24 px-3 py-3 text-right border-b border-gray-200 text-green-700 font-bold font-sans">Paid</th>
                                        <th className="w-20 px-3 py-3 text-right border-b border-gray-200 text-red-600 font-bold font-sans">CR</th>
                                        <th className="w-28 px-4 py-3 text-right border-b border-gray-200 bg-gray-100 text-black font-bold font-sans">Due</th>
                                    </tr>
                                    {/* Header Row 2: Frozen Aggregates */}
                                    <tr className="bg-white border-b-2 border-gray-300 text-[11px] font-bold text-gray-900 font-normal font-sans">
                                        <td colSpan={4} className="px-4 py-2 text-right uppercase text-gray-400 tracking-tighter font-bold">Displayed Totals:</td>
                                        <td className="px-3 py-2 text-right font-bold">{formatCurrency(totals.total)}</td>
                                        <td className="px-3 py-2 text-right text-green-700 font-bold">{formatCurrency(totals.paid)}</td>
                                        <td className="px-3 py-2 text-right text-red-600 font-bold">{formatCurrency(totals.credited)}</td>
                                        <td className="px-4 py-2 text-right bg-orange-50 text-orange-600 font-black font-sans">{formatCurrency(totals.due)}</td>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 bg-white text-[12px] font-normal font-sans">
                                    {statementLedger.map((row, idx) => (
                                        <tr key={idx} className="hover:bg-gray-50 transition-colors font-normal">
                                            <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 font-mono text-[11px] font-normal font-sans">{row.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                                            <td className="px-4 py-2.5 truncate font-medium text-gray-900 font-normal font-sans">{row.reference}</td>
                                            <td className="px-4 py-2.5 text-[11px] leading-tight text-gray-600 font-normal font-sans">
                                                {viewMode === 'project' ? row.recipient : row.projectDisplay}
                                            </td>
                                            <td className="px-4 py-2.5 text-gray-600 leading-tight whitespace-normal font-normal font-sans">{row.description}</td>
                                            <td className="px-3 py-2.5 text-right font-mono font-bold text-gray-900 font-normal font-sans">{formatCurrency(row.debit)}</td>
                                            <td className="px-3 py-2.5 text-right font-mono text-green-700 font-normal font-sans">{formatCurrency(row.paid)}</td>
                                            <td className="px-3 py-2.5 text-right font-mono text-red-600 font-normal font-sans">{formatCurrency(row.credited)}</td>
                                            <td className={`px-4 py-2.5 text-right font-mono font-bold border-l border-gray-50 font-normal font-sans ${row.balance > 0.01 ? 'text-red-600' : 'text-gray-900'}`}>{formatCurrency(row.balance)}</td>
                                        </tr>
                                    ))}
                                    {statementLedger.length === 0 && (
                                        <tr>
                                            <td colSpan={8} className="py-24 text-center text-gray-300 font-sans">
                                                <InboxIcon className="h-12 w-12 mx-auto mb-2 opacity-20" />
                                                <p className="text-sm font-medium italic">No ledger entries detected for this context.</p>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Statement Footer Summary */}
                        <div className="p-4 bg-gray-50 border-t border-gray-200 shrink-0 font-bold font-sans shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                            <div className="flex justify-end gap-12 items-center">
                                <div className="text-right font-bold font-sans font-normal border-l border-gray-200 pl-12">
                                    <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest font-normal font-sans">Statement Balance</span>
                                    <span className={`text-2xl font-bold font-sans ${totals.due > 0.01 ? 'text-red-600' : 'text-gray-900'}`}>
                                        {formatCurrency(totals.due)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default App;