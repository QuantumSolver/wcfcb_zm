import frappe
from frappe import _
from frappe.utils import nowdate, add_days, getdate, get_first_day, get_last_day, flt
import calendar



def get_budget_details(expense_account, cost_center=None, project=None, transaction_date=None):
    """Get budget details for a specific expense account and cost center or project"""
    if not expense_account:
        frappe.throw(_("Expense Account is required"))

    if not cost_center and not project:
        frappe.throw(_("Either Cost Center or Project is required for budget checking"))

    if cost_center and project:
        frappe.throw(_("Please specify either Cost Center OR Project, not both"))

    # Use provided transaction_date or default to today
    check_date = transaction_date or nowdate()

    # Get current fiscal year based on check_date
    fiscal_year = frappe.db.sql("""
        SELECT name, year_start_date, year_end_date
        FROM `tabFiscal Year`
        WHERE %s BETWEEN year_start_date AND year_end_date
        LIMIT 1
    """, check_date, as_dict=True)

    if not fiscal_year:
        frappe.throw(_("No active fiscal year found for the given date"))

    fy = fiscal_year[0]
    
    # Base query - enhanced with monthly distribution support
    query = """
    SELECT
        acc.name AS expense_account,
        acc.account_name,
        b.name AS budget_name,
        {budget_against_field} AS budget_against,
        {budget_against_name_field} AS budget_against_name,
        %(fiscal_year)s AS fiscal_year,
        ba.budget_amount,
        b.monthly_distribution,
        md.distribution_id,
        IFNULL((
            SELECT SUM(gl.debit - gl.credit)
            FROM `tabGL Entry` gl
            WHERE gl.account = %(expense_account)s
              AND gl.docstatus = 1
              AND gl.is_cancelled = 0
              AND gl.posting_date BETWEEN %(year_start_date)s AND %(year_end_date)s
              {gl_against_condition}
        ), 0) AS actual_expenses,
        IFNULL((
            SELECT SUM(mri.amount)
            FROM `tabMaterial Request Item` mri
            JOIN `tabMaterial Request` mr ON mr.name = mri.parent
            WHERE mri.expense_account = %(expense_account)s
              AND mr.docstatus = 1
              AND mr.status NOT IN ('Cancelled', 'Stopped')
              AND mr.transaction_date BETWEEN %(year_start_date)s AND %(year_end_date)s
              {mr_against_condition}
              -- Exclude Material Request items that are already linked to Purchase Orders
              AND NOT EXISTS (
                  SELECT 1
                  FROM `tabPurchase Order Item` poi
                  JOIN `tabPurchase Order` po ON po.name = poi.parent
                  WHERE poi.material_request = mr.name
                    AND poi.material_request_item = mri.name
                    AND po.docstatus = 1
                    AND po.status NOT IN ('Completed', 'Cancelled', 'Closed')
              )
        ), 0) AS material_request_committed,
        IFNULL((
            SELECT SUM(poi.base_amount)
            FROM `tabPurchase Order Item` poi
            JOIN `tabPurchase Order` po ON po.name = poi.parent
            WHERE poi.expense_account = %(expense_account)s
              AND po.docstatus = 1
              AND po.status NOT IN ('Completed', 'Cancelled', 'Closed')
              AND po.transaction_date BETWEEN %(year_start_date)s AND %(year_end_date)s
              {po_against_condition}
        ), 0) AS purchase_order_committed
    FROM
        `tabBudget` b
    INNER JOIN
        `tabBudget Account` ba ON ba.parent = b.name AND ba.account = %(expense_account)s
    INNER JOIN
        `tabAccount` acc ON acc.name = %(expense_account)s
    LEFT JOIN
        `tabCost Center` cc ON b.cost_center = cc.name
    LEFT JOIN
        `tabProject` p ON b.project = p.name
    LEFT JOIN
        `tabMonthly Distribution` md ON b.monthly_distribution = md.name
    WHERE
        b.fiscal_year = %(fiscal_year)s
        AND b.docstatus = 1
        AND acc.is_group = 0
        AND acc.root_type = 'Expense'
        AND acc.disabled = 0
        {budget_where_condition}
    ORDER BY
        acc.account_name, b.name;
    """
    
    # Replace placeholders based on cost_center or project
    if cost_center:
        query = query.replace("{budget_against_field}", "b.cost_center")
        query = query.replace("{budget_against_name_field}", "COALESCE(cc.cost_center_name, b.cost_center)")
        query = query.replace("{gl_against_condition}", "AND gl.cost_center = %(cost_center)s")
        query = query.replace("{mr_against_condition}", "AND mri.cost_center = %(cost_center)s")
        query = query.replace("{po_against_condition}", "AND poi.cost_center = %(cost_center)s")
        query = query.replace("{budget_where_condition}", "AND b.cost_center = %(cost_center)s")

        args = {
            'expense_account': expense_account,
            'cost_center': cost_center,
            'fiscal_year': fy.name,
            'year_start_date': fy.year_start_date,
            'year_end_date': fy.year_end_date
        }
    else:
        query = query.replace("{budget_against_field}", "b.project")
        query = query.replace("{budget_against_name_field}", "COALESCE(p.project_name, b.project)")
        query = query.replace("{gl_against_condition}", "AND gl.project = %(project)s")
        query = query.replace("{mr_against_condition}", "AND mri.project = %(project)s")
        query = query.replace("{po_against_condition}", "AND poi.project = %(project)s")
        query = query.replace("{budget_where_condition}", "AND b.project = %(project)s")

        args = {
            'expense_account': expense_account,
            'project': project,
            'fiscal_year': fy.name,
            'year_start_date': fy.year_start_date,
            'year_end_date': fy.year_end_date
        }

    # Execute query
    results = frappe.db.sql(query, args, as_dict=True)

    # Calculate available budget for each result and add monthly distribution info
    # Available Budget = Annual Budget Amount
    #                  - Actual Expenses (from GL Entries)
    #                  - Material Request Commitments (only unlinked MRs)
    #                  - Purchase Order Commitments (includes linked POs)
    # Note: MR commitments are excluded if they're already linked to POs to avoid double-counting
    for result in results:
        result['available_budget'] = (
            result['budget_amount'] -
            result['actual_expenses'] -
            result['material_request_committed'] -
            result['purchase_order_committed']
        )

        # Add monthly distribution information if it exists
        if result.get('monthly_distribution'):
            monthly_info = get_monthly_distribution_info(
                result['monthly_distribution'],
                result['budget_amount'],
                check_date,
                expense_account,
                cost_center,
                project
            )
            result.update(monthly_info)

    return results


