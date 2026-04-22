import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
// Uses getApps() to check if an app is already initialized to prevent errors during hot-reload
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize & Export Services
export const db = getFirestore(app);
export const auth = getAuth(app);

// Initialize Functions with specific region if needed
// Default is 'us-central1'. If you deploy to 'europe-west1', change it here:
// export const functions = getFunctions(app, 'europe-west1');
export const functions = getFunctions(app, 'us-central1');

export default app;