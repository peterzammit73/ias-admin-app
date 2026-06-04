// Root: src/modules/billing/IssueRFPModal.jsx
// Version: 2.5 - Added Client Auto-Fill Logic on load & Fixed Import Paths
import React, { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { getDocs, query, collection, getDoc, doc, updateDoc } from 'firebase/firestore';
import { functions, db } from '/src/firebase.js';
import Modal from '/src/components/Modal.jsx';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';
import DocumentTemplate from '/src/modules/billing/DocumentTemplate.jsx';

const IssueRFPModal = ({ isOpen, onClose, rfp }) => {
    const [issuers, setIssuers] = useState([]);
    const [selectedIssuer, setSelectedIssuer] = useState('');
    const [recipientAddress, setRecipientAddress] = useState(rfp?.recipientAddress || '');
    const [recipientVat, setRecipientVat] = useState(rfp?.recipientVat || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // State to hold the final RFP data for PDF generation just before closing
    const [finalizedRfp, setFinalizedRfp] = useState(null);

    useEffect(() => {
        if (isOpen) {
            const fetchIssuersAndClient = async () => {
                try {
                    // Fetch Issuers
                    const settingsRef = doc(db, 'settings', 'rfp_issuers');
                    const settingsSnap = await getDoc(settingsRef);
                    if (settingsSnap.exists()) {
                        const data = settingsSnap.data();
                        if (data.issuers && Array.isArray(data.issuers)) {
                            setIssuers(data.issuers.map(i => i.name));
                        } else if (data.names && Array.isArray(data.names)) {
                            setIssuers(data.names);
                        }
                    }

                    // Auto-fill Client Details if they are missing
                    if (rfp?.recipient && (!rfp.recipientAddress || !rfp.recipientVat)) {
                        const q = query(collection(db, 'clients'));
                        const snap = await getDocs(q);
                        const clientList = snap.docs.map(d => d.data());
                        const getClientName = (c) => c.companyName || `${c.name} ${c.surname}`;
                        const matchedClient = clientList.find(c => getClientName(c) === rfp.recipient);

                        if (matchedClient) {
                            const addr = [matchedClient.address, matchedClient.locality, matchedClient.postCode, matchedClient.country].filter(Boolean).join(',\n');
                            if (!rfp.recipientAddress) setRecipientAddress(addr);
                            if (!rfp.recipientVat) setRecipientVat(matchedClient.vatNumber || '');
                        }
                    }
                } catch (e) {
                    console.error("Failed to load initial modal data", e);
                }
            };
            fetchIssuersAndClient();

            setSelectedIssuer('');
            setRecipientAddress(rfp?.recipientAddress || '');
            setRecipientVat(rfp?.recipientVat || '');
            setError('');
            setFinalizedRfp(null);
        }
    }, [isOpen, rfp]);

    const handleIssue = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        if (!selectedIssuer) {
            setError("Please select an Issuer.");
            setLoading(false);
            return;
        }

        try {
            const issueFn = httpsCallable(functions, 'issueRFP');
            const result = await issueFn({
                rfpId: rfp.id,
                issuer: selectedIssuer,
                recipientAddress: recipientAddress,
                recipientVat: recipientVat
            });

            // Result should contain the new rfpCode
            const newRfpCode = result.data.rfpCode;

            // INITIALIZE MAPS: Ensure payment/credit containers exist for the backend logic
            const rfpRef = doc(db, 'rfps', rfp.id);
            await updateDoc(rfpRef, {
                payments: rfp.payments || {},
                credits: rfp.credits || {}
            });

            // Fetch Issuer Details again to pass to template immediately
            const settingsRef = doc(db, 'settings', 'rfp_issuers');
            const settingsSnap = await getDoc(settingsRef);
            let issuerDetails = { name: selectedIssuer };
            if (settingsSnap.exists() && settingsSnap.data().issuers) {
                const found = settingsSnap.data().issuers.find(i => i.name === selectedIssuer);
                if (found) issuerDetails = found;
            }

            // Construct the finalized object for printing
            const completeRfp = {
                ...rfp,
                status: 'Issued - Open', // Optimistic Update Match
                issuer: selectedIssuer,
                issuerDetails: issuerDetails, // Pass details for PDF rendering
                recipientAddress,
                recipientVat,
                rfpNumber: newRfpCode, // The key generated by backend
                createdAt: rfp.createdAt || new Date(), // Fallback
                issuedAt: new Date() // Current time for issue date
            };

            setFinalizedRfp(completeRfp);

            // Wait a tick for the hidden preview to render, then print
            setTimeout(() => {
                const printContent = document.getElementById('hidden-rfp-preview');
                if (printContent) {
                    const printWindow = window.open('', '_blank', 'height=800,width=800');
                    if (printWindow) {
                        printWindow.document.write('<html><head><title>RFP ' + newRfpCode + '</title>');
                        printWindow.document.write('<script src="https://cdn.tailwindcss.com"></script>');
                        printWindow.document.write('</head><body>');
                        printWindow.document.write(printContent.innerHTML);
                        printWindow.document.write('</body></html>');
                        printWindow.document.close();
                        printWindow.focus();
                        setTimeout(() => {
                            printWindow.print();
                            printWindow.close();
                            onClose(); // Close modal after print initiated
                        }, 500);
                    } else {
                        alert("RFP Issued! Please allow popups to download the PDF.");
                        onClose();
                    }
                } else {
                    onClose();
                }
            }, 500); // Increased delay slightly to ensure template render

        } catch (err) {
            console.error("Error issuing RFP:", err);
            setError(err.message || "Failed to issue RFP.");
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <Modal show={isOpen} onClose={onClose} title={`Issue RFP: ${rfp?.projectNumber}`}>
                <form onSubmit={handleIssue} className="space-y-4">
                    {error && <div className="bg-red-50 text-red-700 p-3 rounded text-sm">{error}</div>}

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Select Issuer</label>
                        <select
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
                            value={selectedIssuer}
                            onChange={(e) => setSelectedIssuer(e.target.value)}
                            required
                        >
                            <option value="">-- Choose Entity --</option>
                            {issuers.map((issuer, idx) => (
                                <option key={idx} value={issuer}>{issuer}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Recipient Address (Optional)</label>
                        <textarea
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                            rows="3"
                            value={recipientAddress}
                            onChange={(e) => setRecipientAddress(e.target.value)}
                            placeholder="Enter full billing address..."
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Recipient VAT No. (Optional)</label>
                        <input
                            type="text"
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                            value={recipientVat}
                            onChange={(e) => setRecipientVat(e.target.value)}
                            placeholder="MT..."
                        />
                    </div>

                    <div className="bg-yellow-50 p-4 rounded-md border border-yellow-200">
                        <div className="flex">
                            <div className="flex-shrink-0">
                                <PaperAirplaneIcon className="h-5 w-5 text-yellow-400" aria-hidden="true" />
                            </div>
                            <div className="ml-3">
                                <h3 className="text-sm font-medium text-yellow-800">Warning</h3>
                                <div className="mt-2 text-sm text-yellow-700">
                                    <p>Issuing this RFP will finalize it, generate an official RFP number, and lock it. The PDF will be downloaded automatically.</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50" disabled={loading}>
                            Cancel
                        </button>
                        <button type="submit" className="inline-flex justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 disabled:opacity-50" disabled={loading}>
                            {loading ? 'Issuing & Generating PDF...' : 'Confirm Issue'}
                        </button>
                    </div>
                </form>
            </Modal>

            {/* Hidden Preview for PDF Generation */}
            {finalizedRfp && (
                <div id="hidden-rfp-preview" className="hidden">
                    <DocumentTemplate data={finalizedRfp} type="RFP" />
                </div>
            )}
        </>
    );
};

export default IssueRFPModal;