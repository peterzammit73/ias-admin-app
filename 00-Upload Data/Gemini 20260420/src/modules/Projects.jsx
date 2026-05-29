// File Path: src/modules/Projects.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase.js';
import Modal from '../components/Modal.jsx';
import ProjectCostAuditModal from './billing/ProjectCostAuditModal.jsx';
import {
    PlusIcon,
    PencilIcon,
    TrashIcon,
    MagnifyingGlassIcon,
    BarsArrowUpIcon,
    BarsArrowDownIcon,
    ChevronUpDownIcon,
    FunnelIcon,
    PresentationChartLineIcon,
    TagIcon,
    ClockIcon
} from '@heroicons/react/24/outline';

const Projects = ({ permission }) => {
    const [projects, setProjects] = useState([]);
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [currentProject, setCurrentProject] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [sortConfig, setSortConfig] = useState({ key: 'projectNumber', direction: 'asc' });
    const [clientSearchTerm, setClientSearchTerm] = useState('');
    const [showClientDropdown, setShowClientDropdown] = useState(false);

    // Dashboard State
    const [dashboardProject, setDashboardProject] = useState(null);

    const initialFormState = {
        projectNumber: '',
        clientNumber: '',
        clientActiveFrom: new Date().toISOString().split('T')[0], // Added Effective Date
        clientHistory: [], // Added Client History Array
        projectDescription: '',
        projectType: 'standard',
        siteAddress: '',
        siteLocality: '',
        sitePostCode: '',
        siteCountry: '',
        status: 'Active',
        isBillable: true,
        architecture: '',
        structure: '',
        cost: '',
        pm: ''
    };

    const reservedNumbers = [999, 1000, 1100, 1500, 2000, 3000, 4000, 4100, 9000];

    const clientMap = useMemo(() => {
        return clients.reduce((acc, client) => {
            acc[client.clientNumber] = client;
            return acc;
        }, {});
    }, [clients]);

    const getClientDisplay = (client) => {
        if (!client) return '';
        const firstName = client.name || '';
        const surname = client.surname || '';
        const fullName = `${firstName} ${surname}`.trim();
        const company = client.companyName || '';
        const clientNum = String(client.clientNumber).padStart(4, '0');
        let displayName = '';
        if (company && fullName) {
            displayName = `${company} (${fullName})`;
        } else if (company) {
            displayName = company;
        } else {
            displayName = fullName || 'Unknown Client';
        }
        return `${displayName} [${clientNum}]`;
    };

    const filteredClientsForSelection = useMemo(() => {
        if (!clients) return [];

        // If the search term exactly matches the currently selected client, show the full list
        const selectedClient = currentProject?.clientNumber ? clientMap[currentProject.clientNumber] : null;
        const selectedDisplayName = selectedClient ? getClientDisplay(selectedClient) : '';

        if (clientSearchTerm === selectedDisplayName) {
            return clients.sort((a, b) => getClientDisplay(a).localeCompare(getClientDisplay(b)));
        }

        const term = clientSearchTerm.toLowerCase();
        return clients.filter(c => {
            const num = String(c.clientNumber).padStart(4, '0');
            const display = getClientDisplay(c).toLowerCase();
            return display.includes(term) || num.includes(term);
        }).sort((a, b) => {
            const displayA = getClientDisplay(a);
            const displayB = getClientDisplay(b);
            return displayA.localeCompare(displayB);
        });
    }, [clients, clientSearchTerm, currentProject?.clientNumber, clientMap]);

    useEffect(() => {
        setLoading(true);
        const projectsQuery = collection(db, "projects");
        const clientsQuery = collection(db, "clients");

        const unsubProjects = onSnapshot(projectsQuery, (snapshot) => {
            const projectsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setProjects(projectsData);
            setLoading(false);
        });

        const unsubClients = onSnapshot(clientsQuery, (snapshot) => {
            const clientsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setClients(clientsData);
        });

        return () => {
            unsubProjects();
            unsubClients();
        };
    }, []);

    const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        if (name === 'statusToggle') {
            setCurrentProject(prevState => ({ ...prevState, status: checked ? 'Active' : 'Non-Active' }));
        } else if (name === 'isBillable') {
            setCurrentProject(prevState => ({ ...prevState, isBillable: checked }));
        } else if (['architecture', 'structure', 'cost', 'pm'].includes(name)) {
            if (value === '' || /^\d*\.?\d*$/.test(value)) {
                const numVal = parseFloat(value);
                if (value !== '' && !isNaN(numVal) && numVal > 1) return;
                setCurrentProject(prevState => ({ ...prevState, [name]: value }));
            }
        } else {
            setCurrentProject(prevState => ({ ...prevState, [name]: value }));
        }
    };

    const handleFeeBlur = (e) => {
        const { name, value } = e.target;
        let numValue = parseFloat(value);
        if (isNaN(numValue)) {
            numValue = 0;
        } else {
            if (numValue < 0) numValue = 0;
            if (numValue > 1) numValue = 1;
        }
        setCurrentProject(prev => ({ ...prev, [name]: numValue }));
    };

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const handleToggleStatus = async (projectId, currentStatus) => {
        if (permission !== 'edit') return;
        const newStatus = currentStatus === 'Active' ? 'Non-Active' : 'Active';
        try {
            await updateDoc(doc(db, "projects", projectId), { status: newStatus });
        } catch (error) {
            console.error("Error toggling project status:", error);
            alert("Failed to update status.");
        }
    };

    const handleAddNew = () => {
        if (permission !== 'edit') return;
        let lastProjectNumber = 0;
        if (projects.length > 0) {
            const validProjectNumbers = projects
                .map(p => parseInt(p.projectNumber, 10))
                .filter(n => !isNaN(n) && !reservedNumbers.includes(n));
            if (validProjectNumbers.length > 0) {
                lastProjectNumber = Math.max(...validProjectNumbers);
            }
        }
        let nextProjectNumber = lastProjectNumber + 1;
        while (reservedNumbers.includes(nextProjectNumber)) {
            nextProjectNumber++;
        }
        setIsEditing(false);
        const formattedProjectNumber = String(nextProjectNumber).padStart(4, '0');
        setCurrentProject({ ...initialFormState, projectNumber: formattedProjectNumber });
        setClientSearchTerm('');
        setShowClientDropdown(false);
        setShowModal(true);
    };

    const handleEdit = (project) => {
        if (permission !== 'edit') return;
        setIsEditing(true);
        setCurrentProject({
            ...project,
            isBillable: project.isBillable !== undefined ? project.isBillable : true,
            projectType: project.projectType || 'standard',
            architecture: project.architecture !== undefined ? project.architecture : 0,
            structure: project.structure !== undefined ? project.structure : 0,
            cost: project.cost !== undefined ? project.cost : 0,
            pm: project.pm !== undefined ? project.pm : 0,
            // Fallback dates and arrays for older projects being edited for the first time
            clientActiveFrom: project.clientActiveFrom || '2004-01-01',
            clientHistory: project.clientHistory || []
        });
        const client = clientMap[project.clientNumber];
        if (client) {
            setClientSearchTerm(getClientDisplay(client));
        } else {
            setClientSearchTerm('');
        }
        setShowClientDropdown(false);
        setShowModal(true);
    };

    const handleDelete = async (id) => {
        if (permission !== 'edit') return;
        if (window.confirm("Are you sure you want to delete this project?")) {
            try {
                await deleteDoc(doc(db, "projects", id));
            } catch (error) {
                console.error("Error deleting project: ", error);
                alert("Failed to delete project.");
            }
        }
    };

    const validateFees = () => {
        if (!currentProject) return false;
        const arch = parseFloat(currentProject.architecture) || 0;
        const struct = parseFloat(currentProject.structure) || 0;
        const cost = parseFloat(currentProject.cost) || 0;
        const pm = parseFloat(currentProject.pm) || 0;
        const total = arch + struct + cost + pm;
        return Math.abs(total - 1.0) < 0.0001;
    };

    const feeTotal = useMemo(() => {
        if (!currentProject) return 0;
        const arch = parseFloat(currentProject.architecture) || 0;
        const struct = parseFloat(currentProject.structure) || 0;
        const cost = parseFloat(currentProject.cost) || 0;
        const pm = parseFloat(currentProject.pm) || 0;
        return arch + struct + cost + pm;
    }, [currentProject?.architecture, currentProject?.structure, currentProject?.cost, currentProject?.pm]);

    const handleSave = async (e) => {
        e.preventDefault();
        if (permission !== 'edit') return;
        if (!currentProject.projectNumber || !currentProject.projectDescription || !currentProject.clientNumber || currentProject.architecture === '' || currentProject.structure === '' || currentProject.cost === '' || currentProject.pm === '') {
            alert("Please fill in all mandatory fields: Project Number, Client, Description, Architecture, Structure, Cost, and PM.");
            return;
        }
        if (!validateFees()) {
            alert(`Total fee distribution must equal 1. Current total: ${feeTotal.toFixed(2)}`);
            return;
        }

        try {
            // Client History Logic
            if (isEditing) {
                const originalProject = projects.find(p => p.id === currentProject.id);
                if (originalProject && originalProject.clientNumber !== currentProject.clientNumber) {
                    // Calculate end date for the previous client (Day before new active date)
                    const newStartDate = new Date(currentProject.clientActiveFrom);
                    const prevEndDate = new Date(newStartDate);
                    prevEndDate.setDate(prevEndDate.getDate() - 1);
                    const prevEndDateStr = prevEndDate.toISOString().split('T')[0];

                    const oldStartDate = originalProject.clientActiveFrom || '2004-01-01';

                    const oldClientRecord = {
                        clientNumber: originalProject.clientNumber,
                        startDate: oldStartDate,
                        endDate: prevEndDateStr,
                        archivedAt: new Date().toISOString()
                    };

                    currentProject.clientHistory = [
                        ...(currentProject.clientHistory || []),
                        oldClientRecord
                    ];
                }
            }

            const dataToSave = {
                ...currentProject,
                architecture: parseFloat(currentProject.architecture) || 0,
                structure: parseFloat(currentProject.structure) || 0,
                cost: parseFloat(currentProject.cost) || 0,
                pm: parseFloat(currentProject.pm) || 0,
            };

            if (isEditing) {
                const projectRef = doc(db, "projects", currentProject.id);
                const { id, ...dataToUpdate } = dataToSave;
                await updateDoc(projectRef, dataToUpdate);
            } else {
                await addDoc(collection(db, "projects"), dataToSave);
            }
            setShowModal(false);
        } catch (error) {
            console.error("Error saving project: ", error);
            alert("Failed to save project.");
        }
    };

    const selectClient = (client) => {
        setCurrentProject(prev => ({ ...prev, clientNumber: client.clientNumber }));
        setClientSearchTerm(getClientDisplay(client));
        setShowClientDropdown(false);
    };

    const filteredProjects = useMemo(() => {
        let data = projects.map(project => {
            const client = clientMap[project.clientNumber];
            const clientName = client ? `${client.name || ''} ${client.surname || ''}`.trim() : 'Unknown';
            const companyName = client ? client.companyName : '';
            const displayClient = companyName || clientName;
            return { ...project, clientName, companyName, displayClient };
        }).filter(project => {
            if (statusFilter !== 'all' && project.status !== statusFilter) {
                return false;
            }
            const searchTermLower = searchTerm.toLowerCase();
            return (project.projectDescription && project.projectDescription.toLowerCase().includes(searchTermLower)) ||
                (project.projectNumber && project.projectNumber.toString().toLowerCase().includes(searchTermLower)) ||
                (project.clientName && project.clientName.toLowerCase().includes(searchTermLower)) ||
                (project.companyName && project.companyName.toLowerCase().includes(searchTermLower));
        });

        if (sortConfig.key) {
            data.sort((a, b) => {
                let aValue = '';
                let bValue = '';
                if (sortConfig.key === 'projectNumber') {
                    aValue = parseInt(a.projectNumber, 10) || 0;
                    bValue = parseInt(b.projectNumber, 10) || 0;
                    return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
                }
                if (sortConfig.key === 'projectDescription') {
                    aValue = a.projectDescription || '';
                    bValue = b.projectDescription || '';
                } else if (sortConfig.key === 'client') {
                    aValue = a.displayClient || '';
                    bValue = b.displayClient || '';
                }
                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return data;
    }, [projects, clientMap, searchTerm, sortConfig, statusFilter]);

    const SortIcon = ({ columnKey }) => {
        if (sortConfig.key !== columnKey) {
            return <BarsArrowUpIcon className="h-4 w-4 text-gray-300 opacity-0 group-hover:opacity-100" />;
        }
        return sortConfig.direction === 'asc'
            ? <BarsArrowUpIcon className="h-4 w-4 text-gray-600" />
            : <BarsArrowDownIcon className="h-4 w-4 text-gray-600" />;
    };

    const getProjectTypeBadge = (type) => {
        switch (type) {
            case 'internal':
                return <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-purple-200">Internal</span>;
            case 'misc':
                return <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-amber-200">Misc</span>;
            default:
                return null;
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-9rem)] bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">

            {/* Header Section (Fixed) */}
            <div className="p-6 border-b border-gray-200 shrink-0">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900">Projects Directory</h2>
                        <p className="mt-1 text-base text-gray-600">
                            {permission === 'edit' ? 'Manage all company projects.' : 'A read-only directory of all company projects.'}
                        </p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
                        {/* Status Filter */}
                        <div className="relative min-w-[140px]">
                            <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                                <FunnelIcon className="h-4 w-4 text-gray-400" />
                            </div>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="block w-full rounded-md border-0 py-2 pl-9 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-orange-500 sm:text-base"
                            >
                                <option value="all">All Statuses</option>
                                <option value="Active">Active Only</option>
                                <option value="Non-Active">Non-Active Only</option>
                            </select>
                        </div>

                        {/* Search Bar */}
                        <div className="relative w-full sm:w-auto">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                            </div>
                            <input
                                type="text"
                                placeholder="Search..."
                                className="block w-full sm:w-64 rounded-md border-0 py-2 pl-10 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-orange-500 text-base"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        {permission === 'edit' && (
                            <button onClick={handleAddNew} className="flex items-center justify-center bg-orange-600 text-white py-2 px-4 rounded-md text-base font-medium hover:bg-orange-700 w-full sm:w-auto">
                                <PlusIcon className="h-5 w-5 mr-2" />
                                Add Project
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Table Section (Scrollable) */}
            <div className="flex-1 overflow-auto">
                <table className="min-w-full">
                    <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th
                                scope="col"
                                className="py-2 pl-4 pr-3 text-left text-base font-semibold text-gray-900 sm:pl-2 cursor-pointer hover:bg-gray-100 group"
                                onClick={() => handleSort('projectNumber')}
                            >
                                <div className="flex items-center gap-2">
                                    Project No.
                                    <SortIcon columnKey="projectNumber" />
                                </div>
                            </th>
                            <th
                                scope="col"
                                className="px-3 py-2 text-left text-base font-semibold text-gray-900 cursor-pointer hover:bg-gray-100 group"
                                onClick={() => handleSort('projectDescription')}
                            >
                                <div className="flex items-center gap-2">
                                    Description
                                    <SortIcon columnKey="projectDescription" />
                                </div>
                            </th>
                            <th
                                scope="col"
                                className="px-3 py-2 text-left text-base font-semibold text-gray-900 cursor-pointer hover:bg-gray-100 group"
                                onClick={() => handleSort('client')}
                            >
                                <div className="flex items-center gap-2">
                                    Client
                                    <SortIcon columnKey="client" />
                                </div>
                            </th>
                            {permission === 'edit' && (
                                <th scope="col" className="px-3 py-2 text-center text-base font-semibold text-gray-900">Billable</th>
                            )}
                            <th scope="col" className="px-3 py-2 text-center text-base font-semibold text-gray-900">Status</th>
                            {permission === 'edit' && <th scope="col" className="relative py-3 pl-3 pr-4 sm:pr-6"><span className="sr-only">Edit</span></th>}
                        </tr>
                        {/* Faint Orange Line */}
                        <tr className="h-px bg-orange-200">
                            <th colSpan={permission === 'edit' ? 6 : 4} className="p-0 border-0"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                        {loading ? (
                            <tr><td colSpan={permission === 'edit' ? 6 : 4} className="whitespace-nowrap px-3 py-4 text-base text-gray-500 text-center">Loading projects...</td></tr>
                        ) : filteredProjects.length > 0 ? (
                            filteredProjects.map((project) => (
                                <tr key={project.id} className="hover:bg-gray-50">
                                    <td className="whitespace-nowrap py-2 pl-4 pr-3 text-base font-medium text-gray-900 sm:pl-2 font-mono">
                                        <div className="flex items-center gap-2">
                                            {String(project.projectNumber).padStart(4, '0')}
                                            {getProjectTypeBadge(project.projectType)}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-base text-gray-500">{project.projectDescription}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-base text-gray-500">
                                        {project.displayClient}
                                    </td>
                                    {permission === 'edit' && (
                                        <td className="whitespace-nowrap px-3 py-2 text-center text-base">
                                            {project.isBillable !== false ?
                                                <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded text-xs font-medium">Yes</span> :
                                                <span className="text-gray-400 font-medium text-xs">No</span>
                                            }
                                        </td>
                                    )}
                                    <td className="whitespace-nowrap px-3 py-2 text-center">
                                        {permission === 'edit' ? (
                                            <input
                                                type="checkbox"
                                                className="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 cursor-pointer accent-green-600"
                                                checked={project.status === 'Active'}
                                                onChange={() => handleToggleStatus(project.id, project.status)}
                                            />
                                        ) : (
                                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded ${project.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                {project.status}
                                            </span>
                                        )}
                                    </td>
                                    {permission === 'edit' && (
                                        <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                                            <button
                                                onClick={() => setDashboardProject(project.projectNumber)}
                                                className="text-indigo-600 hover:text-indigo-900 mr-4"
                                                title="View Financials"
                                            >
                                                <PresentationChartLineIcon className="h-5 w-5" />
                                            </button>

                                            <button onClick={() => handleEdit(project)} className="text-orange-600 hover:text-orange-900 mr-4"><PencilIcon className="h-5 w-5" /></button>
                                            <button onClick={() => handleDelete(project.id)} className="text-gray-400 hover:text-red-600"><TrashIcon className="h-5 w-5" /></button>
                                        </td>
                                    )}
                                </tr>
                            ))
                        ) : (
                            <tr><td colSpan={permission === 'edit' ? 6 : 4} className="whitespace-nowrap px-3 py-4 text-base text-gray-500 text-center">No projects found.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal for Add/Edit */}
            <Modal show={showModal} onClose={() => setShowModal(false)} title={isEditing ? "Edit Project" : "Add New Project"} maxWidth="sm:max-w-4xl">
                {currentProject && (
                    <form onSubmit={handleSave} className="flex flex-col max-h-[75vh]">
                        {/* --- SCROLLABLE BODY --- */}
                        <div className="flex-1 overflow-y-auto pr-2 pb-2 space-y-6">
                            <div className="grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Project Number</label>
                                    <input type="text" name="projectNumber" value={currentProject.projectNumber} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm bg-gray-100" required disabled />
                                </div>

                                {/* CLIENT SELECTION WITH HISTORY */}
                                <div className="sm:col-span-2 border-t border-gray-100 pt-2 mt-2 bg-gray-50 p-3 rounded-md">
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center">
                                            Current Client
                                        </label>
                                        <div className="flex items-center text-xs group relative">
                                            <ClockIcon className="h-4 w-4 text-gray-400 mr-1 cursor-help" />
                                            <label className="mr-2 text-gray-500">Effective From:</label>
                                            <input
                                                type="date"
                                                name="clientActiveFrom"
                                                value={currentProject.clientActiveFrom}
                                                onChange={handleInputChange}
                                                className="p-1 border border-gray-300 rounded text-gray-700 focus:ring-orange-500"
                                                required
                                            />
                                            {/* Tooltip for Date logic */}
                                            <div className="hidden group-hover:block absolute right-0 top-full mt-1 w-64 p-2 bg-gray-800 text-white text-[10px] rounded shadow-lg z-50">
                                                If you change the client, the previous client will be archived using the day before this date as their end date.
                                            </div>
                                        </div>
                                    </div>

                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={clientSearchTerm}
                                            onChange={(e) => {
                                                setClientSearchTerm(e.target.value);
                                                setShowClientDropdown(true);
                                                if (e.target.value === '') {
                                                    setCurrentProject(prev => ({ ...prev, clientNumber: '' }));
                                                }
                                            }}
                                            onFocus={(e) => {
                                                setShowClientDropdown(true);
                                                e.target.select();
                                            }}
                                            onBlur={() => setTimeout(() => setShowClientDropdown(false), 200)}
                                            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm pr-10"
                                            placeholder="Search Client Name or Number..."
                                            autoComplete="off"
                                            required
                                        />
                                        <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                                            <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                                        </div>

                                        {showClientDropdown && (
                                            <ul className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                                                {filteredClientsForSelection.length > 0 ? (
                                                    filteredClientsForSelection.map((client) => (
                                                        <li
                                                            key={client.id}
                                                            className="relative cursor-pointer select-none py-2 pl-3 pr-9 hover:bg-orange-100 text-gray-900"
                                                            onClick={() => selectClient(client)}
                                                        >
                                                            <span className="block truncate">
                                                                {getClientDisplay(client)}
                                                            </span>
                                                        </li>
                                                    ))
                                                ) : (
                                                    <li className="relative cursor-default select-none py-2 pl-3 pr-9 text-gray-500">
                                                        No clients found.
                                                    </li>
                                                )}
                                            </ul>
                                        )}
                                    </div>

                                    {/* Client History List */}
                                    {currentProject.clientHistory && currentProject.clientHistory.length > 0 && (
                                        <div className="mt-3 border-t border-gray-200 pt-2">
                                            <p className="text-[10px] font-bold text-gray-400 mb-1 flex items-center uppercase tracking-wider">Client History</p>
                                            <div className="max-h-24 overflow-y-auto space-y-1 custom-scrollbar">
                                                {currentProject.clientHistory.slice().reverse().map((historyItem, idx) => {
                                                    const histClient = clientMap[historyItem.clientNumber];
                                                    const displayName = histClient ? (histClient.companyName || `${histClient.name} ${histClient.surname}`.trim()) : `Client No. ${historyItem.clientNumber}`;

                                                    return (
                                                        <div key={idx} className="text-xs text-gray-600 bg-white p-1.5 rounded border border-gray-100 flex justify-between items-center">
                                                            <span className="font-medium truncate mr-2" title={displayName}>{displayName}</span>
                                                            <span className="text-gray-400 text-[9px] shrink-0 font-mono">
                                                                {historyItem.startDate || '?'} &rarr; {historyItem.endDate}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700">Project Description</label>
                                    <input type="text" name="projectDescription" value={currentProject.projectDescription} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500" required />
                                </div>

                                {/* Project Type Selection */}
                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 flex items-center gap-1">
                                        <TagIcon className="h-4 w-4" /> Project Type
                                    </label>
                                    <select
                                        name="projectType"
                                        value={currentProject.projectType || 'standard'}
                                        onChange={handleInputChange}
                                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm"
                                    >
                                        <option value="standard">Standard Project (e.g. 1234)</option>
                                        <option value="misc">Miscellaneous (e.g. 0999 - Requires 4-part code)</option>
                                        <option value="internal">Internal / Non-Billable (e.g. 2000)</option>
                                    </select>
                                    <p className="text-[10px] text-gray-500 mt-1">
                                        Determines validation rules and reporting logic.
                                    </p>
                                </div>

                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700">Site Address</label>
                                    <input type="text" name="siteAddress" value={currentProject.siteAddress} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Site Locality</label>
                                    <input type="text" name="siteLocality" value={currentProject.siteLocality} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Site Post Code</label>
                                    <input type="text" name="sitePostCode" value={currentProject.sitePostCode} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Site Country</label>
                                    <input type="text" name="siteCountry" value={currentProject.siteCountry} onChange={handleInputChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500" />
                                </div>
                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Settings</label>
                                    <div className="space-y-3">
                                        <div className="flex items-center">
                                            <input type="checkbox" name="isBillable" id="isBillableCheck" checked={currentProject.isBillable !== false} onChange={handleInputChange} className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
                                            <label htmlFor="isBillableCheck" className="ml-2 block text-sm text-gray-900 cursor-pointer">Billable Project</label>
                                        </div>
                                        <div className="flex items-center">
                                            <input type="checkbox" name="statusToggle" id="statusToggleCheck" checked={currentProject.status === 'Active'} onChange={handleInputChange} className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
                                            <label htmlFor="statusToggleCheck" className="ml-2 block text-sm text-gray-900 cursor-pointer">Active Status</label>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* --- FEE BREAKDOWN --- */}
                            <div className="px-6 py-4 bg-gray-50 border border-gray-200 shadow-inner rounded-md">
                                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 border-b pb-1">Fee Breakdown (Total must equal 1.0)</h4>
                                <div className="grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-2">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Architecture</label>
                                        <input
                                            type="text"
                                            name="architecture"
                                            value={currentProject.architecture}
                                            onChange={handleInputChange}
                                            onBlur={handleFeeBlur}
                                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Structure</label>
                                        <input
                                            type="text"
                                            name="structure"
                                            value={currentProject.structure}
                                            onChange={handleInputChange}
                                            onBlur={handleFeeBlur}
                                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Cost</label>
                                        <input
                                            type="text"
                                            name="cost"
                                            value={currentProject.cost}
                                            onChange={handleInputChange}
                                            onBlur={handleFeeBlur}
                                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">PM</label>
                                        <input
                                            type="text"
                                            name="pm"
                                            value={currentProject.pm}
                                            onChange={handleInputChange}
                                            onBlur={handleFeeBlur}
                                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm"
                                            required
                                        />
                                    </div>
                                    <div className="sm:col-span-2 text-right pt-2 border-t border-gray-200">
                                        <span className={`text-base font-bold ${Math.abs(feeTotal - 1.0) < 0.0001 ? 'text-green-600' : 'text-red-600'}`}>
                                            Total: {feeTotal.toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* --- FIXED FOOTER --- */}
                        <div className="flex-none pt-4 mt-2 bg-white border-t border-gray-200 z-10">
                            <div className="flex justify-end">
                                <button type="button" onClick={() => setShowModal(false)} className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500">Cancel</button>
                                <button type="submit" disabled={Math.abs(feeTotal - 1.0) >= 0.0001} className="ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500">{isEditing ? "Save Changes" : "Save Project"}</button>
                            </div>
                        </div>
                    </form>
                )}
            </Modal>

            {/* Financial Dashboard Modal */}
            {dashboardProject && (
                <ProjectCostAuditModal
                    show={true}
                    onClose={() => setDashboardProject(null)}
                    projectNumber={dashboardProject}
                />
            )}
        </div>
    );
};
export default Projects;