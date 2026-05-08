// Root: src/pages/LoginPage.jsx
// Version: 1.2
import React, { useState } from 'react';
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut
} from 'firebase/auth';
import { collection, query, where, getDocs, setDoc, doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { EnvelopeIcon, LockClosedIcon } from '@heroicons/react/24/outline';

const LoginPage = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // Helper: Check if user is an active employee and setup profile if needed
    const checkAndSetupUser = async (user) => {
        // 1. Check if email exists in 'employees' collection and is active
        const q = query(collection(db, "employees"), where("companyEmail", "==", user.email), where("isEmployed", "==", true));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            throw new Error("Access denied. Only active employees can access this portal.");
        }

        // 2. Check if user profile exists in 'users' collection
        const userDocRef = doc(db, "users", user.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (!userDocSnap.exists()) {
            // Create default user profile
            const isAdmin = user.email === "peter.zammit@ias.com.mt";
            await setDoc(userDocRef, {
                email: user.email,
                isAdmin: isAdmin,
                permissions: {
                    employees: isAdmin ? 'edit' : 'view',
                    officeAdmin: isAdmin ? 'edit' : 'no-access',
                    billing: 'no-access',
                    webAdmin: 'no-access'
                }
            });
        }
    };

    const handleSignIn = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // Prevent login if account is inactive
            const isAdmin = user.email === "peter.zammit@ias.com.mt";
            if (!isAdmin) {
                const q = query(collection(db, "employees"), where("companyEmail", "==", user.email), where("isEmployed", "==", true));
                const querySnapshot = await getDocs(q);

                if (querySnapshot.empty) {
                    await signOut(auth); // Immediately sign them out
                    throw new Error("Access denied. Your account is inactive.");
                }
            }

            // Auth state listener in App.jsx will handle redirection
        } catch (err) {
            console.error(err);
            // Show the specific inactive message, otherwise generic error
            setError(err.message === "Access denied. Your account is inactive." ? err.message : 'Failed to sign in. Please check your credentials.');
        }
        setLoading(false);
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        if (password.length < 6) {
            setError('Password must be at least 6 characters long.');
            setLoading(false);
            return;
        }

        try {
            const q = query(collection(db, "employees"), where("companyEmail", "==", email), where("isEmployed", "==", true));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                throw new Error("Registration failed. Only active employees can register.");
            }

            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            await checkAndSetupUser(user);

        } catch (err) {
            if (err.code === 'auth/email-already-in-use') {
                setError('This email is already registered in the system.');
            } else {
                setError(err.message || 'Failed to register.');
            }
        }
        setLoading(false);
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100 p-4">
            <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-xl shadow-lg">
                <div className="flex flex-col items-center space-y-4">
                    <img src="/ias-logo.jpg" alt="iAS Company Logo" className="w-20 h-20 rounded-lg" />
                    <div className="text-center">
                        <h1 className="text-3xl font-semibold text-gray-900">Login to your Account</h1>
                        <p className="mt-2 text-lg text-gray-600">Enter your credentials to access the account.</p>
                    </div>
                </div>

                <form className="mt-6 space-y-6" onSubmit={handleSignIn}>
                    <div>
                        <label htmlFor="email-address" className="block text-base font-medium text-gray-700">
                            Email Address
                        </label>
                        <div className="relative mt-1">
                            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                <EnvelopeIcon className="w-5 h-5 text-gray-400" aria-hidden="true" />
                            </div>
                            <input
                                id="email-address"
                                name="email"
                                type="email"
                                autoComplete="email"
                                required
                                className="block w-full py-3 pl-10 pr-3 text-gray-900 font-medium placeholder-gray-400 border border-gray-300 rounded-md shadow-sm appearance-none focus:outline-none focus:ring-orange-500 focus:border-orange-500 text-lg"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                        </div>
                    </div>

                    <div>
                        <label htmlFor="password" className="block text-base font-medium text-gray-700">
                            Password
                        </label>
                        <div className="relative mt-1">
                            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                <LockClosedIcon className="w-5 h-5 text-gray-400" aria-hidden="true" />
                            </div>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                required
                                className="block w-full py-3 pl-10 pr-3 text-gray-900 font-medium placeholder-gray-400 border border-gray-300 rounded-md shadow-sm appearance-none focus:outline-none focus:ring-orange-500 focus:border-orange-500 text-lg"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>
                    </div>

                    {error && <p className="text-base text-center text-red-600 font-medium bg-red-50 p-2 rounded">{error}</p>}

                    <div>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex justify-center w-full px-4 py-3 text-lg font-semibold text-white border border-transparent rounded-md shadow-sm bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50"
                        >
                            {loading ? 'Processing...' : 'Login'}
                        </button>
                    </div>
                </form>

                <div className="text-base text-center">
                    <p className="text-gray-600">
                        Don't have an account?{' '}
                        <button type="button" onClick={handleRegister} disabled={loading} className="font-semibold text-orange-600 hover:text-orange-800">
                            Sign Up with Email
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;