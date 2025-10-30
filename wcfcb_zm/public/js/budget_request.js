// Client Script for Budget Request
// Purpose: Virement Logic - Handles Intra-Budget and Inter-Budget transfer validation and field behavior

frappe.ui.form.on('Budget Request', {
    refresh: function(frm) {
        setup_field_dependencies(frm);

        // Set up account filters for transfer items
        setup_transfer_item_filters(frm);

        // ALWAYS force multi-transfer mode (remove legacy mode completely)
        force_multi_transfer_mode(frm);

        // Add View Summary button for approved requests
        add_view_summary_button(frm);

        // Initialize modern card-based transfer items interface for all document states
        // But only allow editing for draft documents
        initialize_modern_transfer_interface(frm);

        // Ensure cards interface is maintained on refresh
        setTimeout(() => {
            if ($('.modern-transfer-cards-container').length === 0) {
                initialize_modern_transfer_interface(frm);
            }
        }, 100);

        // Add accordion-style progressive summary (for multi-transfer mode)
        if (is_multi_transfer_mode(frm)) {
            add_accordion_progressive_summary(frm);
        }
    },

    onload_post_render: function(frm) {
        // Handle amended documents - copy field values from original
        if (frm.doc.amended_from && frm.is_new()) {
            copy_fields_from_amended_doc(frm);
        }

        // Ensure field properties are set correctly after render
        setTimeout(function() {
            force_multi_transfer_mode(frm);
        }, 100);
    },

    virement_type: function(frm) {
        handle_virement_type_change(frm);
    },

    budget: function(frm) {
        handle_budget_change(frm);
        // Refresh account filters when budget changes
        setup_transfer_item_filters(frm);
    },

    target_budget: function(frm) {
        handle_target_budget_change(frm);
        // Refresh account filters when target budget changes
        setup_transfer_item_filters(frm);
    },

    expense_account: function(frm) {
        handle_expense_account_change(frm);
    },

    to_expense_account: function(frm) {
        handle_to_expense_account_change(frm);
    },

    before_save: function(frm) {
        return handle_external_approval_before_save(frm);
    },

    amount_requested: function(frm) {
        // Only for legacy single-transfer mode
        if (!frm.is_new()) {
            handle_amount_change(frm);
        }
    },

    workflow_state: function(frm) {
        // Clear external approval messages when workflow state changes to final states
        const final_states = ['Approved', 'Rejected'];
        if (final_states.includes(frm.doc.workflow_state) || frm.doc.docstatus === 2) {
            clear_external_approval_message(frm);
        } else {
            // Re-check amount for new workflow state
            handle_threshold_validation(frm);
        }
    },

    validate: function(frm) {
        // Only validate virement request, no workflow interception here
        return validate_virement_request(frm);
    },

    before_workflow_action: async function(frm) {
        // Skip interception if we're already in custom approval flow
        if (frm._custom_approval_in_progress) {
            return;
        }

        // Intercept "Approve" workflow action with Promise-based blocking approach
        if (frm.selected_workflow_action === 'Approve') {
            let promise = new Promise((resolve, reject) => {
                // Validate required fields first
                let validation_error = null;

                if (!frm.doc.budget) {
                    validation_error = 'Budget is required';
                } else if (is_multi_transfer_mode(frm)) {
                    // Multi-transfer validation
                    if (!frm.doc.transfer_items || frm.doc.transfer_items.length === 0) {
                        validation_error = 'At least one transfer item is required for multi-transfer mode';
                    } else {
                        // Check each transfer item
                        for (let i = 0; i < frm.doc.transfer_items.length; i++) {
                            let item = frm.doc.transfer_items[i];
                            if (!item.from_account || !item.to_account || !item.amount_requested) {
                                validation_error = `Transfer item ${i + 1}: All fields are required`;
                                break;
                            }
                        }
                    }
                } else {
                    // Single-transfer validation
                    if (!frm.doc.expense_account || !frm.doc.to_expense_account || !frm.doc.amount_requested) {
                        validation_error = 'From Account, To Account, and Amount are required';
                    }
                }

                if (validation_error) {
                    frappe.msgprint({
                        title: __('Missing Information'),
                        message: __(validation_error),
                        indicator: 'red'
                    });
                    reject();
                    return;
                }

                // Remove any existing freeze overlay that might block the dialog
                if (document.getElementById('freeze')) {
                    document.getElementById('freeze').remove();
                }

                // Show custom confirmation dialog to avoid overlay issues
                let dialog = new frappe.ui.Dialog({
                    title: __('Confirm Budget Virement Approval'),
                    fields: [
                        {
                            fieldtype: 'HTML',
                            fieldname: 'confirmation_html',
                            options: `
                                <div style="padding: 15px;">
                                    <h4 style="color: #dc3545; margin-bottom: 15px;">
                                        <i class="fa fa-exclamation-triangle"></i>
                                        Are you sure you want to approve this budget virement?
                                    </h4>

                                    ${generate_transfer_details_html(frm)}

                                    <div style="background: #fff3cd; padding: 10px; border-radius: 4px; border-left: 4px solid #ffc107;">
                                        <small><em>This will cancel the current budget and create an amended version.</em></small>
                                    </div>
                                </div>
                            `
                        }
                    ],
                    primary_action_label: __('Yes, Approve'),
                    primary_action: function() {
                        dialog.hide();

                        // STEP 1: Refresh document and check if Budget Request is already approved
                        frm.reload_doc().then(() => {
                            if (frm.doc.workflow_state === 'Approved' && frm.doc.docstatus === 1) {
                                // Already approved, skip workflow and go directly to amendment
                                process_budget_amendment();
                            } else {
                            // STEP 1: First approve the Budget Request through workflow
                            frm._custom_approval_in_progress = true; // Set flag to prevent hook interference
                            frappe.call({
                                method: 'frappe.model.workflow.apply_workflow',
                                args: {
                                    doc: frm.doc,
                                    action: 'Approve'
                                },
                                callback: function(workflow_response) {
                                    frm._custom_approval_in_progress = false; // Clear flag
                                    if (workflow_response.message) {
                                        process_budget_amendment();
                                    } else {
                                        // Check if it's just "Not a valid Workflow Action" - suppress this error
                                        if (workflow_response.exc && workflow_response.exc.includes('Not a valid Workflow Action')) {
                                            // Document is already approved, proceed with amendment
                                            process_budget_amendment();
                                        } else {
                                            frappe.msgprint({
                                                title: __('Workflow Error'),
                                                message: __('Failed to approve Budget Request through workflow.'),
                                                indicator: 'red'
                                            });
                                            reject();
                                        }
                                    }
                                }
                            });
                        }

                        function process_budget_amendment() {
                                    // STEP 2: After workflow approval, process budget amendment
                                    frappe.call({
                                        method: 'wcfcb_zm.api.budget_request.budget_virement_handler',
                                        args: {
                                            'action': 'process_approval_with_amendment',
                                            'doc_name': frm.doc.name,
                                            'virement_type': frm.doc.virement_type,
                                            'budget': frm.doc.budget,
                                            'target_budget': frm.doc.target_budget || '',
                                            'expense_account': frm.doc.expense_account || '',
                                            'to_expense_account': frm.doc.to_expense_account || '',
                                            'amount_requested': frm.doc.amount_requested || 0
                                        },
                                        callback: function(r) {
                                            if (r.message && r.message.success) {
                                                frappe.show_alert({
                                                    message: __('Budget approval completed successfully!'),
                                                    indicator: 'green'
                                                });
                                                // Reload the form to show updated state
                                                frm.reload_doc();
                                                resolve(); // Allow workflow to continue
                                            } else {
                                    frappe.msgprint({
                                        title: __('Approval Failed'),
                                        message: r.message ? r.message.message : 'Unknown error occurred',
                                        indicator: 'red'
                                    });
                                    reject(); // Block workflow
                                }
                            },
                            error: function(err) {
                                let error_msg = 'Unknown error';
                                if (err.responseText) {
                                    try {
                                        let error_obj = JSON.parse(err.responseText);
                                        error_msg = error_obj.message || error_obj.exc || err.responseText;
                                    } catch (e) {
                                        error_msg = err.responseText;
                                    }
                                } else if (err.statusText) {
                                    error_msg = err.statusText;
                                }

                                frappe.msgprint({
                                    title: __('Approval Failed'),
                                    message: __('Error processing approval: ') + error_msg,
                                    indicator: 'red'
                                });
                                reject(); // Block workflow
                            }
                        });
                            }
                        });
                    },
                    secondary_action_label: __('Cancel'),
                    secondary_action: function() {
                        dialog.hide();
                        frappe.msgprint({
                            title: __('Approval Cancelled'),
                            message: __('Budget approval was cancelled by user.'),
                            indicator: 'orange'
                        });
                        reject(); // Block workflow
                    }
                });

                dialog.show();
            });

            // Return the promise to block workflow until resolved
            return promise;
        }
    }
});

// Child Table Events for Budget Request Item (Multi-Transfer Support)
frappe.ui.form.on('Budget Request Item', {
    from_account: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (row.from_account) {
            // Validate account selection for intra-budget transfers
            if (frm.doc.virement_type === 'Intra-Budget' && row.to_account && row.from_account === row.to_account) {
                frappe.msgprint(__('For Intra-Budget transfers, From Account and To Account must be different'));
                frappe.model.set_value(cdt, cdn, 'from_account', '');
                return;
            }
            // Fetch available balance for from_account
            fetch_account_balance(frm, row.from_account, 'from_available', cdt, cdn);
        } else {
            // Clear related fields
            frappe.model.set_value(cdt, cdn, 'from_available', 0);
            frappe.model.set_value(cdt, cdn, 'from_remaining', 0);
        }
        // Refresh all dropdowns to update progressive balances
        refresh_all_transfer_item_dropdowns(frm);
        // Refresh inline summary if visible
        refresh_inline_summary_if_visible(frm);
    },

    to_account: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (row.to_account) {
            // Validate account selection for intra-budget transfers
            if (frm.doc.virement_type === 'Intra-Budget' && row.from_account && row.from_account === row.to_account) {
                frappe.msgprint(__('For Intra-Budget transfers, From Account and To Account must be different'));
                frappe.model.set_value(cdt, cdn, 'to_account', '');
                return;
            }

            // Fetch balance from appropriate budget
            let target_budget = frm.doc.virement_type === 'Inter-Budget' ? frm.doc.target_budget : frm.doc.budget;
            if (target_budget) {
                fetch_account_balance_from_budget(frm, row.to_account, 'to_available', cdt, cdn, target_budget);
            }
        } else {
            // Clear related fields
            frappe.model.set_value(cdt, cdn, 'to_available', 0);
            frappe.model.set_value(cdt, cdn, 'to_new_amount', 0);
        }
        // Refresh all dropdowns to update progressive balances
        refresh_all_transfer_item_dropdowns(frm);
        // Refresh inline summary if visible
        refresh_inline_summary_if_visible(frm);
    },

    amount_requested: function(frm, cdt, cdn) {
        calculate_transfer_item_balances(frm, cdt, cdn);
        // Check threshold for multi-transfer mode
        handle_threshold_validation(frm);
        // Refresh all dropdowns to update progressive balances
        refresh_all_transfer_item_dropdowns(frm);
        // Refresh inline summary if visible
        refresh_inline_summary_if_visible(frm);
    },

    transfer_items_remove: function(frm) {
        // Recalculate totals when item is removed
        calculate_total_transfer_amount(frm);
        // Refresh inline summary if visible
        refresh_inline_summary_if_visible(frm);
    },

    transfer_items_add: function(frm) {
        // Set up filters for new row
        setup_transfer_item_filters(frm);
        calculate_total_transfer_amount(frm);
        // Add accordion summary if not present
        if (!frm._accordion_summary_visible) {
            add_accordion_progressive_summary(frm);
        }
        // Refresh inline summary if visible
        refresh_inline_summary_if_visible(frm);
    }
});

function fetch_account_balance(frm, account, target_field, cdt, cdn) {
    if (!account || !frm.doc.budget) return;

    // Call server to get account balance from budget
    frappe.call({
        method: 'wcfcb_zm.api.budget_request.get_account_balance_from_budget',
        args: {
            budget_name: frm.doc.budget,
            account: account
        },
        callback: function(r) {
            if (r.message && r.message.success) {
                frappe.model.set_value(cdt, cdn, target_field, r.message.available_balance);
                // Recalculate balances after setting available balance
                calculate_transfer_item_balances(frm, cdt, cdn);
            } else {
                frappe.model.set_value(cdt, cdn, target_field, 0);
            }
        }
    });
}

