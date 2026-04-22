// Root: src/modules/admin/Reports.jsx
// Version: 2.0 - Data-Driven Project Types (Removes Hardcoded 2000 check)
import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useData } from '../../context/DataProvider.jsx';
import { SimpleBarChart, SimpleLineChart } from '../../components/SimpleCharts.jsx';
import {
    PresentationChartLineIcon,
    CurrencyDollarIcon,
    UserGroupIcon,
    ArrowPathIcon,
    CalendarIcon
} from '@heroicons/react/24/outline';

const Reports = () => {
    const { projects, employees } = useData();
    const [loading, setLoading] = useState(true);
    const [timeframe, setTimeframe] = useState('12'); // Months

    // Data State
    const [financialTrend, setFinancialTrend] = useState([]);
    const [projectPerformance, setProjectPerformance] = useState([]);
    const [utilizationData, setUtilizationData] = useState([]);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                // Determine Date Range
                const endDate = new Date();
                const startDate = new Date();
                startDate.setMonth(startDate.getMonth() - parseInt(timeframe));

                // 1. Fetch Invoiced Revenue (RFPs)
                const rfpQ = query(
                    collection(db, 'rfps'),
                    where('issuedAt', '>=', startDate),
                    orderBy('issuedAt', 'asc')
                );
                const rfpSnap = await getDocs(rfpQ);

                // 2. Fetch Timesheet Entries (Cost approximation) - Limit to last 3000 for perf
                const timeQ = query(
                    collection(db, 'timesheet_entries'),
                    where('date', '>=', startDate),
                    orderBy('date', 'asc'),
                    limit(3000)
                );
                const timeSnap = await getDocs(timeQ);

                // --- PROCESS DATA ---

                // A. Financial Trend (Revenue vs Cost) by Month
                const monthlyStats = {};

                // Initialize months
                let iter = new Date(startDate);
                while (iter <= endDate) {
                    const k = `${iter.getFullYear()}-${String(iter.getMonth() + 1).padStart(2, '0')}`;
                    monthlyStats[k] = { label: iter.toLocaleString('default', { month: 'short' }), revenue: 0, cost: 0, hours: 0 };
                    iter.setMonth(iter.getMonth() + 1);
                }

                rfpSnap.forEach(doc => {
                    const d = doc.data();
                    if (d.status === 'Superseded') return;
                    const date = d.issuedAt.toDate();
                    const k = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    if (monthlyStats[k]) {
                        monthlyStats[k].revenue += (d.totalAmount || d.amount || 0); // Use total or base
                    }
                });

                timeSnap.forEach(doc => {
                    const d = doc.data();
                    const date = d.date.toDate();
                    const k = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    const hours = parseFloat(d.duration) || 0;
                    // Approximate cost if not stored (e.g., avg €35/hr loaded cost)
                    const cost = d.cost ? parseFloat(d.cost) : (hours * 35);

                    if (monthlyStats[k]) {
                        monthlyStats[k].cost += cost;
                        monthlyStats[k].hours += hours;
                    }
                });

                const trendData = Object.values(monthlyStats);
                setFinancialTrend(trendData);

                // B. Project Performance (Top 10 by Revenue)
                const projStats = {};
                rfpSnap.forEach(doc => {
                    const d = doc.data();
                    if (d.status === 'Superseded') return;
                    const pid = d.projectNumber;
                    if (!projStats[pid]) projStats[pid] = { id: pid, revenue: 0, hours: 0 };
                    projStats[pid].revenue += (d.amount || 0);
                });

                timeSnap.forEach(doc => {
                    const d = doc.data();
                    const pid = d.project;
                    if (!projStats[pid]) projStats[pid] = { id: pid, revenue: 0, hours: 0 };
                    projStats[pid].hours += (parseFloat(d.duration) || 0);
                });

                const topProjects = Object.values(projStats)
                    .sort((a, b) => b.revenue - a.revenue)
                    .slice(0, 10)
                    .map(p => {
                        const projDetails = projects.find(item => String(item.projectNumber) === String(p.id));
                        return {
                            label: p.id,
                            name: projDetails ? projDetails.projectDescription : `Project ${p.id}`,
                            value: p.revenue,
                            hours: p.hours,
                            color: '#4f46e5'
                        };
                    });
                setProjectPerformance(topProjects);

                // C. Utilization (Billable vs Non-Billable Hours)
                // UPDATED LOGIC: Use projectType instead of hardcoded '2000'
                let billable = 0;
                let nonBillable = 0;

                timeSnap.forEach(doc => {
                    const d = doc.data();
                    const hours = parseFloat(d.duration) || 0;

                    // Look up project definition
                    const projectDef = projects.find(p => String(p.projectNumber) === String(d.project));

                    // Check type (Internal vs Standard/Misc)
                    // Legacy fallback: '2000' is internal
                    const isInternal = projectDef?.projectType === 'internal' || String(d.project) === '2000';

                    if (isInternal) nonBillable += hours;
                    else billable += hours;
                });

                setUtilizationData([
                    { label: 'Billable', value: billable, color: '#10b981' },
                    { label: 'Non-Billable', value: nonBillable, color: '#f59e0b' }
                ]);

            } catch (error) {
                console.error("Error generating reports:", error);
            } finally {
                setLoading(false);
            }
        };

        if (projects.length > 0) fetchData();
    }, [timeframe, projects]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Performance Reports</h2>
                    <p className="text-sm text-gray-500">Financial and operational insights.</p>
                </div>
                <div className="flex bg-white border border-gray-300 rounded-md p-1 shadow-sm">
                    <span className="flex items-center px-3 text-gray-500 text-xs font-medium uppercase border-r border-gray-200">
                        <CalendarIcon className="h-4 w-4 mr-1" /> Range
                    </span>
                    <select
                        value={timeframe}
                        onChange={(e) => setTimeframe(e.target.value)}
                        className="border-none text-sm focus:ring-0 py-1 text-gray-700 bg-transparent cursor-pointer"
                    >
                        <option value="6">Last 6 Months</option>
                        <option value="12">Last 12 Months</option>
                        <option value="24">Last 2 Years</option>
                    </select>
                </div>
            </div>

            {loading ? (
                <div className="h-64 flex items-center justify-center text-gray-500 bg-white rounded-lg shadow-sm">
                    <ArrowPathIcon className="h-8 w-8 animate-spin mr-2" /> Generating Reports...
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                    {/* 1. Revenue Trend */}
                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="font-bold text-gray-800 flex items-center">
                                <CurrencyDollarIcon className="h-5 w-5 mr-2 text-green-600" /> Revenue Trend
                            </h3>
                            <div className="text-xs text-gray-500">Total Invoiced (Excl. VAT)</div>
                        </div>
                        <SimpleLineChart data={financialTrend.map(d => ({ label: d.label, value: d.revenue }))} height={250} color="#059669" />
                    </div>

                    {/* 2. Top Projects */}
                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="font-bold text-gray-800 flex items-center">
                                <PresentationChartLineIcon className="h-5 w-5 mr-2 text-indigo-600" /> Top Projects
                            </h3>
                            <div className="text-xs text-gray-500">By Revenue</div>
                        </div>
                        <div className="space-y-3 max-h-[250px] overflow-y-auto">
                            {projectPerformance.map((p, i) => (
                                <div key={i} className="flex items-center text-sm">
                                    <span className="w-6 text-gray-400 text-xs">{i + 1}.</span>
                                    <div className="flex-1">
                                        <div className="flex justify-between mb-1">
                                            <span className="font-medium truncate pr-2" title={p.name}>{p.label} - {p.name}</span>
                                            <span className="font-mono text-gray-700">€{p.value.toLocaleString()}</span>
                                        </div>
                                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                                            <div className="bg-indigo-600 h-1.5 rounded-full" style={{ width: `${(p.value / projectPerformance[0].value) * 100}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 3. Utilization */}
                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="font-bold text-gray-800 flex items-center">
                                <UserGroupIcon className="h-5 w-5 mr-2 text-orange-600" /> Utilization
                            </h3>
                            <div className="text-xs text-gray-500">Hours Logged</div>
                        </div>
                        <div className="flex justify-center py-4">
                            <SimpleBarChart data={utilizationData} height={200} />
                        </div>
                        <div className="text-center text-xs text-gray-500 mt-2">
                            Billable Ratio: {utilizationData[0].value + utilizationData[1].value > 0
                                ? Math.round((utilizationData[0].value / (utilizationData[0].value + utilizationData[1].value)) * 100)
                                : 0}%
                        </div>
                    </div>

                    {/* 4. Cost vs Revenue Preview */}
                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="font-bold text-gray-800 flex items-center">
                                <CurrencyDollarIcon className="h-5 w-5 mr-2 text-red-600" /> Estimated Cost vs Revenue
                            </h3>
                        </div>
                        <div className="h-[250px] relative flex items-end justify-between gap-2">
                            {financialTrend.slice(-6).map((d, i) => {
                                const max = Math.max(...financialTrend.map(t => Math.max(t.revenue, t.cost)));
                                const revH = (d.revenue / max) * 100;
                                const costH = (d.cost / max) * 100;
                                return (
                                    <div key={i} className="flex-1 flex flex-col justify-end items-center h-full gap-1">
                                        <div className="w-full flex gap-1 items-end justify-center h-full">
                                            <div className="w-3 bg-green-500 rounded-t" style={{ height: `${revH}%` }} title={`Rev: ${d.revenue}`}></div>
                                            <div className="w-3 bg-red-400 rounded-t" style={{ height: `${costH}%` }} title={`Cost: ${d.cost}`}></div>
                                        </div>
                                        <span className="text-[10px] text-gray-500">{d.label}</span>
                                    </div>
                                )
                            })}
                        </div>
                        <div className="flex justify-center gap-4 mt-4 text-xs">
                            <span className="flex items-center"><span className="w-3 h-3 bg-green-500 mr-1 rounded"></span> Revenue</span>
                            <span className="flex items-center"><span className="w-3 h-3 bg-red-400 mr-1 rounded"></span> Est. Cost</span>
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
};

export default Reports;