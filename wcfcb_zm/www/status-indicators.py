import frappe

def get_context(context):
    """
    Context for the Status Indicators showcase page
    """
    context.title = "Status Indicators & Colors - WCFCB ZM"
    context.show_sidebar = False
    context.no_cache = 1
    
    # Add meta tags for better SEO
    context.metatags = {
        "description": "Comprehensive showcase of all status indicators, colors, and styling options used in the WCFCB ZM system.",
        "keywords": "status, indicators, colors, badges, pills, WCFCB, ZM, Frappe"
    }
    
    return context
