// Root: functions/billing.js
// Version: 16.15 - Fixed Item Breakdown & Time ID Mapping for RFPs
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { db } = require("./config");
const {
    calculateHourlyRateForDate,
    getApplicableSalaryRecord,
    calculateAnnualTotalCost,
    safePercent,
    isEmployeeActiveInPeriod,
    parseDateUTC
} = require("./financialUtils");

// Helper: Round Up to 2 Decimals (Money Safe)
const roundUp = (num) => Math.ceil(num * 100) / 100;

/**
 * Helper: Internal Audit Logger
 */
const logActivity = async (context, action, projectNumber, details, category = 'FINANCIAL') => {
    const appId = "ias-production";
    try {
        await db.collection('artifacts').doc(appId).collection('public').doc('data').collection('activity_logs').add({
            timestamp: admin.firestore.Timestamp.now(),
            userId: context.auth ? context.auth.uid : 'system',
            userEmail: context.auth ? (context.auth.token.email || 'System User') : 'System',
            action: action,
            projectNumber: String(projectNumber || 'N/A'),
            details: details,
            category: category
        });
    } catch (e) {
        console.error("Critical: Audit Log Failure:", e);
    }
};

/**
 * Helper: Mark Project as Dirty (Stale)
 */
const markProjectDirty = async (projectNumber) => {
    if (!projectNumber) return;
    try {
        await db.collection('settings').doc('wip_status').set({
            isStale: true,
            lastModification: admin.firestore.Timestamp.now(),
            modifiedProjects: admin.firestore.FieldValue.arrayUnion(String(projectNumber))
        }, { merge: true });
    } catch (e) {
        console.error("Failed to mark project dirty:", e);
    }
};

// ============================================================================
// 1. MANAGE RFP ISSUERS
// ============================================================================
exports.manageRFPIssuer = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

    const { action, issuer, issuerId, name } = data;
    const docRef = db.collection('settings').doc('rfp_issuers');
    const snap = await docRef.get();
    let issuersList = snap.exists ? (snap.data().issuers || []) : [];

    if (action === 'add') {
        const newIssuer = issuer || { id: name, name: name };
        issuersList = issuersList.filter(i => i.name !== newIssuer.name);
        issuersList.push(newIssuer);
        await logActivity(context, 'ISSUER_ADDED', 'SYSTEM', `Administrative: Added new RFP issuer '${newIssuer.name}'`, 'SYSTEM');
    }
    else if (action === 'remove') {
        const target = issuerId || name;
        issuersList = issuersList.filter(i => i.id !== target && i.name !== target);
        await logActivity(context, 'ISSUER_REMOVED', 'SYSTEM', `Administrative: Removed RFP issuer '${target}'`, 'SYSTEM');
    }

    await docRef.set({ issuers: issuersList, names: issuersList.map(i => i.name) }, { merge: true });
    return { status: 'success' };
});

// ============================================================================
// 1.1 MIGRATE LEGACY ISSUERS (ONE-TIME UTILITY)
// ============================================================================
exports.migrateLegacyIssuers = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

    const legacyNames = ["PZA", "SAI Ltd", "PSM Ltd", "iAS LTD"];
    const docRef = db.collection('settings').doc('rfp_issuers');

    try {
        const snap = await docRef.get();
        if (!snap.exists) return { status: 'no_data', message: 'Settings document not found.' };

        let issuersList = snap.data().issuers || [];
        let updatedCount = 0;

        const updatedList = issuersList.map(issuer => {
            const match = legacyNames.find(n => n.toLowerCase() === (issuer.name || '').toLowerCase());
            if (match) {
                if (!issuer.sequenceSuffix) {
                    updatedCount++;
                    return { ...issuer, sequenceSuffix: '/00' };
                }
            }
            return issuer;
        });

        if (updatedCount > 0) {
            await docRef.set({ issuers: updatedList }, { merge: true });
            await logActivity(context, 'ISSUER_MIGRATION', 'SYSTEM', `Migrated ${updatedCount} legacy issuers to use /00 suffix.`, 'SYSTEM');
        }

        return { status: 'success', updated: updatedCount };
    } catch (e) {
        console.error("Migration Failed:", e);
        throw new functions.https.HttpsError("internal", e.message || "Migration failed internally.");
    }
});

// ============================================================================
// 2. CREATE RFP (DRAFT)
// ============================================================================
exports.createRFP = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

    // EXPLICITLY CAPTURE BOTH items (breakdown) AND timeIds (linked timesheets)
    const { 
        projectNumber, recipient, description, recipientAddress, recipientVat, contactPerson,
        items, timeIds, costIds, writeOffCostIds, isIndependent, costManagementFees, 
        hiddenCostIds, feeVatApplicable 
    } = data;

    if (timeIds && timeIds.length > 0) {
        const checkIds = timeIds.slice(0, 10);
        const checkSnaps = await Promise.all(checkIds.map(id => db.collection('timesheet_entries').doc(id).get()));

        for (const snap of checkSnaps) {
            if (snap.exists && snap.data().billingStatus !== 'unbilled') {
                throw new functions.https.HttpsError(
                    "aborted",
                    "Data Conflict: Some selected items have already been billed. Please refresh your view."
                );
            }
        }
    }

    // --- BACKEND CALCULATION ENGINE ---
    let calcNet = 0;
    let calcVat = 0;

    const finalItems = (items || []).map(item => {
        const net = parseFloat(item.net) || 0;
        const vatRate = parseFloat(item.vatRate) || 0; 
        const vat = roundUp(net * vatRate);
        calcNet += net;
        calcVat += vat;
        return {
            description: item.description || '',
            net: net,
            vatRate: vatRate,
            vat: vat,
            total: roundUp(net + vat)
        };
    });

    const finalTotalAmount = roundUp(calcNet + calcVat);

    const rfpRef = db.collection('rfps').doc();
    const batch = db.batch();

    const rfpData = {
        projectNumber: String(projectNumber),
        projectName: description,
        recipient,
        recipientAddress: recipientAddress || '',
        recipientVat: recipientVat || '',
        contactPerson: contactPerson || null,
        amount: roundUp(calcNet),
        vatAmount: roundUp(calcVat),
        totalAmount: finalTotalAmount,
        outstandingBalance: finalTotalAmount,
        vatApplicable: calcVat > 0,
        description,
        status: 'Pending',
        createdAt: admin.firestore.Timestamp.now(),
        invoicedAmount: 0,
        creditedAmount: 0,
        isManual: !!isIndependent,
        linkedTimeIds: timeIds || [], 
        linkedCostIds: costIds || [],
        linkedManagementFees: costManagementFees || {},
        items: finalItems 
    };

    batch.set(rfpRef, rfpData);

    if (timeIds) timeIds.forEach(id => batch.update(db.collection('timesheet_entries').doc(id), { billingStatus: 'rfp_pending', rfpId: rfpRef.id }));

    if (costIds) {
        costIds.forEach(id => {
            const updates = { billingStatus: 'rfp_pending', rfpId: rfpRef.id };
            if (costManagementFees && costManagementFees[id] !== undefined) {
                updates.managementFeePercent = costManagementFees[id];
            }
            updates.isVisibleInRfp = !(hiddenCostIds && Array.isArray(hiddenCostIds) && hiddenCostIds.includes(id));
            batch.update(db.collection('project_costs').doc(id), updates);
        });
    }

    if (writeOffCostIds && Array.isArray(writeOffCostIds)) {
        writeOffCostIds.forEach(id => batch.update(db.collection('project_costs').doc(id), {
            billingStatus: 'non_chargeable',
            markedNonChargeableAt: admin.firestore.Timestamp.now(),
            markedNonChargeableBy: context.auth.token.email || 'user'
        }));
    }

    await logActivity(context, 'RFP_CREATED', projectNumber, `Draft RFP created for €${roundUp(calcNet).toLocaleString()} + VAT €${roundUp(calcVat).toLocaleString()}.`);
    await batch.commit();

    // Mark base project as dirty just in case it's a sub-project (0999-0001)
    const basePNum = String(projectNumber).startsWith('0999-') ? '0999' : projectNumber;
    await markProjectDirty(basePNum);
    if (basePNum !== projectNumber) await markProjectDirty(projectNumber);

    return { status: "success", data: { rfpId: rfpRef.id } };
});

// ============================================================================
// 3. ISSUE RFP
// ============================================================================
exports.issueRFP = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

    const { rfpId, issuer } = data;
    const rfpRef = db.collection('rfps').doc(rfpId);

    try {
        let finalCode;
        let pNum;

        await db.runTransaction(async (transaction) => {
            const rfpDoc = await transaction.get(rfpRef);
            if (!rfpDoc.exists) throw new Error("Target RFP document not found.");
            const rfpData = rfpDoc.data();

            if (rfpData.status !== 'Pending') throw new Error("RFP has already been issued.");

            pNum = rfpData.projectNumber;

            const issuerSettingsRef = db.collection('settings').doc('rfp_issuers');
            const issuerSettingsSnap = await transaction.get(issuerSettingsRef);
            let sequenceSuffix = '';

            if (issuerSettingsSnap.exists) {
                const issuers = issuerSettingsSnap.data().issuers || [];
                const matchedIssuer = issuers.find(i => i.name === issuer);
                if (matchedIssuer && matchedIssuer.sequenceSuffix) {
                    sequenceSuffix = matchedIssuer.sequenceSuffix;
                }
            }

            let counterIssuerName = issuer;
            if (sequenceSuffix && issuer.endsWith(sequenceSuffix)) {
                counterIssuerName = issuer.substring(0, issuer.length - sequenceSuffix.length);
            }

            const counterRef = db.collection('counters').doc(`rfp_${counterIssuerName}`);
            const counterSnap = await transaction.get(counterRef);
            const nextSeq = (counterSnap.exists ? (counterSnap.data().lastSequence || 0) : 0) + 1;

            const seqPart = String(nextSeq).padStart(4, '0');

            let formattedProject = String(rfpData.projectNumber);
            if (!formattedProject.includes('-')) formattedProject = formattedProject.padStart(4, '0');

            finalCode = `${seqPart}-${formattedProject}-${counterIssuerName}`;

            transaction.update(rfpRef, {
                status: 'Issued - Open',
                rfpCode: finalCode,
                rfpNumber: finalCode,
                issuer,
                issuedAt: admin.firestore.Timestamp.now(),
                outstandingBalance: rfpData.totalAmount
            });
            transaction.set(counterRef, { lastSequence: nextSeq }, { merge: true });
        });

        const rfpSnap = await rfpRef.get();
        const rfpData = rfpSnap.data();
        const batch = db.batch();
        let updateCount = 0;

        if (rfpData.linkedTimeIds && rfpData.linkedTimeIds.length > 0) {
            const timeDocs = await Promise.all(
                rfpData.linkedTimeIds.map(id => db.collection('timesheet_entries').doc(id).get())
            );

            timeDocs.forEach(docSnap => {
                if (docSnap.exists) {
                    batch.update(docSnap.ref, { billingStatus: 'billed', rfpCode: finalCode, billingMethod: 'rfp_issue' });
                    updateCount++;
                }
            });
        }

        if (rfpData.linkedCostIds && rfpData.linkedCostIds.length > 0) {
            const costDocs = await Promise.all(
                rfpData.linkedCostIds.map(id => db.collection('project_costs').doc(id).get())
            );

            costDocs.forEach(docSnap => {
                if (docSnap.exists) {
                    batch.update(docSnap.ref, { billingStatus: 'billed', rfpCode: finalCode, billingMethod: 'rfp_issue' });
                    updateCount++;
                }
            });
        }

        if (updateCount > 0) {
            await batch.commit();
        }

        await logActivity(context, 'RFP_ISSUED', pNum, `RFP successfully issued with serial reference: ${finalCode}`);

        const basePNum = String(pNum).startsWith('0999-') ? '0999' : pNum;
        await markProjectDirty(basePNum);

        return { status: "success", rfpCode: finalCode };
    } catch (e) {
        throw new functions.https.HttpsError("internal", e.message);
    }
});

