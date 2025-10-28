# Server Script: Budget Virement Handler
# API Method: budget_virement_handler

import frappe
from frappe import _

@frappe.whitelist()

def budget_virement_handler(action, **kwargs):
    """
    Main API function for all budget virement operations

    Args:
        action: The action to perform (get_multi_account_budgets, get_budget_accounts, etc.)
        **kwargs: Additional parameters based on action

    Returns:
        dict: Response object with success/error status
    """
    try:
        if action == 'get_multi_account_budgets':
            return get_multi_account_budgets()
        elif action == 'get_budget_accounts':
            budget = kwargs.get('budget')
            exclude_account = kwargs.get('exclude_account')
            return get_budget_accounts(budget, exclude_account)
        elif action == 'get_target_budgets':
            virement_type = kwargs.get('virement_type')
            source_budget = kwargs.get('source_budget')
            return get_target_budgets(virement_type, source_budget)
        elif action == 'validate_amount_approval':
            amount = kwargs.get('amount')
            return validate_amount_approval(amount)

        elif action == 'validate_budget_transfer':
            budget = kwargs.get('budget')
            expense_account = kwargs.get('expense_account')
            amount = kwargs.get('amount')
            return validate_budget_transfer(budget, expense_account, amount)
        elif action == 'set_external_approval':
            doc_name = kwargs.get('doc_name')
            amount = kwargs.get('amount')
            return set_external_approval_workflow(doc_name, amount)
        elif action == 'process_approval_with_amendment':
            doc_name = kwargs.get('doc_name')
            virement_type = kwargs.get('virement_type')
            budget = kwargs.get('budget')
            target_budget = kwargs.get('target_budget')
            expense_account = kwargs.get('expense_account')
            to_expense_account = kwargs.get('to_expense_account')
            amount_requested = kwargs.get('amount_requested')
            return process_approval_with_amendment(doc_name, virement_type, budget, target_budget, expense_account, to_expense_account, amount_requested)
        elif action == 'get_amended_budgets':
            source_budget = kwargs.get('source_budget')
            target_budget = kwargs.get('target_budget')
            virement_type = kwargs.get('virement_type')
            result = get_amended_budgets(source_budget, target_budget, virement_type)
            frappe.response['message'] = result
            return result
        elif action == 'get_summary_details':
            source_budget = kwargs.get('source_budget')
            target_budget = kwargs.get('target_budget')
            virement_type = kwargs.get('virement_type')
            from_account = kwargs.get('from_account') or kwargs.get('expense_account')
            to_account = kwargs.get('to_account') or kwargs.get('to_expense_account')
            result = get_summary_details(source_budget, target_budget, virement_type, from_account, to_account)
            frappe.response['message'] = result
            return result

        else:
            frappe.response['message'] = {
                'success': False,
                'message': 'Invalid action: ' + str(action)
            }

    except Exception as e:
        frappe.response['message'] = {
            'success': False,
            'message': 'Operation failed: ' + str(e)
        }

def get_multi_account_budgets():
    """Get budgets with more than one account for Intra-Budget transfers"""
    try:
        budgets = frappe.db.sql("""
            SELECT
                b.name as value,
                CONCAT(b.name, ' (', COUNT(ba.account), ' accounts)') as description
            FROM
                `tabBudget` b
            INNER JOIN
                `tabBudget Account` ba ON ba.parent = b.name
            WHERE
                b.docstatus = 1
            GROUP BY
                b.name
            HAVING
                COUNT(ba.account) > 1
            ORDER BY
                b.name
        """, as_dict=True)

        frappe.response['message'] = {
            'success': True,
            'data': budgets
        }

    except Exception as e:
        frappe.response['message'] = {
            'success': False,
            'message': 'Error fetching multi-account budgets: ' + str(e)
        }

@frappe.whitelist()
def get_account_balance_from_budget(budget_name, account):
    """Get available balance for a specific account from a budget"""
    try:
        if not budget_name or not account:
            frappe.response['message'] = {
                'success': False,
                'message': 'Budget name and account are required'
            }
            return

        # Get budget account data
        budget_account = frappe.db.sql("""
            SELECT budget_amount
            FROM `tabBudget Account`
            WHERE parent = %s AND account = %s
        """, (budget_name, account), as_dict=True)

        if not budget_account:
            frappe.response['message'] = {
                'success': False,
                'message': f'Account {account} not found in budget {budget_name}'
            }
            return

        budget_amount = float(budget_account[0]['budget_amount'])

        # Calculate actual expenses (this is a simplified version)
        # In a real implementation, you might want to calculate actual expenses from GL entries
        actual_expenses = 0  # Placeholder - could be calculated from GL entries

        available_balance = budget_amount - actual_expenses

        frappe.response['message'] = {
            'success': True,
            'budget_amount': budget_amount,
            'actual_expenses': actual_expenses,
            'available_balance': available_balance
        }

    except Exception as e:
        frappe.response['message'] = {
            'success': False,
            'message': 'Error fetching account balance: ' + str(e)
        }

@frappe.whitelist()
def get_budget_accounts(budget, exclude_account=None):
    """Get accounts within a budget, optionally excluding one account"""
    try:
        if not budget:
            frappe.response['message'] = {
                'success': False,
                'message': 'Budget parameter is required'
            }
            return

        if exclude_account:
            accounts = frappe.db.sql("""
                SELECT
                    ba.account as value,
                    CONCAT(acc.account_name, ' (', ba.budget_amount, ')') as description
                FROM
                    `tabBudget Account` ba
                INNER JOIN
                    `tabAccount` acc ON ba.account = acc.name
                WHERE
                    ba.parent = %(budget)s
                    AND ba.account != %(exclude_account)s
                ORDER BY
                    acc.account_name
            """, {'budget': budget, 'exclude_account': exclude_account}, as_dict=True)
        else:
            accounts = frappe.db.sql("""
                SELECT
                    ba.account as value,
                    CONCAT(acc.account_name, ' (', ba.budget_amount, ')') as description
                FROM
                    `tabBudget Account` ba
                INNER JOIN
                    `tabAccount` acc ON ba.account = acc.name
                WHERE
                    ba.parent = %(budget)s
                ORDER BY
                    acc.account_name
            """, {'budget': budget}, as_dict=True)

        frappe.response['message'] = {
            'success': True,
            'data': accounts
        }

    except Exception as e:
        frappe.response['message'] = {
            'success': False,
            'message': 'Error fetching budget accounts: ' + str(e)
        }

def get_target_budgets(virement_type, source_budget=None):
    """Get target budgets based on virement type and source budget"""
    try:
        if virement_type == 'Inter-Budget':
            # For Inter-Budget: All budgets except source budget
            if source_budget:
                budgets = frappe.db.sql("""
                    SELECT
                        b.name as value,
                        b.name as description
                    FROM
                        `tabBudget` b
                    WHERE
                        b.name != %(source_budget)s
                        AND b.docstatus = 1
                    ORDER BY
                        b.name
                """, {'source_budget': source_budget}, as_dict=True)
            else:
                budgets = frappe.db.sql("""
                    SELECT
                        b.name as value,
                        b.name as description
                    FROM
                        `tabBudget` b
                    WHERE
                        b.docstatus = 1
                    ORDER BY
                        b.name
                """, as_dict=True)
        else:
            # For Intra-Budget: Return empty (target will be auto-populated)
            budgets = []

        frappe.response['message'] = {
            'success': True,
            'data': budgets
        }

    except Exception as e:
        frappe.response['message'] = {
            'success': False,
            'message': 'Error fetching target budgets: ' + str(e)
        }

