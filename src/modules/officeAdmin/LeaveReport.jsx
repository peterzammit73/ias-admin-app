// File Path: src/modules/officeAdmin/LeaveReport.jsx
import React, { useState, useRef, useMemo } from 'react';
import Modal from '../../components/Modal.jsx';
import { DocumentArrowDownIcon, PrinterIcon, MagnifyingGlassIcon } from '@heroicons/react/24/solid';

const LeaveReport = ({ show, onClose, employees, year }) => {
    const [selectedEmployees, setSelectedEmployees] = useState(new Set());
    const [searchTerm, setSearchTerm] = useState('');
    const printRef = useRef(null);

    // If no employees selected, treat as "All"
    const employeesToReport = useMemo(() => {
        if (selectedEmployees.size === 0) return employees;
        return employees.filter(e => selectedEmployees.has(e.id));
    }, [employees, selectedEmployees]);

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            setSelectedEmployees(new Set(employees.map(e => e.id)));
        } else {
            setSelectedEmployees(new Set());
        }
    };

    const handleSelectEmployee = (id) => {
        const newSet = new Set(selectedEmployees);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedEmployees(newSet);
    };

    const generateCSV = () => {
        let csvContent = "data:text/csv;charset=utf-8,";
        
        // Header Info
        csvContent += `Annual Leave Report - iAS\n`;
        csvContent += `Generated Date,${new Date().toLocaleDateString()}\n`;
        csvContent += `Reporting Year,${year}\n\n`;
        
        // UPDATED Column Order: Entitlement -> Shutdown -> Taken -> Balance -> Sick
        csvContent += "Employee Number,Name,Surname,Entitlement,Shutdown Days,Vacation Taken,Balance Remaining,Sick Leave Taken,Vacation Dates,Sick Dates\n";

        employeesToReport.forEach(emp => {
            const vacDates = (emp.details?.vacation || []).join('; ');
            const sickDates = (emp.details?.sick || []).join('; ');
            const escape = (text) => `"${String(text).replace(/"/g, '""')}"`;

            const row = [
                emp.employeeNumber || '',
                escape(emp.name),
                escape(emp.surname),
                emp.entitlement,       // 1. Entitlement
                emp.effectiveShutdowns,// 2. Shutdown
                emp.taken,             // 3. Taken
                emp.remainingLeave,    // 4. Balance
                emp.sickLeaveTaken,    // 5. Sick
                escape(vacDates),
                escape(sickDates)
            ].join(",");
            csvContent += row + "\n";
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Leave_Report_${year}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handlePrint = () => {
        const printContent = printRef.current.innerHTML;
        const printWindow = window.open('', '', 'height=600,width=900');
        
        printWindow.document.write('<html><head><title>Annual Leave Report</title>');
        printWindow.document.write('<script src="https://cdn.tailwindcss.com"></script>');
        printWindow.document.write('</head><body class="p-8 text-gray-800 bg-white">'); // Ensure white background
        printWindow.document.write(printContent);
        printWindow.document.write('</body></html>');
        printWindow.document.close();
        
        setTimeout(() => {
            printWindow.focus();
            printWindow.print();
        }, 500);
    };

    if (!show) return null;

    const filteredList = employees.filter(emp => 
        (emp.name + ' ' + emp.surname).toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <Modal show={show} onClose={onClose} title={`Generate Annual Leave Report (${year})`} maxWidth="sm:max-w-6xl">
            <div className="space-y-6">
                
                {/* --- SELECTION UI --- */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* Sidebar: Employee Selector */}
                    <div className="lg:col-span-1 border-r pr-4 flex flex-col h-[400px]">
                        <h4 className="font-bold text-gray-700 mb-2">Select Employees</h4>
                        <div className="relative mb-2">
                             <MagnifyingGlassIcon className="h-4 w-4 absolute left-2 top-2.5 text-gray-400"/>
                             <input 
                                type="text" 
                                placeholder="Search..." 
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="w-full pl-8 py-1.5 text-sm border rounded"
                             />
                        </div>
                        <div className="flex items-center mb-2 pb-2 border-b">
                            <input 
                                type="checkbox" 
                                checked={selectedEmployees.size === employees.length && employees.length > 0}
                                onChange={handleSelectAll}
                                className="mr-2"
                            />
                            <span className="text-sm text-gray-600">Select All</span>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {filteredList.map(emp => (
                                <div key={emp.id} className="flex items-center py-1 hover:bg-gray-50">
                                    <input 
                                        type="checkbox" 
                                        checked={selectedEmployees.has(emp.id)}
                                        onChange={() => handleSelectEmployee(emp.id)}
                                        className="mr-2"
                                    />
                                    <span className="text-sm truncate" title={`${emp.surname} ${emp.name}`}>
                                        {emp.surname}, {emp.name}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <div className="text-xs text-gray-400 mt-2">
                            {selectedEmployees.size === 0 ? "Reporting ALL (Default)" : `Selected: ${selectedEmployees.size}`}
                        </div>
                    </div>

                    {/* Main: Preview Area */}
                    <div className="lg:col-span-3">
                        <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mb-4 flex justify-between items-center">
                            <div>
                                <h4 className="font-bold text-blue-900 text-sm">Previewing {employeesToReport.length} Records</h4>
                                <p className="text-xs text-blue-800">
                                    Report for year <strong>{year}</strong>. Includes active & resigned staff.
                                </p>
                            </div>
                        </div>

                        {/* Hidden Print Source (UPDATED LAYOUT) */}
                        <div className="hidden">
                            <div ref={printRef} className="font-sans text-xs">
                                <div className="flex justify-between items-end border-b-2 border-orange-500 pb-4 mb-6">
                                    <div className="flex items-center">
                                        <img src="/ias-logo.jpg" alt="iAS" className="h-12 w-auto mr-4" />
                                        <div>
                                            <h1 className="text-2xl font-bold text-gray-900">Annual Leave Report</h1>
                                            <p className="text-sm text-gray-500">Innovative Architectural Structures</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p><strong>Date:</strong> {new Date().toLocaleDateString()}</p>
                                        <p><strong>Period:</strong> Jan 1 - Dec 31, {year}</p>
                                    </div>
                                </div>

                                {/* Clean Table - No Gridlines, Alternate Colors */}
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b-2 border-gray-300 text-gray-700 uppercase tracking-wide text-[10px]">
                                            <th className="py-2 pl-2">ID</th>
                                            <th className="py-2">Employee</th>
                                            {/* UPDATED HEADER ORDER */}
                                            <th className="py-2 text-center">Entitl.</th>
                                            <th className="py-2 text-center text-orange-600">Shut.</th>
                                            <th className="py-2 text-center">Taken</th>
                                            <th className="py-2 text-center font-bold">Bal.</th>
                                            <th className="py-2 text-center text-gray-500">Sick</th>
                                            <th className="py-2 pl-4">Details</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {employeesToReport.map((emp, i) => (
                                            <tr key={emp.id} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-100'} border-b border-gray-100`}>
                                                <td className="py-2 pl-2 font-mono text-gray-500">{emp.employeeNumber}</td>
                                                <td className="py-2 font-bold text-gray-800">{emp.surname}, {emp.name}</td>
                                                
                                                {/* UPDATED COLUMN ORDER */}
                                                <td className="py-2 text-center">{emp.entitlement}</td>
                                                <td className="py-2 text-center text-orange-600 font-medium">{emp.effectiveShutdowns}</td>
                                                <td className="py-2 text-center">{emp.taken}</td>
                                                <td className={`py-2 text-center font-bold text-sm ${emp.remainingLeave < 0 ? 'text-red-600' : 'text-green-700'}`}>
                                                    {emp.remainingLeave}
                                                </td>
                                                <td className="py-2 text-center text-gray-500">{emp.sickLeaveTaken}</td>
                                                
                                                <td className="py-2 pl-4 text-[9px] leading-tight text-gray-600 max-w-xs">
                                                    {emp.details?.vacation?.length > 0 && (
                                                        <div className="mb-0.5">
                                                            <span className="font-bold text-green-700">Vac:</span> {emp.details.vacation.join(', ')}
                                                        </div>
                                                    )}
                                                    {emp.details?.sick?.length > 0 && (
                                                        <div>
                                                            <span className="font-bold text-pink-700">Sick:</span> {emp.details.sick.join(', ')}
                                                        </div>
                                                    )}
                                                    {(!emp.details?.vacation?.length && !emp.details?.sick?.length) && 
                                                        <span className="text-gray-300 italic">-</span>
                                                    }
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div className="mt-8 text-[10px] text-gray-400 text-center border-t pt-4">
                                    Report generated automatically by the iAS Office Management System.
                                </div>
                            </div>
                        </div>

                        {/* Visible Preview Table (Matching Order) */}
                        <div className="bg-white border rounded-md overflow-hidden shadow-inner max-h-[350px] overflow-y-auto">
                            <table className="min-w-full text-xs text-left">
                                <thead className="bg-gray-100 font-medium text-gray-600 sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="p-3">Employee</th>
                                        <th className="p-3 text-right">Ent.</th>
                                        <th className="p-3 text-right text-orange-600">Shut.</th>
                                        <th className="p-3 text-right">Taken</th>
                                        <th className="p-3 text-right font-bold">Bal.</th>
                                        <th className="p-3 text-right text-gray-500">Sick</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                     {employeesToReport.map((emp, i) => (
                                        <tr key={emp.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                            <td className="p-3 font-medium text-gray-900">{emp.surname}, {emp.name}</td>
                                            <td className="p-3 text-right text-gray-600">{emp.entitlement}</td>
                                            <td className="p-3 text-right text-orange-600">{emp.effectiveShutdowns}</td>
                                            <td className="p-3 text-right text-gray-600">{emp.taken}</td>
                                            <td className={`p-3 text-right font-bold ${emp.remainingLeave < 0 ? 'text-red-600' : 'text-green-700'}`}>
                                                {emp.remainingLeave}
                                            </td>
                                            <td className="p-3 text-right text-gray-400">{emp.sickLeaveTaken}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-gray-200">
                    <button onClick={onClose} className="w-full sm:w-auto px-4 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                    <button onClick={handlePrint} className="flex items-center justify-center w-full sm:w-auto px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                        <PrinterIcon className="h-5 w-5 mr-2 text-gray-500"/> Print PDF
                    </button>
                    <button onClick={generateCSV} className="flex items-center justify-center w-full sm:w-auto px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500">
                        <DocumentArrowDownIcon className="h-5 w-5 mr-2 text-white"/> Download CSV
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default LeaveReport;