function fetch_account_balance_from_budget(frm, account, target_field, cdt, cdn, budget_name) {
    if (!account || !budget_name) return;

    frappe.call({
        method: 'wcfcb_zm.api.budget_request.get_account_balance_from_budget',
        args: {
            budget_name: budget_name,
            account: account
        },
        callback: function(r) {
            if (r.message && r.message.success) {
                frappe.model.set_value(cdt, cdn, target_field, r.message.available_balance);
                // Recalculate balances after setting available balance
                calculate_transfer_item_balances(frm, cdt, cdn);
            } else {
                frappe.model.set_value(cdt, cdn, target_field, 0);
            }
        }
    });
}

function calculate_transfer_item_balances(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    // Calculate from_remaining
    if (row.from_available && row.amount_requested) {
        let remaining = flt(row.from_available) - flt(row.amount_requested);
        frappe.model.set_value(cdt, cdn, 'from_remaining', remaining);
    }

    // Calculate to_new_amount
    if (row.to_available && row.amount_requested) {
        let new_amount = flt(row.to_available) + flt(row.amount_requested);
        frappe.model.set_value(cdt, cdn, 'to_new_amount', new_amount);
    }

    // Calculate total transfer amount
    calculate_total_transfer_amount(frm);
}

function calculate_total_transfer_amount(frm) {
    let total = 0;
    if (frm.doc.transfer_items) {
        frm.doc.transfer_items.forEach(function(item) {
            if (item.amount_requested) {
                total += flt(item.amount_requested);
            }
        });
    }

    console.log('Calculated total:', total, 'Is new:', frm.is_new());

    // Store total for validation purposes
    frm._total_transfer_amount = total;

    // ALWAYS update the amount_requested field to show total
    frm.doc.amount_requested = total;
    frm.refresh_field('amount_requested');
    console.log('Set amount_requested to:', total);

    // Update display or validation as needed
    frm.refresh_field('transfer_items');

    // Refresh accordion summary if visible
    refresh_inline_summary_if_visible(frm);
}

function setup_transfer_item_filters(frm) {
    // Set up filters for from_account field with real-time progressive balance calculation
    frm.set_query('from_account', 'transfer_items', function(_, cdt, cdn) {
        if (!frm.doc.budget) {
            return { filters: { 'name': 'no-match' } }; // Return empty result if no budget
        }

        // Calculate progressive balances up to current row
        let current_row_idx = get_row_index(frm, cdt, cdn);
        let progressive_balances = calculate_client_side_progressive_balances(frm, current_row_idx);

        console.log('FROM account query - Row:', current_row_idx, 'Progressive balances:', progressive_balances);

        return {
            query: 'wcfcb_zm.api.budget_request.get_budget_accounts_with_progressive',
            filters: {
                'budget': frm.doc.budget,
                'progressive_balances': JSON.stringify(progressive_balances),
                '_timestamp': Date.now(), // Force refresh
                '_row_index': current_row_idx // Add row context
            }
        };
    });

    // Set up filters for to_account field with real-time progressive balance calculation
    frm.set_query('to_account', 'transfer_items', function(_, cdt, cdn) {
        let row = locals[cdt][cdn];
        let target_budget = frm.doc.virement_type === 'Inter-Budget' ? frm.doc.target_budget : frm.doc.budget;

        if (!target_budget) {
            return { filters: { 'name': 'no-match' } }; // Return empty result if no target budget
        }

        // Calculate progressive balances up to current row
        let current_row_idx = get_row_index(frm, cdt, cdn);
        let progressive_balances = calculate_client_side_progressive_balances(frm, current_row_idx, target_budget);

        console.log('TO account query - Row:', current_row_idx, 'Target budget:', target_budget, 'Progressive balances:', progressive_balances);

        return {
            query: 'wcfcb_zm.api.budget_request.get_budget_accounts_with_progressive',
            filters: {
                'budget': target_budget,
                'exclude_account': frm.doc.virement_type === 'Intra-Budget' ? row.from_account : null,
                'progressive_balances': JSON.stringify(progressive_balances),
                '_timestamp': Date.now(), // Force refresh
                '_row_index': current_row_idx // Add row context
            }
        };
    });
}

function is_multi_transfer_mode(frm) {
    return frm.doc.transfer_items && frm.doc.transfer_items.length > 0;
}

function get_row_index(frm, cdt, cdn) {
    // Find the index of the current row being edited
    if (!frm.doc.transfer_items) return 0;

    for (let i = 0; i < frm.doc.transfer_items.length; i++) {
        if (frm.doc.transfer_items[i].name === cdn) {
            return i;
        }
    }
    return frm.doc.transfer_items.length; // If not found, assume it's a new row
}

function calculate_client_side_progressive_balances(frm, up_to_row_idx, target_budget = null) {
    // Calculate progressive balances based on transfer items up to specified row
    let progressive_balances = {};

    if (!frm.doc.transfer_items || frm.doc.transfer_items.length === 0) {
        return progressive_balances;
    }

    // Process transfers up to (but not including) the current row
    for (let i = 0; i < Math.min(up_to_row_idx, frm.doc.transfer_items.length); i++) {
        let item = frm.doc.transfer_items[i];

        if (!item.from_account || !item.to_account || !item.amount_requested) {
            continue; // Skip incomplete rows
        }

        let amount = flt(item.amount_requested);

        // Determine which budget each account belongs to
        let from_budget = frm.doc.budget;
        let to_budget = frm.doc.virement_type === 'Inter-Budget' ? frm.doc.target_budget : frm.doc.budget;

        // Create unique keys for account-budget combinations
        let from_key = `${item.from_account}|${from_budget}`;
        let to_key = `${item.to_account}|${to_budget}`;

        // Initialize if not exists
        if (!progressive_balances[from_key]) {
            progressive_balances[from_key] = 0;
        }
        if (!progressive_balances[to_key]) {
            progressive_balances[to_key] = 0;
        }

        // Apply transfer
        progressive_balances[from_key] -= amount;
        progressive_balances[to_key] += amount;
    }

    // Filter balances for the target budget if specified
    if (target_budget) {
        let filtered_balances = {};
        for (let key in progressive_balances) {
            if (key.endsWith(`|${target_budget}`)) {
                filtered_balances[key] = progressive_balances[key];
            }
        }
        return filtered_balances;
    }

    return progressive_balances;
}

function add_accordion_progressive_summary(frm) {
    // Add accordion-style progressive summary after transfer items table
    setTimeout(() => {
        create_accordion_progressive_summary(frm);
    }, 500); // Delay to ensure DOM is ready
}

function create_accordion_progressive_summary(frm) {
    // Find the modern cards container or fallback to transfer items section
    let target_container = $('.modern-transfer-cards-container');
    if (target_container.length === 0) {
        // Fallback to transfer items section if cards not found
        let transfer_items_section = frm.get_field('transfer_items');
        if (!transfer_items_section || !transfer_items_section.$wrapper) {
            return;
        }
        target_container = transfer_items_section.$wrapper;
    }

    // Remove existing summary if present
    target_container.find('.accordion-progressive-summary').remove();

    // Create accordion-style summary
    let summary_html = generate_accordion_progressive_summary_html(frm);

    let accordion_div = $(`
        <div class="accordion-progressive-summary" style="margin-top: 20px;">
            <div class="card" style="border: 1px solid #dee2e6; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div class="card-header" style="background: linear-gradient(135deg, #347FB6 0%, #ED8643 100%); border-radius: 8px 8px 0 0; cursor: pointer;"
                     onclick="$(this).next('.card-body').slideToggle(); $(this).find('.toggle-icon').toggleClass('fa-chevron-down fa-chevron-up');">
                    <h6 style="margin: 0; color: white; font-weight: 600; display: flex; align-items: center; justify-content: space-between;">
                        <span>
                            <i class="fa fa-chart-line" style="margin-right: 8px;"></i>
                            Transfer Summary
                            <small style="opacity: 0.8; font-weight: normal; margin-left: 10px;">
                                (Updates automatically as you add transfers)
                            </small>
                        </span>
                        <i class="fa fa-chevron-down toggle-icon" style="transition: transform 0.3s ease;"></i>
                    </h6>
                </div>
                <div class="card-body" style="padding: 20px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; display: none;">
                    <div class="summary-content">
                        ${summary_html}
                    </div>
                </div>
            </div>
        </div>
    `);

    // Append to target container
    target_container.append(accordion_div);

    // Mark as visible for refresh functionality
    frm._accordion_summary_visible = true;
}

function generate_accordion_progressive_summary_html(frm) {
    // Generate HTML for accordion progressive summary
    if (!frm.doc.transfer_items || frm.doc.transfer_items.length === 0) {
        return `
            <div style="text-align: center; padding: 30px; color: #6c757d;">
                <i class="fa fa-info-circle" style="font-size: 24px; margin-bottom: 10px; opacity: 0.5;"></i>
                <p style="margin: 0; font-style: italic;">No transfers added yet. Add transfer items above to see the progressive summary.</p>
            </div>
        `;
    }

    // Calculate progressive balances for all complete transfers
    let account_progressions = {};
    let running_balances = {};
    let transfer_sequence = [];

    // Process each transfer to build progression
    for (let i = 0; i < frm.doc.transfer_items.length; i++) {
        let item = frm.doc.transfer_items[i];

        if (!item.from_account || !item.to_account || !item.amount_requested) {
            continue; // Skip incomplete rows
        }

        let amount = flt(item.amount_requested);
        let from_acc = item.from_account;
        let to_acc = item.to_account;

        // Initialize account progressions if not exists
        if (!account_progressions[from_acc]) {
            account_progressions[from_acc] = [];
            running_balances[from_acc] = 0;
        }
        if (!account_progressions[to_acc]) {
            account_progressions[to_acc] = [];
            running_balances[to_acc] = 0;
        }

        // Record the progression
        let from_before = running_balances[from_acc];
        let to_before = running_balances[to_acc];

        running_balances[from_acc] -= amount;
        running_balances[to_acc] += amount;

        account_progressions[from_acc].push({
            transfer_idx: i + 1,
            before: from_before,
            after: running_balances[from_acc],
            change: -amount,
            type: 'from'
        });

        account_progressions[to_acc].push({
            transfer_idx: i + 1,
            before: to_before,
            after: running_balances[to_acc],
            change: amount,
            type: 'to'
        });

        // Add to transfer sequence for step-by-step view
        transfer_sequence.push({
            idx: i + 1,
            from_account: from_acc,
            to_account: to_acc,
            amount: amount,
            from_before: from_before,
            from_after: running_balances[from_acc],
            to_before: to_before,
            to_after: running_balances[to_acc]
        });
    }

    let html = '<div class="row">';

    // Left column: Step-by-step transfer sequence
    html += `
        <div class="col-md-6">
            <h6 style="color: #495057; margin-bottom: 15px; font-weight: 600;">
                <i class="fa fa-list-ol" style="margin-right: 5px; color: #007bff;"></i>
                Transfer Sequence
            </h6>
    `;

    for (let transfer of transfer_sequence) {
        html += `
            <div style="margin-bottom: 15px; padding: 15px; border: 1px solid #e9ecef; border-radius: 6px; background: white;">
                <div style="font-weight: 600; color: #495057; margin-bottom: 10px; font-size: 14px;">
                    Transfer ${transfer.idx}: K ${transfer.amount.toLocaleString()}
                </div>

                <div style="margin-bottom: 8px;">
                    <div style="color: #dc3545; font-weight: 500; margin-bottom: 2px;">FROM: ${transfer.from_account}</div>
                    <div style="font-weight: bold; color: #dc3545; padding-left: 10px;">
                        ${transfer.from_before === 0 ?
                            `K -${Math.abs(transfer.amount).toLocaleString()}` :
                            `K ${transfer.from_before.toLocaleString()} → K ${transfer.from_after.toLocaleString()}`
                        }
                    </div>
                </div>

                <div>
                    <div style="color: #28a745; font-weight: 500; margin-bottom: 2px;">TO: ${transfer.to_account}</div>
                    <div style="font-weight: bold; color: #28a745; padding-left: 10px;">
                        ${transfer.to_before === 0 ?
                            `K ${transfer.amount.toLocaleString()}` :
                            `K ${transfer.to_before.toLocaleString()} → K ${transfer.to_after.toLocaleString()}`
                        }
                    </div>
                </div>
            </div>
        `;
    }

    html += '</div>';

    // Right column: Account impact summary
    html += `
        <div class="col-md-6">
            <h6 style="color: #495057; margin-bottom: 15px; font-weight: 600;">
                <i class="fa fa-chart-bar" style="margin-right: 5px; color: #28a745;"></i>
                Account Impact Summary
            </h6>
    `;

    for (let account in account_progressions) {
        let progressions = account_progressions[account];
        let final_change = running_balances[account];

        html += `
            <div style="margin-bottom: 12px; padding: 12px; border: 1px solid #e9ecef; border-radius: 6px; background: white;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <strong style="color: #495057; font-size: 14px;">${account}</strong>
                    <span class="badge ${final_change >= 0 ? 'badge-success' : 'badge-danger'}" style="font-size: 11px;">
                        ${final_change >= 0 ? '+' : ''}K ${Math.abs(final_change).toLocaleString()}
                    </span>
                </div>
                <div style="font-size: 12px; color: #6c757d;">
        `;

        for (let prog of progressions) {
            let change_text = prog.change >= 0 ? `+K ${prog.change.toLocaleString()}` : `-K ${Math.abs(prog.change).toLocaleString()}`;
            let arrow_color = prog.type === 'from' ? '#dc3545' : '#28a745';
            let icon = prog.type === 'from' ? 'fa-arrow-up' : 'fa-arrow-down';

            html += `
                <div style="margin-bottom: 2px; display: flex; justify-content: space-between;">
                    <span>Transfer ${prog.transfer_idx}:</span>
                    <span style="color: ${arrow_color};">
                        <i class="fa ${icon}" style="font-size: 10px; margin-right: 3px;"></i>
                        ${change_text}
                    </span>
                </div>
            `;
        }

        html += `
                </div>
            </div>
        `;
    }

    html += '</div></div>';

    // Add total summary footer
    let total_amount = frm.doc.transfer_items.reduce((sum, item) => sum + flt(item.amount_requested || 0), 0);
    let complete_transfers = transfer_sequence.length;
    let total_transfers = frm.doc.transfer_items.length;

    html += `
        <div style="margin-top: 25px; padding: 20px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 8px; border: 1px solid #dee2e6;">
            <div class="row text-center">
                <div class="col-md-4">
                    <div style="font-size: 28px; font-weight: bold; color: #007bff; margin-bottom: 5px;">
                        K ${total_amount.toLocaleString()}
                    </div>
                    <div style="font-size: 13px; color: #6c757d; text-transform: uppercase; font-weight: 500;">
                        TOTAL AMOUNT
                    </div>
                </div>
                <div class="col-md-4">
                    <div style="font-size: 28px; font-weight: bold; color: ${complete_transfers === total_transfers ? '#28a745' : '#ffc107'}; margin-bottom: 5px;">
                        ${complete_transfers}/${total_transfers}
                    </div>
                    <div style="font-size: 13px; color: #6c757d; text-transform: uppercase; font-weight: 500;">
                        COMPLETE TRANSFERS
                    </div>
                </div>
                <div class="col-md-4">
                    <div style="font-size: 28px; font-weight: bold; color: #6f42c1; margin-bottom: 5px;">
                        ${Object.keys(account_progressions).length}
                    </div>
                    <div style="font-size: 13px; color: #6c757d; text-transform: uppercase; font-weight: 500;">
                        AFFECTED ACCOUNTS
                    </div>
                </div>
            </div>
        </div>
    `;

    return html;
}

