import frappe
from frappe.core.doctype.user.user import switch_theme as original_switch_theme

@frappe.whitelist()
def switch_theme(theme):
    """
    Override the default switch_theme function to support our custom WCFCB theme
    """
    # List of allowed themes including our custom theme
    allowed_themes = ["light", "dark", "automatic", "wcfcb_theme"]
    
    if theme in allowed_themes:
        # Update user's theme preference
        frappe.db.set_value("User", frappe.session.user, "theme", theme)
        frappe.db.commit()
        
        # Return success response
        return {
            "theme": theme,
            "message": f"Theme switched to {theme}"
        }
    else:
        # Fall back to original function for other themes
        return original_switch_theme(theme)
