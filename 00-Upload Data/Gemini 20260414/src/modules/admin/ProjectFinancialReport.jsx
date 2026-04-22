// Root: src/modules/admin/ProjectFinancialReport.jsx
// Version: 2.1 - Fixed Euro Symbol Encoding & CSV BOM
import React, { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase.js';
import {
    ArrowDownTrayIcon,
    MagnifyingGlassIcon,
    ArrowPathIcon,
    CurrencyEuroIcon,
    ClockIcon,
    DocumentTextIcon,
    BarsArrowUpIcon,
    BarsArrowDownIcon,
    TableCellsIcon
} from '@heroicons/react/24/outline';

const ProjectFinancialReport = () => {
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [reportData, setReportData] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'Active', 'Non-Active'
    const [sortConfig, setSortConfig] = useState({ key: 'projectNumber', direction: 'asc' });

    // Configurable average rate for labor estimation if exact cost isn't stored
    const [avgHourlyRate, setAvgHourlyRate] = useState(35);

    // Listen to the cached report document
    useEffect(() => {
        setLoading(true);
        const unsub = onSnapshot(doc(db, 'reports', 'global_project_financials'), (docSnap) => {
            if (docSnap.exists()) {
                setReportData(docSnap.data());
            } else {
                setReportData(null);
            }
            setLoading(false);
        });
        return () => unsub();
    }, []);

    const handleRefresh = async () => {
        setGenerating(true);
        try {
            const functions = getFunctions();
            const generateFn = httpsCallable(functions, 'generateGlobalProjectReport');
            await generateFn();
            // Listener will update UI automatically
        } catch (error) {
            console.error("Error generating report:", error);
            alert("Failed to refresh report data.");
        } finally {
            setGenerating(false);
        }
    };

    // --- COMPUTED DATA ---
    const processedData = useMemo(() => {
        if (!reportData || !reportData.projects) return [];

        let filtered = reportData.projects.filter(item => {
            // Search Filter
            const search = searchTerm.toLowerCase();
            const matchSearch = String(item.projectNumber).includes(search) ||
                String(item.name).toLowerCase().includes(search);

            // Status Filter
            const matchStatus = statusFilter === 'all' || item.status === statusFilter;

            return matchSearch && matchStatus;
        });

        // Apply Labor Cost Calculation
        // Use stored labor cost if available, otherwise fallback to Hours * UserRate
        filtered = filtered.map(item => ({
            ...item,
            calculatedLabor: item.laborCostStored > 0 ? item.laborCostStored : (item.hours * avgHourlyRate)
        }));

        // Sort
        return filtered.sort((a, b) => {
            let valA = a[sortConfig.key];
            let valB = b[sortConfig.key];

            // Numerical sorting for specific columns
            if (['hours', 'calculatedLabor', 'expenses', 'rfpIssued', 'invoiced', 'credited'].includes(sortConfig.key)) {
                valA = parseFloat(valA) || 0;
                valB = parseFloat(valB) || 0;
            } else if (sortConfig.key === 'projectNumber') {
                valA = parseInt(valA) || 0;
                valB = parseInt(valB) || 0;
            } else {
                valA = String(valA).toLowerCase();
                valB = String(valB).toLowerCase();
            }

            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [reportData, searchTerm, statusFilter, sortConfig, avgHourlyRate]);

    const totals = useMemo(() => {
        return processedData.reduce((acc, item) => ({
            hours: acc.hours + item.hours,
            labor: acc.labor + item.calculatedLabor,
            expenses: acc.expenses + item.expenses,
            rfp: acc.rfp + item.rfpIssued,
            invoiced: acc.invoiced + item.invoiced,
            credited: acc.credited + item.credited
        }), { hours: 0, labor: 0, expenses: 0, rfp: 0, invoiced: 0, credited: 0 });
    }, [processedData]);

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    // Use Unicode Escape Sequence for Euro Symbol
    const formatCurrency = (val) => `\u20AC${(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const handleExportCSV = () => {
        const headers = ["Project No", "Project Name", "Status", "Total Hours", "Est. Labor Cost", "Total Expenses", "RFPs Issued (Gross)", "Invoiced (Paid)", "Credit Notes"];

        const rows = processedData.map(p => [
            p.projectNumber,
            `"${p.name.replace(/"/g, '""')}"`,
            p.status,
            p.hours.toFixed(2),
            p.calculatedLabor.toFixed(2),
            p.expenses.toFixed(2),
            p.rfpIssued.toFixed(2),
            p.invoiced.toFixed(2),
            p.credited.toFixed(2)
        ]);

        const totalRow = ["TOTALS", "", "", totals.hours.toFixed(2), totals.labor.toFixed(2), totals.expenses.toFixed(2), totals.rfp.toFixed(2), totals.invoiced.toFixed(2), totals.credited.toFixed(2)];

        // Add Byte Order Mark (\uFEFF) for Excel compatibility
        const csvContent = "data:text/csv;charset=utf-8,\uFEFF"
            + [headers.join(','), ...rows.map(r => r.join(',')), totalRow.join(',')].join('\n');

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Project_Financials_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const SortIcon = ({ columnKey }) => {
        if (sortConfig.key !== columnKey) return <BarsArrowUpIcon className="h-3 w-3 inline ml-1 opacity-20 group-hover:opacity-50" />;
        return sortConfig.direction === 'asc'
            ? <BarsArrowUpIcon className="h-3 w-3 inline ml-1 text-indigo-600" />
            : <BarsArrowDownIcon className="h-3 w-3 inline ml-1 text-indigo-600" />;
    };

    const lastUpdated = reportData?.generatedAt?.seconds
        ? new Date(reportData.generatedAt.seconds * 1000).toLocaleString()
        : 'Never';

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Project Financial Report</h1>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-sm text-gray-500">Comprehensive ledger of all project costs, time, and billing.</span>
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded border">
                                Last Updated: {lastUpdated}
                            </span>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleRefresh}
                            disabled={generating}
                            className={`flex items-center px-4 py-2 text-white rounded-md transition-colors text-sm font-medium shadow-sm ${generating ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                        >
                            <ArrowPathIcon className={`h-4 w-4 mr-2 ${generating ? 'animate-spin' : ''}`} />
                            {generating ? 'Consolidating Data...' : 'Generate Report'}
                        </button>
                        <button onClick={handleExportCSV} disabled={processedData.length === 0} className="flex items-center px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium shadow-sm">
                            <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
                            Export CSV
                        </button>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap gap-4 items-end mb-6 bg-gray-50 p-4 rounded-lg border border-gray-100">
                    <div className="flex-1 min-w-[200px]">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Search</label>
                        <div className="relative">
                            <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search project number or name..."
                                className="w-full pl-9 py-2 border rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Status</label>
                        <select
                            className="py-2 pl-3 pr-8 border rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                        >
                            <option value="all">All Projects</option>
                            <option value="Active">Active Only</option>
                            <option value="Non-Active">Inactive Only</option>
                        </select>
                    </div>
                    <div className="w-32">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1" title="Used if exact cost history isn't available">Est. Rate (\u20AC/h)</label>
                        <input
                            type="number"
                            className="w-full py-2 px-3 border rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500"
                            value={avgHourlyRate}
                            onChange={e => setAvgHourlyRate(parseFloat(e.target.value) || 0)}
                        />
                    </div>
                </div>

                {!reportData && !loading && (
                    <div className="p-12 text-center border-2 border-dashed border-gray-200 rounded-lg text-gray-400 mb-6">
                        <TableCellsIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>No report data found. Click <strong>Generate Report</strong> to compile data from the server.</p>
                    </div>
                )}

                {/* Totals Summary */}
                {reportData && (
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
                        <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                            <p className="text-[10px] uppercase font-bold text-blue-500 mb-1 flex items-center"><ClockIcon className="h-3 w-3 mr-1" /> Total Hours</p>
                            <p className="text-lg font-bold text-blue-900">{totals.hours.toLocaleString()}h</p>
                        </div>
                        <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                            <p className="text-[10px] uppercase font-bold text-indigo-500 mb-1 flex items-center"><CurrencyEuroIcon className="h-3 w-3 mr-1" /> Est. Labor</p>
                            <p className="text-lg font-bold text-indigo-900">{formatCurrency(totals.labor)}</p>
                        </div>
                        <div className="p-3 bg-orange-50 rounded-lg border border-orange-100">
                            <p className="text-[10px] uppercase font-bold text-orange-500 mb-1 flex items-center"><TableCellsIcon className="h-3 w-3 mr-1" /> Expenses</p>
                            <p className="text-lg font-bold text-orange-900">{formatCurrency(totals.expenses)}</p>
                        </div>
                        <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                            <p className="text-[10px] uppercase font-bold text-purple-500 mb-1 flex items-center"><DocumentTextIcon className="h-3 w-3 mr-1" /> Issued (Gross)</p>
                            <p className="text-lg font-bold text-purple-900">{formatCurrency(totals.rfp)}</p>
                        </div>
                        <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                            <p className="text-[10px] uppercase font-bold text-green-600 mb-1">Paid (Invoiced)</p>
                            <p className="text-lg font-bold text-green-900">{formatCurrency(totals.invoiced)}</p>
                        </div>
                        <div className="p-3 bg-red-50 rounded-lg border border-red-100">
                            <p className="text-[10px] uppercase font-bold text-red-500 mb-1">Credited</p>
                            <p className="text-lg font-bold text-red-900">{formatCurrency(totals.credited)}</p>
                        </div>
                    </div>
                )}

                {/* Table */}
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                <th className="px-4 py-3 text-left font-bold text-gray-500 uppercase text-xs cursor-pointer group" onClick={() => handleSort('projectNumber')}>
                                    Project <SortIcon columnKey="projectNumber" />
                                </th>
                                <th className="px-4 py-3 text-left font-bold text-gray-500 uppercase text-xs">Name</th>
                                <th className="px-4 py-3 text-right font-bold text-gray-500 uppercase text-xs cursor-pointer group" onClick={() => handleSort('hours')}>
                                    Hours <SortIcon columnKey="hours" />
                                </th>
                                <th className="px-4 py-3 text-right font-bold text-gray-500 uppercase text-xs cursor-pointer group" onClick={() => handleSort('calculatedLabor')}>
                                    Labor Cost <SortIcon columnKey="calculatedLabor" />
                                </th>
                                <th className="px-4 py-3 text-right font-bold text-gray-500 uppercase text-xs cursor-pointer group" onClick={() => handleSort('expenses')}>
                                    Expenses <SortIcon columnKey="expenses" />
                                </th>
                                <th className="px-4 py-3 text-right font-bold text-blue-600 uppercase text-xs cursor-pointer group" onClick={() => handleSort('rfpIssued')}>
                                    RFP Issued <SortIcon columnKey="rfpIssued" />
                                </th>
                                <th className="px-4 py-3 text-right font-bold text-green-600 uppercase text-xs cursor-pointer group" onClick={() => handleSort('invoiced')}>
                                    Paid <SortIcon columnKey="invoiced" />
                                </th>
                                <th className="px-4 py-3 text-right font-bold text-red-600 uppercase text-xs cursor-pointer group" onClick={() => handleSort('credited')}>
                                    Credit <SortIcon columnKey="credited" />
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                            {loading ? (
                                <tr><td colSpan="8" className="p-8 text-center text-gray-500">Loading data...</td></tr>
                            ) : processedData.length === 0 ? (
                                <tr><td colSpan="8" className="p-8 text-center text-gray-500">No projects found matching criteria.</td></tr>
                            ) : (
                                processedData.map(p => (
                                    <tr key={p.projectNumber} className="hover:bg-gray-50">
                                        <td className="px-4 py-3 font-mono text-gray-900 font-bold">{p.projectNumber}</td>
                                        <td className="px-4 py-3 text-gray-600 truncate max-w-xs" title={p.name}>{p.name}</td>
                                        <td className="px-4 py-3 text-right font-mono text-gray-700">{p.hours.toFixed(2)}</td>
                                        <td className="px-4 py-3 text-right font-mono text-gray-700">{formatCurrency(p.calculatedLabor)}</td>
                                        <td className="px-4 py-3 text-right font-mono text-gray-700">{formatCurrency(p.expenses)}</td>
                                        <td className="px-4 py-3 text-right font-mono text-blue-700 font-medium">{formatCurrency(p.rfpIssued)}</td>
                                        <td className="px-4 py-3 text-right font-mono text-green-700 font-medium">{formatCurrency(p.invoiced)}</td>
                                        <td className="px-4 py-3 text-right font-mono text-red-600">{p.credited > 0 ? formatCurrency(p.credited) : '-'}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {reportData && (
                    <div className="mt-2 text-right text-xs text-gray-400">
                        * Costs are estimated using hourly rate if explicit historical cost data is unavailable.
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProjectFinancialReport;