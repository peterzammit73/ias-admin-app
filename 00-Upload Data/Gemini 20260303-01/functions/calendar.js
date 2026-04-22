// Root: functions/calendar.js
const functions = require("firebase-functions");
const { db, getAuthorizedClient, google } = require("./config");

// 1. Add Calendar Event
exports.addCalendarEvent = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");
    const { userEmail, title, startTime, endTime } = data;
    try {
        const authClient = await getAuthorizedClient(userEmail);
        const calendar = google.calendar({ version: 'v3', auth: authClient });
        await calendar.events.insert({
            calendarId: 'primary',
            requestBody: {
                summary: title,
                start: { dateTime: new Date(startTime).toISOString() },
                end: { dateTime: new Date(endTime).toISOString() }
            }
        });
        return { status: "success" };
    } catch (error) {
        throw new functions.https.HttpsError("internal", error.message);
    }
});

// 2. Delete Calendar Event
exports.deleteCalendarEvent = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");
    const { userEmail, eventId } = data;
    try {
        const authClient = await getAuthorizedClient(userEmail);
        const calendar = google.calendar({ version: 'v3', auth: authClient });
        try {
            await calendar.events.delete({ calendarId: 'primary', eventId: eventId });
        } catch (calError) {
            if (calError.code !== 404 && calError.code !== 410) throw calError;
        }

        // Clean up linked timesheet entry if it exists
        const batch = db.batch();
        const docRef = db.collection('timesheet_entries').doc(eventId);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            batch.delete(docRef);
        } else {
            const q = db.collection('timesheet_entries').where('eventId', '==', eventId);
            const snaps = await q.get();
            snaps.forEach(d => batch.delete(d.ref));
        }
        await batch.commit();
        return { status: "success" };
    } catch (error) {
        throw new functions.https.HttpsError("internal", error.message);
    }
});

// 3. Update Calendar Event
exports.updateCalendarEvent = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");
    const { userEmail, eventId, newTitle } = data;
    try {
        const authClient = await getAuthorizedClient(userEmail);
        const calendar = google.calendar({ version: 'v3', auth: authClient });
        await calendar.events.patch({
            calendarId: 'primary',
            eventId: eventId,
            requestBody: { summary: newTitle }
        });
        return { status: "success" };
    } catch (error) {
        throw new functions.https.HttpsError("internal", error.message);
    }
});