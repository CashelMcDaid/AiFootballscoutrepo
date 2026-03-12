const roleSelect = document.getElementById("roleSelect");
const leagueSelect = document.getElementById("leagueSelect");
const standingsLeagueSelect = document.getElementById("standingsLeagueSelect");
const defenceSlider = document.getElementById("defenceSlider");
const defenceValue = document.getElementById("defenceValue");
const tableBody = document.getElementById("playerTable");
const noDataMessage = document.getElementById("noDataMessage");
const table = document.getElementById("playersTable");
const standingsBody = document.getElementById("standingsBody");
const loginIdInput = document.getElementById("loginUsername");
const loginPasswordInput = document.getElementById("loginPassword");
const loginButton = document.getElementById("loginButton");
const registerButton = document.getElementById("registerButton");
const logoutBtn = document.getElementById("logoutBtn");
const loginStatus = document.getElementById("loginStatus");
const viewAllButton = document.getElementById("viewAllBtn");
const viewFavButton = document.getElementById("viewFavBtn");
const weeklySuggestionBox = document.getElementById("weeklySuggestionBox");
const scoutSuggestionList = document.getElementById("scoutSuggestionList");
const adminSummary = document.getElementById("adminSummary");
const refreshDataBtn = document.getElementById("refreshDataBtn");
const adminTabButton = document.getElementById("adminTabButton");