def validate_amount_approval(amount):
    """Check if amount requires external approval and return workflow info"""
    try:
        if not amount:
            frappe.response['message'] = {
                'success': False,
                'message': 'Amount parameter is required'
            }
            return

        amount_float = abs(float(amount))
        requires_external = amount_float > 250000

        # Check if External Approval state exists in workflow
        external_state_exists = frappe.db.sql("""
            SELECT COUNT(*) as count
            FROM `tabWorkflow Document State`
            WHERE parent = 'Budget Request'
            AND state = 'External Approval'
        """, as_dict=True)

        has_external_state = external_state_exists and external_state_exists[0]['count'] > 0

        frappe.response['message'] = {
            'success': True,
            'requires_external_approval': requires_external,
            'amount': amount_float,
            'threshold': 250000,
            'external_state_available': has_external_state,
            'recommended_workflow_state': 'External Approval' if requires_external and has_external_state else 'Draft'
        }

    except Exception as e:
        frappe.response['message'] = {
            'success': False,
            'message': 'Amount validation error: ' + str(e)
        }

def set_external_approval_workflow(doc_name, amount):
    """Set workflow state to External Approval for amounts > 250k"""
    try:
        if not doc_name or not amount:
            frappe.response['message'] = {
                'success': False,
                'message': 'Document name and amount are required'
            }
            return

        amount_float = abs(float(amount))

        if amount_float > 250000:
            # Check if External Approval state exists in workflow
            external_state_exists = frappe.db.sql("""
                SELECT COUNT(*) as count
                FROM `tabWorkflow Document State`
                WHERE parent = 'Budget Request'
                AND state = 'External Approval'
            """, as_dict=True)

            if external_state_exists and external_state_exists[0]['count'] > 0:
                # Update the document workflow state using safe method
                budget_request = frappe.get_doc("Budget Request", doc_name)
                budget_request.workflow_state = 'External Approval'
                budget_request.save()

                frappe.db.commit()

                frappe.response['message'] = {
                    'success': True,
                    'message': 'Workflow state set to External Approval',
                    'workflow_state': 'External Approval',
                    'amount': amount_float,
                    'doc_name': doc_name
                }
            else:
                frappe.response['message'] = {
                    'success': False,
                    'message': 'External Approval workflow state not found'
                }
        else:
            frappe.response['message'] = {
                'success': True,
                'message': 'Amount does not require external approval',
                'workflow_state': 'Draft',
                'amount': amount_float
            }

    except Exception as e:
        frappe.response['message'] = {
            'success': False,
            'message': 'Error setting external approval: ' + str(e)
        }

def validate_budget_transfer(budget, expense_account, amount):
    """Validate if budget has sufficient funds for the transfer"""
    try:
        if not all([budget, expense_account, amount]):
            frappe.response['message'] = {
                'success': False,
                'message': 'Budget, expense account, and amount are required for validation'
            }
            return

        # Get current budget allocation for the account
        budget_account = frappe.db.sql("""
            SELECT budget_amount
            FROM `tabBudget Account`
            WHERE parent = %s AND account = %s
        """, (budget, expense_account), as_dict=True)

        if not budget_account:
            frappe.response['message'] = {
                'success': False,
                'message': 'Account not found in budget: ' + str(expense_account)
            }
            return

        available_amount = float(budget_account[0]['budget_amount'])
        requested_amount = abs(float(amount))
        sufficient_budget = available_amount >= requested_amount

        frappe.response['message'] = {
            'success': True,
            'sufficient_budget': sufficient_budget,
            'available_amount': available_amount,
            'requested_amount': requested_amount,
            'shortfall': max(0, requested_amount - available_amount),
            'message': 'Sufficient budget available' if sufficient_budget else 'Insufficient budget available'
        }

    except Exception as e:
        frappe.response['message'] = {
            'success': False,
            'message': 'Error validating budget transfer: ' + str(e)
        }

def is_multi_transfer_mode(doc_name):
    """Check if Budget Request uses multi-transfer mode"""
    try:
        budget_request = frappe.get_doc("Budget Request", doc_name)
        return len(budget_request.transfer_items) > 0
    except Exception:
        return False

def get_transfer_data(doc_name):
    """Get transfer data for both single and multi-transfer modes"""
    budget_request = frappe.get_doc("Budget Request", doc_name)

    if is_multi_transfer_mode(doc_name):
        # Multi-transfer mode: return list of transfer items
        transfers = []
        for item in budget_request.transfer_items:
            transfers.append({
                'from_account': item.from_account,
                'to_account': item.to_account,
                'amount_requested': item.amount_requested
            })
        return transfers
    else:
        # Single-transfer mode: return single transfer as list for consistency
        return [{
            'from_account': budget_request.expense_account,
            'to_account': budget_request.to_expense_account,
            'amount_requested': budget_request.amount_requested
        }]

