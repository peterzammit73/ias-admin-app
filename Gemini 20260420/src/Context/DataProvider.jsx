import React, { createContext, useContext, useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase.js';

const DataContext = createContext();

export const useData = () => useContext(DataContext);

export const DataProvider = ({ children }) => {
    const [employees, setEmployees] = useState([]);
    const [projects, setProjects] = useState([]);
    const [clients, setClients] = useState([]);
    const [settings, setSettings] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        const unsubs = [];

        // 1. Employees
        const qEmp = query(collection(db, 'employees'), orderBy('surname', 'asc'));
        unsubs.push(onSnapshot(qEmp, (snap) => {
            setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }));

        // 2. Projects
        const qProj = query(collection(db, 'projects')); // Ordering handled client-side usually due to numbers
        unsubs.push(onSnapshot(qProj, (snap) => {
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            list.sort((a, b) => (parseInt(a.projectNumber) || 0) - (parseInt(b.projectNumber) || 0));
            setProjects(list);
        }));

        // 3. Clients
        const qCli = query(collection(db, 'clients'));
        unsubs.push(onSnapshot(qCli, (snap) => {
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            list.sort((a, b) => a.name.localeCompare(b.name));
            setClients(list);
        }));

        // 4. Global Settings (General Company Settings)
        unsubs.push(onSnapshot(collection(db, 'settings'), (snap) => {
            const settingsObj = {};
            snap.forEach(doc => {
                settingsObj[doc.id] = doc.data();
            });
            setSettings(settingsObj);
            setLoading(false); // Assume ready after first batch
        }));

        return () => {
            unsubs.forEach(unsub => unsub());
        };
    }, []);

    // Derived Data Helpers
    const getProject = (number) => projects.find(p => String(p.projectNumber) === String(number));
    const getClient = (number) => clients.find(c => String(c.clientNumber) === String(number));
    const getEmployee = (id) => employees.find(e => e.id === id);

    const value = {
        employees,
        projects,
        clients,
        settings,
        loading,
        helpers: {
            getProject,
            getClient,
            getEmployee
        }
    };

    return (
        <DataContext.Provider value={value}>
            {children}
        </DataContext.Provider>
    );
};