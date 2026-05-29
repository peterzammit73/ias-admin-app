// Root: functions/index.js
// Version: 3.4 - Added notifyTaskReview export
const billing = require('./billing');
const calendar = require('./calendar');
const notifications = require('./notifications');
const timesheets = require('./timesheets');
const triggers = require('./triggers');
const reporting = require('./reporting');

// Billing Functions
exports.manageRFPIssuer = billing.manageRFPIssuer;
exports.createRFP = billing.createRFP;
exports.issueRFP = billing.issueRFP;
exports.managePayment = billing.managePayment;
exports.cancelRFP = billing.cancelRFP;
exports.reviseRFP = billing.reviseRFP;

// Reporting & Tools
exports.generateWIPReport = billing.generateWIPReport;
exports.getProjectUnbilledDetails = billing.getProjectUnbilledDetails;
exports.bulkArchiveEntries = billing.bulkArchiveEntries;
exports.generateProjectAudit = billing.generateProjectAudit;

// Financial Reporting
exports.generateFinancialReport = reporting.generateFinancialReport;
exports.generateDailyDashboard = reporting.generateDailyDashboard;
exports.generateMonthlyFinancialReport = reporting.generateMonthlyFinancialReport;
exports.generateGlobalProjectReport = reporting.generateGlobalProjectReport;
exports.generateRevenueReport = reporting.generateRevenueReport;

// Calendar Functions
exports.addCalendarEvent = calendar.addCalendarEvent;
exports.deleteCalendarEvent = calendar.deleteCalendarEvent;
exports.updateCalendarEvent = calendar.updateCalendarEvent;

// Notification Functions
exports.sendEmailNotification = notifications.sendEmailNotification;
exports.sendLeaveNotification = notifications.sendLeaveNotification;
exports.notifyTaskReview = notifications.notifyTaskReview;

// Timesheet Functions
exports.validateTimesheets = timesheets.validateTimesheets;
exports.getTimesheetCompletionStatus = timesheets.getTimesheetCompletionStatus;
exports.getMonthlyReportData = timesheets.getMonthlyReportData;
exports.uploadTimesheetEntries = timesheets.uploadTimesheetEntries;
exports.deleteTimesheetEntry = timesheets.deleteTimesheetEntry;

// Triggers
exports.onTimesheetWrite = triggers.onTimesheetWrite;
exports.onCostWrite = triggers.onCostWrite;
exports.onSalaryWrite = triggers.onSalaryWrite;