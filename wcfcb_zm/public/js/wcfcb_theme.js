// WCFCB ZM Custom Theme Registration
// This file registers the custom theme with Frappe's theme system

frappe.ready(function() {
    // Override the ThemeSwitcher class to include our custom theme
    if (frappe.ui && frappe.ui.ThemeSwitcher) {
        frappe.ui.ThemeSwitcher = class WCFCBThemeSwitcher extends frappe.ui.ThemeSwitcher {
            constructor() {
                super();
            }

            fetch_themes() {
                return new Promise((resolve) => {
                    this.themes = [
                        {
                            name: "light",
                            label: __("Frappe Light"),
                            info: __("Light Theme"),
                        },
                        {
                            name: "dark", 
                            label: __("Timeless Night"),
                            info: __("Dark Theme"),
                        },
                        {
                            name: "wcfcb_theme",
                            label: __("WCFCB ZM Theme"),
                            info: __("Workers Compensation Fund Control Board - Zambia"),
                        },
                        {
                            name: "automatic",
                            label: __("Automatic"),
                            info: __("Uses system's theme to switch between light and dark mode"),
                        }
                    ];

                    resolve(this.themes);
                });
            }
        };
    }
});

// Apply theme immediately if it's already set
frappe.ready(function() {
    // Check if WCFCB theme is set and apply it
    if (frappe.boot && frappe.boot.user && frappe.boot.user.theme === 'wcfcb_theme') {
        document.documentElement.setAttribute('data-theme', 'wcfcb_theme');
    }
    
    // Also check localStorage for theme preference
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'wcfcb_theme') {
        document.documentElement.setAttribute('data-theme', 'wcfcb_theme');
    }
});

// Hook into theme switching to ensure our theme is properly applied
$(document).on('theme-change', function(e, theme) {
    if (theme === 'wcfcb_theme') {
        document.documentElement.setAttribute('data-theme', 'wcfcb_theme');
        // Store in localStorage for persistence
        localStorage.setItem('theme', 'wcfcb_theme');
    }
});

// Ensure theme is applied on page load
$(document).ready(function() {
    // Small delay to ensure Frappe is fully loaded
    setTimeout(function() {
        const currentTheme = frappe.boot?.user?.theme || localStorage.getItem('theme');
        if (currentTheme === 'wcfcb_theme') {
            document.documentElement.setAttribute('data-theme', 'wcfcb_theme');
        }
    }, 100);
});
