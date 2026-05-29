// Root: src/modules/billing/ProjectCostAuditModal.jsx
// Version: 5.1 - Cost Efficient & UI Fix for Paid Invoices
import React, { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
    CalculatorIcon, DocumentTextIcon, BanknotesIcon, BriefcaseIcon, ClockIcon, ArrowPathIcon,
    ChartBarIcon, InformationCircleIcon, VariableIcon, CheckBadgeIcon, UserGroupIcon
} from '@heroicons/react/24/outline';

// FIXED IMPORTS
import { db, functions } from '../../firebase.js';
import Modal from '../../components/Modal.jsx';

const generateProjectAuditFn = httpsCallable(functions, 'generateProjectAudit');

const ProjectCostAuditModal = ({ show, onClose, projectNumber }) => {
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [activeTab, setActiveTab] = useState('summary');
    const [showTrace, setShowTrace] = useState(null);

    useEffect(() => {
        if (!show || !projectNumber) return;

        // 1. Listen to the Cached Report Document (1 Read)
        const unsub = onSnapshot(doc(db, 'reports', `audit_${projectNumber}`), (docSnap) => {
            if (docSnap.exists()) {
                setReport(docSnap.data());
                setLoading(false);
                setGenerating(false);
            } else {
                // If no report exists, we must generate one
                if (!generating && loading) {
                    handleGenerate();
                }
            }
        });
        return () => unsub();
    }, [show, projectNumber]);

    const handleGenerate = async () => {
        setGenerating(true);
        try {
            await generateProjectAuditFn({ projectNumber });
            // Snapshot listener will update UI automatically when function finishes writing
        } catch (e) {
            console.error("Audit Generation Failed", e);
            setGenerating(false);
            setLoading(false); // Stop spinner to show empty state/error
        }
    };

    const formatCurrency = (val) => `\u20AC${(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const MetricsCard = ({ title, value, icon: Icon, colorClass, subtext }) => (
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-start gap-4 transition-all h-full hover:shadow-md">
            <div className={`p-3 rounded-xl ${colorClass.bg}`}><Icon className={`h-6 w-6 ${colorClass.text}`} /></div>
            <div className="min-w-0">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest leading-tight mb-1.5 break-words">{title}</p>
                <p className={`text-xl font-bold font-mono ${colorClass.text} truncate`}>{formatCurrency(value)}</p>
                {subtext && <p className="text-[10px] text-gray-500 mt-1 font-medium truncate uppercase">{subtext}</p>}
            </div>
        </div>
    );

    return (
        <Modal show={show} onClose={onClose} title={`Project Profitability Audit: ${projectNumber}`} maxWidth="sm:max-w-6xl">
            <div className="flex flex-col h-[85vh] font-sans text-black overflow-hidden bg-gray-50">
                {loading || generating ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4">
                        <ArrowPathIcon className="h-12 w-12 text-orange-500 animate-spin" />
                        <span className="text-sm font-bold text-gray-400 uppercase tracking-widest">
                            {generating ? "Calculating Historical Financials..." : "Loading Audit Report..."}
                        </span>
                    </div>
                ) : !report ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400">
                        <InformationCircleIcon className="h-12 w-12 opacity-50" />
                        <p>No audit data available.</p>
                        <button onClick={handleGenerate} className="px-4 py-2 bg-orange-600 text-white rounded font-bold">Generate Report</button>
                    </div>
                ) : (
                    <>
                        {/* Tab Navigation */}
                        <div className="flex px-6 pt-2 border-b border-gray-200 bg-white shrink-0 justify-between items-center">
                            <div className="flex">
                                {[
                                    { id: 'summary', label: 'Profitability Overview', icon: ChartBarIcon },
                                    { id: 'rfps', label: `Billing History`, icon: DocumentTextIcon },
                                    { id: 'expenses', label: `External Costs`, icon: BanknotesIcon },
                                    { id: 'timesheets', label: `Labour Analysis`, icon: ClockIcon }
                                ].map(tab => (
                                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-6 py-4 text-sm font-bold border-b-2 transition-all ${activeTab === tab.id ? 'border-orange-600 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
                                        <tab.icon className="h-4 w-4 shrink-0" />{tab.label}
                                    </button>
                                ))}
                            </div>

                            <div className="flex items-center gap-2 text-xs text-gray-400">
                                <span>Updated: {report.generatedAt?.toDate ? report.generatedAt.toDate().toLocaleTimeString() : 'Just now'}</span>
                                <button onClick={handleGenerate} className="p-2 hover:bg-gray-100 rounded text-indigo-600" title="Recalculate"><ArrowPathIcon className="h-4 w-4" /></button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            {activeTab === 'summary' && (
                                <div className="space-y-8 animate-in fade-in duration-500">
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 auto-rows-fr">
                                        <MetricsCard title="Revenue (Net)" value={report.summary.totalBilledLessCN / 1.18} icon={DocumentTextIcon} colorClass={{ bg: 'bg-orange-50', text: 'text-orange-600' }} subtext="Excl. VAT" />
                                        <MetricsCard title="Invoices (Paid)" value={report.summary.totalInvoiced || 0} icon={CheckBadgeIcon} colorClass={{ bg: 'bg-green-50', text: 'text-green-600' }} subtext="Total Receipts" />
                                        <MetricsCard title="Labour Cost" value={report.summary.totalInternalTimeCost} icon={UserGroupIcon} colorClass={{ bg: 'bg-blue-50', text: 'text-blue-600' }} subtext={`Incl. Overheads`} />
                                        <MetricsCard title="Ext. Expenses (Net)" value={report.summary.totalExternalCostsIncVat / 1.18} icon={BanknotesIcon} colorClass={{ bg: 'bg-purple-50', text: 'text-purple-600' }} subtext="Excl. VAT" />
                                    </div>

                                    <div className="bg-white rounded-3xl p-10 border border-gray-200 shadow-xl relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-8 opacity-5"><CalculatorIcon className="h-40 w-40 text-orange-600" /></div>
                                        <div className="relative z-10 max-w-2xl space-y-6">
                                            <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-8">Financial Position</h3>
                                            <div className="flex justify-between items-center py-2 border-b border-gray-100"><span className="text-gray-600 font-medium">Billed Revenue (Net)</span><span className="font-mono text-gray-900 font-bold">{formatCurrency(report.summary.totalBilledLessCN / 1.18)}</span></div>
                                            <div className="flex justify-between items-center py-2 border-b border-gray-100 text-orange-600"><span className="font-bold">Total Burdened Labour</span><span className="font-mono font-bold">-{formatCurrency(report.summary.totalInternalTimeCost)}</span></div>
                                            <div className="flex justify-between items-center py-2 border-b border-gray-100 text-purple-600"><span className="font-bold">External Expenses (Net)</span><span className="font-mono font-bold">-{formatCurrency(report.summary.totalExternalCostsIncVat / 1.18)}</span></div>
                                            <div className="flex justify-between items-center pt-8">
                                                <div><span className="text-xl font-black text-gray-900 uppercase tracking-tight">Operational Net Margin</span></div>
                                                <span className={`text-4xl font-black font-mono ${report.summary.profitability > 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(report.summary.profitability)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'timesheets' && (
                                <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
                                    <table className="min-w-full divide-y divide-gray-200 border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
                                        <thead className="bg-gray-100 text-[10px] font-black text-gray-500 uppercase tracking-widest">
                                            <tr>
                                                <th className="px-6 py-4 text-left font-bold">Resource</th>
                                                <th className="px-4 py-4 text-center font-bold">Hours</th>
                                                <th className="px-4 py-4 text-right font-bold">Direct</th>
                                                <th className="px-4 py-4 text-right font-bold">Overhead</th>
                                                <th className="px-4 py-4 text-right font-bold">Non-Prod</th>
                                                <th className="px-6 py-4 text-right font-bold text-orange-600 bg-orange-50/20">Total</th>
                                                <th className="w-10"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 text-sm">
                                            {report.groupedLabor.map((row, idx) => (
                                                <React.Fragment key={idx}>
                                                    <tr className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-6 py-3"><div className="flex flex-col"><span className="text-gray-900 font-bold capitalize">{row.name}</span><span className="text-[10px] text-gray-400">{row.email}</span></div></td>
                                                        <td className="px-4 py-3 text-center font-mono">{row.hours.toFixed(2)}h</td>
                                                        <td className="px-4 py-3 text-right font-mono text-gray-500">{formatCurrency(row.directCost)}</td>
                                                        <td className="px-4 py-3 text-right font-mono text-gray-500">{formatCurrency(row.overheadCost)}</td>
                                                        <td className="px-4 py-3 text-right font-mono text-gray-500">{formatCurrency(row.nonProdCost)}</td>
                                                        <td className="px-6 py-3 text-right font-mono font-bold text-orange-600 bg-orange-50/20">{formatCurrency(row.totalCost)}</td>
                                                        <td className="px-3 py-3 text-center">
                                                            {row.rateSample && (
                                                                <button onClick={() => setShowTrace(showTrace === row.email ? null : row.email)} className="text-gray-300 hover:text-orange-500"><VariableIcon className="h-5 w-5" /></button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    {showTrace === row.email && row.rateSample && (
                                                        <tr className="bg-gray-900 text-white"><td colSpan="7" className="p-6">
                                                            <div className="font-mono text-xs">
                                                                <p className="mb-2 text-orange-500 uppercase font-bold">Latest Rate Sample</p>
                                                                <p>Direct: €{row.rateSample.breakdown.directRate.toFixed(2)} | OH: €{row.rateSample.breakdown.overheadRate.toFixed(2)} | NP: €{row.rateSample.breakdown.nonProdRate.toFixed(2)}</p>
                                                                <p className="mt-1 font-bold">Total Loaded Rate: €{row.rateSample.totalRate.toFixed(2)} / hr</p>
                                                            </div>
                                                        </td></tr>
                                                    )}
                                                </React.Fragment>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {activeTab === 'rfps' && (
                                <table className="min-w-full divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
                                    <thead className="bg-gray-50 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                        <tr>
                                            <th className="px-6 py-4 text-left">Ref</th>
                                            <th className="px-6 py-4 text-left">Status</th>
                                            <th className="px-6 py-4 text-right">Gross Value</th>
                                            <th className="px-6 py-4 text-right">Paid (Invoiced)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 text-sm">
                                        {report.rfps.map((rfp, i) => (
                                            <tr key={i} className={`hover:bg-gray-50 ${rfp.status === 'Superseded' ? 'opacity-50' : ''}`}>
                                                <td className="px-6 py-4 font-mono text-orange-600">{rfp.rfpCode}</td>
                                                <td className="px-6 py-4">{rfp.status}</td>
                                                <td className="px-6 py-4 text-right font-bold">{formatCurrency(rfp.grossValue)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-green-600">{formatCurrency(rfp.paidAmount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
};

export default ProjectCostAuditModal;