function refresh_inline_summary_if_visible(frm) {
    // Refresh the accordion progressive summary if it's currently visible
    if (frm._accordion_summary_visible) {
        // Look for accordion in cards container first, then fallback to transfer items section
        let summary_wrapper = $('.modern-transfer-cards-container .accordion-progressive-summary .summary-content');
        if (summary_wrapper.length === 0) {
            let transfer_items_section = frm.get_field('transfer_items');
            if (transfer_items_section && transfer_items_section.$wrapper) {
                summary_wrapper = transfer_items_section.$wrapper.find('.accordion-progressive-summary .summary-content');
            }
        }

        if (summary_wrapper.length > 0) {
            // Update the summary content
            let new_html = generate_accordion_progressive_summary_html(frm);
            summary_wrapper.html(new_html);
        }
    }
}

function refresh_all_transfer_item_dropdowns(frm) {
    // Simple approach: just re-setup the queries
    // The queries will be re-evaluated when the dropdowns are next opened
    console.log('Re-setting up transfer item filters for progressive balances...');

    // Re-setup the queries - this is safer than trying to manipulate DOM directly
    setTimeout(() => {
        setup_transfer_item_filters(frm);
    }, 100);
}

function test_progressive_balance_calculation(frm) {
    // Test function to debug progressive balance calculations
    console.log('=== TESTING PROGRESSIVE BALANCE CALCULATION ===');

    if (!frm.doc.transfer_items || frm.doc.transfer_items.length === 0) {
        frappe.msgprint('No transfer items to test');
        return;
    }

    // Test progressive balance calculation for each row
    for (let i = 0; i < frm.doc.transfer_items.length; i++) {
        let progressive_balances = calculate_client_side_progressive_balances(frm, i);
        console.log(`Row ${i} progressive balances:`, progressive_balances);

        // Test API call
        frappe.call({
            method: 'wcfcb_zm.api.budget_request.get_budget_accounts_with_progressive',
            args: {
                filters: {
                    'budget': frm.doc.budget,
                    'progressive_balances': JSON.stringify(progressive_balances),
                    '_timestamp': Date.now()
                }
            },
            callback: function(r) {
                console.log(`Row ${i} API response:`, r.message);
            }
        });
    }

    frappe.msgprint('Check console for progressive balance test results');
}

function initialize_modern_transfer_interface(frm) {
    // Initialize the modern card-based transfer items interface

    // Force hide the table completely for all document states
    if (frm.fields_dict.transfer_items) {
        frm.fields_dict.transfer_items.wrapper.style.display = 'none';
        frm.fields_dict.transfer_items.$wrapper.hide();

        // Also hide any table headers or controls
        frm.fields_dict.transfer_items.$wrapper.find('.grid-heading-row').hide();
        frm.fields_dict.transfer_items.$wrapper.find('.grid-add-row').hide();
        frm.fields_dict.transfer_items.$wrapper.find('.grid-footer').hide();
    }

    // Create modern card interface container
    create_modern_transfer_cards_container(frm);

    // Load existing transfer items into cards
    refresh_transfer_cards(frm);
}

function create_modern_transfer_cards_container(frm) {
    // Find the Multi-Account Transfers section
    let target_section = null;

    // Look for the section containing transfer_items field
    if (frm.fields_dict.transfer_items && frm.fields_dict.transfer_items.$wrapper) {
        target_section = frm.fields_dict.transfer_items.$wrapper.closest('.section-body');
    }

    // Fallback to budget field section if transfer_items section not found
    if (!target_section && frm.fields_dict.budget && frm.fields_dict.budget.$wrapper) {
        target_section = frm.fields_dict.budget.$wrapper.closest('.section-body');
    }

    if (!target_section || target_section.length === 0) {
        console.log('Could not find target section for modern cards container');
        return;
    }

    // Remove existing container if present
    $('.modern-transfer-cards-container').remove();

    // Create the modern cards container with Frappe styling
    let cards_html = `
        <div class="modern-transfer-cards-container" style="margin: 15px 0;">
            <div class="section-head" style="margin-bottom: 15px;">
                <label class="control-label" style="font-weight: 600; color: #36414C; margin-bottom: 0;">
                    Transfer Items
                </label>
            </div>
            <div class="transfer-cards-list">
                <!-- Transfer cards will be inserted here -->
            </div>
            <div class="grid-add-row" style="margin-top: 10px; ${frm.doc.docstatus !== 0 ? 'display: none;' : ''}">
                <button class="btn btn-xs btn-default grid-add-row add-transfer-btn" style="margin-right: 5px;">
                    <i class="octicon octicon-plus" style="margin-right: 4px;"></i>
                    Add Row
                </button>
            </div>
        </div>
    `;

    // Insert at the beginning of the target section
    target_section.prepend(cards_html);

    // Bind add transfer button
    target_section.find('.add-transfer-btn').on('click', function() {
        add_new_transfer_card(frm);
    });
}