def process_approval_with_amendment(doc_name, virement_type, budget, target_budget, expense_account, to_expense_account, amount_requested):
    """Process budget request approval with automatic budget amendment"""
    try:
        # Parameters are being received correctly - debug logging removed

        # Validate inputs - target_budget is optional for Intra-Budget
        required_params = [doc_name, virement_type, budget, expense_account, to_expense_account, amount_requested]
        missing_params = []

        for i, param in enumerate(required_params):
            param_names = ['doc_name', 'virement_type', 'budget', 'expense_account', 'to_expense_account', 'amount_requested']
            if param is None or str(param).strip() == '' or str(param).strip() == 'None':
                missing_params.append(param_names[i])

        if missing_params:
            frappe.response['message'] = {
                'success': False,
                'message': 'Missing required parameters: ' + ', '.join(missing_params) + '. Received: doc_name=' + str(doc_name) + ', virement_type=' + str(virement_type) + ', budget=' + str(budget) + ', expense_account=' + str(expense_account) + ', to_expense_account=' + str(to_expense_account) + ', amount_requested=' + str(amount_requested)
            }
            return

        # STEP 1: Get Budget Request document and validate it's approved
        budget_request = frappe.get_doc("Budget Request", doc_name)
        current_state = budget_request.workflow_state

        # STEP 1.1: Check if Budget Request is approved before proceeding with amendment
        if current_state != "Approved":
            frappe.response['message'] = {
                'success': False,
                'message': f'Budget Request must be approved before processing amendments. Current state: {current_state}. Please approve the Budget Request first.'
            }
            return

        # STEP 1.2: Additional check - ensure document is submitted (docstatus = 1)
        if budget_request.docstatus != 1:
            frappe.response['message'] = {
                'success': False,
                'message': f'Budget Request must be submitted before processing amendments. Current docstatus: {budget_request.docstatus}. Please submit the Budget Request first.'
            }
            return

        # STEP 2: Determine transfer mode and process accordingly
        if is_multi_transfer_mode(doc_name):
            # Multi-transfer mode: process all transfer items
            amendment_result = process_multi_transfer_amendment(doc_name, virement_type, budget, target_budget)
        else:
            # Single-transfer mode: use existing logic
            if virement_type == "Intra-Budget":
                amendment_result = process_intra_budget_amendment(budget, expense_account, to_expense_account, amount_requested)
            elif virement_type == "Inter-Budget":
                if not target_budget:
                    frappe.response['message'] = {
                        'success': False,
                        'message': 'Target budget is required for Inter-Budget transfers'
                    }
                    return
                amendment_result = process_inter_budget_amendment(budget, target_budget, expense_account, to_expense_account, amount_requested)
            else:
                frappe.response['message'] = {
                    'success': False,
                'message': 'Invalid virement type: ' + str(virement_type)
            }
            return

        # STEP 3: Check for linked documents that need to be cancelled (after budget amendments)
        linked_docs = check_budget_linked_documents(budget)
        cancelled_docs = []

        if linked_docs:
            # Cancel linked documents
            cancelled_docs = cancel_linked_documents(linked_docs)

        # STEP 4: Budget Request amendment details are tracked via Budget.amended_from field
        # No need to update Budget Request - the amended budgets can be found via SQL query

        frappe.db.commit()

        frappe.response['message'] = {
            'success': True,
            'message': 'Budget request approved and budget amended successfully',
            'original_budget': amendment_result.get('original_budget_name'),
            'amended_budget': amendment_result.get('amended_budget_name'),
            'summary': amendment_result.get('summary'),
            'cancelled_documents': ', '.join(cancelled_docs) if cancelled_docs else None
        }

    except Exception as e:
        frappe.response['message'] = {
            'success': False,
            'message': 'Error processing approval: ' + str(e)
        }

