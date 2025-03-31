# Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
# License: GNU General Public License v3. See license.txt

import datetime
import frappe
from frappe import _
from frappe.utils import flt, formatdate
from erpnext.controllers.trends import get_period_date_ranges, get_period_month_ranges

def execute(filters=None):
    if not filters:
        filters = {}

    columns = get_columns(filters)
    if filters.get("budget_against_filter"):
        dimensions = filters.get("budget_against_filter")
    else:
        dimensions = get_cost_centers(filters)

    period_month_ranges = get_period_month_ranges(filters["period"], filters["from_fiscal_year"])
    cam_map = get_dimension_account_month_map(filters)

    data = []
    for dimension in dimensions:
        dimension_items = cam_map.get(dimension)
        if dimension_items:
            data = get_final_data(dimension, dimension_items, filters, period_month_ranges, data, 0)

    chart = get_chart_data(filters, columns, data)

    return columns, data, None, chart

def get_final_data(dimension, dimension_items, filters, period_month_ranges, data, DCC_allocation):
    # Fetch Budget Doc ID for the dimension (Cost Center/Project/Other)
    budget_against_field = frappe.scrub(filters.get("budget_against"))  # e.g., "cost_center" or "project"
    budget_document_id = frappe.db.get_value(
        "Budget",
        {budget_against_field: dimension},  # e.g., {"cost_center": "Main - DS"}
        "name"
    )
    
    for account, monthwise_data in dimension_items.items():
        row = {
            "budget_document_id": budget_document_id,  # Ensure this is a valid Budget document name
            "budget_against": dimension,
            "account": account,
            "budget": 0.0,
            "actual": 0.0,
            "variance": 0.0,
        }

        # Aggregate data for the fiscal year
        for year in get_fiscal_years(filters):
            for relevant_months in period_month_ranges:
                for month in relevant_months:
                    if monthwise_data.get(year[0]):
                        month_data = monthwise_data.get(year[0]).get(month, {})
                        row["budget"] += flt(month_data.get("target", 0))
                        row["actual"] += flt(month_data.get("actual", 0))
        
        row["variance"] = row["budget"] - row["actual"]
        data.append(row)

    return data

def get_columns(filters):
    columns = [
        {
            "label": _("Budget Doc ID"),
            "fieldname": "budget_document_id",
            "fieldtype": "Link",
            "options": "Budget",
            "width": 120,
            # "formatter": "link",
            # "formatoptions": {    # Add this block
            #     "doctype": "Budget",
            #     "docfield": "name"
            # }
        },
        {
            "label": _(filters.get("budget_against")),
            "fieldtype": "Link",
            "fieldname": "budget_against",
            "options": filters.get("budget_against"),
            "width": 150,
        },
        {
            "label": _("Account"),
            "fieldname": "account",
            "fieldtype": "Link",
            "options": "Account",
            "width": 150,
        },
        {
            "label": _("Budget") + " 2025",
            "fieldname": "budget",
            "fieldtype": "Float",
            "width": 150,
        },
        {
            "label": _("Actual") + " 2025",
            "fieldname": "actual",
            "fieldtype": "Float",
            "width": 150,
        },
        {
            "label": _("Variance") + " 2025",
            "fieldname": "variance",
            "fieldtype": "Float",
            "width": 150,
        },
    ]
    return columns


def get_cost_centers(filters):
    order_by = ""
    if filters.get("budget_against") == "Cost Center":
        order_by = "order by lft"

    if filters.get("budget_against") in ["Cost Center", "Project"]:
        return frappe.db.sql_list(
            """
                select
                    name
                from
                    `tab{tab}`
                where
                    company = %s
                {order_by}
            """.format(tab=filters.get("budget_against"), order_by=order_by),
            filters.get("company"),
        )
    else:
        return frappe.db.sql_list(
            """
                select
                    name
                from
                    `tab{tab}`
            """.format(tab=filters.get("budget_against"))
        )

def get_dimension_target_details(filters):
    budget_against = frappe.scrub(filters.get("budget_against"))
    cond = ""
    if filters.get("budget_against_filter"):
        cond += f""" and b.{budget_against} in (%s)""" % ", ".join(
            ["%s"] * len(filters.get("budget_against_filter"))
        )

    return frappe.db.sql(
        f"""
            select
                b.name as budget_document_id,
                b.{budget_against} as budget_against,
                b.monthly_distribution,
                ba.account,
                ba.budget_amount,
                b.fiscal_year
            from
                `tabBudget` b,
                `tabBudget Account` ba
            where
                b.name = ba.parent
                and b.docstatus = 1
                and b.fiscal_year between %s and %s
                and b.budget_against = %s
                and b.company = %s
                {cond}
            order by
                b.fiscal_year
        """,
        tuple(
            [
                filters.from_fiscal_year,
                filters.to_fiscal_year,
                filters.budget_against,
                filters.company,
            ]
            + (filters.get("budget_against_filter") or [])
        ),
        as_dict=True,
    )

