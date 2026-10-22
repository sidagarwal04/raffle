async function request(path, { method = "GET", body, pin } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (pin) headers["x-host-pin"] = pin;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || "Something went wrong.");
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  createRoom: (body) => request("/api/rooms", { method: "POST", body }),
  getRoom: (code) => request(`/api/rooms/${code}`),
  getHost: (code, pin) => request(`/api/rooms/${code}/host`, { pin }),
  join: (code, body) => request(`/api/rooms/${code}/join`, { method: "POST", body }),
  draw: (code, pin, reveal) =>
    request(`/api/rooms/${code}/draw`, { method: "POST", pin, body: { reveal } }),
  redraw: (code, pin, reveal) =>
    request(`/api/rooms/${code}/redraw`, { method: "POST", pin, body: { reveal } }),
  setLocked: (code, pin, locked) =>
    request(`/api/rooms/${code}/lock`, { method: "POST", pin, body: { locked } }),
  setPrize: (code, pin, prize) =>
    request(`/api/rooms/${code}/prize`, { method: "POST", pin, body: { prize } }),
  setReveal: (code, pin, reveal) =>
    request(`/api/rooms/${code}/reveal`, { method: "POST", pin, body: { reveal } }),
  importCsv: (code, pin, csv) =>
    request(`/api/rooms/${code}/import`, { method: "POST", pin, body: { csv } }),
  me: async () => {
    const data = await request("/api/auth/me");
    return data.user;
  },
  rooms: () => request("/api/me/rooms"),
  logout: () => request("/api/auth/logout", { method: "POST" }),
};

export function cleanCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
}

export function roomPin(code) {
  return localStorage.getItem(`raffle-pin:${code}`) || "";
}

export function savePin(code, pin) {
  localStorage.setItem(`raffle-pin:${code}`, pin);
}

export function clearPin(code) {
  localStorage.removeItem(`raffle-pin:${code}`);
}

export function browserToken() {
  const existing = localStorage.getItem("raffle-token");
  if (existing) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  localStorage.setItem("raffle-token", token);
  return token;
}

export function savedName(code) {
  return localStorage.getItem(`raffle-name:${code}`) || "";
}

export function saveName(code, name) {
  localStorage.setItem(`raffle-name:${code}`, name);
}

export function savedEntry(code) {
  return localStorage.getItem(`raffle-entry:${code}`) || "";
}

export function saveEntry(code, entryId) {
  localStorage.setItem(`raffle-entry:${code}`, entryId);
}