// ============================================================================
// 4. MANAGE PAYMENT & LEDGER
// ============================================================================
exports.managePayment = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Authentication required.");

    const { action, rfpId, amount, date, releaseItems } = data;
    const rfpRef = db.collection('rfps').doc(rfpId);

    try {
        await db.runTransaction(async (transaction) => {
            const rfpDoc = await transaction.get(rfpRef);
            if (!rfpDoc.exists) throw new Error("RFP not found");
            const rfpData = rfpDoc.data();
            const timestamp = date ? admin.firestore.Timestamp.fromDate(new Date(date)) : admin.firestore.Timestamp.now();

            const gross = parseFloat(rfpData.totalAmount) || 0;
            const currentPaid = parseFloat(rfpData.invoicedAmount) || 0;
            const currentCredited = parseFloat(rfpData.creditedAmount) || 0;

            if (action === 'full_payment') {
                const currentDue = roundUp(gross - currentPaid - currentCredited);
                const newPaid = roundUp(currentPaid + currentDue);
                const invoiceKey = rfpData.rfpCode || `SETTLEMENT-${Date.now()}`;

                transaction.update(rfpRef, {
                    invoicedAmount: newPaid,
                    outstandingBalance: 0,
                    status: 'Paid',
                    paidAt: timestamp,
                    [`payments.${invoiceKey}`]: { amount: currentDue, date: timestamp, type: 'Final Balance' }
                });
                await logActivity(context, 'PAYMENT_FULL', rfpData.projectNumber, `Full settlement of €${currentDue.toLocaleString()} recorded for RFP ${rfpData.rfpCode}`);
            }
            else if (action === 'partial_payment') {
                const val = parseFloat(amount);
                const currentPayments = rfpData.payments || {};
                const partCount = Object.keys(currentPayments).length + 1;
                const invoiceKey = `${rfpData.rfpCode}-Part ${String(partCount).padStart(2, '0')}`;

                const newPaid = roundUp(currentPaid + val);
                const outstanding = roundUp(gross - newPaid - currentCredited);

                const updates = {
                    invoicedAmount: newPaid,
                    outstandingBalance: outstanding,
                    [`payments.${invoiceKey}`]: { amount: val, date: timestamp, type: 'Partial Payment' }
                };

                if (outstanding <= 0.01) {
                    updates.status = 'Paid';
                    updates.paidAt = timestamp;
                } else {
                    updates.status = 'Partial';
                }

                transaction.update(rfpRef, updates);
                await logActivity(context, 'PAYMENT_PARTIAL', rfpData.projectNumber, `Partial payment of €${val.toLocaleString()} recorded with reference: ${invoiceKey}`);
            }
            else if (action === 'partial_credit') {
                const val = parseFloat(amount);
                const issuerName = rfpData.issuer || 'iAS';
                const counterRef = db.collection('counters').doc(`cn_${issuerName}`);
                const counterSnap = await transaction.get(counterRef);
                const nextSeq = (counterSnap.exists ? (counterSnap.data().lastSequence || 0) : 0) + 1;
                const cnRef = `CN-${String(nextSeq).padStart(6, '0')}-${issuerName}`;
                transaction.set(counterRef, { lastSequence: nextSeq }, { merge: true });

                const newCredited = roundUp(currentCredited + val);
                const outstanding = roundUp(gross - currentPaid - newCredited);

                const updates = {
                    creditedAmount: newCredited,
                    outstandingBalance: outstanding,
                    [`credits.${cnRef}`]: { amount: val, date: timestamp, ref: cnRef }
                };

                if (outstanding <= 0.01) {
                    updates.status = 'Closed';
                }

                transaction.update(rfpRef, updates);

                if (releaseItems) {
                    if (rfpData.linkedTimeIds) {
                        rfpData.linkedTimeIds.forEach(id => transaction.update(db.collection('timesheet_entries').doc(id), { billingStatus: 'unbilled', rfpCode: null, rfpId: null }));
                    }
                    if (rfpData.linkedCostIds) {
                        rfpData.linkedCostIds.forEach(id => transaction.update(db.collection('project_costs').doc(id), { billingStatus: 'unbilled', rfpCode: null, rfpId: null }));
                    }
                    await logActivity(context, 'CREDIT_RELEASE', rfpData.projectNumber, `Issued Credit Note ${cnRef} (€${val.toLocaleString()}) and returned entries to WIP.`);
                    const basePNum = String(rfpData.projectNumber).startsWith('0999-') ? '0999' : rfpData.projectNumber;
                    await markProjectDirty(basePNum);
                } else {
                    await logActivity(context, 'CREDIT_NOTE', rfpData.projectNumber, `Issued Credit Note ${cnRef} (€${val.toLocaleString()}) for RFP ${rfpData.rfpCode}`);
                }
            }
            else if (action === 'issue_reminder') {
                const newCount = (rfpData.reminderCount || 0) + 1;
                const remRef = `${rfpData.rfpCode}-REM-${String(newCount).padStart(3, '0')}`;
                const outstanding = roundUp(gross - currentPaid - currentCredited);

                transaction.update(rfpRef, {
                    lastReminderSent: timestamp,
                    reminderCount: newCount,
                    outstandingBalance: outstanding,
                    [`reminders.${remRef}`]: { date: timestamp, amount: outstanding, ref: remRef, sequence: newCount }
                });
                await logActivity(context, 'REMINDER_SENT', rfpData.projectNumber, `Payment reminder #${newCount} issued.`);
            }
            else if (action === 'bad_debt') {
                transaction.update(rfpRef, { status: 'Bad Debt', writtenOffAt: timestamp, outstandingBalance: 0 });
                await logActivity(context, 'BAD_DEBT', rfpData.projectNumber, `RFP ${rfpData.rfpCode} was marked as BAD DEBT.`, 'SYSTEM');
            }
        });
        return { status: "success" };
    } catch (e) {
        throw new functions.https.HttpsError("internal", e.message);
    }
});

