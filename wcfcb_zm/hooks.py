app_name = "wcfcb_zm"
app_title = "WCFCB ZM"
app_publisher = "elius mgani"
app_description = "Workers Compensation Fund Control Board for Zambia"
app_email = "emgani@aakvatech.com"
app_license = "mit"
# required_apps = []

# Includes in <head>
# ------------------

# Include CSS and JS files in desk.html (Frappe Desk interface)
app_include_css = ["/assets/wcfcb_zm/css/custom_theme.css"]
app_include_js = ["/assets/wcfcb_zm/js/wcfcb_theme.js"]

# Include CSS and JS files in web templates (Website pages)
web_include_css = ["/assets/wcfcb_zm/css/custom_theme.css"]
web_include_js = ["/assets/wcfcb_zm/js/wcfcb_theme.js"]

# include js, css files in header of web template
# web_include_css = "/assets/wcfcb_zm/css/wcfcb_zm.css"
# web_include_js = "/assets/wcfcb_zm/js/wcfcb_zm.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "wcfcb_zm/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}


doctype_list_js = {
    "Custom Field": "wcfcb_zm/patches/custom_field.js",
    "Property Setter": "wcfcb_zm/patches/property_setter.js",
}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "wcfcb_zm/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "wcfcb_zm.utils.jinja_methods",
# 	"filters": "wcfcb_zm.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "wcfcb_zm.install.before_install"
# after_install = "wcfcb_zm.install.after_install"


after_migrate = [
    "wcfcb_zm.patches.create_custom_fields.execute",
    "wcfcb_zm.patches.create_property_setters.execute",
]


# Uninstallation
# ------------

# before_uninstall = "wcfcb_zm.uninstall.before_uninstall"
# after_uninstall = "wcfcb_zm.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "wcfcb_zm.utils.before_app_install"
# after_app_install = "wcfcb_zm.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "wcfcb_zm.utils.before_app_uninstall"
# after_app_uninstall = "wcfcb_zm.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "wcfcb_zm.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"wcfcb_zm.tasks.all"
# 	],
# 	"daily": [
# 		"wcfcb_zm.tasks.daily"
# 	],
# 	"hourly": [
# 		"wcfcb_zm.tasks.hourly"
# 	],
# 	"weekly": [
# 		"wcfcb_zm.tasks.weekly"
# 	],
# 	"monthly": [
# 		"wcfcb_zm.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "wcfcb_zm.install.before_tests"

# Overriding Methods
# ------------------------------
#
# Override theme switching to support custom theme
override_whitelisted_methods = {
	"frappe.core.doctype.user.user.switch_theme": "wcfcb_zm.overrides.switch_theme.switch_theme"
}
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "wcfcb_zm.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["wcfcb_zm.utils.before_request"]
# after_request = ["wcfcb_zm.utils.after_request"]

# Job Events
# ----------
# before_job = ["wcfcb_zm.utils.before_job"]
# after_job = ["wcfcb_zm.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"wcfcb_zm.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