let rawPlayers = [];
let currentPlayers = [];
let standingsMap = {};
let sortKey = "overallScore";
let sortDir = "desc";
let currentUser = null;
let currentScoutData = { favourites: [], notes: {} };
let viewMode = "all";

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function pct(x) {
  return Math.round(clamp01(x) * 100);
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isFavourite(playerId) {
  if (!currentUser || !Array.isArray(currentScoutData.favourites)) return false;
  return currentScoutData.favourites.includes(String(playerId));
}

function getSelectedLeague() {
  return leagueSelect.value || "All";
}

function filterByLeague(player) {
  const selected = getSelectedLeague();
  return selected === "All" || player.leagueName === selected;
}

function buildScoredPlayers(roleFilter, defensiveWeight) {
  const defFactor = defensiveWeight / 100;
  const attFactor = 1 - defFactor;

  const pool = rawPlayers.filter(filterByLeague);
  const maxInterceptions = pool.reduce((max, p) => Math.max(max, num(p.interceptions)), 0) || 1;
  const maxShots = pool.reduce((max, p) => Math.max(max, num(p.shots)), 0) || 1;
  const maxPasses = pool.reduce((max, p) => Math.max(max, num(p.passesAttempted)), 0) || 1;

  const result = [];

  for (const p of pool) {
    if (roleFilter !== "Any" && p.detailedPosition !== roleFilter) continue;
    if (viewMode === "favourites" && currentUser && !isFavourite(p.id)) continue;

    const shots = num(p.shots);
    const goals = num(p.goals);
    const passesCompleted = num(p.passesCompleted);
    const passesAttempted = num(p.passesAttempted);
    const aerialWon = num(p.aerialDuelsWon);
    const aerialTotal = num(p.aerialDuelsTotal);
    const interceptionsRaw = num(p.interceptions);

    const finishingRate = shots > 0 ? goals / shots : 0;
    const passingAccuracy = passesAttempted > 0 ? passesCompleted / passesAttempted : 0;
    const aerialWinRate = aerialTotal > 0 ? aerialWon / aerialTotal : 0;
    const interceptionsRate = interceptionsRaw / maxInterceptions;
    const shotVolume = shots / maxShots;
    const passVolume = passesAttempted / maxPasses;
    const shootingThreat = 0.6 * finishingRate + 0.4 * shotVolume;

    const finishingScore = pct(finishingRate);
    const passingScore = pct(passingAccuracy);
    const headerScore = pct(aerialWinRate);
    const interceptionsScore = pct(interceptionsRate);

    let attackRaw = 0;
    let defenceRaw = 0;

    if (p.detailedPosition === "GK") {
      attackRaw = 0.65 * passingAccuracy + 0.35 * passVolume;
      defenceRaw = 0.55 * aerialWinRate + 0.45 * interceptionsRate;
    } else if (p.detailedPosition === "CB") {
      attackRaw = 0.15 * passingAccuracy + 0.10 * shootingThreat + 0.20 * passVolume;
      defenceRaw = 0.45 * aerialWinRate + 0.35 * interceptionsRate + 0.20 * passingAccuracy;
    } else if (p.detailedPosition === "FB") {
      attackRaw = 0.20 * passingAccuracy + 0.20 * shotVolume + 0.20 * aerialWinRate;
      defenceRaw = 0.35 * aerialWinRate + 0.35 * interceptionsRate + 0.20 * passingAccuracy;
    } else if (p.detailedPosition === "DM") {
      attackRaw = 0.25 * passingAccuracy + 0.15 * shotVolume + 0.10 * aerialWinRate;
      defenceRaw = 0.40 * interceptionsRate + 0.30 * passingAccuracy + 0.20 * aerialWinRate;
    } else if (p.detailedPosition === "CM") {
      attackRaw = 0.30 * passingAccuracy + 0.25 * shootingThreat + 0.10 * aerialWinRate;
      defenceRaw = 0.30 * interceptionsRate + 0.30 * passingAccuracy + 0.15 * aerialWinRate;
    } else if (p.detailedPosition === "AM") {
      attackRaw = 0.50 * shootingThreat + 0.25 * passingAccuracy + 0.10 * shotVolume;
      defenceRaw = 0.20 * interceptionsRate + 0.20 * passingAccuracy + 0.10 * aerialWinRate;
    } else if (p.detailedPosition === "Winger") {
      attackRaw = 0.55 * shootingThreat + 0.20 * passingAccuracy + 0.10 * shotVolume;
      defenceRaw = 0.15 * interceptionsRate + 0.15 * passingAccuracy + 0.10 * aerialWinRate;
    } else {
      attackRaw = 0.65 * shootingThreat + 0.10 * passingAccuracy + 0.10 * aerialWinRate;
      defenceRaw = 0.10 * interceptionsRate + 0.10 * passingAccuracy + 0.15 * aerialWinRate;
    }

    const overallScore = pct(attFactor * attackRaw + defFactor * defenceRaw);

    result.push({
      ...p,
      finishingScore,
      passingScore,
      headerScore,
      interceptionsScore,
      overallScore,
      heightDisplay: p.heightCm ? `${p.heightCm} cm` : "N/A"
    });
  }

  return result;
}

function renderTable() {
  tableBody.innerHTML = "";

  if (!currentPlayers.length) {
    noDataMessage.style.display = "block";
    return;
  }
  noDataMessage.style.display = "none";

  const players = [...currentPlayers].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];

    if (typeof av === "number" && typeof bv === "number") {
      return sortDir === "asc" ? av - bv : bv - av;
    }

    const as = String(av || "").toLowerCase();
    const bs = String(bv || "").toLowerCase();
    if (as < bs) return sortDir === "asc" ? -1 : 1;
    if (as > bs) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  for (const p of players) {
    const fav = isFavourite(p.id);
    const noteValue = currentScoutData.notes && currentScoutData.notes[p.id] ? currentScoutData.notes[p.id] : "";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><button class="player-link" data-player-id="${esc(p.id)}" type="button">${esc(p.name)}</button></td>
      <td>${esc(p.team)}</td>
      <td>${esc(p.leagueName)}</td>
      <td>${esc(p.detailedPosition)}</td>
      <td>${esc(p.age || "N/A")}</td>
      <td>${esc(p.heightDisplay)}</td>
      <td>${p.finishingScore}%</td>
      <td>${p.passingScore}%</td>
      <td>${p.headerScore}%</td>
      <td>${p.interceptionsScore}%</td>
      <td><strong>${p.overallScore}%</strong></td>
      <td>
        <button class="fav-toggle ${fav ? "fav-on" : ""}" data-id="${esc(p.id)}" type="button">
          ${fav ? "Saved" : "Save"}
        </button>
      </td>
      <td>
        <input class="note-input" data-id="${esc(p.id)}" type="text" value="${esc(noteValue)}" placeholder="Add note" />
      </td>
    `;
    tableBody.appendChild(row);
  }
}

function renderStandings() {
  const selected = standingsLeagueSelect.value;
  const league = standingsMap[selected];
  standingsBody.innerHTML = "";

  if (!league || !Array.isArray(league.table) || !league.table.length) {
    standingsBody.innerHTML = `<tr><td colspan="11">No standings data available.</td></tr>`;
    return;
  }

  for (const row of league.table) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.position}</td>
      <td>${esc(row.team)}</td>
      <td>${row.played}</td>
      <td>${row.won}</td>
      <td>${row.drawn}</td>
      <td>${row.lost}</td>
      <td>${row.goalsFor}</td>
      <td>${row.goalsAgainst}</td>
      <td>${row.goalDifference}</td>
      <td>${row.points}</td>
      <td>${esc(row.form || "-")}</td>
    `;
    standingsBody.appendChild(tr);
  }
}

