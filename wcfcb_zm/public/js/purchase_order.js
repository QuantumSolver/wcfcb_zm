// Purchase Order: Monthly-aware Budget Check (warnings only for monthly)

frappe.ui.form.on('Purchase Order', {
    refresh: function(frm) {
        // Add Check Budget button on Items grid
        if (frm.fields_dict.items) {
            frm.budget_button = frm.fields_dict.items.grid.add_custom_button(
                __('Check Budget'),
                function() {
                    const item = (frm.doc.items && frm.doc.items.length) ? frm.doc.items[0] : null;
                    if (!item) {
                        frappe.show_alert({ message: __('Add an item first'), indicator: 'orange' });
                        return;
                    }
                    run_po_budget_check(frm, item);
                }
            ).addClass('btn-primary');
        }
    },

    // Light-touch hooks (non-blocking). Monthly checks show warnings only.
    items_add: function(frm, cdt, cdn) {
        const row = frappe.get_doc(cdt, cdn);
        run_po_budget_check(frm, row, { quiet: true });
    },

    expense_account: function(frm, cdt, cdn) {
        const row = frappe.get_doc(cdt, cdn);
        run_po_budget_check(frm, row, { quiet: true });
    },

    cost_center: function(frm, cdt, cdn) {
        const row = frappe.get_doc(cdt, cdn);
        run_po_budget_check(frm, row, { quiet: true });
    },

    project: function(frm, cdt, cdn) {
        const row = frappe.get_doc(cdt, cdn);
        run_po_budget_check(frm, row, { quiet: true });
    }
});

function run_po_budget_check(frm, item, opts = {}) {
    const quiet = !!opts.quiet;

    if (!item || !item.expense_account) {
        if (!quiet) {
            frappe.show_alert({ message: __('Expense Account required'), indicator: 'red' });
        }
        return;
    }
    if (!item.cost_center && !item.project) {
        if (!quiet) {
            frappe.show_alert({ message: __('Set Cost Center or Project'), indicator: 'orange' });
        }
        return;
    }

    frappe.call({
        method: 'wcfcb_zm.api.purchase_order.check_budget',
        args: {
            expense_account: item.expense_account,
            cost_center: item.cost_center,
            project: item.project,
            requested_amount: item.amount || 0,
            transaction_date: frm.doc.transaction_date || frappe.datetime.get_today()
        },
        callback: function(r) {
            if (r.exc || !r.message || !r.message.length) {
                if (!quiet) {
                    frappe.show_alert({ message: __('No budget data found'), indicator: 'orange' });
                }
                return;
            }

            const budget = r.message[0];
            // Monthly warning (non-blocking)
            if (budget.has_monthly_distribution && !budget.within_monthly_budget) {
                frappe.show_alert({
                    message: __('Monthly budget will be exceeded for {0}. Available: {1}', [
                        budget.account_name || item.expense_account,
                        format_currency(budget.monthly_available_budget)
                    ]),
                    indicator: 'orange'
                }, 8);
            }

            if (!quiet) {
                const linked_mr = !!(frm.doc.custom_linked_material_request || (item && item.material_request) || (frm.doc.items || []).some(r => r.material_request));
                show_po_budget_dialog(item, r.message, frm.doc.transaction_date, frm.doc.docstatus, linked_mr);
            }
        },
        error: function() {
            if (!quiet) {
                frappe.show_alert({ message: __('Error checking budget'), indicator: 'red' });
            }
        }
    });
}

function show_po_budget_dialog(item, budget_data, transaction_date, docstatus, linked_mr) {
    const b = budget_data[0];
    const requested = item.amount || 0;
    const overAnnual = !b.within_annual_budget;
    const overMonthly = b.has_monthly_distribution && !b.within_monthly_budget;

    const dialog = new frappe.ui.Dialog({
        title: __('Budget Details (Purchase Order)'),
        size: 'large',
        fields: [
            { fieldtype: 'HTML', fieldname: 'content', options: build_po_budget_html(item, b, budget_data, requested, transaction_date, overAnnual, overMonthly, docstatus, linked_mr) }
        ],
        primary_action_label: __('Close'),
        primary_action() { dialog.hide(); }
    });
    dialog.show();
}

