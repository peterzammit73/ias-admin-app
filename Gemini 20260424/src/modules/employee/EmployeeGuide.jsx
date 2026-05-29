// Root: src/modules/employee/EmployeeGuide.jsx
// Version: 3.0 - Updated with Task Board features
import React from 'react';
import {
    CalendarDaysIcon,
    PlusIcon,
    LockClosedIcon,
    TableCellsIcon,
    BriefcaseIcon,
    UserGroupIcon,
    BookmarkIcon
} from '@heroicons/react/24/outline';

export default function EmployeeGuide() {
    return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded-xl shadow-sm border border-gray-200">
            <header className="mb-8 border-b border-gray-100 pb-4">
                <h1 className="text-3xl font-bold text-gray-900">Office Staff Guide</h1>
                <p className="text-gray-500 mt-2">A guide to managing your daily workflow, timesheets, leave, and calendar using the iAS Portal.</p>
            </header>

            {/* SECTION 1: TASK BOARD */}
            <section className="mb-10">
                <div className="flex items-center gap-2 mb-4">
                    <BriefcaseIcon className="h-8 w-8 text-orange-600" />
                    <h2 className="text-2xl font-bold text-gray-800">Task Board</h2>
                </div>
                <div className="prose text-gray-600 space-y-4">
                    <p>
                        The <strong>Task Board</strong> is your default landing page and personal workspace. It helps you manage your daily workflow, project assignments, and personal reminders.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                            <h4 className="font-bold flex items-center gap-2 mb-2"><UserGroupIcon className="h-5 w-5 text-gray-500" /> Manager Assignments</h4>
                            <p className="text-sm">
                                Official tasks assigned to you by project managers. They include a target completion date and a time budget. Click on an assignment to break it down into smaller, actionable steps.
                            </p>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                            <h4 className="font-bold flex items-center gap-2 mb-2"><BookmarkIcon className="h-5 w-5 text-gray-500" /> Private To-Do List</h4>
                            <p className="text-sm">
                                A personal workspace for your own reminders, site visits, or ad-hoc tasks. This list is private to you and is not tracked against project budgets.
                            </p>
                        </div>
                    </div>

                    <h3 className="text-xl font-semibold text-gray-800 mt-6">Managing Subtasks</h3>
                    <p>
                        When you click on any task (assigned or personal), the right panel opens your <strong>Action Plan</strong>. Here you can:
                    </p>
                    <ul className="list-disc list-inside space-y-2 ml-4">
                        <li>Add new subtasks or steps to keep track of your progress.</li>
                        <li>Check off subtasks as you complete them to update your progress bar.</li>
                        <li>Mark the entire assignment as "Done" using the checkmark icon on the left panel once all steps are completed.</li>
                    </ul>
                </div>
            </section>

            <hr className="border-gray-200 my-8" />

            {/* SECTION 2: MY TIMESHEET */}
            <section className="mb-10">
                <div className="flex items-center gap-2 mb-4">
                    <CalendarDaysIcon className="h-8 w-8 text-indigo-600" />
                    <h2 className="text-2xl font-bold text-gray-800">My Timesheet</h2>
                </div>
                <div className="prose text-gray-600 space-y-4">
                    <p>
                        The <strong>My Timesheet</strong> tab is your central hub for tracking work hours. It synchronizes directly with your
                        <strong> iAS Google Calendar</strong>. Any changes you make here will be reflected on your calendar, and vice-versa.
                    </p>

                    <div className="bg-blue-50 border-l-4 border-blue-500 p-4 my-4">
                        <h3 className="font-bold text-blue-800 text-lg mb-2">Key Features</h3>
                        <ul className="list-disc list-inside space-y-1 text-blue-700">
                            <li><strong>Live Sync:</strong> Events are fetched from your Google Calendar in real-time.</li>
                            <li><strong>Validation:</strong> The system automatically checks if your calendar entries follow the correct format: <code>PROJECT-TASK-COMMENT</code>.</li>
                            <li><strong>Manual Entry:</strong> You can add entries directly if you forgot to put them in your calendar.</li>
                        </ul>
                    </div>

                    <h3 className="text-xl font-semibold text-gray-800 mt-6">1. Adding a New Entry</h3>
                    <p>
                        If you need to add a work log manually (e.g., you missed adding it to your Google Calendar), use the
                        <span className="inline-flex items-center px-2 py-0.5 mx-1 rounded text-xs font-medium bg-indigo-100 text-indigo-800"><PlusIcon className="h-3 w-3 mr-1" /> Add</span> button
                        available in the <strong>Week View</strong>.
                    </p>
                    <ol className="list-decimal list-inside bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-2 text-sm">
                        <li>Click the <strong>Add</strong> button in the top right.</li>
                        <li>Select the <strong>Date</strong>, <strong>Start Time</strong>, and <strong>Duration</strong>.</li>
                        <li><strong>Select Project:</strong> Choose from the dropdown of <em>Active</em> projects.</li>
                        <li><strong>Select Department:</strong> Choose your department (e.g., Architecture, Structural).</li>
                        <li><strong>Select Task:</strong> Pick the specific task code. The system formats this as <code>DEPT/CODE</code>.</li>
                        <li>(Optional) Add a short <strong>Comment</strong>.</li>
                        <li>Click <strong>Add to Calendar</strong>. The entry will appear on your Google Calendar immediately.</li>
                    </ol>

                    <h3 className="text-xl font-semibold text-gray-800 mt-6">2. Editing & Deleting Entries</h3>
                    <p>You can click on any event in the Week View to see details or modify it.</p>
                    <ul className="list-disc list-inside space-y-2 ml-4">
                        <li>
                            <strong>Unbilled/New Entries (Purple/Blue):</strong> You can freely <span className="text-indigo-600 font-medium">Edit</span> the title or <span className="text-red-600 font-medium">Delete</span> these entries.
                            <em> Deleting an entry here will also remove it from your Google Calendar.</em>
                        </li>
                        <li className="flex items-start gap-2">
                            <LockClosedIcon className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                            <span>
                                <strong>Logged Entries (Green):</strong> Once an entry has been officially scanned and saved to the company database ("Logged"), it becomes <strong>locked</strong>.
                                You will see a lock icon and a message preventing editing or deletion. If you need to change a logged entry, please contact the Office Admin.
                            </span>
                        </li>
                    </ul>

                    <h3 className="text-xl font-semibold text-gray-800 mt-6">3. Views & Summary</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                            <h4 className="font-bold flex items-center gap-2 mb-2"><CalendarDaysIcon className="h-5 w-5 text-gray-500" /> Week View</h4>
                            <p className="text-sm">
                                Shows a visual calendar of your week.
                            </p>
                            <br />
                            <p className="text-sm font-bold">Header Metrics:</p>
                            <ul className="list-disc list-inside mt-1 ml-1 text-xs text-gray-600">
                                <li><strong>Expected:</strong> Your target hours (8h/day minus approved leave).</li>
                                <li><strong>Logged:</strong> Hours already saved in the DB.</li>
                                <li><strong>New Correct:</strong> Valid calendar entries waiting to be logged.</li>
                                <li><strong>Error:</strong> Entries with invalid formats or inactive projects.</li>
                            </ul>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                            <h4 className="font-bold flex items-center gap-2 mb-2"><TableCellsIcon className="h-5 w-5 text-gray-500" /> Month View</h4>
                            <p className="text-sm">
                                A tabular summary of your hours week-by-week.
                            </p>
                            <br />
                            <p className="text-sm font-bold">Columns:</p>
                            <ul className="list-disc list-inside mt-1 ml-1 text-xs text-gray-600">
                                <li><strong>Exp:</strong> Expected Hours.</li>
                                <li><strong>Log:</strong> Logged Hours.</li>
                                <li><strong>Leave:</strong> Approved Vacation Leave.</li>
                                <li><strong>Sick:</strong> Sick Leave taken.</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </section>

            <hr className="border-gray-200 my-8" />

            {/* SECTION 3: LEAVE & OTHER */}
            <section>
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Other Features</h2>
                <div className="grid md:grid-cols-2 gap-6">
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                        <h3 className="font-bold text-lg text-gray-800 mb-2">Leave Management</h3>
                        <p className="text-gray-600 text-sm">
                            Use the <strong>Leave</strong> tab to request time off. Select dates on the calendar and choose between 'Vacation' or 'Sick'.
                            Your manager will receive a notification for approval.
                        </p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                        <h3 className="font-bold text-lg text-gray-800 mb-2">Project Codes</h3>
                        <p className="text-gray-600 text-sm">
                            Always ensure you are using <strong>Active</strong> project numbers found in the <strong>Projects</strong> tab. If a project is 'Archived' or 'Pending',
                            time booked against it will show as an <span className="text-red-600 font-medium">Error</span> in your timesheet.
                        </p>
                    </div>
                </div>
            </section>
        </div>
    );
}