async function loadScoutData(username) {
  if (!username) return;
  const res = await fetch(`/api/user/${encodeURIComponent(username)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  currentScoutData = {
    favourites: Array.isArray(data.favourites) ? data.favourites.map(String) : [],
    notes: data.notes || {}
  };
}

async function saveScoutData() {
  if (!currentUser) return;
  await fetch(`/api/user/${encodeURIComponent(currentUser.username)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(currentScoutData)
  });
}

async function handleLogin() {
  const id = (loginIdInput.value || "").trim();
  const password = loginPasswordInput.value || "";
  if (!id || !password) {
    alert("Enter a username and password.");
    return;
  }

  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, password })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    alert(data.message || "Login failed.");
    return;
  }

  currentUser = { username: data.username, role: data.role };
  await loadScoutData(currentUser.username);
  updateSessionUi();
  rerenderPlayers();
  if (currentUser.role === "admin") {
    await loadAdminSummary();
  }
}

async function handleRegister() {
  const username = (loginIdInput.value || "").trim();
  const password = loginPasswordInput.value || "";
  if (!username || !password) {
    alert("Enter a username and password.");
    return;
  }

  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    alert(data.message || "Register failed.");
    return;
  }

  alert("Account created. You can now log in.");
}

async function handleLogout() {
  await fetch("/api/logout", { method: "POST" });
  currentUser = null;
  currentScoutData = { favourites: [], notes: {} };
  updateSessionUi();
  rerenderPlayers();
}

function updateSessionUi() {
  if (!currentUser) {
    loginStatus.textContent = "Not logged in";
    logoutBtn.style.display = "none";
    adminTabButton.style.display = "none";
    return;
  }

  loginStatus.textContent = `Logged in as ${currentUser.role} (${currentUser.username})`;
  logoutBtn.style.display = "inline-block";
  adminTabButton.style.display = currentUser.role === "admin" ? "inline-block" : "none";
}

function rerenderPlayers() {
  currentPlayers = buildScoredPlayers(roleSelect.value, Number(defenceSlider.value));
  renderTable();
}

async function loadSuggestions() {
  const res = await fetch("/api/scout-suggestions");
  const data = await res.json();

  if (data.weeklySuggestion) {
    const w = data.weeklySuggestion;
    weeklySuggestionBox.innerHTML = `
      <h4>Weekly recommendation</h4>
      <p><strong>${esc(w.name)}</strong> - ${esc(w.team)} (${esc(w.leagueName)})</p>
      <p>Should be ${esc(w.style)}. Move from ${esc(w.currentRole)} to ${esc(w.suggestedRole)} because ${esc(w.because)}</p>
    `;
  } else {
    weeklySuggestionBox.textContent = "No weekly recommendation available.";
  }

  scoutSuggestionList.innerHTML = "";
  const list = Array.isArray(data.suggestions) ? data.suggestions : [];
  for (const item of list.slice(0, 12)) {
    const div = document.createElement("div");
    div.className = "suggestion-item";
    div.innerHTML = `
      <strong>${esc(item.name)}</strong>
      <div>${esc(item.team)} - ${esc(item.leagueName)}</div>
      <div>Should be ${esc(item.style)}.</div>
      <div>Move from ${esc(item.currentRole)} to ${esc(item.suggestedRole)} because ${esc(item.because)}</div>
    `;
    scoutSuggestionList.appendChild(div);
  }
}


async function loadAdminSummary() {
  if (!currentUser || currentUser.role !== "admin") return;
  const res = await fetch("/api/admin/summary");
  const data = await res.json();
  if (!res.ok) return;

  const users = (data.users || []).map((u) => `${u.username} (${u.role})`).join(", ");
  const leagues = (data.leagues || []).map((l) => `${l.name}: ${l.teams} teams`).join(" | ");

  adminSummary.innerHTML = `
    <p><strong>Users:</strong> ${esc(users)}</p>
    <p><strong>Stored profiles:</strong> ${data.storedProfiles}</p>
    <p><strong>Player count:</strong> ${data.playerCount}</p>
    <p><strong>Leagues:</strong> ${esc(leagues)}</p>
  `;
}

