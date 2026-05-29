// Root: src/modules/admin/Settings.jsx
// Version: 2.4 - Added Maintenance Tab for Legacy Data Cleanup
import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, updateDoc, arrayUnion, collection, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { Cog6ToothIcon, BanknotesIcon, InformationCircleIcon, DocumentTextIcon, EnvelopeIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';

const Settings = () => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState('company'); // company, finance, templates, maintenance

    const [settings, setSettings] = useState({
        // Company Details
        companyName: 'Innovative Architectural Structures',
        companyRegNumber: '',
        companyAddress: '',
        companyPhone: '',
        contactEmail: '',

        // Financials
        defaultVatRate: 18,
        vatEffectiveDate: new Date().toISOString().split('T')[0],

        // Documents
        paymentTerms: 'Payment is due within 30 days of the invoice date. Please quote the Reference Number when making a payment.',
        termsRFP: '',
        termsInvoice: '',
        termsCreditNote: '',
        termsReminder: '',

        // Email Templates
        emailTemplates: {
            leaveNotification: {
                subject: 'New Leave Request from {{employeeName}}',
                body: 'You have a new leave request.\n\nDates: {{startDate}} to {{endDate}}.\n\nPlease log in to the portal to approve or deny.'
            },
            rfpIssued: {
                subject: 'New RFP Issued: {{rfpNumber}}',
                body: 'Attached please find the Request for Payment {{rfpNumber}} for project {{project}}.'
            }
        },

        // History Log
        vatHistory: []
    });

    const [originalVat, setOriginalVat] = useState(18);

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        setLoading(true);
        try {
            const docRef = doc(db, 'settings', 'company_settings');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                setSettings(prev => ({
                    ...prev,
                    ...data,
                    vatEffectiveDate: data.vatEffectiveDate ? data.vatEffectiveDate.split('T')[0] : new Date().toISOString().split('T')[0],
                    vatHistory: data.vatHistory || [],
                    emailTemplates: { ...prev.emailTemplates, ...data.emailTemplates },
                    termsRFP: data.termsRFP || data.paymentTerms || '',
                    termsInvoice: data.termsInvoice || data.paymentTerms || '',
                    termsCreditNote: data.termsCreditNote || data.paymentTerms || '',
                    termsReminder: data.termsReminder || data.paymentTerms || ''
                }));
                setOriginalVat(data.defaultVatRate);
            }
        } catch (error) {
            console.error("Error fetching settings:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        const { name, value, type } = e.target;
        setSettings(prev => ({
            ...prev,
            [name]: type === 'number' ? parseFloat(value) : value
        }));
    };

    const handleTemplateChange = (key, field, value) => {
        setSettings(prev => ({
            ...prev,
            emailTemplates: {
                ...prev.emailTemplates,
                [key]: {
                    ...prev.emailTemplates[key],
                    [field]: value
                }
            }
        }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const docRef = doc(db, 'settings', 'company_settings');
            const payload = { ...settings };

            if (payload.defaultVatRate !== originalVat) {
                const newHistoryEntry = {
                    rate: payload.defaultVatRate,
                    date: payload.vatEffectiveDate,
                    savedAt: new Date().toISOString(),
                    savedBy: 'Admin'
                };
                await updateDoc(docRef, { vatHistory: arrayUnion(newHistoryEntry) });
                payload.vatHistory = [...settings.vatHistory, newHistoryEntry];
                setOriginalVat(payload.defaultVatRate);
            }

            await setDoc(docRef, payload, { merge: true });
            alert("Settings updated successfully.");
        } catch (error) {
            console.error("Error saving settings:", error);
            alert("Failed to save settings.");
        } finally {
            setSaving(false);
        }
    };

    // --- DATA MAINTENANCE SCRIPT ---
    const handleStandardizeProjectNumbers = async () => {
        if (!window.confirm("This will scan RFPs, Projects, Timesheets, and Expenses to zero-pad legacy project numbers (e.g., '715' becomes '0715'). Proceed?")) return;
        setSaving(true);
        try {
            let updatedCount = 0;
            const collectionsToUpdate = [
                { name: 'rfps', field: 'projectNumber' },
                { name: 'projects', field: 'projectNumber' },
                { name: 'project_costs', field: 'projectNumber' },
                { name: 'timesheet_entries', field: 'project' }
            ];

            for (const coll of collectionsToUpdate) {
                const snap = await getDocs(collection(db, coll.name));
                let batch = writeBatch(db);
                let opCount = 0;

                for (const docSnap of snap.docs) {
                    const data = docSnap.data();
                    const currentVal = data[coll.field];

                    if (currentVal !== undefined && currentVal !== null) {
                        const strVal = String(currentVal).trim();
                        // Only pad if it consists entirely of 1 to 3 digits
                        if (/^\d{1,3}$/.test(strVal)) {
                            const padded = strVal.padStart(4, '0');
                            const updates = { [coll.field]: padded };

                            // Also fix the RFP Code formatting if we are updating an RFP document
                            if (coll.name === 'rfps') {
                                const fixCode = (code) => {
                                    if (!code) return code;
                                    const parts = code.split('-');
                                    // Format is typically SEQ-PROJ-ISSUER, e.g., 0001-715-iAS
                                    if (parts.length >= 2 && parts[1] === strVal) {
                                        parts[1] = padded;
                                        return parts.join('-');
                                    }
                                    return code;
                                };
                                if (data.rfpCode) updates.rfpCode = fixCode(data.rfpCode);
                                if (data.rfpNumber) updates.rfpNumber = fixCode(data.rfpNumber);
                            }

                            batch.update(docSnap.ref, updates);
                            opCount++;
                            updatedCount++;

                            if (opCount >= 400) {
                                await batch.commit();
                                batch = writeBatch(db);
                                opCount = 0;
                            }
                        }
                    }
                }
                if (opCount > 0) {
                    await batch.commit();
                }
            }
            alert(`Successfully standardized ${updatedCount} records to 4-digit project numbers.`);
        } catch (error) {
            console.error("Standardization Error:", error);
            alert(`Failed to standardize: ${error.message}`);
        } finally {
            setSaving(false);
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    if (loading) return <div className="p-8 text-center text-gray-500">Loading settings...</div>;

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm max-w-5xl mx-auto">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 border-b pb-4 gap-4">
                <div className="flex items-center">
                    <Cog6ToothIcon className="h-8 w-8 text-gray-700 mr-3" />
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">System Configuration</h1>
                        <p className="text-sm text-gray-500">Manage company profile and system defaults.</p>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button onClick={() => setActiveTab('company')} className={`px-4 py-2 text-sm font-medium rounded-md ${activeTab === 'company' ? 'bg-white shadow text-indigo-600' : 'text-gray-500'}`}>Company</button>
                    <button onClick={() => setActiveTab('finance')} className={`px-4 py-2 text-sm font-medium rounded-md ${activeTab === 'finance' ? 'bg-white shadow text-indigo-600' : 'text-gray-500'}`}>Finance</button>
                    <button onClick={() => setActiveTab('templates')} className={`px-4 py-2 text-sm font-medium rounded-md ${activeTab === 'templates' ? 'bg-white shadow text-indigo-600' : 'text-gray-500'}`}>Email Templates</button>
                    <button onClick={() => setActiveTab('maintenance')} className={`px-4 py-2 text-sm font-medium rounded-md ${activeTab === 'maintenance' ? 'bg-white shadow text-orange-600' : 'text-gray-500'}`}>Maintenance</button>
                </div>
            </div>

            <form onSubmit={handleSave} className="space-y-6">

                {activeTab === 'company' && (
                    <div className="bg-gray-50 p-5 rounded-lg border border-gray-200 animate-fade-in">
                        <h3 className="text-base font-bold text-gray-800 mb-4 flex items-center border-b border-gray-200 pb-2">
                            <InformationCircleIcon className="h-5 w-5 mr-2 text-indigo-600" /> Company Details
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-4">
                            <div className="md:col-span-2">
                                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Company Name</label>
                                <input type="text" name="companyName" value={settings.companyName} onChange={handleChange} className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm py-1.5" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Reg. Number</label>
                                <input type="text" name="companyRegNumber" value={settings.companyRegNumber} onChange={handleChange} className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm py-1.5" />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Registered Address</label>
                                <input type="text" name="companyAddress" value={settings.companyAddress} onChange={handleChange} className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm py-1.5" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Telephone</label>
                                <input type="tel" name="companyPhone" value={settings.companyPhone} onChange={handleChange} className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm py-1.5" />
                            </div>
                            <div className="md:col-span-3">
                                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">System Contact Email</label>
                                <input type="email" name="contactEmail" value={settings.contactEmail} onChange={handleChange} className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm py-1.5" />
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'finance' && (
                    <div className="space-y-6 animate-fade-in">
                        <div className="bg-gray-50 p-5 rounded-lg border border-gray-200">
                            <h3 className="text-base font-bold text-gray-800 mb-4 flex items-center border-b border-gray-200 pb-2">
                                <BanknotesIcon className="h-5 w-5 mr-2 text-indigo-600" /> VAT Configuration
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                                <div className="bg-white p-4 rounded border border-indigo-100 shadow-sm">
                                    <div className="mb-4">
                                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Current VAT Rate (%)</label>
                                        <input type="number" name="defaultVatRate" value={settings.defaultVatRate} onChange={handleChange} className="block w-full rounded-md border-gray-300 shadow-sm text-lg font-bold py-2 text-indigo-600" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Effective Date</label>
                                        <input type="date" name="vatEffectiveDate" value={settings.vatEffectiveDate} onChange={handleChange} className="block w-full rounded-md border-gray-300 sm:text-sm" />
                                    </div>
                                </div>
                                <div className="bg-white border border-gray-200 rounded-md p-3 h-full">
                                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-2 border-b pb-1">Rate History</h4>
                                    <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
                                        {settings.vatHistory.map((h, i) => (
                                            <div key={i} className="text-xs flex justify-between bg-gray-50 p-2 rounded">
                                                <span className="font-bold">{h.rate}%</span>
                                                <span className="text-gray-500">From {formatDate(h.date)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-gray-50 p-5 rounded-lg border border-gray-200">
                            <h3 className="text-base font-bold text-gray-800 mb-4 flex items-center border-b border-gray-200 pb-2">
                                <DocumentTextIcon className="h-5 w-5 mr-2 text-indigo-600" /> Document Terms & Conditions
                            </h3>
                            <div className="grid grid-cols-1 gap-6">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Request for Payment (RFP)</label>
                                    <textarea name="termsRFP" rows="3" value={settings.termsRFP} onChange={handleChange} placeholder="Terms for standard RFPs..." className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm focus:border-indigo-500 focus:ring-indigo-500" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Tax Invoice (Full & Partial)</label>
                                    <textarea name="termsInvoice" rows="3" value={settings.termsInvoice} onChange={handleChange} placeholder="Terms for invoices..." className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm focus:border-indigo-500 focus:ring-indigo-500" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Credit Note</label>
                                    <textarea name="termsCreditNote" rows="3" value={settings.termsCreditNote} onChange={handleChange} placeholder="Terms for credit notes..." className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm focus:border-indigo-500 focus:ring-indigo-500" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Payment Reminder</label>
                                    <textarea name="termsReminder" rows="3" value={settings.termsReminder} onChange={handleChange} placeholder="Terms for reminders (e.g. overdue notices)..." className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm focus:border-indigo-500 focus:ring-indigo-500" />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'templates' && (
                    <div className="bg-gray-50 p-5 rounded-lg border border-gray-200 animate-fade-in">
                        <h3 className="text-base font-bold text-gray-800 mb-4 flex items-center border-b border-gray-200 pb-2">
                            <EnvelopeIcon className="h-5 w-5 mr-2 text-indigo-600" /> Email Templates
                        </h3>
                        <div className="space-y-6">
                            {/* Leave Notification */}
                            <div className="bg-white p-4 rounded border border-gray-200">
                                <h4 className="font-bold text-gray-700 text-sm mb-2">Leave Notification</h4>
                                <div className="grid gap-3">
                                    <div>
                                        <label className="block text-xs text-gray-500">Subject</label>
                                        <input type="text" value={settings.emailTemplates?.leaveNotification?.subject || ''} onChange={e => handleTemplateChange('leaveNotification', 'subject', e.target.value)} className="w-full border-gray-300 rounded-md text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-500">Body</label>
                                        <textarea rows="4" value={settings.emailTemplates?.leaveNotification?.body || ''} onChange={e => handleTemplateChange('leaveNotification', 'body', e.target.value)} className="w-full border-gray-300 rounded-md text-sm" />
                                        <p className="text-[10px] text-gray-400 mt-1">Variables: {'{{employeeName}}, {{startDate}}, {{endDate}}'}</p>
                                    </div>
                                </div>
                            </div>
                            {/* RFP Notification */}
                            <div className="bg-white p-4 rounded border border-gray-200">
                                <h4 className="font-bold text-gray-700 text-sm mb-2">RFP Issued</h4>
                                <div className="grid gap-3">
                                    <div>
                                        <label className="block text-xs text-gray-500">Subject</label>
                                        <input type="text" value={settings.emailTemplates?.rfpIssued?.subject || ''} onChange={e => handleTemplateChange('rfpIssued', 'subject', e.target.value)} className="w-full border-gray-300 rounded-md text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-500">Body</label>
                                        <textarea rows="4" value={settings.emailTemplates?.rfpIssued?.body || ''} onChange={e => handleTemplateChange('rfpIssued', 'body', e.target.value)} className="w-full border-gray-300 rounded-md text-sm" />
                                        <p className="text-[10px] text-gray-400 mt-1">Variables: {'{{rfpNumber}}, {{project}}'}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'maintenance' && (
                    <div className="bg-gray-50 p-5 rounded-lg border border-gray-200 animate-fade-in">
                        <h3 className="text-base font-bold text-gray-800 mb-4 flex items-center border-b border-gray-200 pb-2">
                            <WrenchScrewdriverIcon className="h-5 w-5 mr-2 text-orange-600" /> Database Maintenance Tools
                        </h3>
                        <div className="space-y-6">
                            <div className="bg-white p-4 rounded border border-gray-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                <div>
                                    <h4 className="font-bold text-gray-800 text-sm">Standardize Legacy Project Numbers</h4>
                                    <p className="text-xs text-gray-500 mt-1 max-w-lg">
                                        Scans all RFPs, Timesheets, Projects, and Expenses for 1-to-3 digit project numbers (e.g., <strong>715</strong>) and updates them to a standard 4-digit format (e.g., <strong>0715</strong>). Also fixes affected RFP codes.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleStandardizeProjectNumbers}
                                    disabled={saving}
                                    className="whitespace-nowrap px-4 py-2 bg-orange-600 text-white rounded text-sm font-bold shadow-md hover:bg-orange-700 disabled:opacity-50"
                                >
                                    {saving ? 'Processing...' : 'Run Zero-Padding Fix'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab !== 'maintenance' && (
                    <div className="flex justify-end pt-4">
                        <button type="submit" disabled={saving} className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-8 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
                            {saving ? 'Saving...' : 'Save All Changes'}
                        </button>
                    </div>
                )}
            </form>
        </div>
    );
};

export default Settings;