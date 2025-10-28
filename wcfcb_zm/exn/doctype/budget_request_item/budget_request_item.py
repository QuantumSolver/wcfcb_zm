# Copyright (c) 2024, WCFCB and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class BudgetRequestItem(Document):
	def validate(self):
		"""Validate the budget request item"""
		self.validate_accounts()
		self.calculate_balances()
	
	def validate_accounts(self):
		"""Validate that from_account and to_account are different"""
		if self.from_account and self.to_account and self.from_account == self.to_account:
			frappe.throw("From Account and To Account cannot be the same")
	
	def calculate_balances(self):
		"""Calculate remaining and new balances"""
		if self.from_available and self.amount_requested:
			self.from_remaining = self.from_available - self.amount_requested
		
		if self.to_available and self.amount_requested:
			self.to_new_amount = self.to_available + self.amount_requested
