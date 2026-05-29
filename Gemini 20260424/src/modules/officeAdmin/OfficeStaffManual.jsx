import React from 'react';
import { 
    UserPlusIcon, 
    PencilSquareIcon, 
    ClockIcon, 
    EyeIcon, 
    CheckCircleIcon, 
    XCircleIcon,
    MagnifyingGlassIcon
} from '@heroicons/react/24/outline';

const OfficeStaffManual = () => {
    return (
        <div className="bg-white p-8 rounded-lg shadow-sm max-w-5xl mx-auto">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Office Staff Management Manual</h1>
            <p className="text-lg text-gray-600 mb-8 border-b pb-4">
                A comprehensive guide on how to add, edit, and manage employee profiles and employment history using the Office Staff tab.
            </p>

            <div className="space-y-12">
                
                {/* Section 1: Overview */}
                <section>
                    <h2 className="text-xl font-bold text-indigo-700 flex items-center mb-4">
                        <MagnifyingGlassIcon className="h-6 w-6 mr-2"/> 1. Overview & Searching
                    </h2>
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 text-sm text-gray-700 space-y-2">
                        <p>The <strong>Office Staff</strong> tab is the central database for all employees. It controls who can log in, who appears in the company directory, and how leave is calculated.</p>
                        <ul className="list-disc pl-5 space-y-1 mt-2">
                            <li><strong>Search Bar:</strong> You can search for staff by First Name, Surname, or Employee Number.</li>
                            <li><strong>Active/All Toggle:</strong> By default, the list shows only <strong>Active</strong> employees. Switch to "All" to view former employees.</li>
                        </ul>
                    </div>
                </section>

                {/* Section 2: Adding Employees */}
                <section>
                    <h2 className="text-xl font-bold text-indigo-700 flex items-center mb-4">
                        <UserPlusIcon className="h-6 w-6 mr-2"/> 2. Adding a New Employee
                    </h2>
                    <div className="prose text-sm text-gray-700">
                        <p className="mb-2">Click the <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-600 text-white">Add Employee</span> button to open the creation form. The system will automatically assign the next available <strong>Employee Number</strong>.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            <div className="border p-3 rounded-md">
                                <h4 className="font-bold mb-2">Required Fields</h4>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li><strong>First Name & Surname:</strong> Essential for identification.</li>
                                    <li><strong>Company Email:</strong> This is critical. It links the profile to the user's login account and calendar.</li>
                                </ul>
                            </div>
                            <div className="border p-3 rounded-md">
                                <h4 className="font-bold mb-2">Status Settings</h4>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li><strong>Currently Employed:</strong> Uncheck this only for past employees.</li>
                                    <li><strong>Visible in Directory:</strong> If unchecked, the employee exists in the system but won't appear in the general "Office Staff" directory used by other staff.</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Section 3: Employment History (Crucial) */}
                <section>
                    <h2 className="text-xl font-bold text-indigo-700 flex items-center mb-4">
                        <ClockIcon className="h-6 w-6 mr-2"/> 3. Managing Employment History
                    </h2>
                    <div className="bg-orange-50 border-l-4 border-orange-400 p-4 mb-4">
                        <p className="font-bold text-orange-800 text-sm">⚠️ Important for Payroll & Leave</p>
                        <p className="text-sm text-orange-700 mt-1">
                            The system uses the <strong>Employment Timeline</strong> to calculate leave entitlement and verify timesheets. 
                            Every employee must have at least one timeline entry.
                        </p>
                    </div>
                    
                    <div className="space-y-4 text-sm text-gray-700">
                        <h3 className="font-bold text-gray-900">How to add a timeline entry:</h3>
                        <ol className="list-decimal pl-5 space-y-2">
                            <li>Open the employee profile (Edit mode).</li>
                            <li>Scroll to <strong>Employment Timeline</strong>.</li>
                            <li>Select a <strong>Start Date</strong> (e.g., the day they joined).</li>
                            <li>Leave <strong>End Date</strong> blank if they are currently employed.</li>
                            <li>Click the <strong>Add</strong> (or Checkmark) button to save the period.</li>
                        </ol>

                        <h3 className="font-bold text-gray-900 mt-4">What happens when an employee resigns?</h3>
                        <p>Do not just delete the profile! Instead:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Find their current "Present" timeline entry.</li>
                            <li>Edit it to add the <strong>End Date</strong> (their last day).</li>
                            <li>Uncheck the "Currently Employed" box at the top of the form.</li>
                        </ul>
                    </div>
                </section>

                {/* Section 4: Editing & Permissions */}
                <section>
                    <h2 className="text-xl font-bold text-indigo-700 flex items-center mb-4">
                        <PencilSquareIcon className="h-6 w-6 mr-2"/> 4. Editing & Status Icons
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                        <div className="flex items-center p-3 bg-green-50 rounded border border-green-100">
                            <span className="px-2 py-1 rounded-full bg-green-100 text-green-800 text-xs font-bold mr-2">Active</span>
                            <span className="text-sm">Current staff member.</span>
                        </div>
                        <div className="flex items-center p-3 bg-red-50 rounded border border-red-100">
                            <span className="px-2 py-1 rounded-full bg-red-100 text-red-800 text-xs font-bold mr-2">Inactive</span>
                            <span className="text-sm">Former staff member.</span>
                        </div>
                        <div className="flex items-center p-3 bg-gray-50 rounded border border-gray-200">
                            <EyeIcon className="h-5 w-5 text-gray-400 mr-2"/>
                            <span className="text-sm">Visible in directory.</span>
                        </div>
                    </div>
                    <p className="text-sm text-gray-700">
                        To edit any details, click the <PencilSquareIcon className="h-4 w-4 inline text-indigo-600"/> icon next to the employee's name. 
                        Changes to names or emails reflect immediately across the system (e.g., in Dropdowns and Reports).
                    </p>
                </section>
            </div>
        </div>
    );
};

export default OfficeStaffManual;