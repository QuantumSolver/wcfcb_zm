# WCFCB ZM Custom Website Theme
# This file provides website theme variables for web pages
# The main desk theme is handled through CSS and JavaScript files

from frappe.website_theme.website_theme import WebsiteTheme

class CustomTheme(WebsiteTheme):
    """
    Custom website theme for WCFCB ZM
    This affects website pages, not the Frappe Desk interface
    """
    def get_theme_variables(self):
        theme_vars = super().get_theme_variables()
        custom_vars = {
            'primary-color': '#347fb6',
            'secondary-color': '#ed8643',
            'dark-color-1': '#1a3c5a',
            'dark-color-2': '#2c5778',
            'light-color-1': '#5d9bc9',
            'light-color-2': '#8ab6d6',
            'text-color': '#333333',
            'light-text-color': '#ffffff',
            'navbar-bg': '#347fb6',
            'navbar-text': '#ffffff'
        }
        theme_vars.update(custom_vars)
        return theme_vars