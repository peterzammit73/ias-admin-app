// Root: functions/triggers.js
// Version: 1.9 - Fixed Deployment Error (Replaced documentGroup with document)
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { db } = require("./config");

/**
 * Sets the 'isStale' flag and records the modified project number.
 */
const markReportAsStale = async (projectNumber) => {
    const docRef = db.collection('settings').doc('wip_status');
    try {
        const updateData = {
            isStale: true,
            lastModification: admin.firestore.Timestamp.now()
        };
        if (projectNumber) {
            updateData.modifiedProjects = admin.firestore.FieldValue.arrayUnion(String(projectNumber));
        }
        await docRef.set(updateData, { merge: true });
        console.log(`WIP Report marked as stale. Modified Project: ${projectNumber || 'Unknown'}`);
    } catch (error) {
        console.error("Failed to mark WIP report as stale:", error);
    }
};

/**
 * Marks Financial Report as Stale
 */
const markFinancialsAsStale = async () => {
    try {
        await db.collection('settings').doc('financial_status').set({
            isStale: true,
            lastModification: admin.firestore.Timestamp.now()
        }, { merge: true });
        console.log("Financial Report marked as stale.");
    } catch (error) {
        console.error("Failed to mark Financials as stale:", error);
    }
};

const IGNORED_METHODS = ['bulk_archive_cleanup', 'rfp_issue'];

exports.onTimesheetWrite = functions.firestore
    .document('timesheet_entries/{docId}')
    .onWrite(async (change, context) => {
        if (!change.after.exists && !change.before.exists) return null;
        const after = change.after.exists ? change.after.data() : {};
        const before = change.before.exists ? change.before.data() : {};

        if (after.billingMethod && IGNORED_METHODS.includes(after.billingMethod)) return null;

        const projectNumber = after.project || before.project;

        if (!change.before.exists) return markReportAsStale(projectNumber);
        if (!change.after.exists) return markReportAsStale(projectNumber);

        if (before.billingStatus !== after.billingStatus) return markReportAsStale(projectNumber);
        if (before.duration !== after.duration) return markReportAsStale(projectNumber);
        if (before.project !== after.project) return markReportAsStale(projectNumber);

        const dateBefore = (before.date && typeof before.date.toMillis === 'function') ? before.date.toMillis() : (before.date || 0);
        const dateAfter = (after.date && typeof after.date.toMillis === 'function') ? after.date.toMillis() : (after.date || 0);

        if (dateBefore !== dateAfter) return markReportAsStale(projectNumber);

        return null;
    });

exports.onCostWrite = functions.firestore
    .document('project_costs/{docId}')
    .onWrite(async (change, context) => {
        if (!change.after.exists && !change.before.exists) return null;
        const after = change.after.exists ? change.after.data() : {};
        const before = change.before.exists ? change.before.data() : {};

        if (after.billingMethod && IGNORED_METHODS.includes(after.billingMethod)) return null;

        const projectNumber = after.projectNumber || before.projectNumber;

        if (!change.before.exists) return markReportAsStale(projectNumber);
        if (!change.after.exists) return markReportAsStale(projectNumber);

        if (before.billingStatus !== after.billingStatus) return markReportAsStale(projectNumber);
        if (before.amount !== after.amount) return markReportAsStale(projectNumber);
        if (before.projectNumber !== after.projectNumber) return markReportAsStale(projectNumber);

        return null;
    });

// NEW: Trigger for Salary Changes (FIXED SYNTAX)
// Using explicit wildcard path instead of documentGroup for compatibility
exports.onSalaryWrite = functions.firestore
    .document('employees/{employeeId}/salary_history/{salaryId}')
    .onWrite(async (change, context) => {
        return markFinancialsAsStale();
    });

// NEW: Trigger for Overhead Changes
exports.onOverheadWrite = functions.firestore
    .document('settings/company_settings/overhead_periods/{docId}')
    .onWrite(async (change, context) => {
        return markFinancialsAsStale();
    });