def check_budget_linked_documents(budget_name):
    """Check for documents linked to the budget that need to be cancelled"""
    linked_docs = []

    try:
        # Check Journal Entries
        journal_entries = frappe.db.sql("""
            SELECT name FROM `tabJournal Entry`
            WHERE budget = %s AND docstatus = 1
        """, (budget_name,), as_dict=True)

        for je in journal_entries:
            linked_docs.append(('Journal Entry', je['name']))

        # Check Purchase Orders
        purchase_orders = frappe.db.sql("""
            SELECT name FROM `tabPurchase Order`
            WHERE budget = %s AND docstatus = 1
        """, (budget_name,), as_dict=True)

        for po in purchase_orders:
            linked_docs.append(('Purchase Order', po['name']))

        # Add more document types as needed

    except Exception as e:
        # If tables don't exist, just continue
        pass

    return linked_docs

def cancel_linked_documents(linked_docs):
    """Cancel documents linked to the budget"""
    cancelled_docs = []

    try:
        for doc_type, doc_name in linked_docs:
            # Use frappe.get_doc() for safe document operations instead of direct SQL
            try:
                doc = frappe.get_doc(doc_type, doc_name)
                if doc.docstatus == 1:  # Only cancel submitted documents
                    doc.cancel()
                    cancelled_docs.append(doc_type + ': ' + doc_name)
            except Exception as doc_error:
                # Log individual document errors but continue with others
                frappe.log_error('Error cancelling ' + doc_type + ' ' + doc_name + ': ' + str(doc_error))

        frappe.db.commit()

    except Exception as e:
        # Log error but don't fail the whole process
        frappe.log_error('Error cancelling linked documents: ' + str(e))

    return cancelled_docs

def process_intra_budget_amendment(budget_name, from_account, to_account, amount):
    """Process amendment for Intra-Budget transfer"""
    try:
        # Get source budget data (allow cancelled budgets for re-amendment)
        source_budget_data = frappe.db.sql("""
            SELECT *
            FROM `tabBudget`
            WHERE name = %s AND docstatus IN (1, 2)
        """, (budget_name,), as_dict=True)

        if not source_budget_data:
            raise Exception("Source budget not found or not submitted: " + budget_name)

        source_budget = source_budget_data[0]

        # Get budget accounts
        budget_accounts = frappe.db.sql("""
            SELECT account, budget_amount
            FROM `tabBudget Account`
            WHERE parent = %s
        """, (budget_name,), as_dict=True)

        # Validate accounts and amounts
        from_account_amount = None
        to_account_amount = None

        for account in budget_accounts:
            if account['account'] == from_account:
                from_account_amount = float(account['budget_amount'])
            if account['account'] == to_account:
                to_account_amount = float(account['budget_amount'])

        if from_account_amount is None:
            raise Exception("FROM account not found in budget: " + from_account)
        if to_account_amount is None:
            raise Exception("TO account not found in budget: " + to_account)

        # Note: Allow amendment even if insufficient budget - this creates budget increase/adjustment
        # The validation is now informational only, not blocking

        # Cancel existing budget using safe method
        frappe.db.set_value("Budget", budget_name, "docstatus", 2)

        # Generate amended budget name
        amended_name = generate_amended_budget_name(budget_name)

        # Create amended budget using safe method - copy all fields from original
        budget_dict = dict(source_budget)
        budget_dict['doctype'] = 'Budget'
        budget_dict['name'] = None  # Let Frappe generate new name
        budget_dict['amended_from'] = budget_name
        budget_dict['docstatus'] = 0  # Draft status
        budget_dict['workflow_state'] = 'Draft'  # Reset to Draft state
        budget_dict['accounts'] = []

        # Remove fields that shouldn't be copied
        fields_to_remove = ['creation', 'modified', 'modified_by', 'owner', 'idx']
        for field in fields_to_remove:
            if field in budget_dict:
                del budget_dict[field]

        amended_budget = frappe.get_doc(budget_dict)

        # Add adjusted budget accounts
        for account in budget_accounts:
            new_amount = float(account['budget_amount'])
            if account['account'] == from_account:
                new_amount = float(account['budget_amount']) - float(amount)
            elif account['account'] == to_account:
                new_amount = float(account['budget_amount']) + float(amount)

            amended_budget.append('accounts', {
                'account': account['account'],
                'budget_amount': new_amount
            })

        amended_budget.insert()
        # Don't submit - leave in Draft state for proper workflow
        amended_name = amended_budget.name

        return {
            'amended_budget_name': amended_name,
            'original_budget_name': budget_name,
            'summary': 'Transferred ' + str(amount) + ' from ' + from_account + ' to ' + to_account + ' within budget ' + budget_name
        }

    except Exception as e:
        raise Exception('Intra-Budget amendment error: ' + str(e))

