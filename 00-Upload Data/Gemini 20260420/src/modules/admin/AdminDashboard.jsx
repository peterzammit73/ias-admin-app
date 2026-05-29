import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db } from '../../firebase.js'; // Corrected relative import
import {
    UsersIcon,
    ClockIcon,
    DocumentTextIcon,
    BanknotesIcon,
    ArrowRightIcon,
    ShieldCheckIcon,
    CalendarDaysIcon,
    ExclamationCircleIcon
} from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';

const AdminDashboard = () => {
    const navigate = useNavigate();
    const [stats, setStats] = useState({
        activeStaff: 0,
        pendingLeave: 0,
        pendingRFPs: 0,
        recentLogs: [],
        staffOffToday: []
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchDashboardData = async () => {
            try {
                // 1. Active Staff & Who's Off Today
                const staffQ = query(collection(db, 'employees'), where('isEmployed', '==', true));
                const staffSnap = await getDocs(staffQ);

                const today = new Date();
                const currentYear = today.getFullYear();
                const dayKey = `${today.getMonth() + 1}-${today.getDate()}`;

                const staffOffToday = [];
                staffSnap.forEach(doc => {
                    const emp = doc.data();
                    const leaveEntry = emp.leave?.[currentYear]?.[dayKey];

                    if (leaveEntry && leaveEntry.type !== 'work') {
                        staffOffToday.push({
                            id: doc.id,
                            name: `${emp.name} ${emp.surname}`,
                            type: leaveEntry.type === 'sick' ? 'Sick Leave' : 'Vacation',
                            duration: leaveEntry.hours === 4 ? 'Half Day' : 'Full Day',
                            status: leaveEntry.status || 'approved'
                        });
                    }
                });

                // 2. Pending Leave Requests
                const leaveQ = query(collection(db, 'leaveRequests'), where('status', '==', 'pending'));
                const leaveSnap = await getDocs(leaveQ);

                // 3. Pending RFPs
                const rfpQ = query(collection(db, 'rfps'), where('status', '==', 'Pending'));
                const rfpSnap = await getDocs(rfpQ);

                // 4. Recent Audit Logs (Last 10 for scrolling)
                const logsQ = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(10));
                const logsSnap = await getDocs(logsQ);
                const recentLogs = logsSnap.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    timestamp: doc.data().timestamp?.toDate()
                }));

                setStats({
                    activeStaff: staffSnap.size,
                    pendingLeave: leaveSnap.size,
                    pendingRFPs: rfpSnap.size,
                    recentLogs,
                    staffOffToday
                });
            } catch (error) {
                console.error("Error loading dashboard stats:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchDashboardData();
    }, []);

    const StatCard = ({ title, count, icon, color, onClick, linkText }) => (
        <div
            onClick={onClick}
            className="bg-white p-5 sm:p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer flex flex-col justify-between h-28 sm:h-32"
        >
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-xs sm:text-sm font-medium text-gray-500 uppercase tracking-wider">{title}</p>
                    <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">{loading ? '-' : count}</p>
                </div>
                <div className={`p-2 sm:p-3 rounded-full ${color} bg-opacity-10 text-opacity-100`}>
                    {React.cloneElement(icon, { className: `h-5 w-5 sm:h-6 sm:w-6 ${color.replace('bg-', 'text-')}` })}
                </div>
            </div>
            <div className="flex items-center text-xs font-semibold text-indigo-600 mt-2">
                {linkText} <ArrowRightIcon className="h-3 w-3 ml-1" />
            </div>
        </div>
    );

    return (
        <div className="space-y-6 sm:space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900">System Overview</h2>
                    <p className="text-sm text-gray-500">Welcome back. Here is what's happening today.</p>
                </div>
            </div>

            {/* Stats Grid - Responsive Columns (1 -> 2 -> 3) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
                <StatCard
                    title="Active Staff"
                    count={stats.activeStaff}
                    icon={<UsersIcon />}
                    color="bg-blue-500"
                    linkText="View Directory"
                    onClick={() => navigate('/office-admin/staff')}
                />
                <StatCard
                    title="Pending Leave"
                    count={stats.pendingLeave}
                    icon={<ClockIcon />}
                    color="bg-orange-500"
                    linkText="Manage Requests"
                    onClick={() => navigate('/office-admin/leave')}
                />
                <StatCard
                    title="Pending RFPs"
                    count={stats.pendingRFPs}
                    icon={<DocumentTextIcon />}
                    color="bg-green-500"
                    linkText="Go to Billing"
                    onClick={() => navigate('/billing/pending')}
                />
            </div>

            {/* Content Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">

                {/* Left Column: Who's Off & Quick Actions */}
                <div className="lg:col-span-1 space-y-6 sm:space-y-8">

                    {/* Who's Off Today Widget */}
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-base sm:text-lg font-bold text-gray-900 flex items-center">
                                <CalendarDaysIcon className="h-5 w-5 mr-2 text-indigo-600" /> Who's Off Today
                            </h3>
                            <span className="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-1 rounded">
                                {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                        </div>

                        {loading ? (
                            <p className="text-sm text-gray-500 italic">Checking calendar...</p>
                        ) : stats.staffOffToday.length === 0 ? (
                            <div className="text-center py-4 text-gray-500 text-sm">
                                <UsersIcon className="h-8 w-8 mx-auto text-gray-300 mb-2" />
                                <p>Everyone is in the office.</p>
                            </div>
                        ) : (
                            // Constrained height with scroll for mobile
                            <div className="space-y-3 max-h-48 sm:max-h-64 overflow-y-auto pr-1">
                                {stats.staffOffToday.map((emp, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                                        <div className="flex items-center">
                                            <div className={`w-2 h-2 rounded-full mr-3 ${emp.type === 'Sick Leave' ? 'bg-yellow-400' : 'bg-green-500'}`}></div>
                                            <div>
                                                <p className="text-sm font-semibold text-gray-800">{emp.name}</p>
                                                <p className="text-xs text-gray-500">{emp.type}</p>
                                            </div>
                                        </div>
                                        <span className="text-xs font-medium px-2 py-1 bg-white border rounded text-gray-600">
                                            {emp.duration}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Quick Actions */}
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
                        <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-4">Quick Actions</h3>
                        <div className="space-y-3">
                            <button
                                onClick={() => navigate('/employees/tasks')}
                                className="w-full flex items-center p-3 text-left rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                            >
                                <div className="bg-indigo-100 p-2 rounded-md mr-4 text-indigo-600">
                                    <ShieldCheckIcon className="h-5 w-5" />
                                </div>
                                <div>
                                    <span className="block font-semibold text-gray-800">Task Board</span>
                                    <span className="text-xs text-gray-500">Manage your daily workflow</span>
                                </div>
                            </button>

                            <button
                                onClick={() => navigate('/billing/wip')}
                                className="w-full flex items-center p-3 text-left rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                            >
                                <div className="bg-green-100 p-2 rounded-md mr-4 text-green-600">
                                    <BanknotesIcon className="h-5 w-5" />
                                </div>
                                <div>
                                    <span className="block font-semibold text-gray-800">WIP Dashboard</span>
                                    <span className="text-xs text-gray-500">Review unbilled time</span>
                                </div>
                            </button>

                            <button
                                onClick={() => navigate('/admin/permissions')}
                                className="w-full flex items-center p-3 text-left rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                            >
                                <div className="bg-purple-100 p-2 rounded-md mr-4 text-purple-600">
                                    <ShieldCheckIcon className="h-5 w-5" />
                                </div>
                                <div>
                                    <span className="block font-semibold text-gray-800">User Permissions</span>
                                    <span className="text-xs text-gray-500">Manage system access</span>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right Column: Recent Activity */}
                <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 h-fit">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-base sm:text-lg font-bold text-gray-900">Recent Activity</h3>
                        <button
                            onClick={() => navigate('/web-admin/logs')}
                            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                            View All
                        </button>
                    </div>

                    {/* Constrained height for mobile friendliness */}
                    <div className="space-y-4 max-h-[400px] lg:max-h-[600px] overflow-y-auto pr-1">
                        {loading ? (
                            <p className="text-sm text-gray-500 italic">Loading activity...</p>
                        ) : stats.recentLogs.length === 0 ? (
                            <div className="text-center py-8 text-gray-400">
                                <ExclamationCircleIcon className="h-10 w-10 mx-auto mb-2 text-gray-200" />
                                <p className="text-sm italic">No recent activity logs.</p>
                            </div>
                        ) : (
                            stats.recentLogs.map(log => (
                                <div key={log.id} className="flex items-start pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                                    <div className="flex-shrink-0 w-2 h-2 mt-2 rounded-full bg-indigo-400 mr-3"></div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between flex-wrap">
                                            <p className="text-sm font-medium text-gray-800 truncate pr-2">
                                                {log.action} <span className="text-gray-400 font-normal">by</span> {log.user}
                                            </p>
                                            <p className="text-xs text-gray-400 whitespace-nowrap">
                                                {log.timestamp ? log.timestamp.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'}
                                            </p>
                                        </div>
                                        {log.details && (
                                            <p className="text-xs text-gray-600 mt-1 bg-gray-50 p-2 rounded border border-gray-100 break-words">
                                                {log.details}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;