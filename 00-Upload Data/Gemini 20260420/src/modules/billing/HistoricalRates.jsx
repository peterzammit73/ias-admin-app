// Root: src/modules/billing/HistoricalRates.jsx
// Version: 3.1 - Added Last Updated Timestamp
import React, { useState, useEffect } from 'react';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase.js';
import { ArrowPathIcon, TableCellsIcon, CurrencyEuroIcon, ClockIcon } from '@heroicons/react/24/outline';

const generateFinancialReportFn = httpsCallable(functions, 'generateFinancialReport');

const HistoricalRates = () => {
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [statusData, setStatusData] = useState({ isStale: false });
    const [lastUpdated, setLastUpdated] = useState(null); // New state for timestamp

    const [ratesData, setRatesData] = useState([]);
    const [years, setYears] = useState([]);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [showInactive, setShowInactive] = useState(false);
    const [viewMode, setViewMode] = useState('hourly'); // 'hourly' | 'monthly'

    // Tooltip State
    const [hoveredData, setHoveredData] = useState(null);
    const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });

    // 1. Listen for Stale Status
    useEffect(() => {
        const unsub = onSnapshot(doc(db, 'settings', 'financial_status'), (docSnap) => {
            if (docSnap.exists()) {
                setStatusData(docSnap.data());
            }
        });
        return () => unsub();
    }, []);

    // 2. Fetch Available Years & Last Updated (Meta)
    useEffect(() => {
        const fetchMeta = async () => {
            try {
                const metaSnap = await getDoc(doc(db, 'reports', 'financial_history_meta'));
                if (metaSnap.exists()) {
                    const data = metaSnap.data();
                    if (data.availableYears) {
                        setYears(data.availableYears.sort((a, b) => b - a));
                    }
                    // Capture generatedAt timestamp
                    if (data.generatedAt) {
                        const dateObj = data.generatedAt.toDate ? data.generatedAt.toDate() : new Date(data.generatedAt);
                        setLastUpdated(dateObj);
                    }
                } else {
                    // Initialize if empty
                    const current = new Date().getFullYear();
                    setYears([current, current - 1]);
                }
            } catch (e) { console.error(e); }
        };
        fetchMeta();
    }, [generating]); // Re-fetch after generation

    // 3. Listen to Active Report Year
    useEffect(() => {
        setLoading(true);
        const reportRef = doc(db, 'reports', `financial_history_${selectedYear}`);

        const unsub = onSnapshot(reportRef, (docSnap) => {
            if (docSnap.exists()) {
                setRatesData(docSnap.data().rows || []);
                setLoading(false);
            } else {
                setRatesData([]);
                setLoading(false);
            }
        });
        return () => unsub();
    }, [selectedYear, generating]);

    const handleGenerate = async () => {
        setGenerating(true);
        try {
            await generateFinancialReportFn();
        } catch (error) {
            console.error("Failed to generate report:", error);
            alert("Report generation failed.");
        } finally {
            setGenerating(false);
        }
    };

    const displayedRates = ratesData.filter(emp => showInactive || emp.isActiveEmployee);

    const handleMouseEnter = (e, data) => {
        if (!data || data.value <= 0) return;
        const rect = e.target.getBoundingClientRect();
        setHoverPosition({ x: rect.left + window.scrollX, y: rect.bottom + window.scrollY });
        setHoveredData(data);
    };

    const handleMouseLeave = () => {
        setHoveredData(null);
    };

    const formatVal = (data) => {
        if (!data || data.value <= 0) return '-';
        return viewMode === 'hourly'
            ? `€${data.value.toFixed(2)}`
            : `€${Math.round(data.cost).toLocaleString()}`;
    };

    // Format Last Updated Text
    const lastUpdatedText = lastUpdated
        ? lastUpdated.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'Never';

    return (
        <div className="p-6 bg-gray-50 min-h-screen relative">

            {/* Tooltip */}
            {hoveredData && hoveredData.breakdown && (
                <div
                    className="absolute z-50 bg-gray-900 text-white text-xs rounded shadow-lg p-2 pointer-events-none transform -translate-x-1/2 mt-1"
                    style={{ left: hoverPosition.x + 20, top: hoverPosition.y }}
                >
                    <div className="font-bold border-b border-gray-700 pb-1 mb-1">
                        Breakdown ({viewMode === 'hourly' ? 'Hourly' : 'Monthly'})
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        <span className="text-gray-400">Direct:</span>
                        <span className="text-right">€{hoveredData.breakdown.directRate?.toFixed(2)}</span>

                        <span className="text-gray-400">Overhead:</span>
                        <span className="text-right">€{hoveredData.breakdown.overheadRate?.toFixed(2)}</span>

                        <span className="text-gray-400">Non-Prod:</span>
                        <span className="text-right">€{hoveredData.breakdown.nonProdRate?.toFixed(2)}</span>

                        <div className="col-span-2 border-t border-gray-700 my-1"></div>
                        <span className="text-gray-300 font-bold">Total:</span>
                        <span className="text-right font-bold">€{hoveredData.value?.toFixed(2)}</span>
                    </div>
                </div>
            )}

            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                        <TableCellsIcon className="h-8 w-8 text-indigo-600 mr-2" />
                        Historical Financial Data
                    </h1>
                    <div className="flex items-center gap-2 mt-1">
                        <p className="text-sm text-gray-500">
                            Fully loaded hourly rates & monthly costs.
                        </p>
                        {/* Status Badge */}
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${statusData.isStale
                                ? 'bg-orange-50 text-orange-600 border-orange-200'
                                : 'bg-green-50 text-green-600 border-green-200'
                            }`}>
                            {statusData.isStale ? 'Updates Available' : `Data Current (${lastUpdatedText})`}
                        </span>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row items-end sm:items-center gap-4 w-full xl:w-auto justify-end">

                    <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className={`flex items-center px-4 py-2 text-sm font-medium rounded-md shadow-sm transition-colors ${statusData.isStale
                                ? 'bg-orange-600 text-white hover:bg-orange-700 animate-pulse'
                                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-300'
                            }`}
                    >
                        <ArrowPathIcon className={`h-4 w-4 mr-2 ${generating ? 'animate-spin' : ''}`} />
                        {generating ? 'Calculating...' : 'Recalculate Data'}
                    </button>

                    {/* View Mode Toggle */}
                    <div className="flex bg-gray-200 p-1 rounded-lg">
                        <button
                            onClick={() => setViewMode('hourly')}
                            className={`flex items-center px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === 'hourly'
                                    ? 'bg-white text-indigo-600 shadow-sm'
                                    : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            <ClockIcon className="h-4 w-4 mr-1.5" />
                            Hourly Rate
                        </button>
                        <button
                            onClick={() => setViewMode('monthly')}
                            className={`flex items-center px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === 'monthly'
                                    ? 'bg-white text-indigo-600 shadow-sm'
                                    : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            <CurrencyEuroIcon className="h-4 w-4 mr-1.5" />
                            Monthly Cost
                        </button>
                    </div>

                    {/* Inactive Employees Toggle */}
                    <div className="flex items-center bg-white border border-gray-300 rounded-md px-3 py-1.5 shadow-sm">
                        <input
                            id="showInactive"
                            type="checkbox"
                            checked={showInactive}
                            onChange={(e) => setShowInactive(e.target.checked)}
                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded cursor-pointer"
                        />
                        <label htmlFor="showInactive" className="ml-2 text-sm text-gray-700 cursor-pointer select-none">
                            Inactive
                        </label>
                    </div>

                    {/* Year Selector */}
                    <div className="flex items-center">
                        <select
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(Number(e.target.value))}
                            className="rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm py-1.5"
                        >
                            {years.length > 0 ? (
                                years.map(y => <option key={y} value={y}>{y}</option>)
                            ) : (
                                <option value={new Date().getFullYear()}>{new Date().getFullYear()}</option>
                            )}
                        </select>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center items-center h-64">
                    <ArrowPathIcon className="h-10 w-10 text-indigo-500 animate-spin" />
                    <span className="ml-3 text-gray-500 font-medium">Loading cached data...</span>
                </div>
            ) : (
                <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 z-10 border-r border-gray-200">
                                        Employee
                                    </th>
                                    {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(m => (
                                        <th key={m} scope="col" className="px-1 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            {m}
                                        </th>
                                    ))}
                                    <th scope="col" className="px-2 py-2 text-right text-xs font-medium text-gray-700 uppercase tracking-wider bg-gray-100 border-l border-gray-200">
                                        Avg
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {displayedRates.map((employee) => {
                                    // Filter valid months from the objects
                                    const validMonths = employee.months.filter(m => m.value > 0);
                                    const avgValue = validMonths.length > 0
                                        ? validMonths.reduce((a, b) => a + (viewMode === 'hourly' ? b.value : b.cost), 0) / validMonths.length
                                        : 0;

                                    return (
                                        <tr key={employee.id} className="hover:bg-gray-50">
                                            <td className="px-2 py-1 whitespace-nowrap text-xs font-medium text-gray-900 sticky left-0 bg-white border-r border-gray-100">
                                                {employee.name}
                                                {!employee.isActiveEmployee && (
                                                    <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                                                        Inactive
                                                    </span>
                                                )}
                                            </td>
                                            {employee.months.map((data, idx) => (
                                                <td
                                                    key={idx}
                                                    className="px-1 py-1 whitespace-nowrap text-xs text-right text-gray-600 cursor-default"
                                                    onMouseEnter={(e) => handleMouseEnter(e, data)}
                                                    onMouseLeave={handleMouseLeave}
                                                >
                                                    {formatVal(data)}
                                                </td>
                                            ))}
                                            <td className="px-2 py-1 whitespace-nowrap text-xs text-right font-bold text-indigo-600 bg-gray-50 border-l border-gray-200">
                                                {viewMode === 'hourly'
                                                    ? `€${avgValue.toFixed(2)}`
                                                    : `€${Math.round(avgValue).toLocaleString()}`
                                                }
                                            </td>
                                        </tr>
                                    );
                                })}
                                {displayedRates.length === 0 && (
                                    <tr>
                                        <td colSpan="14" className="px-6 py-10 text-center text-gray-500">
                                            No employee data found matching criteria.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default HistoricalRates;