def get_monthly_distribution_info(monthly_distribution, annual_budget, check_date, expense_account, cost_center=None, project=None):
    """Get monthly distribution information for a budget"""
    try:
        # Get monthly distribution details
        monthly_dist = frappe.get_doc("Monthly Distribution", monthly_distribution)
        check_date_obj = getdate(check_date)
        current_month = check_date_obj.month
        month_names = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December']
        current_month_name = month_names[current_month - 1]

        # Find the percentage for the current month
        monthly_percentage = 0
        monthly_percentages = {}

        for percentage in monthly_dist.percentages:
            month_name = percentage.month.strip()
            percentage_value = flt(percentage.percentage_allocation)
            monthly_percentages[month_name] = percentage_value

            if month_name == current_month_name:
                monthly_percentage = percentage_value

        # Calculate monthly budget amount
        monthly_budget_amount = (annual_budget * monthly_percentage) / 100

        # Get monthly expenses and commitments for the current month
        month_start = get_first_day(check_date_obj)
        month_end = get_last_day(check_date_obj)

        # Build monthly expenses query
        monthly_query = """
        SELECT
            IFNULL((
                SELECT SUM(gl.debit - gl.credit)
                FROM `tabGL Entry` gl
                WHERE gl.account = %(expense_account)s
                  AND gl.docstatus = 1
                  AND gl.is_cancelled = 0
                  AND gl.posting_date BETWEEN %(month_start)s AND %(month_end)s
                  {gl_against_condition}
            ), 0) AS monthly_actual_expenses,
            IFNULL((
                SELECT SUM(mri.amount)
                FROM `tabMaterial Request Item` mri
                JOIN `tabMaterial Request` mr ON mr.name = mri.parent
                WHERE mri.expense_account = %(expense_account)s
                  AND mr.docstatus = 1
                  AND mr.status NOT IN ('Cancelled', 'Stopped')
                  AND mr.transaction_date BETWEEN %(month_start)s AND %(month_end)s
                  {mr_against_condition}
                  -- Exclude Material Request items that are already linked to Purchase Orders
                  AND NOT EXISTS (
                      SELECT 1
                      FROM `tabPurchase Order Item` poi
                      JOIN `tabPurchase Order` po ON po.name = poi.parent
                      WHERE poi.material_request = mr.name
                        AND poi.material_request_item = mri.name
                        AND po.docstatus = 1
                        AND po.status NOT IN ('Completed', 'Cancelled', 'Closed')
                  )
            ), 0) AS monthly_mr_committed,
            IFNULL((
                SELECT SUM(poi.base_amount)
                FROM `tabPurchase Order Item` poi
                JOIN `tabPurchase Order` po ON po.name = poi.parent
                WHERE poi.expense_account = %(expense_account)s
                  AND po.docstatus = 1
                  AND po.status NOT IN ('Completed', 'Cancelled', 'Closed')
                  AND po.transaction_date BETWEEN %(month_start)s AND %(month_end)s
                  {po_against_condition}
            ), 0) AS monthly_po_committed
        """

        # Replace placeholders based on cost_center or project
        if cost_center:
            monthly_query = monthly_query.replace("{gl_against_condition}", "AND gl.cost_center = %(cost_center)s")
            monthly_query = monthly_query.replace("{mr_against_condition}", "AND mri.cost_center = %(cost_center)s")
            monthly_query = monthly_query.replace("{po_against_condition}", "AND poi.cost_center = %(cost_center)s")
            monthly_args = {
                'expense_account': expense_account,
                'cost_center': cost_center,
                'month_start': month_start,
                'month_end': month_end
            }
        else:
            monthly_query = monthly_query.replace("{gl_against_condition}", "AND gl.project = %(project)s")
            monthly_query = monthly_query.replace("{mr_against_condition}", "AND mri.project = %(project)s")
            monthly_query = monthly_query.replace("{po_against_condition}", "AND poi.project = %(project)s")
            monthly_args = {
                'expense_account': expense_account,
                'project': project,
                'month_start': month_start,
                'month_end': month_end
            }

        # Execute monthly query
        monthly_result = frappe.db.sql(monthly_query, monthly_args, as_dict=True)

        if monthly_result:
            monthly_data = monthly_result[0]
            monthly_available = (
                monthly_budget_amount -
                monthly_data['monthly_actual_expenses'] -
                monthly_data['monthly_mr_committed'] -
                monthly_data['monthly_po_committed']
            )
        else:
            monthly_data = {
                'monthly_actual_expenses': 0,
                'monthly_mr_committed': 0,
                'monthly_po_committed': 0
            }
            monthly_available = monthly_budget_amount

        return {
            'has_monthly_distribution': True,
            'monthly_distribution_id': monthly_dist.distribution_id,
            'current_month': current_month_name,
            'monthly_percentage': monthly_percentage,
            'monthly_budget_amount': monthly_budget_amount,
            'monthly_actual_expenses': monthly_data['monthly_actual_expenses'],
            'monthly_mr_committed': monthly_data['monthly_mr_committed'],
            'monthly_po_committed': monthly_data['monthly_po_committed'],
            'monthly_available_budget': monthly_available,
            'monthly_percentages': monthly_percentages
        }

    except Exception as e:
        frappe.log_error(message=str(e), title="Monthly Distribution Info Error")
        return {
            'has_monthly_distribution': False,
            'monthly_distribution_error': str(e)
        }


