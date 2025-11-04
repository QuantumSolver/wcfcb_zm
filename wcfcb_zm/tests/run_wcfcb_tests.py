#!/usr/bin/env python3
"""
WCFCB Test Runner - Frappe Style
Comprehensive test runner for all WCFCB customizations using Frappe's official test approach
"""

import frappe
import unittest
import sys
import os
from unittest.mock import patch


class WCFCBTestRunner:
    """Test runner for WCFCB customizations."""
    
    def __init__(self):
        """Initialize test runner."""
        self.test_modules = [
            'wcfcb_zm.tests.test_wcfcb_budget_system',
            'wcfcb_zm.tests.test_wcfcb_server_scripts', 
            'wcfcb_zm.tests.test_wcfcb_custom_doctypes'
        ]
        
    def setup_test_environment(self):
        """Set up the test environment."""
        # Initialize Frappe
        frappe.init(site="wcfcb")
        frappe.connect()
        frappe.set_user("Administrator")
        
        # Set test flags
        frappe.flags.in_test = True
        frappe.flags.testing = True
        
        print("✅ Test environment initialized")
        
    def setup_mocking(self):
        """Set up comprehensive mocking for external services."""
        # Mock external HTTP calls
        self.mock_requests_post = patch('requests.post')
        self.mock_requests_get = patch('requests.get')
        self.mock_sendmail = patch('frappe.sendmail')
        self.mock_enqueue = patch('frappe.enqueue')
        self.mock_publish_realtime = patch('frappe.publish_realtime')
        
        # Start all patches
        self.mock_requests_post.start()
        self.mock_requests_get.start()
        self.mock_sendmail.start()
        self.mock_enqueue.start()
        self.mock_publish_realtime.start()
        
        # Configure mock responses
        mock_post = self.mock_requests_post.return_value
        mock_post.status_code = 200
        mock_post.json.return_value = {"success": True, "data": []}
        
        mock_get = self.mock_requests_get.return_value
        mock_get.status_code = 200
        mock_get.json.return_value = {"success": True, "data": []}
        
        print("✅ External service mocking configured")
        
    def cleanup_mocking(self):
        """Clean up mocking."""
        try:
            self.mock_requests_post.stop()
            self.mock_requests_get.stop()
            self.mock_sendmail.stop()
            self.mock_enqueue.stop()
            self.mock_publish_realtime.stop()
        except:
            pass
            
    def run_test_module(self, module_name, verbose=True):
        """Run tests for a specific module."""
        print(f"\n🧪 Running tests for {module_name}")
        print("=" * 60)
        
        try:
            # Import the test module
            test_module = __import__(module_name, fromlist=[''])
            
            # Get all test classes from the module
            test_classes = []
            for name in dir(test_module):
                obj = getattr(test_module, name)
                if (isinstance(obj, type) and 
                    issubclass(obj, unittest.TestCase) and 
                    obj != unittest.TestCase):
                    test_classes.append(obj)
            
            if not test_classes:
                print(f"❌ No test classes found in {module_name}")
                return False
                
            # Create test suite
            suite = unittest.TestSuite()
            for test_class in test_classes:
                tests = unittest.TestLoader().loadTestsFromTestCase(test_class)
                suite.addTests(tests)
            
            # Run tests
            runner = unittest.TextTestRunner(
                verbosity=2 if verbose else 1,
                stream=sys.stdout
            )
            result = runner.run(suite)
            
            # Print results
            if result.wasSuccessful():
                print(f"✅ {module_name}: ALL TESTS PASSED")
                print(f"   Tests run: {result.testsRun}")
            else:
                print(f"❌ {module_name}: SOME TESTS FAILED")
                print(f"   Tests run: {result.testsRun}")
                print(f"   Failures: {len(result.failures)}")
                print(f"   Errors: {len(result.errors)}")
                
                # Print failure details
                if result.failures:
                    print("\n📋 FAILURES:")
                    for test, traceback in result.failures:
                        print(f"   - {test}: {traceback.split('AssertionError:')[-1].strip()}")
                        
                if result.errors:
                    print("\n🚨 ERRORS:")
                    for test, traceback in result.errors:
                        print(f"   - {test}: {traceback.split('Exception:')[-1].strip()}")
            
            return result.wasSuccessful()
            
        except Exception as e:
            print(f"❌ Error running {module_name}: {str(e)}")
            return False
            
    def run_all_tests(self, verbose=True):
        """Run all WCFCB tests."""
        print("🚀 Starting WCFCB Comprehensive Test Suite")
        print("=" * 60)
        
        # Setup
        self.setup_test_environment()
        self.setup_mocking()
        
        results = {}
        total_success = True
        
        try:
            # Run each test module
            for module in self.test_modules:
                success = self.run_test_module(module, verbose)
                results[module] = success
                if not success:
                    total_success = False
                    
        finally:
            # Cleanup
            self.cleanup_mocking()
            
        # Print final summary
        print("\n" + "=" * 60)
        print("📊 FINAL TEST RESULTS SUMMARY")
        print("=" * 60)
        
        for module, success in results.items():
            status = "✅ PASSED" if success else "❌ FAILED"
            print(f"{module}: {status}")
            
        print("\n" + "=" * 60)
        if total_success:
            print("🎉 ALL WCFCB TESTS PASSED! 100% SUCCESS RATE")
        else:
            print("⚠️  SOME WCFCB TESTS FAILED - REVIEW RESULTS ABOVE")
        print("=" * 60)
        
        return total_success
        
    def run_specific_test(self, test_type, verbose=True):
        """Run specific test type."""
        test_mapping = {
            'budget': 'wcfcb_zm.tests.test_wcfcb_budget_system',
            'server_scripts': 'wcfcb_zm.tests.test_wcfcb_server_scripts',
            'doctypes': 'wcfcb_zm.tests.test_wcfcb_custom_doctypes'
        }
        
        if test_type not in test_mapping:
            print(f"❌ Unknown test type: {test_type}")
            print(f"Available types: {', '.join(test_mapping.keys())}")
            return False
            
        # Setup
        self.setup_test_environment()
        self.setup_mocking()
        
        try:
            success = self.run_test_module(test_mapping[test_type], verbose)
        finally:
            self.cleanup_mocking()
            
        return success


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description='WCFCB Test Runner')
    parser.add_argument('--type', choices=['budget', 'server_scripts', 'doctypes', 'all'], 
                       default='all', help='Type of tests to run')
    parser.add_argument('--verbose', '-v', action='store_true', 
                       help='Verbose output')
    
    args = parser.parse_args()
    
    runner = WCFCBTestRunner()
    
    if args.type == 'all':
        success = runner.run_all_tests(args.verbose)
    else:
        success = runner.run_specific_test(args.type, args.verbose)
    
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
