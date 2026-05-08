-- =============================================================================
-- Phase 4.4 polish — Expenses + Net Profit on the budget
-- =============================================================================

alter table budgets
  add column if not exists annual_expenses numeric,
  add column if not exists ytd_expenses_by_month jsonb;
