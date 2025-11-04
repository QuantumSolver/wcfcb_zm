// WCFCB ZM Custom Theme Registration
// This file registers the custom theme with Frappe's theme system

// Safe wrapper function that waits for frappe to be available
function whenFrappeReady(callback) {
    if (typeof frappe !== 'undefined' && frappe.ready) {
        frappe.ready(callback);
    } else if (typeof $ !== 'undefined') {
        $(document).ready(function() {
            // Wait for frappe to be available
            const checkFrappe = setInterval(function() {
                if (typeof frappe !== 'undefined' && frappe.ready) {
                    clearInterval(checkFrappe);
                    frappe.ready(callback);
                }
            }, 100);
        });
    } else {
        // Fallback to window load event
        window.addEventListener('load', function() {
            const checkFrappe = setInterval(function() {
                if (typeof frappe !== 'undefined' && frappe.ready) {
                    clearInterval(checkFrappe);
                    frappe.ready(callback);
                }
            }, 100);
        });
    }
}

// Override the ThemeSwitcher class to include our custom theme
whenFrappeReady(function() {
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
whenFrappeReady(function() {
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
function setupThemeHandlers() {
    if (typeof $ !== 'undefined') {
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
                const currentTheme = (typeof frappe !== 'undefined' && frappe.boot?.user?.theme) || localStorage.getItem('theme');
                if (currentTheme === 'wcfcb_theme') {
                    document.documentElement.setAttribute('data-theme', 'wcfcb_theme');
                }
            }, 100);
        });
    } else {
        // Fallback without jQuery
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(function() {
                const currentTheme = (typeof frappe !== 'undefined' && frappe.boot?.user?.theme) || localStorage.getItem('theme');
                if (currentTheme === 'wcfcb_theme') {
                    document.documentElement.setAttribute('data-theme', 'wcfcb_theme');
                }
            }, 100);
        });
    }
}

// Initialize theme handlers
setupThemeHandlers();


// Global debug helpers to confirm app JS loads and detect Budget Request form route
whenFrappeReady(function() {
    try {
        console.log('[WCFCB ZM] Global/theme script loaded at', new Date().toISOString());
    } catch (e) {}

    if (frappe.router && frappe.router.on) {
        frappe.router.on('change', () => {
            try {
                const r = frappe.get_route ? frappe.get_route() : [];
                if (r && r[0] === 'Form' && r[1] === 'Budget Request') {
                    frappe.show_alert({
                        message: __('WCFCB ZM: Global router detected Budget Request'),
                        indicator: 'green'
                    });
                    console.log('[WCFCB ZM] Global router: Budget Request route detected at', new Date().toISOString(), r);
                }
            } catch (e) {
                // no-op
            }
        });
    }
});
