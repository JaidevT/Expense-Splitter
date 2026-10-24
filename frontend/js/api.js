(function () {
  "use strict";

  // Sends the request; turns a server { error } reply into a thrown Error,
  // which app.js already shows to the user.
  async function request(url, options = {}) {
    let res;
    try {
      res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
    } catch {
      throw new Error("Can't reach the server. Is it running?");
    }
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || "Something went wrong.");
    return body;
  }

  window.SplitEaseAPI = {
    getGroups: () => request("/api/groups"),
    createGroup: (name, members) =>
      request("/api/groups", { method: "POST", body: JSON.stringify({ name, members }) }),
    deleteGroup: id => request(`/api/groups/${id}`, { method: "DELETE" }),

    getExpenses: () => request("/api/expenses"),
    createExpense: input =>
      request("/api/expenses", { method: "POST", body: JSON.stringify(input) }),
    deleteExpense: id => request(`/api/expenses/${id}`, { method: "DELETE" }),

    clearDemoData: async () => {}
  };
})();