@frappe.whitelist()
def check_budget(expense_account, cost_center=None, project=None, requested_amount=0, transaction_date=None):
    """
    Check budget details for a specific expense account and cost center or project.
    Enhanced version that includes monthly distribution checking.
    """
    try:
        if not expense_account:
            frappe.throw(_("Expense Account is required"))

        if not cost_center and not project:
            frappe.throw(_("Either Cost Center or Project is required for budget checking"))

        if cost_center and project:
            frappe.throw(_("Please specify either Cost Center OR Project, not both"))

        budget_data = get_budget_details(expense_account, cost_center, project, transaction_date)

        # Add requested amount validation for each budget
        requested_amount = flt(requested_amount)
        for budget in budget_data:
            # Annual budget status
            budget['within_annual_budget'] = requested_amount <= budget['available_budget']
            budget['annual_budget_status'] = 'WITHIN BUDGET' if budget['within_annual_budget'] else 'EXCEEDS BUDGET'

            # Monthly budget status (if applicable)
            if budget.get('has_monthly_distribution'):
                budget['within_monthly_budget'] = requested_amount <= budget['monthly_available_budget']
                budget['monthly_budget_status'] = 'WITHIN MONTHLY BUDGET' if budget['within_monthly_budget'] else 'EXCEEDS MONTHLY BUDGET'

                # Overall status considers both annual and monthly
                if budget['within_annual_budget'] and budget['within_monthly_budget']:
                    budget['overall_status'] = 'WITHIN BUDGET'
                elif not budget['within_monthly_budget']:
                    budget['overall_status'] = 'EXCEEDS MONTHLY BUDGET'
                else:
                    budget['overall_status'] = 'EXCEEDS ANNUAL BUDGET'
            else:
                budget['within_monthly_budget'] = True  # No monthly restriction
                budget['monthly_budget_status'] = 'NO MONTHLY DISTRIBUTION'
                budget['overall_status'] = budget['annual_budget_status']

        return budget_data

    except Exception as e:
        frappe.log_error(message=str(e), title="Budget Check Error")
        frappe.throw(str(e))


