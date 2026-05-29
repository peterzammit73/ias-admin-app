// File location: src/modules/officeAdmin/TimesheetMasks.jsx
import React, { useState, useEffect } from 'react';
import { db } from '../../firebase.js';
import { collection, onSnapshot, addDoc, doc, getDocs, writeBatch, updateDoc, deleteDoc } from 'firebase/firestore';
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import Modal from '../../components/Modal.jsx';

const TimesheetMasks = ({ permission }) => {
    const [departments, setDepartments] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [selectedDeptId, setSelectedDeptId] = useState(null);
    const [loading, setLoading] = useState({ depts: true, tasks: false });

    const [newDeptName, setNewDeptName] = useState('');
    const [newDeptCode, setNewDeptCode] = useState('');
    const [newTaskName, setNewTaskName] = useState('');
    const [newTaskCode, setNewTaskCode] = useState('');

    const [showModal, setShowModal] = useState(false);
    const [modalContent, setModalContent] = useState({ type: '', data: {} });

    useEffect(() => {
        setLoading(prev => ({ ...prev, depts: true }));
        const unsubscribe = onSnapshot(collection(db, 'timesheet_departments'), snapshot => {
            const deptsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setDepartments(deptsData.sort((a, b) => a.name.localeCompare(b.name)));
            setLoading(prev => ({ ...prev, depts: false }));
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (selectedDeptId) {
            setLoading(prev => ({ ...prev, tasks: true }));
            const tasksColRef = collection(db, 'timesheet_departments', selectedDeptId, 'tasks');
            const unsubscribe = onSnapshot(tasksColRef, snapshot => {
                const tasksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setTasks(tasksData.sort((a, b) => a.name.localeCompare(b.name)));
                setLoading(prev => ({ ...prev, tasks: false }));
            });
            return () => unsubscribe();
        } else {
            setTasks([]);
        }
    }, [selectedDeptId]);

    const handleAddDepartment = async (e) => {
        e.preventDefault();
        if (permission !== 'edit') return;
        if (!newDeptName.trim() || !newDeptCode.trim()) return;
        await addDoc(collection(db, 'timesheet_departments'), {
            name: newDeptName.trim(),
            code: newDeptCode.trim().toUpperCase(),
        });
        setNewDeptName('');
        setNewDeptCode('');
    };

    const handleAddTask = async (e) => {
        e.preventDefault();
        if (permission !== 'edit') return;
        if (!newTaskName.trim() || !newTaskCode.trim() || !selectedDeptId) return;
        const tasksColRef = collection(db, 'timesheet_departments', selectedDeptId, 'tasks');
        await addDoc(tasksColRef, {
            name: newTaskName.trim(),
            code: newTaskCode.trim().toUpperCase(),
        });
        setNewTaskName('');
        setNewTaskCode('');
    };

    const openEditModal = (type, data) => {
        if (permission !== 'edit') return;
        setModalContent({ type, data });
        setShowModal(true);
    };

    const handleUpdate = async (e) => {
        e.preventDefault();
        if (permission !== 'edit') return;
        const { type, data } = modalContent;
        const { id, name, code } = data;

        if (type === 'department') {
            const deptRef = doc(db, 'timesheet_departments', id);
            await updateDoc(deptRef, { name, code: code.toUpperCase() });
        } else if (type === 'task') {
            const taskRef = doc(db, 'timesheet_departments', selectedDeptId, 'tasks', id);
            await updateDoc(taskRef, { name, code: code.toUpperCase() });
        }
        setShowModal(false);
    };
    
    const handleDelete = async (type, id) => {
        if (permission !== 'edit') return;
        if (window.confirm(`Are you sure you want to delete this ${type}? This action cannot be undone.`)) {
            if (type === 'department') {
                const deptRef = doc(db, 'timesheet_departments', id);
                const tasksColRef = collection(deptRef, 'tasks');
                const tasksSnapshot = await getDocs(tasksColRef);
                const batch = writeBatch(db);
                tasksSnapshot.forEach(doc => batch.delete(doc.ref));
                batch.delete(deptRef);
                await batch.commit();
                if (id === selectedDeptId) setSelectedDeptId(null);
            } else if (type === 'task') {
                const taskRef = doc(db, 'timesheet_departments', selectedDeptId, 'tasks', id);
                await deleteDoc(taskRef);
            }
        }
    };
    
    const selectedDept = departments.find(d => d.id === selectedDeptId);

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Departments Column */}
                <div className="flex flex-col border border-gray-200 rounded-lg">
                    <div className="p-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                        <h3 className="text-lg font-semibold text-gray-800">Departments</h3>
                    </div>
                    {permission === 'edit' && (
                        <form onSubmit={handleAddDepartment} className="p-4 flex gap-2 border-b border-gray-200">
                            <input type="text" placeholder="Department Name" value={newDeptName} onChange={e => setNewDeptName(e.target.value)} required className="flex-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm" />
                            <input type="text" placeholder="Code" value={newDeptCode} onChange={e => setNewDeptCode(e.target.value)} maxLength="1" required className="block w-20 rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm" />
                            <button type="submit" className="p-2 bg-orange-600 text-white rounded-md hover:bg-orange-700"><PlusIcon className="h-5 w-5" /></button>
                        </form>
                    )}
                    <div className="flex-1 overflow-y-auto">
                        {loading.depts ? <p className="p-4 text-center text-gray-500">Loading...</p> : departments.map(dept => (
                            <div key={dept.id} className={`flex justify-between items-center p-4 cursor-pointer hover:bg-orange-50 ${selectedDeptId === dept.id ? 'bg-orange-100' : ''}`} onClick={() => setSelectedDeptId(dept.id)}>
                                <div>
                                    <span className="font-medium text-gray-800">{dept.name}</span>
                                    <span className="ml-2 text-sm text-gray-500 font-mono bg-gray-200 px-2 py-0.5 rounded">{dept.code}</span>
                                </div>
                                {permission === 'edit' && (
                                    <div className="flex items-center gap-2">
                                        <button className="text-gray-400 hover:text-orange-600" onClick={(e) => { e.stopPropagation(); openEditModal('department', dept); }}><PencilIcon className="h-5 w-5" /></button>
                                        <button className="text-gray-400 hover:text-red-600" onClick={(e) => { e.stopPropagation(); handleDelete('department', dept.id); }}><TrashIcon className="h-5 w-5" /></button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Tasks Column */}
                <div className="flex flex-col border border-gray-200 rounded-lg">
                    <div className="p-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                        <h3 className="text-lg font-semibold text-gray-800">{selectedDept ? `Tasks for ${selectedDept.name}` : 'Select a Department'}</h3>
                    </div>
                    {selectedDeptId ? (
                        <>
                             {permission === 'edit' && (
                                 <form onSubmit={handleAddTask} className="p-4 flex gap-2 border-b border-gray-200">
                                    <input type="text" placeholder="New Task Name" value={newTaskName} onChange={e => setNewTaskName(e.target.value)} required className="flex-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm" />
                                    <input type="text" placeholder="Code" value={newTaskCode} onChange={e => setNewTaskCode(e.target.value)} maxLength="4" required className="block w-24 rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm" />
                                    <button type="submit" className="p-2 bg-orange-600 text-white rounded-md hover:bg-orange-700"><PlusIcon className="h-5 w-5" /></button>
                                </form>
                             )}
                            <div className="flex-1 overflow-y-auto">
                                {loading.tasks ? <p className="p-4 text-center text-gray-500">Loading tasks...</p> : tasks.length > 0 ? tasks.map(task => (
                                    <div key={task.id} className="flex justify-between items-center p-4 hover:bg-gray-50">
                                        <div>
                                            <span className="font-medium text-gray-800">{task.name}</span>
                                            <span className="ml-2 text-sm text-gray-500 font-mono bg-gray-200 px-2 py-0.5 rounded">{task.code}</span>
                                        </div>
                                        {permission === 'edit' && (
                                            <div className="flex items-center gap-2">
                                                <button className="text-gray-400 hover:text-orange-600" onClick={() => openEditModal('task', task)}><PencilIcon className="h-5 w-5" /></button>
                                                <button className="text-gray-400 hover:text-red-600" onClick={() => handleDelete('task', task.id)}><TrashIcon className="h-5 w-5" /></button>
                                            </div>
                                        )}
                                    </div>
                                )) : <p className="p-4 text-center text-gray-500">No tasks found for this department.</p>}
                            </div>
                        </>
                    ) : (
                        <div className="flex items-center justify-center h-full">
                            <p className="text-gray-500 p-8 text-center">Please select a department from the left to view and manage its tasks.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Edit Modal */}
            <Modal show={showModal} onClose={() => setShowModal(false)} title={`Edit ${modalContent.type}`}>
                <form onSubmit={handleUpdate}>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Name</label>
                            <input type="text" value={modalContent.data.name || ''} 
                                   onChange={e => setModalContent(prev => ({ ...prev, data: { ...prev.data, name: e.target.value } }))} 
                                   className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm" required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Code</label>
                            <input type="text" value={modalContent.data.code || ''}
                                   onChange={e => setModalContent(prev => ({ ...prev, data: { ...prev.data, code: e.target.value } }))}
                                   maxLength={modalContent.type === 'department' ? 1 : 4}
                                   className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm" required />
                        </div>
                    </div>
                    <div className="flex justify-end pt-6 border-t border-gray-200 mt-6">
                        <button type="button" onClick={() => setShowModal(false)} className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500">Cancel</button>
                        <button type="submit" className="ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500">Save Changes</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default TimesheetMasks;