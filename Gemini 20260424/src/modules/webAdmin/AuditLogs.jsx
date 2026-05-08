// Root: src/modules/webAdmin/AuditLogs.jsx
// Version: 1.3 - Using absolute import
import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '/src/firebase.js'; // Absolute import
import { ClipboardDocumentListIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

const AuditLogs = () => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        // In a real app, you would trigger writes to 'audit_logs' collection on critical actions.
        // This viewer displays that data.
        const fetchLogs = async () => {
            setLoading(true);
            try {
                // Fetch last 50 logs
                const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(50));
                const snapshot = await getDocs(q);
                const data = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    timestamp: doc.data().timestamp?.toDate()
                }));
                setLogs(data);
            } catch (error) {
                console.error("Error fetching audit logs:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchLogs();
    }, []);

    const filteredLogs = logs.filter(log => 
        (log.user && log.user.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (log.action && log.action.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
                <div className="flex items-center">
                    <div className="p-2 bg-indigo-100 rounded-lg mr-3">
                        <ClipboardDocumentListIcon className="h-6 w-6 text-indigo-600" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">System Audit Logs</h2>
                        <p className="text-sm text-gray-500">Track user activity and system changes.</p>
                    </div>
                </div>
                <div className="relative w-full sm:w-64">
                    <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-2.5 text-gray-400" />
                    <input 
                        type="text" 
                        placeholder="Search logs..." 
                        className="pl-10 w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-4 py-3 text-left font-medium text-gray-500">Timestamp</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-500">User</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-500">Action</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-500">Details</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {loading ? (
                            <tr><td colSpan="4" className="p-8 text-center text-gray-500">Loading logs...</td></tr>
                        ) : filteredLogs.length === 0 ? (
                            <tr><td colSpan="4" className="p-8 text-center text-gray-500">No audit logs found.</td></tr>
                        ) : (
                            filteredLogs.map(log => (
                                <tr key={log.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                                        {log.timestamp ? log.timestamp.toLocaleString() : '-'}
                                    </td>
                                    <td className="px-4 py-3 font-medium text-gray-900">
                                        {log.user || 'System'}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className="px-2 py-1 bg-gray-100 rounded text-xs font-semibold text-gray-700 border border-gray-200">
                                            {log.action}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-gray-600 max-w-md truncate">
                                        {log.details || '-'}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default AuditLogs;