def process_inter_budget_amendment(source_budget_name, target_budget_name, from_account, to_account, amount):
    """Process amendment for Inter-Budget transfer"""
    try:
        # Get source and target budget data (allow cancelled budgets for re-amendment)
        source_budget_data = frappe.db.sql("""
            SELECT *
            FROM `tabBudget`
            WHERE name = %s AND docstatus IN (1, 2)
        """, (source_budget_name,), as_dict=True)

        target_budget_data = frappe.db.sql("""
            SELECT *
            FROM `tabBudget`
            WHERE name = %s AND docstatus IN (1, 2)
        """, (target_budget_name,), as_dict=True)

        if not source_budget_data:
            raise Exception("Source budget not found: " + source_budget_name)
        if not target_budget_data:
            raise Exception("Target budget not found: " + target_budget_name)

        source_budget = source_budget_data[0]
        target_budget = target_budget_data[0]

        # Get budget accounts
        source_accounts = frappe.db.sql("""
            SELECT account, budget_amount FROM `tabBudget Account` WHERE parent = %s
        """, (source_budget_name,), as_dict=True)

        target_accounts = frappe.db.sql("""
            SELECT account, budget_amount FROM `tabBudget Account` WHERE parent = %s
        """, (target_budget_name,), as_dict=True)

        # Validate FROM account in source budget
        from_account_amount = None
        for account in source_accounts:
            if account['account'] == from_account:
                from_account_amount = float(account['budget_amount'])
                break

        if from_account_amount is None:
            raise Exception("FROM account not found in source budget: " + from_account)

        # Note: Allow amendment even if insufficient budget - this creates budget increase/adjustment
        # The validation is now informational only, not blocking

        # Check if TO account exists in target budget
        to_account_exists = any(account['account'] == to_account for account in target_accounts)

        # Cancel existing budgets using safe method
        frappe.db.set_value("Budget", source_budget_name, "docstatus", 2)
        frappe.db.set_value("Budget", target_budget_name, "docstatus", 2)

        # Create amended budgets
        amended_source_name = generate_amended_budget_name(source_budget_name)
        amended_target_name = generate_amended_budget_name(target_budget_name)

        # Create amended source budget
        amended_source_budget = create_amended_budget(source_budget, amended_source_name, source_budget_name)
        copy_budget_accounts_with_adjustment(source_accounts, amended_source_budget, from_account, -float(amount))
        amended_source_budget.insert()
        # Don't submit - leave in Draft state for proper workflow

        # Create amended target budget
        amended_target_budget = create_amended_budget(target_budget, amended_target_name, target_budget_name)
        copy_budget_accounts_with_adjustment(target_accounts, amended_target_budget, to_account, float(amount), not to_account_exists)
        amended_target_budget.insert()
        # Don't submit - leave in Draft state for proper workflow

        return {
            'amended_budget_name': amended_source_name + ', ' + amended_target_name,
            'original_budget_name': source_budget_name + ', ' + target_budget_name,
            'summary': 'Transferred ' + str(amount) + ' from ' + source_budget_name + '/' + from_account + ' to ' + target_budget_name + '/' + to_account
        }

    except Exception as e:
        raise Exception('Inter-Budget amendment error: ' + str(e))

