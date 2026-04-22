// Root: src/modules/admin/MonthlyFinancialReport.jsx
// Version: 3.6 - Split Cost Display
import React, { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase.js';
import {
    BanknotesIcon,
    ClockIcon,
    ArrowPathIcon,
    ChartPieIcon,
    UserGroupIcon,
    BuildingOfficeIcon,
    ArrowDownTrayIcon,
    InformationCircleIcon,
    DocumentTextIcon,
    CheckBadgeIcon,
    XCircleIcon,
    BarsArrowUpIcon,
    BarsArrowDownIcon,
    CalculatorIcon,
    ExclamationCircleIcon // Added for Overtime icon
} from '@heroicons/react/24/outline';
import { SimpleBarChart } from '../../components/SimpleCharts.jsx';
import Modal from '../../components/Modal.jsx';
import ProjectCostAuditModal from '../billing/ProjectCostAuditModal.jsx';

const MonthlyFinancialReport = () => {
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [reportData, setReportData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [activeTab, setActiveTab] = useState('projects'); // 'projects' or 'users'
    const [sortConfig, setSortConfig] = useState({ key: 'cost', direction: 'desc' });

    // Drill-down Modal State
    const [selectedUser, setSelectedUser] = useState(null);
    const [selectedProject, setSelectedProject] = useState(null);
    const [auditProjectNumber, setAuditProjectNumber] = useState(null);

    // Format ID: financial_summary_2024_02
    const reportId = useMemo(() => {
        const [y, m] = month.split('-');
        return `financial_summary_${y}_${m}`;
    }, [month]);

    // 1. Listen to Cached Report
    useEffect(() => {
        setLoading(true);
        const unsub = onSnapshot(doc(db, 'reports', reportId), (docSnap) => {
            if (docSnap.exists()) {
                setReportData(docSnap.data());
            } else {
                setReportData(null); // No report generated for this month yet
            }
            setLoading(false);
        });
        return () => unsub();
    }, [reportId]);

    // 2. Trigger Generation
    const handleGenerate = async () => {
        setGenerating(true);
        try {
            const functions = getFunctions();
            const genFn = httpsCallable(functions, 'generateMonthlyFinancialReport');
            await genFn({ month });
            // Snapshot listener will update UI automatically
        } catch (error) {
            console.error("Error generating report:", error);
            alert(`Failed to generate report: ${error.message}`);
        } finally {
            setGenerating(false);
        }
    };

    // Helper: CSV Export
    const handleExport = () => {
        if (!reportData) return;

        let csv = "data:text/csv;charset=utf-8,";

        // Section 1: Summary
        csv += `Monthly Report,${month}\n`;
        csv += `Generated,${new Date(reportData.generatedAt.seconds * 1000).toLocaleString()}\n`;
        csv += `Total Cost,${reportData.summary.totalCost.toFixed(2)}\n`;
        csv += `Total Base Cost,${reportData.summary.totalBaseCost?.toFixed(2) || 0}\n`;
        csv += `Total Overtime Cost,${reportData.summary.totalOvertimeCost?.toFixed(2) || 0}\n`;
        csv += `Total Hours,${reportData.summary.totalHours.toFixed(2)}\n`;
        csv += `RFPs Issued,${reportData.summary.totalRFPsIssued || 0}\n`;
        csv += `RFPs Value,${reportData.summary.totalRFPsValue?.toFixed(2) || 0}\n`;
        csv += `Invoices Paid,${reportData.summary.totalInvoicesPaid || 0}\n`;
        csv += `Invoices Value,${reportData.summary.totalInvoicesValue?.toFixed(2) || 0}\n`;
        csv += `Credit Notes,${reportData.summary.totalCreditNotes || 0}\n`;
        csv += `Credit Notes Value,${reportData.summary.totalCreditNotesValue?.toFixed(2) || 0}\n\n`;

        // Section 2: Projects
        csv += "PROJECT BREAKDOWN\n";
        csv += "Project Number,Project Name,Hours,Cost,Unique Users,RFP Value,Invoice Value,CN Value\n";
        reportData.byProject.forEach(p => {
            csv += `"${p.number}","${p.name}",${p.hours},${p.cost},${p.userCount},${p.rfpValue || 0},${p.invoiceValue || 0},${p.creditNoteValue || 0}\n`;
        });

        // Section 3: Users
        csv += "\nUSER BREAKDOWN\n";
        csv += "Name,Expected Hours,Actual Hours,Cost,Project Count\n";
        reportData.byUser.forEach(u => {
            csv += `"${u.name}",${u.expectedHours || 0},${u.hours},${u.cost},${u.projectCount}\n`;
        });

        const encodedUri = encodeURI(csv);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Financial_Report_${month}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleSort = (key) => {
        let direction = 'desc';
        if (sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        }
        setSortConfig({ key, direction });
    };

    const sortedData = useMemo(() => {
        if (!reportData) return [];
        const list = activeTab === 'projects' ? [...reportData.byProject] : [...reportData.byUser];

        return list.sort((a, b) => {
            let valA = a[sortConfig.key];
            let valB = b[sortConfig.key];

            if (sortConfig.key === 'number') {
                valA = parseInt(a.number) || 0;
                valB = parseInt(b.number) || 0;
            } else if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }

            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [reportData, activeTab, sortConfig]);

    // Derive contributors for the selected project by scanning the user breakdown
    const projectContributors = useMemo(() => {
        if (!selectedProject || !reportData) return [];
        const pNum = selectedProject.number;
        const list = [];

        reportData.byUser.forEach(user => {
            // Check if this user worked on the selected project
            const entry = user.breakdown?.find(p => p.number === pNum);
            if (entry) {
                list.push({
                    name: user.name,
                    hours: entry.hours,
                    cost: entry.cost
                });
            }
        });

        return list.sort((a, b) => b.cost - a.cost);
    }, [selectedProject, reportData]);

    const formatCurrency = (val) => `\u20AC${(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const SortIcon = ({ columnKey }) => {
        if (sortConfig.key !== columnKey) return <BarsArrowUpIcon className="h-3 w-3 inline ml-1 opacity-20 group-hover:opacity-50" />;
        return sortConfig.direction === 'asc'
            ? <BarsArrowUpIcon className="h-3 w-3 inline ml-1 text-indigo-600" />
            : <BarsArrowDownIcon className="h-3 w-3 inline ml-1 text-indigo-600" />;
    };

    const chartDataCost = useMemo(() => {
        if (!reportData) return [];
        return reportData.byProject.slice(0, 15).map(p => ({
            label: p.number,
            value: p.cost,
            name: p.name
        }));
    }, [reportData]);

    const chartDataHours = useMemo(() => {
        if (!reportData) return [];
        // Sort by hours for this chart specifically
        const sorted = [...reportData.byProject].sort((a, b) => b.hours - a.hours).slice(0, 15);
        return sorted.map(p => ({
            label: p.number,
            value: p.hours,
            name: p.name,
            color: '#3b82f6' // Blue for hours
        }));
    }, [reportData]);

    return (
        <div className="space-y-6">
            {/* Header / Controls */}
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-4 w-full md:w-auto">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">Monthly Financials</h2>
                        <p className="text-xs text-gray-500">Cost & Hours Aggregation</p>
                    </div>
                    <input
                        type="month"
                        value={month}
                        onChange={(e) => setMonth(e.target.value)}
                        className="rounded-md border-gray-300 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                    />
                </div>

                <div className="flex gap-2">
                    {reportData && (
                        <button onClick={handleExport} className="flex items-center px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-50 shadow-sm">
                            <ArrowDownTrayIcon className="h-4 w-4 mr-2" /> CSV
                        </button>
                    )}
                    <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className={`flex items-center px-4 py-2 text-white rounded-md text-sm font-bold shadow-sm ${generating ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                    >
                        <ArrowPathIcon className={`h-4 w-4 mr-2 ${generating ? 'animate-spin' : ''}`} />
                        {reportData ? 'Refresh Data' : 'Generate Report'}
                    </button>
                </div>
            </div>

            {/* Content Area */}
            {loading ? (
                <div className="p-12 text-center text-gray-500">Checking for cached report...</div>
            ) : !reportData ? (
                <div className="p-12 text-center border-2 border-dashed border-gray-300 rounded-lg text-gray-400">
                    <ChartPieIcon className="h-12 w-12 mx-auto mb-2" />
                    <p>No report found for {month}. Click <b>Generate</b> to compile data.</p>
                    <p className="text-xs mt-2">This will scan all records for this month and cache the result.</p>
                </div>
            ) : (
                <>
                    {/* Compact KPI Row - All in One Line */}
                    <div className="flex gap-4 overflow-x-auto pb-2">
                        {/* SPLIT TOTAL COST CARD */}
                        <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-200 min-w-[160px] flex-1">
                            <p className="text-[10px] font-bold text-gray-400 uppercase">Total Cost (Loaded)</p>
                            <div className="flex flex-col">
                                <span className="text-sm font-bold text-orange-600 font-mono">
                                    Base: {formatCurrency(reportData.summary.totalBaseCost)}
                                </span>
                                {reportData.summary.totalOvertimeCost > 0 && (
                                    <span className="text-xs font-bold text-red-600 font-mono flex items-center">
                                        <ExclamationCircleIcon className="h-3 w-3 mr-1" />
                                        Extra: {formatCurrency(reportData.summary.totalOvertimeCost)}
                                    </span>
                                )}
                                <span className="text-[9px] text-gray-400 border-t mt-1 pt-1">
                                    Total: {formatCurrency(reportData.summary.totalCost)}
                                </span>
                            </div>
                        </div>

                        <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-200 min-w-[120px] flex-1">
                            <p className="text-[10px] font-bold text-gray-400 uppercase">Total Hours</p>
                            <p className="text-xl font-bold text-gray-800 font-mono">{reportData.summary.totalHours.toFixed(1)}h</p>
                        </div>
                        <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-200 min-w-[120px] flex-1">
                            <p className="text-[10px] font-bold text-gray-400 uppercase">Active Staff</p>
                            <p className="text-xl font-bold text-green-600 font-mono">{reportData.summary.totalEmployees}</p>
                        </div>
                        <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-200 min-w-[120px] flex-1">
                            <div className="flex justify-between items-start mb-0.5">
                                <p className="text-[10px] font-bold text-gray-400 uppercase">RFPs Issued (Inc VAT)</p>
                                <DocumentTextIcon className="h-3 w-3 text-blue-400" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-lg font-bold text-blue-600 font-mono leading-tight">{formatCurrency(reportData.summary.totalRFPsValue)}</span>
                                <span className="text-[9px] text-gray-400 font-mono">Count: {reportData.summary.totalRFPsIssued || 0}</span>
                            </div>
                        </div>
                        <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-200 min-w-[120px] flex-1">
                            <div className="flex justify-between items-start mb-0.5">
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Paid Invoices (Inc VAT)</p>
                                <CheckBadgeIcon className="h-3 w-3 text-purple-400" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-lg font-bold text-purple-600 font-mono leading-tight">{formatCurrency(reportData.summary.totalInvoicesValue)}</span>
                                <span className="text-[9px] text-gray-400 font-mono">Count: {reportData.summary.totalInvoicesPaid || 0}</span>
                            </div>
                        </div>
                        <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-200 min-w-[120px] flex-1">
                            <div className="flex justify-between items-start mb-0.5">
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Credit Notes (Inc VAT)</p>
                                <XCircleIcon className="h-3 w-3 text-red-400" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-lg font-bold text-red-600 font-mono leading-tight">{formatCurrency(reportData.summary.totalCreditNotesValue)}</span>
                                <span className="text-[9px] text-gray-400 font-mono">Count: {reportData.summary.totalCreditNotes || 0}</span>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Graphs Section */}
                        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                            <h3 className="text-sm font-bold text-gray-700 mb-6 flex items-center">
                                <BanknotesIcon className="h-4 w-4 mr-2 text-orange-500" /> Top Projects by Cost
                            </h3>
                            <SimpleBarChart data={chartDataCost} height={200} color="#f97316" />
                        </div>
                        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                            <h3 className="text-sm font-bold text-gray-700 mb-6 flex items-center">
                                <ClockIcon className="h-4 w-4 mr-2 text-blue-500" /> Top Projects by Hours
                            </h3>
                            <SimpleBarChart data={chartDataHours} height={200} color="#3b82f6" />
                        </div>

                        {/* Detailed Table */}
                        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                            <div className="flex border-b border-gray-200 bg-gray-50">
                                <button
                                    onClick={() => setActiveTab('projects')}
                                    className={`flex-1 py-3 text-sm font-bold ${activeTab === 'projects' ? 'text-orange-600 bg-white border-t-2 border-t-orange-600' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    <BuildingOfficeIcon className="h-4 w-4 inline mr-2" /> Project Breakdown
                                </button>
                                <button
                                    onClick={() => setActiveTab('users')}
                                    className={`flex-1 py-3 text-sm font-bold ${activeTab === 'users' ? 'text-orange-600 bg-white border-t-2 border-t-orange-600' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    <UserGroupIcon className="h-4 w-4 inline mr-2" /> Staff Breakdown
                                </button>
                            </div>

                            <div className="overflow-x-auto max-h-[600px]">
                                <table className="min-w-full divide-y divide-gray-200 text-sm">
                                    <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                            <th className="px-6 py-3 text-left font-bold text-gray-500 uppercase text-xs cursor-pointer group" onClick={() => handleSort(activeTab === 'projects' ? 'number' : 'name')}>
                                                Name <SortIcon columnKey={activeTab === 'projects' ? 'number' : 'name'} />
                                            </th>
                                            {activeTab === 'users' && (
                                                <th className="px-6 py-3 text-right font-bold text-gray-500 uppercase text-xs cursor-pointer group" onClick={() => handleSort('expectedHours')}>
                                                    Expected <SortIcon columnKey="expectedHours" />
                                                </th>
                                            )}
                                            <th className="px-6 py-3 text-right font-bold text-gray-500 uppercase text-xs cursor-pointer group" onClick={() => handleSort('hours')}>
                                                Actual Hours <SortIcon columnKey="hours" />
                                            </th>
                                            <th className="px-6 py-3 text-right font-bold text-gray-500 uppercase text-xs cursor-pointer group" onClick={() => handleSort('cost')}>
                                                Labor Cost <SortIcon columnKey="cost" />
                                            </th>
                                            {activeTab === 'projects' && (
                                                <>
                                                    <th className="px-6 py-3 text-right font-bold text-blue-600 uppercase text-xs cursor-pointer group" onClick={() => handleSort('rfpValue')}>
                                                        RFP Issued <SortIcon columnKey="rfpValue" />
                                                    </th>
                                                    <th className="px-6 py-3 text-right font-bold text-purple-600 uppercase text-xs cursor-pointer group" onClick={() => handleSort('invoiceValue')}>
                                                        Paid Inv <SortIcon columnKey="invoiceValue" />
                                                    </th>
                                                    <th className="px-6 py-3 text-right font-bold text-red-600 uppercase text-xs cursor-pointer group" onClick={() => handleSort('creditNoteValue')}>
                                                        CN Value <SortIcon columnKey="creditNoteValue" />
                                                    </th>
                                                </>
                                            )}
                                            <th className="px-6 py-3 text-right font-bold text-gray-500 uppercase text-xs">
                                                {activeTab === 'projects' ? 'Users' : 'Projects'}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        {sortedData.map((row, idx) => (
                                            <tr
                                                key={idx}
                                                className={`transition-colors cursor-pointer hover:bg-indigo-50 group`}
                                                onClick={() => activeTab === 'users' ? setSelectedUser(row) : setSelectedProject(row)}
                                                title="Click to see detailed breakdown"
                                            >
                                                <td className="px-6 py-3 font-medium text-gray-900">
                                                    {activeTab === 'projects' ? (
                                                        <div className="flex flex-col">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-mono text-xs text-orange-600">{row.number}</span>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setAuditProjectNumber(row.number);
                                                                    }}
                                                                    className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                                                                    title="Open Financial Audit"
                                                                >
                                                                    <CalculatorIcon className="h-4 w-4" />
                                                                </button>
                                                            </div>
                                                            <span className="truncate max-w-xs">{row.name}</span>
                                                        </div>
                                                    ) : (
                                                        <span className="group-hover:text-indigo-700 group-hover:underline">{row.name}</span>
                                                    )}
                                                </td>

                                                {/* NEW: Expected Hours Column for Users */}
                                                {activeTab === 'users' && (
                                                    <td className="px-6 py-3 text-right font-mono text-gray-500">
                                                        {row.expectedHours || 0}h
                                                    </td>
                                                )}

                                                <td className={`px-6 py-3 text-right text-gray-600 font-mono ${activeTab === 'users' && row.hours < (row.expectedHours - 2) ? 'text-red-600 font-bold' : ''}`}>
                                                    {row.hours.toFixed(2)}h
                                                </td>
                                                <td className="px-6 py-3 text-right text-gray-900 font-mono font-bold">{formatCurrency(row.cost)}</td>

                                                {activeTab === 'projects' && (
                                                    <>
                                                        <td className="px-6 py-3 text-right text-blue-600 font-mono font-medium">{formatCurrency(row.rfpValue)}</td>
                                                        <td className="px-6 py-3 text-right text-purple-600 font-mono font-medium">{formatCurrency(row.invoiceValue)}</td>
                                                        <td className="px-6 py-3 text-right text-red-600 font-mono font-medium">{formatCurrency(row.creditNoteValue)}</td>
                                                    </>
                                                )}

                                                <td className="px-6 py-3 text-right text-gray-500 text-xs">
                                                    {activeTab === 'projects' ? row.userCount : row.projectCount}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div className="text-right text-xs text-gray-400">
                        Generated at: {new Date(reportData.generatedAt.seconds * 1000).toLocaleString()}
                    </div>
                </>
            )}

            {/* Drill-down Modal (User) */}
            <Modal show={!!selectedUser} onClose={() => setSelectedUser(null)} title={`Monthly Activity: ${selectedUser?.name}`} maxWidth="sm:max-w-3xl">
                <div className="space-y-4">
                    <div className="flex justify-between items-center bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                        <div>
                            <p className="text-xs text-indigo-500 uppercase font-bold">Total Contribution</p>
                            <p className="text-indigo-900 font-bold">{month}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-2xl font-bold text-indigo-700">{selectedUser?.hours.toFixed(2)}h</p>
                            <p className="text-sm text-indigo-500">{formatCurrency(selectedUser?.cost)}</p>
                        </div>
                    </div>

                    <div className="overflow-hidden border border-gray-200 rounded-lg">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 text-left font-bold text-gray-500 uppercase text-xs">Project</th>
                                    <th className="px-4 py-2 text-right font-bold text-gray-500 uppercase text-xs">Hours</th>
                                    <th className="px-4 py-2 text-right font-bold text-gray-500 uppercase text-xs">Est. Cost</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                                {selectedUser?.breakdown && selectedUser.breakdown.length > 0 ? (
                                    selectedUser.breakdown.map((proj, i) => (
                                        <tr key={i} className="hover:bg-gray-50">
                                            <td className="px-4 py-2">
                                                <div className="flex flex-col">
                                                    <span className="font-mono text-xs text-orange-600 font-bold">{proj.number}</span>
                                                    <span className="text-gray-900 text-xs truncate max-w-md">{proj.name}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 text-right font-mono text-gray-700">{proj.hours.toFixed(2)}</td>
                                            <td className="px-4 py-2 text-right font-mono text-gray-500">{formatCurrency(proj.cost)}</td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr><td colSpan="3" className="p-4 text-center text-gray-400 italic">No detailed breakdown available.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex justify-end pt-2">
                        <button onClick={() => setSelectedUser(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-sm font-medium">Close</button>
                    </div>
                </div>
            </Modal>

            {/* Project Drill-down Modal (Contributors) */}
            <Modal show={!!selectedProject} onClose={() => setSelectedProject(null)} title={`Project Breakdown: ${selectedProject?.name}`} maxWidth="sm:max-w-3xl">
                <div className="space-y-4">
                    <div className="flex justify-between items-center bg-orange-50 p-4 rounded-lg border border-orange-100">
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="font-mono text-sm text-orange-600 font-bold">{selectedProject?.number}</span>
                                <span className="text-orange-900 font-bold text-sm truncate max-w-xs">{selectedProject?.name}</span>
                            </div>
                            <p className="text-xs text-orange-500 uppercase mt-1 font-bold">{month}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-2xl font-bold text-orange-700">{selectedProject?.hours.toFixed(2)}h</p>
                            <p className="text-sm text-orange-500">{formatCurrency(selectedProject?.cost)}</p>
                        </div>
                    </div>

                    <div className="overflow-hidden border border-gray-200 rounded-lg">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 text-left font-bold text-gray-500 uppercase text-xs">Contributor</th>
                                    <th className="px-4 py-2 text-right font-bold text-gray-500 uppercase text-xs">Hours</th>
                                    <th className="px-4 py-2 text-right font-bold text-gray-500 uppercase text-xs">Labor Cost</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                                {projectContributors.length > 0 ? (
                                    projectContributors.map((user, i) => (
                                        <tr key={i} className="hover:bg-gray-50">
                                            <td className="px-4 py-2 font-medium text-gray-900">{user.name}</td>
                                            <td className="px-4 py-2 text-right font-mono text-gray-700">{user.hours.toFixed(2)}</td>
                                            <td className="px-4 py-2 text-right font-mono text-gray-500">{formatCurrency(user.cost)}</td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr><td colSpan="3" className="p-4 text-center text-gray-400 italic">No contributor data found.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex justify-end pt-2">
                        <button onClick={() => setSelectedProject(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-sm font-medium">Close</button>
                    </div>
                </div>
            </Modal>

            {/* Audit Modal (From Calculator Icon) */}
            {auditProjectNumber && (
                <ProjectCostAuditModal
                    show={true}
                    onClose={() => setAuditProjectNumber(null)}
                    projectNumber={auditProjectNumber}
                />
            )}
        </div>
    );
};

export default MonthlyFinancialReport;