exports.cancelRFP = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");
    const { rfpId } = data;
    const rfpRef = db.collection('rfps').doc(rfpId);
    const rfpSnap = await rfpRef.get();
    if (!rfpSnap.exists) throw new Error("RFP not found");
    const rfpData = rfpSnap.data();
    const batch = db.batch();
    (rfpData.linkedTimeIds || []).forEach(id => batch.update(db.collection('timesheet_entries').doc(id), { billingStatus: 'unbilled', rfpId: null }));
    (rfpData.linkedCostIds || []).forEach(id => batch.update(db.collection('project_costs').doc(id), { billingStatus: 'unbilled', rfpId: null }));
    batch.delete(rfpRef);
    await logActivity(context, 'RFP_CANCELLED', rfpData.projectNumber, `Pending RFP was cancelled.`);
    await batch.commit();
    const basePNum = String(rfpData.projectNumber).startsWith('0999-') ? '0999' : rfpData.projectNumber;
    await markProjectDirty(basePNum);
    return { status: "success" };
});

exports.reviseRFP = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

    const { rfpId, description, projectName, recipient, recipientAddress, recipientVat, contactPerson, items } = data;
    const oldRfpRef = db.collection('rfps').doc(rfpId);
    const newRfpRef = db.collection('rfps').doc();

    try {
        await db.runTransaction(async (transaction) => {
            const oldSnap = await transaction.get(oldRfpRef);
            if (!oldSnap.exists) throw new Error("Original RFP not found.");
            const oldData = oldSnap.data();
            const currentCode = oldData.rfpCode || "";
            const match = currentCode.match(/-R(\d+)$/);
            const version = match ? parseInt(match[1]) + 1 : 1;
            const baseCode = currentCode.split('-R')[0];
            const newCode = `${baseCode}-R${version}`;

            // --- BACKEND CALCULATION ENGINE ---
            let calcNet = 0;
            let calcVat = 0;

            const finalItems = (items || []).map(item => {
                const net = parseFloat(item.net) || 0;
                const vatRate = parseFloat(item.vatRate) || 0;
                const vat = roundUp(net * vatRate);
                calcNet += net;
                calcVat += vat;
                return {
                    description: item.description || '',
                    net: net,
                    vatRate: vatRate,
                    vat: vat,
                    total: roundUp(net + vat)
                };
            });

            const finalTotalAmount = roundUp(calcNet + calcVat);

            transaction.update(oldRfpRef, { status: 'Superseded', supersededBy: newRfpRef.id, supersededAt: admin.firestore.Timestamp.now() });

            transaction.set(newRfpRef, {
                ...oldData,
                rfpCode: newCode, rfpNumber: newCode, 
                amount: roundUp(calcNet), 
                vatAmount: roundUp(calcVat), 
                totalAmount: finalTotalAmount,
                outstandingBalance: finalTotalAmount,
                vatApplicable: calcVat > 0,
                description: (description !== undefined) ? description : oldData.description,
                projectName: (projectName !== undefined) ? projectName : oldData.projectName,
                recipient: (recipient !== undefined) ? recipient : oldData.recipient,
                recipientAddress: (recipientAddress !== undefined) ? recipientAddress : oldData.recipientAddress,
                recipientVat: (recipientVat !== undefined) ? recipientVat : oldData.recipientVat,
                contactPerson: (contactPerson !== undefined) ? contactPerson : (oldData.contactPerson || null),
                items: finalItems.length > 0 ? finalItems : (oldData.items || []), 
                status: 'Issued - Open',
                createdAt: admin.firestore.Timestamp.now(), issuedAt: admin.firestore.Timestamp.now(),
                invoicedAmount: 0, creditedAmount: 0,
                previousVersionId: rfpId, revisionCount: version
            });
            await logActivity(context, 'RFP_REVISED', oldData.projectNumber, `RFP ${currentCode} revised to ${newCode}.`);
        });
        return { status: "success" };
    } catch (e) {
        throw new functions.https.HttpsError("internal", e.message);
    }
});

exports.bulkArchiveEntries = functions.runWith({ memory: '1GB', timeoutSeconds: 540 }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");
    const { projectNumber, cutoffDate } = data;

    let baseProject = String(projectNumber);
    let targetMiscCode = null;
    let dataVariations = [];

    if (baseProject.startsWith('0999-')) {
        targetMiscCode = baseProject.split('-')[1];
        baseProject = '0999';
        dataVariations = ['0999', 999, '999'];
    } else {
        const raw = String(baseProject).trim();
        const num = parseInt(raw, 10);
        const padded = raw.padStart(4, '0');
        dataVariations = Array.from(new Set([baseProject, raw, padded, num, String(num)])).filter(v => v !== undefined && v !== null && v !== "");
    }

    const limitDate = new Date(cutoffDate); limitDate.setHours(23, 59, 59, 999);

    try {
        const [timeSnap, costsSnap] = await Promise.all([
            db.collection('timesheet_entries').where('project', 'in', dataVariations).where('billingStatus', 'in', ['unbilled', 'rfp_pending']).get(),
            db.collection('project_costs').where('projectNumber', 'in', dataVariations).where('billingStatus', 'in', ['unbilled', 'rfp_pending']).get()
        ]);

        let batch = db.batch();
        let batchCount = 0;
        let totalArchived = 0;
        let skippedPending = 0;

        const commitBatch = async () => {
            if (batchCount > 0) {
                await batch.commit();
                totalArchived += batchCount;
                batch = db.batch();
                batchCount = 0;
            }
        };

        for (const doc of timeSnap.docs) {
            const d = doc.data();

            if (baseProject === '0999' && targetMiscCode !== null) {
                const match = (d.comment || '').match(/^\[([A-Z0-9]+)\]/i);
                const entryMiscCode = match ? match[1] : '0000';
                if (entryMiscCode !== targetMiscCode) continue;
            }

            if (d.billingStatus === 'rfp_pending') {
                skippedPending++;
                continue;
            }
            let entryDate = null;
            if (d.date && typeof d.date.toDate === 'function') entryDate = d.date.toDate();
            else if (d.startTime && typeof d.startTime.toDate === 'function') entryDate = d.startTime.toDate();
            else if (d.date) entryDate = new Date(d.date);

            if (entryDate && entryDate <= limitDate) {
                batch.update(doc.ref, {
                    billingStatus: 'billed',
                    billedAt: admin.firestore.Timestamp.now(),
                    billingMethod: 'bulk_archive_cleanup'
                });
                batchCount++;
                if (batchCount >= 400) await commitBatch();
            }
        }

        for (const doc of costsSnap.docs) {
            const d = doc.data();

            if (baseProject === '0999' && targetMiscCode !== null) {
                if (targetMiscCode !== '0000') continue;
            }

            if (d.billingStatus === 'rfp_pending') {
                skippedPending++;
                continue;
            }
            let entryDate = null;
            if (d.date) entryDate = new Date(d.date);
            else if (d.invoiceDate) entryDate = new Date(d.invoiceDate);

            if (entryDate && entryDate <= limitDate) {
                batch.update(doc.ref, {
                    billingStatus: 'billed',
                    billedAt: admin.firestore.Timestamp.now(),
                    billingMethod: 'bulk_archive_cleanup'
                });
                batchCount++;
                if (batchCount >= 400) await commitBatch();
            }
        }

        await commitBatch();
        await logActivity(context, 'BULK_ARCHIVE', projectNumber, `Archived ${totalArchived} items.`);
        await markProjectDirty(baseProject);

        let message = `Successfully archived ${totalArchived} entries.`;
        if (skippedPending > 0) message += `\n\nSkipped ${skippedPending} items that are currently locked in a Pending RFP.`;
        if (totalArchived === 0 && skippedPending > 0) throw new Error(`Action Blocked: All eligible items are locked in Pending RFPs.`);

        return { status: "success", archivedCount: totalArchived, skippedCount: skippedPending, message };
    } catch (e) {
        console.error("Bulk Archive Error:", e);
        throw new functions.https.HttpsError("internal", e.message);
    }
});

