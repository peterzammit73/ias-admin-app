// Root: src/modules/employee/EmployeeTaskBoard.jsx
// Version: 3.14 - Fixed Import Paths and Integrated Project Overview
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, deleteDoc, getDocs, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { db, auth } from '/src/firebase.js';
import {
    CheckCircleIcon as CheckSolid,
    PlayCircleIcon
} from '@heroicons/react/24/solid';
import {
    CheckCircleIcon as CheckOutline,
    PlusIcon,
    TrashIcon,
    CalendarDaysIcon,
    ClockIcon,
    BriefcaseIcon,
    ChevronRightIcon,
    ChevronLeftIcon,
    BookmarkIcon,
    ShieldCheckIcon,
    UserGroupIcon,
    MagnifyingGlassIcon,
    XMarkIcon,
    ArrowUturnLeftIcon,
    PencilIcon,
    CheckIcon,
    ArrowPathIcon,
    UserIcon
} from '@heroicons/react/24/outline';

import Modal from '/src/components/Modal.jsx';
import { useData } from '/src/Context/DataProvider.jsx';

import {
    safeNumber,
    safePercent,
    parseDateUTC,
    isEmployeeActiveInPeriod,
    getApplicableSalaryRecord,
    calculateAnnualTotalCost,
    calculateHourlyRateForDate
} from '/src/utils/financialCalculations.js';

// --- STANDARD PHASES ---
const ARCHITECTURAL_PHASES = [
    { id: 'concept', label: 'Concept Design', color: 'bg-gray-100 text-gray-800 border-gray-300 hover:border-gray-400' },
    { id: 'permitting', label: 'Planning / Permitting', color: 'bg-gray-200 text-gray-900 border-gray-400 hover:border-gray-500' },
    { id: 'tender', label: 'Tender Documentation', color: 'bg-orange-50 text-orange-800 border-orange-200 hover:border-orange-400' },
    { id: 'construction', label: 'Construction Detailing', color: 'bg-orange-100 text-orange-900 border-orange-300 hover:border-orange-500' },
    { id: 'admin', label: 'Contract Admin / PM', color: 'bg-orange-200 text-orange-900 border-orange-400 hover:border-orange-600' },
    { id: 'other', label: 'Other', color: 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 shadow-sm' }
];

const getStartOfWeek = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
};

const formatDateToISO = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const getEaster = (year) => {
    const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
    const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
};

const getPublicHolidays = (year) => {
    const easterDate = getEaster(year);
    const goodFriday = new Date(easterDate);
    goodFriday.setDate(easterDate.getDate() - 2);

    return {
        '1-1': "New Year's Day", '2-10': "Feast of St. Paul's Shipwreck", '3-19': "Feast of St. Joseph",
        '3-31': "Freedom Day", [`${goodFriday.getMonth() + 1}-${goodFriday.getDate()}`]: "Good Friday",
        '5-1': "Worker's Day", '6-7': "Sette Giugno", '6-29': "Feast of St. Peter & St. Paul",
        '8-15': "Feast of the Assumption", '9-8': "Feast of Our Lady of Victories", '9-21': "Independence Day",
        '12-8': "Feast of the Immaculate Conception", '12-13': "Republic Day", '12-25': "Christmas Day",
    };
};

const calculateDefaultTargetDate = (startDateStr, totalHours) => {
    if (!startDateStr) return '';
    const d = new Date(startDateStr);
    let hoursLeft = Number(totalHours) || 0;

    if (hoursLeft <= 8) return d.toISOString().split('T')[0];

    hoursLeft -= 8;
    while (hoursLeft > 0) {
        d.setDate(d.getDate() + 1);
        if (d.getDay() !== 0 && d.getDay() !== 6) {
            hoursLeft -= 8;
        }
    }
    return d.toISOString().split('T')[0];
};

const getEmployeeCapacityForDay = (emp, dateObj, holidaysCache, shutdowns) => {
    let capacity = 8;
    const iso = formatDateToISO(dateObj);
    const dayOfWeek = dateObj.getDay();
    const dayKey = `${dateObj.getMonth() + 1}-${dateObj.getDate()}`;
    const year = dateObj.getFullYear();

    if (dayOfWeek === 0 || dayOfWeek === 6) return 0;

    const isShutdown = shutdowns.has(iso);
    const isHoliday = !!(holidaysCache[year] && holidaysCache[year][dayKey]);
    const ledgerEntry = emp.leave?.[year]?.[dayKey];

    if (ledgerEntry && ledgerEntry.type === 'work') {
        if (ledgerEntry.hours === 4) return 4;
        return 8;
    } else if (ledgerEntry && ledgerEntry.type !== 'work' && (ledgerEntry.status === 'approved' || !ledgerEntry.status)) {
        capacity -= (ledgerEntry.hours || 8);
    } else if (isShutdown || isHoliday) {
        capacity -= 8;
    }

    return Math.max(0, capacity);
};

