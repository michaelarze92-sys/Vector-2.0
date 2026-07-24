-- Casino Estate PM Platform — core schema
-- SQLite. Booleans stored as INTEGER 0/1. Dates stored as ISO 'YYYY-MM-DD' text.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS venues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_code TEXT NOT NULL UNIQUE,       -- v1..v7, matches existing SHE report keys
  name TEXT NOT NULL,
  region TEXT CHECK (region IN ('London', 'Northern')),
  licence_type TEXT,
  current_rag TEXT CHECK (current_rag IN ('RED', 'AMBER', 'GREEN')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  venue_id INTEGER REFERENCES venues(id),      -- nullable: can span multiple venues
  category TEXT CHECK (category IN ('Compliance', 'Refurbishment', 'Contractor-Managed', 'Licensing', 'Other')),
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'Not Started' CHECK (status IN ('Not Started', 'In Progress', 'Blocked', 'Done')),
  budget_allocated REAL DEFAULT 0,
  budget_spent REAL DEFAULT 0,
  start_date TEXT,
  target_end_date TEXT,
  actual_end_date TEXT,
  licence_risk_flag INTEGER NOT NULL DEFAULT 0,
  gaming_floor_disruption INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),  -- nullable: standalone actions (e.g. imported Board actions)
  name TEXT NOT NULL,
  owner_name TEXT,
  owner_email TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'Not Started' CHECK (status IN ('Not Started', 'In Progress', 'Blocked', 'Done')),
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
  depends_on_task_id INTEGER REFERENCES tasks(id),
  board_input_required INTEGER NOT NULL DEFAULT 0,
  notes TEXT,                                   -- free text; also holds raw source text a date parser couldn't resolve
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS compliance_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  type TEXT NOT NULL CHECK (type IN (
    'Fire RA', 'Water Hygiene L8', 'EICR', 'LOLER', 'Gas Safety',
    'AHU Service', 'EHO Inspection', 'Pest Control'
  )),
  last_completed_date TEXT,
  next_due_date TEXT,
  rag_status TEXT CHECK (rag_status IN ('RED', 'AMBER', 'GREEN')),
  linked_project_id INTEGER REFERENCES projects(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contractor_kpis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contractor_name TEXT NOT NULL,
  kpi_name TEXT NOT NULL,
  target_value TEXT,
  this_period_value TEXT,
  last_period_value TEXT,
  rag_status TEXT CHECK (rag_status IN ('RED', 'AMBER', 'GREEN')),
  linked_project_id INTEGER REFERENCES projects(id),
  period_label TEXT,                            -- e.g. "October 2025", from the source report
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  description TEXT NOT NULL,
  supplier TEXT,
  amount REAL NOT NULL,
  date_logged TEXT NOT NULL,
  category TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_venue ON projects(venue_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_compliance_venue ON compliance_milestones(venue_id);
CREATE INDEX IF NOT EXISTS idx_budget_project ON budget_lines(project_id);
