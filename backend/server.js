const express = require("express");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const app = express();
app.use(express.json());

// Serve the frontend from /frontend. Only these paths are public,
// so the database file can't be downloaded.
const root = path.join(__dirname, "..", "frontend");
app.use("/css", express.static(path.join(root, "css")));
app.use("/js", express.static(path.join(root, "js")));
app.get("/", (req, res) => res.sendFile(path.join(root, "index.html")));

// ---------- Database ----------
const db = new Database(path.join(__dirname, "splitease.db"));
db.pragma("foreign_keys = ON");

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
    split_type TEXT NOT NULL DEFAULT 'equal',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS expense_splits (
    expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    member TEXT NOT NULL,
    share_paise INTEGER NOT NULL,
    PRIMARY KEY (expense_id, member)
  );
`);

// ---------- Errors ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- Money helpers (everything is whole paise) ----------
const toPaise = rupees => Math.round(rupees * 100);
const sum = list => list.reduce((a, b) => a + b, 0);

// Divide totalPaise in proportion to weights, as whole paise that add up
// to EXACTLY totalPaise (leftover paise go to the largest remainders).
function allocate(totalPaise, weights) {
  const weightSum = sum(weights);
  const raw = weights.map(w => (totalPaise * w) / weightSum);
  const shares = raw.map(Math.floor);
  let left = totalPaise - sum(shares);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; left > 0; k++, left--) shares[order[k % order.length].i]++;
  return shares;
}

// Works out who owes what for one expense. Returns { splitType, shares: [{member, share}] }.
function buildSplit(body, totalPaise, groupMembers) {
  const splitType = body.splitType || "equal";

  if (splitType === "equal") {
    const chosen = Array.isArray(body.participants) && body.participants.length
      ? body.participants.map(String) : groupMembers;
    const people = [...new Set(chosen)];
    if (people.some(m => !groupMembers.includes(m)))
      throw new HttpError(400, "Everyone in the split must be a member of the group.");
    const shares = allocate(totalPaise, people.map(() => 1));
    return { splitType, shares: people.map((member, i) => ({ member, share: shares[i] })) };
  }

  if (splitType === "exact" || splitType === "percent") {
    const input = body.splits;
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new HttpError(400, "Provide splits as an object like { \"Jai\": 60, \"Prince\": 40 }.");
    const names = Object.keys(input);
    if (!names.length) throw new HttpError(400, "Choose at least one person for the split.");
    if (names.some(n => !groupMembers.includes(n)))
      throw new HttpError(400, "Everyone in the split must be a member of the group.");
    const values = names.map(n => Number(input[n]));
    if (values.some(v => !Number.isFinite(v) || v < 0))
      throw new HttpError(400, "Split values must be numbers, 0 or more.");

    let shares;
    if (splitType === "exact") {
      shares = values.map(toPaise);
      if (sum(shares) !== totalPaise)
        throw new HttpError(400, "Exact amounts must add up to the expense total.");
    } else {
      if (Math.abs(sum(values) - 100) > 0.01)
        throw new HttpError(400, "Percentages must add up to 100.");
      shares = allocate(totalPaise, values);
    }
    const entries = names.map((member, i) => ({ member, share: shares[i] }))
      .filter(e => e.share > 0);                       // 0 means "not part of this expense"
    if (!entries.length) throw new HttpError(400, "Choose at least one person for the split.");
    return { splitType, shares: entries };
  }

  throw new HttpError(400, "splitType must be equal, exact or percent.");
}

// Validates a create/edit request body and returns clean data.
function validateExpense(body, groupMembers) {
  const title = String(body.title ?? "").trim();
  const amount = Number(body.amount);
  const payer = body.payer;

  if (!title || title.length > 80) throw new HttpError(400, "Enter an expense name (max 80 characters).");
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Enter an amount greater than 0.");
  const totalPaise = toPaise(amount);
  if (totalPaise < 1) throw new HttpError(400, "Enter an amount greater than 0.");
  if (!groupMembers.includes(payer)) throw new HttpError(400, "The payer must be a member of this group.");

  return { title, totalPaise, payer, split: buildSplit(body, totalPaise, groupMembers) };
}

function saveSplits(expenseId, shares) {
  db.prepare("DELETE FROM expense_splits WHERE expense_id = ?").run(expenseId);
  const insert = db.prepare("INSERT INTO expense_splits (expense_id, member, share_paise) VALUES (?, ?, ?)");
  shares.forEach(s => insert.run(expenseId, s.member, s.share));
}

// ---------- Row -> JSON shapes (money goes out in rupees) ----------
function membersOf(groupId) {
  return db.prepare("SELECT name FROM group_members WHERE group_id = ? ORDER BY id")
    .all(groupId).map(r => r.name);
}
function toGroup(row) {
  return { id: row.id, name: row.name, members: membersOf(row.id), createdAt: row.created_at };
}
function toExpense(row) {
  const splitRows = db.prepare("SELECT member, share_paise FROM expense_splits WHERE expense_id = ? ORDER BY rowid").all(row.id);
  const splits = {};
  splitRows.forEach(s => { splits[s.member] = s.share_paise / 100; });
  return {
    id: row.id, title: row.title,
    amount: row.amount_paise / 100,
    groupId: row.group_id, payer: row.payer,
    splitType: row.split_type,
    splits,                                   // { name: rupees owed }
    members: splitRows.map(s => s.member),    // who is part of this expense
    memberCount: splitRows.length,
    createdAt: row.created_at
  };
}

// ---------- Groups ----------
app.get("/api/groups", (req, res) => {
  res.json(db.prepare("SELECT * FROM expense_groups ORDER BY rowid DESC").all().map(toGroup));
});

app.post("/api/groups", (req, res) => {
  const body = req.body || {};
  const name = String(body.name ?? "").trim();
  const raw = Array.isArray(body.members) ? body.members : [];
  const members = [...new Map(
    raw.map(m => String(m).trim()).filter(Boolean).map(m => [m.toLowerCase(), m])
  ).values()];

  if (!name || name.length > 60) throw new HttpError(400, "Enter a group name (max 60 characters).");
  if (members.length < 2) throw new HttpError(400, "Add at least two different member names.");

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
  if (!result.changes) throw new HttpError(404, "Group not found.");
  res.status(204).end();
});

// ---------- Expenses ----------
app.get("/api/expenses", (req, res) => {
  res.json(db.prepare("SELECT * FROM expenses ORDER BY rowid DESC").all().map(toExpense));
});

app.post("/api/expenses", (req, res) => {
  const body = req.body || {};
  const group = db.prepare("SELECT * FROM expense_groups WHERE id = ?").get(body.groupId);
  if (!group) throw new HttpError(404, "Group not found.");
  const data = validateExpense(body, membersOf(group.id));

  const id = crypto.randomUUID();
  db.transaction(() => {
    db.prepare(`INSERT INTO expenses (id, group_id, title, amount_paise, payer, split_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, group.id, data.title, data.totalPaise, data.payer, data.split.splitType, new Date().toISOString());
    saveSplits(id, data.split.shares);
  })();
  res.status(201).json(toExpense(db.prepare("SELECT * FROM expenses WHERE id = ?").get(id)));
});

