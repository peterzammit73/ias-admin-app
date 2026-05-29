// Root: functions/config.js
const admin = require("firebase-admin");
const { google } = require("googleapis");

// Initialize Admin SDK once
if (!admin.apps.length) {
    try {
        admin.initializeApp();
    } catch (e) {
        console.error("Firebase Admin Initialization Failed:", e);
    }
}

const db = admin.firestore();

// Detect environment
const isProduction = process.env.GCLOUD_PROJECT === "ias-web-01-01";
const keyFile = isProduction ? "./prod-service-account-key.json" : "./dev-service-account-key.json";

let serviceAccountKey = {};
try {
    // Attempt to load service account key if available locally
    // This allows local testing of Google APIs (Calendar/Gmail)
    // In production (Cloud Functions), we rely on ADC (Application Default Credentials) where possible
    // or Environment Variables if you uploaded the file.
    // Note: require() might throw if file missing.
    // We wrap in try/catch to prevent deployment crash if file is missing (common in CI/CD).
    serviceAccountKey = require(keyFile);
} catch (e) {
    console.warn(`Warning: Service account key [${keyFile}] not found. Google API features (Calendar/Gmail) may fail if not using ADC.`);
}

const SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/gmail.send'
];

/**
 * Factory to create an authorized Google API client for a specific user.
 * Supports Domain-Wide Delegation.
 */
async function getAuthorizedClient(userEmail) {
    if (!serviceAccountKey.client_email || !serviceAccountKey.private_key) {
        throw new Error("Service Account Key missing or invalid. Cannot authenticate with Google APIs.");
    }

    const jwtClient = new google.auth.JWT(
        serviceAccountKey.client_email,
        null,
        serviceAccountKey.private_key,
        SCOPES,
        userEmail
    );
    await jwtClient.authorize();
    return jwtClient;
}

module.exports = {
    admin,
    db,
    getAuthorizedClient,
    google
};