function add_new_transfer_card(frm) {
    // Add a new transfer item to the backend table
    let new_row = frappe.model.add_child(frm.doc, 'Budget Request Item', 'transfer_items');

    // Refresh the cards display
    refresh_transfer_cards(frm);

    // Focus on the new card
    setTimeout(() => {
        let new_card = $(`.transfer-card[data-idx="${new_row.idx}"]`);
        if (new_card.length > 0) {
            new_card[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            new_card.find('.from-account-select').focus();
        }
    }, 100);
}

function refresh_transfer_cards(frm) {
    // Refresh all transfer cards based on current transfer_items data
    let cards_container = $('.transfer-cards-list');
    if (cards_container.length === 0) {
        return;
    }

    // Clear existing cards
    cards_container.empty();

    // Create cards for each transfer item
    if (frm.doc.transfer_items && frm.doc.transfer_items.length > 0) {
        frm.doc.transfer_items.forEach((item, index) => {
            create_transfer_card(frm, item, index, cards_container);
        });
    } else {
        // Show empty state
        cards_container.html(`
            <div class="empty-state" style="text-align: center; padding: 30px; color: #8D99AE; background: #fafbfc; border: 1px dashed #d1d8dd; border-radius: 4px;">
                <div style="font-size: 13px;">No transfer items</div>
                <div style="font-size: 11px; margin-top: 5px;">Click "Add Row" to add transfer items</div>
            </div>
        `);
    }

    // Update the existing accordion progressive summary
    refresh_inline_summary_if_visible(frm);
}

function create_transfer_card(frm, item, index, container) {
    // No balance display needed in cards - keep it clean

    let card_html = `
        <div class="transfer-card" data-idx="${item.idx}" style="
            background: #fafbfc;
            border: 1px solid #d1d8dd;
            border-radius: 4px;
            padding: 15px;
            margin-bottom: 10px;
            position: relative;
        ">
            <div class="row" style="margin: 0;">
                <div class="col-sm-5" style="padding-right: 8px;">
                    <div class="frappe-control">
                        <label class="control-label" style="font-size: 11px; color: #8D99AE; margin-bottom: 4px;">From Account</label>
                        <select class="form-control from-account-select" data-idx="${item.idx}" style="font-size: 13px; height: 30px;" ${frm.doc.docstatus !== 0 ? 'disabled' : ''}>
                            <option value="">Select account...</option>
                        </select>
                        <div class="new-balance-display from-balance" data-idx="${item.idx}" style="font-size: 11px; color: #8D99AE; margin-top: 2px; min-height: 14px;">
                            <!-- New balance will be shown here -->
                        </div>
                    </div>
                </div>

                <div class="col-sm-5" style="padding-left: 8px; padding-right: 8px;">
                    <div class="frappe-control">
                        <label class="control-label" style="font-size: 11px; color: #8D99AE; margin-bottom: 4px;">To Account</label>
                        <select class="form-control to-account-select" data-idx="${item.idx}" style="font-size: 13px; height: 30px;" ${frm.doc.docstatus !== 0 ? 'disabled' : ''}>
                            <option value="">Select account...</option>
                        </select>
                        <div class="new-balance-display to-balance" data-idx="${item.idx}" style="font-size: 11px; color: #8D99AE; margin-top: 2px; min-height: 14px;">
                            <!-- New balance will be shown here -->
                        </div>
                    </div>
                </div>

                <div class="col-sm-2" style="padding-left: 8px;">
                    <div class="frappe-control">
                        <label class="control-label" style="font-size: 11px; color: #8D99AE; margin-bottom: 4px;">Amount</label>
                        <div style="display: flex; align-items: center;">
                            <input type="number" class="form-control amount-input" data-idx="${item.idx}"
                                   value="${item.amount_requested || ''}"
                                   placeholder="0.00"
                                   style="font-size: 13px; height: 30px; text-align: right; flex: 1;" ${frm.doc.docstatus !== 0 ? 'disabled' : ''}>
                            <button class="btn btn-xs remove-card-btn" data-idx="${item.idx}"
                                    style="margin-left: 5px; color: #d1d8dd; border: none; background: none; padding: 2px 4px; ${frm.doc.docstatus !== 0 ? 'display: none;' : ''}"
                                    title="Remove">
                                <i class="fa fa-remove" style="font-size: 12px;"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    container.append(card_html);

    // Populate dropdowns and bind events
    populate_card_dropdowns(frm, item, index);
    bind_card_events(frm, item.idx);

    // Update new balance displays
    update_card_balance_displays(frm, item.idx);
}

function get_progressive_balance_display(frm, account, budget, progressive_balances, current_index) {
    if (!account || !budget) {
        return '<span style="color: #8D99AE;">Select account to see balance</span>';
    }

    // Get original balance
    frappe.call({
        method: 'wcfcb_zm.api.budget_request.get_amount',
        args: {
            budget: budget,
            account: account
        },
        async: false,
        callback: function(r) {
            if (r.message !== undefined) {
                window._temp_original_balance = r.message;
            }
        }
    });

    let original_balance = window._temp_original_balance || 0;
    let progressive_key = `${account}|${budget}`;
    let progressive_change = progressive_balances[progressive_key] || 0;
    let current_balance = original_balance + progressive_change;

    if (progressive_change !== 0) {
        return `<strong>K ${original_balance.toLocaleString()} → K ${current_balance.toLocaleString()}</strong>`;
    } else {
        return `<strong>K ${original_balance.toLocaleString()}</strong>`;
    }
}

function update_card_balance_displays(frm, idx) {
    // Update the new balance displays for a specific card
    let item = frm.doc.transfer_items.find(i => i.idx === idx);
    if (!item) return;

    let amount = flt(item.amount_requested || 0);

    // Calculate progressive balances up to this point (before this transfer)
    let item_index = get_item_index(frm, idx);
    let progressive_balances = calculate_client_side_progressive_balances(frm, item_index);

    // Update FROM account balance (original + progressive - this transfer amount)
    if (item.from_account && frm.doc.budget) {
        let progressive_key = `${item.from_account}|${frm.doc.budget}`;
        let progressive_change = progressive_balances[progressive_key] || 0;
        update_balance_with_original_and_change(frm, item.from_account, frm.doc.budget, progressive_change - amount, `.from-balance[data-idx="${idx}"]`);
    }

    // Update TO account balance (original + progressive + this transfer amount)
    let to_budget = frm.doc.virement_type === 'Inter-Budget' ? frm.doc.target_budget : frm.doc.budget;
    if (item.to_account && to_budget) {
        let progressive_key = `${item.to_account}|${to_budget}`;
        let progressive_change = progressive_balances[progressive_key] || 0;
        update_balance_with_original_and_change(frm, item.to_account, to_budget, progressive_change + amount, `.to-balance[data-idx="${idx}"]`);
    }
}

function update_balance_with_original_and_change(frm, account, budget, total_change, selector) {
    // Get original balance and apply the total change
    let cache_key = `${account}|${budget}`;

    if (frm._balance_cache && frm._balance_cache[cache_key] !== undefined) {
        // Use cached balance
        let original_amount = frm._balance_cache[cache_key];
        let new_amount = original_amount + total_change;
        $(selector).html(`<span style="color: ${new_amount >= 0 ? '#28a745' : '#dc3545'};">New Balance: K ${new_amount.toLocaleString()}</span>`);
    } else {
        // Fetch from API and cache
        frappe.call({
            method: 'wcfcb_zm.api.budget_request.get_amount',
            args: {
                budget: budget,
                account: account
            },
            callback: function(r) {
                if (r.message !== undefined) {
                    // Cache the balance
                    if (!frm._balance_cache) frm._balance_cache = {};
                    frm._balance_cache[cache_key] = r.message;

                    let original_amount = r.message;
                    let new_amount = original_amount + total_change;
                    $(selector).html(`<span style="color: ${new_amount >= 0 ? '#28a745' : '#dc3545'};">New Balance: K ${new_amount.toLocaleString()}</span>`);
                }
            }
        });
    }
}

function update_single_balance_display(frm, account, budget, amount_change, selector) {
    // Use cached balance if available, otherwise fetch from API
    let cache_key = `${account}|${budget}`;

    if (frm._balance_cache && frm._balance_cache[cache_key] !== undefined) {
        // Use cached balance
        let current_amount = frm._balance_cache[cache_key];
        let new_amount = current_amount + amount_change;
        $(selector).html(`<span style="color: ${amount_change >= 0 ? '#28a745' : '#dc3545'};">New Balance: K ${new_amount.toLocaleString()}</span>`);
    } else {
        // Fetch from API and cache
        frappe.call({
            method: 'wcfcb_zm.api.budget_request.get_amount',
            args: {
                budget: budget,
                account: account
            },
            callback: function(r) {
                if (r.message !== undefined) {
                    // Cache the balance
                    if (!frm._balance_cache) frm._balance_cache = {};
                    frm._balance_cache[cache_key] = r.message;

                    let current_amount = r.message;
                    let new_amount = current_amount + amount_change;
                    $(selector).html(`<span style="color: ${amount_change >= 0 ? '#28a745' : '#dc3545'};">New Balance: K ${new_amount.toLocaleString()}</span>`);
                }
            }
        });
    }
}

function populate_card_dropdowns(frm, item, index) {
    // Populate FROM account dropdown
    populate_from_account_dropdown(frm, item, index);

    // Populate TO account dropdown
    populate_to_account_dropdown(frm, item, index);
}

function populate_from_account_dropdown(frm, item, index) {
    if (!frm.doc.budget) return;

    let progressive_balances = calculate_client_side_progressive_balances(frm, index);

    frappe.call({
        method: 'wcfcb_zm.api.budget_request.get_budget_accounts_with_progressive',
        args: {
            filters: {
                'budget': frm.doc.budget,
                'progressive_balances': JSON.stringify(progressive_balances)
            }
        },
        callback: function(r) {
            if (r.message) {
                let select = $(`.from-account-select[data-idx="${item.idx}"]`);
                select.empty().append('<option value="">Select account...</option>');

                r.message.forEach(function(account) {
                    let selected = account[0] === item.from_account ? 'selected' : '';
                    select.append(`<option value="${account[0]}" ${selected}>${account[1]}</option>`);
                });
            }
        }
    });
}

function populate_to_account_dropdown(frm, item, index) {
    let target_budget = frm.doc.virement_type === 'Inter-Budget' ? frm.doc.target_budget : frm.doc.budget;
    if (!target_budget) return;

    let progressive_balances = calculate_client_side_progressive_balances(frm, index, target_budget);

    frappe.call({
        method: 'wcfcb_zm.api.budget_request.get_budget_accounts_with_progressive',
        args: {
            filters: {
                'budget': target_budget,
                'exclude_account': frm.doc.virement_type === 'Intra-Budget' ? item.from_account : null,
                'progressive_balances': JSON.stringify(progressive_balances)
            }
        },
        callback: function(r) {
            if (r.message) {
                let select = $(`.to-account-select[data-idx="${item.idx}"]`);
                select.empty().append('<option value="">Select account...</option>');

                r.message.forEach(function(account) {
                    let selected = account[0] === item.to_account ? 'selected' : '';
                    select.append(`<option value="${account[0]}" ${selected}>${account[1]}</option>`);
                });
            }
        }
    });
}

function bind_card_events(frm, idx) {
    // Bind FROM account change
    $(`.from-account-select[data-idx="${idx}"]`).on('change', function() {
        let account = $(this).val();
        let item = frm.doc.transfer_items.find(i => i.idx === idx);
        if (item) {
            item.from_account = account;
            refresh_single_card(frm, idx);
            update_card_balance_displays(frm, idx);
            refresh_inline_summary_if_visible(frm);
        }
    });

    // Bind TO account change
    $(`.to-account-select[data-idx="${idx}"]`).on('change', function() {
        let account = $(this).val();
        let item = frm.doc.transfer_items.find(i => i.idx === idx);
        if (item) {
            item.to_account = account;
            refresh_single_card(frm, idx);
            update_card_balance_displays(frm, idx);
            refresh_inline_summary_if_visible(frm);
        }
    });

    // Bind amount change
    $(`.amount-input[data-idx="${idx}"]`).on('input', function() {
        let amount = flt($(this).val());
        let item = frm.doc.transfer_items.find(i => i.idx === idx);
        if (item) {
            item.amount_requested = amount;
            refresh_all_cards_after_index(frm, get_item_index(frm, idx));
            update_card_balance_displays(frm, idx);
            refresh_inline_summary_if_visible(frm);
        }
    });

    // Bind remove button
    $(`.remove-card-btn[data-idx="${idx}"]`).on('click', function() {
        remove_transfer_card(frm, idx);
    });
}

function refresh_single_card(frm, idx) {
    // Refresh a single card's dropdowns and balances
    let item = frm.doc.transfer_items.find(i => i.idx === idx);
    if (!item) return;

    let index = get_item_index(frm, idx);
    populate_card_dropdowns(frm, item, index);

    // Update balance displays
    let progressive_balances = calculate_client_side_progressive_balances(frm, index);
    let from_balance = get_progressive_balance_display(frm, item.from_account, frm.doc.budget, progressive_balances, index);
    let to_balance = get_progressive_balance_display(frm, item.to_account,
        frm.doc.virement_type === 'Inter-Budget' ? frm.doc.target_budget : frm.doc.budget,
        progressive_balances, index);

    $(`.transfer-card[data-idx="${idx}"] .from-section .balance-display`).html(from_balance);
    $(`.transfer-card[data-idx="${idx}"] .to-section .balance-display`).html(to_balance);
}

function refresh_all_cards_after_index(frm, start_index) {
    // Refresh all cards from start_index onwards (for progressive balance updates)
    if (!frm.doc.transfer_items) return;

    for (let i = start_index; i < frm.doc.transfer_items.length; i++) {
        let item = frm.doc.transfer_items[i];
        refresh_single_card(frm, item.idx);
    }
}

function get_item_index(frm, idx) {
    // Get the index of an item by its idx
    if (!frm.doc.transfer_items) return -1;
    return frm.doc.transfer_items.findIndex(i => i.idx === idx);
}

function remove_transfer_card(frm, idx) {
    // Remove a transfer card and update the backend
    frappe.confirm('Remove this transfer?', function() {
        // Remove from backend
        frm.doc.transfer_items = frm.doc.transfer_items.filter(i => i.idx !== idx);

        // Refresh all cards
        refresh_transfer_cards(frm);

        // Update form
        frm.dirty();
    });
}

function update_progressive_summary(frm) {
    // Update the progressive summary at the bottom
    let summary_container = $('.progressive-summary-container');
    if (summary_container.length === 0) return;

    if (!frm.doc.transfer_items || frm.doc.transfer_items.length === 0) {
        summary_container.empty();
        return;
    }

    // Generate the same accordion summary as before
    let summary_html = generate_accordion_progressive_summary_html(frm);

    summary_container.html(`
        <div class="card" style="border: 1px solid #dee2e6; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <div class="card-header" style="background: linear-gradient(135deg, #347FB6 0%, #ED8643 100%); border-radius: 8px 8px 0 0; cursor: pointer;"
                 onclick="$(this).next('.card-body').slideToggle(); $(this).find('.toggle-icon').toggleClass('fa-chevron-down fa-chevron-up');">
                <h6 style="margin: 0; color: white; font-weight: 600; display: flex; align-items: center; justify-content: space-between;">
                    <span>
                        <i class="fa fa-chart-line" style="margin-right: 8px;"></i>
                        Transfer Summary
                    </span>
                    <i class="fa fa-chevron-down toggle-icon" style="transition: transform 0.3s ease;"></i>
                </h6>
            </div>
            <div class="card-body" style="padding: 20px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; display: none;">
                <div class="summary-content">
                    ${summary_html}
                </div>
            </div>
        </div>
    `);
}



function generate_transfer_details_html(frm) {
    if (is_multi_transfer_mode(frm)) {
        // Multi-transfer mode
        let total_amount = 0;
        let transfer_items_html = '';

        frm.doc.transfer_items.forEach(function(item, index) {
            if (item.amount_requested) {
                total_amount += flt(item.amount_requested);
                transfer_items_html += `
                    <li><strong>Transfer ${index + 1}:</strong> K ${Math.abs(item.amount_requested || 0).toLocaleString()}
                        from ${item.from_account} to ${item.to_account}</li>
                `;
            }
        });

        return `
            <div style="background: #f8f9fa; padding: 12px; border-radius: 4px; margin-bottom: 15px;">
                <h5 style="margin-bottom: 10px;">Multi-Transfer Details:</h5>
                <ul style="margin: 0; padding-left: 20px;">
                    <li><strong>Type:</strong> ${frm.doc.virement_type}</li>
                    <li><strong>Total Amount:</strong> K ${Math.abs(total_amount).toLocaleString()}</li>
                    <li><strong>Number of Transfers:</strong> ${frm.doc.transfer_items.length}</li>
                    <li><strong>Budget:</strong> ${frm.doc.budget}</li>
                    ${frm.doc.target_budget ? '<li><strong>Target Budget:</strong> ' + frm.doc.target_budget + '</li>' : ''}
                </ul>
                <h6 style="margin-top: 15px; margin-bottom: 10px;">Individual Transfers:</h6>
                <ul style="margin: 0; padding-left: 20px;">
                    ${transfer_items_html}
                </ul>
            </div>
        `;
    } else {
        // Single-transfer mode (backward compatibility)
        return `
            <div style="background: #f8f9fa; padding: 12px; border-radius: 4px; margin-bottom: 15px;">
                <h5 style="margin-bottom: 10px;">Transfer Details:</h5>
                <ul style="margin: 0; padding-left: 20px;">
                    <li><strong>Type:</strong> ${frm.doc.virement_type}</li>
                    <li><strong>Amount:</strong> K ${Math.abs(frm.doc.amount_requested || 0).toLocaleString()}</li>
                    <li><strong>From:</strong> ${frm.doc.expense_account}</li>
                    <li><strong>To:</strong> ${frm.doc.to_expense_account}</li>
                    <li><strong>Budget:</strong> ${frm.doc.budget}</li>
                    ${frm.doc.target_budget ? '<li><strong>Target Budget:</strong> ' + frm.doc.target_budget + '</li>' : ''}
                </ul>
            </div>
        `;
    }
}

function setup_field_dependencies(frm) {
    // Check if this is an amended document that we're still copying fields for
    const is_amended_doc = frm.doc.amended_from && frm.is_new();

    // Only set up dependencies for new documents (but not amended docs during field copying)
    // For saved documents, just update field states without clearing values
    if ((frm.is_new() || frm.doc.__islocal) && !is_amended_doc) {
        if (frm.doc.virement_type) {
            handle_virement_type_change(frm);
        } else {
            // Disable all fields until virement type is selected
            disable_dependent_fields(frm);
        }
    } else {
        // For saved documents or amended docs, just update field enabling/disabling
        disable_dependent_fields(frm);

        // Set up queries based on existing values without clearing
        if (frm.doc.virement_type) {
            setup_queries_for_existing_doc(frm);
        }
    }

    // Check amount for external approval requirement (only for relevant states)
    const final_states = ['Approved', 'Rejected'];
    if (final_states.includes(frm.doc.workflow_state) || frm.doc.docstatus === 2) {
        // Clear any existing messages for final states or cancelled documents
        clear_external_approval_message(frm);
    } else {
        handle_threshold_validation(frm);
    }

    // Force refresh of all relevant fields
    frm.refresh_field('budget');
    frm.refresh_field('target_budget');
    frm.refresh_field('expense_account');
    frm.refresh_field('to_expense_account');
}

function disable_dependent_fields(frm) {
    // Disable fields until prerequisites are met
    frm.set_df_property('budget', 'read_only', !frm.doc.virement_type);
    frm.set_df_property('target_budget', 'read_only', !frm.doc.virement_type);

    // Only manage legacy fields for existing requests (not new ones)
    if (!frm.is_new()) {
        frm.set_df_property('expense_account', 'read_only', !frm.doc.budget);
        frm.set_df_property('to_expense_account', 'read_only', !can_enable_to_account(frm));
    }
}

function can_enable_to_account(frm) {
    // TO account can only be enabled when all prerequisites are met
    if (!frm.doc.virement_type || !frm.doc.budget) {
        return false;
    }

    if (frm.doc.virement_type === 'Inter-Budget') {
        // For Inter-Budget: need virement_type, budget, target_budget
        return frm.doc.target_budget;
    } else if (frm.doc.virement_type === 'Intra-Budget') {
        // For Intra-Budget: need virement_type, budget, expense_account
        return frm.doc.expense_account;
    }

    return false;
}

function handle_virement_type_change(frm) {
    // Don't clear fields if we're copying from amended document
    if (frm._copying_amended_fields) return;

    // Only clear fields if this is a new document or user is actively changing virement type
    if (frm.is_new() || frm.doc.__islocal) {
        // Clear ALL dependent fields when virement type changes
        frm.set_value('budget', '');
        frm.set_value('target_budget', '');
        frm.set_value('expense_account', '');
        frm.set_value('to_expense_account', '');
    }

    // Clear all field queries
    frm.set_query('budget', function() { return {}; });
    frm.set_query('target_budget', function() { return {}; });
    frm.set_query('expense_account', function() { return {}; });
    frm.set_query('to_expense_account', function() { return {}; });

    if (frm.doc.virement_type === 'Inter-Budget') {
        // Inter-Budget: Show target_budget field, make it required
        frm.set_df_property('target_budget', 'hidden', 0);
        frm.set_df_property('target_budget', 'reqd', 1);
        frm.set_df_property('target_budget', 'read_only', 0);

        // Enable budget field
        frm.set_df_property('budget', 'read_only', 0);

        // Filter source budget to show all budgets
        frm.set_query('budget', function() {
            return {
                filters: {
                    'docstatus': 1
                }
            };
        });

        // Clear target budget query initially
        frm.set_query('target_budget', function() {
            return {
                filters: {
                    'docstatus': 1
                }
            };
        });

    } else if (frm.doc.virement_type === 'Intra-Budget') {
        // Intra-Budget: Hide target_budget field, not required
        frm.set_df_property('target_budget', 'hidden', 1);
        frm.set_df_property('target_budget', 'reqd', 0);
        frm.set_df_property('target_budget', 'read_only', 1);

        // Enable budget field
        frm.set_df_property('budget', 'read_only', 0);

        // Set source budget query to only show multi-account budgets
        frappe.call({
            method: 'wcfcb_zm.api.budget_request.budget_virement_handler',
            args: {
                'action': 'get_multi_account_budgets'
            },
            callback: function(r) {
                if (r.message && r.message.success) {
                    let budget_names = r.message.data.map(b => b.value);
                    frm.set_query('budget', function() {
                        return {
                            filters: [
                                ['Budget', 'name', 'in', budget_names],
                                ['Budget', 'docstatus', '=', 1]
                            ]
                        };
                    });
                    frm.refresh_field('budget');
                }
            }
        });
    }

    // Update field states
    disable_dependent_fields(frm);

    // Field visibility and behavior will be handled by force_multi_transfer_mode() ALWAYS
}

function handle_budget_change(frm) {
    // Don't auto-populate if we're copying from amended document
    if (frm._copying_amended_fields) return;

    if (frm.doc.budget) {
        if (frm.doc.virement_type === 'Intra-Budget') {
            // Auto-populate target_budget with source budget for intra-transfers
            frm.set_value('target_budget', frm.doc.budget);
        } else if (frm.doc.virement_type === 'Inter-Budget') {
            // Update target budget query to exclude selected source budget
            frm.set_query('target_budget', function() {
                return {
                    filters: [
                        ['Budget', 'docstatus', '=', 1],
                        ['Budget', 'name', '!=', frm.doc.budget]
                    ]
                };
            });
            frm.refresh_field('target_budget');
        }

        // For legacy requests only - set FROM account query based on source budget
        if (!frm.is_new()) {
            frappe.call({
                method: 'wcfcb_zm.api.budget_request.budget_virement_handler',
                args: {
                    'action': 'get_budget_accounts',
                    'budget': frm.doc.budget
                },
                callback: function(r) {
                    if (r.message && r.message.success) {
                        let account_names = r.message.data.map(a => a.value);
                        frm.set_query('expense_account', function() {
                            return {
                                filters: [
                                    ['Account', 'name', 'in', account_names]
                                ]
                            };
                        });
                        frm.refresh_field('expense_account');
                    }
                }
            });

            // Clear expense_account when budget changes
            frm.set_value('expense_account', '');

            // Enable expense_account field now that budget is selected
            frm.set_df_property('expense_account', 'read_only', 0);
        }
    }

    // ALWAYS clear TO account and its query when source budget changes
    frm.set_value('to_expense_account', '');
    frm.set_query('to_expense_account', function() { return {}; });

    // Update field states
    disable_dependent_fields(frm);
    frm.refresh_field('to_expense_account');
}

function handle_target_budget_change(frm) {
    if (frm.doc.target_budget && frm.doc.virement_type === 'Inter-Budget') {
        // For legacy requests only - set TO account filter based on target budget for Inter-Budget transfers
        if (!frm.is_new()) {
            frappe.call({
                method: 'wcfcb_zm.api.budget_request.budget_virement_handler',
                args: {
                    'action': 'get_budget_accounts',
                    'budget': frm.doc.target_budget
                },
                callback: function(r) {
                    if (r.message && r.message.success) {
                        let account_names = r.message.data.map(a => a.value);
                        frm.set_query('to_expense_account', function() {
                            return {
                                filters: [
                                    ['Account', 'name', 'in', account_names]
                                ]
                            };
                        });
                        frm.refresh_field('to_expense_account');
                    }
                }
            });

            // Clear TO account when target budget changes
            frm.set_value('to_expense_account', '');

            // Update field states - TO account can now be enabled for Inter-Budget
            disable_dependent_fields(frm);
        }
    }
}

function handle_expense_account_change(frm) {
    // For legacy requests only
    if (!frm.is_new()) {
        // ALWAYS clear TO account when FROM account changes
        frm.set_value('to_expense_account', '');

        if (frm.doc.expense_account && frm.doc.virement_type === 'Intra-Budget') {
            // Update TO account filter to exclude selected FROM account for Intra-Budget
            frappe.call({
                method: 'wcfcb_zm.api.budget_request.budget_virement_handler',
                args: {
                    'action': 'get_budget_accounts',
                    'budget': frm.doc.budget,
                    'exclude_account': frm.doc.expense_account
                },
                callback: function(r) {
                    if (r.message && r.message.success) {
                        let account_names = r.message.data.map(a => a.value);
                        frm.set_query('to_expense_account', function() {
                            return {
                                filters: [
                                    ['Account', 'name', 'in', account_names]
                                ]
                            };
                        });
                        frm.refresh_field('to_expense_account');
                    }
                }
            });
        }

        // Update field states - TO account can now be enabled for Intra-Budget
        disable_dependent_fields(frm);
    }
}

function handle_to_expense_account_change(frm) {
    // Validation: TO account cannot be same as FROM account
    if (frm.doc.to_expense_account && frm.doc.expense_account === frm.doc.to_expense_account) {
        frappe.msgprint(__('TO account cannot be the same as FROM account'));
        frm.set_value('to_expense_account', '');
        return;
    }
}

function validate_virement_request(frm) {
    // Final validation before save
    if (frm.doc.virement_type === 'Inter-Budget') {
        if (frm.doc.budget === frm.doc.target_budget) {
            frappe.msgprint(__('Target budget must be different from source budget for Inter-Budget transfers'));
            return false;
        }
    }

    // Force new requests to use multi-transfer mode only
    if (frm.is_new() && !is_multi_transfer_mode(frm)) {
        frappe.msgprint(__('New Budget Requests must use the Transfer Items table. Please add your transfers using the table below.'));
        return false;
    }

    // Check if using multi-transfer mode
    if (is_multi_transfer_mode(frm)) {
        // Multi-transfer validation
        if (!frm.doc.transfer_items || frm.doc.transfer_items.length === 0) {
            frappe.msgprint(__('At least one transfer item is required for multi-transfer mode'));
            return false;
        }

        // Validate each transfer item
        for (let i = 0; i < frm.doc.transfer_items.length; i++) {
            let item = frm.doc.transfer_items[i];

            if (!item.from_account || !item.to_account || !item.amount_requested) {
                frappe.msgprint(__(`Transfer item ${i + 1}: All fields (From Account, To Account, Amount) are required`));
                return false;
            }

            // For intra-budget transfers, from and to accounts must be different
            // For inter-budget transfers, accounts can be the same (transferring between budgets)
            if (frm.doc.virement_type === 'Intra-Budget' && item.from_account === item.to_account) {
                frappe.msgprint(__(`Transfer item ${i + 1}: For Intra-Budget transfers, FROM and TO accounts must be different`));
                return false;
            }

            if (item.amount_requested <= 0) {
                frappe.msgprint(__(`Transfer item ${i + 1}: Amount must be greater than zero`));
                return false;
            }
        }

        // Ensure single-transfer account fields are empty in multi-transfer mode
        // (amount_requested is now used as total display, so exclude it from this check)
        if (frm.doc.expense_account || frm.doc.to_expense_account) {
            frappe.msgprint(__('Please use either single-transfer fields OR multi-transfer table, not both'));
            return false;
        }
    } else {
        // Single-transfer validation (backward compatibility)
        if (!frm.doc.expense_account || !frm.doc.to_expense_account || !frm.doc.amount_requested) {
            frappe.msgprint(__('For single-transfer mode: From Account, To Account, and Amount are required'));
            return false;
        }

        if (frm.doc.expense_account === frm.doc.to_expense_account) {
            frappe.msgprint(__('FROM and TO accounts must be different'));
            return false;
        }

        if (frm.doc.amount_requested <= 0) {
            frappe.msgprint(__('Amount must be greater than zero'));
            return false;
        }

        // Ensure multi-transfer table is empty in single-transfer mode
        if (frm.doc.transfer_items && frm.doc.transfer_items.length > 0) {
            frappe.msgprint(__('Please use either single-transfer fields OR multi-transfer table, not both'));
            return false;
        }
    }

    return true;
}

function handle_threshold_validation(frm) {
    // Don't show warnings for final states or cancelled documents
    const final_states = ['Approved', 'Rejected'];
    if (final_states.includes(frm.doc.workflow_state) || frm.doc.docstatus === 2) {
        clear_external_approval_message(frm);
        return;
    }

    // Determine if this is multi-transfer or single-transfer mode
    const is_multi_transfer = frm.doc.transfer_items && frm.doc.transfer_items.length > 0;

    if (is_multi_transfer) {
        // Multi-transfer mode - check total amount
        let total_amount = 0;
        frm.doc.transfer_items.forEach(function(item) {
            if (item.amount_requested) {
                total_amount += flt(item.amount_requested);
            }
        });

        // Check external approval requirement for total amount
        if (total_amount > 250000) {
            frappe.call({
                method: 'wcfcb_zm.api.budget_request.budget_virement_handler',
                args: {
                    'action': 'validate_amount_approval',
                    'amount': total_amount
                },
                callback: function(r) {
                    if (r.message && r.message.success) {
                        show_external_approval_message(frm, r.message);
                    }
                }
            });
        } else {
            clear_external_approval_message(frm);
        }
    } else {
        // Single-transfer mode (legacy) - use existing logic
        handle_amount_change(frm);
    }
}

function handle_amount_change(frm) {
    // Don't show warnings for final states or cancelled documents
    const final_states = ['Approved', 'Rejected'];
    if (final_states.includes(frm.doc.workflow_state) || frm.doc.docstatus === 2) {
        clear_external_approval_message(frm);
        return;
    }

    // Validate budget availability and external approval requirements
    if (frm.doc.amount_requested && frm.doc.expense_account && frm.doc.budget) {
        frappe.call({
            method: 'wcfcb_zm.api.budget_request.budget_virement_handler',
            args: {
                'action': 'validate_budget_transfer',
                'budget': frm.doc.budget,
                'expense_account': frm.doc.expense_account,
                'amount': frm.doc.amount_requested
            },
            callback: function(r) {
                if (r.message && r.message.success) {
                    // Check budget availability
                    if (!r.message.sufficient_budget) {
                        show_budget_insufficient_message(frm, r.message);
                    } else {
                        clear_budget_insufficient_message(frm);

                        // Check external approval requirement
                        if (Math.abs(frm.doc.amount_requested) > 250000) {
                            frappe.call({
                                method: 'wcfcb_zm.api.budget_request.budget_virement_handler',
                                args: {
                                    'action': 'validate_amount_approval',
                                    'amount': frm.doc.amount_requested
                                },
                                callback: function(r2) {
                                    if (r2.message && r2.message.success) {
                                        show_external_approval_message(frm, r2.message);
                                    }
                                }
                            });
                        } else {
                            clear_external_approval_message(frm);
                        }
                    }
                } else {
                    clear_budget_insufficient_message(frm);
                    clear_external_approval_message(frm);
                }
            }
        });
    } else {
        clear_budget_insufficient_message(frm);
        clear_external_approval_message(frm);
    }
}

function show_external_approval_message(frm, validation_data) {
    // Show context-aware message based on workflow state
    let title, status_message, bg_color, border_color, text_color;

    if (frm.doc.workflow_state === 'External Approval') {
        title = '🔍 Under External Approval Review';
        status_message = 'This request is currently under external approval review due to high amount.';
        bg_color = '#e3f2fd';
        border_color = '#90caf9';
        text_color = '#1565c0';
    } else if (frm.doc.workflow_state === 'Draft') {
        title = '⚠️ External Approval Required';
        status_message = 'This request will require external approval. Use "Submit for External Approval" action.';
        bg_color = '#fff3cd';
        border_color = '#ffeaa7';
        text_color = '#856404';
    } else {
        title = '⚠️ High Amount Request';
        status_message = 'This request exceeds the standard approval threshold.';
        bg_color = '#fff3cd';
        border_color = '#ffeaa7';
        text_color = '#856404';
    }

    let message = `
        <div style="padding: 10px; background-color: ${bg_color}; border: 1px solid ${border_color}; border-radius: 4px;">
            <h4 style="color: ${text_color}; margin: 0 0 8px 0;">${title}</h4>
            <p style="margin: 0; color: ${text_color};">
                <strong>Amount:</strong> ${Math.abs(validation_data.amount).toLocaleString()}<br>
                <strong>Threshold:</strong> ${validation_data.threshold.toLocaleString()}<br>
                <strong>Status:</strong> ${status_message}
            </p>
        </div>
    `;

    frm.dashboard.clear_comment();
    frm.dashboard.add_comment(message, 'orange', true);
}

function clear_external_approval_message(frm) {
    // Clear any existing external approval messages
    frm.dashboard.clear_comment();
}

function show_budget_insufficient_message(frm, validation_result) {
    // Clear any existing budget insufficient message
    clear_budget_insufficient_message(frm);

    // Determine if this is an increase or decrease
    const requested_amount = Math.abs(frm.doc.amount_requested);
    const available_amount = validation_result.available_amount;
    const is_increase = requested_amount > available_amount;
    const difference = Math.abs(requested_amount - available_amount);

    // Create budget change warning message (not blocking)
    const message = `
        <div style="padding: 15px; background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px; color: #856404;">
            <h4 style="margin: 0 0 8px 0; color: #856404;">
                <i class="fa fa-info-circle"></i> Budget ${is_increase ? 'Increase' : 'Adjustment'} Required
            </h4>
            <p style="margin: 0;">
                <strong>Current Budget:</strong> ${available_amount.toLocaleString()}<br>
                <strong>Requested Amount:</strong> ${requested_amount.toLocaleString()}<br>
                <strong>${is_increase ? 'Budget Increase' : 'Budget Change'}:</strong> ${difference.toLocaleString()}<br>
                <em style="font-size: 12px;">Note: Approval will create amended budget with ${is_increase ? 'increased' : 'adjusted'} allocation</em>
            </p>
        </div>
    `;

    // Add to dashboard
    frm.dashboard.clear_comment();
    frm.dashboard.add_comment(message, 'yellow', true);
}

function clear_budget_insufficient_message(frm) {
    // Clear any existing budget insufficient message
    frm.dashboard.clear_comment();
}

function handle_external_approval_before_save(frm) {
    // Don't automatically change workflow state - let users use action buttons
    // Just show informational messages

    // Calculate total amount based on transfer mode
    let total_amount = 0;
    const is_multi_transfer = frm.doc.transfer_items && frm.doc.transfer_items.length > 0;

    if (is_multi_transfer) {
        // Multi-transfer mode - sum all transfer items
        frm.doc.transfer_items.forEach(function(item) {
            if (item.amount_requested) {
                total_amount += flt(item.amount_requested);
            }
        });
    } else {
        // Single-transfer mode (legacy)
        total_amount = Math.abs(frm.doc.amount_requested || 0);
    }

    if (total_amount > 250000) {
        if (frm.doc.workflow_state === 'Draft') {
            frappe.show_alert({
                message: __('Total amount exceeds 250,000 - consider using "Submit for External Approval" action'),
                indicator: 'orange'
            }, 5);
        }
    }
    return true;
}



function show_approval_confirmation_dialog(frm) {
    return new Promise((resolve, reject) => {
        // Validate required fields first
        if (!frm.doc.budget) {
            frappe.throw(__("Please link the Budget document."));
            reject('validation_failed');
            return;
        }

        if (!frm.doc.expense_account || !frm.doc.to_expense_account) {
            frappe.throw(__("Please select both From and To expense accounts."));
            reject('validation_failed');
            return;
        }

        if (frm.doc.expense_account === frm.doc.to_expense_account) {
            frappe.throw(__("Cannot transfer to the same account."));
            reject('validation_failed');
            return;
        }

        if (!frm.doc.amount_requested || frm.doc.amount_requested <= 0) {
            frappe.throw(__("Please enter a valid transfer amount."));
            reject('validation_failed');
            return;
        }

        // Get budget impact information first
        frappe.call({
            method: 'wcfcb_zm.api.budget_request.budget_virement_handler',
            args: {
                'action': 'validate_budget_transfer',
                'budget': frm.doc.budget,
                'expense_account': frm.doc.expense_account,
                'amount': frm.doc.amount_requested
            },
            callback: function(r) {
                let budget_impact_html = '';

                if (r.message && r.message.success) {
                    const available = r.message.available_amount;
                    const requested = Math.abs(frm.doc.amount_requested);
                    const is_increase = requested > available;
                    const difference = Math.abs(requested - available);

                    budget_impact_html = `
                        <div style="background-color: ${is_increase ? '#fff3cd' : '#d1ecf1'}; padding: 12px; border-radius: 4px; margin: 10px 0; border-left: 4px solid ${is_increase ? '#ffc107' : '#17a2b8'};">
                            <h5 style="margin: 0 0 8px 0; color: ${is_increase ? '#856404' : '#0c5460'};">
                                💰 Budget Impact: ${is_increase ? 'Increase Required' : 'Budget Adjustment'}
                            </h5>
                            <p style="margin: 0; font-size: 13px; color: ${is_increase ? '#856404' : '#0c5460'};">
                                <strong>Current Budget:</strong> ${available.toLocaleString()}<br>
                                <strong>New Amount:</strong> ${requested.toLocaleString()}<br>
                                <strong>${is_increase ? 'Increase' : 'Change'}:</strong> ${difference.toLocaleString()}<br>
                                <em>Account will be ${is_increase ? 'increased' : 'adjusted'} in amended budget</em>
                            </p>
                        </div>
                    `;
                }

                // Show confirmation dialog with budget impact
                let dialog = new frappe.ui.Dialog({
                    title: __('Confirm Budget Request Approval'),
                    fields: [
                        {
                            fieldtype: 'HTML',
                            fieldname: 'approval_info',
                            options: `
                                <div style="padding: 15px; background-color: #f8f9fa; border-radius: 4px; margin-bottom: 15px;">
                                    <h4 style="color: #495057; margin: 0 0 10px 0;">⚠️ Budget Amendment Process</h4>
                                    <p style="margin: 0; color: #6c757d; line-height: 1.5;">
                                        <strong>Approving this request will:</strong><br>
                                        1. Cancel the current budget: <strong>${frm.doc.budget}</strong><br>
                                        2. Check for linked documents (Journal Entries, Purchase Orders, etc.)<br>
                                        3. Create an amended budget with the requested changes<br>
                                        4. Submit the new budget for use<br><br>
                                        <strong>Transfer Details:</strong><br>
                                        • Type: <strong>${frm.doc.virement_type}</strong><br>
                                        • Amount: <strong>${Math.abs(frm.doc.amount_requested || 0).toLocaleString()}</strong><br>
                                        • From: <strong>${frm.doc.expense_account || 'N/A'}</strong><br>
                                        • To: <strong>${frm.doc.to_expense_account || 'N/A'}</strong>
                                        ${frm.doc.target_budget ? '<br>• Target Budget: <strong>' + frm.doc.target_budget + '</strong>' : ''}
                                    </p>
                                    ${budget_impact_html}
                                </div>
                            `
                        },
                        {
                            fieldtype: 'Check',
                            fieldname: 'confirm_understanding',
                            label: __('I understand that this will cancel the current budget and create an amended version'),
                            reqd: 1
                        }
                    ],
                    primary_action_label: __('Approve Transfer'),
                    primary_action: function(values) {
                        if (values.confirm_understanding) {
                            dialog.hide();

                            // STEP 1: Refresh document and check if Budget Request is already approved
                            frm.reload_doc().then(() => {
                                if (frm.doc.workflow_state === 'Approved' && frm.doc.docstatus === 1) {
                                    // Already approved, skip workflow and go directly to amendment
                                    process_budget_amendment();
                                } else {
                                // STEP 1: First approve the Budget Request through workflow
                                frm._custom_approval_in_progress = true; // Set flag to prevent hook interference
                                frappe.call({
                                    method: 'frappe.model.workflow.apply_workflow',
                                    args: {
                                        doc: frm.doc,
                                        action: 'Approve'
                                    },
                                    callback: function(workflow_response) {
                                        frm._custom_approval_in_progress = false; // Clear flag
                                        if (workflow_response.message) {
                                            process_budget_amendment();
                                        } else {
                                            // Check if it's just "Not a valid Workflow Action" - suppress this error
                                            if (workflow_response.exc && workflow_response.exc.includes('Not a valid Workflow Action')) {
                                                // Document is already approved, proceed with amendment
                                                process_budget_amendment();
                                            } else {
                                                frappe.msgprint({
                                                    title: __('Workflow Error'),
                                                    message: __('Failed to approve Budget Request through workflow.'),
                                                    indicator: 'red'
                                                });
                                                reject('workflow_error');
                                            }
                                        }
                                    }
                                });
                            }

                            function process_budget_amendment() {
                                        // STEP 2: After workflow approval, process budget amendment
                                        frappe.call({
                                            method: 'wcfcb_zm.api.budget_request.budget_virement_handler',
                                            args: {
                                                'action': 'process_approval_with_amendment',
                                                'doc_name': frm.doc.name,
                                                'virement_type': frm.doc.virement_type,
                                                'budget': frm.doc.budget,
                                                'target_budget': frm.doc.target_budget || '',
                                                'expense_account': frm.doc.expense_account || '',
                                                'to_expense_account': frm.doc.to_expense_account || '',
                                                'amount_requested': frm.doc.amount_requested || 0
                                            },
                                            callback: function(r) {
                                                if (r.message && r.message.success) {
                                        frappe.show_alert({
                                            message: __('Budget approval completed successfully!'),
                                            indicator: 'green'
                                        });

                                        // Show detailed approval summary
                                        show_approval_summary_dialog(frm, r.message);

                                        // Resolve the promise to indicate success
                                        resolve(r.message);
                                    } else if (r.message && !r.message.success) {
                                        frappe.msgprint({
                                            title: __('Approval Failed'),
                                            message: r.message.message || __('Unknown error occurred'),
                                            indicator: 'red'
                                        });
                                        reject(r.message.message || 'approval_failed');
                                    } else {
                                        frappe.msgprint({
                                            title: __('Error'),
                                            message: __('Approval process failed. Please try again.'),
                                            indicator: 'red'
                                        });
                                        reject('approval_failed');
                                    }
                                },
                                error: function(err) {
                                    frappe.msgprint({
                                        title: __('Server Error'),
                                        message: __('Failed to process approval: ') + (err.responseText || err.statusText),
                                        indicator: 'red'
                                    });
                                    reject(err.responseText || err.statusText || 'server_error');
                                }
                            });
                                }
                            });
                        } else {
                            frappe.msgprint(__('Please confirm your understanding before proceeding'));
                        }
                    },
                    secondary_action_label: __('Cancel'),
                    secondary_action: function() {
                        dialog.hide();
                        // Reject the promise to indicate cancellation
                        reject('cancelled');
                    }
                });

                dialog.show();
            },
            error: function(err) {
                frappe.msgprint({
                    title: __('Validation Error'),
                    message: __('Failed to validate budget transfer: ') + (err.responseText || err.statusText),
                    indicator: 'red'
                });
                reject(err.responseText || err.statusText || 'validation_error');
            }
        });
    });
}

function process_budget_approval(frm) {
    // Show processing message
    frappe.show_alert({
        message: __('Processing budget approval...'),
        indicator: 'blue'
    });

    // Validate required fields before calling server
    let validation_error = null;

    if (!frm.doc.name || !frm.doc.virement_type || !frm.doc.budget) {
        validation_error = 'Name, Virement Type, and Budget are required';
    } else if (is_multi_transfer_mode(frm)) {
        // Multi-transfer validation
        if (!frm.doc.transfer_items || frm.doc.transfer_items.length === 0) {
            validation_error = 'At least one transfer item is required for multi-transfer mode';
        } else {
            // Check each transfer item
            for (let i = 0; i < frm.doc.transfer_items.length; i++) {
                let item = frm.doc.transfer_items[i];
                if (!item.from_account || !item.to_account || !item.amount_requested) {
                    validation_error = `Transfer item ${i + 1}: All fields are required`;
                    break;
                }
            }
        }
    } else {
        // Single-transfer validation
        if (!frm.doc.expense_account || !frm.doc.to_expense_account || !frm.doc.amount_requested) {
            validation_error = 'From Account, To Account, and Amount are required';
        }
    }

    if (validation_error) {
        frappe.msgprint({
            title: __('Missing Information'),
            message: validation_error,
            indicator: 'red'
        });
        return;
    }

    // STEP 1: Refresh document and check if Budget Request is already approved
    frm.reload_doc().then(() => {
        if (frm.doc.workflow_state === 'Approved' && frm.doc.docstatus === 1) {
            // Already approved, skip workflow and go directly to amendment
            process_budget_amendment();
        } else {
        // STEP 1: First approve the Budget Request through workflow
        frm._custom_approval_in_progress = true; // Set flag to prevent hook interference
        frappe.call({
            method: 'frappe.model.workflow.apply_workflow',
            args: {
                doc: frm.doc,
                action: 'Approve'
            },
            callback: function(workflow_response) {
                frm._custom_approval_in_progress = false; // Clear flag
                if (workflow_response.message) {
                    process_budget_amendment();
                } else {
                    // Check if it's just "Not a valid Workflow Action" - suppress this error
                    if (workflow_response.exc && workflow_response.exc.includes('Not a valid Workflow Action')) {
                        // Document is already approved, proceed with amendment
                        process_budget_amendment();
                    } else {
                        frappe.msgprint({
                            title: __('Workflow Error'),
                            message: __('Failed to approve Budget Request through workflow.'),
                            indicator: 'red'
                        });
                    }
                }
            }
        });
    }

    function process_budget_amendment() {
                // STEP 2: After workflow approval, process budget amendment
                frappe.call({
                    method: 'wcfcb_zm.api.budget_request.budget_virement_handler',
                    args: {
                        'action': 'process_approval_with_amendment',
                        'doc_name': frm.doc.name,
                        'virement_type': frm.doc.virement_type,
                        'budget': frm.doc.budget,
                        'target_budget': frm.doc.target_budget || '',
                        'expense_account': frm.doc.expense_account || '',
                        'to_expense_account': frm.doc.to_expense_account || '',
                        'amount_requested': frm.doc.amount_requested || 0
                    },
                    callback: function(r) {
                        if (r.message && r.message.success) {
                frappe.show_alert({
                    message: __('Budget approval completed successfully!'),
                    indicator: 'green'
                });

                // Show detailed approval summary
                show_approval_summary_dialog(frm, r.message);

                // Refresh the form to show updated workflow state
                frm.reload_doc();
            } else {
                frappe.msgprint({
                    title: __('Approval Failed'),
                    message: r.message ? r.message.message : 'Unknown error occurred',
                    indicator: 'red'
                });
            }
        },
        error: function(r) {
            frappe.msgprint({
                title: __('Error'),
                message: 'Failed to process approval: ' + (r.message || 'Unknown error'),
                indicator: 'red'
            });
        }
    });
        }
    });
}

function copy_fields_from_amended_doc(frm) {
    // Copy field values from the original cancelled document
    if (!frm.doc.amended_from) return;

    frappe.call({
        method: 'frappe.client.get',
        args: {
            doctype: 'Budget Request',
            name: frm.doc.amended_from
        },
        callback: function(r) {
            if (r.message) {
                const original_doc = r.message;

                // Mark that we're copying fields to prevent clearing
                frm._copying_amended_fields = true;

                // Copy all relevant fields from original document
                const fields_to_copy = [
                    'virement_type',
                    'budget',
                    'target_budget',
                    'expense_account',
                    'to_expense_account',
                    'amount_requested',
                    'cost_centre',
                    'motivation',
                    'remarks'
                ];

                // Copy fields without triggering change handlers
                fields_to_copy.forEach(function(field) {
                    if (original_doc[field] && !frm.doc[field]) {
                        frm.doc[field] = original_doc[field];
                        frm.refresh_field(field);
                    }
                });

                // Set up field dependencies after copying values
                setTimeout(function() {
                    // Clear the copying flag
                    frm._copying_amended_fields = false;

                    // Set up queries and field states based on copied values
                    disable_dependent_fields(frm);

                    if (frm.doc.virement_type) {
                        setup_queries_for_existing_doc(frm);
                    }

                    frappe.show_alert({
                        message: __('Fields copied from cancelled document'),
                        indicator: 'green'
                    }, 3);
                }, 500);
            }
        }
    });
}

function setup_queries_for_existing_doc(frm) {
    // Set up field queries for saved documents without clearing values
    if (frm.doc.virement_type === 'Inter-Budget') {
        // Set up queries for Inter-Budget
        frm.set_query('budget', function() {
            return { filters: { 'docstatus': 1 } };
        });

        if (frm.doc.budget) {
            frm.set_query('target_budget', function() {
                return {
                    filters: [
                        ['Budget', 'docstatus', '=', 1],
                        ['Budget', 'name', '!=', frm.doc.budget]
                    ]
                };
            });
        }

    } else if (frm.doc.virement_type === 'Intra-Budget') {
        // Set up queries for Intra-Budget
        frappe.call({
            method: 'wcfcb_zm.api.budget_request.budget_virement_handler',
            args: { 'action': 'get_multi_account_budgets' },
            callback: function(r) {
                if (r.message && r.message.success) {
                    let budget_names = r.message.data.map(b => b.value);
                    frm.set_query('budget', function() {
                        return {
                            filters: [
                                ['Budget', 'name', 'in', budget_names],
                                ['Budget', 'docstatus', '=', 1]
                            ]
                        };
                    });
                }
            }
        });
    }
}

function setup_workflow_interception(frm) {
    // Add custom approve action to workflow dropdown and hide default approve
    if (frm.doc.workflow_state === 'Budget Committee' || frm.doc.workflow_state === 'External Approval') {
        // Override the page actions to add our custom approve option
        setTimeout(function() {
            // Find the Actions dropdown menu
            const actionsDropdown = $('.dropdown-menu[role="menu"]');

            if (actionsDropdown.length > 0) {
                // Add our custom approve action at the top
                const customApproveHtml = `
                    <li class="user-action">
                        <a class="grey-link dropdown-item" href="#" onclick="return false;" data-action="custom-approve">
                            <span class="menu-item-label" data-label="Approve Request">
                                <span><span class="alt-underline">A</span>pprove Request</span>
                            </span>
                        </a>
                    </li>
                `;

                // Insert at the beginning of the dropdown
                actionsDropdown.prepend(customApproveHtml);

                // Hide the default Approve action
                actionsDropdown.find('[data-label="Approve"]').parent().hide();

                // Add click handler for our custom approve action
                actionsDropdown.find('[data-action="custom-approve"]').on('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    show_approval_confirmation_dialog(frm);
                    return false;
                });
            }
        }, 1000);
    }
}

function add_view_summary_button(frm) {
    // Only show View Summary button for approved Budget Requests
    if (frm.doc.workflow_state === 'Approved') {
        const btn = frm.add_custom_button(__('View Summary'), function() {
            show_virement_summary_dialog(frm);
        });
        // Make it prominent in the header (not in Actions menu)
        if (btn && btn.addClass) {
            btn.addClass('btn-primary');
        }
    }
}

function show_virement_summary_dialog(frm) {
    // Call server method to get detailed summary (amended budgets + before/after amounts)
    frappe.call({
        method: 'wcfcb_zm.api.budget_request.budget_virement_handler',
        args: {
            action: 'get_summary_details',
            doc_name: frm.doc.name,
            source_budget: frm.doc.budget,
            target_budget: frm.doc.target_budget,
            virement_type: frm.doc.virement_type,
            from_account: frm.doc.expense_account || '',
            to_account: frm.doc.to_expense_account || ''
        },
        callback: function(r) {
            const details = r && r.message ? r.message : { amended_budgets: [] };
            show_summary_with_amendments(frm, details);
        }
    });
}

function show_summary_with_amendments(frm, details) {
    // Check if this is multi-transfer mode
    const is_multi_transfer = details && details.multi_transfer;

    // Data
    const transfer_type = frm.doc.virement_type;
    const amount = parseFloat(frm.doc.amount_requested).toLocaleString();
    const from_budget = frm.doc.budget;
    const to_budget = frm.doc.target_budget || from_budget;
    const originals = transfer_type === 'Inter-Budget' ? [from_budget, to_budget] : [from_budget];

    const amended = (details && Array.isArray(details.amended_budgets)) ? details.amended_budgets : [];
    const fmt = v => (v === null || v === undefined || isNaN(Number(v))) ? '—' : `K ${Number(v).toLocaleString()}`;

    // Chips
    const chip = (txt, color='#e9ecef') => `<span style=\"display:inline-block;margin:2px 6px 2px 0;padding:6px 10px;border-radius:999px;background:${color};font-size:12px;\">${frappe.utils.escape_html(txt)}</span>`;
    const linkChip = (name, color='#d4edda') => `<a href=\"/app/budget/${name}\" style=\"text-decoration:none;\">${chip(name, color)}</a>`;

    const originalChips = originals.map(n => linkChip(n, '#eef2ff')).join('');
    const amendedChips = amended.length ? amended.map(n => linkChip(n, '#d4edda')).join('') : chip('Amendment created', '#fff3cd');

    // Dialog with polished layout
    const d = new frappe.ui.Dialog({
        title: __('Budget Virement Summary'),
        size: 'large'
    });

    // Generate transfer details section
    let transferDetailsHtml = '';
    if (is_multi_transfer && details.transfer_items && details.transfer_items.length > 0) {
        // Multi-transfer mode: show summary of transfer items
        const transferCount = details.transfer_items.length;
        transferDetailsHtml = `
            <div style="background:#f8fafc;border:1px solid #eef2f7;border-radius:8px;padding:12px;">
                <div style="font-weight:600;margin-bottom:8px;color:#334155;">Transfer Details</div>
                <div style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:#334155;">
                    <div><span style="opacity:.7">Transfer Type:</span> ${frappe.utils.escape_html(transfer_type)}</div>
                    <div><span style="opacity:.7">Number of Transfers:</span> ${transferCount}</div>
                    <div><span style="opacity:.7">From Budget:</span> ${linkChip(from_budget, '#eef2ff')}</div>
                    ${transfer_type === 'Inter-Budget' ? `<div><span style="opacity:.7">To Budget:</span> ${linkChip(to_budget, '#eef2ff')}</div>` : ''}
                </div>
            </div>`;
    } else {
        // Single-transfer mode: show legacy fields
        const from_account = frm.doc.expense_account;
        const to_account = frm.doc.to_expense_account;
        transferDetailsHtml = `
            <div style="background:#f8fafc;border:1px solid #eef2f7;border-radius:8px;padding:12px;">
                <div style="font-weight:600;margin-bottom:8px;color:#334155;">Transfer Details</div>
                <div style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:#334155;">
                    <div><span style="opacity:.7">From Account:</span> ${frappe.utils.escape_html(from_account || '')}</div>
                    <div><span style="opacity:.7">To Account:</span> ${frappe.utils.escape_html(to_account || '')}</div>
                    <div><span style="opacity:.7">From Budget:</span> ${linkChip(from_budget, '#eef2ff')}</div>
                    ${transfer_type === 'Inter-Budget' ? `<div><span style="opacity:.7">To Budget:</span> ${linkChip(to_budget, '#eef2ff')}</div>` : ''}
                </div>
            </div>`;
    }

    const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Ubuntu,Arial,sans-serif;">
            <div style="background:linear-gradient(135deg,#1aa179,#2cb67d);color:#fff;border-radius:10px;padding:16px 18px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;">
                <div style="font-weight:600;font-size:16px;display:flex;align-items:center;gap:8px;">
                    <i class="fa fa-random"></i>
                    <span>${frappe.utils.escape_html(transfer_type)}</span>
                </div>
                <div style="font-weight:700;font-size:18px;">K ${amount}</div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                ${transferDetailsHtml}

                <div style="background:#f8fafc;border:1px solid #eef2f7;border-radius:8px;padding:12px;">
                    <div style="font-weight:600;margin-bottom:8px;color:#334155;">Budget Changes</div>
                    <div style="font-size:13px;color:#334155;">
                        <div style="margin-bottom:6px;"><span style="opacity:.7">Original Budget(s):</span> ${originalChips}</div>
                        <div style="margin-bottom:6px;"><span style="opacity:.7">Amended Budget(s):</span> ${amendedChips}</div>
                        <div style="opacity:.8">Original budgets cancelled, amended budgets created.</div>
                    </div>
                </div>
            </div>

            <div style="background:#f8fafc;border:1px solid #eef2f7;border-radius:8px;padding:12px;margin-top:12px;">
                <div style="font-weight:600;margin-bottom:8px;color:#334155;">Amounts (Before → After)</div>
                ${is_multi_transfer && details.transfer_items ?
                    // Multi-transfer mode: show each transfer item
                    details.transfer_items.map((item, index) => `
                        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:8px;">
                            <div style="font-weight:600;margin-bottom:8px;color:#334155;">Transfer ${index + 1} - K ${Number(item.amount).toLocaleString()}</div>
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                                <div>
                                    <div style="font-weight:600;margin-bottom:6px;color:#334155;">From Account</div>
                                    <div style="font-size:13px;color:#334155;">
                                        <div style="opacity:.7">${frappe.utils.escape_html(item.from.account || '')} (${frappe.utils.escape_html(item.from.budget || '')})</div>
                                        <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
                                            <span>${fmt(item.from.before)}</span>
                                            <i class="fa fa-long-arrow-right" style="opacity:.6"></i>
                                            <span style="font-weight:600;color:#b91c1c;">${fmt(item.from.after)}</span>
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <div style="font-weight:600;margin-bottom:6px;color:#334155;">To Account</div>
                                    <div style="font-size:13px;color:#334155;">
                                        <div style="opacity:.7">${frappe.utils.escape_html(item.to.account || '')} (${frappe.utils.escape_html(item.to.budget || '')})</div>
                                        <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
                                            <span>${fmt(item.to.before)}</span>
                                            <i class="fa fa-long-arrow-right" style="opacity:.6"></i>
                                            <span style="font-weight:600;color:#166534;">${fmt(item.to.after)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `).join('') :
                    // Single-transfer mode: show legacy format
                    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;">
                            <div style="font-weight:600;margin-bottom:6px;color:#334155;">From Account</div>
                            <div style="font-size:13px;color:#334155;">
                                <div style="opacity:.7">${frappe.utils.escape_html(details.from?.account || '')} (${frappe.utils.escape_html(details.from?.budget || from_budget)})</div>
                                <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
                                    <span>${fmt(details.from?.before)}</span>
                                    <i class="fa fa-long-arrow-right" style="opacity:.6"></i>
                                    <span style="font-weight:600;color:#b91c1c;">${fmt(details.from?.after)}</span>
                                </div>
                            </div>
                        </div>
                        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;">
                            <div style="font-weight:600;margin-bottom:6px;color:#334155;">To Account</div>
                            <div style="font-size:13px;color:#334155;">
                                <div style="opacity:.7">${frappe.utils.escape_html(details.to?.account || '')} (${frappe.utils.escape_html(details.to?.budget || to_budget)})</div>
                                <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
                                    <span>${fmt(details.to?.before)}</span>
                                    <i class="fa fa-long-arrow-right" style="opacity:.6"></i>
                                    <span style="font-weight:600;color:#166534;">${fmt(details.to?.after)}</span>
                                </div>
                            </div>
                        </div>
                    </div>`
                }
            </div>

            <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:12px;">
                <div style="font-weight:600;margin-bottom:6px;color:#334155;">Approval Information</div>
                <div style="font-size:13px;color:#334155;display:flex;gap:18px;flex-wrap:wrap;">
                    <div><span style="opacity:.7">Approved Date:</span> ${frappe.datetime.str_to_user(frm.doc.modified)}</div>
                    <div><span style="opacity:.7">Approved By:</span> ${frappe.utils.escape_html(frm.doc.modified_by || '')}</div>
                    <div><span style="opacity:.7">Request Status:</span> ${frappe.utils.escape_html(frm.doc.workflow_state || '')}</div>
                </div>
            </div>
        </div>`;

    d.$body.html(html);
    d.set_primary_action(__('Close'), () => d.hide());
    d.show();
}

function show_approval_summary_dialog(frm, response_data) {
    // Create detailed approval summary
    const transfer_type = frm.doc.virement_type;
    const amount = parseFloat(frm.doc.amount_requested).toLocaleString();
    const from_account = frm.doc.expense_account;
    const to_account = frm.doc.to_expense_account;
    const from_budget = frm.doc.budget;
    const to_budget = frm.doc.target_budget || from_budget;

    let summary_html = `
        <div style="padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h3 style="color: #28a745; margin: 0;">
                    <i class="fa fa-check-circle" style="margin-right: 8px;"></i>
                    Budget Request Approved Successfully
                </h3>
            </div>

            <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                <h4 style="color: #495057; margin-top: 0;">Transfer Details</h4>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 5px 0; font-weight: bold;">Transfer Type:</td>
                        <td style="padding: 5px 0;">${transfer_type}</td>
                    </tr>
                    <tr>
                        <td style="padding: 5px 0; font-weight: bold;">Amount:</td>
                        <td style="padding: 5px 0; color: #007bff; font-weight: bold;">K ${amount}</td>
                    </tr>
                    <tr>
                        <td style="padding: 5px 0; font-weight: bold;">From Account:</td>
                        <td style="padding: 5px 0;">${from_account}</td>
                    </tr>
                    <tr>
                        <td style="padding: 5px 0; font-weight: bold;">To Account:</td>
                        <td style="padding: 5px 0;">${to_account}</td>
                    </tr>
                    <tr>
                        <td style="padding: 5px 0; font-weight: bold;">From Budget:</td>
                        <td style="padding: 5px 0;">${from_budget}</td>
                    </tr>
                    ${transfer_type === 'Inter-Budget' ? `
                    <tr>
                        <td style="padding: 5px 0; font-weight: bold;">To Budget:</td>
                        <td style="padding: 5px 0;">${to_budget}</td>
                    </tr>
                    ` : ''}
                </table>
            </div>

            <div style="background: #e8f5e8; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                <h4 style="color: #155724; margin-top: 0;">Budget Changes</h4>
                <p style="margin: 5px 0;"><strong>Original Budget(s):</strong> ${response_data.original_budget}</p>
                <p style="margin: 5px 0;"><strong>New Amended Budget(s):</strong> ${response_data.amended_budget}</p>
                <p style="margin: 5px 0;"><strong>Status:</strong> Original budgets cancelled, amended budgets created in Draft state</p>
            </div>

            <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                <h4 style="color: #856404; margin-top: 0;">Next Steps</h4>
                <ul style="margin: 5px 0; padding-left: 20px;">
                    <li>Amended budgets are in <strong>Draft</strong> state</li>
                    <li>Budget managers can review and approve amended budgets through normal workflow</li>
                    <li>Original budgets have been cancelled for audit trail</li>
                </ul>
            </div>

            ${response_data.cancelled_documents ? `
            <div style="background: #f8d7da; padding: 15px; border-radius: 8px;">
                <h4 style="color: #721c24; margin-top: 0;">Cancelled Documents</h4>
                <p style="margin: 5px 0;">${response_data.cancelled_documents}</p>
            </div>
            ` : ''}
        </div>
    `;

    frappe.msgprint({
        title: __('Budget Virement Completed'),
        message: summary_html,
        indicator: 'green',
        wide: true
    });
}

function force_multi_transfer_mode(frm) {
    console.log('Forcing multi-transfer mode for ALL requests');

    // ALWAYS hide single-transfer account fields
    frm.set_df_property('expense_account', 'hidden', 1);
    frm.set_df_property('to_expense_account', 'hidden', 1);
    frm.refresh_field('expense_account');
    frm.refresh_field('to_expense_account');

    // ALWAYS show amount_requested as read-only total amount field
    frm.set_df_property('amount_requested', 'hidden', 0);
    frm.set_df_property('amount_requested', 'read_only', 1);
    frm.set_df_property('amount_requested', 'label', 'Total Transfer Amount');

    // ALWAYS show multi-transfer section
    frm.set_df_property('multi_transfer_section', 'hidden', 0);
    frm.set_df_property('transfer_items', 'hidden', 0);

    // Calculate and set initial total
    calculate_total_transfer_amount(frm);

    // Force refresh of the amount field to apply properties
    frm.refresh_field('amount_requested');

    console.log('Multi-transfer mode setup complete');

    // Add a helpful message
    if (!frm.doc.transfer_items || frm.doc.transfer_items.length === 0) {
        frappe.show_alert({
            message: __('Please use the Transfer Items table below to add account transfers'),
            indicator: 'blue'
        });
    }
}



// Clean, focused client script for virement field filtering only