async function loadSession() {
  const res = await fetch("/api/session");
  const data = await res.json();
  currentUser = data.user || null;
  if (currentUser) {
    await loadScoutData(currentUser.username);
  }
  updateSessionUi();
}

async function loadLeaguesAndData() {
  const [leagueRes, playerRes, standingsRes] = await Promise.all([
    fetch("/api/leagues"),
    fetch("/api/players"),
    fetch("/api/standings")
  ]);

  const leagueData = await leagueRes.json();
  rawPlayers = await playerRes.json();
  standingsMap = await standingsRes.json();

  leagueSelect.innerHTML = `<option value="All">All</option>`;
  for (const league of leagueData.players || []) {
    const option = document.createElement("option");
    option.value = league.name;
    option.textContent = league.name;
    leagueSelect.appendChild(option);
  }

  standingsLeagueSelect.innerHTML = "";
  for (const league of leagueData.standings || []) {
    const option = document.createElement("option");
    option.value = league.code;
    option.textContent = league.name;
    standingsLeagueSelect.appendChild(option);
  }

  rerenderPlayers();
  renderStandings();
}

if (table) {
  table.addEventListener("click", (evt) => {
    const th = evt.target.closest("th[data-sort]");
    if (!th) return;
    const key = th.getAttribute("data-sort");
    if (!key) return;

    if (sortKey === key) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortKey = key;
      sortDir = "desc";
    }
    renderTable();
  });
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

loginButton.addEventListener("click", (e) => {
  e.preventDefault();
  handleLogin().catch((err) => {
    console.error("Login error:", err);
    alert("Login error.");
  });
});

registerButton.addEventListener("click", () => {
  handleRegister().catch((err) => {
    console.error("Register error:", err);
    alert("Register error.");
  });
});

logoutBtn.addEventListener("click", () => {
  handleLogout().catch((err) => {
    console.error("Logout error:", err);
  });
});

viewAllButton.addEventListener("click", () => {
  viewMode = "all";
  rerenderPlayers();
});

viewFavButton.addEventListener("click", () => {
  viewMode = "favourites";
  rerenderPlayers();
});

roleSelect.addEventListener("change", rerenderPlayers);
leagueSelect.addEventListener("change", rerenderPlayers);
defenceSlider.addEventListener("input", () => {
  defenceValue.textContent = `${defenceSlider.value}%`;
  rerenderPlayers();
});
standingsLeagueSelect.addEventListener("change", renderStandings);

refreshDataBtn.addEventListener("click", async () => {
  const res = await fetch("/api/admin/refresh", { method: "POST" });
  const data = await res.json();
  if (!res.ok) {
    alert(data.message || "Refresh failed.");
    return;
  }
  await loadLeaguesAndData();
  await loadSuggestions();
  await loadAdminSummary();
});

tableBody.addEventListener("click", async (evt) => {
  const favBtn = evt.target.closest(".fav-toggle");
  if (favBtn) {
    if (!currentUser) {
      alert("Log in to use favourites.");
      return;
    }

    const playerId = String(favBtn.getAttribute("data-id"));
    const list = currentScoutData.favourites || [];
    const idx = list.indexOf(playerId);
    if (idx === -1) list.push(playerId);
    else list.splice(idx, 1);

    currentScoutData.favourites = list;
    await saveScoutData();
    rerenderPlayers();
  }
});

tableBody.addEventListener("change", async (evt) => {
  const noteInput = evt.target.closest(".note-input");
  if (!noteInput) return;
  if (!currentUser) {
    alert("Log in to add notes.");
    noteInput.value = "";
    return;
  }

  const pid = noteInput.getAttribute("data-id");
  if (!currentScoutData.notes) currentScoutData.notes = {};
  currentScoutData.notes[pid] = noteInput.value;
  await saveScoutData();
});

async function init() {
  await loadSession();
  await loadLeaguesAndData();
  await loadSuggestions();
  if (currentUser && currentUser.role === "admin") {
    await loadAdminSummary();
  }
}

init().catch((err) => {
  console.error("Startup error:", err);
  alert("Error loading app. Check the server console.");
});
