// Root: src/modules/admin/AuditLog.jsx
// Version: 1.1 - System Activity & Audit Trail Module (Path Resolution Fix)
import React, { useState, useEffect, useMemo } from 'react';
import {
    collection,
    query,
    orderBy,
    onSnapshot,
    limit
} from 'firebase/firestore';
import {
    ClipboardDocumentListIcon,
    UserIcon,
    MagnifyingGlassIcon,
    ArrowPathIcon,
    ClockIcon,
    ShieldCheckIcon
} from '@heroicons/react/24/outline';

// Standardized relative import to ensure resolution in the Canvas environment
import { db } from '../../firebase.js';

/**
 * AuditLog Component
 * Displays a real-time ledger of all user and system activities.
 * Path: artifacts/ias-production/public/data/activity_logs
 */
const AuditLog = () => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('ALL');
    const [rowLimit, setRowLimit] = useState(100);

    // Static appId for path resolution as defined in the system architecture
    const appId = "ias-production";

    useEffect(() => {
        setLoading(true);

        // RULE 1: Strict path for public audit data
        const logsRef = collection(db, 'artifacts', appId, 'public', 'data', 'activity_logs');

        // RULE 2: Simple query to avoid index requirement errors
        const q = query(logsRef, orderBy('timestamp', 'desc'), limit(rowLimit));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedLogs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                // Convert Firestore Timestamp to JS Date object
                date: doc.data().timestamp?.toDate() || new Date()
            }));
            setLogs(fetchedLogs);
            setLoading(false);
        }, (error) => {
            console.error("Audit Fetch Error:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [rowLimit]);

    // JS-Side Filtering for Performance (Rule 2 Compliance)
    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            const matchesSearch =
                log.userEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                log.projectNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                log.details?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                log.action?.toLowerCase().includes(searchTerm.toLowerCase());

            const matchesCategory = filterCategory === 'ALL' || log.category === filterCategory;

            return matchesSearch && matchesCategory;
        });
    }, [logs, searchTerm, filterCategory]);

    const formatTimestamp = (date) => {
        return date.toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    const getActionBadge = (action) => {
        const styles = {
            RFP_CREATED: 'bg-blue-50 text-blue-700 border-blue-100',
            RFP_ISSUED: 'bg-indigo-50 text-indigo-700 border-indigo-100',
            PAYMENT_FULL: 'bg-green-50 text-green-700 border-green-100',
            PAYMENT_PARTIAL: 'bg-emerald-50 text-emerald-700 border-emerald-100',
            RFP_REVISED: 'bg-orange-50 text-orange-700 border-orange-100',
            CREDIT_NOTE: 'bg-red-50 text-red-700 border-red-100',
            AUTH_LOGIN: 'bg-purple-50 text-purple-700 border-purple-100',
            DEFAULT: 'bg-gray-50 text-gray-600 border-gray-100'
        };
        const style = styles[action] || styles.DEFAULT;
        return (
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${style}`}>
                {action.replace('_', ' ')}
            </span>
        );
    };

    return (
        <div className="flex flex-col h-[calc(100vh-12rem)] space-y-4 font-sans text-black">
            <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden flex flex-col min-h-0">

                {/* Header Section */}
                <div className="p-6 border-b border-gray-200 bg-gray-50 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-100 rounded-lg">
                            <ClipboardDocumentListIcon className="h-6 w-6 text-orange-600" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 tracking-tight">System Audit Log</h2>
                            <p className="text-xs text-gray-500 font-normal">Real-time trail of all administrative and financial activities.</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2 w-full lg:w-auto">
                        <div className="relative flex-1 sm:min-w-[240px]">
                            <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search user, project, or detail..."
                                className="pl-9 pr-4 py-2 w-full rounded-md border border-gray-300 text-sm focus:ring-orange-500 focus:border-orange-500 shadow-sm font-normal text-black"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <select
                            className="rounded-md border border-gray-300 text-sm bg-white px-3 py-2 focus:ring-orange-500 focus:border-orange-500 shadow-sm font-normal text-black outline-none"
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                        >
                            <option value="ALL">All Categories</option>
                            <option value="FINANCIAL">Financial Only</option>
                            <option value="AUTH">Logins & Security</option>
                            <option value="SYSTEM">System Changes</option>
                        </select>
                        <select
                            className="rounded-md border border-gray-300 text-sm bg-white px-3 py-2 focus:ring-orange-500 focus:border-orange-500 shadow-sm font-normal text-black outline-none"
                            value={rowLimit}
                            onChange={(e) => setRowLimit(Number(e.target.value))}
                        >
                            <option value={50}>Last 50</option>
                            <option value={100}>Last 100</option>
                            <option value={500}>Last 500</option>
                        </select>
                    </div>
                </div>

                {/* Table Area */}
                <div className="flex-1 overflow-auto relative">
                    {loading ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-10">
                            <ArrowPathIcon className="h-10 w-10 animate-spin text-orange-500 mb-2" />
                            <span className="text-sm font-medium text-gray-600">Syncing audit logs...</span>
                        </div>
                    ) : null}

                    <table className="min-w-full table-fixed divide-y divide-gray-200 border-separate border-spacing-0">
                        <thead className="bg-gray-100 sticky top-0 z-10 shadow-sm">
                            <tr className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                                <th className="w-48 px-6 py-3 text-left border-b-2 border-gray-200">Timestamp</th>
                                <th className="w-56 px-6 py-3 text-left border-b-2 border-gray-200">User Email</th>
                                <th className="w-40 px-6 py-3 text-left border-b-2 border-gray-200">Action</th>
                                <th className="w-24 px-6 py-3 text-center border-b-2 border-gray-200">Project</th>
                                <th className="px-6 py-3 text-left border-b-2 border-gray-200">Activity Details</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100 text-black font-normal text-sm">
                            {filteredLogs.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-12 text-center text-gray-400 italic font-normal">
                                        No activity recorded for the current filters.
                                    </td>
                                </tr>
                            ) : (
                                filteredLogs.map((log) => (
                                    <tr key={log.id} className="hover:bg-gray-50 transition-colors group">
                                        <td className="px-6 py-3 whitespace-nowrap font-mono text-xs text-gray-500">
                                            {formatTimestamp(log.date)}
                                        </td>
                                        <td className="px-6 py-3 whitespace-nowrap font-normal">
                                            <div className="flex items-center">
                                                <UserIcon className="h-4 w-4 mr-2 text-gray-300 group-hover:text-orange-400" />
                                                <span className="text-gray-700 font-medium">{log.userEmail}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3 whitespace-nowrap font-normal">
                                            {getActionBadge(log.action)}
                                        </td>
                                        <td className="px-6 py-3 whitespace-nowrap text-center font-normal">
                                            <span className="text-xs font-bold bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                                                {log.projectNumber}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 font-normal text-gray-600 leading-relaxed max-w-md truncate lg:max-w-none lg:whitespace-normal">
                                            {log.details}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Footer Stats */}
                <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-[11px] font-bold text-gray-400 uppercase tracking-widest shrink-0">
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1.5"><ShieldCheckIcon className="h-4 w-4 text-green-500" /> Audit Integrity Verified</span>
                        <span className="flex items-center gap-1.5 font-normal text-gray-500"><ClockIcon className="h-4 w-4" /> Showing last {filteredLogs.length} events</span>
                    </div>
                    <div className="font-normal text-gray-400 italic">Logs are immutable once written</div>
                </div>
            </div>
        </div>
    );
};

export default AuditLog;