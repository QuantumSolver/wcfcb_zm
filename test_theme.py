#!/usr/bin/env python3
"""
Test script to verify WCFCB ZM theme implementation
Run this from the frappe-bench directory: python apps/wcfcb_zm/test_theme.py
"""

import os
import sys

def check_file_exists(file_path, description):
    """Check if a file exists and print status"""
    if os.path.exists(file_path):
        print(f"✓ {description}: {file_path}")
        return True
    else:
        print(f"✗ {description}: {file_path} (NOT FOUND)")
        return False

def check_file_content(file_path, search_text, description):
    """Check if file contains specific content"""
    try:
        with open(file_path, 'r') as f:
            content = f.read()
            if search_text in content:
                print(f"✓ {description}")
                return True
            else:
                print(f"✗ {description} (NOT FOUND)")
                return False
    except FileNotFoundError:
        print(f"✗ {description} (FILE NOT FOUND)")
        return False

def main():
    print("WCFCB ZM Theme Implementation Test")
    print("=" * 50)
    
    # Check if we're in the right directory
    if not os.path.exists("apps/wcfcb_zm"):
        print("Error: Please run this script from the frappe-bench directory")
        sys.exit(1)
    
    all_good = True
    
    # Check CSS file
    css_file = "apps/wcfcb_zm/wcfcb_zm/public/css/custom_theme.css"
    all_good &= check_file_exists(css_file, "CSS Theme File")
    all_good &= check_file_content(css_file, "wcfcb_theme", "CSS contains theme selector")
    all_good &= check_file_content(css_file, "#347fb6", "CSS contains primary color")
    all_good &= check_file_content(css_file, "#ed8643", "CSS contains secondary color")
    
    # Check JavaScript file
    js_file = "apps/wcfcb_zm/wcfcb_zm/public/js/wcfcb_theme.js"
    all_good &= check_file_exists(js_file, "JavaScript Theme File")
    all_good &= check_file_content(js_file, "wcfcb_theme", "JS contains theme registration")
    all_good &= check_file_content(js_file, "ThemeSwitcher", "JS overrides ThemeSwitcher")
    
    # Check Python override file
    py_file = "apps/wcfcb_zm/wcfcb_zm/overrides/switch_theme.py"
    all_good &= check_file_exists(py_file, "Python Override File")
    all_good &= check_file_content(py_file, "wcfcb_theme", "Python override supports custom theme")
    
    # Check hooks.py configuration
    hooks_file = "apps/wcfcb_zm/wcfcb_zm/hooks.py"
    all_good &= check_file_exists(hooks_file, "Hooks Configuration")
    all_good &= check_file_content(hooks_file, "custom_theme.css", "Hooks includes CSS file")
    all_good &= check_file_content(hooks_file, "wcfcb_theme.js", "Hooks includes JS file")
    all_good &= check_file_content(hooks_file, "switch_theme.switch_theme", "Hooks overrides switch_theme")
    
    print("\n" + "=" * 50)
    if all_good:
        print("✓ All theme files are properly configured!")
        print("\nNext steps:")
        print("1. Run: bench build --app wcfcb_zm")
        print("2. Run: bench clear-cache")
        print("3. Run: bench restart")
        print("4. Go to Frappe Desk > Profile > Switch Theme > Select 'WCFCB ZM Theme'")
    else:
        print("✗ Some theme files are missing or incorrectly configured.")
        print("Please check the files listed above.")

if __name__ == "__main__":
    main()
