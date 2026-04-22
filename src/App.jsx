// Root: src/App.jsx
// Version: 3.4 - Added External App Link with clearly marked sandbox mocks
import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, NavLink, Outlet } from 'react-router-dom';
import {
    UsersIcon, BuildingOfficeIcon, BanknotesIcon, GlobeAltIcon,
    ArrowRightStartOnRectangleIcon, ShieldCheckIcon, Bars3Icon,
    XMarkIcon, CalculatorIcon, PaintBrushIcon, PresentationChartLineIcon,
    ArrowTopRightOnSquareIcon // <-- Added for the external link
} from '@heroicons/react/24/outline';


// 🟢🟢🟢 UNCOMMENT YOUR REAL IMPORTS BELOW FOR YOUR LIVE APP 🟢🟢🟢

import { onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { DataProvider } from './Context/DataProvider.jsx';
import LoginPage from './pages/LoginPage.jsx';

const EmployeesList = lazy(() => import('./modules/EmployeesList.jsx'));
const EmployeesDirectory = lazy(() => import('./modules/EmployeesDirectory.jsx'));
const Leave = lazy(() => import('./modules/employee/Leave.jsx'));
const MyTimesheet = lazy(() => import('./modules/employee/MyTimesheet.jsx'));
const MyProfile = lazy(() => import('./modules/employee/MyProfile.jsx'));
const EmployeeGuide = lazy(() => import('./modules/employee/EmployeeGuide.jsx'));
const EmployeeTaskBoard = lazy(() => import('./modules/employee/EmployeeTaskBoard.jsx'));

const TimesheetMasks = lazy(() => import('./modules/officeAdmin/TimesheetMasks.jsx'));
const TimesheetValidation = lazy(() => import('./modules/admin/TimesheetValidation.jsx'));
const UserPermissions = lazy(() => import('./modules/admin/UserPermissions.jsx'));
const AdminDashboard = lazy(() => import('./modules/admin/AdminDashboard.jsx'));
const Reports = lazy(() => import('./modules/admin/Reports.jsx'));
const Settings = lazy(() => import('./modules/admin/Settings.jsx'));
const IASCalendar = lazy(() => import('./modules/officeAdmin/IASCalendar.jsx'));
const LeaveManagement = lazy(() => import('./modules/officeAdmin/LeaveManagement.jsx'));
const Projects = lazy(() => import('./modules/Projects.jsx'));
const Clients = lazy(() => import('./modules/Clients.jsx'));
const OfficeStaff = lazy(() => import('./modules/officeAdmin/OfficeStaff.jsx'));
const MiscRegister = lazy(() => import('./modules/officeAdmin/MiscRegister.jsx'));

const HistoricalRates = lazy(() => import('./modules/billing/HistoricalRates.jsx'));
const PendingRFPs = lazy(() => import('./modules/billing/PendingRFPs.jsx'));
const RFPIssuers = lazy(() => import('./modules/billing/RFPIssuers.jsx'));
const Billing = lazy(() => import('./modules/billing/Billing.jsx'));
const ProjectCosts = lazy(() => import('./modules/billing/ProjectCosts.jsx'));
const ClientStatements = lazy(() => import('./modules/billing/ClientStatements.jsx'));

const Salaries = lazy(() => import('./modules/salaries/Salaries.jsx'));
const CompanyOverheads = lazy(() => import('./modules/salaries/CompanyOverheads.jsx'));
const EffectiveHours = lazy(() => import('./modules/salaries/EffectiveHours.jsx'));

const AuditLogs = lazy(() => import('./modules/webAdmin/AuditLogs.jsx'));
const MonthlyFinancialReport = lazy(() => import('./modules/admin/MonthlyFinancialReport.jsx'));
const ProjectScheduler = lazy(() => import('./modules/planning/ProjectScheduler.jsx'));
const ProjectFinancialReport = lazy(() => import('./modules/admin/ProjectFinancialReport.jsx'));
const RevenueComparison = lazy(() => import('./modules/admin/RevenueComparison.jsx'));

// 🟢🟢🟢 END OF REAL IMPORTS 🟢🟢🟢

// --- LOADING SPINNER ---
const LoadingFallback = () => (
    <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="flex flex-col items-center">
            <div className="h-10 w-10 border-4 border-orange-200 border-t-orange-600 rounded-full animate-spin mb-4"></div>
            <p className="text-gray-500 font-medium text-sm">Loading Module...</p>
        </div>
    </div>
);

const MODULE_CONFIG = {
    employees: {
        name: 'Office Staff',
        slug: 'employees',
        icon: <UsersIcon />,
        defaultPath: 'tasks',
        tabs: [
            { label: 'Task Board', path: 'tasks' },
            { label: 'My Timesheet', path: 'timesheet' },
            { label: 'Leave', path: 'leave' },
            { label: 'Projects', path: 'projects' },
            { label: 'Directory', path: 'directory' },
            { label: 'My Profile', path: 'profile' },
            { label: 'Help and Guide', path: 'guide' }
        ]
    },
    designTeam: { name: 'Design Team', slug: 'design-team', icon: <PaintBrushIcon />, defaultPath: 'planning', tabs: [{ label: 'Resource Planning', path: 'planning' }] },
    officeAdmin: { name: 'Office Administration', slug: 'office-admin', icon: <BuildingOfficeIcon />, defaultPath: 'staff', tabs: [{ label: 'Office Staff', path: 'staff' }, { label: 'iAS Calendar', path: 'calendar' }, { label: 'Timesheet Masks', path: 'masks' }, { label: 'Timesheet Validation', path: 'validation' }, { label: 'Leave Management', path: 'leave' }, { label: 'Projects', path: 'projects' }, { label: 'Clients', path: 'clients' }, { label: 'Misc Register', path: 'misc-register' }] },
    billing: { name: 'Billing', slug: 'billing', icon: <BanknotesIcon />, defaultPath: 'status', tabs: [{ label: 'Unbilled Time', path: 'status' }, { label: 'Project Costs', path: 'costs' }, { label: 'Pending RFPs', path: 'pending' }, { label: 'RFP Management', path: 'rfps' }, { label: 'Statements', path: 'statements' }, { label: 'Historical Rates', path: 'rates' }, { label: 'RFP Issuers', path: 'issuers' }] },
    salaries: { name: 'Salaries', slug: 'salaries', icon: <CalculatorIcon />, defaultPath: 'employees', tabs: [{ label: 'Employees', path: 'employees' }, { label: 'Company Overheads', path: 'overheads' }, { label: 'Effective Hours', path: 'effective-hours' }] },
    reporting: { name: 'Reporting', slug: 'reporting', icon: <PresentationChartLineIcon />, defaultPath: 'monthly-financials', tabs: [{ label: 'Monthly Financials', path: 'monthly-financials' }, { label: 'Revenue Comparison', path: 'revenue-comparison' }, { label: 'Projects Report', path: 'projects-report' }] },
    webAdmin: { name: 'Web Admin', slug: 'web-admin', icon: <GlobeAltIcon />, defaultPath: 'logs', tabs: [{ label: 'Audit Logs', path: 'logs' }] },
    admin: { name: 'Admin', slug: 'admin', icon: <ShieldCheckIcon />, defaultPath: 'dashboard', tabs: [{ label: 'Dashboard', path: 'dashboard' }, { label: 'Reports', path: 'reports' }, { label: 'User Permissions', path: 'permissions' }, { label: 'System Settings', path: 'settings' }] }
};

const ProtectedRoute = ({ userData, moduleKey, children }) => {
    if (!userData) return <Navigate to="/login" replace />;
    if (userData.isAdmin) return children;
    if (moduleKey === 'admin') return <Navigate to="/" replace />;
    const permission = userData.permissions?.[moduleKey];
    if (permission === 'no-access' || !permission) return <Navigate to="/" replace />;
    return children;
};

const Sidebar = ({ userData, handleSignOut, setMobileOpen }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const hasPermission = (moduleKey) => {
        if (!userData) return false;
        if (userData.isAdmin) return true;
        const level = userData.permissions?.[moduleKey];
        return level === 'view' || level === 'edit';
    };
    const navItems = Object.entries(MODULE_CONFIG).filter(([key]) => {
        if (key === 'admin') return userData?.isAdmin;
        return hasPermission(key);
    });
    const handleNavigation = (slug, defaultPath) => { navigate(`/${slug}/${defaultPath}`); if (setMobileOpen) setMobileOpen(false); };
    const isActive = (slug) => location.pathname.startsWith(`/${slug}`);

    return (
        <div className="flex flex-col h-full bg-white border-r border-gray-200">
            <div className="h-20 flex-shrink-0 flex items-center px-6 border-b border-gray-200 cursor-pointer" onClick={() => navigate('/')}>
                <img src="/ias-logo.jpg" alt="iAS" className="h-10 w-auto rounded-md" />
                <span className="ml-4 text-2xl font-bold text-gray-800 tracking-tight">iAS Portal</span>
            </div>
            
            <nav className="flex-1 p-4 overflow-y-auto">
                <div className="space-y-2">
                    {navItems.map(([key, config]) => (
                        <button key={key} onClick={() => handleNavigation(config.slug, config.defaultPath)} className={`flex items-center w-full p-3 rounded-lg text-left text-base font-medium transition-colors duration-200 ${isActive(config.slug) ? 'bg-orange-100 text-orange-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>
                            {React.cloneElement(config.icon, { className: 'h-6 w-6 shrink-0 mr-4' })}
                            <span className="flex-1">{config.name}</span>
                        </button>
                    ))}
                </div>
            </nav>

            <div className="p-4 border-t border-gray-200 space-y-2">
                
                {/* --- THIS IS WHERE YOU PUT YOUR LINK --- */}
                {/* Change the href attribute to match your other app's URL */}
                <a 
                    href="https://ias-build-app.web.app" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="w-full flex items-center gap-x-4 p-3 rounded-lg text-base font-semibold text-gray-600 hover:bg-orange-50 hover:text-orange-700 transition-colors duration-200"
                >
                    <ArrowTopRightOnSquareIcon className="h-6 w-6 shrink-0" />
                    <span>iAS Management App</span>
                </a>
                {/* --------------------------------------- */}

                <button onClick={handleSignOut} className="w-full flex items-center gap-x-4 p-3 rounded-lg text-base font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors duration-200">
                    <ArrowRightStartOnRectangleIcon className="h-6 w-6 shrink-0" />
                    <span>Sign Out</span>
                </button>
            </div>
        </div>
    );
};

const DashboardLayout = ({ userData, handleSignOut }) => {
    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const location = useLocation();
    const currentModuleKey = Object.keys(MODULE_CONFIG).find(key => location.pathname.startsWith(`/${MODULE_CONFIG[key].slug}`));
    const currentModule = MODULE_CONFIG[currentModuleKey];

    return (
        <div className="flex h-screen bg-gray-50 text-gray-800">
            <div className={`fixed inset-0 z-40 flex md:hidden ${isSidebarOpen ? '' : 'hidden'}`}>
                <div className="fixed inset-0 bg-black/30" onClick={() => setSidebarOpen(false)}></div>
                <div className="relative flex-1 flex flex-col max-w-xs w-full bg-white">
                    <div className="absolute top-0 right-0 -mr-12 pt-2">
                        <button type="button" className="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white" onClick={() => setSidebarOpen(false)}>
                            <XMarkIcon className="h-6 w-6 text-white" aria-hidden="true" />
                        </button>
                    </div>
                    <Sidebar userData={userData} handleSignOut={handleSignOut} setMobileOpen={setSidebarOpen} />
                </div>
                <div className="flex-shrink-0 w-14"></div>
            </div>
            <aside className="hidden md:flex md:flex-col md:w-72 md:flex-shrink-0">
                <Sidebar userData={userData} handleSignOut={handleSignOut} />
            </aside>
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
                <header className="flex h-20 items-center justify-between border-b border-gray-200 bg-white px-6">
                    <button type="button" className="border-r border-gray-200 px-4 text-gray-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-orange-500 md:hidden" onClick={() => setSidebarOpen(true)}>
                        <Bars3Icon className="h-6 w-6" aria-hidden="true" />
                    </button>
                    <div className="flex-1 flex justify-end items-center gap-x-4">
                        <span className="text-sm font-medium text-gray-600 hidden sm:block">Welcome, {userData?.email}</span>
                        <div className="w-px h-6 bg-gray-200 hidden sm:block"></div>
                        <img className="h-10 w-10 rounded-full bg-gray-200" src={`https://placehold.co/40x40/E46C0B/FFFFFF?text=${userData?.email?.charAt(0).toUpperCase()}`} alt="User" />
                    </div>
                </header>
                <main className="flex-1 overflow-y-auto p-6 md:p-8">
                    <div className="mx-auto max-w-7xl">
                        {currentModule && (
                            <>
                                <h1 className="text-3xl font-bold tracking-tight text-gray-900 mb-4">{currentModule.name}</h1>
                                <div className="border-b border-gray-200 mb-6">
                                    <nav className="-mb-px flex space-x-6 overflow-x-auto" aria-label="Tabs">
                                        {currentModule.tabs.map((tab) => (
                                            <NavLink key={tab.path} to={`/${currentModule.slug}/${tab.path}`} className={({ isActive }) => `whitespace-nowrap py-3 px-1 border-b-2 text-base font-medium transition-colors duration-200 ${isActive ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                                                {tab.label}
                                            </NavLink>
                                        ))}
                                    </nav>
                                </div>
                            </>
                        )}
                        <ErrorBoundary>
                            <Suspense fallback={<LoadingFallback />}>
                                <Outlet />
                            </Suspense>
                        </ErrorBoundary>
                    </div>
                </main>
            </div>
        </div>
    );
};

export default function App() {
    const [user, setUser] = useState(null);
    const [userData, setUserData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setLoading(true);
            if (currentUser) {
                try {
                    const isAdmin = currentUser.email === "peter.zammit@ias.com.mt";
                    if (!isAdmin) {
                        const q = query(collection(db, "employees"), where("companyEmail", "==", currentUser.email), where("isEmployed", "==", true));
                        const empSnap = await getDocs(q);

                        if (empSnap.empty) {
                            console.warn("Session Terminated: User is marked as inactive.");
                            await signOut(auth);
                            setUser(null);
                            setUserData(null);
                            setLoading(false);
                            return;
                        }
                    }

                    const userDocRef = doc(db, "users", currentUser.uid);
                    const docSnap = await getDoc(userDocRef);
                    if (docSnap.exists()) {
                        setUserData(docSnap.data());
                    } else {
                        const defaultUserData = {
                            email: currentUser.email,
                            isAdmin: isAdmin,
                            permissions: {
                                employees: isAdmin ? 'edit' : 'view',
                                officeAdmin: isAdmin ? 'edit' : 'no-access',
                                designTeam: isAdmin ? 'edit' : 'no-access',
                                billing: 'no-access',
                                salaries: 'no-access',
                                reporting: isAdmin ? 'view' : 'no-access',
                                webAdmin: 'no-access'
                            }
                        };
                        await setDoc(userDocRef, defaultUserData);
                        setUserData(defaultUserData);
                    }
                    setUser(currentUser);
                } catch (error) {
                    console.error("Auth Data Error:", error);
                    await signOut(auth);
                }
            } else {
                setUser(null);
                setUserData(null);
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const handleSignOut = async () => { try { await signOut(auth); } catch (e) { console.error(e); } };
    const handleSignIn = async (e, p) => { try { await signInWithEmailAndPassword(auth, e, p); return true; } catch (err) { console.error(err); return false; } };
    const handleRegister = async (e, p) => { try { await createUserWithEmailAndPassword(auth, e, p); return null; } catch (err) { return err.message; } };

    const getPerm = (module) => {
        if (userData?.isAdmin) return 'edit';
        return userData?.permissions?.[module] || 'view';
    };

    if (loading) return <div className="flex items-center justify-center h-screen bg-gray-50 text-gray-600 font-medium">Loading Portal...</div>;

    return (
        <DataProvider>
            <Routes>
                <Route path="/login" element={!user ? <LoginPage onSignIn={handleSignIn} onRegister={handleRegister} /> : <Navigate to="/" replace />} />

                <Route path="/" element={user ? <DashboardLayout userData={userData} handleSignOut={handleSignOut} /> : <Navigate to="/login" replace />}>
                    <Route index element={<Navigate to={userData?.isAdmin ? "/admin/dashboard" : "/employees/tasks"} replace />} />

                    <Route path="employees" element={<ProtectedRoute userData={userData} moduleKey="employees"><Outlet /></ProtectedRoute>}>
                        <Route index element={<Navigate to="tasks" replace />} />
                        <Route path="tasks" element={<EmployeeTaskBoard />} />
                        <Route path="timesheet" element={<MyTimesheet user={user} />} />
                        <Route path="directory" element={<EmployeesList />} />
                        <Route path="profile" element={<MyProfile user={user} />} />
                        <Route path="leave" element={<Leave user={user} />} />
                        <Route path="projects" element={<Projects permission="view" />} />
                        <Route path="guide" element={<EmployeeGuide />} />
                    </Route>

                    <Route path="design-team" element={<ProtectedRoute userData={userData} moduleKey="designTeam"><Outlet /></ProtectedRoute>}>
                        <Route index element={<Navigate to="planning" replace />} />
                        <Route path="planning" element={<ProjectScheduler />} />
                    </Route>

                    <Route path="office-admin" element={<ProtectedRoute userData={userData} moduleKey="officeAdmin"><Outlet /></ProtectedRoute>}>
                        <Route index element={<Navigate to="staff" replace />} />
                        <Route path="staff" element={<OfficeStaff />} />
                        <Route path="calendar" element={<IASCalendar permission={getPerm('officeAdmin')} />} />
                        <Route path="masks" element={<TimesheetMasks permission={getPerm('officeAdmin')} />} />
                        <Route path="validation" element={<TimesheetValidation user={user} />} />
                        <Route path="leave" element={<LeaveManagement permission={getPerm('officeAdmin')} />} />
                        <Route path="projects" element={<Projects permission={getPerm('officeAdmin')} />} />
                        <Route path="clients" element={<Clients permission={getPerm('officeAdmin')} />} />
                        <Route path="misc-register" element={<MiscRegister permission={getPerm('officeAdmin')} />} />
                    </Route>

                    <Route path="billing" element={<ProtectedRoute userData={userData} moduleKey="billing"><Outlet /></ProtectedRoute>}>
                        <Route index element={<Navigate to="status" replace />} />
                        <Route path="status" element={<Billing view="projects" />} />
                        <Route path="costs" element={<ProjectCosts />} />
                        <Route path="rfps" element={<Billing view="rfps" />} />
                        <Route path="statements" element={<ClientStatements />} />
                        <Route path="pending" element={<PendingRFPs />} />
                        <Route path="rates" element={<HistoricalRates />} />
                        <Route path="issuers" element={<RFPIssuers />} />
                    </Route>

                    <Route path="salaries" element={<ProtectedRoute userData={userData} moduleKey="salaries"><Outlet /></ProtectedRoute>}>
                        <Route index element={<Navigate to="employees" replace />} />
                        <Route path="employees" element={<Salaries />} />
                        <Route path="overheads" element={<CompanyOverheads />} />
                        <Route path="effective-hours" element={<EffectiveHours />} />
                    </Route>

                    <Route path="reporting" element={<ProtectedRoute userData={userData} moduleKey="reporting"><Outlet /></ProtectedRoute>}>
                        <Route index element={<Navigate to="monthly-financials" replace />} />
                        <Route path="monthly-financials" element={<MonthlyFinancialReport />} />
                        <Route path="revenue-comparison" element={<RevenueComparison />} />
                        <Route path="projects-report" element={<ProjectFinancialReport />} />
                    </Route>

                    <Route path="web-admin" element={<ProtectedRoute userData={userData} moduleKey="webAdmin"><Outlet /></ProtectedRoute>}>
                        <Route index element={<Navigate to="logs" replace />} />
                        <Route path="logs" element={<AuditLogs />} />
                    </Route>

                    <Route path="admin" element={<ProtectedRoute userData={userData} moduleKey="admin"><Outlet /></ProtectedRoute>}>
                        <Route index element={<Navigate to="dashboard" replace />} />
                        <Route path="dashboard" element={<AdminDashboard />} />
                        <Route path="reports" element={<Reports />} />
                        <Route path="permissions" element={<UserPermissions currentUserId={user?.uid} user={user} />} />
                        <Route path="settings" element={<Settings />} />
                    </Route>

                    <Route path="*" element={<div className="p-8 text-center text-gray-500">Page not found.</div>} />
                </Route>
            </Routes>
        </DataProvider>
    );
}