const getAccurateFullyLoadedRate = (empId, targetDateStr, salaryHistories, effHoursPeriods, overheadPeriods, allEmployees) => {
    if (!empId || !allEmployees || !allEmployees.length) return 0;

    const requestedDate = new Date(targetDateStr || new Date());
    const today = new Date();
    const evaluationDate = requestedDate > today ? today : requestedDate;
    const evalDateUTC = new Date(Date.UTC(evaluationDate.getFullYear(), evaluationDate.getMonth(), evaluationDate.getDate()));

    const emp = allEmployees.find(e => e.id === empId);
    if (!emp) return 0;

    const hist = salaryHistories[empId] || [];
    let activeRecord = getApplicableSalaryRecord(hist, evalDateUTC);

    if (!activeRecord) {
        activeRecord = {
            baseSalary: emp.basicSalary || emp.baseSalary || emp.salary || 0,
            niEmployerAmount: emp.employerNI || 0,
            govtBonus: 512,
            bonus: emp.guaranteedBonus || 0,
            otherContributions: emp.fringeBenefits || 0,
            productivityPercent: emp.productivityPercent !== undefined ? emp.productivityPercent : 100,
            billablePercent: emp.billablePercent !== undefined ? emp.billablePercent : 100,
            addToNonProdPool: emp.addToNonProdPool !== false
        };
    }

    const monthStart = new Date(Date.UTC(evalDateUTC.getUTCFullYear(), evalDateUTC.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(evalDateUTC.getUTCFullYear(), evalDateUTC.getUTCMonth() + 1, 0, 23, 59, 59));

    let sumProductivity = 0;
    let sumBillable = 0;
    let nonProdPool = 0;

    allEmployees.forEach(e => {
        if (!isEmployeeActiveInPeriod(e, monthStart, monthEnd)) return;
        const eHist = salaryHistories[e.id] || [];
        let eActive = getApplicableSalaryRecord(eHist, monthEnd);

        if (!eActive) {
            eActive = {
                baseSalary: e.basicSalary || e.baseSalary || e.salary || 0,
                niEmployerAmount: e.employerNI || 0,
                govtBonus: 512,
                bonus: e.guaranteedBonus || 0,
                otherContributions: e.fringeBenefits || 0,
                productivityPercent: e.productivityPercent !== undefined ? e.productivityPercent : 100,
                billablePercent: e.billablePercent !== undefined ? e.billablePercent : 100,
                addToNonProdPool: e.addToNonProdPool !== false
            };
        }

        const bill = safePercent(eActive.billablePercent);
        const prod = safePercent(eActive.productivityPercent);
        if (bill > 0) sumProductivity += prod;
        sumBillable += bill;

        const cost = calculateAnnualTotalCost(eActive) / 12;
        if (eActive.addToNonProdPool !== false) {
            nonProdPool += cost * (1 - (bill / 100));
        }
    });

    const denomMap = { [evalDateUTC.getUTCMonth()]: { sumProductivity, sumBillable, nonProdPool } };

    const adjustedOverheadPeriods = (overheadPeriods || []).map(p => {
        if (!p.endDate) return p;
        const end = new Date(p.endDate);
        if (end.getDate() === 1) {
            const extended = new Date(Date.UTC(end.getFullYear(), end.getMonth() + 1, 0));
            return { ...p, endDate: extended.toISOString().split('T')[0] };
        }
        return p;
    });

    const rateResult = calculateHourlyRateForDate(
        evalDateUTC,
        activeRecord,
        effHoursPeriods || [],
        adjustedOverheadPeriods,
        denomMap
    );

    return rateResult.totalRate || 0;
};

const EmployeeTaskBoard = () => {
    const { projects, employees, loading: contextLoading } = useData();
    const [user, setUser] = useState(null);
    const [employeeProfile, setEmployeeProfile] = useState(null);

    // Personal Workspace State
    const [allocations, setAllocations] = useState([]);
    const [subtasks, setSubtasks] = useState({});
    const [planningTasks, setPlanningTasks] = useState([]);
    const [shutdowns, setShutdowns] = useState(new Set());
    const [activeProjects, setActiveProjects] = useState([]);

    // Financial Data 
    const [salaryHistories, setSalaryHistories] = useState({});
    const [effHoursPeriods, setEffHoursPeriods] = useState([]);
    const [overheadPeriods, setOverheadPeriods] = useState([]);

    // UI & View State
    const [activeTab, setActiveTab] = useState('personal'); // 'personal' or 'project'
    const [selectedAllocationId, setSelectedAllocationId] = useState('personal');
    const [showCompleted, setShowCompleted] = useState(false);
    const [timelineStart, setTimelineStart] = useState(getStartOfWeek(new Date()));
    const [hoveredTaskId, setHoveredTaskId] = useState(null);

    // Form State
    const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
    const [newTaskFile, setNewTaskFile] = useState('');
    const [newTaskDate, setNewTaskDate] = useState('');

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Project Overview State
    const [projectSearchTerm, setProjectSearchTerm] = useState('');
    const [searchedProjectNum, setSearchedProjectNum] = useState('');
    const [projectAllocations, setProjectAllocations] = useState([]);
    const [projectUnassignedTasks, setProjectUnassignedTasks] = useState([]);
    const [allEmployees, setAllEmployees] = useState([]);
    const [projectLoading, setProjectLoading] = useState(false);
    const [projectDetails, setProjectDetails] = useState(null);

    // Drag & Drop State
    const [draggedTask, setDraggedTask] = useState(null);
    const [draggedAllocation, setDraggedAllocation] = useState(null);
    const [dragOverCell, setDragOverCell] = useState(null);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalData, setModalData] = useState({
        id: null,
        employeeId: '',
        projectNumber: '',
        taskId: '',
        taskTitle: '',
        phase: 'concept',
        startDate: '',
        totalHours: 10,
        targetDate: '',
        description: '',
        reviewStatus: 'none'
    });

    const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, data: null });

    // 1. Authenticate and find Employee Profile
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setUser(currentUser);
            if (currentUser && currentUser.email) {
                try {
                    const empQ = query(collection(db, 'employees'), where('companyEmail', '==', currentUser.email));
                    const empSnap = await getDocs(empQ);

                    if (!empSnap.empty) {
                        setEmployeeProfile({ id: empSnap.docs[0].id, ...empSnap.docs[0].data() });
                    } else {
                        const empQ2 = query(collection(db, 'employees'), where('workEmail', '==', currentUser.email));
                        const empSnap2 = await getDocs(empQ2);
                        if (!empSnap2.empty) {
                            setEmployeeProfile({ id: empSnap2.docs[0].id, ...empSnap2.docs[0].data() });
                        }
                    }
                } catch (err) {
                    console.error("Error fetching employee profile:", err);
                }
            } else {
                setEmployeeProfile(null);
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // 2. Fetch Assignments (Allocations) for this Employee
    useEffect(() => {
        if (!employeeProfile) return;

        const allocQ = query(
            collection(db, 'resource_allocations'),
            where('employeeId', '==', employeeProfile.id)
        );

        const unsubscribe = onSnapshot(allocQ, (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            data.sort((a, b) => {
                if (a.isCompleted === b.isCompleted) {
                    return new Date(a.targetDate || '2099-01-01') - new Date(b.targetDate || '2099-01-01');
                }
                return a.isCompleted ? 1 : -1;
            });
            setAllocations(data);
        });

        return () => unsubscribe();
    }, [employeeProfile]);

    // 3. Fetch ALL Sub-tasks
    useEffect(() => {
        if (!employeeProfile) return;

        const subQ = query(
            collection(db, 'employee_subtasks'),
            where('employeeId', '==', employeeProfile.id)
        );

        const unsubscribe = onSnapshot(subQ, (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            data.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

            const grouped = {};
            data.forEach(task => {
                const aId = task.allocationId || 'personal';
                if (!grouped[aId]) grouped[aId] = [];
                grouped[aId].push(task);
            });

            setSubtasks(grouped);
        });

        return () => unsubscribe();
    }, [employeeProfile]);

    // 4. Fetch Company Shutdowns and Financial Settings
    useEffect(() => {
        let isMounted = true;
        const initializeData = async () => {
            const currentYear = timelineStart.getFullYear();
            try {
                const [snap1, snap2] = await Promise.all([
                    getDoc(doc(db, 'company_holidays', String(currentYear))),
                    getDoc(doc(db, 'company_holidays', String(currentYear + 1)))
                ]);
                let allShutdowns = [];
                if (snap1.exists()) allShutdowns.push(...(snap1.data().shutdowns || []));
                if (snap2.exists()) allShutdowns.push(...(snap2.data().shutdowns || []));
                if (isMounted) setShutdowns(new Set(allShutdowns));

                try {
                    const effSnap = await getDocs(query(collection(db, 'settings', 'company_settings', 'effective_hours_periods')));
                    if (isMounted) setEffHoursPeriods(effSnap.docs.map(d => d.data()));

                    const ovhSnap = await getDocs(query(collection(db, 'settings', 'company_settings', 'overhead_periods')));
                    if (isMounted) setOverheadPeriods(ovhSnap.docs.map(d => d.data()));

                    const histSnap = await getDocs(collectionGroup(db, 'salary_history'));
                    const histories = {};
                    histSnap.forEach(d => {
                        const empId = d.ref.parent.parent.id;
                        if (!histories[empId]) histories[empId] = [];
                        histories[empId].push(d.data());
                    });
                    if (isMounted) setSalaryHistories(histories);
                } catch (finErr) {
                    console.warn("Could not load financial context for estimations", finErr);
                }
            } catch (err) {
                console.error("Failed to load shutdowns", err);
            }
        };
        initializeData();
        return () => { isMounted = false; };
    }, [timelineStart]);

    // 5. Fetch Active Projects & All Employees for Dropdowns and Project View
    useEffect(() => {
        const qProj = query(collection(db, 'projects'), where('status', '==', 'Active'));
        const unsubProjects = onSnapshot(qProj, (snap) => {
            const list = snap.docs.map(d => d.data());
            list.sort((a, b) => (parseInt(a.projectNumber) || 0) - (parseInt(b.projectNumber) || 0));
            setActiveProjects(list);
        });

        const qEmp = query(collection(db, 'employees'));
        const unsubEmployees = onSnapshot(qEmp, (snap) => {
            setAllEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        const qTasks = query(collection(db, 'planning_tasks'));
        const unsubTasks = onSnapshot(qTasks, (snap) => {
            setPlanningTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
        });

        return () => {
            unsubProjects();
            unsubEmployees();
            unsubTasks();
        };
    }, []);

    // --- TIMELINE LOGIC ---
    const timelineDays = useMemo(() => {
        const days = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(timelineStart);
            d.setDate(timelineStart.getDate() + i);
            days.push(d);
        }
        return days;
    }, [timelineStart]);

    const shiftTimeline = (daysOffset) => {
        setTimelineStart(prev => {
            const next = new Date(prev);
            next.setDate(prev.getDate() + daysOffset);
            return next;
        });
    };

    // --- PROJECT OVERVIEW LOGIC ---
    const handleSearchProject = async (e) => {
        e.preventDefault();
        let pNum = projectSearchTerm.trim();
        if (!pNum) return;

        // If the user selects from datalist, it might populate "0752 - Project Name"
        if (pNum.includes(' - ')) {
            pNum = pNum.split(' - ')[0].trim();
        }

        setProjectLoading(true);
        setSearchedProjectNum(pNum);

        try {
            // Generate variations to handle padding and type mismatches (e.g. "0752", "752", 752)
            const numVal = parseInt(pNum, 10);
            const variations = Array.from(new Set([
                pNum,
                String(numVal),
                String(numVal).padStart(4, '0'),
                numVal
            ])).filter(v => v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && isNaN(v)));

            // Find project details
            const matchedProject = activeProjects.find(p => variations.includes(p.projectNumber) || variations.includes(String(p.projectNumber)));
            setProjectDetails(matchedProject || { projectNumber: pNum, projectDescription: 'Unknown Project' });

            // Fetch Allocations for Project using 'in' operator to catch all formats
            const allocQ = query(collection(db, 'resource_allocations'), where('projectNumber', 'in', variations));
            const allocSnap = await getDocs(allocQ);
            const pAllocations = allocSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            pAllocations.sort((a, b) => {
                if (a.isCompleted === b.isCompleted) {
                    return new Date(a.targetDate || '2099-01-01') - new Date(b.targetDate || '2099-01-01');
                }
                return a.isCompleted ? 1 : -1;
            });
            setProjectAllocations(pAllocations);

            // Fetch Planning Tasks (Unassigned) using 'in' operator
            const tasksQ = query(collection(db, 'planning_tasks'), where('projectNumber', 'in', variations));
            const tasksSnap = await getDocs(tasksQ);
            const pTasks = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            const unassigned = pTasks.filter(task => !pAllocations.some(a => a.taskId === task.id));
            setProjectUnassignedTasks(unassigned);

        } catch (err) {
            console.error("Error fetching project overview:", err);
            alert("Failed to load project details.");
        } finally {
            setProjectLoading(false);
        }
    };

    const clearProjectSearch = () => {
        setProjectSearchTerm('');
        setSearchedProjectNum('');
        setProjectAllocations([]);
        setProjectUnassignedTasks([]);
        setProjectDetails(null);
    };

    // --- HANDLERS FOR PERSONAL WORKSPACE ---
    const toggleAllocationCompletion = async (alloc) => {
        if (alloc.reviewStatus === 'approved') return;

        const isCurrentlyDone = alloc.isCompleted;

        try {
            if (!isCurrentlyDone) {
                await updateDoc(doc(db, 'resource_allocations', alloc.id), {
                    isCompleted: true,
                    reviewStatus: 'pending',
                    completedAt: new Date().toISOString()
                });

                if (alloc.assignedByEmail) {
                    const functionsInstance = getFunctions();
                    const notifyFn = httpsCallable(functionsInstance, 'notifyTaskReview');
                    notifyFn({
                        managerEmail: alloc.assignedByEmail,
                        taskTitle: alloc.taskTitle || 'Unspecified Task',
                        employeeName: `${employeeProfile.name} ${employeeProfile.surname}`
                    }).catch(e => console.error("Notification Error:", e));
                }
            } else {
                await updateDoc(doc(db, 'resource_allocations', alloc.id), {
                    isCompleted: false,
                    reviewStatus: 'none',
                    completedAt: null
                });
            }
        } catch (err) {
            console.error("Failed to update task status:", err);
        }
    };

    const handleAddSubtask = async (e) => {
        e.preventDefault();
        if (!newSubtaskTitle.trim() || !selectedAllocationId) return;

        // Ensure date is selected for personal tasks
        if (selectedAllocationId === 'personal' && !newTaskDate) return;

        try {
            const payload = {
                allocationId: selectedAllocationId,
                employeeId: employeeProfile.id,
                title: newSubtaskTitle.trim(),
                isCompleted: false,
                createdAt: new Date().toISOString()
            };

            if (selectedAllocationId === 'personal') {
                payload.fileRef = newTaskFile.trim();
                payload.targetDate = newTaskDate; // Stored as YYYY-MM-DD
            }

            await addDoc(collection(db, 'employee_subtasks'), payload);

            // Clear Form
            setNewSubtaskTitle('');
            setNewTaskFile('');
            setNewTaskDate('');
        } catch (err) {
            console.error("Failed to add subtask:", err);
        }
    };

    const toggleSubtaskCompletion = async (subtaskId, currentStatus) => {
        try {
            await updateDoc(doc(db, 'employee_subtasks', subtaskId), {
                isCompleted: !currentStatus,
                completedAt: !currentStatus ? new Date().toISOString() : null
            });
        } catch (err) {
            console.error("Failed to update subtask:", err);
        }
    };

    const handleDeleteSubtask = async (subtaskId) => {
        try {
            await deleteDoc(doc(db, 'employee_subtasks', subtaskId));
        } catch (err) {
            console.error("Failed to delete subtask:", err);
        }
    };

    if (loading || contextLoading) {
        return <div className="h-[calc(100vh-10rem)] flex items-center justify-center text-gray-500 font-medium">Loading your workspace...</div>;
    }

    if (!employeeProfile) {
        return (
            <div className="h-[calc(100vh-10rem)] flex items-center justify-center text-center p-6">
                <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 max-w-md">
                    <BriefcaseIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-gray-800 mb-2">Employee Profile Not Found</h2>
                    <p className="text-gray-500 text-sm">We couldn't link your currently logged-in email to an active employee record. Please ensure your email is registered in the Team registry.</p>
                </div>
            </div>
        );
    }

    // Prepare Grouped Allocations for the sidebar
    const filteredAllocations = allocations.filter(a => showCompleted || !a.isCompleted);
    const groupedAllocations = filteredAllocations.reduce((acc, alloc) => {
        const pNum = alloc.projectNumber || 'Other';
        if (!acc[pNum]) acc[pNum] = [];
        acc[pNum].push(alloc);
        return acc;
    }, {});

    const selectedAllocation = selectedAllocationId !== 'personal'
        ? allocations.find(a => a.id === selectedAllocationId)
        : null;

    const activeSubtasks = subtasks[selectedAllocationId] || [];

    // Sort logic for display (Private To-Do List sorts by date, allocations sort by creation)
    let displaySubtasks = activeSubtasks.filter(sub => showCompleted || !sub.isCompleted);
    if (selectedAllocationId === 'personal') {
        displaySubtasks.sort((a, b) => {
            // Keep completed at the bottom
            if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;

            // Sort chronologically by target date
            if (a.targetDate && b.targetDate) return new Date(a.targetDate) - new Date(b.targetDate);

            // Tasks with dates float above tasks without dates
            if (a.targetDate) return -1;
            if (b.targetDate) return 1;

            // Fallback to creation date
            return new Date(b.createdAt) - new Date(a.createdAt);
        });
    }

    const completedSubtasksCount = activeSubtasks.filter(s => s.isCompleted).length;
    const progressPercent = activeSubtasks.length > 0 ? Math.round((completedSubtasksCount / activeSubtasks.length) * 100) : 0;

    return (
        <div className="flex flex-col h-[calc(100vh-10rem)] gap-4 relative">

            {/* View Toggle Tabs */}
            <div className="flex bg-gray-200 p-1 rounded-lg w-fit mb-2">
                <button
                    onClick={() => setActiveTab('personal')}
                    className={`px-4 py-2 text-sm font-bold rounded-md transition-all flex items-center ${activeTab === 'personal' ? 'bg-white shadow text-orange-600' : 'text-gray-600 hover:text-gray-900'}`}
                >
                    <UserGroupIcon className="h-4 w-4 inline mr-2" /> My Workspace
                </button>
                <button
                    onClick={() => setActiveTab('project')}
                    className={`px-4 py-2 text-sm font-bold rounded-md transition-all flex items-center ${activeTab === 'project' ? 'bg-white shadow text-orange-600' : 'text-gray-600 hover:text-gray-900'}`}
                >
                    <BriefcaseIcon className="h-4 w-4 inline mr-2" /> Project Lookup
                </button>
            </div>

            {activeTab === 'personal' ? (
                <>
                    {/* --- TOP: HORIZONTAL CALENDAR TIMELINE --- */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 shrink-0 p-4 flex flex-col min-h-[12rem] max-h-[40vh] transition-all overflow-hidden">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="font-bold text-gray-800 flex items-center">
                                <CalendarDaysIcon className="h-5 w-5 mr-2 text-indigo-600" />
                                Due Dates & Targets
                            </h3>
                            <div className="flex items-center bg-gray-100 rounded-lg p-1 border shadow-inner">
                                <button onClick={() => shiftTimeline(-7)} className="p-1 hover:bg-white rounded"><ChevronLeftIcon className="h-4 w-4 text-gray-600" /></button>
                                <span className="px-3 text-xs font-bold text-gray-700 w-44 text-center">
                                    {timelineDays[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - {timelineDays[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                </span>
                                <button onClick={() => shiftTimeline(7)} className="p-1 hover:bg-white rounded"><ChevronRightIcon className="h-4 w-4 text-gray-600" /></button>
                            </div>
                        </div>

                        <div className="flex-1 grid grid-cols-7 gap-2 min-h-0">
                            {timelineDays.map(day => {
                                const iso = formatDateToISO(day);
                                const year = day.getFullYear();
                                const dayKey = `${day.getMonth() + 1}-${day.getDate()}`;
                                const dayOfWeek = day.getDay();
                                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                                const isToday = iso === formatDateToISO(new Date());

                                // Calendar Intelligence Lookup
                                const hols = getPublicHolidays(year);
                                const isHoliday = !!hols[dayKey];
                                const isShutdown = shutdowns.has(iso);
                                const ledgerEntry = employeeProfile?.leave?.[year]?.[dayKey];

                                let dayStatusLabel = '';
                                let dayStatusColor = '';
                                let bgClass = 'bg-gray-50 border-gray-100';

                                // Priority styling sequence
                                if (ledgerEntry?.type === 'work') {
                                    if (ledgerEntry.hours === 4) {
                                        dayStatusLabel = 'Half Day Work';
                                        bgClass = 'bg-gradient-to-b from-green-50 to-gray-50 border-green-200';
                                    }
                                } else if (isWeekend) {
                                    dayStatusLabel = 'Weekend';
                                    bgClass = 'bg-gray-100 opacity-60 border-gray-200';
                                    dayStatusColor = 'text-gray-400';
                                } else if (isHoliday) {
                                    dayStatusLabel = hols[dayKey];
                                    bgClass = 'bg-red-50 border-red-200';
                                    dayStatusColor = 'text-red-600';
                                } else if (isShutdown) {
                                    dayStatusLabel = 'Company Shutdown';
                                    bgClass = 'bg-orange-50 border-orange-200';
                                    dayStatusColor = 'text-orange-600';
                                } else if (ledgerEntry && (ledgerEntry.status === 'approved' || !ledgerEntry.status)) {
                                    if (ledgerEntry.type === 'sick') {
                                        dayStatusLabel = ledgerEntry.hours === 4 ? 'Half Day Sick' : 'Sick Leave';
                                        bgClass = 'bg-yellow-50 border-yellow-200';
                                        dayStatusColor = 'text-yellow-700';
                                    } else {
                                        dayStatusLabel = ledgerEntry.hours === 4 ? 'Half Day Vac.' : 'Vacation';
                                        bgClass = 'bg-green-50 border-green-200';
                                        dayStatusColor = 'text-green-700';
                                    }
                                }

                                // Apply today highlight if it's a normal working day
                                if (isToday && bgClass.includes('bg-gray-50')) {
                                    bgClass = 'bg-indigo-50/30 border-indigo-200 ring-1 ring-indigo-200';
                                }

                                // 1. Find MANAGER assignments due on this specific day
                                const dayAllocations = allocations.filter(a => {
                                    const dateToMatch = a.targetDate || a.startDate || a.startWeek;
                                    return dateToMatch === iso && (!a.isCompleted || showCompleted);
                                });

                                // 2. Find PERSONAL tasks due on this specific day
                                const dayPersonalTasks = (subtasks['personal'] || []).filter(t => {
                                    return t.targetDate === iso && (!t.isCompleted || showCompleted);
                                });

                                return (
                                    <div key={iso} className={`border rounded-lg p-2 flex flex-col min-h-0 overflow-hidden transition-colors ${bgClass}`}>
                                        <div className="flex justify-between items-start mb-1 shrink-0">
                                            <span className={`text-[11px] font-bold uppercase tracking-wider ${dayStatusColor || (isToday ? 'text-indigo-600' : 'text-gray-500')}`}>
                                                {day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}
                                            </span>
                                        </div>

                                        {dayStatusLabel && (
                                            <div className={`text-[9px] font-bold leading-tight mb-1.5 truncate shrink-0 ${dayStatusColor || 'text-gray-500'}`} title={dayStatusLabel}>
                                                {dayStatusLabel}
                                            </div>
                                        )}

                                        <div className="flex-1 overflow-y-auto space-y-1.5 custom-scrollbar pr-1 mt-1">
                                            {/* Render Manager Assignments */}
                                            {dayAllocations.map(a => {
                                                const isSelected = selectedAllocationId === a.id;
                                                const isOverdue = !a.isCompleted && a.targetDate && new Date(a.targetDate) < new Date(new Date().setHours(0, 0, 0, 0));

                                                let itemClass = isSelected ? 'bg-orange-600 text-white border-orange-700' : 'bg-white border-gray-200 hover:border-orange-400 text-gray-700';
                                                if (!isSelected && isOverdue) itemClass = 'bg-red-50 border-red-400 text-red-800 hover:border-red-500';

                                                return (
                                                    <div
                                                        key={a.id}
                                                        onMouseEnter={() => setHoveredTaskId(a.id)}
                                                        onMouseLeave={() => setHoveredTaskId(null)}
                                                        onClick={() => setSelectedAllocationId(a.id)}
                                                        className={`text-[10px] leading-tight p-1.5 border rounded cursor-pointer transition-all shadow-sm
                                                            ${itemClass}
                                                            ${a.isCompleted ? 'opacity-50 line-through' : ''}
                                                            ${hoveredTaskId === a.id ? 'ring-2 ring-offset-1 ring-orange-400 transform scale-105 z-10 relative' : ''}
                                                        `}
                                                        title={a.taskTitle}
                                                    >
                                                        <span className={`font-mono font-bold block mb-0.5 ${isSelected ? 'text-orange-100' : (isOverdue ? 'text-red-700' : 'text-orange-600')}`}>{a.projectNumber}</span>
                                                        <span className="truncate block">{a.taskTitle}</span>
                                                    </div>
                                                );
                                            })}

                                            {/* Render Personal Tasks */}
                                            {dayPersonalTasks.map(pt => {
                                                const isSelected = selectedAllocationId === 'personal';
                                                const isOverdue = !pt.isCompleted && pt.targetDate && new Date(pt.targetDate) < new Date(new Date().setHours(0, 0, 0, 0));

                                                let ptClass = isSelected ? 'bg-orange-300 text-orange-900 border-orange-400' : 'bg-orange-50 border-orange-200 hover:border-orange-300 text-orange-800';
                                                if (!isSelected && isOverdue) ptClass = 'bg-red-50 border-red-400 text-red-800 hover:border-red-500';

                                                return (
                                                    <div
                                                        key={pt.id}
                                                        onMouseEnter={() => setHoveredTaskId(pt.id)}
                                                        onMouseLeave={() => setHoveredTaskId(null)}
                                                        onClick={() => setSelectedAllocationId('personal')}
                                                        className={`text-[10px] leading-tight p-1.5 border rounded cursor-pointer transition-all shadow-sm
                                                            ${ptClass}
                                                            ${pt.isCompleted ? 'opacity-50 line-through' : ''}
                                                            ${hoveredTaskId === pt.id ? 'ring-2 ring-offset-1 ring-indigo-400 transform scale-105 z-10 relative' : ''}
                                                        `}
                                                        title={pt.title}
                                                    >
                                                        <span className={`font-mono font-bold block mb-0.5 flex items-center gap-1 ${isSelected ? 'text-orange-900' : (isOverdue ? 'text-red-700' : 'text-orange-600')}`}>
                                                            <BookmarkIcon className="h-3 w-3" /> {pt.fileRef || 'Personal'}
                                                        </span>
                                                        <span className="truncate block">{pt.title}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* --- BOTTOM: LEFT/RIGHT PANELS --- */}
                    <div className="flex-1 flex gap-6 min-h-0">
                        {/* LEFT PANEL: My Assigned Tasks */}
                        <div className="w-full lg:w-80 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden shrink-0">
                            <div className="p-4 border-b border-gray-100 bg-gray-50 shrink-0">
                                <h2 className="text-base font-black text-gray-900 flex items-center tracking-tight">
                                    <BriefcaseIcon className="h-5 w-5 mr-2 text-orange-600" /> Active Workflow
                                </h2>
                            </div>

                            <div className="flex-1 overflow-y-auto p-3 bg-gray-50/50 custom-scrollbar">

                                {/* PRIVATE TO-DO LIST BUTTON */}
                                {(() => {
                                    const isHoveringPersonalTask = (subtasks['personal'] || []).some(t => t.id === hoveredTaskId);
                                    let personalBtnClass = selectedAllocationId === 'personal'
                                        ? 'bg-orange-600 border-orange-700 shadow-md text-white'
                                        : 'bg-white border-gray-200 hover:border-orange-300 hover:shadow-sm text-gray-800';

                                    if (isHoveringPersonalTask && selectedAllocationId !== 'personal') {
                                        personalBtnClass = 'bg-indigo-50 border-indigo-400 shadow-md text-indigo-900 ring-2 ring-indigo-400 transition-all transform scale-[1.02] z-10';
                                    }

                                    return (
                                        <div
                                            onClick={() => setSelectedAllocationId('personal')}
                                            className={`relative p-3 rounded-lg border cursor-pointer transition-all mb-4 ${personalBtnClass}`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`p-1.5 rounded-md ${selectedAllocationId === 'personal' ? 'bg-white/20' : 'bg-orange-100 text-orange-600'}`}>
                                                    <BookmarkIcon className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <h3 className={`font-bold text-sm leading-tight ${selectedAllocationId === 'personal' ? 'text-white' : 'text-gray-900'}`}>
                                                        Private To-Do List
                                                    </h3>
                                                    <p className={`text-[10px] mt-0.5 ${selectedAllocationId === 'personal' ? 'text-orange-100' : 'text-gray-500'}`}>
                                                        Site visits, reminders
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Assignments Header & Toggle */}
                                <div className="flex items-center justify-between mb-3 border-b border-gray-200 pb-2">
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Assignments</span>
                                    <label className="flex items-center cursor-pointer text-[10px] font-medium text-gray-500 hover:text-gray-700 transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={showCompleted}
                                            onChange={e => setShowCompleted(e.target.checked)}
                                            className="mr-1.5 rounded text-orange-600 focus:ring-orange-500 h-3 w-3 border-gray-300"
                                        />
                                        Show Completed
                                    </label>
                                </div>

                                {/* Grouped Allocations */}
                                {Object.keys(groupedAllocations).length === 0 ? (
                                    <div className="text-center p-4 text-gray-400 text-xs italic">No active project tasks assigned.</div>
                                ) : (
                                    Object.keys(groupedAllocations).sort().map(pNum => (
                                        <div key={pNum} className="mb-4">
                                            <h4 className="text-xs font-bold text-gray-700 mb-1.5 px-1 flex items-center">
                                                <span className="bg-gray-200 px-1.5 py-0.5 rounded text-[10px] font-mono mr-2">{pNum}</span>
                                            </h4>
                                            <div className="space-y-1.5 pl-2 border-l-2 border-orange-200">
                                                {groupedAllocations[pNum].map(alloc => {
                                                    const isSelected = selectedAllocationId === alloc.id;
                                                    const isOverdue = !alloc.isCompleted && new Date(alloc.targetDate) < new Date(new Date().setHours(0, 0, 0, 0));

                                                    // Status Logic
                                                    let statusBadge = null;
                                                    let iconColor = 'text-gray-300 hover:text-green-500';
                                                    let cardClass = 'bg-white border-gray-200 hover:border-orange-300 hover:shadow-sm';
                                                    let titleClass = 'text-gray-900';

                                                    if (alloc.reviewStatus === 'approved') {
                                                        statusBadge = <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider bg-gray-200 px-1.5 rounded border border-gray-300">Approved</span>;
                                                        iconColor = 'text-gray-400 cursor-not-allowed';
                                                        cardClass = 'bg-gray-50 border-gray-200 opacity-60';
                                                        titleClass = 'text-gray-500 line-through';
                                                    } else if (alloc.reviewStatus === 'pending') {
                                                        statusBadge = <span className="text-[9px] font-bold text-yellow-700 uppercase tracking-wider bg-yellow-100 px-1.5 rounded border border-yellow-300 animate-pulse">Review</span>;
                                                        iconColor = 'text-yellow-500';
                                                        cardClass = 'bg-yellow-50/30 border-yellow-200 hover:border-yellow-400';
                                                    } else if (alloc.reviewStatus === 'rejected') {
                                                        statusBadge = <span className="text-[9px] font-bold text-red-700 uppercase tracking-wider bg-red-100 px-1.5 rounded border border-red-300 animate-pulse">Revise</span>;
                                                        iconColor = 'text-red-500 hover:text-green-500';
                                                        cardClass = 'bg-red-50/30 border-red-200 hover:border-red-400';
                                                    } else if (isOverdue) {
                                                        statusBadge = <span className="text-[9px] font-bold text-red-700 uppercase tracking-wider bg-red-100 px-1.5 rounded border border-red-300">Overdue</span>;
                                                        iconColor = 'text-red-400 hover:text-green-500';
                                                        cardClass = 'bg-red-50 border-red-300 hover:border-red-400 shadow-sm';
                                                        titleClass = 'text-red-900 font-bold';
                                                    }

                                                    if (hoveredTaskId === alloc.id) {
                                                        cardClass = isOverdue
                                                            ? 'bg-red-50 border-red-500 shadow-md ring-2 ring-red-500 transition-all scale-[1.02] z-10 relative'
                                                            : 'bg-orange-50 border-orange-500 shadow-md ring-2 ring-orange-500 transition-all scale-[1.02] z-10 relative';
                                                    } else if (isSelected && alloc.reviewStatus !== 'approved') {
                                                        cardClass = isOverdue
                                                            ? 'bg-white border-red-500 shadow-md ring-1 ring-red-500'
                                                            : 'bg-white border-orange-400 shadow-md ring-1 ring-orange-400';
                                                    } else if (isSelected && alloc.reviewStatus === 'approved') {
                                                        cardClass = 'bg-gray-100 border-gray-400 shadow-inner';
                                                    }

                                                    return (
                                                        <div
                                                            key={alloc.id}
                                                            onMouseEnter={() => setHoveredTaskId(alloc.id)}
                                                            onMouseLeave={() => setHoveredTaskId(null)}
                                                            onClick={() => setSelectedAllocationId(alloc.id)}
                                                            className={`relative p-2.5 rounded-lg border cursor-pointer transition-all ${cardClass}`}
                                                        >
                                                            <div className="flex justify-between items-start mb-1">
                                                                <h3 className={`font-bold text-xs leading-tight pr-6 ${titleClass}`}>
                                                                    {alloc.taskTitle || 'Unspecified Task'}
                                                                </h3>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (alloc.reviewStatus !== 'approved') toggleAllocationCompletion(alloc);
                                                                    }}
                                                                    className={`p-0.5 -mt-1 -mr-1 rounded-full transition-colors absolute right-2 ${iconColor}`}
                                                                    title={alloc.reviewStatus === 'approved' ? "Task Approved and Locked" : (alloc.isCompleted ? "Re-open Task" : "Submit for Manager Review")}
                                                                >
                                                                    {alloc.isCompleted ? <CheckSolid className="h-6 w-6" /> : <CheckOutline className="h-6 w-6" />}
                                                                </button>
                                                            </div>

                                                            <div className="flex items-center justify-between text-[10px] font-medium mt-2">
                                                                <div className={`flex items-center ${isOverdue && !alloc.isCompleted ? 'text-red-600 font-bold' : 'text-gray-500'}`}>
                                                                    <CalendarDaysIcon className="h-3 w-3 mr-1" />
                                                                    {alloc.targetDate ? new Date(alloc.targetDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'No Date'}
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    {statusBadge}
                                                                    <span className="text-gray-500">{alloc.totalHours}h</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* RIGHT PANEL: Personal Action Plan (Subtasks) */}
                        <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden">
                            {!selectedAllocationId ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                                    <PlayCircleIcon className="h-16 w-16 mb-4 opacity-20" />
                                    <p className="font-medium">Select a task on the left to view your action plan.</p>
                                </div>
                            ) : (
                                <>
                                    {/* Header for Selected View */}
                                    <div className="p-6 border-b border-gray-200 bg-white shrink-0">
                                        {selectedAllocationId === 'personal' ? (
                                            // PERSONAL VIEW HEADER
                                            <div>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <ShieldCheckIcon className="h-5 w-5 text-gray-400" />
                                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Private Workspace</span>
                                                </div>
                                                <h2 className="text-2xl font-black text-gray-900 tracking-tight leading-tight">
                                                    My Private To-Do List
                                                </h2>
                                                <p className="text-sm text-gray-500 mt-2">
                                                    Keep track of your daily ad-hoc tasks, site visits, calls, and reminders. These are only visible to you and are not tracked against project budgets.
                                                </p>
                                            </div>
                                        ) : selectedAllocation ? (
                                            // PROJECT ASSIGNMENT HEADER
                                            <div className="flex items-start justify-between mb-4">
                                                <div>
                                                    <div className="flex items-center gap-3 mb-2">
                                                        <span className="font-mono text-sm font-black text-orange-600">{selectedAllocation.projectNumber}</span>
                                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest bg-gray-100 px-2 py-0.5 rounded">{selectedAllocation.phase || 'N/A'}</span>
                                                    </div>
                                                    <h2 className="text-2xl font-black text-gray-900 tracking-tight leading-tight">
                                                        {selectedAllocation.taskTitle || 'Unspecified Task'}
                                                    </h2>
                                                </div>
                                                <div className="text-right bg-gray-50 border border-gray-200 p-3 rounded-lg min-w-[140px]">
                                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Target Date</p>
                                                    <p className={`text-lg font-bold ${!selectedAllocation.isCompleted && new Date(selectedAllocation.targetDate) < new Date(new Date().setHours(0, 0, 0, 0)) ? 'text-red-600' : 'text-gray-900'}`}>
                                                        {selectedAllocation.targetDate ? new Date(selectedAllocation.targetDate).toLocaleDateString('en-GB') : 'N/A'}
                                                    </p>
                                                </div>
                                            </div>
                                        ) : null}

                                        {selectedAllocation?.description && (
                                            <div className="bg-orange-50/50 border border-orange-100 p-4 rounded-lg text-sm text-gray-700 mt-4 mb-2">
                                                <span className="font-bold text-orange-800 text-xs uppercase tracking-wide block mb-1">Manager Notes:</span>
                                                {selectedAllocation.description}
                                            </div>
                                        )}

                                        {/* Subtask Progress Bar */}
                                        {activeSubtasks.length > 0 && (
                                            <div className="mt-4">
                                                <div className="flex justify-between text-xs font-bold text-gray-600 mb-1.5">
                                                    <span>Completion Progress</span>
                                                    <span>{completedSubtasksCount} of {activeSubtasks.length} ({progressPercent}%)</span>
                                                </div>
                                                <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden border border-gray-200">
                                                    <div
                                                        className={`h-2.5 rounded-full transition-all duration-500 ${progressPercent === 100 ? 'bg-green-500' : 'bg-orange-500'}`}
                                                        style={{ width: `${progressPercent}%` }}
                                                    ></div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Subtasks List */}
                                    <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30 custom-scrollbar">
                                        <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center">
                                            {selectedAllocationId === 'personal' ? 'My Action Plan' : 'Task Steps'} <span className="ml-2 bg-gray-200 text-gray-600 text-xs px-2 py-0.5 rounded-full">{displaySubtasks.length}</span>
                                        </h3>

                                        <div className="space-y-2 mb-6">
                                            {displaySubtasks.length === 0 ? (
                                                <div className="text-center p-6 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 text-sm">
                                                    {selectedAllocationId === 'personal'
                                                        ? 'You have no personal tasks right now. Add one below!'
                                                        : 'Break this project task down into smaller steps.'}
                                                </div>
                                            ) : (
                                                displaySubtasks.map(sub => {
                                                    const isOverdue = selectedAllocationId === 'personal' && !sub.isCompleted && sub.targetDate && new Date(sub.targetDate) < new Date(new Date().setHours(0, 0, 0, 0));

                                                    let cardClass = sub.isCompleted ? 'bg-gray-50 border-gray-200 opacity-60 hover:opacity-100' : 'bg-white border-gray-300 shadow-sm hover:border-orange-300';
                                                    let titleClass = sub.isCompleted ? 'text-gray-500 line-through' : 'text-gray-800';

                                                    if (hoveredTaskId === sub.id) {
                                                        cardClass = isOverdue
                                                            ? 'bg-red-50 border-red-500 shadow-md ring-2 ring-red-500 transition-all scale-[1.02] z-10 relative'
                                                            : 'bg-indigo-50 border-indigo-400 shadow-md ring-2 ring-indigo-400 transition-all scale-[1.02] z-10 relative';
                                                    } else if (isOverdue) {
                                                        cardClass = 'bg-red-50 border-red-300 shadow-sm hover:border-red-400';
                                                        titleClass = 'text-red-800 font-bold';
                                                    }

                                                    // Map project description based on fileRef
                                                    const linkedProject = activeProjects.find(p => String(p.projectNumber).padStart(4, '0') === sub.fileRef || String(p.projectNumber) === sub.fileRef);
                                                    const displayFileRef = linkedProject ? `${sub.fileRef} - ${linkedProject.projectDescription}` : sub.fileRef;

                                                    return (
                                                        <div
                                                            key={sub.id}
                                                            onMouseEnter={() => setHoveredTaskId(sub.id)}
                                                            onMouseLeave={() => setHoveredTaskId(null)}
                                                            className={`group flex items-start justify-between p-3 rounded-lg border transition-all ${cardClass}`}
                                                        >
                                                            <div className="flex items-start flex-1 min-w-0 pr-4 cursor-pointer" onClick={() => toggleSubtaskCompletion(sub.id, sub.isCompleted)}>
                                                                {sub.isCompleted ? (
                                                                    <CheckSolid className="h-6 w-6 text-green-500 mr-3 shrink-0 mt-0.5" />
                                                                ) : (
                                                                    <div className={`h-6 w-6 rounded-full border-2 mr-3 shrink-0 transition-colors mt-0.5 ${isOverdue ? 'border-red-400 group-hover:border-red-600' : 'border-gray-300 group-hover:border-green-400'}`}></div>
                                                                )}
                                                                <div className="flex flex-col min-w-0 flex-1">
                                                                    <span className={`text-sm font-medium transition-all break-words ${titleClass}`}>
                                                                        {sub.title}
                                                                    </span>

                                                                    {/* Personal Task Metadata (File & Date) */}
                                                                    {selectedAllocationId === 'personal' && (sub.fileRef || sub.targetDate) && (
                                                                        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500 font-medium">
                                                                            {sub.fileRef && <span className="bg-white/60 px-1.5 py-0.5 rounded border border-gray-200 font-mono text-gray-600 shadow-sm truncate max-w-[200px] sm:max-w-xs" title={displayFileRef}>{displayFileRef}</span>}
                                                                            {sub.targetDate && (
                                                                                <span className={`flex items-center shrink-0 ${isOverdue && !sub.isCompleted ? 'text-red-600 font-bold bg-red-100/50 px-1 rounded' : ''}`}>
                                                                                    <CalendarDaysIcon className="h-3 w-3 mr-1" />
                                                                                    {new Date(sub.targetDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => handleDeleteSubtask(sub.id)}
                                                                className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 hover:text-red-600 transition-all rounded hover:bg-red-50"
                                                                title="Delete Task"
                                                            >
                                                                <TrashIcon className="h-4 w-4" />
                                                            </button>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>

                                        {/* Dynamic Add Input */}
                                        {selectedAllocationId === 'personal' ? (
                                            <form onSubmit={handleAddSubtask} className="flex flex-col gap-3 bg-gray-50 p-4 rounded-xl border border-gray-200 shadow-sm mt-4">
                                                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Add New Personal Task</div>
                                                <input
                                                    type="text"
                                                    value={newSubtaskTitle}
                                                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                                                    placeholder="What needs to be done?"
                                                    className="w-full p-2.5 border border-gray-300 rounded-md text-sm focus:ring-orange-500 focus:border-orange-500 shadow-sm transition-all"
                                                    required
                                                />
                                                <div className="flex flex-col sm:flex-row gap-2">
                                                    <div className="flex-1 relative">
                                                        <input
                                                            list="active-projects-datalist"
                                                            type="text"
                                                            value={newTaskFile}
                                                            onChange={(e) => setNewTaskFile(e.target.value)}
                                                            placeholder="File / Ref (e.g. 0999)"
                                                            className="w-full p-2.5 border border-gray-300 rounded-md text-sm focus:ring-orange-500 focus:border-orange-500 shadow-sm transition-all font-mono"
                                                        />
                                                        <datalist id="active-projects-datalist">
                                                            {activeProjects.map(p => (
                                                                <option key={p.projectNumber} value={String(p.projectNumber).padStart(4, '0')}>
                                                                    {String(p.projectNumber).padStart(4, '0')} - {p.projectDescription}
                                                                </option>
                                                            ))}
                                                        </datalist>
                                                    </div>
                                                    <input
                                                        type="date"
                                                        value={newTaskDate}
                                                        onChange={(e) => setNewTaskDate(e.target.value)}
                                                        required
                                                        className="w-full sm:w-40 p-2.5 border border-gray-300 rounded-md text-sm focus:ring-orange-500 focus:border-orange-500 shadow-sm transition-all text-gray-700"
                                                    />
                                                    <button
                                                        type="submit"
                                                        disabled={!newSubtaskTitle.trim() || !newTaskDate}
                                                        className="px-6 py-2.5 bg-orange-600 text-white rounded-md font-bold text-sm hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed shadow flex items-center justify-center transition-all"
                                                    >
                                                        <PlusIcon className="h-4 w-4 mr-1.5" /> Add
                                                    </button>
                                                </div>
                                            </form>
                                        ) : (
                                            <form onSubmit={handleAddSubtask} className="flex gap-2 relative mt-4">
                                                <ChevronRightIcon className="h-5 w-5 absolute left-3 top-3 text-orange-500" />
                                                <input
                                                    type="text"
                                                    value={newSubtaskTitle}
                                                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                                                    placeholder="Add a new step..."
                                                    className="flex-1 pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-lg text-sm focus:border-orange-500 focus:ring-0 shadow-sm transition-all"
                                                />
                                                <button
                                                    type="submit"
                                                    disabled={!newSubtaskTitle.trim()}
                                                    className="px-5 py-2.5 bg-gray-900 text-white rounded-lg font-bold text-sm hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed shadow flex items-center transition-all"
                                                >
                                                    <PlusIcon className="h-4 w-4 mr-1.5" /> Add
                                                </button>
                                            </form>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </>
            ) : (
                // --- PROJECT OVERVIEW TAB ---
                <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="p-6 border-b border-gray-200 bg-gray-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0">
                        <div>
                            <h2 className="text-xl font-bold text-gray-900">Project Board Lookup</h2>
                            <p className="text-sm text-gray-500">View all assignments and pipeline tasks for a specific project.</p>
                        </div>
                        <form onSubmit={handleSearchProject} className="flex w-full sm:w-auto relative">
                            <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-2.5 text-gray-400" />
                            <input
                                list="all-projects-datalist"
                                type="text"
                                value={projectSearchTerm}
                                onChange={(e) => setProjectSearchTerm(e.target.value)}
                                placeholder="Enter Project Number..."
                                className="pl-10 pr-10 py-2 w-full sm:w-64 border border-gray-300 rounded-l-md shadow-sm focus:ring-orange-500 focus:border-orange-500 sm:text-sm"
                                required
                            />
                            <datalist id="all-projects-datalist">
                                {activeProjects.map(p => (
                                    <option key={p.projectNumber} value={String(p.projectNumber).padStart(4, '0')}>
                                        {String(p.projectNumber).padStart(4, '0')} - {p.projectDescription}
                                    </option>
                                ))}
                            </datalist>
                            {projectSearchTerm && (
                                <button type="button" onClick={clearProjectSearch} className="absolute right-24 top-2.5 text-gray-400 hover:text-gray-600">
                                    <XMarkIcon className="h-5 w-5" />
                                </button>
                            )}
                            <button
                                type="submit"
                                disabled={!projectSearchTerm || projectLoading}
                                className="px-4 py-2 bg-orange-600 text-white rounded-r-md hover:bg-orange-700 disabled:opacity-50 font-medium shadow-sm transition-colors"
                            >
                                {projectLoading ? <ArrowPathIcon className="h-5 w-5 animate-spin text-orange-100" /> : 'Lookup'}
                            </button>
                        </form>
                    </div>

                    <div className="flex-1 overflow-y-auto bg-gray-50/50 p-6 custom-scrollbar">
                        {!searchedProjectNum ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                <BriefcaseIcon className="h-16 w-16 mb-4 opacity-20 text-orange-600" />
                                <p className="text-lg font-medium text-gray-500">Search for a project to view its task board.</p>
                            </div>
                        ) : projectLoading ? (
                            <div className="h-full flex items-center justify-center">
                                <ArrowPathIcon className="h-10 w-10 text-orange-500 animate-spin" />
                            </div>
                        ) : (
                            <div className="space-y-6 max-w-5xl mx-auto">
                                {/* Project Header Card */}
                                <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
                                    <div>
                                        <div className="flex items-center gap-3 mb-1">
                                            <span className="font-mono text-lg font-black text-orange-600">{searchedProjectNum}</span>
                                            {projectDetails?.status === 'Active' ? (
                                                <span className="text-[10px] bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded-full uppercase">Active</span>
                                            ) : (
                                                <span className="text-[10px] bg-gray-100 text-gray-800 font-bold px-2 py-0.5 rounded-full uppercase">{projectDetails?.status || 'Unknown'}</span>
                                            )}
                                        </div>
                                        <h2 className="text-2xl font-bold text-gray-900">{projectDetails?.projectDescription}</h2>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm text-gray-500 font-medium">Total Project Tasks</div>
                                        <div className="text-3xl font-black text-gray-800">{projectAllocations.length + projectUnassignedTasks.length}</div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

                                    {/* Unassigned Tasks Column */}
                                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col max-h-[600px]">
                                        <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                                            <h3 className="font-bold text-gray-800 flex items-center">
                                                <BookmarkIcon className="h-5 w-5 mr-2 text-gray-500" /> Unassigned Pipeline
                                            </h3>
                                            <span className="bg-gray-200 text-gray-700 text-xs font-bold px-2 py-1 rounded-full">{projectUnassignedTasks.length}</span>
                                        </div>
                                        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/30">
                                            {projectUnassignedTasks.length === 0 ? (
                                                <div className="text-center p-6 text-gray-400 italic text-sm">No unassigned tasks in the pipeline.</div>
                                            ) : (
                                                projectUnassignedTasks.map(task => (
                                                    <div key={task.id} className="p-3 bg-white border border-gray-200 rounded-lg shadow-sm hover:border-gray-300 transition-colors">
                                                        <div className="font-bold text-sm text-gray-800 mb-1">{task.title}</div>
                                                        <div className="text-[10px] font-mono text-gray-400 uppercase">Added: {new Date(task.createdAt).toLocaleDateString()}</div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>

                                    {/* Assigned Tasks Column */}
                                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col max-h-[600px]">
                                        <div className="p-4 bg-orange-50 border-b border-orange-100 flex justify-between items-center">
                                            <h3 className="font-bold text-orange-900 flex items-center">
                                                <UserGroupIcon className="h-5 w-5 mr-2 text-orange-600" /> Active Assignments
                                            </h3>
                                            <span className="bg-orange-200 text-orange-800 text-xs font-bold px-2 py-1 rounded-full">{projectAllocations.length}</span>
                                        </div>
                                        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-orange-50/10">
                                            {projectAllocations.length === 0 ? (
                                                <div className="text-center p-6 text-gray-400 italic text-sm">No tasks are currently assigned to team members.</div>
                                            ) : (
                                                projectAllocations.map(alloc => {
                                                    const assignedEmp = allEmployees.find(e => e.id === alloc.employeeId);
                                                    const empName = assignedEmp ? `${assignedEmp.name} ${assignedEmp.surname}` : 'Unknown Employee';
                                                    const isOverdue = !alloc.isCompleted && alloc.targetDate && new Date(alloc.targetDate) < new Date(new Date().setHours(0, 0, 0, 0));

                                                    let statusColor = 'border-l-orange-500 bg-white';
                                                    let statusText = 'In Progress';

                                                    if (alloc.reviewStatus === 'approved') {
                                                        statusColor = 'border-l-gray-400 bg-gray-50 opacity-70';
                                                        statusText = 'Completed & Approved';
                                                    } else if (alloc.reviewStatus === 'pending') {
                                                        statusColor = 'border-l-yellow-400 bg-yellow-50';
                                                        statusText = 'Pending Review';
                                                    } else if (isOverdue) {
                                                        statusColor = 'border-l-red-500 bg-red-50';
                                                        statusText = 'Overdue';
                                                    }

                                                    return (
                                                        <div key={alloc.id} className={`p-3 border rounded-lg shadow-sm border-l-4 transition-colors ${statusColor}`}>
                                                            <div className="flex justify-between items-start mb-2">
                                                                <div className={`font-bold text-sm leading-tight pr-4 ${alloc.reviewStatus === 'approved' ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                                                                    {alloc.taskTitle || 'Unspecified Task'}
                                                                </div>
                                                                <span className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${alloc.reviewStatus === 'approved' ? 'bg-gray-200 text-gray-600 border-gray-300' :
                                                                        alloc.reviewStatus === 'pending' ? 'bg-yellow-100 text-yellow-800 border-yellow-300' :
                                                                            isOverdue ? 'bg-red-100 text-red-800 border-red-300' :
                                                                                'bg-orange-100 text-orange-800 border-orange-200'
                                                                    }`}>
                                                                    {statusText}
                                                                </span>
                                                            </div>

                                                            <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                                                                <div className="flex items-center text-gray-600 bg-gray-50 p-1.5 rounded border border-gray-100">
                                                                    <UserIcon className="h-3.5 w-3.5 mr-1.5 text-gray-400" />
                                                                    <span className="truncate font-medium">{empName}</span>
                                                                </div>
                                                                <div className="flex items-center text-gray-600 bg-gray-50 p-1.5 rounded border border-gray-100">
                                                                    <ClockIcon className="h-3.5 w-3.5 mr-1.5 text-gray-400" />
                                                                    <span className="font-mono font-bold">{alloc.totalHours}h <span className="font-normal text-[10px]">allocated</span></span>
                                                                </div>
                                                            </div>

                                                            <div className="flex justify-between items-center text-[10px] text-gray-500">
                                                                <span className="bg-gray-100 px-1.5 py-0.5 rounded font-medium">{alloc.phase || 'Uncategorized'}</span>
                                                                <span className={`font-medium flex items-center ${isOverdue && !alloc.isCompleted ? 'text-red-600' : ''}`}>
                                                                    <CalendarDaysIcon className="h-3 w-3 mr-1" />
                                                                    Target: {alloc.targetDate ? new Date(alloc.targetDate).toLocaleDateString('en-GB') : 'None'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default EmployeeTaskBoard;