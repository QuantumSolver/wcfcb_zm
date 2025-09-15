import json
import os

import frappe
from frappe.custom.doctype.property_setter.property_setter import make_property_setter

folder = "./property_setters_json"


def load_json(file):
    CURR_DIR = os.path.abspath(os.path.dirname(__file__))
    json_file_path = os.path.join(CURR_DIR, folder, file)
    with open(json_file_path, "r") as file:
        data = json.load(file)
    return data


def create_property_setter_from_json(property_setters_obj):
    disallowed_fields = [
        "name",
        "owner",
        "creation",
        "modified",
        "modified_by",
        "docstatus",
        "idx",
        "is_system_generated",
        "__last_sync_on",
    ]

    existing_setters = {d.name for d in frappe.db.get_all("Property Setter", fields=["name"], page_length=10000)}

    for property_setter in property_setters_obj:
        # Skip invalid entries
        if not isinstance(property_setter, dict) or not property_setter:
            continue

        if property_setter.get("name") in existing_setters:
            continue

        for_doctype = property_setter.get("doctype_or_field") == "DocType"

        all_fields = frappe.get_meta("Property Setter").get_valid_columns()
        field_list = set(all_fields).difference(disallowed_fields)

        property_setter_dict = {field: property_setter.get(field) for field in field_list if field in property_setter}

        # Accept alternative keys for doc_type
        doc_type = property_setter_dict.get("doc_type") or property_setter.get("doctype") or property_setter.get("dt")
        prop = property_setter_dict.get("property") or property_setter.get("property")
        value = property_setter_dict.get("value") or property_setter.get("value")
        prop_type = property_setter_dict.get("property_type") or property_setter.get("property_type")
        fieldname = property_setter_dict.get("field_name") or property_setter.get("field_name")

        # Require minimum fields
        if not doc_type or not prop or prop_type is None or value is None:
            continue

        make_property_setter(
            doctype=doc_type,
            fieldname=fieldname,
            property=prop,
            value=value,
            property_type=prop_type,
            for_doctype=for_doctype,
        )

def execute():
    # read names of only json files in this folder and put it into files list
    files = list(
        filter(
            lambda x: x.endswith(".json"),
            os.listdir(
                os.path.join(os.path.abspath(os.path.dirname(__file__)), folder)
            ),
        )
    )
    for file in files:
        data = load_json(file)
        create_property_setter_from_json(data)