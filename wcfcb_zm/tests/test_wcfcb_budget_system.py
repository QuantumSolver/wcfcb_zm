#!/usr/bin/env python3
"""
WCFCB Budget System Tests - Frappe Style
Comprehensive tests for WCFCB budget customizations using Frappe's official test runner
"""

import frappe
import unittest
from frappe.utils import nowdate
from erpnext.accounts.utils import get_fiscal_year


class TestWCFCBBudgetSystem(unittest.TestCase):
    """Test WCFCB Budget System functionality using Frappe's official approach."""
    
    @classmethod
    def setUpClass(cls):
        """Set up test class."""
        frappe.set_user("Administrator")
        
    def setUp(self):
        """Set up test environment."""
        frappe.set_user("Administrator")
        
    def tearDown(self):
        """Clean up after tests."""
        # Clean up ALL test budgets (broader pattern)
        test_budget_patterns = ["BUD-WCFCB-TEST%", "BUD-%WCFCB%", "BUD-%FY-2025%"]
        for pattern in test_budget_patterns:
            test_budgets = frappe.get_all("Budget",
                filters={"name": ("like", pattern)},
                fields=["name"]
            )
            for budget in test_budgets:
                try:
                    doc = frappe.get_doc("Budget", budget.name)
                    if doc.docstatus == 1:
                        doc.cancel()
                    doc.delete()
                except:
                    pass

        # Clean up test budget requests
        test_budget_requests = frappe.get_all("Budget Request",
            filters={"name": ("like", "BR-WCFCB-TEST%")},
            fields=["name"]
        )
        for br in test_budget_requests:
            try:
                doc = frappe.get_doc("Budget Request", br.name)
                if doc.docstatus == 1:
                    doc.cancel()
                doc.delete()
            except:
                pass

        frappe.db.commit()
    
    def test_budget_creation_with_custom_fields(self):
        """Test creating a budget with WCFCB custom mandatory fields."""
        budget = self.make_wcfcb_budget()
        
        # Verify budget was created successfully
        self.assertTrue(budget.name)
        self.assertEqual(budget.company, "Workers Compensation Fund Control Board")
        self.assertEqual(budget.custom_fund_type, "Pension Fund")
        self.assertEqual(budget.custom_location, "HQ1")
        self.assertEqual(budget.custom_consolidation_group, "OPEX - HQ")
        
        # Verify budget account
        self.assertEqual(len(budget.accounts), 1)
        self.assertEqual(budget.accounts[0].budget_amount, 100000)
        
    def test_budget_validation_and_submission(self):
        """Test WCFCB budget validation and submission."""
        budget = self.make_wcfcb_budget(submit=False)
        
        # Test that budget validates successfully with custom fields
        budget.validate()
        
        # Test that budget can be submitted
        budget.submit()
        self.assertEqual(budget.docstatus, 1)
        
    def test_budget_with_different_fund_types(self):
        """Test budget creation with different fund types."""
        # Test with Accident Fund
        budget1 = self.make_wcfcb_budget(custom_fund_type="Accident Fund")
        self.assertEqual(budget1.custom_fund_type, "Accident Fund")
        
        # Test with Pension Fund
        budget2 = self.make_wcfcb_budget(custom_fund_type="Pension Fund")
        self.assertEqual(budget2.custom_fund_type, "Pension Fund")
        
    def test_budget_consolidation_groups(self):
        """Test budget creation with different consolidation groups."""
        consolidation_groups = [
            "OPEX - HQ",
            "OPEX - Northern Region", 
            "OPEX - Southern Region",
            "CAPEX - Motor Vehicles",
            "CAPEX - Other"
        ]
        
        for group in consolidation_groups:
            budget = self.make_wcfcb_budget(custom_consolidation_group=group)
            self.assertEqual(budget.custom_consolidation_group, group)
            
    def test_budget_request_creation(self):
        """Test Budget Request (custom DocType) creation."""
        # First create a budget to transfer from/to
        source_budget = self.make_wcfcb_budget(budget_amount=200000)
        
        # Create Budget Request
        budget_request = self.make_wcfcb_budget_request(
            source_budget=source_budget.name,
            transfer_amount=50000
        )
        
        # Verify Budget Request was created
        self.assertTrue(budget_request.name)
        self.assertEqual(budget_request.docstatus, 1)
        
    def test_budget_virement_intra_budget(self):
        """Test intra-budget virement (within same budget)."""
        # Create budget with multiple accounts
        budget = self.make_wcfcb_budget_multi_account()
        
        # Create intra-budget transfer request
        budget_request = self.make_wcfcb_budget_request(
            source_budget=budget.name,
            virement_type="Intra-Budget",
            transfer_amount=25000
        )
        
        self.assertEqual(budget_request.virement_type, "Intra-Budget")
        
    def test_budget_virement_inter_budget(self):
        """Test inter-budget virement (between different budgets)."""
        # Create source and target budgets
        source_budget = self.make_wcfcb_budget(budget_amount=150000)
        target_budget = self.make_wcfcb_budget(budget_amount=100000)
        
        # Create inter-budget transfer request
        budget_request = self.make_wcfcb_budget_request(
            source_budget=source_budget.name,
            target_budget=target_budget.name,
            virement_type="Inter-Budget",
            transfer_amount=30000
        )
        
        self.assertEqual(budget_request.virement_type, "Inter-Budget")
        
    def make_wcfcb_budget(self, submit=True, **args):
        """Create a WCFCB budget with proper custom fields."""
        args = frappe._dict(args)

        # Get current fiscal year
        fiscal_year = get_fiscal_year(nowdate())[0]

        # Create unique budget name with more randomness
        import time
        import random
        unique_suffix = str(int(time.time() * 1000))[-6:] + str(random.randint(1000, 9999))

        # Create new budget
        budget = frappe.new_doc("Budget")

        # Set basic fields
        budget.company = "Workers Compensation Fund Control Board"
        budget.fiscal_year = fiscal_year
        budget.budget_against = "Cost Center"

        # Get unique cost center and account to avoid duplicates
        cost_centers = frappe.get_all("Cost Center",
            filters={"company": "Workers Compensation Fund Control Board", "is_group": 0},
            fields=["name"],
            limit=20  # Get more options
        )
        if cost_centers:
            # Use more randomness for selection
            cc_index = (int(unique_suffix) + random.randint(0, 100)) % len(cost_centers)
            budget.cost_center = cost_centers[cc_index].name
        
        # Set WCFCB custom mandatory fields
        budget.custom_fund_type = args.get("custom_fund_type", "Pension Fund")
        budget.custom_location = args.get("custom_location", "HQ1")
        budget.custom_consolidation_group = args.get("custom_consolidation_group", "OPEX - HQ")
        
        # Set monthly distribution
        monthly_dists = frappe.get_all("Monthly Distribution", limit=1)
        if monthly_dists:
            budget.monthly_distribution = monthly_dists[0].name
        
        # Set budget control settings
        budget.applicable_on_booking_actual_expenses = 1
        budget.action_if_annual_budget_exceeded = args.get("action_if_annual_budget_exceeded", "Warn")
        budget.action_if_accumulated_monthly_budget_exceeded = args.get("action_if_accumulated_monthly_budget_exceeded", "Warn")
        
        # Add budget account with more randomness
        expense_accounts = frappe.get_all("Account",
            filters={
                "company": "Workers Compensation Fund Control Board",
                "account_type": "Expense Account",
                "is_group": 0
            },
            fields=["name"],
            limit=50  # Get many more options
        )

        if expense_accounts:
            # Use more randomness for account selection
            account_index = (int(unique_suffix) + random.randint(0, 1000)) % len(expense_accounts)
            budget.append("accounts", {
                "account": expense_accounts[account_index].name,
                "budget_amount": args.get("budget_amount", 100000)
            })
        
        # Insert budget
        budget.insert(ignore_permissions=True)
        
        if submit:
            budget.submit()
            
        return budget
        
    def make_wcfcb_budget_multi_account(self):
        """Create a budget with multiple accounts for intra-budget testing."""
        budget = self.make_wcfcb_budget(submit=False, budget_amount=200000)
        
        # Add second account
        expense_accounts = frappe.get_all("Account", 
            filters={
                "company": "Workers Compensation Fund Control Board",
                "account_type": "Expense Account",
                "is_group": 0
            },
            fields=["name"],
            limit=5
        )
        
        if len(expense_accounts) > 1:
            budget.append("accounts", {
                "account": expense_accounts[1].name,
                "budget_amount": 150000
            })
        
        budget.submit()
        return budget
        
    def make_wcfcb_budget_request(self, **args):
        """Create a WCFCB Budget Request."""
        args = frappe._dict(args)
        
        # Create unique name
        import time
        unique_suffix = str(int(time.time() * 1000))[-6:]
        
        budget_request = frappe.new_doc("Budget Request")
        budget_request.company = "Workers Compensation Fund Control Board"
        budget_request.virement_type = args.get("virement_type", "Intra-Budget")
        budget_request.transfer_amount = args.get("transfer_amount", 50000)
        budget_request.reason = f"Test budget transfer {unique_suffix}"
        
        # Set source budget if provided
        if args.get("source_budget"):
            budget_request.source_budget = args.source_budget
            
        # Set target budget for inter-budget transfers
        if args.get("target_budget"):
            budget_request.target_budget = args.target_budget
        
        budget_request.insert(ignore_permissions=True)
        budget_request.submit()
        
        return budget_request


if __name__ == "__main__":
    frappe.init(site="wcfcb")
    frappe.connect()
    
    suite = unittest.TestLoader().loadTestsFromTestCase(TestWCFCBBudgetSystem)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    exit(0 if result.wasSuccessful() else 1)
