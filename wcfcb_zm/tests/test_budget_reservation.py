import frappe
import unittest
from frappe.tests.utils import FrappeTestCase
from wcfcb_zm.budget_reservation import BudgetReservationManager


class TestBudgetReservation(FrappeTestCase):
    """
    Test cases for Budget Reservation Management between Material Requests and Purchase Orders.
    """
    
    def setUp(self):
        """Set up test data"""
        self.setup_test_data()
    
    def tearDown(self):
        """Clean up test data"""
        self.cleanup_test_data()
    
    def setup_test_data(self):
        """Create test data for budget reservation tests"""
        # Create test supplier
        if not frappe.db.exists("Supplier", "Test Supplier"):
            supplier = frappe.get_doc({
                "doctype": "Supplier",
                "supplier_name": "Test Supplier",
                "supplier_group": "All Supplier Groups"
            })
            supplier.insert()
        
        # Create test item
        if not frappe.db.exists("Item", "Test Item"):
            item = frappe.get_doc({
                "doctype": "Item",
                "item_code": "Test Item",
                "item_name": "Test Item",
                "item_group": "All Item Groups",
                "stock_uom": "Nos",
                "is_stock_item": 1
            })
            item.insert()
    
    def cleanup_test_data(self):
        """Clean up test data"""
        # Delete test documents
        for doctype in ["Purchase Order", "Material Request"]:
            test_docs = frappe.get_all(doctype, filters={"name": ["like", "TEST-%"]})
            for doc in test_docs:
                frappe.delete_doc(doctype, doc.name, force=True)
    
    def create_test_material_request(self):
        """Create a test Material Request"""
        mr = frappe.get_doc({
            "doctype": "Material Request",
            "naming_series": "TEST-MR-.YYYY.-",
            "material_request_type": "Purchase",
            "company": frappe.defaults.get_user_default("Company"),
            "items": [{
                "item_code": "Test Item",
                "qty": 10,
                "rate": 100,
                "amount": 1000,
                "warehouse": frappe.db.get_value("Warehouse", {"is_group": 0}, "name")
            }]
        })
        mr.insert()
        mr.submit()
        return mr
    
    def create_test_purchase_order(self, material_request=None):
        """Create a test Purchase Order"""
        po_data = {
            "doctype": "Purchase Order",
            "naming_series": "TEST-PO-.YYYY.-",
            "supplier": "Test Supplier",
            "company": frappe.defaults.get_user_default("Company"),
            "items": [{
                "item_code": "Test Item",
                "qty": 10,
                "rate": 100,
                "amount": 1000
            }]
        }
        
        # Link to Material Request if provided
        if material_request:
            po_data["items"][0]["material_request"] = material_request.name
            po_data["items"][0]["material_request_item"] = material_request.items[0].name
        
        po = frappe.get_doc(po_data)
        return po
    
    def test_auto_link_po_to_mr(self):
        """Test automatic linking of PO to MR"""
        # Create Material Request
        mr = self.create_test_material_request()
        
        # Create Purchase Order from Material Request
        po = self.create_test_purchase_order(mr)
        
        # Test auto-linking before insert
        BudgetReservationManager.auto_link_po_to_mr(po)
        
        # Verify linking
        self.assertEqual(po.custom_linked_material_request, mr.name)
        self.assertEqual(po.custom_budget_reservation_status, "Reserved from MR")
        self.assertEqual(po.custom_original_mr_budget_amount, 1000)
    
    def test_budget_transfer_from_mr_to_po(self):
        """Test budget transfer from MR to PO"""
        # Create Material Request
        mr = self.create_test_material_request()
        
        # Create and link Purchase Order
        po = self.create_test_purchase_order(mr)
        po.custom_linked_material_request = mr.name
        po.custom_budget_reservation_status = "Reserved from MR"
        po.insert()
        
        # Test budget transfer
        BudgetReservationManager.transfer_budget_from_mr_to_po(po)
        
        # Verify transfer
        self.assertTrue(po.custom_budget_transferred_from_mr)
        self.assertEqual(po.custom_budget_reservation_status, "Transferred from MR")
        
        # Verify MR budget is cleared
        mr.reload()
        self.assertTrue(mr.custom_budget_reservation_cleared)
        self.assertIn(po.name, mr.custom_linked_purchase_orders or "")
    
    def test_budget_validation_skip(self):
        """Test budget validation skip for linked POs"""
        # Create Material Request
        mr = self.create_test_material_request()
        
        # Create and link Purchase Order
        po = self.create_test_purchase_order(mr)
        po.custom_linked_material_request = mr.name
        po.custom_budget_transferred_from_mr = True
        
        # Test validation skip
        should_skip = BudgetReservationManager.should_skip_budget_validation(po)
        self.assertTrue(should_skip)
        
        # Test independent PO (should not skip)
        independent_po = self.create_test_purchase_order()
        should_skip_independent = BudgetReservationManager.should_skip_budget_validation(independent_po)
        self.assertFalse(should_skip_independent)
    
    def test_independent_po_budget_status(self):
        """Test budget status for independent POs"""
        # Create independent Purchase Order
        po = self.create_test_purchase_order()
        po.insert()
        
        # Verify no MR linking
        self.assertIsNone(po.custom_linked_material_request)
        
        # Test that it should not skip validation
        should_skip = BudgetReservationManager.should_skip_budget_validation(po)
        self.assertFalse(should_skip)
    
    def test_mr_budget_status_validation(self):
        """Test Material Request budget status validation"""
        # Create Material Request
        mr = self.create_test_material_request()
        
        # Test validation
        status = BudgetReservationManager.validate_mr_budget_status(mr.name)
        
        self.assertTrue(status["valid"])
        self.assertFalse(status["budget_cleared"])
        self.assertEqual(status["total_amount"], 1000)
    
    def test_po_mr_linkage_check(self):
        """Test PO-MR linkage status check"""
        # Create Material Request
        mr = self.create_test_material_request()
        
        # Create and link Purchase Order
        po = self.create_test_purchase_order(mr)
        po.custom_linked_material_request = mr.name
        po.custom_budget_reservation_status = "Reserved from MR"
        po.custom_original_mr_budget_amount = 1000
        po.insert()
        
        # Test linkage check via API
        result = frappe.get_doc("wcfcb_zm.budget_reservation", "check_po_mr_linkage").run_method(
            "check_po_mr_linkage", po.name
        )
        
        self.assertTrue(result["valid"])
        self.assertEqual(result["linked_mr"], mr.name)
        self.assertEqual(result["budget_status"], "Reserved from MR")
    
    def test_multiple_pos_from_single_mr(self):
        """Test multiple Purchase Orders created from single Material Request"""
        # Create Material Request
        mr = self.create_test_material_request()
        
        # Create first Purchase Order
        po1 = self.create_test_purchase_order(mr)
        BudgetReservationManager.auto_link_po_to_mr(po1)
        po1.insert()
        
        # Create second Purchase Order from same MR
        po2 = self.create_test_purchase_order(mr)
        BudgetReservationManager.auto_link_po_to_mr(po2)
        po2.insert()
        
        # Both should be linked to the same MR
        self.assertEqual(po1.custom_linked_material_request, mr.name)
        self.assertEqual(po2.custom_linked_material_request, mr.name)
        
        # Transfer budget from first PO
        BudgetReservationManager.transfer_budget_from_mr_to_po(po1)
        
        # Verify MR budget is cleared
        mr.reload()
        self.assertTrue(mr.custom_budget_reservation_cleared)
        
        # Second PO should still be linked but budget already transferred
        BudgetReservationManager.transfer_budget_from_mr_to_po(po2)
        # Should handle gracefully (budget already cleared)
    
    def test_error_handling(self):
        """Test error handling in budget reservation operations"""
        # Test with non-existent MR
        status = BudgetReservationManager.validate_mr_budget_status("NON-EXISTENT-MR")
        self.assertFalse(status["valid"])
        
        # Test with invalid PO
        po = frappe.new_doc("Purchase Order")
        # Should not raise exception
        BudgetReservationManager.auto_link_po_to_mr(po)
        
        # Should return False for validation skip
        should_skip = BudgetReservationManager.should_skip_budget_validation(po)
        self.assertFalse(should_skip)