function build_po_budget_html(item, b, all, requested, transaction_date, overAnnual, overMonthly, docstatus, linked_mr) {
    const hasMD = b.has_monthly_distribution;
    const budgetFor = (b.budget_against_name || b.budget_against || '')
    const status = overMonthly ? 'EXCEEDS MONTHLY BUDGET' : (overAnnual ? 'EXCEEDS ANNUAL BUDGET' : 'WITHIN BUDGET');
    const statusClass = overMonthly ? 'badge-warning' : (overAnnual ? 'badge-danger' : 'badge-success');

    // Informational notes to explain commitment lifecycle and transfer
    const isDraft = (typeof cint !== 'undefined' ? cint(docstatus) : docstatus) === 0;
    const linkedFlag = !!linked_mr;
    const infoNotes = `
        ${isDraft && linkedFlag ? `<div class="alert alert-info mb-3"><i class="fa fa-info-circle"></i> ${__('Info: When a Purchase Order is submitted and approved for a Material Request, the budget commitment is automatically transferred from the Material Request to the Purchase Order.')}</div>` : ''}
    `;

    const monthlyBlock = hasMD ? `
        <div class="row mb-3">
            <div class="col-md-3"><div class="card border-info"><div class="card-body py-2 text-center">
                <div class="small text-muted">${__('Current Month')}</div>
                <div class="h6 mb-0 text-info">${b.current_month}</div>
            </div></div></div>
            <div class="col-md-3"><div class="card border-info"><div class="card-body py-2 text-center">
                <div class="small text-muted">${__('Monthly %')}</div>
                <div class="h6 mb-0 text-info">${b.monthly_percentage}%</div>
            </div></div></div>
            <div class="col-md-3"><div class="card border-primary"><div class="card-body py-2 text-center">
                <div class="small text-muted">${__('Monthly Budget')}</div>
                <div class="h6 mb-0 text-primary">${format_currency(b.monthly_budget_amount)}</div>
            </div></div></div>
            <div class="col-md-3"><div class="card ${overMonthly ? 'border-warning' : 'border-success'}"><div class="card-body py-2 text-center">
                <div class="small text-muted">${__('Monthly Available')}</div>
                <div class="h6 mb-0 ${overMonthly ? 'text-warning' : 'text-success'}">${format_currency(b.monthly_available_budget)}</div>
            </div></div></div>
        </div>
        <div class="table-responsive mb-3"><table class="table table-sm mb-0">
            <thead><tr><th>${__('Component')}</th><th class="text-right">${__('Amount')}</th></tr></thead>
            <tbody>
                <tr><td>${__('Actual (This Month)')}</td><td class="text-right">${format_currency(b.monthly_actual_expenses)}</td></tr>
                <tr><td>${__('MR Committed (This Month)')}</td><td class="text-right">${format_currency(b.monthly_mr_committed)}</td></tr>
                <tr><td>${__('PO Committed (This Month)')}</td><td class="text-right">${format_currency(b.monthly_po_committed)}</td></tr>
                <tr class="table-active"><td><strong>${__('Available Monthly Budget')}</strong></td><td class="text-right"><strong>${format_currency(b.monthly_available_budget)}</strong></td></tr>
            </tbody>
        </table></div>
    ` : `
        <div class="alert alert-info mb-3"><i class="fa fa-info-circle"></i> ${__('No Monthly Distribution configured. Annual budget applies.')}</div>
    `;

    const rows = all.map(x => `
        <tr>
            <td><strong>${x.account_name || item.expense_account}</strong></td>
            <td class="text-right">${format_currency(x.budget_amount)}</td>
            <td class="text-right">${format_currency(x.actual_expenses)}</td>
            <td class="text-right">${format_currency(x.material_request_committed + x.purchase_order_committed)}</td>
            <td class="text-right ${x.available_budget < 0 ? 'text-danger font-weight-bold' : 'text-success font-weight-bold'}">${format_currency(x.available_budget)}</td>
        </tr>
    `).join('');

    return `
        <div class="container-fluid p-0">
            <div class="d-flex justify-content-between align-items-start mb-2">
                <div>
                    <div class="h6 mb-1">${__('Budget for')} ${item.expense_account}</div>
                    <div class="text-muted small">${__('Against')}: ${budgetFor}</div>
                    <div class="text-muted small">${__('Transaction Date')}: ${transaction_date || ''}</div>
                </div>
                <span class="badge ${statusClass} badge-pill">${__(status)}</span>
            </div>

            <div class="row mb-3">
                <div class="col-md-6"><div class="card border-info"><div class="card-body py-2 text-center">
                    <div class="small text-muted">${__('Requested Amount')}</div>
                    <div class="h5 mb-0 text-info">${format_currency(requested)}</div>
                </div></div></div>
                <div class="col-md-6"><div class="card ${overAnnual ? 'border-danger' : 'border-success'}"><div class="card-body py-2 text-center">
                    <div class="small text-muted">${__('Available Annual')}</div>
                    <div class="h5 mb-0 ${overAnnual ? 'text-danger' : 'text-success'}">${format_currency(b.available_budget)}</div>
                </div></div></div>
            </div>

            ${monthlyBlock}

            ${infoNotes}

            <h6 class="text-muted mb-2">${__('Annual Budget Summary')}</h6>
            <div class="table-responsive"><table class="table table-sm mb-0">
                <thead><tr><th>${__('Account')}</th><th class="text-right">${__('Annual')}</th><th class="text-right">${__('Actual')}</th><th class="text-right">${__('Committed')}</th><th class="text-right">${__('Available')}</th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div>
        </div>
    `;
}

function format_currency(value) {
    return frappe.format(value, { fieldtype: 'Currency', options: frappe.defaults.get_default('currency') });
}

