// Root: src/modules/billing/ProjectBillingDetails.jsx
// Version: 2.1 - Fixed "Mark as Billed" to use direct batch update
import React, { useState, useMemo } from 'react';
import { ArrowLeftIcon, CalendarDaysIcon, ClockIcon, CurrencyEuroIcon, DocumentPlusIcon, ArchiveBoxIcon } from '@heroicons/react/24/outline';
import { doc, writeBatch } from 'firebase/firestore'; // Import writeBatch
import { db } from '../../firebase.js'; // Ensure correct import
import CreateRFPModal from './CreateRFPModal.jsx';

const ProjectBillingDetails = ({ project, entries, client, onBack, projectsMap }) => {
    const [isRfpModalOpen, setIsRfpModalOpen] = useState(false);
    const [selectedEntries, setSelectedEntries] = useState(new Set());
    const [processing, setProcessing] = useState(false);

    // Calculate Totals
    const totals = useMemo(() => {
        return entries.reduce((acc, entry) => ({
            hours: acc.hours + (parseFloat(entry.duration) || 0),
            cost: acc.cost + (entry.calculatedCost || parseFloat(entry.cost) || 0)
        }), { hours: 0, cost: 0 });
    }, [entries]);

    // Handle Selection
    const toggleEntry = (id) => {
        const newSet = new Set(selectedEntries);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedEntries(newSet);
    };

    const toggleAll = () => {
        if (selectedEntries.size === entries.length) setSelectedEntries(new Set());
        else setSelectedEntries(new Set(entries.map(e => e.id)));
    };

    const getSelectedObjects = () => {
        return entries.filter(e => selectedEntries.has(e.id));
    };

    const handleRequestRFP = () => {
        if (selectedEntries.size === 0) {
            alert("Please select entries to include in the RFP.");
            return;
        }
        setIsRfpModalOpen(true);
    };

    // New Function: Mark as Billed (Manual Archive) using Batch Write
    const handleMarkAsBilled = async () => {
        if (selectedEntries.size === 0) return;

        const count = selectedEntries.size;
        if (!window.confirm(`Are you sure you want to manually mark ${count} entries as 'Billed'?\n\nThis will remove them from the Unbilled list without generating an RFP document.`)) {
            return;
        }

        setProcessing(true);
        try {
            // Using a Firestore Batch to update multiple documents atomically
            const batch = writeBatch(db);

            selectedEntries.forEach(entryId => {
                // Determine if it's a cost or a timesheet entry based on ID or data structure
                // Assuming mixed types might be passed, we need to know the collection.
                // However, 'entries' prop usually comes from 'allUnbilledEntries' which are timesheets.
                // If costs are mixed in, we need a way to distinguish.
                // For now, assuming these are TIMESHEETS based on standard usage of this component.

                // Safety check: Try to find the entry object to check its source if possible, 
                // or assume timesheet_entries for now as per `Billing.jsx` logic for this view.
                const entryObj = entries.find(e => e.id === entryId);
                const collectionName = entryObj.amount ? 'project_costs' : 'timesheet_entries'; // Heuristic: Costs have 'amount', Timesheets have 'duration'

                const ref = doc(db, collectionName, entryId);
                batch.update(ref, {
                    billingStatus: 'billed',
                    billedAt: new Date().toISOString(),
                    billingMethod: 'manual_archive'
                });
            });

            await batch.commit();

            alert(`Successfully marked ${count} entries as billed.`);
            setSelectedEntries(new Set());
            onBack(); // Refresh view

        } catch (error) {
            console.error("Error marking as billed:", error);
            alert("Failed to update entries. Please try again.");
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-lg shadow-sm border border-gray-200">
            {/* Header */}
            <div className="p-6 border-b border-gray-200 flex justify-between items-start bg-gray-50 rounded-t-lg">
                <div className="flex items-center">
                    <button onClick={onBack} className="mr-4 p-2 hover:bg-white rounded-full transition-colors border border-transparent hover:border-gray-300">
                        <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
                    </button>
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 flex items-center">
                            <span className="font-mono text-gray-500 mr-2">#{project.projectNumber}</span>
                            {project.projectDescription}
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                            Client: <span className="font-semibold text-gray-700">{client.display}</span>
                        </p>
                    </div>
                </div>
                <div className="flex gap-3">
                    {/* Manual Mark As Billed Button */}
                    <button
                        onClick={handleMarkAsBilled}
                        disabled={selectedEntries.size === 0 || processing}
                        className={`flex items-center px-4 py-2 text-sm font-medium border border-gray-300 rounded-md shadow-sm bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed`}
                        title="Remove from WIP without generating a formal RFP document"
                    >
                        <ArchiveBoxIcon className="h-5 w-5 mr-2 text-gray-500" />
                        Mark as Billed
                    </button>

                    <button
                        onClick={handleRequestRFP}
                        disabled={selectedEntries.size === 0 || processing}
                        className={`flex items-center px-4 py-2 text-sm font-medium text-white rounded-md shadow-sm ${selectedEntries.size > 0 ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-400 cursor-not-allowed'}`}
                    >
                        <DocumentPlusIcon className="h-5 w-5 mr-2" />
                        Request RFP ({selectedEntries.size})
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6 border-b border-gray-200">
                <div className="bg-orange-50 p-4 rounded-lg border border-orange-100 flex items-center">
                    <div className="p-3 bg-orange-100 rounded-full text-orange-600 mr-4">
                        <ClockIcon className="h-6 w-6" />
                    </div>
                    <div>
                        <p className="text-sm text-gray-500 font-medium">Unbilled Hours</p>
                        <p className="text-2xl font-bold text-gray-900">{totals.hours.toFixed(2)}h</p>
                    </div>
                </div>
                <div className="bg-green-50 p-4 rounded-lg border border-green-100 flex items-center">
                    <div className="p-3 bg-green-100 rounded-full text-green-600 mr-4">
                        <CurrencyEuroIcon className="h-6 w-6" />
                    </div>
                    <div>
                        <p className="text-sm text-gray-500 font-medium">Unbilled Cost</p>
                        <p className="text-2xl font-bold text-gray-900">€{totals.cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    </div>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 flex items-center">
                    <div className="p-3 bg-blue-100 rounded-full text-blue-600 mr-4">
                        <CalendarDaysIcon className="h-6 w-6" />
                    </div>
                    <div>
                        <p className="text-sm text-gray-500 font-medium">Entries</p>
                        <p className="text-2xl font-bold text-gray-900">{entries.length}</p>
                    </div>
                </div>
            </div>

            {/* Entries Table */}
            <div className="flex-1 overflow-auto p-0">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                            <th scope="col" className="px-6 py-3 text-left w-10">
                                <input
                                    type="checkbox"
                                    checked={selectedEntries.size === entries.length && entries.length > 0}
                                    onChange={toggleAll}
                                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                />
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Task</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Hours</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Cost</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {entries.map((entry) => {
                            const entryDate = entry.date ? new Date(entry.date).toLocaleDateString() : '-';
                            const cost = entry.calculatedCost || parseFloat(entry.cost) || 0;
                            return (
                                <tr key={entry.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <input
                                            type="checkbox"
                                            checked={selectedEntries.has(entry.id)}
                                            onChange={() => toggleEntry(entry.id)}
                                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                        />
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{entryDate}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{entry.emailAddress}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">{entry.task}</td>
                                    <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate" title={entry.comment}>{entry.comment || '-'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium">{parseFloat(entry.duration).toFixed(2)}h</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">€{cost.toFixed(2)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <CreateRFPModal
                show={isRfpModalOpen}
                onClose={() => setIsRfpModalOpen(false)}
                preSelectedItems={getSelectedObjects()}
                projectsMap={projectsMap}
                onSuccess={() => {
                    setIsRfpModalOpen(false);
                    onBack();
                }}
            />
        </div>
    );
};

export default ProjectBillingDetails;