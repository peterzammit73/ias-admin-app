// Root: functions/notifications.js
const functions = require("firebase-functions");
const { getAuthorizedClient, google } = require("./config");
const MailComposer = require('nodemailer/lib/mail-composer');

exports.sendEmailNotification = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");
    const { invalidEntriesByEmployee } = data;
    const adminEmail = context.auth.token.email;

    try {
        const authClient = await getAuthorizedClient(adminEmail);
        const gmail = google.gmail({ version: 'v1', auth: authClient });

        for (const email in invalidEntriesByEmployee) {
            const listItems = invalidEntriesByEmployee[email].map(e => `<li><b>Date:</b> ${e.date} - <b>Entry:</b> "${e.title}"</li>`).join('');
            const mail = new MailComposer({
                from: adminEmail,
                to: email,
                subject: 'Action Required: Timesheet Correction',
                html: `<p>Please correct the following entries:</p><ul>${listItems}</ul>`
            });
            const message = await mail.compile().build();
            const raw = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
        }
        return { status: "success" };
    } catch (e) {
        throw new functions.https.HttpsError("internal", e.message);
    }
});

exports.sendLeaveNotification = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

    const { recipients, requesterName, startDate, endDate } = data;
    const senderEmail = context.auth.token.email;

    try {
        const authClient = await getAuthorizedClient(senderEmail);
        const gmail = google.gmail({ version: 'v1', auth: authClient });

        for (const recipientEmail of recipients) {
            const mail = new MailComposer({
                from: senderEmail,
                to: recipientEmail,
                subject: `New Leave Request: ${requesterName}`,
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                        <h2 style="color: #ea580c;">New Leave Request</h2>
                        <p><strong>${requesterName}</strong> has requested leave.</p>
                        <ul style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; list-style: none;">
                            <li><strong>Start Date:</strong> ${startDate}</li>
                            <li><strong>End Date:</strong> ${endDate}</li>
                        </ul>
                        <p>Please log in to the iAS Portal to approve or deny this request.</p>
                    </div>
                `
            });

            const message = await mail.compile().build();
            const raw = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

            await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
        }

        return { status: "success" };
    } catch (e) {
        console.error("Leave Notification Failed:", e);
        return { status: "error", message: e.message };
    }
});

exports.notifyTaskReview = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

    const { managerEmail, taskTitle, employeeName } = data;
    const senderEmail = context.auth.token.email;

    try {
        const authClient = await getAuthorizedClient(senderEmail);
        const gmail = google.gmail({ version: 'v1', auth: authClient });

        const mail = new MailComposer({
            from: senderEmail,
            to: managerEmail,
            subject: `Task Ready for Review: ${taskTitle}`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #ea580c;">Task Completion Review</h2>
                    <p><strong>${employeeName}</strong> has marked the following assigned task as complete:</p>
                    <ul style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; list-style: none;">
                        <li><strong>Task:</strong> ${taskTitle}</li>
                    </ul>
                    <p>Please log in to the iAS Portal (Design Team -> Resource Planning) to review and approve or reject this task.</p>
                </div>
            `
        });

        const message = await mail.compile().build();
        const raw = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });

        return { status: "success" };
    } catch (e) {
        console.error("Task Review Notification Failed:", e);
        return { status: "error", message: e.message };
    }
});