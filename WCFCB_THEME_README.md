# WCFCB ZM Custom Theme Implementation

This document explains the complete custom theme implementation for the Workers Compensation Fund Control Board - Zambia (WCFCB ZM) Frappe app.

## Theme Colors
- **Primary Color**: #347fb6 (Blue)
- **Secondary Color**: #ed8643 (Orange)

## What's Implemented

### 1. Complete Desk Theme
- Custom theme that appears in Frappe's theme switcher as "WCFCB ZM Theme"
- Applies to the entire Frappe Desk interface including:
  - Navigation bar
  - Buttons (primary and secondary)
  - Links and form controls
  - Sidebar and indicators
  - Progress bars and tabs

### 2. Login Page Theming
- Custom styling for the login page
- Branded colors applied to login form
- Consistent visual identity

### 3. Website Theme Support
- Website pages also use the custom colors
- Header and footer styling
- Consistent branding across web and desk interfaces

## Files Modified/Created

### CSS File
- `wcfcb_zm/public/css/custom_theme.css` - Complete theme implementation

### JavaScript File
- `wcfcb_zm/public/js/wcfcb_theme.js` - Theme registration and switching logic

### Python Files
- `wcfcb_zm/overrides/switch_theme.py` - Custom theme switching support
- `wcfcb_zm/themes/custom_theme.py` - Website theme variables (kept for website pages)

### Configuration
- `wcfcb_zm/hooks.py` - Updated with proper CSS/JS includes and overrides

## Installation Steps

1. **Build Assets** (Required after any changes):
   ```bash
   cd /path/to/frappe-bench
   bench build --app wcfcb_zm
   ```

2. **Clear Cache**:
   ```bash
   bench clear-cache
   bench clear-website-cache
   ```

3. **Restart Services**:
   ```bash
   bench restart
   ```

## How to Use

1. **Access Theme Switcher**:
   - Go to Frappe Desk
   - Click on your profile picture/avatar in the top right
   - Select "Switch Theme"
   - Choose "WCFCB ZM Theme"

2. **Verify Theme Application**:
   - Navigation bar should be blue (#347fb6)
   - Primary buttons should be blue
   - Secondary buttons should be orange (#ed8643)
   - Login page should have branded colors

## Troubleshooting

### Theme Not Appearing in Switcher
- Ensure JavaScript file is loaded: Check browser console for errors
- Rebuild assets: `bench build --app wcfcb_zm`
- Clear cache: `bench clear-cache`

### Styles Not Applied
- Check if CSS file is loaded in browser developer tools
- Ensure the theme is selected in theme switcher
- Verify data-theme="wcfcb_theme" attribute is set on html element

### Login Page Not Styled
- Login page styling is applied globally through CSS
- Clear browser cache if changes don't appear
- Check if CSS file is included in web_include_css

## Technical Details

### Theme Architecture
- **Desk Theme**: Uses CSS custom properties and data-theme attribute targeting
- **Website Theme**: Uses Frappe's WebsiteTheme class for website pages
- **Theme Switching**: Custom JavaScript overrides Frappe's ThemeSwitcher class
- **Persistence**: Theme preference is saved to user profile and localStorage

### CSS Structure
- Global CSS variables for consistent color usage
- Data-theme attribute targeting for desk interface
- Specific selectors for login page elements
- Website-specific styling for public pages

This implementation ensures that the WCFCB ZM branding is consistently applied across all parts of the Frappe application while maintaining compatibility with Frappe's theme system.
