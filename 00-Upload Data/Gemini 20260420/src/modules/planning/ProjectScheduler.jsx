// Root: src/modules/planning/ProjectScheduler.jsx
// Version: 3.7 - Fixed Import Paths and retained inline editing/unassign capabilities
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc, getDoc, getDocs, query, limit, collectionGroup } from 'firebase/firestore';
import {
    CalendarDaysIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    UserGroupIcon,
    BriefcaseIcon,
    TrashIcon,
    PlusIcon,
    ArrowPathIcon,
    ShieldExclamationIcon,
    ChevronDownIcon,
    MagnifyingGlassIcon,
    CheckCircleIcon,
    FunnelIcon,
    ExclamationTriangleIcon,
    PencilIcon,
    CheckIcon,
    XMarkIcon,
    ArrowUturnLeftIcon
} from '@heroicons/react/24/outline';

import { db, auth } from '../../firebase.js';
import { useData } from '../../Context/DataProvider.jsx';
import Modal from '../../components/Modal.jsx';

import {
    safeNumber,
    safePercent,
    parseDateUTC,
    isEmployeeActiveInPeriod,
    getApplicableSalaryRecord,
    calculateAnnualTotalCost,
    calculateHourlyRateForDate
} from '../../utils/financialCalculations.js';

// --- STANDARD PHASES (Orange/Grey Theme) ---
const ARCHITECTURAL_PHASES = [
    { id: 'concept', label: 'Concept Design', color: 'bg-gray-100 text-gray-800 border-gray-300 hover:border-gray-400' },
    { id: 'permitting', label: 'Planning / Permitting', color: 'bg-gray-200 text-gray-900 border-gray-400 hover:border-gray-500' },
    { id: 'tender', label: 'Tender Documentation', color: 'bg-orange-50 text-orange-800 border-orange-200 hover:border-orange-400' },
    { id: 'construction', label: 'Construction Detailing', color: 'bg-orange-100 text-orange-900 border-orange-300 hover:border-orange-500' },
    { id: 'admin', label: 'Contract Admin / PM', color: 'bg-orange-200 text-orange-900 border-orange-400 hover:border-orange-600' },
    { id: 'other', label: 'Other', color: 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 shadow-sm' }
];

const getStartOfCurrentWeek = () => {
    const d = new Date();
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

const ProjectScheduler = () => {
    const { projects, employees, loading: contextLoading } = useData();
    const [allocations, setAllocations] = useState([]);
    const [planningTasks, setPlanningTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isPermissionError, setIsPermissionError] = useState(false);

    // Financial Data 
    const [salaryHistories, setSalaryHistories] = useState({});
    const [effHoursPeriods, setEffHoursPeriods] = useState([]);
    const [overheadPeriods, setOverheadPeriods] = useState([]);

    // View State 
    const [viewStartDate, setViewStartDate] = useState(getStartOfCurrentWeek());
    const daysToView = 14;

    // Filters
    const [showCompletedTasks, setShowCompletedTasks] = useState(false);
    const [isEmployeeDropdownOpen, setIsEmployeeDropdownOpen] = useState(false);
    const employeeDropdownRef = useRef(null);
    const [selectedEmployees, setSelectedEmployees] = useState(() => {
        try {
            const saved = localStorage.getItem('projectScheduler_selectedEmployees');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            return [];
        }
    });

    // Pipeline UI State
    const [expandedPipelineProjects, setExpandedPipelineProjects] = useState(new Set());
    const [newTaskTitles, setNewTaskTitles] = useState({});
    const [pipelineSearch, setPipelineSearch] = useState('');
    const [showWithTasksOnly, setShowWithTasksOnly] = useState(false);

    // Inline Task Editing State
    const [editingPipelineTaskId, setEditingPipelineTaskId] = useState(null);
    const [editingPipelineTaskTitle, setEditingPipelineTaskTitle] = useState('');

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
    const [shutdowns, setShutdowns] = useState(new Set());

    // --- CLICK OUTSIDE HANDLER ---
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (employeeDropdownRef.current && !employeeDropdownRef.current.contains(event.target)) {
                setIsEmployeeDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // --- PERSIST EMPLOYEE SELECTION ---
    useEffect(() => {
        localStorage.setItem('projectScheduler_selectedEmployees', JSON.stringify(selectedEmployees));
    }, [selectedEmployees]);

    // --- FETCH DATA ---
    useEffect(() => {
        let isMounted = true;
        let unsubAllocations = () => { };
        let unsubTasks = () => { };

        const initializeData = async () => {
            try {
                const currentYear = new Date().getFullYear();
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

                try {
                    await getDocs(query(collection(db, 'resource_allocations'), limit(1)));
                    await getDocs(query(collection(db, 'planning_tasks'), limit(1)));
                } catch (probeErr) {
                    if (probeErr.code === 'permission-denied') {
                        if (isMounted) {
                            setIsPermissionError(true);
                            setError("Firestore rules are blocking access to 'resource_allocations' and/or 'planning_tasks'.");
                            setLoading(false);
                        }
                        return;
                    }
                    throw probeErr;
                }

                unsubAllocations = onSnapshot(collection(db, 'resource_allocations'), (snap) => {
                    if (!isMounted) return;
                    setAllocations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                    setLoading(false);
                });

                unsubTasks = onSnapshot(collection(db, 'planning_tasks'), (snap) => {
                    if (!isMounted) return;
                    setPlanningTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
                });

            } catch (globalErr) {
                console.error("Initialization Error:", globalErr);
                if (isMounted) {
                    setError(`A connection error occurred: ${globalErr.message}`);
                    setLoading(false);
                }
            }
        };

        initializeData();

        return () => {
            isMounted = false;
            unsubAllocations();
            unsubTasks();
        };
    }, []);

    // --- PIPELINE HANDLERS ---
    const togglePipelineProject = (pNum) => {
        setExpandedPipelineProjects(prev => {
            const next = new Set(prev);
            if (next.has(pNum)) next.delete(pNum); else next.add(pNum);
            return next;
        });
    };

    const handleAddPipelineTask = async (projectNumber) => {
        const title = newTaskTitles[projectNumber];
        if (!title || !title.trim()) return;

        try {
            await addDoc(collection(db, 'planning_tasks'), {
                projectNumber,
                title: title.trim(),
                createdAt: new Date().toISOString()
            });
            setNewTaskTitles(prev => ({ ...prev, [projectNumber]: '' }));
            setExpandedPipelineProjects(prev => new Set(prev).add(projectNumber));
        } catch (err) {
            alert("Failed to create task.");
        }
    };

    const handleUpdatePipelineTask = async (taskId) => {
        if (!editingPipelineTaskTitle.trim()) return;
        try {
            await updateDoc(doc(db, 'planning_tasks', taskId), {
                title: editingPipelineTaskTitle.trim()
            });
            setEditingPipelineTaskId(null);
        } catch (err) {
            alert("Failed to update task.");
        }
    };

    const handleDeletePipelineTask = async (taskId) => {
        if (!window.confirm("Delete this task from the pipeline?")) return;
        try {
            await deleteDoc(doc(db, 'planning_tasks', taskId));
        } catch (err) {
            alert("Failed to delete task.");
        }
    };

    const handleUnassignTask = async (allocationId) => {
        if (!window.confirm("Remove this allocation? The task will return to the unassigned pipeline.")) return;
        try {
            await deleteDoc(doc(db, 'resource_allocations', allocationId));
        } catch (err) {
            alert("Failed to unassign task.");
        }
    };

    // --- TIMELINE GENERATION (Daily) ---
    const timelineDays = useMemo(() => {
        const days = [];
        let currentDate = new Date(viewStartDate);

        for (let i = 0; i < daysToView; i++) {
            days.push({
                iso: formatDateToISO(currentDate),
                date: new Date(currentDate),
                label: currentDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'numeric' }),
                isWeekend: currentDate.getDay() === 0 || currentDate.getDay() === 6
            });
            currentDate.setDate(currentDate.getDate() + 1);
        }
        return days;
    }, [viewStartDate]);

    const shiftTimeline = (days) => {
        const newDate = new Date(viewStartDate);
        newDate.setDate(newDate.getDate() + days);
        setViewStartDate(newDate);
    };

    // --- AVAILABLE EMPLOYEES FOR DROPDOWN ---
    const availableEmployees = useMemo(() => {
        if (!employees) return [];
        return employees
            .filter(e => e.isEmployed && e.isVisible !== false)
            .sort((a, b) => (a.surname || '').localeCompare(b.surname || ''));
    }, [employees]);

    const validSelectedEmployees = useMemo(() => {
        return selectedEmployees.filter(id => availableEmployees.some(e => e.id === id));
    }, [selectedEmployees, availableEmployees]);

    // --- MATRIX DATA ENGINE (Queue & Spillover Simulator) ---
    const matrixData = useMemo(() => {
        if (!employees || employees.length === 0 || timelineDays.length === 0) return [];

        let activeEmployees = employees
            .filter(e => e.isEmployed && e.isVisible !== false)
            .sort((a, b) => (a.surname || '').localeCompare(b.surname || ''));

        if (validSelectedEmployees.length > 0) {
            activeEmployees = activeEmployees.filter(e => validSelectedEmployees.includes(e.id));
        }

        const currentYear = timelineDays[0].date.getFullYear();
        const nextYear = currentYear + 1;
        const holidaysCache = {
            [currentYear]: getPublicHolidays(currentYear),
            [nextYear]: getPublicHolidays(nextYear)
        };

        return activeEmployees.map(emp => {
            const row = { employee: emp, days: {} };

            const empAllocations = allocations
                .filter(a => a.employeeId === emp.id)
                .filter(a => showCompletedTasks || a.reviewStatus !== 'approved')
                .map(a => ({ ...a, remaining: Number(a.totalHours) || 0 }));

            empAllocations.sort((a, b) => {
                const dateA = new Date(a.startDate || a.startWeek);
                const dateB = new Date(b.startDate || b.startWeek);
                return dateA - dateB;
            });

            let simDate = new Date(timelineDays[0].date);
            if (empAllocations.length > 0) {
                const earliest = new Date(empAllocations[0].startDate || empAllocations[0].startWeek);
                if (earliest < simDate) simDate = new Date(earliest);
            }
            simDate.setHours(0, 0, 0, 0);

            const endDate = new Date(timelineDays[timelineDays.length - 1].date);
            endDate.setHours(23, 59, 59, 999);

            const taskQueue = [];

            while (simDate <= endDate || taskQueue.length > 0) {
                const iso = formatDateToISO(simDate);
                const capacity = getEmployeeCapacityForDay(emp, simDate, holidaysCache, shutdowns);
                let currentCapacity = capacity;
                let dayAllocated = 0;
                const dayItems = [];

                const startingToday = empAllocations.filter(a => (a.startDate || a.startWeek) === iso);
                if (startingToday.length > 0) {
                    taskQueue.push(...startingToday);
                }

                let i = 0;
                while (currentCapacity > 0 && i < taskQueue.length) {
                    const task = taskQueue[i];
                    if (task.remaining > 0) {
                        const hoursToTake = Math.min(task.remaining, currentCapacity);
                        task.remaining -= hoursToTake;
                        currentCapacity -= hoursToTake;
                        dayAllocated += hoursToTake;

                        dayItems.push({ ...task, hoursToday: hoursToTake });

                        if (task.remaining <= 0) {
                            taskQueue.splice(i, 1);
                        } else {
                            i++;
                        }
                    } else {
                        taskQueue.splice(i, 1);
                    }
                }

                if (simDate >= timelineDays[0].date && simDate <= endDate) {
                    row.days[iso] = {
                        capacity,
                        allocated: dayAllocated,
                        items: dayItems
                    };
                }

                simDate.setDate(simDate.getDate() + 1);

                if (simDate > new Date(timelineDays[0].date.getTime() + 1000 * 60 * 60 * 24 * 365)) break;
            }

            timelineDays.forEach(day => {
                if (!row.days[day.iso]) {
                    row.days[day.iso] = {
                        capacity: getEmployeeCapacityForDay(emp, day.date, holidaysCache, shutdowns),
                        allocated: 0,
                        items: []
                    };
                }
            });

            return row;
        });
    }, [employees, allocations, timelineDays, shutdowns, validSelectedEmployees, showCompletedTasks]);

    const minTargetDate = useMemo(() => {
        if (!modalData.startDate || !modalData.totalHours) return new Date();
        const minDateStr = calculateDefaultTargetDate(modalData.startDate, modalData.totalHours);
        const d = new Date(minDateStr);
        d.setHours(0, 0, 0, 0);
        return d;
    }, [modalData.startDate, modalData.totalHours]);

    const isTargetDateValid = useMemo(() => {
        if (!modalData.targetDate) return false;
        const selected = new Date(modalData.targetDate);
        selected.setHours(0, 0, 0, 0);
        return selected >= minTargetDate;
    }, [modalData.targetDate, minTargetDate]);

    // --- DRAG AND DROP HANDLERS ---
    const handleDragStartTask = (e, task) => {
        setDraggedTask(task);
        e.dataTransfer.effectAllowed = 'copy';
    };

    const handleDragStartAllocation = (e, allocation) => {
        setDraggedAllocation(allocation);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e, empId, iso) => {
        e.preventDefault();
        setDragOverCell(`${empId}_${iso}`);
    };

    const handleDragLeave = () => {
        setDragOverCell(null);
    };

    const handleDrop = async (e, empId, iso) => {
        e.preventDefault();
        setDragOverCell(null);

        if (draggedTask) {
            setModalData({
                id: null,
                employeeId: empId,
                projectNumber: draggedTask.projectNumber,
                taskId: draggedTask.id,
                taskTitle: draggedTask.title,
                phase: 'concept',
                startDate: iso,
                totalHours: 10,
                targetDate: calculateDefaultTargetDate(iso, 10),
                description: '',
                reviewStatus: 'none'
            });
            setIsModalOpen(true);
            setDraggedTask(null);
        } else if (draggedAllocation) {
            try {
                const ref = doc(db, 'resource_allocations', draggedAllocation.id);
                const newTargetDate = calculateDefaultTargetDate(iso, draggedAllocation.totalHours || 10);

                await updateDoc(ref, {
                    employeeId: empId,
                    startDate: iso,
                    startWeek: iso,
                    targetDate: newTargetDate
                });
            } catch (err) {
                console.error("Failed to move allocation:", err);
            }
            setDraggedAllocation(null);
        }
    };

    // --- MODAL HANDLERS & CALCULATIONS ---
    const handleSaveAllocation = async (e) => {
        e.preventDefault();
        if (!isTargetDateValid) return;

        try {
            const payload = {
                employeeId: modalData.employeeId,
                projectNumber: modalData.projectNumber,
                taskId: modalData.taskId,
                taskTitle: modalData.taskTitle,
                phase: modalData.phase,
                startDate: modalData.startDate,
                startWeek: modalData.startDate,
                targetDate: modalData.targetDate,
                totalHours: Number(modalData.totalHours),
                description: modalData.description || '',
                updatedAt: new Date().toISOString()
            };

            if (!modalData.id) {
                payload.assignedByEmail = auth.currentUser?.email || '';
                payload.reviewStatus = 'none';
                payload.isCompleted = false;
                await addDoc(collection(db, 'resource_allocations'), { ...payload, createdAt: new Date().toISOString() });
            } else {
                await updateDoc(doc(db, 'resource_allocations', modalData.id), payload);
            }

            setIsModalOpen(false);
        } catch (err) {
            alert("Failed to save allocation.");
        }
    };

    const handleDeleteAllocation = async () => {
        if (!modalData.id) return;
        if (window.confirm("Remove this allocation?")) {
            await deleteDoc(doc(db, 'resource_allocations', modalData.id));
            setIsModalOpen(false);
        }
    };

    const handleApproveTask = async () => {
        try {
            await updateDoc(doc(db, 'resource_allocations', modalData.id), { reviewStatus: 'approved' });
            setIsModalOpen(false);
        } catch (e) {
            alert("Failed to approve task.");
        }
    };

    const handleRejectTask = async () => {
        try {
            await updateDoc(doc(db, 'resource_allocations', modalData.id), {
                reviewStatus: 'rejected',
                isCompleted: false,
                completedAt: null
            });
            setIsModalOpen(false);
        } catch (e) {
            alert("Failed to reject task.");
        }
    };

    const openEditModal = (allocation) => {
        const start = allocation.startDate || allocation.startWeek;
        const hrs = allocation.totalHours || (allocation.hoursPerWeek * allocation.durationWeeks) || 10;
        setModalData({
            ...allocation,
            startDate: start,
            totalHours: hrs,
            targetDate: allocation.targetDate || calculateDefaultTargetDate(start, hrs),
            description: allocation.description || '',
            reviewStatus: allocation.reviewStatus || 'none'
        });
        setIsModalOpen(true);
    };

    const estimatedCost = useMemo(() => {
        if (!modalData.employeeId || !modalData.startDate || !modalData.totalHours) return 0;

        const predictedFullyLoadedRate = getAccurateFullyLoadedRate(
            modalData.employeeId,
            modalData.startDate,
            salaryHistories,
            effHoursPeriods,
            overheadPeriods,
            employees
        );

        const totalHours = Number(modalData.totalHours) || 0;
        return totalHours * predictedFullyLoadedRate;
    }, [modalData.employeeId, modalData.startDate, modalData.totalHours, salaryHistories, effHoursPeriods, overheadPeriods, employees]);

    const activeProjects = useMemo(() => {
        if (!projects) return [];
        return projects.filter(p => {
            const status = (p.status || '').toLowerCase();
            return status === 'active';
        }).sort((a, b) => parseInt(a.projectNumber) - parseInt(b.projectNumber));
    }, [projects]);

    const filteredPipelineProjects = useMemo(() => {
        let result = activeProjects;

        // Pre-filter planningTasks globally based on the "Show Completed" toggle
        const visibleTasks = planningTasks.filter(t => {
            if (!showCompletedTasks) {
                const assignedAlloc = allocations.find(a => a.taskId === t.id);
                if (assignedAlloc && assignedAlloc.reviewStatus === 'approved') return false;
            }
            return true;
        });

        if (pipelineSearch) {
            const term = pipelineSearch.toLowerCase();
            result = result.filter(p => {
                const matchProj = String(p.projectNumber).toLowerCase().includes(term) || (p.projectDescription || '').toLowerCase().includes(term);
                const pTasks = visibleTasks.filter(t => t.projectNumber === p.projectNumber);
                const matchTask = pTasks.some(t => (t.title || '').toLowerCase().includes(term));
                return matchProj || matchTask;
            });
        }

        if (showWithTasksOnly) {
            result = result.filter(p => visibleTasks.some(t => t.projectNumber === p.projectNumber));
        }

        return result;
    }, [activeProjects, planningTasks, pipelineSearch, showWithTasksOnly, showCompletedTasks, allocations]);

    const getCapacityColor = (allocated, capacity, isWeekend) => {
        if (isWeekend) return 'bg-gray-100 border-gray-200 opacity-60';
        if (capacity === 0 && allocated > 0) return 'bg-red-100 border-red-300';
        if (capacity === 0) return 'bg-gray-100 border-gray-200 opacity-50 repeating-linear-gradient-diagonal';

        const ratio = allocated / capacity;
        if (ratio === 0) return 'bg-white border-gray-200 hover:bg-gray-50';
        if (ratio <= 0.8) return 'bg-green-50 border-green-200';
        if (ratio <= 1) return 'bg-yellow-50 border-yellow-300';
        return 'bg-red-50 border-red-300 ring-1 ring-inset ring-red-400';
    };

    if (loading || contextLoading) {
        return (
            <div className="flex items-center justify-center h-64 bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="flex flex-col items-center">
                    <div className="h-10 w-10 border-4 border-orange-100 border-t-orange-600 rounded-full animate-spin mb-4"></div>
                    <p className="text-gray-500 font-medium">Loading Daily Resource Matrix...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6 bg-red-50 text-red-700 rounded-xl border border-red-200 flex flex-col items-center justify-center text-center shadow-sm h-64">
                <ShieldExclamationIcon className="h-12 w-12 mb-4 text-red-500" />
                <h3 className="text-lg font-bold mb-2">{isPermissionError ? "Security Rules Blocked Access" : "Data Load Failed"}</h3>
                <p className="max-w-md text-sm mb-6">{error}</p>
                {isPermissionError && (
                    <div className="bg-white p-4 rounded-lg border border-red-100 text-left text-xs font-mono text-gray-800 shadow-sm w-full max-w-lg mb-4">
                        <p className="text-gray-500 mb-2">// Please add this to your Firebase Firestore Rules:</p>
                        <code>
                            match /resource_allocations/{"{document=**}"} {"{"}<br />
                            &nbsp;&nbsp;allow read, write: if request.auth != null;<br />
                            {"}"}<br /><br />
                            match /planning_tasks/{"{document=**}"} {"{"}<br />
                            &nbsp;&nbsp;allow read, write: if request.auth != null;<br />
                            {"}"}
                        </code>
                    </div>
                )}
                <button onClick={() => window.location.reload()} className="flex items-center px-6 py-2 bg-red-600 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-red-700 mt-2">
                    <ArrowPathIcon className="h-4 w-4 mr-2" /> Try Again
                </button>
            </div>
        );
    }

    return (
        <div className="flex h-[calc(100vh-10rem)] gap-4 flex-col lg:flex-row relative">

            {/* LEFT SIDEBAR: Project Pipeline */}
            <div className="w-full lg:w-80 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden shrink-0">
                <div className="p-4 bg-gray-50 border-b border-gray-200 shrink-0">
                    <h2 className="text-sm font-bold text-gray-800 flex items-center uppercase tracking-wider">
                        <BriefcaseIcon className="h-5 w-5 mr-2 text-orange-600" /> Task Pipeline
                    </h2>

                    <div className="mt-3 relative">
                        <MagnifyingGlassIcon className="h-4 w-4 absolute left-2 top-2.5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search projects or tasks..."
                            value={pipelineSearch}
                            onChange={(e) => setPipelineSearch(e.target.value)}
                            className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-orange-500 focus:border-orange-500 shadow-sm"
                        />
                    </div>

                    <div className="mt-2.5 flex items-center justify-between gap-2">
                        <label className="flex items-center cursor-pointer text-xs font-medium text-gray-700 hover:text-orange-600 transition-colors">
                            <input
                                type="checkbox"
                                className="mr-2 rounded text-orange-600 focus:ring-orange-500 border-gray-300"
                                checked={showWithTasksOnly}
                                onChange={(e) => setShowWithTasksOnly(e.target.checked)}
                            />
                            With Tasks
                        </label>
                        <label className="flex items-center cursor-pointer text-xs font-medium text-gray-700 hover:text-orange-600 transition-colors">
                            <input
                                type="checkbox"
                                className="mr-2 rounded text-orange-600 focus:ring-orange-500 border-gray-300"
                                checked={showCompletedTasks}
                                onChange={(e) => setShowCompletedTasks(e.target.checked)}
                            />
                            Show Completed
                        </label>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar min-h-[200px]">
                    {filteredPipelineProjects.map(p => {
                        const isExpanded = expandedPipelineProjects.has(p.projectNumber) || pipelineSearch;

                        // Filter rendering tasks based on Show Completed toggle
                        const pTasks = planningTasks.filter(t => {
                            if (t.projectNumber !== p.projectNumber) return false;
                            if (!showCompletedTasks) {
                                const assignedAlloc = allocations.find(a => a.taskId === t.id);
                                if (assignedAlloc && assignedAlloc.reviewStatus === 'approved') return false;
                            }
                            return true;
                        });

                        let badgeColor = 'bg-gray-100 text-gray-600 border-transparent';
                        if (pTasks.length > 0) {
                            const hasUnassigned = pTasks.some(task => !allocations.some(a => a.taskId === task.id));
                            badgeColor = hasUnassigned
                                ? 'bg-red-100 text-red-700 border border-red-200'
                                : 'bg-green-100 text-green-700 border border-green-200';
                        }

                        // Hide project if no tasks remain after filter and "Show With Tasks Only" is active
                        if (showWithTasksOnly && pTasks.length === 0) return null;

                        return (
                            <div key={p.projectNumber} className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                                <div
                                    className="p-3 bg-gray-50 flex justify-between items-center cursor-pointer hover:bg-gray-100 transition-colors"
                                    onClick={() => togglePipelineProject(p.projectNumber)}
                                >
                                    <div className="font-bold text-sm text-gray-800 flex items-center gap-2">
                                        <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${badgeColor}`}>{p.projectNumber}</span>
                                        <span className="truncate max-w-[140px]" title={p.projectDescription}>{p.projectDescription}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-gray-500 bg-white px-1.5 py-0.5 rounded border">{pTasks.length} Tasks</span>
                                        {isExpanded ? <ChevronDownIcon className="h-4 w-4 text-gray-400" /> : <ChevronRightIcon className="h-4 w-4 text-gray-400" />}
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div className="p-2 bg-white space-y-2 border-t border-gray-100">
                                        {pTasks.length === 0 && <p className="text-[10px] text-gray-400 italic text-center p-2">No tasks created or visible yet.</p>}

                                        {pTasks.map(task => {
                                            const assignedAlloc = allocations.find(a => a.taskId === task.id);
                                            const isAssigned = !!assignedAlloc;

                                            let pipelineTaskClass = 'bg-red-50 border-red-400 text-red-800 cursor-grab hover:shadow-md';
                                            if (isAssigned) {
                                                if (assignedAlloc.reviewStatus === 'approved') {
                                                    pipelineTaskClass = 'bg-gray-100 border-gray-300 text-gray-500 opacity-60 cursor-not-allowed';
                                                } else {
                                                    pipelineTaskClass = 'bg-green-50 border-green-400 text-green-800 opacity-80 cursor-not-allowed';
                                                }
                                            }

                                            return (
                                                <div
                                                    key={task.id}
                                                    draggable={!isAssigned && editingPipelineTaskId !== task.id}
                                                    onDragStart={(e) => { if (!isAssigned && editingPipelineTaskId !== task.id) handleDragStartTask(e, task); }}
                                                    className={`p-2 border rounded transition-all group ${pipelineTaskClass}`}
                                                    title={isAssigned ? (assignedAlloc.reviewStatus === 'approved' ? "Task Approved" : "Task is already assigned") : "Drag me to the matrix"}
                                                >
                                                    <div className="flex justify-between items-start gap-2">
                                                        {editingPipelineTaskId === task.id ? (
                                                            <div className="flex-1 flex items-center gap-1">
                                                                <input
                                                                    type="text"
                                                                    value={editingPipelineTaskTitle}
                                                                    onChange={(e) => setEditingPipelineTaskTitle(e.target.value)}
                                                                    className="flex-1 border border-orange-300 rounded px-1 py-0.5 text-xs text-gray-900 focus:outline-none shadow-inner"
                                                                    autoFocus
                                                                    onKeyDown={(e) => e.key === 'Enter' && handleUpdatePipelineTask(task.id)}
                                                                />
                                                                <button onClick={() => handleUpdatePipelineTask(task.id)} className="text-green-600 hover:text-green-800 p-0.5"><CheckIcon className="h-4 w-4" /></button>
                                                                <button onClick={() => setEditingPipelineTaskId(null)} className="text-gray-400 hover:text-red-600 p-0.5"><XMarkIcon className="h-4 w-4" /></button>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <div className={`text-xs font-bold leading-tight ${assignedAlloc?.reviewStatus === 'approved' ? 'line-through' : ''}`}>
                                                                    {task.title}
                                                                </div>
                                                                <div className="flex items-center shrink-0">
                                                                    {isAssigned ? (
                                                                        <div className="flex items-center gap-1">
                                                                            <CheckCircleIcon className="h-4 w-4 text-green-500" title="Assigned" />
                                                                            {assignedAlloc?.reviewStatus !== 'approved' && (
                                                                                <button onClick={() => handleUnassignTask(assignedAlloc.id)} className="text-red-400 hover:text-red-600 transition-colors" title="Unassign Task (Return to Pipeline)">
                                                                                    <ArrowUturnLeftIcon className="h-4 w-4" />
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                                                                            <button onClick={() => { setEditingPipelineTaskId(task.id); setEditingPipelineTaskTitle(task.title); }} className="text-gray-400 hover:text-orange-600" title="Edit Task">
                                                                                <PencilIcon className="h-3.5 w-3.5" />
                                                                            </button>
                                                                            <button onClick={() => handleDeletePipelineTask(task.id)} className="text-gray-400 hover:text-red-600" title="Delete Task">
                                                                                <TrashIcon className="h-3.5 w-3.5" />
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                    {editingPipelineTaskId !== task.id && (
                                                        <div className="text-[9px] font-mono mt-0.5 uppercase opacity-70">ID: {task.id.substring(0, 6)}</div>
                                                    )}
                                                </div>
                                            );
                                        })}

                                        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-gray-100">
                                            <input
                                                type="text"
                                                placeholder="Type new task..."
                                                className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-orange-500 focus:border-orange-500 shadow-inner"
                                                value={newTaskTitles[p.projectNumber] || ''}
                                                onChange={(e) => setNewTaskTitles(prev => ({ ...prev, [p.projectNumber]: e.target.value }))}
                                                onKeyDown={(e) => e.key === 'Enter' && handleAddPipelineTask(p.projectNumber)}
                                            />
                                            <button
                                                onClick={() => handleAddPipelineTask(p.projectNumber)}
                                                className="p-1.5 bg-gray-200 text-gray-600 rounded hover:bg-orange-600 hover:text-white transition-colors"
                                            >
                                                <PlusIcon className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {filteredPipelineProjects.length === 0 && (
                        <div className="text-center p-4 text-gray-400 text-xs italic">No projects found matching current filters.</div>
                    )}
                </div>
            </div>

            {/* MAIN AREA: Daily Resource Matrix */}
            <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden min-h-[400px]">

                {/* Matrix Toolbar */}
                <div className="p-4 border-b border-gray-200 flex flex-wrap gap-4 justify-between items-center bg-white shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <UserGroupIcon className="h-6 w-6 text-gray-400" />
                            <h2 className="text-lg font-bold text-gray-900">Daily Resource Matrix</h2>
                        </div>

                        {/* Team Member Filter */}
                        <div className="flex items-center gap-2 relative ml-4 pl-4 border-l border-gray-200" ref={employeeDropdownRef}>
                            <button
                                onClick={() => setIsEmployeeDropdownOpen(!isEmployeeDropdownOpen)}
                                className="border border-gray-300 rounded p-1.5 text-xs font-medium focus:ring-indigo-500 outline-none bg-white min-w-[160px] flex justify-between items-center shadow-sm hover:bg-gray-50"
                            >
                                <span className="truncate max-w-[140px] text-gray-700">
                                    {validSelectedEmployees.length === 0 ? 'All Team Members' : `${validSelectedEmployees.length} Selected`}
                                </span>
                                <ChevronDownIcon className="h-3 w-3 ml-2 text-gray-400" />
                            </button>
                            {isEmployeeDropdownOpen && (
                                <div className="absolute top-full left-0 z-50 mt-1 w-64 bg-white border border-gray-200 rounded-md shadow-xl max-h-80 overflow-y-auto custom-scrollbar">
                                    <div
                                        className="px-3 py-2 border-b border-gray-100 hover:bg-gray-50 cursor-pointer text-xs font-bold text-gray-700 flex justify-between items-center sticky top-0 bg-white"
                                        onClick={() => { setSelectedEmployees([]); setIsEmployeeDropdownOpen(false); }}
                                    >
                                        <span>Clear Selection (Show All)</span>
                                    </div>
                                    {availableEmployees.map(emp => (
                                        <label key={emp.id} className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer text-xs border-b border-gray-50 last:border-0">
                                            <input
                                                type="checkbox"
                                                className="mr-3 rounded text-indigo-600 focus:ring-indigo-500 border-gray-300"
                                                checked={validSelectedEmployees.includes(emp.id)}
                                                onChange={() => {
                                                    setSelectedEmployees(prev => prev.includes(emp.id) ? prev.filter(id => id !== emp.id) : [...prev, emp.id]);
                                                }}
                                            />
                                            <span className="truncate font-medium text-gray-700">{emp.name} {emp.surname}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Note: Show Completed toggle was moved to the left sidebar as requested */}
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                            <span className="flex items-center"><div className="w-2.5 h-2.5 bg-green-500 rounded-full mr-1"></div> Active</span>
                            <span className="flex items-center"><div className="w-2.5 h-2.5 bg-red-500 rounded-full mr-1"></div> Overdue</span>
                            <span className="flex items-center"><div className="w-2.5 h-2.5 bg-yellow-400 rounded-full mr-1"></div> Review</span>
                            <span className="flex items-center"><div className="w-2.5 h-2.5 bg-gray-300 rounded-full mr-1"></div> Done</span>
                        </div>
                        <div className="h-6 w-px bg-gray-200 mx-2 hidden sm:block"></div>
                        <div className="flex items-center bg-gray-100 rounded-lg p-1 border shadow-inner">
                            <button onClick={() => shiftTimeline(-7)} className="p-1 hover:bg-white rounded"><ChevronLeftIcon className="h-5 w-5 text-gray-600" /></button>
                            <span className="px-4 text-sm font-bold text-gray-700 w-36 text-center">
                                {timelineDays[0]?.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - {timelineDays[timelineDays.length - 1]?.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                            <button onClick={() => shiftTimeline(7)} className="p-1 hover:bg-white rounded"><ChevronRightIcon className="h-5 w-5 text-gray-600" /></button>
                        </div>
                    </div>
                </div>

                {/* Matrix Grid */}
                <div className="flex-1 overflow-auto custom-scrollbar bg-gray-50/50">
                    <table className="min-w-full border-separate border-spacing-0">
                        <thead className="bg-gray-100 sticky top-0 z-20 shadow-sm">
                            <tr>
                                <th className="w-48 sticky left-0 z-30 bg-gray-100 border-b border-r border-gray-200 p-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider shadow-[1px_0_0_0_#e5e7eb]">
                                    Team Member
                                </th>
                                {timelineDays.map(day => (
                                    <th key={day.iso} className={`min-w-[120px] w-32 border-b border-r border-gray-200 p-2 text-center ${day.isWeekend ? 'bg-gray-200 text-gray-400' : 'bg-gray-100 text-gray-800'}`}>
                                        <div className="text-xs font-bold">{day.label.split(' ')[0]}</div>
                                        <div className="text-[10px] font-normal mt-0.5">{day.label.split(' ').slice(1).join(' ')}</div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="bg-white font-sans">
                            {matrixData.length === 0 ? (
                                <tr>
                                    <td colSpan={timelineDays.length + 1} className="p-8 text-center text-gray-500 text-sm">
                                        No team members found. Adjust your filters or add employees.
                                    </td>
                                </tr>
                            ) : matrixData.map(row => (
                                <tr key={row.employee.id} className="group">
                                    <td className="w-48 sticky left-0 z-10 bg-white group-hover:bg-gray-50 border-b border-r border-gray-200 p-3 align-top shadow-[1px_0_0_0_#e5e7eb] transition-colors">
                                        <div className="font-bold text-sm text-gray-900">{row.employee.name} {row.employee.surname}</div>
                                        <div className="text-xs text-gray-500">{row.employee.jobTitle || 'Staff'}</div>
                                    </td>

                                    {timelineDays.map(day => {
                                        const cellData = row.days[day.iso] || { capacity: 0, allocated: 0, items: [] };
                                        const cellId = `${row.employee.id}_${day.iso}`;
                                        const isDragOver = dragOverCell === cellId;

                                        return (
                                            <td
                                                key={day.iso}
                                                className={`border-b border-r transition-colors align-top p-1.5 
                                                    ${getCapacityColor(cellData.allocated, cellData.capacity, day.isWeekend)}
                                                    ${isDragOver ? 'ring-2 ring-inset ring-orange-400 bg-orange-50' : ''}
                                                `}
                                                onDragOver={(e) => handleDragOver(e, row.employee.id, day.iso)}
                                                onDragLeave={handleDragLeave}
                                                onDrop={(e) => handleDrop(e, row.employee.id, day.iso)}
                                            >
                                                {/* Capacity Indicator Header */}
                                                {!day.isWeekend && (
                                                    <div className="flex justify-between items-center mb-1.5 px-1 opacity-70">
                                                        <span className={`text-[9px] font-bold ${cellData.allocated > cellData.capacity ? 'text-red-700' : 'text-gray-600'}`}>
                                                            {cellData.allocated}h / {cellData.capacity}h
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Allocation Blocks */}
                                                <div className="space-y-1">
                                                    {cellData.items.map((alloc, idx) => {
                                                        const isApproved = alloc.reviewStatus === 'approved';
                                                        const isPending = alloc.reviewStatus === 'pending';
                                                        const isOverdue = !isApproved && !isPending && new Date(alloc.targetDate) < new Date(new Date().setHours(0, 0, 0, 0));

                                                        let statusClass = 'bg-green-50 border-green-500 text-green-900';
                                                        if (isApproved) {
                                                            statusClass = 'bg-gray-100 border-gray-300 text-gray-500 opacity-70';
                                                        } else if (isPending) {
                                                            statusClass = 'bg-yellow-50 border-yellow-400 text-yellow-800 ring-1 ring-yellow-400 animate-pulse';
                                                        } else if (isOverdue) {
                                                            statusClass = 'bg-red-50 border-red-500 text-red-900';
                                                        }

                                                        return (
                                                            <div
                                                                key={`${alloc.id}_${idx}`}
                                                                draggable
                                                                onDragStart={(e) => handleDragStartAllocation(e, alloc)}
                                                                onClick={() => openEditModal(alloc)}
                                                                onMouseEnter={(e) => setTooltip({ show: true, x: e.clientX, y: e.clientY, data: alloc })}
                                                                onMouseMove={(e) => setTooltip(prev => ({ ...prev, x: e.clientX, y: e.clientY }))}
                                                                onMouseLeave={() => setTooltip({ show: false, x: 0, y: 0, data: null })}
                                                                className={`p-1 rounded shadow-sm text-left cursor-grab active:cursor-grabbing transition-all border-l-4 border-t border-r border-b ${statusClass}`}
                                                            >
                                                                <div className="flex justify-between items-center">
                                                                    <span className="font-mono text-[9px] font-black truncate">{alloc.projectNumber}</span>
                                                                    <span className="text-[9px] font-bold bg-white/60 px-1 rounded ml-1 shrink-0">{alloc.hoursToday}h</span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {/* Empty State Drop Hint */}
                                                {cellData.items.length === 0 && cellData.capacity > 0 && (
                                                    <div className="h-6 w-full border-2 border-dashed border-transparent group-hover:border-gray-300 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                                        <PlusIcon className="h-3 w-3 text-gray-400" />
                                                    </div>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ALLOCATION MODAL */}
            <Modal show={isModalOpen} onClose={() => setIsModalOpen(false)} title={modalData.id ? "Edit Allocation" : "Assign Task to Resource"} maxWidth="sm:max-w-xl">
                <form onSubmit={handleSaveAllocation} className="space-y-4">

                    {modalData.id && modalData.reviewStatus === 'pending' && (
                        <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg flex justify-between items-center">
                            <div>
                                <p className="text-sm font-bold text-yellow-800">Task Pending Review</p>
                                <p className="text-xs text-yellow-700">The assigned employee has marked this task as complete.</p>
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={handleRejectTask} className="px-3 py-1.5 bg-white border border-red-200 text-red-700 hover:bg-red-50 rounded text-xs font-bold transition-colors shadow-sm">Reject & Return</button>
                                <button type="button" onClick={handleApproveTask} className="px-3 py-1.5 bg-green-600 text-white hover:bg-green-700 rounded text-xs font-bold transition-colors shadow-sm">Approve Task</button>
                            </div>
                        </div>
                    )}

                    {modalData.id && modalData.reviewStatus === 'approved' && (
                        <div className="bg-gray-100 border border-gray-300 p-4 rounded-lg flex items-center">
                            <CheckCircleIcon className="h-6 w-6 text-gray-500 mr-2" />
                            <div>
                                <p className="text-sm font-bold text-gray-700">Task Completed & Approved</p>
                                <p className="text-xs text-gray-500">This task has been archived.</p>
                            </div>
                        </div>
                    )}

                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 flex justify-between items-start">
                        <div>
                            <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Task Info</p>
                            <p className="font-mono text-sm font-bold text-indigo-600">{modalData.projectNumber}</p>
                            <p className="text-xs font-medium text-gray-800">{modalData.taskTitle || 'Unspecified Task'}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Resource</p>
                            <p className="text-sm font-bold text-gray-900">
                                {employees.find(e => e.id === modalData.employeeId)?.name} {employees.find(e => e.id === modalData.employeeId)?.surname}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Architectural Phase Category</label>
                            <select
                                className="w-full p-2 border border-gray-300 rounded focus:ring-indigo-500 focus:border-indigo-500 text-sm bg-white"
                                value={modalData.phase}
                                onChange={(e) => setModalData({ ...modalData, phase: e.target.value })}
                                disabled={modalData.reviewStatus === 'approved'}
                            >
                                {ARCHITECTURAL_PHASES.map(p => (
                                    <option key={p.id} value={p.id}>{p.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Start Date</label>
                            <input
                                type="date"
                                className="w-full p-2 border border-gray-300 rounded focus:ring-indigo-500 focus:border-indigo-500 text-sm bg-white"
                                value={modalData.startDate}
                                onChange={(e) => setModalData(prev => ({
                                    ...prev,
                                    startDate: e.target.value,
                                    targetDate: calculateDefaultTargetDate(e.target.value, prev.totalHours)
                                }))}
                                required
                                disabled={modalData.reviewStatus === 'approved'}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-700 uppercase mb-1 flex items-center justify-between">
                                <span>Total Allocated Hours</span>
                            </label>
                            <div className="relative">
                                <input
                                    type="number"
                                    min="0.5" step="0.5"
                                    className="w-full p-2 border border-gray-300 rounded focus:ring-indigo-500 focus:border-indigo-500 text-sm font-bold"
                                    value={modalData.totalHours}
                                    onChange={(e) => setModalData(prev => ({
                                        ...prev,
                                        totalHours: e.target.value,
                                        targetDate: calculateDefaultTargetDate(prev.startDate, e.target.value)
                                    }))}
                                    required
                                    disabled={modalData.reviewStatus === 'approved'}
                                />
                                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                    <span className="text-gray-500 font-medium text-xs">hrs</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Target Completion Date</label>
                            <input
                                type="date"
                                className={`w-full p-2 border rounded focus:ring-indigo-500 focus:border-indigo-500 text-sm ${(!isTargetDateValid && modalData.targetDate) ? 'border-red-500 bg-red-50 text-red-900' : 'border-gray-300 bg-white'}`}
                                value={modalData.targetDate}
                                onChange={(e) => setModalData({ ...modalData, targetDate: e.target.value })}
                                required
                                disabled={modalData.reviewStatus === 'approved'}
                            />
                            {!isTargetDateValid && modalData.targetDate && (
                                <p className="text-[11px] text-red-600 mt-1.5 font-bold flex items-center">
                                    <ExclamationTriangleIcon className="h-4 w-4 mr-1 inline" />
                                    Based on the total hours, this date cannot be earlier than {minTargetDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}.
                                </p>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Allocation Details & Notes</label>
                        <textarea
                            className="w-full p-2 border border-gray-300 rounded focus:ring-indigo-500 focus:border-indigo-500 text-sm bg-white"
                            rows="2"
                            placeholder="Specific instructions or notes..."
                            value={modalData.description}
                            onChange={(e) => setModalData({ ...modalData, description: e.target.value })}
                            disabled={modalData.reviewStatus === 'approved'}
                        />
                    </div>

                    <div className="pt-2 border-t border-gray-100 flex justify-end items-center">
                        <div className="bg-gray-100 p-3 rounded text-right w-48 border border-gray-200">
                            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Est. Fully Loaded Cost</p>
                            <p className="text-lg font-mono font-bold text-indigo-600">€{estimatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            <p className="text-[9px] text-gray-400 mt-0.5" title="Direct Cost + Allocated Overhead + Non-Productive Time estimation">Calculated precisely via central engine</p>
                        </div>
                    </div>

                    <div className="flex justify-between items-center pt-4 border-t border-gray-200 mt-4">
                        {modalData.id ? (
                            <button type="button" onClick={handleDeleteAllocation} className="text-red-600 hover:bg-red-50 p-2 rounded flex items-center text-sm font-bold transition-colors">
                                <TrashIcon className="h-4 w-4 mr-1" /> Remove
                            </button>
                        ) : <div></div>}

                        <div className="flex gap-2">
                            <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded text-sm font-medium hover:bg-gray-50 text-gray-700">Cancel</button>
                            <button
                                type="submit"
                                disabled={!isTargetDateValid || modalData.reviewStatus === 'approved'}
                                className={`px-6 py-2 bg-indigo-600 text-white rounded text-sm font-bold shadow transition-colors ${!isTargetDateValid || modalData.reviewStatus === 'approved' ? 'opacity-50 cursor-not-allowed' : 'hover:bg-indigo-700'}`}
                            >
                                Save Allocation
                            </button>
                        </div>
                    </div>
                </form>
            </Modal>

            {/* CUSTOM ALLOCATION TOOLTIP */}
            {tooltip.show && tooltip.data && (
                <div
                    className="fixed z-[9999] pointer-events-none bg-gray-900 text-white p-4 rounded-lg shadow-2xl text-xs w-72 border border-gray-700"
                    style={{
                        left: Math.min(tooltip.x + 15, window.innerWidth - 300),
                        top: Math.min(tooltip.y + 15, window.innerHeight - 250)
                    }}
                >
                    <div className="font-mono text-indigo-400 font-bold mb-1 border-b border-gray-700 pb-1">{tooltip.data.projectNumber}</div>
                    <div className="font-bold text-sm mb-2 leading-tight">{tooltip.data.taskTitle || 'Unspecified Task'}</div>
                    <div className="grid grid-cols-2 gap-2 text-gray-300 mt-2 mb-2 bg-gray-800 p-2 rounded">
                        <div><span className="text-gray-500 block text-[10px] uppercase">Target Date</span><span className="font-medium text-white">{tooltip.data.targetDate}</span></div>
                        <div><span className="text-gray-500 block text-[10px] uppercase">Total Budget</span><span className="font-medium text-white">{tooltip.data.totalHours}h</span></div>
                    </div>
                    {tooltip.data.description && (
                        <div className="mt-3 pt-2 border-t border-gray-700 whitespace-pre-wrap leading-relaxed text-gray-300 max-h-32 overflow-hidden">
                            <span className="text-gray-500 text-[10px] uppercase block mb-1">Details & Notes:</span>
                            {tooltip.data.description}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ProjectScheduler;