// Edit an expense. The group can't be changed; everything else can.
app.put("/api/expenses/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM expenses WHERE id = ?").get(req.params.id);
  if (!existing) throw new HttpError(404, "Expense not found.");
  const data = validateExpense(req.body || {}, membersOf(existing.group_id));

  db.transaction(() => {
    db.prepare("UPDATE expenses SET title = ?, amount_paise = ?, payer = ?, split_type = ? WHERE id = ?")
      .run(data.title, data.totalPaise, data.payer, data.split.splitType, existing.id);
    saveSplits(existing.id, data.split.shares);
  })();
  res.json(toExpense(db.prepare("SELECT * FROM expenses WHERE id = ?").get(existing.id)));
});

app.delete("/api/expenses/:id", (req, res) => {
  const result = db.prepare("DELETE FROM expenses WHERE id = ?").run(req.params.id);
  if (!result.changes) throw new HttpError(404, "Expense not found.");
  res.status(204).end();
});

// ---------- Settle up ----------
// Balance = paid - owed (in paise). Positive = should receive, negative = should pay.
function settlementFor(group) {
  const balance = {};
  membersOf(group.id).forEach(m => { balance[m] = 0; });

  const getSplits = db.prepare("SELECT member, share_paise FROM expense_splits WHERE expense_id = ?");
  db.prepare("SELECT * FROM expenses WHERE group_id = ?").all(group.id).forEach(e => {
    balance[e.payer] += e.amount_paise;
    getSplits.all(e.id).forEach(s => { balance[s.member] -= s.share_paise; });
  });

  const debtors = [], creditors = [];
  for (const [name, value] of Object.entries(balance)) {
    if (value < 0) debtors.push({ name, amount: -value });
    if (value > 0) creditors.push({ name, amount: value });
  }
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    transfers.push({ from: debtors[i].name, to: creditors[j].name, amount: amount / 100 });
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount === 0) i++;     // whole numbers, so exact comparison is safe
    if (creditors[j].amount === 0) j++;
  }

  return {
    groupId: group.id,
    groupName: group.name,
    balances: Object.entries(balance).map(([name, value]) => ({ name, amount: value / 100 })),
    transfers
  };
}

// GET /api/settlements            -> every group
// GET /api/settlements?groupId=ID -> one group
app.get("/api/settlements", (req, res) => {
  let groups;
  if (req.query.groupId) {
    const group = db.prepare("SELECT * FROM expense_groups WHERE id = ?").get(req.query.groupId);
    if (!group) throw new HttpError(404, "Group not found.");
    groups = [group];
  } else {
    groups = db.prepare("SELECT * FROM expense_groups ORDER BY rowid DESC").all();
  }
  res.json(groups.map(settlementFor));
});

// ---------- Error handling (keep this last) ----------
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Request body is not valid JSON." });
  console.error(err);
  res.status(500).json({ error: "Server error." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));