exports.generateWIPReport = functions.runWith({ memory: '2GB', timeoutSeconds: 540 }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");
    try {
        console.log("Starting WIP Report Generation...");
        const [overheadsSnap, effHoursSnap, employeesSnap, historySnap, projectsSnap, miscSnap] = await Promise.all([
            db.collection('settings').doc('company_settings').collection('overhead_periods').orderBy('startDate', 'desc').get(),
            db.collection('settings').doc('company_settings').collection('effective_hours_periods').orderBy('startDate', 'desc').get(),
            db.collection('employees').get(),
            db.collectionGroup('salary_history').get(),
            db.collection('projects').get(),
            db.collection('misc_register').get()
        ]);

        const overheads = overheadsSnap.docs.map(d => ({
            id: d.id, ...d.data(),
            startDate: parseDateUTC(d.data().startDate)
        }));
        const effectiveHours = effHoursSnap.docs.map(d => ({
            id: d.id, ...d.data(),
            startDate: parseDateUTC(d.data().startDate)
        }));

        const projectMap = {};
        projectsSnap.forEach(doc => {
            const p = doc.data();
            projectMap[String(p.projectNumber).padStart(4, '0')] = {
                description: p.projectDescription,
                isBillable: p.isBillable !== false
            };
        });

        const miscMap = {};
        miscSnap.forEach(doc => {
            const m = doc.data();
            miscMap[m.code] = { description: m.description, client: m.client };
        });

        const employees = [];
        const empMap = {};
        const salaryHistories = {};

        employeesSnap.forEach(doc => {
            const d = doc.data();
            employees.push({ id: doc.id, ...d });
            if (d.companyEmail) empMap[d.companyEmail.toLowerCase()] = doc.id;
            if (d.workEmail) empMap[d.workEmail.toLowerCase()] = doc.id;
        });

        historySnap.forEach(doc => {
            const pid = doc.ref.parent.parent.id;
            if (!salaryHistories[pid]) salaryHistories[pid] = [];
            salaryHistories[pid].push({
                ...doc.data(),
                effectiveDate: parseDateUTC(doc.data().effectiveDate)
            });
        });

        const [timeSnap, costsSnap] = await Promise.all([
            db.collection('timesheet_entries').where('billingStatus', 'in', ['unbilled', 'rfp_pending']).get(),
            db.collection('project_costs').where('billingStatus', 'in', ['unbilled', 'rfp_pending']).get()
        ]);

        const relevantMonths = new Set();
        const processDate = (d) => {
            if (d) relevantMonths.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        };

        timeSnap.forEach(d => {
            const dateObj = parseDateUTC(d.data().date || d.data().startTime);
            processDate(dateObj);
        });

        const pools = {};
        relevantMonths.forEach(monthKey => {
            const [y, m] = monthKey.split('-').map(Number);
            const mStart = new Date(Date.UTC(y, m - 1, 1));
            const mEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59));

            let sumProd = 0, sumBill = 0, nonProdPool = 0;
            employees.forEach(emp => {
                if (!isEmployeeActiveInPeriod(emp, mStart, mEnd)) return;
                const hist = salaryHistories[emp.id];
                const active = getApplicableSalaryRecord(hist, mEnd);
                if (active) {
                    const bill = safePercent(active.billablePercent);
                    if (bill > 0) sumProd += safePercent(active.productivityPercent);
                    sumBill += bill;
                    const monthlyCost = calculateAnnualTotalCost(active) / 12;
                    if (active.addToNonProdPool !== false) nonProdPool += monthlyCost * (1 - (bill / 100));
                }
            });
            pools[monthKey] = { sumProductivity: sumProd, sumBillable: sumBill, nonProdPool };
        });

        const projects = {};
        const rateCache = {};

        timeSnap.forEach(doc => {
            const e = doc.data();
            const pNumRaw = String(e.project).padStart(4, '0');
            let pNum = pNumRaw;
            let pInfo = projectMap[pNum] || { description: e.project, isBillable: true };

            if (pNumRaw === '0999') {
                const match = (e.comment || '').match(/^\[([A-Z0-9]+)\]/i);
                const miscCode = match ? match[1] : '0000';
                pNum = `0999-${miscCode}`;
                pInfo = {
                    description: miscCode === '0000' ? 'Miscellaneous (Unassigned)' : (miscMap[miscCode] ? `Misc: ${miscMap[miscCode].description}` : `Misc File ${miscCode}`),
                    isBillable: true
                };
            }

            if (!projects[pNum]) {
                projects[pNum] = {
                    projectNumber: pNum,
                    projectDescription: pInfo.description,
                    isBillable: pInfo.isBillable,
                    totalHours: 0,
                    totalTimeCost: 0,
                    totalExpenseCost: 0,
                    isLocked: false,
                    employeeSummary: {}
                };
            }

            if (e.billingStatus === 'rfp_pending') projects[pNum].isLocked = true;

            const date = parseDateUTC(e.date || e.startTime);
            let cost = 0;
            const duration = parseFloat(e.duration) || 0;

            if (date) {
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                const email = (e.emailAddress || '').toLowerCase();
                const cacheKey = `${email}_${monthKey}`;

                let hourlyRate = 0;
                if (pInfo.isBillable) {
                    if (rateCache[cacheKey] !== undefined) {
                        hourlyRate = rateCache[cacheKey];
                    } else {
                        const empId = empMap[email];
                        if (empId) {
                            const hist = salaryHistories[empId];
                            const active = getApplicableSalaryRecord(hist, date);
                            if (active) {
                                const res = calculateHourlyRateForDate(date, active, effectiveHours, overheads, { [date.getMonth()]: pools[monthKey] });
                                hourlyRate = res.totalRate;
                                rateCache[cacheKey] = hourlyRate;
                            }
                        }
                    }
                }
                cost = hourlyRate * duration;

                if (!projects[pNum].employeeSummary[email]) {
                    projects[pNum].employeeSummary[email] = {
                        email,
                        name: email.split('@')[0].replace('.', ' '),
                        hours: 0,
                        cost: 0
                    };
                }
                projects[pNum].employeeSummary[email].hours += duration;
                projects[pNum].employeeSummary[email].cost += cost;
            }

            projects[pNum].totalHours += duration;
            projects[pNum].totalTimeCost += cost;
        });

        costsSnap.forEach(doc => {
            const c = doc.data();
            const pNumRaw = String(c.projectNumber).padStart(4, '0');
            let pNum = pNumRaw;
            let pInfo = projectMap[pNum] || { description: 'Unknown', isBillable: true };

            if (pNumRaw === '0999') {
                pNum = `0999-0000`;
                pInfo = { description: 'Miscellaneous (Unassigned)', isBillable: true };
            }

            if (!projects[pNum]) {
                projects[pNum] = {
                    projectNumber: pNum,
                    projectDescription: pInfo.description,
                    isBillable: pInfo.isBillable,
                    totalHours: 0,
                    totalTimeCost: 0,
                    totalExpenseCost: 0,
                    isLocked: false,
                    employeeSummary: {}
                };
            }
            if (c.billingStatus === 'rfp_pending') projects[pNum].isLocked = true;

            const amount = parseFloat(c.amount) || 0;
            projects[pNum].totalExpenseCost += amount;
        });

        const reportData = Object.values(projects).sort((a, b) => {
            const getSortVal = (str) => {
                if (str.startsWith('0999-')) {
                    return 999 + (parseInt(str.split('-')[1]) / 10000);
                }
                return parseInt(str);
            };
            return getSortVal(a.projectNumber) - getSortVal(b.projectNumber);
        });

        await db.collection('reports').doc('wip_summary').set({
            generatedAt: admin.firestore.Timestamp.now(),
            projects: reportData,
            recordCount: timeSnap.size + costsSnap.size
        });

        await db.collection('settings').doc('wip_status').set({
            isStale: false,
            lastUpdated: admin.firestore.Timestamp.now(),
            modifiedProjects: []
        }, { merge: true });

        return { status: "success", count: reportData.length };

    } catch (error) {
        throw new functions.https.HttpsError("internal", error.message);
    }
});