@frappe.whitelist()
def check_monthly_budget_simple(expense_account, cost_center=None, project=None, requested_amount=0):
    """
    Check monthly budget distribution for a specific expense account and cost center or project.
    This is a non-blocking check that provides warnings about monthly budget limits.
    """
    try:
        if not expense_account:
            return {"monthly_exceeded": False, "message": None}

        if not cost_center and not project:
            return {"monthly_exceeded": False, "message": None}

        if cost_center and project:
            return {"monthly_exceeded": False, "message": None}

        requested_amount = flt(requested_amount)
        current_date = getdate(nowdate())
        current_month = current_date.month

        # Get current fiscal year
        fiscal_year = frappe.db.sql("""
            SELECT name, year_start_date, year_end_date
            FROM `tabFiscal Year`
            WHERE %s BETWEEN year_start_date AND year_end_date
            LIMIT 1
        """, nowdate(), as_dict=True)

        if not fiscal_year:
            return {"monthly_exceeded": False, "message": None}

        fy = fiscal_year[0]

        # Get budget with monthly distribution
        budget_query = """
        SELECT
            b.name AS budget_name,
            ba.budget_amount,
            bd.month,
            bd.budget_amount AS monthly_budget_amount
        FROM `tabBudget` b
        INNER JOIN `tabBudget Account` ba ON ba.parent = b.name AND ba.account = %(expense_account)s
        LEFT JOIN `tabMonthly Distribution` md ON b.monthly_distribution = md.name
        LEFT JOIN `tabMonthly Distribution Percentage` bd ON bd.parent = md.name
        WHERE b.fiscal_year = %(fiscal_year)s
          AND b.docstatus = 1
          {budget_where_condition}
        ORDER BY bd.month
        """

        if cost_center:
            budget_query = budget_query.replace("{budget_where_condition}", "AND b.cost_center = %(cost_center)s")
            budget_args = {
                'expense_account': expense_account,
                'cost_center': cost_center,
                'fiscal_year': fy.name
            }
        else:
            budget_query = budget_query.replace("{budget_where_condition}", "AND b.project = %(project)s")
            budget_args = {
                'expense_account': expense_account,
                'project': project,
                'fiscal_year': fy.name
            }

        budget_results = frappe.db.sql(budget_query, budget_args, as_dict=True)

        if not budget_results:
            return {"monthly_exceeded": False, "message": None}

        # Find current month's budget allocation
        current_month_budget = None
        total_budget_amount = budget_results[0].budget_amount

        for result in budget_results:
            if result.month and result.monthly_budget_amount:
                month_name = result.month.strip().lower()
                month_number = get_month_number(month_name)
                if month_number == current_month:
                    # Calculate actual monthly budget amount
                    monthly_percentage = flt(result.monthly_budget_amount)
                    current_month_budget = (monthly_percentage / 100.0) * total_budget_amount
                    break

        if not current_month_budget or current_month_budget <= 0:
            return {"monthly_exceeded": False, "message": None}

        # Get current month's actual expenses and commitments
        month_start = get_first_day(current_date)
        month_end = get_last_day(current_date)

        monthly_expenses_query = """
        SELECT
            IFNULL((
                SELECT SUM(gl.debit - gl.credit)
                FROM `tabGL Entry` gl
                WHERE gl.account = %(expense_account)s
                  AND gl.docstatus = 1
                  AND gl.is_cancelled = 0
                  AND gl.posting_date BETWEEN %(month_start)s AND %(month_end)s
                  {gl_against_condition}
            ), 0) AS monthly_actual_expenses,
            IFNULL((
                SELECT SUM(mri.amount)
                FROM `tabMaterial Request Item` mri
                JOIN `tabMaterial Request` mr ON mr.name = mri.parent
                WHERE mri.expense_account = %(expense_account)s
                  AND mr.docstatus = 1
                  AND mr.status NOT IN ('Cancelled', 'Stopped')
                  AND mr.transaction_date BETWEEN %(month_start)s AND %(month_end)s
                  {mr_against_condition}
            ), 0) AS monthly_mr_committed,
            IFNULL((
                SELECT SUM(poi.base_amount)
                FROM `tabPurchase Order Item` poi
                JOIN `tabPurchase Order` po ON po.name = poi.parent
                WHERE poi.expense_account = %(expense_account)s
                  AND po.docstatus = 1
                  AND po.status NOT IN ('Completed', 'Cancelled', 'Closed')
                  AND po.transaction_date BETWEEN %(month_start)s AND %(month_end)s
                  {po_against_condition}
            ), 0) AS monthly_po_committed
        """

        if cost_center:
            monthly_expenses_query = monthly_expenses_query.replace("{gl_against_condition}", "AND gl.cost_center = %(cost_center)s")
            monthly_expenses_query = monthly_expenses_query.replace("{mr_against_condition}", "AND mri.cost_center = %(cost_center)s")
            monthly_expenses_query = monthly_expenses_query.replace("{po_against_condition}", "AND poi.cost_center = %(cost_center)s")
            monthly_args = {
                'expense_account': expense_account,
                'cost_center': cost_center,
                'month_start': month_start,
                'month_end': month_end
            }
        else:
            monthly_expenses_query = monthly_expenses_query.replace("{gl_against_condition}", "AND gl.project = %(project)s")
            monthly_expenses_query = monthly_expenses_query.replace("{mr_against_condition}", "AND mri.project = %(project)s")
            monthly_expenses_query = monthly_expenses_query.replace("{po_against_condition}", "AND poi.project = %(project)s")
            monthly_args = {
                'expense_account': expense_account,
                'project': project,
                'month_start': month_start,
                'month_end': month_end
            }

        monthly_result = frappe.db.sql(monthly_expenses_query, monthly_args, as_dict=True)

        if not monthly_result:
            return {"monthly_exceeded": False, "message": None}

        monthly_data = monthly_result[0]
        available_monthly_budget = (
            current_month_budget -
            monthly_data.monthly_actual_expenses -
            monthly_data.monthly_mr_committed -
            monthly_data.monthly_po_committed
        )

        monthly_exceeded = requested_amount > available_monthly_budget

        if monthly_exceeded:
            budget_for = cost_center if cost_center else project
            month_name = calendar.month_name[current_month]
            message = _(
                "Monthly budget limit will be exceeded for expense account: {0}<br>"
                "Budget Against: {1}<br>"
                "Month: {2}<br>"
                "Requested Amount: {3}<br>"
                "Available Monthly Budget: {4}<br>"
                "Shortage: {5}"
            ).format(
                expense_account,
                budget_for,
                month_name,
                frappe.format_value(requested_amount, {"fieldtype": "Currency"}),
                frappe.format_value(available_monthly_budget, {"fieldtype": "Currency"}),
                frappe.format_value(requested_amount - available_monthly_budget, {"fieldtype": "Currency"})
            )
        else:
            message = None

        return {
            "monthly_exceeded": monthly_exceeded,
            "message": message,
            "available_monthly_budget": available_monthly_budget,
            "monthly_budget_amount": current_month_budget,
            "current_month": calendar.month_name[current_month]
        }

    except Exception as e:
        frappe.log_error(message=str(e), title="Monthly Budget Check Error")
        # Monthly budget check is non-blocking, so return no warning on error
        return {"monthly_exceeded": False, "message": None}


def get_month_number(month_name):
    """Convert month name to month number"""
    month_mapping = {
        'january': 1, 'jan': 1,
        'february': 2, 'feb': 2,
        'march': 3, 'mar': 3,
        'april': 4, 'apr': 4,
        'may': 5,
        'june': 6, 'jun': 6,
        'july': 7, 'jul': 7,
        'august': 8, 'aug': 8,
        'september': 9, 'sep': 9,
        'october': 10, 'oct': 10,
        'november': 11, 'nov': 11,
        'december': 12, 'dec': 12
    }
    return month_mapping.get(month_name.lower(), 0)
