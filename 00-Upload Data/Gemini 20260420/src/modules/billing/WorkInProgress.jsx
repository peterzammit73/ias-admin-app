// Root: src/modules/billing/WorkInProgress.jsx
// Version: 9.0 - Added Dirty State Locking
import React, { useState, useEffect, useMemo } from 'react';
import {
    onSnapshot,
    doc
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
    BriefcaseIcon,
    DocumentPlusIcon,
    FunnelIcon,
    ArrowPathIcon,
    ChevronRightIcon,
    ChevronDownIcon,
    UserIcon,
    ClockIcon,
    CheckBadgeIcon,
    CalculatorIcon,
    LockClosedIcon
} from '@heroicons/react/24/outline';

import { db, functions } from '/src/firebase.js';
import CreateRFPModal from '/src/modules/billing/CreateRFPModal.jsx';
import ProjectCostAuditModal from '/src/modules/billing/ProjectCostAuditModal.jsx';

const generateWIPReportFn = httpsCallable(functions, 'generateWIPReport');
const getProjectUnbilledDetailsFn = httpsCallable(functions, 'getProjectUnbilledDetails');

const WorkInProgress = () => {
    // UI State
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);

    // Status Data now includes modifiedProjects array
    const [statusData, setStatusData] = useState({
        isStale: false,
        lastUpdated: null,
        modifiedProjects: []
    });

    // Data State
    const [reportData, setReportData] = useState([]);

    // Local action tracking (immediate feedback before server update propagates)
    const [localActioned, setLocalActioned] = useState(new Set());

    const [expandedProjects, setExpandedProjects] = useState(new Set());
    const [filteredReportData, setFilteredReportData] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');

    const [selectedProjectNum, setSelectedProjectNum] = useState(null);
    const [isRFPModalOpen, setIsRFPModalOpen] = useState(false);
    const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);

    const [projectDetails, setProjectDetails] = useState([]);
    const [detailsLoading, setDetailsLoading] = useState(false);

    // 1. Listen to Status (Dirty Flag & Modified Projects)
    useEffect(() => {
        const unsub = onSnapshot(doc(db, 'settings', 'wip_status'), (doc) => {
            if (doc.exists()) {
                setStatusData(doc.data());
                // When server acknowledges a modification, we can clear our local optimistic state
                // to rely on server state, or merge them. Merging is safest.
            }
        });
        return () => unsub();
    }, []);

    // 2. Listen to Report Data
    useEffect(() => {
        setLoading(true);
        const unsub = onSnapshot(doc(db, 'reports', 'wip_summary'), (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                setReportData(data.projects || []);
                setLocalActioned(new Set()); // Clear local state on fresh report
            }
            setLoading(false);
        });
        return () => unsub();
    }, []);

    // Filter Data
    useEffect(() => {
        if (!searchTerm) {
            setFilteredReportData(reportData);
        } else {
            const term = searchTerm.toLowerCase();
            const filtered = reportData.filter(p =>
                p.projectNumber.toLowerCase().includes(term) ||
                (p.projectDescription && p.projectDescription.toLowerCase().includes(term))
            );
            setFilteredReportData(filtered);
        }
    }, [reportData, searchTerm]);

    const handleRefresh = async () => {
        setGenerating(true);
        try {
            await generateWIPReportFn();
        } catch (error) {
            console.error("Report Gen Failed:", error);
            alert("Failed to refresh report.");
        } finally {
            setGenerating(false);
        }
    };

    const handleRequestRFP = async () => {
        if (!selectedProjectNum) return;
        setDetailsLoading(true);
        try {
            const result = await getProjectUnbilledDetailsFn({ projectNumber: selectedProjectNum });
            setProjectDetails(result.data.entries);
            setIsRFPModalOpen(true);
        } catch (error) {
            console.error("Fetch Details Failed:", error);
            alert("Failed to load project details.");
        } finally {
            setDetailsLoading(false);
        }
    };

    const handleActionSuccess = (projectNum) => {
        setIsRFPModalOpen(false);
        setLocalActioned(prev => new Set(prev).add(projectNum));
        if (selectedProjectNum === projectNum) setSelectedProjectNum(null);
    };

    const toggleProjectExpand = (e, pNum) => {
        e.stopPropagation();
        setExpandedProjects(prev => {
            const next = new Set(prev);
            if (next.has(pNum)) next.delete(pNum); else next.add(pNum);
            return next;
        });
    };

    // Check if a project is dirty (Server-side or Local)
    const isProjectDirty = (pNum) => {
        const serverDirty = statusData.modifiedProjects?.includes(pNum);
        const localDirty = localActioned.has(pNum);
        return serverDirty || localDirty;
    };

    const handleRowSelection = (project) => {
        if (isProjectDirty(project.projectNumber)) return;
        setSelectedProjectNum(project.projectNumber);
    };

    const formatCurrency = (val) => `\u20AC${(parseFloat(val) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const selectedProjectObj = useMemo(() => reportData.find(p => p.projectNumber === selectedProjectNum), [reportData, selectedProjectNum]);

    const lastUpdatedText = statusData.lastUpdated?.toDate
        ? statusData.lastUpdated.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Unknown';

    return (
        <div className="flex flex-col h-[calc(100vh-12rem)] space-y-4 font-sans text-black">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col min-h-0 relative">

                {/* Header */}
                <div className="px-6 py-5 border-b border-gray-100 bg-white flex justify-between items-center z-30 shrink-0">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 flex items-center shrink-0">
                            <BriefcaseIcon className="h-7 w-7 mr-3 text-orange-600" /> Unbilled Time
                        </h2>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-sm text-gray-500">WIP Dashboard</span>
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${statusData.isStale ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-green-50 text-green-600 border-green-200'}`}>
                                {statusData.isStale ? 'Updates Available' : `Data Current (${lastUpdatedText})`}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <FunnelIcon className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search Project..."
                                className="pl-9 py-2 rounded-md border border-gray-300 text-sm focus:ring-orange-500 focus:border-orange-500"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>

                        <button
                            onClick={handleRefresh}
                            disabled={generating}
                            className={`px-4 py-2 text-sm font-bold rounded-md flex items-center shadow-md transition-colors font-sans ${statusData.isStale || localActioned.size > 0
                                ? 'bg-orange-600 text-white hover:bg-orange-700 animate-pulse'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                }`}
                        >
                            <ArrowPathIcon className={`h-5 w-5 mr-1.5 ${generating ? 'animate-spin' : ''}`} />
                            {generating ? 'Consolidating...' : 'Refresh Data'}
                        </button>
                    </div>
                </div>

                {/* Action Bar */}
                <div className="px-6 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-4 shrink-0 shadow-inner z-20">
                    <span className="text-[10px] uppercase font-black text-gray-400 tracking-widest mr-2">Selection Manager:</span>

                    <button
                        onClick={() => setIsAuditModalOpen(true)}
                        disabled={!selectedProjectNum}
                        className={`px-4 py-2 border rounded-full text-xs font-bold transition-all shadow-sm flex items-center ${selectedProjectNum ? 'border-gray-300 text-gray-700 bg-white hover:bg-gray-100' : 'border-gray-200 text-gray-300 bg-gray-50 cursor-not-allowed'}`}
                    >
                        <CalculatorIcon className="h-4 w-4 mr-2" /> Financial Audit
                    </button>

                    <button
                        onClick={handleRequestRFP}
                        disabled={!selectedProjectNum || !selectedProjectObj?.isBillable || selectedProjectObj?.isLocked || detailsLoading}
                        className={`px-4 py-2 rounded-full text-xs font-bold transition-all shadow-md flex items-center ${selectedProjectNum && selectedProjectObj?.isBillable && !selectedProjectObj?.isLocked
                            ? 'bg-orange-600 text-white hover:bg-orange-700'
                            : 'bg-gray-200 text-gray-400 border border-gray-200 cursor-not-allowed'
                            }`}
                    >
                        {detailsLoading ? <ArrowPathIcon className="h-4 w-4 mr-2 animate-spin" /> : <DocumentPlusIcon className="h-4 w-4 mr-2" />}
                        Request RFP
                    </button>

                    {selectedProjectNum && (
                        <div className="ml-auto flex items-center gap-4">
                            {selectedProjectObj?.isLocked && (
                                <span className="flex items-center text-[10px] bg-red-50 text-red-700 px-3 py-1.5 rounded-full border border-red-200 font-black uppercase tracking-tight animate-pulse shadow-sm">
                                    <LockClosedIcon className="h-3.5 w-3.5 mr-1.5" /> Pending RFP Detected
                                </span>
                            )}
                            <div className="flex flex-col text-right">
                                <span className="text-[10px] font-black text-gray-400 uppercase leading-none">Selected</span>
                                <span className="text-sm text-orange-600 font-black">Project {selectedProjectNum}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Data Table */}
                <div className="flex-1 overflow-auto min-h-0 relative bg-white">
                    {loading && !reportData.length ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-50">
                            <ArrowPathIcon className="h-10 w-10 text-gray-300 animate-spin mb-2" />
                            <span className="text-sm font-bold text-gray-400 uppercase">Loading Report...</span>
                        </div>
                    ) : (
                        <table className="min-w-full table-fixed divide-y divide-gray-200 border-separate border-spacing-0">
                            <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm uppercase font-black text-gray-500 tracking-wider">
                                <tr className="text-sm">
                                    <th className="w-12 px-3 py-4 bg-gray-50 border-b-2 border-gray-200"></th>
                                    <th className="px-6 py-4 text-left border-b-2 border-gray-200">Project Identification</th>
                                    <th className="px-6 py-4 text-right border-b-2 border-gray-200">Unbilled Hours</th>
                                    <th className="px-6 py-4 text-right border-b-2 border-gray-200">Total Expenses</th>
                                    <th className="px-6 py-4 text-right border-b-2 border-gray-200">Labor Value (Loaded)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 font-medium text-sm text-gray-900">
                                {filteredReportData.length === 0 ? (
                                    <tr><td colSpan="5" className="px-6 py-20 text-center text-gray-400 italic font-bold">No unbilled records found.</td></tr>
                                ) : (
                                    filteredReportData.map(p => {
                                        const isActioned = isProjectDirty(p.projectNumber);
                                        return (
                                            <React.Fragment key={p.projectNumber}>
                                                <tr
                                                    onClick={() => !isActioned && handleRowSelection(p)}
                                                    className={`transition-all ${isActioned ? 'bg-gray-50 cursor-not-allowed opacity-60' :
                                                        p.isLocked ? 'bg-gray-100/50 opacity-60 cursor-pointer'
                                                            : selectedProjectNum === p.projectNumber ? 'bg-orange-50 ring-1 ring-inset ring-orange-200 cursor-pointer'
                                                                : 'hover:bg-gray-50 cursor-pointer'
                                                        }`}
                                                >
                                                    <td className="px-3 py-3 text-center">
                                                        {!isActioned ? (
                                                            <button onClick={(e) => toggleProjectExpand(e, p.projectNumber)} className="text-gray-400 hover:text-orange-600 transition-colors p-1">
                                                                {expandedProjects.has(p.projectNumber) ? <ChevronDownIcon className="h-5 w-5" /> : <ChevronRightIcon className="h-5 w-5" />}
                                                            </button>
                                                        ) : (
                                                            <CheckBadgeIcon className="h-5 w-5 text-green-500 mx-auto" />
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-3 whitespace-nowrap">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-mono font-bold text-indigo-600">{p.projectNumber}</span>
                                                            <span className={`truncate max-w-xs ${isActioned ? 'line-through text-gray-400' : 'text-gray-900'}`}>{p.projectDescription}</span>

                                                            {isActioned && <span className="text-[9px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-black uppercase tracking-tighter shadow-sm border border-green-200">Updated</span>}
                                                            {!isActioned && !p.isBillable && <span className="text-[9px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-400 font-black uppercase tracking-tighter">Non-Billable</span>}
                                                            {!isActioned && p.isLocked && <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">Locked</span>}
                                                        </div>
                                                    </td>
                                                    <td className={`px-6 py-3 whitespace-nowrap text-right font-mono ${isActioned ? 'text-gray-300' : 'text-gray-600'}`}>
                                                        <div className="flex items-center justify-end gap-1.5">
                                                            <ClockIcon className="h-3.5 w-3.5 text-gray-300" />
                                                            {p.totalHours.toFixed(2)}h
                                                        </div>
                                                    </td>
                                                    <td className={`px-6 py-3 whitespace-nowrap text-right font-mono ${isActioned ? 'text-gray-300' : 'text-gray-600'}`}>{formatCurrency(p.totalExpenseCost)}</td>
                                                    <td className={`px-6 py-3 whitespace-nowrap text-right font-mono font-bold ${isActioned ? 'text-gray-300' : 'text-orange-600'}`}>{formatCurrency(p.totalTimeCost)}</td>
                                                </tr>
                                                {expandedProjects.has(p.projectNumber) && !isActioned && (
                                                    <tr className="bg-gray-50/50">
                                                        <td colSpan="5" className="px-12 py-3">
                                                            <div className="bg-white border rounded-xl shadow-lg overflow-hidden border-gray-200">
                                                                <div className="px-4 py-2 bg-gray-100 border-b border-gray-200 flex items-center justify-between">
                                                                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center">
                                                                        <UserIcon className="h-4 w-4 mr-2" /> Labor Distribution by Employee
                                                                    </span>
                                                                </div>
                                                                <table className="min-w-full text-xs">
                                                                    <thead className="bg-gray-50 text-gray-400 font-bold uppercase text-[9px] tracking-widest">
                                                                        <tr className="text-left border-b border-gray-100">
                                                                            <th className="px-6 py-2">Team Member</th>
                                                                            <th className="px-6 py-2 text-right">Hours</th>
                                                                            <th className="px-6 py-2 text-right">Value</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-gray-100">
                                                                        {Object.values(p.employeeSummary).sort((a, b) => a.name.localeCompare(b.name)).map((emp, idx) => (
                                                                            <tr key={idx} className="hover:bg-orange-50/30 transition-colors">
                                                                                <td className="px-6 py-1.5">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <span className="text-gray-900 font-bold capitalize">{emp.name}</span>
                                                                                        <span className="text-[11px] text-gray-400 lowercase italic">({emp.email})</span>
                                                                                    </div>
                                                                                </td>
                                                                                <td className="px-6 py-1.5 text-right font-mono text-gray-600 font-bold">
                                                                                    {emp.hours.toFixed(2)}h
                                                                                </td>
                                                                                <td className="px-6 py-1.5 text-right font-mono text-orange-600 font-bold">
                                                                                    {formatCurrency(emp.cost)}
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {isRFPModalOpen && (
                <CreateRFPModal
                    isOpen={isRFPModalOpen}
                    onClose={() => setIsRFPModalOpen(false)}
                    onSuccess={handleActionSuccess}
                    selectedProject={selectedProjectNum}
                    selectedEntries={projectDetails}
                />
            )}

            {isAuditModalOpen && (
                <ProjectCostAuditModal
                    show={true}
                    onClose={() => setIsAuditModalOpen(false)}
                    projectNumber={selectedProjectNum}
                />
            )}
        </div>
    );
};

export default WorkInProgress;