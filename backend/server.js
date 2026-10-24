const express = require("express");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const app = express();
app.use(express.json());

// Serve the teammate's frontend from the folder above /backend.
// Only these paths are public, so the database file can't be downloaded.
const root = path.join(__dirname, "..", "frontend");
app.use("/css", express.static(path.join(root, "css")));
app.use("/js", express.static(path.join(root, "js")));
app.get("/", (req, res) => res.sendFile(path.join(root, "index.html")));

// ---------- Database (one file: splitease.db) ----------
const db = new Database(path.join(__dirname, "splitease.db"));
db.pragma("foreign_keys = ON"); // makes ON DELETE CASCADE work

db.exec(`
  CREATE TABLE IF NOT EXISTS expense_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    payer TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// ---------- Helpers: database row -> the shape the frontend expects ----------
function membersOf(groupId) {
  return db.prepare("SELECT name FROM group_members WHERE group_id = ? ORDER BY id")
    .all(groupId).map(r => r.name);
}
function toGroup(row) {
  return { id: row.id, name: row.name, members: membersOf(row.id), createdAt: row.created_at };
}
function toExpense(row) {
  const members = membersOf(row.group_id);
  return {
    id: row.id, title: row.title,
    amount: row.amount_paise / 100,
    groupId: row.group_id, payer: row.payer,
    memberCount: members.length, members,
    createdAt: row.created_at
  };
}

// ---------- Groups ----------
app.get("/api/groups", (req, res) => {
  const rows = db.prepare("SELECT * FROM expense_groups ORDER BY rowid DESC").all();
  res.json(rows.map(toGroup));
});

app.post("/api/groups", (req, res) => {
  const body = req.body || {};
  const name = String(body.name ?? "").trim();
  const raw = Array.isArray(body.members) ? body.members : [];
  const members = [...new Map(
    raw.map(m => String(m).trim()).filter(Boolean).map(m => [m.toLowerCase(), m])
  ).values()];

  if (!name || name.length > 60) return res.status(400).json({ error: "Enter a group name (max 60 characters)." });
  if (members.length < 2) return res.status(400).json({ error: "Add at least two different member names." });

  const id = crypto.randomUUID();
  db.transaction(() => {
    db.prepare("INSERT INTO expense_groups (id, name, created_at) VALUES (?, ?, ?)")
      .run(id, name, new Date().toISOString());
    const add = db.prepare("INSERT INTO group_members (group_id, name) VALUES (?, ?)");
    members.forEach(m => add.run(id, m));
  })();

  res.status(201).json(toGroup(db.prepare("SELECT * FROM expense_groups WHERE id = ?").get(id)));
});

app.delete("/api/groups/:id", (req, res) => {
  const result = db.prepare("DELETE FROM expense_groups WHERE id = ?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Group not found." });
  res.status(204).end();
});

// ---------- Expenses ----------
app.get("/api/expenses", (req, res) => {
  const rows = db.prepare("SELECT * FROM expenses ORDER BY rowid DESC").all();
  res.json(rows.map(toExpense));
});

app.post("/api/expenses", (req, res) => {
  const body = req.body || {};
  const title = String(body.title ?? "").trim();
  const amount = Number(body.amount);
  const group = db.prepare("SELECT * FROM expense_groups WHERE id = ?").get(body.groupId);

  if (!title || title.length > 80) return res.status(400).json({ error: "Enter an expense name (max 80 characters)." });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Enter an amount greater than 0." });
  if (!group) return res.status(404).json({ error: "Group not found." });
  if (!membersOf(group.id).includes(body.payer)) return res.status(400).json({ error: "The payer must be a member of this group." });

  const id = crypto.randomUUID();
  db.prepare("INSERT INTO expenses (id, group_id, title, amount_paise, payer, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, group.id, title, Math.round(amount * 100), body.payer, new Date().toISOString());

  res.status(201).json(toExpense(db.prepare("SELECT * FROM expenses WHERE id = ?").get(id)));
});

app.delete("/api/expenses/:id", (req, res) => {
  const result = db.prepare("DELETE FROM expenses WHERE id = ?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Expense not found." });
  res.status(204).end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));