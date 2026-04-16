const roleSelect = document.getElementById("roleSelect");
const seasonSelect = document.getElementById("seasonSelect");
const leagueSelect = document.getElementById("leagueSelect");
const standingsSeasonSelect = document.getElementById("standingsSeasonSelect");
const standingsLeagueSelect = document.getElementById("standingsLeagueSelect");
const defenceSlider = document.getElementById("defenceSlider");
const defenceValue = document.getElementById("defenceValue");
const tableBody = document.getElementById("playerTable");
const noDataMessage = document.getElementById("noDataMessage");
const table = document.getElementById("playersTable");
const standingsBody = document.getElementById("standingsBody");
const standingsTable = document.getElementById("standingsTable");
const loginIdInput = document.getElementById("loginUsername");
const loginPasswordInput = document.getElementById("loginPassword");
const loginButton = document.getElementById("loginButton");
const registerButton = document.getElementById("registerButton");
const registerRoleSelect = document.getElementById("registerRole");
const logoutBtn = document.getElementById("logoutBtn");
const loginStatus = document.getElementById("loginStatus");
const viewAllButton = document.getElementById("viewAllBtn");
const viewFavButton = document.getElementById("viewFavBtn");
const weeklySuggestionBox = document.getElementById("weeklySuggestionBox");
const scoutSuggestionList = document.getElementById("scoutSuggestionList");
const historySuggestionList = document.getElementById("historySuggestionList");
const historySummaryBox = document.getElementById("historySummaryBox");
const adminLogBox = document.getElementById("adminLogBox");
const modelExplanation = document.getElementById("modelExplanation");
const scoutUseBox = document.getElementById("scoutUseBox");
const testingBox = document.getElementById("testingBox");
const adminSummary = document.getElementById("adminSummary");
const refreshDataBtn = document.getElementById("refreshDataBtn");
const adminTabButton = document.getElementById("adminTabButton");
const loginForm = document.getElementById("loginForm");
const adminPlayerSelect = document.getElementById("adminPlayerSelect");
const adminPlayerName = document.getElementById("adminPlayerName");
const adminPlayerTeam = document.getElementById("adminPlayerTeam");
const adminPlayerLeague = document.getElementById("adminPlayerLeague");
const adminPlayerPosition = document.getElementById("adminPlayerPosition");
const adminPlayerNationality = document.getElementById("adminPlayerNationality");
const adminPlayerAge = document.getElementById("adminPlayerAge");
const adminPlayerHeight = document.getElementById("adminPlayerHeight");
const adminPlayerApps = document.getElementById("adminPlayerApps");
const adminPlayerGoals = document.getElementById("adminPlayerGoals");
const adminPlayerShots = document.getElementById("adminPlayerShots");
const adminPlayerPassesAttempted = document.getElementById("adminPlayerPassesAttempted");
const adminPlayerPassesCompleted = document.getElementById("adminPlayerPassesCompleted");
const adminPlayerInterceptions = document.getElementById("adminPlayerInterceptions");
const adminPlayerValue = document.getElementById("adminPlayerValue");
const adminSavePlayerBtn = document.getElementById("adminSavePlayerBtn");
const adminEditStatus = document.getElementById("adminEditStatus");

let rawPlayers = [];
let currentPlayers = [];
let standingsMap = {};
let availableSeasons = [];
let sortKey = "overallScore";
let sortDir = "desc";
let currentUser = null;
let currentScoutData = { favourites: [], notes: {} };
let viewMode = "all";
let csrfToken = "";

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
    .replace(/\"/g, "&quot;");
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    "x-csrf-token": csrfToken
  };
}

function setStatus(message, type = "info") {
  loginStatus.textContent = message;
  loginStatus.dataset.state = type;
}

function canUseScoutTools() {
  return !!currentUser && (currentUser.role === "scout" || currentUser.role === "admin");
}

function moneyLabel(value) {
  const n = num(value);
  if (!n) return "-";
  return `£${n.toFixed(1)}m`;
}

function isFavourite(playerId) {
  if (!currentUser || !Array.isArray(currentScoutData.favourites)) return false;
  return currentScoutData.favourites.includes(String(playerId));
}

function getSelectedLeague() {
  return leagueSelect.value || "All";
}

