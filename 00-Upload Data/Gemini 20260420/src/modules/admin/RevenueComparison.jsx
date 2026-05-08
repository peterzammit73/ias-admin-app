// Root: src/modules/admin/RevenueComparison.jsx
// Version: 9.2 - Grouped Issuer Logic (Main Entity + Sub-Issuers)
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase.js';
import {
    PresentationChartBarIcon,
    CurrencyDollarIcon,
    CalendarDaysIcon,
    ArrowPathIcon,
    ChevronDownIcon,
    DocumentChartBarIcon,
    BuildingLibraryIcon,
    EyeSlashIcon,
    XMarkIcon,
    FolderMinusIcon,
    TrashIcon,
    ListBulletIcon,
    LockClosedIcon,
    ChevronUpIcon,
    FolderIcon
} from '@heroicons/react/24/outline';
import MultiYearBarChart from '../../components/MultiYearBarChart.jsx';
import Modal from '../../components/Modal.jsx';

const generateRevenueReportFn = httpsCallable(functions, 'generateRevenueReport');

const RevenueComparison = () => {
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);

    // Data State (Cached)
    const [reportData, setReportData] = useState(null);

    // Derived State from Report
    const [rfps, setRfps] = useState([]);
    const [projectDescriptions, setProjectDescriptions] = useState({});

    // Config State
    const [selectedMetric, setSelectedMetric] = useState('issued');
    const [availableYears, setAvailableYears] = useState([]);
    const [selectedYears, setSelectedYears] = useState([]);
    const [isYearDropdownOpen, setIsYearDropdownOpen] = useState(false);

    // Filters
    const [availableIssuers, setAvailableIssuers] = useState([]); // Now stores "Main Entity Groups"
    const [selectedIssuer, setSelectedIssuer] = useState('All');

    // Exclusions
    const [excludedIds, setExcludedIds] = useState(() => {
        try {
            const saved = localStorage.getItem('revenueReport_excludedIds');
            return saved ? new Set(JSON.parse(saved)) : new Set();
        } catch (e) { return new Set(); }
    });

    const [excludedProjects, setExcludedProjects] = useState(() => {
        try {
            const saved = localStorage.getItem('revenueReport_excludedProjects');
            return saved ? new Set(JSON.parse(saved)) : new Set();
        } catch (e) { return new Set(); }
    });

    const [showExclusionModal, setShowExclusionModal] = useState(false);
    const [exclusionSearch, setExclusionSearch] = useState('');
    const [projectToBlock, setProjectToBlock] = useState('');
    const [expandedProjects, setExpandedProjects] = useState(new Set());

    const dropdownRef = useRef(null);
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const YEAR_COLORS = { 0: '#ea580c', 1: '#6b7280', 2: '#fb923c', 3: '#374151', 4: '#fdba74' };

    // --- HELPER: Extract Main Entity Groups ---
    const extractIssuerGroups = (rawIssuers) => {
        const groups = new Set();
        rawIssuers.forEach(name => {
            if (!name) return;
            // Split by '/' to handle suffixes like /01, /02. 
            // "PZA/01" -> "PZA", "iAS" -> "iAS"
            const baseName = name.split('/')[0];
            if (baseName) groups.add(baseName);
        });
        return Array.from(groups).sort();
    };

    // --- EFFECT: Listen to Cached Report (Sharded Implementation) ---
    useEffect(() => {
        setLoading(true);
        // Listen to META document instead of the whole blob
        const unsub = onSnapshot(doc(db, 'reports', 'revenue_comparison_meta'), async (docSnap) => {
            if (docSnap.exists()) {
                const meta = docSnap.data();
                setReportData(meta); // Set meta info first

                // If shards exist, fetch them
                if (meta.shardCount > 0) {
                    const shardPromises = [];
                    for (let i = 0; i < meta.shardCount; i++) {
                        shardPromises.push(getDoc(doc(db, 'reports', `revenue_comparison_shard_${i}`)));
                    }

                    try {
                        const shardSnaps = await Promise.all(shardPromises);
                        let allRfps = [];
                        shardSnaps.forEach(snap => {
                            if (snap.exists()) {
                                const data = snap.data();
                                if (data.items) allRfps = [...allRfps, ...data.items];
                            }
                        });

                        // Hydrate RFP Data
                        const processedRfps = allRfps.map(r => ({
                            ...r,
                            issueDate: r.issueDate ? new Date(r.issueDate) : null,
                            credits: (r.credits || []).map(c => ({ ...c, date: c.date ? new Date(c.date) : null })),
                            payments: (r.payments || []).map(p => ({ ...p, date: p.date ? new Date(p.date) : null }))
                        }));

                        setRfps(processedRfps);
                        setProjectDescriptions(meta.projectMap || {});

                        // Extract Years (Fallback logic preserved)
                        let years = meta.availableYears || [];
                        if (years.length === 0 && processedRfps.length > 0) {
                            const yearSet = new Set();
                            processedRfps.forEach(r => {
                                if (r.issueDate) yearSet.add(r.issueDate.getFullYear());
                                if (r.payments) r.payments.forEach(p => { if (p.date) yearSet.add(p.date.getFullYear()) });
                            });
                            years = Array.from(yearSet).sort((a, b) => b - a);
                        }
                        setAvailableYears(years);

                        // Extract Issuers (Logic Updated to Group by Main Entity)
                        let rawIssuers = meta.availableIssuers || [];
                        if (rawIssuers.length === 0 && processedRfps.length > 0) {
                            const issuerSet = new Set();
                            processedRfps.forEach(r => {
                                if (r.issuer) issuerSet.add(r.issuer);
                            });
                            rawIssuers = Array.from(issuerSet);
                        }

                        setAvailableIssuers(extractIssuerGroups(rawIssuers));

                        // Update Selection Defaults
                        if (years.length > 0) {
                            // Only reset if selection is invalid or empty
                            const hasValidSelection = selectedYears.length > 0 && selectedYears.every(y => years.includes(y));
                            if (!hasValidSelection) {
                                setSelectedYears(years.slice(0, 2));
                            }
                        }

                    } catch (err) {
                        console.error("Error loading report shards:", err);
                        // Fallback logic could be added here if needed
                    }
                }
            } else {
                setReportData(null);
                setRfps([]);
                setAvailableYears([]);
                setAvailableIssuers([]);
            }
            setLoading(false);
            setGenerating(false);
        });
        return () => unsub();
    }, []);

    // --- HANDLER: Trigger Cloud Function ---
    const handleRefresh = async () => {
        setGenerating(true);
        try {
            await generateRevenueReportFn();
        } catch (error) {
            console.error("Report Gen Failed:", error);
            alert("Failed to refresh report.");
            setGenerating(false);
        }
    };

    // Persistence Effects
    useEffect(() => { localStorage.setItem('revenueReport_excludedIds', JSON.stringify(Array.from(excludedIds))); }, [excludedIds]);
    useEffect(() => { localStorage.setItem('revenueReport_excludedProjects', JSON.stringify(Array.from(excludedProjects))); }, [excludedProjects]);
    useEffect(() => {
        const handleClickOutside = (event) => { if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setIsYearDropdownOpen(false); };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // --- AGGREGATION LOGIC ---
    const toggleExclusion = (id) => setExcludedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    const handleBlockProject = () => { if (!projectToBlock) return; setExcludedProjects(prev => new Set(prev).add(projectToBlock.trim())); setProjectToBlock(''); };
    const handleUnblockProject = (pNum) => setExcludedProjects(prev => { const next = new Set(prev); next.delete(pNum); return next; });

    // Helper to check if an RFP belongs to the selected issuer group
    const matchesIssuerGroup = (rfpIssuer, selectedGroup) => {
        if (selectedGroup === 'All') return true;
        if (!rfpIssuer) return false;
        // Match exact (e.g. "PZA" == "PZA") OR sub-issuer (e.g. "PZA/01" starts with "PZA/")
        return rfpIssuer === selectedGroup || rfpIssuer.startsWith(`${selectedGroup}/`);
    };

    const chartData = useMemo(() => {
        if (!rfps.length) return [];
        const monthlyData = MONTHS.map(m => { const row = { month: m }; selectedYears.forEach(y => row[y] = 0); return row; });

        rfps.forEach(rfp => {
            if (excludedIds.has(rfp.id)) return;
            if (excludedProjects.has(rfp.project)) return;

            // Updated Issuer Check
            if (!matchesIssuerGroup(rfp.issuer, selectedIssuer)) return;

            if (rfp.isPending) return;

            if (selectedMetric === 'issued') {
                if (rfp.isSuperseded) return;
                if (rfp.issueDate && selectedYears.includes(rfp.issueDate.getFullYear())) {
                    const mIndex = rfp.issueDate.getMonth();
                    const yearKey = rfp.issueDate.getFullYear();
                    const totalCN = rfp.credits.reduce((sum, c) => sum + c.amount, 0);
                    monthlyData[mIndex][yearKey] += (rfp.netAmount - totalCN);
                }
            } else {
                rfp.payments.forEach(pay => {
                    if (pay.date && selectedYears.includes(pay.date.getFullYear())) {
                        const mIndex = pay.date.getMonth();
                        monthlyData[mIndex][pay.date.getFullYear()] += pay.amount;
                    }
                });
            }
        });
        return monthlyData;
    }, [rfps, selectedYears, selectedMetric, selectedIssuer, excludedIds, excludedProjects]);

    const detailedTotals = useMemo(() => {
        const res = {};
        selectedYears.forEach(year => res[year] = { net: 0, grossIssued: 0, cnValue: 0 });
        rfps.forEach(rfp => {
            if (excludedIds.has(rfp.id)) return;
            if (excludedProjects.has(rfp.project)) return;

            // Updated Issuer Check
            if (!matchesIssuerGroup(rfp.issuer, selectedIssuer)) return;

            if (rfp.isPending) return;

            if (selectedMetric === 'issued') {
                if (rfp.isSuperseded) return;
                if (rfp.issueDate && selectedYears.includes(rfp.issueDate.getFullYear())) {
                    const y = rfp.issueDate.getFullYear();
                    const totalCN = rfp.credits.reduce((sum, c) => sum + c.amount, 0);
                    res[y].grossIssued += rfp.netAmount;
                    res[y].cnValue += totalCN;
                    res[y].net += (rfp.netAmount - totalCN);
                }
            } else {
                rfp.payments.forEach(pay => {
                    if (pay.date && selectedYears.includes(pay.date.getFullYear())) {
                        const y = pay.date.getFullYear();
                        res[y].net += pay.amount;
                        res[y].grossIssued += pay.amount;
                    }
                });
            }
        });
        return res;
    }, [rfps, selectedYears, selectedMetric, selectedIssuer, excludedIds, excludedProjects]);

    const groupedBreakdownData = useMemo(() => {
        if (selectedYears.length !== 1) return null;
        const targetYear = selectedYears[0];
        const groups = {};

        rfps.forEach(rfp => {
            const isBlockedFile = excludedIds.has(rfp.id);
            const isBlockedProject = excludedProjects.has(rfp.project);
            const isBlocked = isBlockedFile || isBlockedProject;

            // Updated Issuer Check
            if (!matchesIssuerGroup(rfp.issuer, selectedIssuer)) return;

            if (rfp.isPending) return;

            const pNum = String(rfp.project).padStart(4, '0');
            const pDesc = projectDescriptions[pNum] || projectDescriptions[rfp.project] || 'Unknown Project';

            const addItem = (itemData) => {
                if (!groups[pNum]) groups[pNum] = { number: pNum, desc: pDesc, total: 0, isBlocked: isBlockedProject, items: [] };
                groups[pNum].items.push(itemData);
                if (!itemData.isBlocked) groups[pNum].total += itemData.amount;
            };

            if (selectedMetric === 'issued') {
                if (rfp.isSuperseded) return;
                if (rfp.issueDate && rfp.issueDate.getFullYear() === targetYear) {
                    const totalCN = rfp.credits.reduce((sum, c) => sum + c.amount, 0);
                    addItem({
                        id: rfp.id,
                        date: rfp.issueDate,
                        ref: rfp.rfpNumber,
                        amount: rfp.netAmount - totalCN,
                        isBlocked,
                        type: 'RFP'
                    });
                }
            } else {
                rfp.payments.forEach((pay, idx) => {
                    if (pay.date && pay.date.getFullYear() === targetYear) {
                        addItem({
                            id: `${rfp.id}_p${idx}`,
                            date: pay.date,
                            ref: `Payment on ${rfp.rfpNumber}`,
                            amount: pay.amount,
                            isBlocked,
                            type: 'Payment'
                        });
                    }
                });
            }
        });

        // SORTING: Project Number (Asc)
        return Object.values(groups).sort((a, b) => {
            const numA = parseInt(a.number) || 0;
            const numB = parseInt(b.number) || 0;
            return numA - numB;
        });
    }, [rfps, selectedYears, selectedMetric, selectedIssuer, excludedIds, excludedProjects, projectDescriptions]);

    const handleYearToggle = (year) => setSelectedYears(prev => { if (prev.includes(year)) return prev.filter(y => y !== year); return [...prev, year].sort((a, b) => b - a); });
    const handleClearYears = () => setSelectedYears([]);
    const toggleProjectExpand = (pNum) => setExpandedProjects(prev => { const next = new Set(prev); if (next.has(pNum)) next.delete(pNum); else next.add(pNum); return next; });
    const colorMap = useMemo(() => { const map = {}; selectedYears.sort().forEach((y, i) => { map[y] = YEAR_COLORS[i % 5]; }); return map; }, [selectedYears]);
    const filteredForExclusion = useMemo(() => rfps.filter(r => r.rfpNumber.toLowerCase().includes(exclusionSearch.toLowerCase()) || String(r.project).includes(exclusionSearch)).sort((a, b) => (b.issueDate || 0) - (a.issueDate || 0)), [rfps, exclusionSearch]);

    const lastUpdated = reportData?.generatedAt ? new Date(reportData.generatedAt.seconds * 1000).toLocaleString() : 'Never';
    const isDataAvailable = !!reportData && rfps.length > 0;

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 min-h-[600px]">

                {/* HEADER */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                            <DocumentChartBarIcon className="h-8 w-8 text-orange-600 mr-3" />
                            Revenue Comparison
                        </h1>
                        <div className="flex items-center gap-2 mt-1">
                            <p className="text-sm text-gray-500">Multi-year analysis of net fees and collections (Excl. VAT).</p>
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded border">Data: {lastUpdated}</span>
                        </div>
                    </div>

                    {/* CONTROLS */}
                    <div className="flex items-center gap-4 flex-wrap">
                        <button onClick={() => setShowExclusionModal(true)} disabled={!isDataAvailable} className={`flex items-center px-3 py-2 rounded-md border text-sm font-medium transition-colors ${!isDataAvailable ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : excludedIds.size > 0 || excludedProjects.size > 0 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`} title="Manage excluded files"><EyeSlashIcon className="h-4 w-4 mr-2" />{(excludedIds.size + excludedProjects.size) > 0 ? `${excludedIds.size + excludedProjects.size} Excluded` : 'Exclude Files'}</button>

                        <div className="relative">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"><BuildingLibraryIcon className="h-4 w-4 text-gray-400" /></div>
                            <select value={selectedIssuer} onChange={(e) => setSelectedIssuer(e.target.value)} disabled={!isDataAvailable} className="pl-9 pr-8 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 appearance-none disabled:bg-gray-100 disabled:text-gray-400">
                                <option value="All">All Entities</option>
                                {availableIssuers.map(iss => (<option key={iss} value={iss}>{iss}</option>))}
                            </select>
                        </div>

                        <div className="relative" ref={dropdownRef}>
                            <button onClick={() => setIsYearDropdownOpen(!isYearDropdownOpen)} disabled={!isDataAvailable} className="flex items-center justify-between w-48 px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-gray-100 disabled:text-gray-400">
                                <span className="flex items-center"><CalendarDaysIcon className="h-4 w-4 mr-2 text-gray-500" />{selectedYears.length > 0 ? `${selectedYears.length} Years` : 'Select Years'}</span><ChevronDownIcon className="h-4 w-4 ml-2 text-gray-400" />
                            </button>
                            {isYearDropdownOpen && isDataAvailable && (
                                <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-50 py-1">
                                    <div className="p-2 border-b border-gray-100 flex justify-between items-center"><span className="text-xs font-bold text-gray-500">Select Years</span><button onClick={handleClearYears} className="text-xs text-red-500 hover:text-red-700 font-medium flex items-center"><TrashIcon className="h-3 w-3 mr-1" /> Clear</button></div>
                                    <div className="max-h-60 overflow-y-auto">
                                        {availableYears.map(year => (
                                            <label key={year} className="flex items-center px-4 py-2 hover:bg-gray-50 cursor-pointer">
                                                <input type="checkbox" className="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded" checked={selectedYears.includes(year)} onChange={() => handleYearToggle(year)} />
                                                <span className="ml-3 text-sm text-gray-700">{year}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="bg-gray-100 p-1 rounded-lg flex shadow-inner">
                            <button onClick={() => setSelectedMetric('issued')} className={`flex items-center px-3 py-1.5 text-xs font-bold rounded-md transition-all ${selectedMetric === 'issued' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><PresentationChartBarIcon className="h-4 w-4 mr-1.5" />RFPs (Originated)</button>
                            <button onClick={() => setSelectedMetric('collected')} className={`flex items-center px-3 py-1.5 text-xs font-bold rounded-md transition-all ${selectedMetric === 'collected' ? 'bg-white text-gray-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><CurrencyDollarIcon className="h-4 w-4 mr-1.5" />Paid (Cash Flow)</button>
                        </div>

                        <button onClick={handleRefresh} disabled={generating} className={`p-2 border rounded-md shadow-sm transition-colors ${generating ? 'bg-indigo-100 text-indigo-400' : 'text-gray-400 hover:text-orange-600 hover:bg-gray-50'}`}>
                            <ArrowPathIcon className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>

                {!isDataAvailable && !loading ? (
                    <div className="p-12 text-center text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                        <DocumentChartBarIcon className="h-12 w-12 mx-auto mb-2 opacity-20" />
                        <p>No report data found.</p>
                        <button onClick={handleRefresh} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded font-bold text-sm hover:bg-indigo-700 transition-colors">Generate Report</button>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
                            {selectedYears.sort().map(year => {
                                const data = detailedTotals[year] || { net: 0, grossIssued: 0, cnValue: 0 };
                                return (
                                    <div key={year} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
                                        <div className="absolute top-0 left-0 w-1.5 h-full" style={{ backgroundColor: colorMap[year] }}></div>
                                        <div className="flex justify-between items-start mb-2">
                                            <p className="text-xs text-gray-500 font-black uppercase tracking-wider">{year}</p>
                                            {selectedMetric === 'issued' && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-bold">NET</span>}
                                        </div>
                                        <p className="text-2xl font-black text-gray-900 font-mono mb-1">€{data.net.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                                        {selectedMetric === 'issued' && (
                                            <div className="flex flex-col text-[10px] text-gray-400 font-mono mt-2 pt-2 border-t border-gray-100">
                                                <div className="flex justify-between"><span>Gross RFP:</span><span className="text-gray-600">€{data.grossIssued.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span></div>
                                                <div className="flex justify-between text-red-400"><span>Less CN:</span><span>-€{data.cnValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span></div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        <div className="h-96 w-full bg-gray-50/50 rounded-lg border border-gray-100 p-4">
                            {loading ? <div className="h-full flex items-center justify-center text-gray-400 animate-pulse">Loading...</div> : <MultiYearBarChart data={chartData} keys={selectedYears.sort()} colors={colorMap} height={350} />}
                        </div>

                        {groupedBreakdownData && (
                            <div className="mt-8 border rounded-lg overflow-hidden shadow-sm animate-fade-in">
                                <div className="bg-gray-50 p-3 border-b border-gray-200 flex justify-between items-center">
                                    <h3 className="text-sm font-bold text-gray-700 flex items-center"><ListBulletIcon className="h-4 w-4 mr-2 text-indigo-600" />Project Breakdown for {selectedYears[0]}</h3>
                                    <span className="text-[10px] bg-white border px-2 py-1 rounded text-gray-500">{groupedBreakdownData.length} active projects</span>
                                </div>
                                <div className="max-h-[500px] overflow-y-auto bg-white">
                                    {groupedBreakdownData.map(group => (
                                        <div key={group.number} className={`border-b border-gray-100 last:border-0 ${group.isBlocked ? 'bg-red-50/30' : ''}`}>
                                            <div onClick={() => toggleProjectExpand(group.number)} className="flex justify-between items-center p-3 cursor-pointer hover:bg-gray-50 transition-colors">
                                                <div className="flex items-center gap-3">
                                                    <button className="text-gray-400">{expandedProjects.has(group.number) ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}</button>
                                                    <div>
                                                        <div className="flex items-center gap-2"><FolderIcon className="h-4 w-4 text-orange-400" /><span className="font-mono font-bold text-gray-900">{group.number}</span>{group.isBlocked && <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Project Blocked</span>}</div>
                                                        <div className="text-xs text-gray-500 truncate max-w-md">{group.desc}</div>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className={`font-mono font-bold ${group.total > 0 ? 'text-gray-900' : 'text-gray-400'}`}>€{group.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                                    <p className="text-[10px] text-gray-400">{group.items.length} items</p>
                                                </div>
                                            </div>
                                            {expandedProjects.has(group.number) && (
                                                <div className="bg-gray-50/50 border-t border-gray-100 pl-10 pr-4 py-2">
                                                    <table className="w-full text-xs">
                                                        <tbody>
                                                            {group.items.map((item, idx) => (
                                                                <tr key={`${item.id}_${idx}`} className="border-b border-gray-100 last:border-0 text-gray-600">
                                                                    <td className="py-2 w-24">{item.date ? item.date.toLocaleDateString('en-GB') : '-'}</td>
                                                                    <td className="py-2 font-medium w-32">{item.ref}{item.isBlocked && <LockClosedIcon className="h-3 w-3 inline ml-1 text-red-400" title="Excluded from calculation" />}</td>
                                                                    <td className="py-2">{item.type}</td>
                                                                    <td className={`py-2 text-right font-mono ${item.isBlocked ? 'text-gray-400 line-through decoration-red-400' : 'text-gray-800'}`}>€{item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}

                <div className="mt-6 text-[11px] text-gray-400 text-center border-t pt-4">
                    <p className="font-bold text-gray-500 mb-1">Methodology (Excl. VAT)</p>
                    {selectedMetric === 'issued' ? (
                        <p>Shows the <strong>Net Value of Work Originated</strong> in each year. <br />Calculated as: (RFPs Issued in Year) - (All Linked Credit Notes, regardless of CN date).<br />Pending RFPs are excluded. Credit Notes issued in Year X for RFPs from previous years are <strong>excluded</strong>.</p>
                    ) : (
                        <p>Shows <strong>Actual Collections</strong> received in each year. <br />Based on the payment date of invoices (full or partial).</p>
                    )}
                </div>
            </div>

            {/* Exclusion Modal */}
            <Modal show={showExclusionModal} onClose={() => setShowExclusionModal(false)} title="Manage Excluded Files & Projects" maxWidth="max-w-2xl">
                <div className="flex flex-col h-[600px]">
                    <div className="p-4 bg-gray-50 border-b">
                        <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Block Entire Project (e.g. 0498)</label>
                        <div className="flex gap-2">
                            <input type="text" className="flex-1 p-2 border rounded text-sm" placeholder="Enter Project Number..." value={projectToBlock} onChange={(e) => setProjectToBlock(e.target.value)} />
                            <button onClick={handleBlockProject} className="px-4 py-2 bg-red-600 text-white text-xs font-bold rounded hover:bg-red-700 flex items-center"><FolderMinusIcon className="h-4 w-4 mr-1" /> Block</button>
                        </div>
                        {excludedProjects.size > 0 && (
                            <div className="flex flex-wrap gap-2 mt-3">{Array.from(excludedProjects).map(p => (<span key={p} className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800">Proj {p}<button onClick={() => handleUnblockProject(p)} className="ml-1 text-red-600 hover:text-red-900"><XMarkIcon className="h-3 w-3" /></button></span>))}</div>
                        )}
                    </div>
                    <div className="p-4 border-b">
                        <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Search Individual Documents</label>
                        <input type="text" placeholder="Search RFP Number or Project..." className="w-full p-2 border rounded" value={exclusionSearch} onChange={(e) => setExclusionSearch(e.target.value)} />
                    </div>
                    <div className="flex-1 overflow-y-auto p-2">
                        {filteredForExclusion.map(rfp => {
                            const isProjectBlocked = excludedProjects.has(rfp.project);
                            return (
                                <div key={rfp.id} className={`flex items-center justify-between p-3 border-b ${isProjectBlocked ? 'bg-gray-100 opacity-60' : 'hover:bg-gray-50'}`}>
                                    <div>
                                        <div className="font-bold text-sm text-gray-800 flex items-center gap-2">{rfp.rfpNumber}{isProjectBlocked && <span className="text-[9px] bg-red-50 text-red-600 px-1 rounded border border-red-100">Project Blocked</span>}</div>
                                        <div className="text-xs text-gray-500">Project: {rfp.project} | {rfp.issueDate ? rfp.issueDate.toLocaleDateString() : 'N/A'}</div>
                                        <div className="text-xs text-gray-400">{rfp.issuer}</div>
                                    </div>
                                    {!isProjectBlocked && <button onClick={() => toggleExclusion(rfp.id)} className={`px-3 py-1 rounded text-xs font-bold ${excludedIds.has(rfp.id) ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{excludedIds.has(rfp.id) ? 'Excluded' : 'Include'}</button>}
                                </div>
                            )
                        })}
                    </div>
                    <div className="p-4 border-t flex justify-between items-center bg-gray-50 rounded-b-lg"><span className="text-xs text-gray-500">{excludedIds.size} files + {excludedProjects.size} projects excluded.</span><button onClick={() => setShowExclusionModal(false)} className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-bold">Done</button></div>
                </div>
            </Modal>
        </div>
    );
};

export default RevenueComparison;