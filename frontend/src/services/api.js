// API Base URL - có thể config theo môi trường
const API_BASE = import.meta.env.VITE_API_BASE || "";

// Helper function để handle API response
async function handleResponse(response) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Request failed");
  }
  return response.json();
}

// Auth APIs
export const authAPI = {
  async login(userid, pwd) {
    const response = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userid, pwd }),
    });
    return handleResponse(response);
  },

  logout() {
    localStorage.removeItem("user");
  },

  getUser() {
    const user = localStorage.getItem("user");
    return user ? JSON.parse(user) : null;
  },
};

// Device APIs
export const deviceAPI = {
  async getAll() {
    const response = await fetch(`${API_BASE}/api/devices`);
    return handleResponse(response);
  },

  async create(device) {
    const user = authAPI.getUser();
    const payload = {
      ...device,
      userid: user?.USERID || "import/batch",
    };

    const response = await fetch(`${API_BASE}/api/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.text();
  },

  async update(id, device) {
    const user = authAPI.getUser();
    const payload = {
      ...device,
      userid: user?.USERID || "edit",
    };

    const response = await fetch(`${API_BASE}/api/devices/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.text();
  },

  async delete(id) {
    const response = await fetch(`${API_BASE}/api/devices/${id}`, {
      method: "DELETE",
    });
    return handleResponse(response);
  },

  async discover(range, concurrency) {
    const body = { range };
    if (concurrency) body.concurrency = concurrency;

    const response = await fetch(`${API_BASE}/api/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return handleResponse(response);
  },

  getExportUrl(filters) {
    const {
      type = "all",
      q = "",
      status = "all",
      sortField = "name",
      sortAsc = "1",
    } = filters;
    return `${API_BASE}/api/devices/export?type=${type}&q=${encodeURIComponent(
      q
    )}&status=${status}&sortField=${sortField}&sortAsc=${sortAsc}`;
  },

  async import(file) {
    const user = authAPI.getUser();
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/api/devices/import`, {
      method: "POST",
      headers: {
        "x-userid": user?.USERID || "import",
      },
      body: formData,
    });

    return handleResponse(response);
  },
};

export default {
  authAPI,
  deviceAPI,
};
