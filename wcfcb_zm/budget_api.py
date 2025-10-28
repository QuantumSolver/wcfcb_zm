# Copyright (c) 2024, elius mgani and contributors
# For license information, please see license.txt

import frappe


@frappe.whitelist(allow_guest=False)
def budget_virement_handler(action, **kwargs):
    """Main API function for all budget virement operations"""
    if action == 'validate_amount_approval':
        amount = kwargs.get('amount', 0)
        # Simple validation - amounts > 250000 require external approval
        requires_external = amount > 250000
        return {
            "requires_external_approval": requires_external,
            "threshold": 250000,
            "amount": amount
        }
    else:
        return {"message": f"Action '{action}' not implemented yet", "action": action}
