// Root: src/modules/billing/Billing.jsx
// Version: 6.70 - Standardized Absolute Paths & Corrected Tab Routing
import React from 'react';
import Invoices from '/src/modules/billing/Invoices.jsx';
import ProjectCosts from '/src/modules/billing/ProjectCosts.jsx';
import ClientStatements from '/src/modules/billing/ClientStatements.jsx';
import WorkInProgress from '/src/modules/billing/WorkInProgress.jsx';

/**
 * Main Billing router component.
 * Directs traffic between the different functional areas of the Billing module.
 * * "Unbilled Time" tab -> WorkInProgress.jsx (Ported logic from v6.22)
 * "RFP Management" tab -> Invoices.jsx (The RFP Monitor/Ledger)
 */
const App = ({ view }) => {
    // Determine which sub-module to display based on the 'view' prop passed from the main Portal
    switch (view) {
        case 'unbilled':
        case 'wip':
            // Logic for the Unbilled Time module (Work in Progress)
            return <WorkInProgress />;

        case 'rfps':
        case 'invoices':
            // Logic for the RFP Monitor / RFP Management Ledger
            return <Invoices />;

        case 'costs':
            return <ProjectCosts />;

        case 'statements':
            return <ClientStatements />;

        default:
            // Fallback default view
            return <WorkInProgress />;
    }
};

export default App;