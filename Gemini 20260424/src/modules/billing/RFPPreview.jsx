// Root: src/modules/billing/RFPPreview.jsx
// Version: 1.1 - Added fallback to rfpCode for legacy display
import React from 'react';

const RFPPreview = ({ rfp }) => {
    if (!rfp) return null;

    // Helper to format currency
    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-MT', { style: 'currency', currency: 'EUR' }).format(amount || 0);
    };

    // Helper to format date
    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        // Handle both Firestore Timestamp and JS Date objects
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    };

    // Helper: Smart Fallback for Document ID (Legacy Support)
    const getDocIdentifier = () => {
        return rfp.rfpNumber || rfp.rfpCode || 'DRAFT';
    };

    return (
        <div className="bg-white text-gray-800 font-sans p-8 md:p-12 max-w-4xl mx-auto" id="rfp-print-area">
            {/* --- HEADER --- */}
            <div className="flex justify-between items-start border-b-2 border-gray-800 pb-6 mb-8">
                <div>
                    {/* Placeholder for Logo - Replace src with actual logo path */}
                    <img src="/ias-logo.jpg" alt="iAS Logo" className="h-16 w-auto mb-4" />
                    <h1 className="text-3xl font-bold uppercase tracking-wide text-gray-900">Request for Payment</h1>
                </div>
                <div className="text-right">
                    <h2 className="text-xl font-bold text-gray-600">RFP #{getDocIdentifier()}</h2>
                    <p className="text-sm text-gray-500 mt-1">Date: {formatDate(rfp.createdAt)}</p>
                    <p className="text-sm text-gray-500">Project Ref: {rfp.projectNumber}</p>
                </div>
            </div>

            {/* --- FROM / TO SECTION --- */}
            <div className="flex flex-col md:flex-row justify-between mb-10 gap-8">
                <div className="flex-1">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">From</h3>
                    <div className="text-sm font-medium leading-relaxed">
                        <p className="font-bold text-gray-900 text-lg">{rfp.issuer || 'iAS Limited'}</p>
                        <p>OneOneO, Pitkali Road</p>
                        <p>Attard, ATD 2214</p>
                        <p>Malta</p>
                        <p>VAT: MT 1735-3714</p>
                    </div>
                </div>
                <div className="flex-1">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Bill To</h3>
                    <div className="text-sm font-medium leading-relaxed">
                        <p className="font-bold text-gray-900 text-lg">{rfp.recipient || 'Client Name'}</p>
                        {rfp.recipientAddress && (
                            <div className="whitespace-pre-line">{rfp.recipientAddress}</div>
                        )}
                        {rfp.recipientVat && <p className="mt-1">VAT: {rfp.recipientVat}</p>}
                    </div>
                </div>
            </div>

            {/* --- PROJECT DETAILS --- */}
            <div className="mb-8">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Project Description</h3>
                <p className="text-gray-900 font-medium text-lg">{rfp.projectName || 'Project Title'}</p>
                <p className="text-gray-600 mt-1">{rfp.description || 'Description of services rendered.'}</p>
            </div>

            {/* --- ITEMS TABLE --- */}
            <div className="mb-8">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b-2 border-gray-200">
                            <th className="py-3 text-xs font-bold text-gray-500 uppercase tracking-wider w-3/4">Description</th>
                            <th className="py-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Amount</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm text-gray-700">
                        {/* If items exist in RFP object, map them. Otherwise show main amount. */}
                        {rfp.items && rfp.items.length > 0 ? (
                            rfp.items.map((item, index) => (
                                <tr key={index} className="border-b border-gray-100 last:border-0">
                                    <td className="py-4 pr-4">{item.description || rfp.description}</td>
                                    <td className="py-4 text-right font-medium">{formatCurrency(item.amount)}</td>
                                </tr>
                            ))
                        ) : (
                            <tr className="border-b border-gray-100">
                                <td className="py-4 pr-4">Professional Services as agreed.</td>
                                <td className="py-4 text-right font-medium">{formatCurrency(rfp.amount)}</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* --- TOTALS --- */}
            <div className="flex justify-end mb-12">
                <div className="w-full md:w-1/2 lg:w-1/3">
                    <div className="flex justify-between py-2 border-b border-gray-100">
                        <span className="text-gray-600 font-medium">Subtotal</span>
                        <span className="text-gray-900 font-bold">{formatCurrency(rfp.amount)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-gray-100">
                        <span className="text-gray-600 font-medium">VAT ({rfp.vatApplicable ? '18%' : '0%'})</span>
                        <span className="text-gray-900 font-bold">{formatCurrency(rfp.vatAmount || (rfp.vatApplicable ? rfp.amount * 0.18 : 0))}</span>
                    </div>
                    <div className="flex justify-between py-4 border-b-2 border-gray-800">
                        <span className="text-xl font-bold text-gray-900">Total</span>
                        <span className="text-xl font-bold text-indigo-700">{formatCurrency(rfp.totalAmount || (rfp.amount * (rfp.vatApplicable ? 1.18 : 1)))}</span>
                    </div>
                </div>
            </div>

            {/* --- FOOTER / TERMS --- */}
            <div className="text-sm text-gray-500 border-t border-gray-200 pt-6 mt-12">
                <h4 className="font-bold text-gray-700 mb-2">Terms & Conditions</h4>
                <p>Payment is due within 30 days of the invoice date. Please quote the RFP number when making a payment.</p>
                <div className="mt-4">
                    <p><strong>Bank Details:</strong></p>
                    <p>Bank: Bank of Valletta</p>
                    <p>IBAN: MT12 3456 7890 1234 5678</p>
                    <p>SWIFT: BOVAMT22</p>
                </div>
                <div className="mt-8 text-center text-xs text-gray-400">
                    <p>iAS Limited &bull; OneOneO, Pitkali Road, Attard &bull; +356 2123 4567 &bull; info@ias.com.mt</p>
                </div>
            </div>
        </div>
    );
};

export default RFPPreview;