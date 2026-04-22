// Root: src/modules/billing/DocumentTemplate.jsx
// Version: 3.7 - Fixed Import Path & Bank Account Holder reference in the footer
import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '/src/firebase.js';

const DocumentTemplate = ({ data, type, subData }) => {
    const [termsText, setTermsText] = useState('Payment is due within 30 days of the invoice date. Please quote the Reference Number when making a payment.');
    const [companyInfo, setCompanyInfo] = useState({
        name: 'iAS Limited',
        address: 'OneOneO, Pitkali Road, Attard, ATD 2214, Malta',
        vat: 'MT 1735-3714'
    });

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const docRef = doc(db, 'settings', 'company_settings');
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    const d = snap.data();

                    let specificTerms = '';
                    if (type === 'RFP') specificTerms = d.termsRFP;
                    else if (type === 'INVOICE' || type === 'PARTIAL') specificTerms = d.termsInvoice;
                    else if (type === 'CREDIT_NOTE') specificTerms = d.termsCreditNote;
                    else if (type === 'REMINDER') specificTerms = d.termsReminder;

                    setTermsText(specificTerms || d.paymentTerms || 'Payment is due within 30 days of the invoice date. Please quote the Reference Number when making a payment.');

                    setCompanyInfo(prev => ({
                        name: d.companyName || prev.name,
                        address: d.companyAddress || prev.address,
                        vat: d.companyRegNumber ? `${prev.vat} (Reg: ${d.companyRegNumber})` : prev.vat
                    }));
                }
            } catch (err) {
                console.warn("Could not load settings:", err);
            }
        };
        fetchSettings();
    }, [type]);

    if (!data) return null;

    // Helper: Smart Fallback for Document ID (Legacy Support)
    const getDocIdentifier = () => {
        return data.rfpNumber || data.rfpCode || 'DRAFT';
    };

    const getReminderNumber = () => {
        if (!subData || !subData.ref) return 'PENDING';
        const mainRef = getDocIdentifier();
        if (subData.ref.includes('REM-') || subData.ref.includes(mainRef)) {
            const parts = subData.ref.split('-');
            let seq = '001';
            if (parts.length >= 2) seq = parts[1];
            return `${mainRef}-REM-${seq}`;
        }
        return subData.ref;
    };

    const getInvoiceNumber = () => {
        if (type === 'PARTIAL' && subData) {
            if (subData.invoiceNumber) return subData.invoiceNumber;
            if (subData.ref && !subData.ref.includes('PPT')) return subData.ref;
            return subData.ref;
        }
        if (type === 'INVOICE') {
            if (data.invoiceNumber) return data.invoiceNumber;
            return getDocIdentifier();
        }
        return 'DRAFT';
    };

    const config = {
        RFP: { title: "Request for Payment", docLabel: "RFP #", docNumber: getDocIdentifier(), dateLabel: "Date", date: data.issuedAt || data.createdAt },
        INVOICE: { title: "Tax Invoice", docLabel: "INV #", docNumber: getInvoiceNumber(), dateLabel: "Invoice Date", date: data.paidAt || new Date() },
        PARTIAL: { title: subData?.type === 'Final Balance' ? "Tax Invoice (Final)" : "Tax Invoice (Partial)", docLabel: "INV #", docNumber: getInvoiceNumber(), dateLabel: "Date", date: subData?.date || new Date() },
        CREDIT_NOTE: { title: "Credit Note", docLabel: "Credit Note #", docNumber: subData?.ref || data.creditNoteNumber || 'PENDING', dateLabel: "Date", date: subData?.date || data.creditedAt || new Date() },
        REMINDER: { title: "Payment Reminder", docLabel: "REF", docNumber: getReminderNumber(), dateLabel: "Reminder Date", date: subData?.date || new Date() }
    };

    const currentConfig = config[type] || config.RFP;
    const formatCurrency = (amount) => new Intl.NumberFormat('en-MT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
    const formatDate = (timestamp) => {
        if (!timestamp) return new Date().toLocaleDateString('en-GB');
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    };

    let displayAmount = parseFloat(data.amount || 0);
    let displayVat = 0;

    if (data.vatApplicable) {
        if (data.vatAmount !== undefined && data.vatAmount !== null) {
            displayVat = parseFloat(data.vatAmount);
        } else {
            displayVat = displayAmount * 0.18;
        }
    }

    let displayTotal = displayAmount + displayVat;
    let description = data.description || 'Professional Services';

    if (type !== 'RFP') {
        description = description.replace(/\n\nThis RFP supersedes RFP number .*?(?=\n|$)/g, '');
        description = description.replace(/^This RFP supersedes RFP number .*?(?=\n|$)/g, '');
    }

    const totalAmt = parseFloat(data.totalAmount || 0);
    const invAmt = parseFloat(data.invoicedAmount || 0);
    const credAmt = parseFloat(data.creditedAmount || 0);
    const outstandingBalance = data.remaining !== undefined ? data.remaining : Math.max(0, totalAmt - invAmt - credAmt);

    if (type === 'PARTIAL' && subData) {
        const amountPaid = parseFloat(subData.amount) || 0;
        displayTotal = amountPaid;
        if (data.vatApplicable) { displayAmount = displayTotal / 1.18; displayVat = displayTotal - displayAmount; }
        else { displayAmount = displayTotal; displayVat = 0; }

        let isFinal = subData.type === 'Final Balance';

        // Auto-detect if this is the final payment (if outstanding balance is 0 and this is the latest payment)
        if (!isFinal && outstandingBalance <= 0.01 && data.payments) {
            let latestPaymentKey = null;
            let maxDate = 0;
            Object.entries(data.payments).forEach(([k, p]) => {
                const pDate = p.date?.toDate ? p.date.toDate().getTime() : new Date(p.date).getTime();
                if (pDate > maxDate) {
                    maxDate = pDate;
                    latestPaymentKey = k;
                } else if (pDate === maxDate && k > latestPaymentKey) {
                    latestPaymentKey = k;
                }
            });
            if (latestPaymentKey === subData.ref) {
                isFinal = true;
            }
        }

        description = isFinal ? `Final Settlement for RFP number ${getDocIdentifier()}` : `Partial Payment for RFP number ${getDocIdentifier()}`;

        // Dynamically update title on the header as well
        if (isFinal) currentConfig.title = "Tax Invoice (Final)";
    }

    if (type === 'CREDIT_NOTE' && subData) {
        const amountCredited = parseFloat(subData.amount) || 0;
        displayTotal = amountCredited;
        if (data.vatApplicable) { displayAmount = displayTotal / 1.18; displayVat = displayTotal - displayAmount; }
        else { displayAmount = displayTotal; displayVat = 0; }
        description = `Reversal / Credit for RFP number ${getDocIdentifier()}`;
    }

    if (type === 'REMINDER' && subData) {
        const outstanding = parseFloat(subData.amount) || 0;
        displayTotal = outstanding;
        if (data.vatApplicable) { displayAmount = displayTotal / 1.18; displayVat = displayTotal - displayAmount; }
        else { displayAmount = displayTotal; displayVat = 0; }
        description = `Outstanding Balance for RFP number ${getDocIdentifier()}`;
    }

    let overdueDays = 0;
    if (type === 'REMINDER') {
        const issueDateRaw = data.issuedAt || data.createdAt;
        const issueDate = issueDateRaw ? (issueDateRaw.toDate ? issueDateRaw.toDate() : new Date(issueDateRaw)) : new Date();
        const reminderDate = currentConfig.date ? (currentConfig.date.toDate ? currentConfig.date.toDate() : new Date(currentConfig.date)) : new Date();
        const diffTime = reminderDate.getTime() - issueDate.getTime();
        overdueDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    }

    const issuerName = data.issuerDetails?.displayName || data.issuerDetails?.name || data.issuer || companyInfo.name;
    const issuerAddress = data.issuerDetails?.address || companyInfo.address;
    const issuerVat = data.issuerDetails?.vatNumber || companyInfo.vat;

    // Specifically for the Bank Account Holder name in footer - Prioritize explicit 'accountHolder' field
    const bankAccountHolder = data.issuerDetails?.accountHolder || data.issuerDetails?.displayName || data.issuerDetails?.name || issuerName;

    const recipientName = data.recipient || 'Valued Client';
    const recipientAddr = data.recipientAddress || '';
    const recipientVatNo = data.recipientVat || '';

    // Explicitly check contactPerson on root data object and clean it
    let contactPerson = data.contactPerson;

    // Cleaning Logic: Remove trailing commas or extra spaces if present
    if (contactPerson) {
        contactPerson = contactPerson.trim();
        if (contactPerson.endsWith(',')) {
            contactPerson = contactPerson.slice(0, -1).trim();
        }
        // If it becomes empty after trim, treat as null
        if (contactPerson.length === 0) contactPerson = null;
    }

    const isSuperseded = data.status === 'Superseded';

    const projectName = data.projectName || '';
    const normalize = (str) => str ? str.toLowerCase().replace(/\s+/g, ' ').trim() : '';
    const normProjectName = normalize(projectName);
    const normDescription = normalize(description);

    const showProjectName = projectName &&
        normProjectName.length > 3 &&
        !normDescription.includes(normProjectName);

    return (
        <div id="doc-print-area" className="relative">
            <style>{`
                @media print {
                    @page { 
                        size: A4 portrait; 
                        margin: 0;
                    }
                    html, body {
                        width: 210mm;
                        height: 297mm;
                        margin: 0 !important;
                        padding: 0 !important;
                        background: white;
                    }
                    #doc-print-area {
                        width: 210mm;
                        height: 297mm;
                        overflow: hidden;
                    }
                    .a4-page {
                        border: none !important;
                        box-shadow: none !important;
                        width: 210mm !important;
                        height: 297mm !important;
                        margin: 0 !important;
                        padding: 15mm 20mm !important;
                        background: white;
                    }
                    .watermark-container {
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        pointer-events: none;
                        z-index: 50;
                    }
                    .watermark-text {
                        font-size: 8rem;
                        font-weight: bold;
                        color: rgba(156, 163, 175, 0.5); /* gray-400 with 50% opacity */
                        transform: rotate(-45deg);
                        text-transform: uppercase;
                        white-space: nowrap;
                    }
                }
                .a4-page {
                    width: 210mm;
                    height: 297mm;
                    padding: 15mm 20mm;
                    margin: 0 auto;
                    background: white;
                    box-sizing: border-box;
                    position: relative;
                    border: 1px solid #e5e7eb;
                }
                .watermark-container {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    pointer-events: none;
                    z-index: 50;
                }
                .watermark-text {
                    font-size: 8rem;
                    font-weight: bold;
                    color: rgba(156, 163, 175, 0.5); /* gray-400 with 50% opacity */
                    transform: rotate(-45deg);
                    text-transform: uppercase;
                    white-space: nowrap;
                }
                .stamp-container {
                    position: absolute;
                    bottom: 25mm; /* Adjusted to be clearly above footer line */
                    right: 20mm;
                    border: 3px solid #ea580c; /* Orange-600 */
                    padding: 12px;
                    text-align: center;
                    color: #ea580c; /* Orange-600 */
                    opacity: 0.5;
                    width: 180px; /* Made narrower (was 240px) */
                    background-color: rgba(255, 255, 255, 0.7);
                    border-radius: 4px;
                    z-index: 100;
                }
                .stamp-header {
                    font-size: 14px;
                    font-weight: 900;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                    margin-bottom: 2px;
                }
                .stamp-sub {
                    font-size: 11px;
                    font-weight: bold;
                    text-transform: uppercase;
                }
                .stamp-sign-line {
                    border-bottom: 2px solid #ea580c;
                    margin: 35px 15px 5px 15px; /* Space for signature */
                    height: 1px;
                }
                .stamp-footer {
                    font-size: 10px;
                    font-weight: bold;
                    text-transform: uppercase;
                    margin-top: 2px;
                }
            `}</style>

            <div className="a4-page text-black font-sans text-sm flex flex-col relative overflow-hidden">
                {isSuperseded && type === 'RFP' && (
                    <div className="watermark-container"><div className="watermark-text">SUPERSEDED</div></div>
                )}

                {!isSuperseded && (
                    <div className="stamp-container">
                        <div className="stamp-header">ISSUED BY</div>
                        <div className="stamp-sub">{issuerName}</div>
                        <div className="stamp-sign-line"></div>
                        <div className="stamp-footer">Authorised Signature</div>
                        <div className="stamp-footer">{formatDate(currentConfig.date)}</div>
                    </div>
                )}

                {type === 'REMINDER' && (
                    <div className="bg-gray-100 border-l-4 border-black text-black p-3 mb-6 text-xs print:block relative z-10">
                        <p className="font-bold">OVERDUE NOTICE</p>
                        <p>This is a gentle reminder that the invoice below remains unpaid ({overdueDays > 0 ? overdueDays : 0} days overdue).</p>
                    </div>
                )}

                <div className="flex justify-between items-start border-b-2 border-black pb-4 mb-8 relative z-10 w-full">
                    <div>
                        <img src="/ias-logo.jpg" alt="Company Logo" className="h-12 w-auto mb-3" />
                        <h1 className="text-2xl font-bold uppercase tracking-wide text-black whitespace-nowrap">{currentConfig.title}</h1>
                    </div>
                    <div className="text-right text-black">
                        <h2 className="text-lg font-bold">{currentConfig.docLabel} {currentConfig.docNumber}</h2>
                        <p className="text-xs mt-1">{currentConfig.dateLabel}: {formatDate(currentConfig.date)}</p>
                        <p className="text-xs">Project Ref: {data.projectNumber}</p>
                    </div>
                </div>

                <div className="flex flex-col md:flex-row justify-between mb-8 gap-8 text-black relative z-10 w-full">
                    <div className="flex-1">
                        <h3 className="text-[10px] font-bold uppercase tracking-wider mb-2 border-b border-gray-400 pb-1 w-24">From</h3>
                        <div className="text-sm font-medium leading-tight">
                            <p className="font-bold text-base mb-1">{issuerName}</p>
                            <div className="whitespace-pre-line text-xs">{issuerAddress}</div>
                            <p className="mt-1 text-xs">VAT: {issuerVat}</p>
                        </div>
                    </div>
                    <div className="flex-1">
                        <h3 className="text-[10px] font-bold uppercase tracking-wider mb-2 border-b border-gray-400 pb-1 w-24">Bill To</h3>
                        <div className="text-sm font-medium leading-tight">
                            <p className="font-bold text-base mb-1">{recipientName}</p>
                            {recipientAddr && <div className="whitespace-pre-line text-xs">{recipientAddr}</div>}

                            {recipientVatNo && <p className="mt-1 text-xs">VAT: {recipientVatNo}</p>}

                            {/* Contact Person Line */}
                            {contactPerson && (
                                <p className="mt-1 text-xs">For the attn. of - {contactPerson}</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Main Content: Enforced Full Width */}
                <div className="flex-1 relative z-10 w-full">
                    <div className="mb-6 text-black w-full">
                        <h3 className="text-[10px] font-bold uppercase tracking-wider mb-2 border-b border-gray-400 pb-1 w-full">Description</h3>
                        {/* CONDITIONAL PROJECT NAME */}
                        {showProjectName && <p className="font-bold text-base w-full mb-1">{projectName}</p>}
                        <p className="mt-1 whitespace-pre-wrap text-sm w-full block font-normal">{description}</p>
                    </div>

                    <div className="mb-6 w-full">
                        {/* CHANGED: Logic to always use the 4-column layout for RFPs */}
                        {(data.items && data.items.length > 0) || type === 'RFP' ? (
                            <table className="w-full text-left border-collapse text-black text-sm">
                                <thead>
                                    <tr className="border-b-2 border-black">
                                        <th className="py-2 text-[10px] font-bold uppercase tracking-wider">Item</th>
                                        <th className="py-2 text-[10px] font-bold uppercase tracking-wider text-right w-24">Net</th>
                                        <th className="py-2 text-[10px] font-bold uppercase tracking-wider text-right w-20">VAT</th>
                                        <th className="py-2 text-[10px] font-bold uppercase tracking-wider text-right w-24">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.items && data.items.length > 0 ? (
                                        data.items.map((item, idx) => (
                                            <tr key={idx} className="border-b border-gray-300">
                                                <td className="py-3 pr-4 font-normal">{item.description}</td>
                                                <td className="py-3 text-right font-medium">{formatCurrency(item.net)}</td>
                                                <td className="py-3 text-right text-gray-600">{item.vat > 0 ? formatCurrency(item.vat) : '-'}</td>
                                                <td className="py-3 text-right font-bold">{formatCurrency(item.total)}</td>
                                            </tr>
                                        ))
                                    ) : (
                                        // Fallback row for manual RFPs without items array
                                        <tr className="border-b border-gray-300">
                                            <td className="py-3 pr-4 font-normal">Professional Services</td>
                                            <td className="py-3 text-right font-medium">{formatCurrency(displayAmount)}</td>
                                            <td className="py-3 text-right text-gray-600">{displayVat > 0 ? formatCurrency(displayVat) : '-'}</td>
                                            <td className="py-3 text-right font-bold">{formatCurrency(displayTotal)}</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        ) : (
                            // Fallback 2-column layout for Non-RFP types (if items are missing)
                            <table className="w-full text-left border-collapse text-black text-sm">
                                <thead>
                                    <tr className="border-b-2 border-black">
                                        <th className="py-2 text-[10px] font-bold uppercase tracking-wider">Item</th>
                                        <th className="py-2 text-[10px] font-bold uppercase tracking-wider text-right w-32">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="border-b border-gray-300">
                                        <td className="py-3 pr-4 font-normal">
                                            {type === 'PARTIAL' ? (subData?.type === 'Final Balance' ? 'Balance Settlement' : 'Partial Payment Allocation') :
                                                type === 'CREDIT_NOTE' ? 'Credit Note Allocation' :
                                                    type === 'REMINDER' ? 'Outstanding Balance Allocation' :
                                                        'Professional Services'}
                                        </td>
                                        <td className="py-3 text-right font-medium">{formatCurrency(displayAmount)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        )}
                    </div>

                    <div className="flex justify-end mb-10 text-black w-full">
                        <div className="w-full md:w-1/2 lg:w-1/3">
                            <div className="flex justify-between py-1 border-b border-gray-300">
                                <span className="font-medium text-xs">Subtotal</span>
                                <span className="font-bold text-sm">{formatCurrency(displayAmount)}</span>
                            </div>
                            <div className="flex justify-between py-1 border-b border-gray-300">
                                <span className="font-medium text-xs">Total VAT</span>
                                <span className="font-bold text-sm">{formatCurrency(displayVat)}</span>
                            </div>
                            <div className="flex justify-between py-2 border-b-2 border-black">
                                <span className="text-lg font-bold">Grand Total</span>
                                <span className="text-lg font-bold">{formatCurrency(displayTotal)}</span>
                            </div>

                            {(type === 'PARTIAL' || type === 'CREDIT_NOTE') && (
                                <div className="mt-4 pt-2 border-t-2 border-gray-200">
                                    <div className="flex justify-between items-center text-gray-700">
                                        <span className="font-bold text-xs uppercase">RFP Balance</span>
                                        <span className="font-mono font-bold text-sm">
                                            {formatCurrency(outstandingBalance)}
                                        </span>
                                    </div>
                                    <p className="text-[9px] text-right text-gray-400 mt-1">
                                        (Remaining on RFP #{getDocIdentifier()})
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="text-xs text-black border-t-2 border-black pt-4 mt-auto relative z-10 w-full">
                    {(type === 'RFP' || type === 'REMINDER' || type === 'INVOICE') && (
                        <div className="mb-4">
                            <h4 className="font-bold mb-1 uppercase text-[10px] tracking-wider">Payment Details</h4>
                            <div className="grid grid-cols-[100px_1fr] gap-y-0.5 text-[10px] leading-tight">
                                <span className="font-bold text-gray-500 uppercase">Account Holder</span>
                                <span>{bankAccountHolder}</span>

                                <span className="font-bold text-gray-500 uppercase">Bank</span>
                                <span>{data.issuerDetails?.bankName || 'Bank of Valletta'}</span>

                                <span className="font-bold text-gray-500 uppercase">IBAN</span>
                                <span className="font-mono">{data.issuerDetails?.iban || 'MT12 3456 7890 1234 5678'}</span>

                                <span className="font-bold text-gray-500 uppercase">SWIFT</span>
                                <span className="font-mono">{data.issuerDetails?.swift || 'BOVAMT22'}</span>
                            </div>
                        </div>
                    )}
                    <div>
                        <h4 className="font-bold mb-1 uppercase text-[10px] tracking-wider">Terms & Conditions</h4>
                        <p className="mb-0 text-gray-700 whitespace-pre-line text-[10px] leading-tight">{termsText}</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DocumentTemplate;