def process_multi_transfer_amendment(doc_name, virement_type, budget, target_budget):
    """Process amendment for multiple transfers"""
    try:
        # Get all transfer items from Budget Request
        transfers = get_transfer_data(doc_name)

        if not transfers:
            raise Exception("No transfer items found in Budget Request")

        # Group transfers by budget type
        intra_transfers = []
        inter_transfers = []

        for transfer in transfers:
            # Determine if this is intra or inter budget transfer
            # For now, assume all transfers follow the same virement_type
            # In future, could determine per transfer based on account budgets
            if virement_type == "Intra-Budget":
                intra_transfers.append(transfer)
            else:
                inter_transfers.append(transfer)

        # Process intra-budget transfers
        intra_results = []
        for transfer in intra_transfers:
            result = process_intra_budget_amendment(
                budget,
                transfer['from_account'],
                transfer['to_account'],
                transfer['amount_requested']
            )
            intra_results.append(result)

        # Process inter-budget transfers
        inter_results = []
        for transfer in inter_transfers:
            if not target_budget:
                raise Exception('Target budget is required for Inter-Budget transfers')
            result = process_inter_budget_amendment(
                budget,
                target_budget,
                transfer['from_account'],
                transfer['to_account'],
                transfer['amount_requested']
            )
            inter_results.append(result)

        # Combine results
        all_results = intra_results + inter_results
        total_amount = sum(transfer['amount_requested'] for transfer in transfers)

        # Create summary
        transfer_summaries = []
        for transfer in transfers:
            transfer_summaries.append(f"{transfer['amount_requested']} from {transfer['from_account']} to {transfer['to_account']}")

        return {
            'success': True,
            'amended_budget_names': [result.get('amended_budget_name', '') for result in all_results if result.get('success')],
            'original_budget_name': budget + (f', {target_budget}' if target_budget else ''),
            'summary': f'Multi-transfer: {"; ".join(transfer_summaries)} (Total: {total_amount})',
            'transfer_count': len(transfers),
            'individual_results': all_results
        }

    except Exception as e:
        raise Exception('Multi-transfer amendment error: ' + str(e))

def generate_amended_budget_name(original_name):
    """Generate unique amended budget name"""
    amended_name = original_name + "-1"
    counter = 1
    while frappe.db.exists("Budget", amended_name):
        counter = counter + 1
        amended_name = original_name + "-" + str(counter)
    return amended_name

def create_amended_budget(budget_data, amended_name, original_name):
    """Create amended budget record using safe method - copy all fields from original"""
    budget_dict = dict(budget_data)
    budget_dict['doctype'] = 'Budget'
    budget_dict['name'] = None  # Let Frappe generate new name
    budget_dict['amended_from'] = original_name
    budget_dict['docstatus'] = 0  # Draft status
    budget_dict['workflow_state'] = 'Draft'  # Reset to Draft state
    budget_dict['accounts'] = []

    # Ensure all required fields are present - copy from original budget
    required_fields = [
        'budget_type', 'fiscal_year', 'budget_against', 'company', 'naming_series',
        'monthly_distribution', 'custom_consolidation_group', 'custom_fund_type', 'custom_location'
    ]

    for field in required_fields:
        if field not in budget_dict or not budget_dict[field]:
            # Get the value from the original budget if missing
            if hasattr(budget_data, field):
                budget_dict[field] = getattr(budget_data, field)
            elif field in budget_data:
                budget_dict[field] = budget_data[field]

    # Remove fields that shouldn't be copied
    fields_to_remove = ['creation', 'modified', 'modified_by', 'owner', 'idx']
    for field in fields_to_remove:
        if field in budget_dict:
            del budget_dict[field]

    amended_budget = frappe.get_doc(budget_dict)
    # Don't insert/submit yet - wait for accounts to be added
    return amended_budget

def copy_budget_accounts_with_adjustment(accounts, budget_doc, adjust_account, adjust_amount, add_if_missing=False):
    """Copy budget accounts with optional adjustment using safe method"""
    account_adjusted = False

    for account in accounts:
        new_amount = float(account['budget_amount'])
        if account['account'] == adjust_account:
            new_amount = new_amount + adjust_amount
            account_adjusted = True

        budget_doc.append('accounts', {
            'account': account['account'],
            'budget_amount': new_amount
        })

    # Add new account if it didn't exist and we need to add it
    if add_if_missing and not account_adjusted:
        budget_doc.append('accounts', {
            'account': adjust_account,
            'budget_amount': adjust_amount
        })