class TestBudgetReservationPlaywright:
    """
    Playwright-based end-to-end tests for Budget Reservation Management.
    These tests simulate actual user interactions in the browser.
    """

    @staticmethod
    def run_playwright_tests():
        """
        Run Playwright tests for budget reservation functionality.
        This method can be called from a separate test runner.
        """
        import subprocess

        # Create Playwright test script
        playwright_script = '''
const { test, expect } = require('@playwright/test');

test.describe('Budget Reservation Management', () => {
    test.beforeEach(async ({ page }) => {
        // Login as administrator
        await page.goto('http://localhost:8000/login');
        await page.fill('[data-fieldname="usr"]', 'administrator');
        await page.fill('[data-fieldname="pwd"]', 'admin');
        await page.click('.btn-login');
        await page.waitForURL('**/app');
    });

    test('Create Material Request and verify budget reservation', async ({ page }) => {
        // Navigate to Material Request
        await page.goto('http://localhost:8000/app/material-request/new-material-request-1');

        // Fill Material Request details
        await page.selectOption('[data-fieldname="material_request_type"]', 'Purchase');

        // Add item
        await page.click('.grid-add-row');
        await page.fill('[data-fieldname="item_code"] input', 'Test Item');
        await page.fill('[data-fieldname="qty"] input', '10');
        await page.fill('[data-fieldname="rate"] input', '100');

        // Save and Submit
        await page.click('.primary-action');
        await page.waitForSelector('.indicator-pill');

        // Submit the Material Request
        await page.click('[data-label="Submit"]');
        await page.click('.btn-primary'); // Confirm submission

        // Verify submission
        await expect(page.locator('.indicator-pill')).toContainText('Submitted');

        // Get MR name for later use
        const mrName = await page.locator('.title-text').textContent();
        console.log('Created Material Request:', mrName);
    });

    test('Create Purchase Order from Material Request', async ({ page }) => {
        // First create a Material Request (simplified)
        await page.goto('http://localhost:8000/app/material-request');

        // Find a submitted MR or create one
        await page.click('.list-row-container:first-child');

        // Create Purchase Order from MR
        await page.click('[data-label="Create"]');
        await page.click('text=Purchase Order');

        // Verify auto-linking
        await page.waitForSelector('[data-fieldname="custom_linked_material_request"]');
        const linkedMR = await page.inputValue('[data-fieldname="custom_linked_material_request"] input');
        expect(linkedMR).toBeTruthy();

        // Verify budget status
        const budgetStatus = await page.inputValue('[data-fieldname="custom_budget_reservation_status"] select');
        expect(budgetStatus).toBe('Reserved from MR');

        // Fill supplier
        await page.fill('[data-fieldname="supplier"] input', 'Test Supplier');

        // Save the PO
        await page.click('.primary-action');
        await page.waitForSelector('.indicator-pill');

        console.log('Purchase Order created and linked to MR');
    });

    test('Submit Purchase Order and verify budget transfer', async ({ page }) => {
        // Navigate to a PO linked to MR
        await page.goto('http://localhost:8000/app/purchase-order');

        // Find a PO with linked MR
        await page.click('.list-row-container:first-child');

        // Verify it's linked to MR
        const linkedMR = await page.inputValue('[data-fieldname="custom_linked_material_request"] input');
        if (!linkedMR) {
            console.log('No linked MR found, skipping test');
            return;
        }

        // Submit the Purchase Order
        await page.click('[data-label="Submit"]');
        await page.click('.btn-primary'); // Confirm submission

        // Verify submission and budget transfer
        await expect(page.locator('.indicator-pill')).toContainText('Submitted');

        // Check if budget transfer message appeared
        await expect(page.locator('.alert')).toContainText('Budget reservation successfully transferred');

        // Verify budget status changed
        const budgetStatus = await page.inputValue('[data-fieldname="custom_budget_reservation_status"] select');
        expect(budgetStatus).toBe('Transferred from MR');

        console.log('Budget transfer completed successfully');
    });

    test('Verify Material Request budget cleared', async ({ page }) => {
        // Navigate to Material Request list
        await page.goto('http://localhost:8000/app/material-request');

        // Find an MR with cleared budget
        await page.click('.list-row-container:first-child');

        // Check budget reservation cleared field
        const budgetCleared = await page.isChecked('[data-fieldname="custom_budget_reservation_cleared"] input');

        if (budgetCleared) {
            console.log('Material Request budget reservation cleared successfully');

            // Verify linked POs field is populated
            const linkedPOs = await page.inputValue('[data-fieldname="custom_linked_purchase_orders"] textarea');
            expect(linkedPOs).toBeTruthy();
            console.log('Linked Purchase Orders:', linkedPOs);
        }
    });

    test('Create independent Purchase Order', async ({ page }) => {
        // Navigate to new Purchase Order
        await page.goto('http://localhost:8000/app/purchase-order/new-purchase-order-1');

        // Fill PO details without MR reference
        await page.fill('[data-fieldname="supplier"] input', 'Test Supplier');

        // Add item without MR reference
        await page.click('.grid-add-row');
        await page.fill('[data-fieldname="item_code"] input', 'Test Item');
        await page.fill('[data-fieldname="qty"] input', '5');
        await page.fill('[data-fieldname="rate"] input', '100');

        // Save the PO
        await page.click('.primary-action');
        await page.waitForSelector('.indicator-pill');

        // Verify no MR linking
        const linkedMR = await page.inputValue('[data-fieldname="custom_linked_material_request"] input');
        expect(linkedMR).toBeFalsy();

        // Verify independent budget status
        const budgetStatus = await page.inputValue('[data-fieldname="custom_budget_reservation_status"] select');
        expect(budgetStatus).toBe('Reserved Independently');

        console.log('Independent Purchase Order created successfully');
    });
});
        '''

        # Write Playwright script to file
        script_path = '/tmp/budget_reservation_playwright.js'
        with open(script_path, 'w') as f:
            f.write(playwright_script)

        # Run Playwright tests
        try:
            result = subprocess.run([
                'npx', 'playwright', 'test', script_path, '--headed'
            ], capture_output=True, text=True, cwd='/tmp')

            print("Playwright Test Results:")
            print(result.stdout)
            if result.stderr:
                print("Errors:")
                print(result.stderr)

            return result.returncode == 0

        except Exception as e:
            print(f"Error running Playwright tests: {str(e)}")
            return False