def get_target_distribution_details(filters):
    target_details = {}
    for d in frappe.db.sql(
        """
            select
                md.name,
                mdp.month,
                mdp.percentage_allocation
            from
                `tabMonthly Distribution Percentage` mdp,
                `tabMonthly Distribution` md
            where
                mdp.parent = md.name
                and md.fiscal_year between %s and %s
            order by
                md.fiscal_year
        """,
        (filters.from_fiscal_year, filters.to_fiscal_year),
        as_dict=1,
    ):
        target_details.setdefault(d.name, {}).setdefault(d.month, flt(d.percentage_allocation))

    return target_details

def get_actual_details(name, filters):
    budget_against = frappe.scrub(filters.get("budget_against"))
    cond = ""

    if filters.get("budget_against") == "Cost Center":
        cc_lft, cc_rgt = frappe.db.get_value("Cost Center", name, ["lft", "rgt"])
        cond = f"""
                and lft >= "{cc_lft}"
                and rgt <= "{cc_rgt}"
            """

    ac_details = frappe.db.sql(
        f"""
            select
                gl.account,
                gl.debit,
                gl.credit,
                gl.fiscal_year,
                MONTHNAME(gl.posting_date) as month_name,
                b.{budget_against} as budget_against
            from
                `tabGL Entry` gl,
                `tabBudget Account` ba,
                `tabBudget` b
            where
                b.name = ba.parent
                and b.docstatus = 1
                and ba.account=gl.account
                and b.{budget_against} = gl.{budget_against}
                and gl.fiscal_year between %s and %s
                and b.{budget_against} = %s
                and exists(
                    select
                        name
                    from
                        `tab{filters.budget_against}`
                    where
                        name = gl.{budget_against}
                        {cond}
                )
                group by
                    gl.name
                order by gl.fiscal_year
        """,
        (filters.from_fiscal_year, filters.to_fiscal_year, name),
        as_dict=1,
    )

    cc_actual_details = {}
    for d in ac_details:
        cc_actual_details.setdefault(d.account, []).append(d)

    return cc_actual_details

def get_dimension_account_month_map(filters):
    dimension_target_details = get_dimension_target_details(filters)
    tdd = get_target_distribution_details(filters)

    cam_map = {}

    for ccd in dimension_target_details:
        actual_details = get_actual_details(ccd.budget_against, filters)

        for month_id in range(1, 13):
            month = datetime.date(2013, month_id, 1).strftime("%B")
            cam_map.setdefault(ccd.budget_against, {}).setdefault(ccd.account, {}).setdefault(
                ccd.fiscal_year, {}
            ).setdefault(month, frappe._dict({"target": 0.0, "actual": 0.0}))

            tav_dict = cam_map[ccd.budget_against][ccd.account][ccd.fiscal_year][month]
            month_percentage = (
                tdd.get(ccd.monthly_distribution, {}).get(month, 0)
                if ccd.monthly_distribution
                else 100.0 / 12
            )

            tav_dict.target = flt(ccd.budget_amount) * month_percentage / 100

            for ad in actual_details.get(ccd.account, []):
                if ad.month_name == month and ad.fiscal_year == ccd.fiscal_year:
                    tav_dict.actual += flt(ad.debit) - flt(ad.credit)

    return cam_map

def get_fiscal_years(filters):
    fiscal_year = frappe.db.sql(
        """
            SELECT name
            FROM `tabFiscal Year`
            WHERE name = %(from_fiscal_year)s
        """,
        {"from_fiscal_year": filters["from_fiscal_year"]},
    )
    return fiscal_year

def get_chart_data(filters, columns, data):
    if not data:
        return None

    labels = []
    budget_values = []
    actual_values = []

    # Extract labels from columns (e.g., "Budget 2025", "Actual 2025")
    for col in columns:
        if "Budget" in col["label"]:
            labels.append(col["label"].replace("Budget ", ""))
        elif "Actual" in col["label"]:
            labels.append(col["label"].replace("Actual ", ""))

    # Populate budget and actual values
    for row in data:
        budget_values.append(flt(row.get("budget", 0)))
        actual_values.append(flt(row.get("actual", 0)))

    return {
        "data": {
            "labels": labels,
            "datasets": [
                {"name": _("Budget"), "chartType": "bar", "values": budget_values},
                {"name": _("Actual Expense"), "chartType": "bar", "values": actual_values},
            ],
        },
        "type": "bar",
    }