exports.getProjectUnbilledDetails = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

    const { projectNumber } = data;
    let baseProject = String(projectNumber);
    let targetMiscCode = null;
    let dataVariations = [];

    if (baseProject.startsWith('0999-')) {
        targetMiscCode = baseProject.split('-')[1];
        baseProject = '0999';
        dataVariations = ['0999', 999, '999'];
    } else {
        const raw = String(baseProject).trim();
        const num = parseInt(raw, 10);
        const padded = raw.padStart(4, '0');
        dataVariations = Array.from(new Set([baseProject, raw, padded, num, String(num)])).filter(v => v !== undefined && v !== null && v !== "");
    }

    try {
        const [timeSnap, costsSnap] = await Promise.all([
            db.collection('timesheet_entries').where('project', 'in', dataVariations).where('billingStatus', 'in', ['unbilled', 'rfp_pending']).get(),
            db.collection('project_costs').where('projectNumber', 'in', dataVariations).where('billingStatus', 'in', ['unbilled', 'rfp_pending']).get()
        ]);

        const entries = [];

        const [overheadsSnap, effHoursSnap, employeesSnap, historySnap] = await Promise.all([
            db.collection('settings').doc('company_settings').collection('overhead_periods').get(),
            db.collection('settings').doc('company_settings').collection('effective_hours_periods').get(),
            db.collection('employees').get(),
            db.collectionGroup('salary_history').get()
        ]);

        const overheads = overheadsSnap.docs.map(d => ({ ...d.data(), startDate: parseDateUTC(d.data().startDate) }));
        const effectiveHours = effHoursSnap.docs.map(d => ({ ...d.data(), startDate: parseDateUTC(d.data().startDate) }));
        const empMap = {};
        const employeesList = [];
        employeesSnap.forEach(d => {
            const e = d.data();
            employeesList.push({ id: d.id, ...e });
            if (e.companyEmail) empMap[e.companyEmail.toLowerCase()] = d.id;
        });
        const salaryHistories = {};
        historySnap.forEach(doc => {
            const pid = doc.ref.parent.parent.id;
            if (!salaryHistories[pid]) salaryHistories[pid] = [];
            salaryHistories[pid].push({ ...doc.data(), effectiveDate: parseDateUTC(doc.data().effectiveDate) });
        });

        const relevantMonths = new Set();
        timeSnap.forEach(d => {
            const dateObj = parseDateUTC(d.data().date || d.data().startTime);
            if (dateObj) relevantMonths.add(`${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`);
        });

        const pools = {};
        relevantMonths.forEach(monthKey => {
            const [y, m] = monthKey.split('-').map(Number);
            const mStart = new Date(Date.UTC(y, m - 1, 1));
            const mEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59));
            let sumProd = 0, sumBill = 0, nonProdPool = 0;
            employeesList.forEach(emp => {
                if (!isEmployeeActiveInPeriod(emp, mStart, mEnd)) return;
                const hist = salaryHistories[emp.id];
                const active = getApplicableSalaryRecord(hist, mEnd);
                if (active) {
                    const bill = safePercent(active.billablePercent);
                    if (bill > 0) sumProd += safePercent(active.productivityPercent);
                    sumBill += bill;
                    const monthlyCost = calculateAnnualTotalCost(active) / 12;
                    if (active.addToNonProdPool !== false) nonProdPool += monthlyCost * (1 - (bill / 100));
                }
            });
            pools[monthKey] = { sumProductivity: sumProd, sumBillable: sumBill, nonProdPool };
        });

        timeSnap.forEach(doc => {
            const e = doc.data();

            if (baseProject === '0999') {
                const match = (e.comment || '').match(/^\[([A-Z0-9]+)\]/i);
                const entryMiscCode = match ? match[1] : '0000';
                if (targetMiscCode !== null && entryMiscCode !== targetMiscCode) {
                    return;
                }
            }

            const date = parseDateUTC(e.date || e.startTime);
            const email = (e.emailAddress || '').toLowerCase();
            const duration = parseFloat(e.duration) || 0;
            let cost = 0;

            if (date) {
                const empId = empMap[email];
                if (empId) {
                    const hist = salaryHistories[empId];
                    const active = getApplicableSalaryRecord(hist, date);
                    if (active) {
                        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                        const res = calculateHourlyRateForDate(date, active, effectiveHours, overheads, { [date.getMonth()]: pools[monthKey] });
                        cost = res.totalRate * duration;
                    }
                }
            }

            entries.push({
                id: doc.id,
                ...e,
                date: date ? date.toISOString() : null,
                startTime: e.startTime?.toDate ? e.startTime.toDate().toISOString() : e.startTime,
                endTime: e.endTime?.toDate ? e.endTime.toDate().toISOString() : e.endTime,
                cost: cost
            });
        });

        costsSnap.forEach(doc => {
            const c = doc.data();
            if (baseProject === '0999') {
                if (targetMiscCode !== null && targetMiscCode !== '0000') {
                    return;
                }
            }
            const date = parseDateUTC(c.date || c.invoiceDate);
            entries.push({
                id: doc.id,
                ...c,
                date: date ? date.toISOString() : null,
                amount: parseFloat(c.amount) || 0,
                isCost: true
            });
        });

        return { status: "success", entries };

    } catch (e) {
        throw new functions.https.HttpsError("internal", e.message);
    }
});

