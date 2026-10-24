/* SplitEase local data adapter.
   This is a browser-only adapter for frontend development. Replace its internals
   with fetch() calls when the real backend endpoints are confirmed. */

(function () {
  "use strict";

  const KEYS = {
    groups: "splitease_groups_v2",
    expenses: "splitease_expenses_v2"
  };

  function read(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (error) {
      console.warn("SplitEase: stored data could not be read.", error);
      return [];
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error("SplitEase: unable to save data.", error);
      throw new Error(
        "Your browser could not save this change. Check available storage."
      );
    }
  }

  function makeId(prefix) {
    return prefix + "_" +
      Date.now().toString(36) + "_" +
      Math.random().toString(36).slice(2, 8);
  }

  const api = {
    async getGroups() {
      return read(KEYS.groups);
    },

    async createGroup(name, members) {
      const groups = read(KEYS.groups);

      const group = {
        id: makeId("grp"),
        name,
        members,
        createdAt: new Date().toISOString()
      };

      groups.unshift(group);
      write(KEYS.groups, groups);

      return group;
    },

    async deleteGroup(groupId) {
      const groups = read(KEYS.groups)
        .filter(group => group.id !== groupId);

      const expenses = read(KEYS.expenses)
        .filter(expense => expense.groupId !== groupId);

      write(KEYS.groups, groups);
      write(KEYS.expenses, expenses);

      return true;
    },

    async getExpenses() {
      return read(KEYS.expenses);
    },

    async createExpense(input) {
      const expenses = read(KEYS.expenses);

      const expense = {
        id: makeId("exp"),
        ...input,
        createdAt: new Date().toISOString()
      };

      expenses.unshift(expense);
      write(KEYS.expenses, expenses);

      return expense;
    },

    async deleteExpense(expenseId) {
      const expenses = read(KEYS.expenses)
        .filter(expense => expense.id !== expenseId);

      write(KEYS.expenses, expenses);

      return true;
    },

    async clearDemoData() {
      localStorage.removeItem(KEYS.groups);
      localStorage.removeItem(KEYS.expenses);
    }
  };

  window.SplitEaseAPI = api;
})();