function getSelectedSeason() {
  return Number(seasonSelect.value || availableSeasons[0] || new Date().getFullYear());
}

function filterByLeague(player) {
  const selected = getSelectedLeague();
  return num(player.season) === getSelectedSeason() && (selected === "All" || player.leagueName === selected);
}

function buildScoredPlayers(roleFilter, defensiveWeight) {
  const rawDef = clamp01(defensiveWeight / 100);
  const rawAtt = 1 - rawDef;
  const defFactor = Math.pow(rawDef, 1.65);
  const attFactor = Math.pow(rawAtt, 1.65);
  const blendTotal = Math.max(0.0001, defFactor + attFactor);
  const defBlend = defFactor / blendTotal;
  const attBlend = attFactor / blendTotal;

  const pool = rawPlayers.filter(filterByLeague);
  const maxInterceptions = pool.reduce((max, p) => Math.max(max, num(p.interceptions)), 0) || 1;
  const maxShots = pool.reduce((max, p) => Math.max(max, num(p.shots)), 0) || 1;
  const maxPasses = pool.reduce((max, p) => Math.max(max, num(p.passesAttempted)), 0) || 1;
  const maxGoals = pool.reduce((max, p) => Math.max(max, num(p.goals)), 0) || 1;
  const result = [];

  const roleWeights = {
    GK: { attack: [0.2, 0.45, 0.2, 0.15], defence: [0.48, 0.32, 0.1, 0.1] },
    CB: { attack: [0.06, 0.28, 0.48, 0.18], defence: [0.46, 0.28, 0.16, 0.1] },
    FB: { attack: [0.18, 0.3, 0.28, 0.24], defence: [0.34, 0.28, 0.14, 0.24] },
    DM: { attack: [0.12, 0.42, 0.22, 0.24], defence: [0.38, 0.28, 0.18, 0.16] },
    CM: { attack: [0.2, 0.38, 0.16, 0.26], defence: [0.26, 0.28, 0.16, 0.3] },
    AM: { attack: [0.4, 0.24, 0.08, 0.28], defence: [0.12, 0.2, 0.1, 0.58] },
    Winger: { attack: [0.46, 0.16, 0.06, 0.32], defence: [0.08, 0.14, 0.08, 0.7] },
    ST: { attack: [0.58, 0.08, 0.04, 0.3], defence: [0.06, 0.08, 0.08, 0.78] }
  };

  for (const p of pool) {
    if (roleFilter !== "Any" && p.detailedPosition !== roleFilter) continue;
    if (viewMode === "favourites") {
      if (!canUseScoutTools()) continue;
      if (!isFavourite(p.id)) continue;
    }

    const shots = num(p.shots);
    const goals = num(p.goals);
    const passesCompleted = num(p.passesCompleted);
    const passesAttempted = num(p.passesAttempted);
    const aerialWon = num(p.aerialDuelsWon);
    const aerialTotal = num(p.aerialDuelsTotal);
    const interceptionsRaw = num(p.interceptions);
    const appearances = num(p.appearances);

    const finishingRate = shots > 0 ? goals / shots : 0;
    const passingAccuracy = passesAttempted > 0 ? passesCompleted / passesAttempted : 0;
    const aerialWinRate = aerialTotal > 0 ? aerialWon / aerialTotal : 0;
    const interceptionsRate = interceptionsRaw / maxInterceptions;
    const shotVolume = shots / maxShots;
    const goalVolume = goals / maxGoals;
    const passVolume = passesAttempted / maxPasses;
    const minutesReliability = clamp01(appearances / 40);
    const ageCurve = clamp01((30 - num(p.age || 30)) / 14);
    const valueEdge = clamp01(num(p.valueForMoneyScore) / 100);

    const creationScore = clamp01(0.5 * passingAccuracy + 0.3 * passVolume + 0.2 * ageCurve);
    const defensiveScore = clamp01(0.52 * interceptionsRate + 0.48 * aerialWinRate);
    const finishingScoreRaw = clamp01(0.42 * finishingRate + 0.28 * shotVolume + 0.3 * goalVolume);
    const weights = roleWeights[p.detailedPosition] || roleWeights.ST;

    const attackScore = clamp01(
      weights.attack[0] * finishingScoreRaw +
      weights.attack[1] * creationScore +
      weights.attack[2] * defensiveScore +
      weights.attack[3] * valueEdge
    );

    const defenceScore = clamp01(
      weights.defence[0] * defensiveScore +
      weights.defence[1] * creationScore +
      weights.defence[2] * aerialWinRate +
      weights.defence[3] * minutesReliability
    );

    const baseScore = clamp01(0.34 * minutesReliability + 0.24 * ageCurve + 0.42 * valueEdge);
    const weightedCore = attBlend * (attackScore * 100) + defBlend * (defenceScore * 100);
    const roleBias = p.detailedPosition === "CB" || p.detailedPosition === "DM" || p.detailedPosition === "FB" ? defBlend * 6 : attBlend * 6;
    const overallScore = Math.round(weightedCore * 0.85 + baseScore * 15 + roleBias);

    result.push({
      ...p,
      finishingScore: pct(finishingRate),
      passingScore: pct(passingAccuracy),
      headerScore: pct(aerialWinRate),
      interceptionsScore: pct(interceptionsRate),
      attackScore: Math.round(attackScore * 100),
      defenceScore: Math.round(defenceScore * 100),
      overallScore
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

    if (sortKey === "urgency") {
      const order = { High: 3, Medium: 2, Low: 1 };
      return sortDir === "asc" ? (order[av] || 0) - (order[bv] || 0) : (order[bv] || 0) - (order[av] || 0);
    }

    if (typeof av === "number" && typeof bv === "number") {
      return sortDir === "asc" ? av - bv : bv - av;
    }

    const as = String(av || "").toLowerCase();
    const bs = String(bv || "").toLowerCase();
    if (as < bs) return sortDir === "asc" ? -1 : 1;
    if (as > bs) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const canScoutEdit = canUseScoutTools();

  for (const p of players) {
    const fav = isFavourite(p.id);
    const noteValue = currentScoutData.notes && currentScoutData.notes[p.id] ? currentScoutData.notes[p.id] : "";

    const saveCell = canScoutEdit
      ? `<button class="fav-toggle ${fav ? "fav-on" : ""}" data-id="${esc(p.id)}" type="button">${fav ? "Saved" : "Save"}</button>`
      : `<span class="muted-cell">Scout only</span>`;
    const noteCell = canScoutEdit
      ? `<input class="note-input" data-id="${esc(p.id)}" type="text" value="${esc(noteValue)}" placeholder="Add note" />`
      : `<span class="muted-cell">Scout only</span>`;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><button class="player-link" data-player-id="${esc(p.id)}" type="button">${esc(p.name)}</button></td>
      <td>${esc(p.team)}</td>
      <td>${esc(p.leagueName)} ${p.season ? `(${p.season})` : ""}</td>
      <td>${esc(p.detailedPosition)}</td>
      <td>${esc(p.age || "N/A")}</td>
      <td>${moneyLabel(p.estimatedMarketValue)}</td>
      <td title="Higher means better output for the estimated price">${p.valueForMoneyScore}</td>
      <td title="Higher means the player looks better value than expected for the profile">${p.undervaluedScore}</td>
      <td><strong>${p.overallScore}%</strong></td>
      <td>${saveCell}</td>
      <td>${noteCell}</td>
    `;
    tableBody.appendChild(row);
  }
}

function renderStandings() {
  const leagueCode = standingsLeagueSelect.value;
  const rows = Array.isArray(standingsMap.table) ? standingsMap.table : [];
  standingsBody.innerHTML = "";

  if (!leagueCode) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="11">Choose a league.</td>`;
    standingsBody.appendChild(tr);
    return;
  }

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="11">${esc(standingsMap.message || "No standings available right now.")}</td>`;
    standingsBody.appendChild(tr);
    return;
  }

  for (const row of rows) {
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
      <td>${esc(row.form || "")}</td>
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
    headers: authHeaders(),
    body: JSON.stringify(currentScoutData)
  });
}

async function handleLogin() {
  const id = (loginIdInput.value || "").trim();
  const password = loginPasswordInput.value || "";
  if (!id || !password) {
    setStatus("Enter a username and password.", "error");
    return;
  }

  const res = await fetch("/api/login", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ id, password })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    setStatus(data.message || "Login failed.", "error");
    return;
  }

  currentUser = { username: data.username, role: data.role };
  setStatus(`Signed in as ${data.username} · ${data.role}`, "success");
  csrfToken = data.csrfToken || csrfToken;
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
  const role = registerRoleSelect ? registerRoleSelect.value : "user";
  if (!username || !password) {
    setStatus("Enter a username and password.", "error");
    return;
  }

  const res = await fetch("/api/register", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ username, password, role })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    setStatus(data.message || "Register failed.", "error");
    return;
  }

  loginIdInput.value = username;
  setStatus(`Account created for ${username}. Signing in...`, "success");
  await handleLogin();
}

async function handleLogout() {
  await fetch("/api/logout", { method: "POST", headers: { "x-csrf-token": csrfToken } });
  currentUser = null;
  currentScoutData = { favourites: [], notes: {} };
  csrfToken = "";
  updateSessionUi();
  rerenderPlayers();
}

function updateSessionUi() {
  if (!currentUser) {
    setStatus("Not signed in", "muted");
    logoutBtn.style.display = "none";
    adminTabButton.style.display = "none";
    viewFavButton.disabled = true;
    return;
  }

  setStatus(`Signed in as ${currentUser.username} · ${currentUser.role}`, "success");
  logoutBtn.style.display = "inline-block";
  adminTabButton.style.display = currentUser.role === "admin" ? "inline-block" : "none";
  viewFavButton.disabled = !canUseScoutTools();
  if (!canUseScoutTools() && viewMode === "favourites") {
    viewMode = "all";
    viewAllButton.classList.add("active");
    viewFavButton.classList.remove("active");
  }
}

function rerenderPlayers() {
  currentPlayers = buildScoredPlayers(roleSelect.value, Number(defenceSlider.value));
  renderTable();
}

async function loadSuggestions() {
  const res = await fetch("/api/scout-suggestions");
  const data = await res.json();

  const currentSuggestions = Array.isArray(data.suggestions) ? data.suggestions.slice(0, 3) : [];
  const featured = data.weeklySuggestion || currentSuggestions[0] || null;

  weeklySuggestionBox.innerHTML = `<h4>Monthly scout update · 2026</h4>`;
  if (featured) {
    weeklySuggestionBox.innerHTML += `
      <div class="featured-suggestion">
        <p><strong>${esc(featured.name)}</strong> · ${esc(featured.team)} · ${esc(featured.leagueName)}</p>
        <p><strong>Role:</strong> ${esc(featured.suggestedRole)} | <strong>Value:</strong> ${moneyLabel(featured.estimatedMarketValue)} | <strong>Confidence:</strong> ${esc(featured.confidence || 0)}%</p>
        <p><strong>Why this month:</strong> ${esc(featured.because)}</p>
        <p><strong>Model drivers:</strong> ${esc(featured.generatedFrom)}</p>
      </div>`;
  } else {
    weeklySuggestionBox.innerHTML += `<p>No 2026 monthly update available.</p>`;
  }

  const topThree = featured
    ? [featured, ...currentSuggestions.filter((item) => item.name !== featured.name)].slice(0, 3)
    : currentSuggestions.slice(0, 3);

  weeklySuggestionBox.innerHTML += `<div class="mini-divider"></div><h4>3 live 2026 recommendations</h4>`;
  if (!topThree.length) {
    weeklySuggestionBox.innerHTML += `<p>No live 2026 recommendations loaded.</p>`;
  } else {
    weeklySuggestionBox.innerHTML += `<div class="inline-suggestion-grid">${topThree.map((item) => `
      <div class="suggestion-item compact-suggestion">
        <strong>${esc(item.name)}</strong>
        <div>${esc(item.team)} · ${esc(item.leagueName)}</div>
        <div><strong>Role:</strong> ${esc(item.suggestedRole)} | <strong>Confidence:</strong> ${esc(item.confidence)}%</div>
        <div><strong>Budget fit:</strong> ${esc(item.valueForMoneyScore)} | <strong>Opportunity:</strong> ${esc(item.undervaluedScore)}</div>
        <div><strong>Why:</strong> ${esc(item.because)}</div>
      </div>`).join("")}</div>`;
  }

  scoutSuggestionList.innerHTML = topThree.length ? `<div class="suggestion-list-inner">${topThree.map((item) => `
    <div class="suggestion-item">
      <strong>${esc(item.name)}</strong>
      <div>${esc(item.team)} · ${esc(item.leagueName)}</div>
      <div><strong>Current role:</strong> ${esc(item.currentRole)} | <strong>Suggested role:</strong> ${esc(item.suggestedRole)}</div>
      <div><strong>Confidence:</strong> ${esc(item.confidence)}% | <strong>Budget fit:</strong> ${esc(item.valueForMoneyScore)} | <strong>Opportunity:</strong> ${esc(item.undervaluedScore)}</div>
      <div><strong>Why now:</strong> ${esc(item.because)}</div>
      <div><strong>Model inputs:</strong> ${esc(item.generatedFrom)}</div>
    </div>`).join("")}</div>` : `<div class="suggestion-item">No extra 2026 shortlist loaded.</div>`;

  const historySummary = data.historySummary || { total: 0, correct: 0, hitRate: 0, averageConfidence: 0 };
  historySummaryBox.innerHTML = `<strong>2025 validation</strong><p><strong>Reviewed:</strong> ${historySummary.total} | <strong>Correct:</strong> ${historySummary.correct} | <strong>Hit rate:</strong> ${historySummary.hitRate}% | <strong>Avg confidence:</strong> ${historySummary.averageConfidence}%</p>`;

  historySuggestionList.innerHTML = "";
  const history = Array.isArray(data.history) ? data.history.slice(0, 3) : [];
  if (!history.length) { historySuggestionList.innerHTML = `<div class="suggestion-item">No 2025 validation record loaded.</div>`; }
  for (const item of history) {
    const div = document.createElement("div");
    div.className = "suggestion-item";
    div.innerHTML = `
      <strong>${esc(item.player)}</strong>
      <div>${esc(String(item.season))} - ${esc(item.fromClub)}</div>
      <div><strong>Recommended role:</strong> ${esc(item.suggestedRole)} | <strong>Estimated band:</strong> ${esc(item.estimatedBand)} | <strong>Confidence:</strong> ${esc(item.confidence)}%</div>
      <div><strong>Why:</strong> ${esc(item.scoutCase)}</div>
      <div><strong>Drivers:</strong> ${esc((item.whyModelLikedHim || []).join(", "))}</div>
      <div><strong>Outcome:</strong> ${esc(item.outcome)}</div>
      <div><strong>Verdict:</strong> ${esc(item.verdict)} - ${esc(item.proof)}</div>
    `;
    historySuggestionList.appendChild(div);
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
    <div class="admin-summary-grid">
      <div><strong>Users:</strong> ${esc(users)}</div>
      <div><strong>Stored profiles:</strong> ${data.storedProfiles}</div>
      <div><strong>Player count:</strong> ${data.playerCount}</div>
      <div><strong>Leagues:</strong> ${esc(leagues)}</div>
    </div>
  `;

  if (adminLogBox) {
    const logs = Array.isArray(data.editLogs) ? data.editLogs : [];
    adminLogBox.innerHTML = logs.length
      ? `<strong>Recent monitored edits</strong>${logs.map((log) => `<div class="admin-log-row"><span>${esc((log.at || "").replace("T", " ").slice(0, 16))}</span><span>${esc(log.admin || "admin")}</span><span>${esc(log.player || "")}</span><span>${esc(Object.keys(log.changes || {}).join(", ") || "fields")}</span></div>`).join("")}`
      : `<strong>Recent monitored edits</strong><p>No admin edits yet.</p>`;
  }

  populateAdminEditor();
}

function populateAdminEditor() {
  if (!adminPlayerSelect) return;
  const currentSeason = Number(seasonSelect.value || availableSeasons[0] || 2026);
  const players = [...rawPlayers].sort((a, b) => {
    if (num(b.season) !== num(a.season)) return num(b.season) - num(a.season);
    return String(a.name).localeCompare(String(b.name));
  });
  adminPlayerSelect.innerHTML = players.map((player) => `<option value="${esc(player.id)}">${esc(player.name)} · ${esc(player.team)} · ${esc(player.leagueName)} (${esc(player.season)})</option>`).join("");
  const currentSeasonPlayer = players.find((player) => num(player.season) === currentSeason);
  if (currentSeasonPlayer) adminPlayerSelect.value = currentSeasonPlayer.id;
  fillAdminEditorFromSelect();
}

function fillAdminEditorFromSelect() {
  if (!adminPlayerSelect || !adminPlayerSelect.value) return;
  const player = rawPlayers.find((entry) => entry.id === adminPlayerSelect.value);
  if (!player) return;
  adminPlayerName.value = player.name || "";
  adminPlayerTeam.value = player.team || "";
  adminPlayerLeague.value = player.leagueName || "Premier League";
  if (adminPlayerPosition) adminPlayerPosition.value = player.detailedPosition || "CM";
  if (adminPlayerNationality) adminPlayerNationality.value = player.nationality || "";
  adminPlayerAge.value = player.age || "";
  if (adminPlayerHeight) adminPlayerHeight.value = player.heightCm || "";
  if (adminPlayerApps) adminPlayerApps.value = player.appearances || 0;
  if (adminPlayerGoals) adminPlayerGoals.value = player.goals || 0;
  if (adminPlayerShots) adminPlayerShots.value = player.shots || 0;
  if (adminPlayerPassesAttempted) adminPlayerPassesAttempted.value = player.passesAttempted || 0;
  if (adminPlayerPassesCompleted) adminPlayerPassesCompleted.value = player.passesCompleted || 0;
  if (adminPlayerInterceptions) adminPlayerInterceptions.value = player.interceptions || 0;
  adminPlayerValue.value = num(player.estimatedMarketValue) || "";
}

async function saveAdminPlayer() {
  if (!currentUser || currentUser.role !== "admin") return;
  const id = adminPlayerSelect.value;
  const res = await fetch(`/api/admin/player/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      name: adminPlayerName.value,
      team: adminPlayerTeam.value,
      leagueName: adminPlayerLeague.value,
      detailedPosition: adminPlayerPosition ? adminPlayerPosition.value : "CM",
      nationality: adminPlayerNationality ? adminPlayerNationality.value : "",
      age: Number(adminPlayerAge.value),
      heightCm: adminPlayerHeight ? Number(adminPlayerHeight.value) : 0,
      appearances: adminPlayerApps ? Number(adminPlayerApps.value) : 0,
      goals: adminPlayerGoals ? Number(adminPlayerGoals.value) : 0,
      shots: adminPlayerShots ? Number(adminPlayerShots.value) : 0,
      passesAttempted: adminPlayerPassesAttempted ? Number(adminPlayerPassesAttempted.value) : 0,
      passesCompleted: adminPlayerPassesCompleted ? Number(adminPlayerPassesCompleted.value) : 0,
      interceptions: adminPlayerInterceptions ? Number(adminPlayerInterceptions.value) : 0,
      estimatedMarketValue: Number(adminPlayerValue.value)
    })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    adminEditStatus.textContent = data.message || "Could not save player.";
    return;
  }
  adminEditStatus.textContent = `${data.player.name} updated.`;
  await loadLeaguesAndData();
  await loadSuggestions();
  await loadAdminSummary();
}

async function loadSession() {
  const res = await fetch("/api/session");
  const data = await res.json();
  currentUser = data.user || null;
  csrfToken = data.csrfToken || "";
  if (currentUser) {
    await loadScoutData(currentUser.username);
  }
  updateSessionUi();
}

async function loadLeaguesAndData() {
  const leagueRes = await fetch("/api/leagues");
  const leagueData = await leagueRes.json();
  availableSeasons = Array.isArray(leagueData.seasons) ? leagueData.seasons : [];
  rawPlayers = await (await fetch("/api/players")).json();

  seasonSelect.innerHTML = "";
  standingsSeasonSelect.innerHTML = "";
  for (const season of availableSeasons) {
    const option = document.createElement("option");
    option.value = season;
    option.textContent = season;
    seasonSelect.appendChild(option);
    standingsSeasonSelect.appendChild(option.cloneNode(true));
  }
  if (availableSeasons.length) {
    seasonSelect.value = String(availableSeasons[0]);
    standingsSeasonSelect.value = String(availableSeasons[0]);
  }

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

  if (leagueSelect.options.length > 1) {
    leagueSelect.value = "All";
  }
  if (standingsLeagueSelect.options.length) {
    standingsLeagueSelect.value = standingsLeagueSelect.options[0].value;
  }

  const standingsRes = await fetch(`/api/standings?season=${encodeURIComponent(standingsSeasonSelect.value || "")}&league=${encodeURIComponent(standingsLeagueSelect.value || "")}`);
  standingsMap = await standingsRes.json();

  rerenderPlayers();
  renderStandings();
  if (currentUser && currentUser.role === "admin") {
    populateAdminEditor();
  }
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

loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  handleLogin().catch((err) => {
    console.error("Login error:", err);
    setStatus(err?.message || "Login error.", "error");
  });
});

registerButton.addEventListener("click", () => {
  handleRegister().catch((err) => {
    console.error("Register error:", err);
    setStatus("Register error.", "error");
  });
});

logoutBtn.addEventListener("click", () => {
  handleLogout().catch((err) => {
    console.error("Logout error:", err);
  });
});

viewAllButton.addEventListener("click", () => {
  viewMode = "all";
  viewAllButton.classList.add("active");
  viewFavButton.classList.remove("active");
  rerenderPlayers();
});

viewFavButton.addEventListener("click", () => {
  if (!canUseScoutTools()) {
    setStatus("Scout login required for saved players.", "error");
    return;
  }
  viewMode = "favourites";
  viewFavButton.classList.add("active");
  viewAllButton.classList.remove("active");
  rerenderPlayers();
});

roleSelect.addEventListener("change", rerenderPlayers);
seasonSelect.addEventListener("change", rerenderPlayers);
leagueSelect.addEventListener("change", rerenderPlayers);
defenceSlider.addEventListener("input", () => {
  const value = Number(defenceSlider.value);
  let label = `${value}%`;
  if (value <= 20) label += " · Strong attack lean";
  else if (value <= 40) label += " · Attack lean";
  else if (value < 60) label += " · Balanced";
  else if (value < 80) label += " · Defence lean";
  else label += " · Strong defence lean";
  defenceValue.textContent = label;
  rerenderPlayers();
});
async function refreshStandings() {
  const res = await fetch(`/api/standings?season=${encodeURIComponent(standingsSeasonSelect.value || "")}&league=${encodeURIComponent(standingsLeagueSelect.value || "")}`);
  standingsMap = await res.json();
  renderStandings();
}
standingsSeasonSelect.addEventListener("change", refreshStandings);
standingsLeagueSelect.addEventListener("change", refreshStandings);

refreshDataBtn.addEventListener("click", async () => {
  const res = await fetch("/api/admin/refresh", { method: "POST", headers: { "x-csrf-token": csrfToken } });
  const data = await res.json();
  if (!res.ok) {
    setStatus(data.message || "Refresh failed.", "error");
    return;
  }
  await loadLeaguesAndData();
  await loadSuggestions();
  await loadAdminSummary();
});

tableBody.addEventListener("click", async (evt) => {
  const favBtn = evt.target.closest(".fav-toggle");
  if (favBtn) {
    if (!canUseScoutTools()) {
      setStatus("Scout login required for favourites.", "error");
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
  if (!canUseScoutTools()) {
    setStatus("Scout login required for notes.", "error");
    noteInput.value = "";
    return;
  }

  const playerId = String(noteInput.getAttribute("data-id"));
  currentScoutData.notes[playerId] = noteInput.value;
  await saveScoutData();
});

if (adminPlayerSelect) adminPlayerSelect.addEventListener("change", fillAdminEditorFromSelect);
if (adminSavePlayerBtn) adminSavePlayerBtn.addEventListener("click", () => {
  saveAdminPlayer().catch((err) => {
    console.error("Admin save error:", err);
    adminEditStatus.textContent = "Could not save player.";
  });
});

(async function init() {
  try {
    await loadSession();
    await loadLeaguesAndData();
    await loadSuggestions();
    if (currentUser && currentUser.role === "admin") {
      await loadAdminSummary();
    }
    defenceSlider.dispatchEvent(new Event("input"));
    viewAllButton.classList.add("active");
  } catch (err) {
    console.error("Init error:", err);
    setStatus("Could not load app data.", "error");
  }
})();