exports.generateProjectAudit = functions.runWith({
    memory: '2GB',
    timeoutSeconds: 540
}).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

    const { projectNumber } = data;
    let baseProject = String(projectNumber);
    let targetMiscCode = null;
    let dataVariations = [];
    let rfpVariations = [];

    if (baseProject.startsWith('0999-')) {
        targetMiscCode = baseProject.split('-')[1];
        baseProject = '0999';
        dataVariations = ['0999', 999, '999'];
        rfpVariations = [String(projectNumber), '0999', 999, '999'];
    } else {
        const raw = String(baseProject).trim();
        const num = parseInt(raw, 10);
        const padded = raw.padStart(4, '0');

        const variationsSet = new Set([
            baseProject,
            raw,
            padded,
            num,
            String(num)
        ]);

        dataVariations = Array.from(variationsSet).filter(v => v !== undefined && v !== null && v !== "" && !(typeof v === 'number' && isNaN(v)));
        rfpVariations = dataVariations;
    }

    try {
        const [overheadsSnap, effHoursSnap, employeesSnap, historySnap] = await Promise.all([
            db.collection('settings').doc('company_settings').collection('overhead_periods').orderBy('startDate', 'desc').get(),
            db.collection('settings').doc('company_settings').collection('effective_hours_periods').orderBy('startDate', 'desc').get(),
            db.collection('employees').get(),
            db.collectionGroup('salary_history').get()
        ]);

        const overheads = overheadsSnap.docs.map(d => ({ id: d.id, ...d.data(), startDate: parseDateUTC(d.data().startDate) }));
        const effectiveHours = effHoursSnap.docs.map(d => ({ id: d.id, ...d.data(), startDate: parseDateUTC(d.data().startDate) }));

        const employees = [];
        const empMap = {};
        const salaryHistories = {};

        employeesSnap.forEach(d => {
            const e = d.data();
            employees.push({ id: d.id, ...e });
            if (e.companyEmail) empMap[e.companyEmail.toLowerCase()] = d.id;
        });

        historySnap.forEach(d => {
            const pid = d.ref.parent.parent.id;
            if (!salaryHistories[pid]) salaryHistories[pid] = [];
            salaryHistories[pid].push({ ...d.data(), effectiveDate: parseDateUTC(d.data().effectiveDate) });
        });

        const [rfpSnap, costsSnap, timeSnap] = await Promise.all([
            db.collection('rfps').where('projectNumber', 'in', rfpVariations).get(),
            db.collection('project_costs').where('projectNumber', 'in', dataVariations).get(),
            db.collection('timesheet_entries').where('project', 'in', dataVariations).get()
        ]);

        const relevantMonths = new Set();
        timeSnap.forEach(doc => {
            const e = doc.data();
            if (baseProject === '0999') {
                const match = (e.comment || '').match(/^\[([A-Z0-9]+)\]/i);
                const entryMiscCode = match ? match[1] : '0000';
                if (targetMiscCode !== null && entryMiscCode !== targetMiscCode) {
                    return;
                }
            }
            const dateObj = parseDateUTC(e.date || e.startTime);
            if (dateObj) relevantMonths.add(`${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`);
        });

        const pools = {};
        relevantMonths.forEach(monthKey => {
            const [y, m] = monthKey.split('-').map(Number);
            const mStart = new Date(Date.UTC(y, m - 1, 1));
            const mEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59));

            let sumProd = 0, sumBill = 0, nonProdPool = 0;
            employees.forEach(emp => {
                if (!isEmployeeActiveInPeriod(emp, mStart, mEnd)) return;
                const hist = salaryHistories[emp.id];
                const active = getApplicableSalaryRecord(hist, mEnd);
                if (active) {
                    const bill = safePercent(active.billablePercent);
                    if (bill > 0) sumProd += safePercent(active.productivityPercent);
                    sumBill += bill;
                    const monthlyCost = calculateAnnualTotalCost(active) / 12;
                    if (active.addToNonProdPool !== false) nonProdPool += monthlyCost * (1 - (bill / 100));
                }
            });
            pools[monthKey] = { sumProductivity: sumProd, sumBillable: sumBill, nonProdPool };
        });

        const groupedLabor = {};

        timeSnap.forEach(doc => {
            const e = doc.data();
            if (baseProject === '0999') {
                const match = (e.comment || '').match(/^\[([A-Z0-9]+)\]/i);
                const entryMiscCode = match ? match[1] : '0000';
                if (targetMiscCode !== null && entryMiscCode !== targetMiscCode) {
                    return;
                }
            }

            const date = parseDateUTC(e.date || e.startTime);
            const email = (e.emailAddress || 'Unknown').toLowerCase();
            const duration = parseFloat(e.duration) || 0;
            let breakdown = { directCost: 0, overheadCost: 0, nonProdCost: 0, totalCost: 0 };
            let rateSample = null;

            if (date) {
                const empId = empMap[email];
                if (empId) {
                    const hist = salaryHistories[empId];
                    const active = getApplicableSalaryRecord(hist, date);
                    if (active) {
                        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                        const res = calculateHourlyRateForDate(date, active, effectiveHours, overheads, { [date.getMonth()]: pools[monthKey] });

                        breakdown.directCost = (res.breakdown.directRate || 0) * duration;
                        breakdown.overheadCost = (res.breakdown.overheadRate || 0) * duration;
                        breakdown.nonProdCost = (res.breakdown.nonProdRate || 0) * duration;
                        breakdown.totalCost = res.totalRate * duration;
                        rateSample = res;
                    }
                }
            }

            if (!groupedLabor[email]) {
                groupedLabor[email] = {
                    email,
                    name: (e.emailAddress || 'User').split('@')[0].replace('.', ' '),
                    hours: 0,
                    directCost: 0, overheadCost: 0, nonProdCost: 0, totalCost: 0,
                    rateSample
                };
            }
            groupedLabor[email].hours += duration;
            groupedLabor[email].directCost += breakdown.directCost;
            groupedLabor[email].overheadCost += breakdown.overheadCost;
            groupedLabor[email].nonProdCost += breakdown.nonProdCost;
            groupedLabor[email].totalCost += breakdown.totalCost;
        });

        let totalPaidInvoices = 0;

        const rfps = rfpSnap.docs.map(d => {
            const r = d.data();
            const gross = parseFloat(r.totalAmount) || (parseFloat(r.amount) * (r.vatApplicable ? 1.18 : 1)) || 0;

            let cn = parseFloat(r.creditedAmount) || 0;
            if (cn === 0 && r.credits) {
                Object.values(r.credits).forEach(c => cn += parseFloat(c.amount));
            }

            let paid = parseFloat(r.invoicedAmount) || 0;
            if (paid === 0 && r.payments) {
                Object.values(r.payments).forEach(p => paid += parseFloat(p.amount));
            }

            totalPaidInvoices += paid;

            return {
                id: d.id,
                rfpCode: r.rfpCode || r.rfpNumber || 'DRAFT',
                date: r.issuedAt?.toDate ? r.issuedAt.toDate().toISOString() : new Date().toISOString(),
                status: r.status,
                grossValue: gross,
                netBilled: (r.status !== 'Superseded') ? (gross - cn) : 0,
                paidAmount: paid
            };
        });

        const expenses = [];
        costsSnap.forEach(doc => {
            const c = doc.data();
            if (baseProject === '0999') {
                if (targetMiscCode !== null && targetMiscCode !== '0000') {
                    return;
                }
            }
            const amt = parseFloat(c.amount) || 0;
            const vat = c.vatApplicable !== false ? amt * 0.18 : 0;
            expenses.push({
                id: doc.id,
                date: (c.date || c.invoiceDate || new Date()).toString(),
                description: c.description,
                supplier: c.supplier,
                totalGross: amt + vat
            });
        });

        const totalBilled = rfps.reduce((sum, r) => sum + r.netBilled, 0);
        const totalExpenses = expenses.reduce((sum, e) => sum + e.totalGross, 0);
        const totalLabor = Object.values(groupedLabor).reduce((sum, l) => sum + l.totalCost, 0);
        const netRevenue = totalBilled / 1.18;
        const netExpenses = totalExpenses / 1.18;
        const profitability = netRevenue - totalLabor - netExpenses;

        const report = {
            generatedAt: admin.firestore.Timestamp.now(),
            projectNumber: String(projectNumber),
            summary: {
                totalBilledLessCN: totalBilled,
                totalInvoiced: totalPaidInvoices,
                totalExternalCostsIncVat: totalExpenses,
                totalInternalTimeCost: totalLabor,
                totalHours: Object.values(groupedLabor).reduce((s, l) => s + l.hours, 0),
                profitability
            },
            groupedLabor: Object.values(groupedLabor),
            rfps: rfps,
            expenses: expenses
        };

        await db.collection('reports').doc(`audit_${String(projectNumber)}`).set(report);

        return { status: "success" };

    } catch (e) {
        console.error("Audit Generation Error:", e);
        throw new functions.https.HttpsError("internal", e.message);
    }
});