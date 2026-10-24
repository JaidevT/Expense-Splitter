(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  const state = {
    groups: [],
    expenses: [],
    currentPage: "dashboard",
    toastTimer: null,
    confirmAction: null
  };

  const money = amount => new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(amount) || 0);

  const safe = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);

  const initials = name =>
    String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0] || "")
      .join("")
      .toUpperCase();

  const getGroup = groupId =>
    state.groups.find(group => group.id === groupId);

  const dateLabel = date => {
    const parsed = new Date(date);

    return Number.isNaN(parsed.getTime())
      ? "Recently"
      : parsed.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric"
        });
  };

  // TOAST NOTIFICATIONS

  function toast(message) {
    const element = $("#toast");
    if (!element) return;

    element.textContent = message;
    element.classList.add("show");

    clearTimeout(state.toastTimer);

    state.toastTimer = setTimeout(() => {
      element.classList.remove("show");
    }, 2800);
  }

  // MODALS

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");

    document.body.classList.add("modal-open");

    const focusable = $("input, textarea, select, button", modal);

    if (focusable) {
      setTimeout(() => focusable.focus(), 30);
    }
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;

    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");

    if (!$$( ".modal-overlay:not(.hidden)" ).length) {
      document.body.classList.remove("modal-open");
    }
  }

  function closeAllModals() {
    $$(".modal-overlay").forEach(modal => {
      closeModal(modal.id);
    });
  }

  function showError(id, message) {
    const element = document.getElementById(id);
    if (!element) return;

    element.textContent = message;
    element.classList.toggle("hidden", !message);
  }

  // NAVIGATION

  function navigateTo(page) {
    const target = document.querySelector(
      `[data-page-section="${page}"]`
    );

    if (!target) return;

    state.currentPage = page;

    $$(".page").forEach(section => {
      section.classList.toggle("active", section === target);
    });

    $$("[data-page]").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.page === page
      );
    });

    const titles = {
      dashboard: "Dashboard",
      groups: "My Groups",
      expenses: "Expenses",
      settlements: "Settle Up"
    };

    $("#breadcrumb-current").textContent =
      titles[page] || "Dashboard";

    $("#sidebar").classList.remove("open");

    renderAll();
  }

  // EMPTY STATES

  function emptyState(icon, title, description, buttonLabel, action) {
    return `
      <div class="empty-state">
        <div class="empty-icon">${icon}</div>
        <h3>${safe(title)}</h3>
        <p>${safe(description)}</p>

        ${
          buttonLabel
            ? `<button
                type="button"
                class="button button-secondary button-small"
                data-action="${action}"
              >${safe(buttonLabel)}</button>`
            : ""
        }
      </div>
    `;
  }

  // GROUPS

  function renderGroups() {
    const full = $("#groups-list");
    const dashboard = $("#dashboard-groups");

    const groupMarkup = group => `
      <article class="group-card">
        <div class="item-avatar">
          ${safe(initials(group.name))}
        </div>

        <div class="item-main">
          <h3>${safe(group.name)}</h3>
          <p>
            ${group.members.length} members ·
            ${group.members.map(safe).join(", ")}
          </p>
          <p>Created ${safe(dateLabel(group.createdAt))}</p>
        </div>

        <div class="item-actions">
          <button
            type="button"
            class="icon-action"
            data-action="delete-group"
            data-id="${safe(group.id)}"
            aria-label="Delete ${safe(group.name)}"
            title="Delete group"
          >×</button>
        </div>
      </article>
    `;

    if (full) {
      full.innerHTML = state.groups.length
        ? state.groups.map(groupMarkup).join("")
        : emptyState(
            "♧",
            "No groups yet",
            "Create a group to get started.",
            "＋ Create group",
            "new-group"
          );
    }

    if (dashboard) {
      dashboard.innerHTML = state.groups.length
        ? state.groups.slice(0, 3).map(groupMarkup).join("")
        : emptyState(
            "♧",
            "No groups yet",
            "Create a group to start splitting expenses.",
            "＋ New group",
            "new-group"
          );
    }

    $("#group-count").textContent =
      `${state.groups.length} ${
        state.groups.length === 1 ? "group" : "groups"
      }`;

    $("#groups-caption").textContent = state.groups.length
      ? `${state.groups.length} group${
          state.groups.length === 1 ? "" : "s"
        } keeping things organized.`
      : "Manage your shared expenses.";

    populateGroupSelects();
  }

  // EXPENSES

  function renderExpenseItem(expense) {
    const group = getGroup(expense.groupId);

    return `
      <article class="expense-item">
        <div class="item-avatar">₹</div>

        <div class="item-main">
          <h3>${safe(expense.title)}</h3>
          <p>
            ${safe(group?.name || "Deleted group")} ·
            Paid by ${safe(expense.payer)}
          </p>
          <p>
            ${safe(dateLabel(expense.createdAt))} ·
            Split between ${Number(expense.memberCount) || 1} people
          </p>
        </div>

        <div class="item-amount">
          ${money(expense.amount)}
        </div>

        <div class="item-actions">
          <button
            type="button"
            class="icon-action"
            data-action="delete-expense"
            data-id="${safe(expense.id)}"
            aria-label="Delete ${safe(expense.title)}"
            title="Delete expense"
          >×</button>
        </div>
      </article>
    `;
  }

  function renderExpenses() {
    const all = $("#expenses-list");
    const dashboard = $("#dashboard-expenses");
    const filter = $("#expense-filter");

    const previous = filter.value;

    filter.innerHTML =
      `<option value="all">All groups</option>` +
      state.groups.map(group => `
        <option value="${safe(group.id)}">
          ${safe(group.name)}
        </option>
      `).join("");

    if (state.groups.some(group => group.id === previous)) {
      filter.value = previous;
    }

    const filtered = filter.value === "all"
      ? state.expenses
      : state.expenses.filter(
          expense => expense.groupId === filter.value
        );

    all.innerHTML = filtered.length
      ? filtered.map(renderExpenseItem).join("")
      : emptyState(
          "↔",
          state.groups.length ? "No expenses yet" : "Create a group first",
          state.groups.length
            ? "Add an expense to start tracking shared spending."
            : "You'll be able to add expenses after creating a group.",
          state.groups.length ? "＋ Add expense" : "＋ Create group",
          state.groups.length ? "new-expense" : "new-group"
        );

    dashboard.innerHTML = state.expenses.length
      ? state.expenses.slice(0, 4).map(renderExpenseItem).join("")
      : emptyState(
          "↔",
          "No expenses yet",
          "Your latest shared spending will appear here.",
          state.groups.length ? "＋ Add expense" : "＋ Create group",
          state.groups.length ? "new-expense" : "new-group"
        );
  }

  // BALANCE CALCULATIONS

  function calculateBalances() {
    const balances = new Map();

    const add = (name, amount) => {
      balances.set(
        name,
        (balances.get(name) || 0) + amount
      );
    };

    state.expenses.forEach(expense => {
      const group = getGroup(expense.groupId);

      if (!group || !group.members.length) return;

      const total = Number(expense.amount) || 0;
      const share = total / group.members.length;

      group.members.forEach(member => {
        add(member, -share);
      });

      add(expense.payer, total);
    });

    // Normalize tiny floating-point differences.
    for (const [name, value] of balances) {
      balances.set(
        name,
        Math.abs(value) < 0.005 ? 0 : value
      );
    }

    return balances;
  }

  function calculateSettlements() {
    const balances = calculateBalances();

    const debtors = [];
    const creditors = [];

    balances.forEach((balance, name) => {
      if (balance < -0.005) {
        debtors.push({ name, amount: -balance });
      }

      if (balance > 0.005) {
        creditors.push({ name, amount: balance });
      }
    });

    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const transfers = [];

    let i = 0;
    let j = 0;

    while (i < debtors.length && j < creditors.length) {
      const amount = Math.min(
        debtors[i].amount,
        creditors[j].amount
      );

      if (amount > 0.005) {
        transfers.push({
          from: debtors[i].name,
          to: creditors[j].name,
          amount
        });
      }

      debtors[i].amount -= amount;
      creditors[j].amount -= amount;

      if (debtors[i].amount < 0.005) i++;
      if (creditors[j].amount < 0.005) j++;
    }

    return { balances, transfers };
  }

  // DASHBOARD TOTALS

  function renderDashboardStats() {
    const total = state.expenses.reduce(
      (sum, expense) =>
        sum + (Number(expense.amount) || 0),
      0
    );

    const { balances } = calculateSettlements();

    const owed = Math.max(
      0,
      balances.get("Jai") || 0
    );

    const youOwe = Math.max(
      0,
      -(balances.get("Jai") || 0)
    );

    $("#total-spending").textContent = money(total);
    $("#total-owed").textContent = money(owed);
    $("#total-you-owe").textContent = money(youOwe);
  }

  // SETTLEMENT PAGE

  function renderSettlements() {
    const { balances, transfers } = calculateSettlements();
    const net = balances.get("Jai") || 0;

    $("#settlement-summary").innerHTML = `
      <article class="stat-card">
        <div class="stat-top">
          <span class="stat-icon green">↙</span>
          <span class="stat-label">Your net balance</span>
        </div>
        <h2 class="${net >= 0 ? "positive" : "negative"}">
          ${money(Math.abs(net))}
        </h2>
        <p>
          ${
            net > 0.005
              ? "Others owe you"
              : net < -0.005
                ? "You owe others"
                : "You're all settled up"
          }
        </p>
      </article>

      <article class="stat-card">
        <div class="stat-top">
          <span class="stat-icon purple">⇄</span>
          <span class="stat-label">Pending settlements</span>
        </div>
        <h2>${transfers.length}</h2>
        <p>Suggested transfers across all groups</p>
      </article>
    `;

    const list = $("#settlements-list");

    list.innerHTML = transfers.length
      ? `
        <div class="group-list">
          ${transfers.map(transfer => `
            <article class="settlement-item">
              <div class="settlement-path">
                <span class="person-pill">
                  <span class="person-dot"></span>
                  ${safe(transfer.from)}
                </span>

                <span class="settlement-arrow">pays →</span>

                <span class="person-pill">
                  <span class="person-dot"></span>
                  ${safe(transfer.to)}
                </span>
              </div>

              <div class="settlement-amount">
                ${money(transfer.amount)}
              </div>
            </article>
          `).join("")}
        </div>
      `
      : emptyState(
          "⇄",
          "Nothing to settle",
          state.expenses.length
            ? "Everyone's balances are settled based on the expenses recorded."
            : "Add expenses to calculate who owes whom."
        );
  }

  // EXPENSE FORM DROPDOWNS

  function populateGroupSelects() {
    const groupSelect = $("#expense-group");
    const payerSelect = $("#expense-payer");

    if (!groupSelect || !payerSelect) return;

    const selected = groupSelect.value;

    groupSelect.innerHTML = state.groups.map(group => `
      <option value="${safe(group.id)}">
        ${safe(group.name)}
      </option>
    `).join("");

    if (state.groups.some(group => group.id === selected)) {
      groupSelect.value = selected;
    }

    updatePayerOptions();

    $("#expenses-add-expense").disabled =
      state.groups.length === 0;

    $("#dashboard-add-expense").disabled =
      state.groups.length === 0;

    $("#header-add-expense").disabled =
      state.groups.length === 0;
  }

  function updatePayerOptions() {
    const group = getGroup($("#expense-group").value);
    const payerSelect = $("#expense-payer");

    if (!payerSelect) return;

    const previous = payerSelect.value;

    payerSelect.innerHTML = (group?.members || [])
      .map(member => `
        <option value="${safe(member)}">
          ${safe(member)}
        </option>
      `).join("");

    if (group?.members.includes(previous)) {
      payerSelect.value = previous;
    }
  }

  // RENDER EVERYTHING

  function renderAll() {
    renderGroups();
    renderExpenses();
    renderDashboardStats();
    renderSettlements();
  }

  // OPEN FORMS

  function openGroupModal() {
    showError("group-form-error", "");
    $("#group-form").reset();
    openModal("group-modal");
  }

  function openExpenseModal() {
    if (!state.groups.length) {
      toast("Create a group before adding an expense.");
      navigateTo("groups");
      return;
    }

    showError("expense-form-error", "");
    $("#expense-form").reset();

    populateGroupSelects();
    openModal("expense-modal");
  }

  function askConfirm(title, message, action) {
    $("#confirm-title").textContent = title;
    $("#confirm-message").textContent = message;

    state.confirmAction = action;

    openModal("confirm-modal");
  }

  // CREATE GROUP

  async function handleCreateGroup(event) {
    event.preventDefault();

    showError("group-form-error", "");

    const name = $("#group-name").value.trim();

    const rawMembers = $("#member-names")
      .value
      .split(",")
      .map(name => name.trim())
      .filter(Boolean);

    const members = [
      ...new Map(
        rawMembers.map(member => [
          member.toLocaleLowerCase(),
          member
        ])
      ).values()
    ];

    if (!name) {
      return showError(
        "group-form-error",
        "Please enter a group name."
      );
    }

    if (members.length < 2) {
      return showError(
        "group-form-error",
        "Add at least two different member names."
      );
    }

    try {
      await window.SplitEaseAPI.createGroup(name, members);

      state.groups = await window.SplitEaseAPI.getGroups();

      renderAll();
      closeModal("group-modal");

      toast(`Group "${name}" created successfully.`);
    } catch (error) {
      showError(
        "group-form-error",
        error.message || "Could not create this group."
      );
    }
  }

  // CREATE EXPENSE

  async function handleCreateExpense(event) {
    event.preventDefault();

    showError("expense-form-error", "");

    const title = $("#expense-title").value.trim();
    const amount = Number($("#expense-amount").value);
    const group = getGroup($("#expense-group").value);
    const payer = $("#expense-payer").value;

    if (!title) {
      return showError(
        "expense-form-error",
        "Please enter an expense name."
      );
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return showError(
        "expense-form-error",
        "Enter an amount greater than ₹0."
      );
    }

    if (!group) {
      return showError(
        "expense-form-error",
        "Choose a valid group."
      );
    }

    if (!group.members.includes(payer)) {
      return showError(
        "expense-form-error",
        "Choose a payer from this group."
      );
    }

    try {
      await window.SplitEaseAPI.createExpense({
        title,
        amount: Math.round(amount * 100) / 100,
        groupId: group.id,
        payer,
        memberCount: group.members.length,
        members: [...group.members]
      });

      state.expenses = await window.SplitEaseAPI.getExpenses();

      renderAll();
      closeModal("expense-modal");

      toast("Expense saved successfully.");
    } catch (error) {
      showError(
        "expense-form-error",
        error.message || "Could not save this expense."
      );
    }
  }

  // EVENT LISTENERS

  function bindEvents() {
    // Delegated events keep dynamically rendered buttons working.
    document.addEventListener("click", async event => {
      const pageButton = event.target.closest("[data-page]");

      if (pageButton) {
        event.preventDefault();
        navigateTo(pageButton.dataset.page);
        return;
      }

      const actionButton = event.target.closest("[data-action]");

      if (actionButton) {
        const action = actionButton.dataset.action;

        if (action === "new-group") {
          openGroupModal();
        }

        if (action === "new-expense") {
          openExpenseModal();
        }

        if (action === "delete-group") {
          const group = getGroup(actionButton.dataset.id);

          if (group) {
            askConfirm(
              "Delete this group?",
              `Delete "${group.name}" and all its recorded expenses?`,
              async () => {
                await window.SplitEaseAPI.deleteGroup(group.id);

                state.groups =
                  await window.SplitEaseAPI.getGroups();

                state.expenses =
                  await window.SplitEaseAPI.getExpenses();

                renderAll();
                toast("Group and its expenses deleted.");
              }
            );
          }
        }

        if (action === "delete-expense") {
          const expense = state.expenses.find(
            item => item.id === actionButton.dataset.id
          );

          if (expense) {
            askConfirm(
              "Delete this expense?",
              `Delete "${expense.title}" from your records?`,
              async () => {
                await window.SplitEaseAPI.deleteExpense(
                  expense.id
                );

                state.expenses =
                  await window.SplitEaseAPI.getExpenses();

                renderAll();
                toast("Expense deleted.");
              }
            );
          }
        }

        return;
      }

      // Clicking the dark area outside a modal closes it.
      if (event.target.classList.contains("modal-overlay")) {
        closeModal(event.target.id);
      }
    });

    $("#header-add-group").addEventListener(
      "click",
      openGroupModal
    );

    $("#dashboard-new-group").addEventListener(
      "click",
      openGroupModal
    );

    $("#header-add-expense").addEventListener(
      "click",
      openExpenseModal
    );

    $("#dashboard-add-expense").addEventListener(
      "click",
      openExpenseModal
    );

    $("#expenses-add-expense").addEventListener(
      "click",
      openExpenseModal
    );

    $("#close-modal").addEventListener("click", () => {
      closeModal("group-modal");
    });

    $("#cancel-modal").addEventListener("click", () => {
      closeModal("group-modal");
    });

    $("#close-expense-modal").addEventListener("click", () => {
      closeModal("expense-modal");
    });

    $("#cancel-expense-modal").addEventListener("click", () => {
      closeModal("expense-modal");
    });

    $("#group-form").addEventListener(
      "submit",
      handleCreateGroup
    );

    $("#expense-form").addEventListener(
      "submit",
      handleCreateExpense
    );

    $("#expense-group").addEventListener(
      "change",
      updatePayerOptions
    );

    $("#expense-filter").addEventListener(
      "change",
      renderExpenses
    );

    $("#confirm-cancel").addEventListener("click", () => {
      closeModal("confirm-modal");
      state.confirmAction = null;
    });

    $("#confirm-accept").addEventListener(
      "click",
      async () => {
        const action = state.confirmAction;

        state.confirmAction = null;
        closeModal("confirm-modal");

        if (action) {
          try {
            await action();
          } catch (error) {
            toast(
              error.message || "That action could not be completed."
            );
          }
        }
      }
    );

    $("#mobile-menu").addEventListener("click", () => {
      $("#sidebar").classList.toggle("open");
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeAllModals();
      }
    });
  }

  // INITIALIZE THE APP

  async function init() {
    try {
      state.groups = await window.SplitEaseAPI.getGroups();
      state.expenses = await window.SplitEaseAPI.getExpenses();

      bindEvents();
      renderAll();
      navigateTo("dashboard");
    } catch (error) {
      console.error("SplitEase initialization failed:", error);

      toast(
        "The app could not load saved data. Refresh the page to try again."
      );
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();