def get_amended_budgets(source_budget, target_budget=None, virement_type=None):
    """Get amended budget names for a Budget Request - safe server method"""
    try:
        amended_budgets = []

        # For Intra-Budget: only check source budget
        if virement_type == 'Intra-Budget' and source_budget:
            rows = frappe.db.sql(
                """
                SELECT name FROM `tabBudget`
                WHERE amended_from = %s
                ORDER BY creation DESC
                """,
                (source_budget,),
                as_dict=True,
            )
            amended_budgets.extend([r.name for r in rows])

        # For Inter-Budget: check both source and target budgets
        elif virement_type == 'Inter-Budget':
            if source_budget:
                rows = frappe.db.sql(
                    """
                    SELECT name FROM `tabBudget`
                    WHERE amended_from = %s
                    ORDER BY creation DESC
                    """,
                    (source_budget,),
                    as_dict=True,
                )
                amended_budgets.extend([r.name for r in rows])

            if target_budget:
                rows = frappe.db.sql(
                    """
                    SELECT name FROM `tabBudget`
                    WHERE amended_from = %s
                    ORDER BY creation DESC
                    """,
                    (target_budget,),
                    as_dict=True,
                )
                amended_budgets.extend([r.name for r in rows])

        return amended_budgets

    except Exception as e:
        frappe.log_error(f"Error getting amended budgets: {str(e)}")
        return []


def get_summary_details(source_budget, target_budget=None, virement_type=None, from_account=None, to_account=None):
    """Return before/after amounts for involved accounts and latest amended budgets"""
    try:
        def get_amount(budget_name, account_name):
            if not budget_name or not account_name:
                return None
            row = frappe.db.sql(
                """
                SELECT budget_amount FROM `tabBudget Account`
                WHERE parent = %s AND account = %s
                """,
                (budget_name, account_name),
                as_dict=True,
            )
            return float(row[0].budget_amount) if row else 0.0

        def latest_amended(original_name):
            rows = frappe.db.sql(
                """
                SELECT name FROM `tabBudget`
                WHERE amended_from = %s
                ORDER BY creation DESC
                LIMIT 1
                """,
                (original_name,),
                as_dict=True,
            )
            return rows[0].name if rows else None

        result = {
            'amended_budgets': [],
            'from': {'budget': source_budget, 'account': from_account, 'before': None, 'after': None},
            'to': {'budget': target_budget or source_budget, 'account': to_account, 'before': None, 'after': None},
        }

        if virement_type == 'Intra-Budget':
            amended = latest_amended(source_budget)
            result['amended_budgets'] = [amended] if amended else []

            result['from']['before'] = get_amount(source_budget, from_account)
            result['to']['before'] = get_amount(source_budget, to_account)

            if amended:
                result['from']['after'] = get_amount(amended, from_account)
                result['to']['after'] = get_amount(amended, to_account)

        elif virement_type == 'Inter-Budget':
            amended_source = latest_amended(source_budget)
            amended_target = latest_amended(target_budget) if target_budget else None
            result['amended_budgets'] = [n for n in [amended_source, amended_target] if n]

            result['from']['before'] = get_amount(source_budget, from_account)
            result['from']['after'] = get_amount(amended_source, from_account) if amended_source else None

            result['to']['budget'] = target_budget
            result['to']['before'] = get_amount(target_budget, to_account) if target_budget else None
            result['to']['after'] = get_amount(amended_target, to_account) if amended_target else None

        return result

    except Exception as e:
        frappe.log_error(f"Error getting summary details: {str(e)}")
        return {
            'amended_budgets': [],
            'from': {'budget': source_budget, 'account': from_account, 'before': None, 'after': None},
            'to': {'budget': target_budget or source_budget, 'account': to_account, 'before': None, 'after': None},
        }


