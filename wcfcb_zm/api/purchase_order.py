import frappe
from frappe import _
from frappe.utils import flt

# Reuse the robust budget computation from Material Request API
from wcfcb_zm.api.material_request import get_budget_details


@frappe.whitelist()
def check_budget(expense_account, cost_center=None, project=None, requested_amount=0, transaction_date=None):
    """Budget check for Purchase Orders with monthly distribution awareness.
    - Uses the same logic and double-counting prevention as Material Request
    - Returns annual + monthly (if configured) budget info and non-blocking statuses
    """
    try:
        if not expense_account:
            frappe.throw(_("Expense Account is required"))
        if not cost_center and not project:
            frappe.throw(_("Either Cost Center or Project is required for budget checking"))
        if cost_center and project:
            frappe.throw(_("Please specify either Cost Center OR Project, not both"))

        # Compute budget details (annual + monthly breakdowns if any)
        budget_data = get_budget_details(expense_account, cost_center, project, transaction_date)

        # Add requested amount validation (warning-only semantics are handled client-side)
        requested_amount = flt(requested_amount)
        for budget in budget_data:
            # Annual budget status
            budget['within_annual_budget'] = requested_amount <= budget['available_budget']
            budget['annual_budget_status'] = (
                'WITHIN BUDGET' if budget['within_annual_budget'] else 'EXCEEDS BUDGET'
            )

            # Monthly budget status (if applicable)
            if budget.get('has_monthly_distribution'):
                monthly_available = budget.get('monthly_available_budget', 0)
                budget['within_monthly_budget'] = requested_amount <= monthly_available
                budget['monthly_budget_status'] = (
                    'WITHIN MONTHLY BUDGET' if budget['within_monthly_budget'] else 'EXCEEDS MONTHLY BUDGET'
                )

                if budget['within_annual_budget'] and budget['within_monthly_budget']:
                    budget['overall_status'] = 'WITHIN BUDGET'
                elif not budget['within_monthly_budget']:
                    budget['overall_status'] = 'EXCEEDS MONTHLY BUDGET'
                else:
                    budget['overall_status'] = 'EXCEEDS ANNUAL BUDGET'
            else:
                budget['within_monthly_budget'] = True
                budget['monthly_budget_status'] = 'NO MONTHLY DISTRIBUTION'
                budget['overall_status'] = budget['annual_budget_status']

        return budget_data

    except Exception as e:
        frappe.log_error(message=str(e), title="PO Budget Check Error")
        frappe.throw(str(e))

