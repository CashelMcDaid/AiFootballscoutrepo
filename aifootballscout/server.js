import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import session from "express-session";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const userDataPath = path.join(__dirname, "data", "userData.json");
const usersPath = path.join(__dirname, "data", "users.json");
const SESSION_SECRET = process.env.SESSION_SECRET || "fyp-football-scout-session";

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" }
  })
);

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw || JSON.stringify(fallback));
  } catch (err) {
    console.error(`Error loading ${path.basename(filePath)}:`, err.message);
    return fallback;
  }
}

function saveJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error(`Error saving ${path.basename(filePath)}:`, err.message);
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password, salt, hash) {
  const hashed = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hashed, "hex"), Buffer.from(hash, "hex"));
}

function ensureUsersFile() {
  if (fs.existsSync(usersPath)) return;

  const defaults = [
    { username: "admin", password: "admin123", role: "admin" },
    { username: "scout", password: "password", role: "user" }
  ].map((u) => {
    const salt = crypto.randomBytes(16).toString("hex");
    return {
      username: u.username,
      role: u.role,
      salt,
      passwordHash: hashPassword(u.password, salt)
    };
  });

  saveJson(usersPath, defaults);
}

function getUsers() {
  ensureUsersFile();
  return loadJson(usersPath, []);
}

function loadUserData() {
  return loadJson(userDataPath, {});
}

function saveUserData(data) {
  saveJson(userDataPath, data);
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, message: "Not logged in" });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ ok: false, message: "Admin access required" });
  }
  next();
}

const loginAttempts = new Map();

function canAttemptLogin(ip) {
  const now = Date.now();
  const row = loginAttempts.get(ip) || { count: 0, last: 0 };
  if (now - row.last > 15 * 60 * 1000) {
    loginAttempts.set(ip, { count: 0, last: now });
    return true;
  }
  if (row.count >= 10) return false;
  return true;
}

function recordLoginAttempt(ip, success) {
  const now = Date.now();
  if (success) {
    loginAttempts.delete(ip);
    return;
  }
  const row = loginAttempts.get(ip) || { count: 0, last: now };
  row.count += 1;
  row.last = now;
  loginAttempts.set(ip, row);
}

function parseApiFootballLeagues() {
  const raw = process.env.API_FOOTBALL_LEAGUE_IDS || process.env.API_FOOTBALL_LEAGUE_ID || "39";
  return raw
    .split(",")
    .map((x) => String(x).trim())
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));
}

function getLeagueNameById(id) {
  const map = {
    39: "Premier League",
    140: "La Liga",
    135: "Serie A",
    78: "Bundesliga",
    61: "Ligue 1"
  };
  return map[id] || `League ${id}`;
}

function guessDetailedPosition(rawPosition, player, stat) {
  const raw = String(rawPosition || "").toLowerCase();
  const shots = num(stat?.shots?.total);
  const goals = num(stat?.goals?.total);
  const passesTotal = num(stat?.passes?.total);
  const interceptions = num(stat?.tackles?.interceptions);
  const duelsWon = num(stat?.duels?.won);
  const height = String(player?.height || "");
  const heightNum = num(height.match(/(\d+)/)?.[1]);

  if (raw.includes("goalkeeper") || raw === "gk") return "GK";
  if (raw.includes("centre-back") || raw.includes("center-back") || raw.includes("centre back") || raw.includes("center back") || raw === "cb") return "CB";
  if (raw.includes("back") || raw.includes("full") || raw.includes("left-back") || raw.includes("right-back") || raw === "rb" || raw === "lb") return "FB";
  if (raw.includes("defensive midfield") || raw.includes("dm") || raw.includes("cdm")) return "DM";
  if (raw.includes("attacking midfield") || raw.includes("cam") || raw === "am") return "AM";
  if (raw.includes("midfield") || raw.includes("midfielder") || raw.includes("cm")) {
    if (interceptions >= 20 && goals <= 3) return "DM";
    if (goals >= 6 || shots >= 20) return "AM";
    return "CM";
  }
  if (raw.includes("wing") || raw.includes("left wing") || raw.includes("right wing")) return "Winger";
  if (raw.includes("striker") || raw.includes("centre-forward") || raw.includes("forward") || raw === "st" || raw === "cf") return "ST";
  if (raw.includes("def")) {
    if (heightNum >= 185 || duelsWon >= 40) return "CB";
    return "FB";
  }
  if (raw.includes("mid")) {
    if (interceptions >= 25) return "DM";
    if (goals >= 6 || shots >= 20) return "AM";
    return "CM";
  }
  if (raw.includes("att") || raw.includes("for")) {
    if (goals >= 8 || shots >= 25) return "ST";
    return "Winger";
  }
  if (shots >= 25 || goals >= 8) return "ST";
  if (interceptions >= 25 && passesTotal >= 400) return "DM";
  if (passesTotal >= 700) return "CM";
  return "Winger";
}

function simplePosition(detailed) {
  if (detailed === "GK") return "Goalkeeper";
  if (detailed === "CB" || detailed === "FB") return "Defender";
  if (detailed === "DM" || detailed === "CM" || detailed === "AM") return "Midfielder";
  if (detailed === "Winger" || detailed === "ST") return "Attacker";
  return "Unknown";
}

function buildScoutSuggestion(player) {
  const passingAccuracy = player.passesAttempted > 0 ? player.passesCompleted / player.passesAttempted : 0;
  const shotRate = player.shots > 0 ? player.goals / player.shots : 0;
  const defensiveValue = player.interceptions + player.aerialDuelsWon * 0.6;
  const attackingValue = player.goals * 5 + player.shots * 0.7 + shotRate * 20;
  const buildValue = passingAccuracy * 100 + player.passesAttempted / 8;

  let suggestion = player.detailedPosition;
  let style = "balanced";
  let because = "their data is fairly balanced across the main categories.";

  if (player.detailedPosition === "Winger" || player.detailedPosition === "ST") {
    if (defensiveValue > attackingValue && player.interceptions >= 12) {
      suggestion = "AM";
      style = "more defensive";
      because = "their defensive work and ball-winning numbers are stronger than their final-third output.";
    } else if (player.detailedPosition === "Winger" && player.goals >= 8) {
      suggestion = "ST";
      style = "more attacking";
      because = "their goal threat and shot output suggest a more central attacking role.";
    }
  } else if (player.detailedPosition === "AM" || player.detailedPosition === "CM") {
    if (player.interceptions >= 18 && passingAccuracy >= 0.8) {
      suggestion = "DM";
      style = "more defensive";
      because = "their interceptions and safe build-up numbers are stronger than their attacking return.";
    } else if (player.goals >= 6 || player.shots >= 20) {
      suggestion = "AM";
      style = "more attacking";
      because = "their shooting output suggests they can influence games higher up the pitch.";
    }
  } else if (player.detailedPosition === "FB") {
    if (buildValue >= 90 && player.interceptions >= 10) {
      suggestion = "DM";
      style = "more central";
      because = "their passing volume and defensive work point to a role that could invert into midfield.";
    } else if (player.aerialDuelsWon >= 30) {
      suggestion = "CB";
      style = "more defensive";
      because = "their aerial output and duel strength suggest they could play further back.";
    }
  } else if (player.detailedPosition === "CB") {
    if (passingAccuracy >= 0.88 && player.passesAttempted >= 700) {
      suggestion = "DM";
      style = "more progressive";
      because = "their ball use is strong enough to step forward into a deeper midfield role.";
    }
  }

  return {
    name: player.name,
    currentRole: player.detailedPosition,
    suggestedRole: suggestion,
    style,
    because,
    team: player.team,
    leagueName: player.leagueName
  };
}

async function fetchStandingsByLeague() {
  const apiKey = process.env.API_FOOTBALL_KEY;
  const leagues = parseApiFootballLeagues();
  const season = process.env.API_FOOTBALL_SEASON || 2025;

  if (!apiKey) {
    console.warn("API_FOOTBALL_KEY missing standings disabled.");
    return {};
  }

  const output = {};

  for (const leagueId of leagues) {
    const leagueName = getLeagueNameById(leagueId);

    try {
      const res = await axios.get("https://v3.football.api-sports.io/standings", {
        headers: { "x-apisports-key": apiKey },
        params: { league: leagueId, season }
      });

      const leagueBlock = res.data?.response?.[0]?.league || {};
      const standingsGroups = Array.isArray(leagueBlock.standings) ? leagueBlock.standings : [];
      const table = Array.isArray(standingsGroups[0]) ? standingsGroups[0] : [];

      output[String(leagueId)] = {
        code: String(leagueId),
        name: leagueBlock.name || leagueName,
        table: table.map((t) => ({
          position: num(t.rank),
          team: t.team?.name || "Unknown",
          played: num(t.all?.played),
          won: num(t.all?.win),
          drawn: num(t.all?.draw),
          lost: num(t.all?.lose),
          goalsFor: num(t.all?.goals?.for),
          goalsAgainst: num(t.all?.goals?.against),
          goalDifference: num(t.goalsDiff),
          points: num(t.points),
          form: t.form || ""
        }))
      };

      console.log(`Loaded standings for ${output[String(leagueId)].name}.`);
    } catch (err) {
      console.error(`Error fetching standings for league ${leagueId}:`, err.message);
      if (err.response?.data) {
        console.error("Standings error body:", JSON.stringify(err.response.data, null, 2));
      }
      output[String(leagueId)] = { code: String(leagueId), name: leagueName, table: [] };
    }
  }

  return output;
}

async function fetchPlayers() {
  const apiKey = process.env.API_FOOTBALL_KEY;
  const leagues = parseApiFootballLeagues();
  const season = process.env.API_FOOTBALL_SEASON || 2025;

  if (!apiKey) {
    console.error("API_FOOTBALL_KEY missing cannot fetch players.");
    return [];
  }

  const all = [];

  for (const leagueId of leagues) {
    let page = 1;
    const leagueName = getLeagueNameById(leagueId);

    while (true) {
      try {
        const res = await axios.get("https://v3.football.api-sports.io/players", {
          headers: { "x-apisports-key": apiKey },
          params: { league: leagueId, season, page }
        });

        const response = res.data.response;
        if (!response || response.length === 0) break;

        for (const entry of response) {
          const player = entry.player;
          const stat = entry.statistics?.[0];
          if (!player || !stat) continue;

          const games = stat.games || {};
          const shots = stat.shots || {};
          const goals = stat.goals || {};
          const passes = stat.passes || {};
          const duels = stat.duels || {};
          const tackles = stat.tackles || {};

          const detailedPosition = guessDetailedPosition(games.position, player, stat);
          const positionGroup = simplePosition(detailedPosition);

          let heightCm = null;
          if (player.height) {
            const cmMatch = String(player.height).match(/(\d+)\s*cm/i);
            if (cmMatch) {
              heightCm = parseInt(cmMatch[1], 10);
            } else {
              const anyDigits = String(player.height).match(/(\d+)/);
              if (anyDigits) heightCm = parseInt(anyDigits[1], 10);
            }
          }

          if (!heightCm || !Number.isFinite(heightCm)) {
            const defaults = { GK: 190, CB: 186, FB: 178, DM: 182, CM: 180, AM: 178, Winger: 176, ST: 183 };
            heightCm = defaults[detailedPosition] || 180;
          }

          const totalPasses = num(passes.total);
          let passesAttempted = totalPasses;
          let passesCompleted = 0;

          if (passes.accuracy !== undefined && passes.accuracy !== null && passes.accuracy !== "") {
            const accNum = Number(passes.accuracy);
            if (Number.isFinite(accNum) && passesAttempted > 0) {
              passesCompleted = Math.round((accNum / 100) * passesAttempted);
            }
          }

          if (!passesCompleted && num(passes.completed) > 0) {
            passesCompleted = num(passes.completed);
            if (!passesAttempted) passesAttempted = passesCompleted;
          }

          const aerialDuelsTotal = num(duels.total);
          const aerialDuelsWon = num(duels.won);
          const interceptions = num(tackles.interceptions);
          const appearances = num(games.appearances);

          if (
            appearances === 0 &&
            num(shots.total) === 0 &&
            passesAttempted === 0 &&
            aerialDuelsTotal === 0 &&
            interceptions === 0
          ) {
            continue;
          }

          const passAccuracy = passesAttempted > 0 ? passesCompleted / passesAttempted : 0;
          const aerialRate = aerialDuelsTotal > 0 ? aerialDuelsWon / aerialDuelsTotal : 0;
          const shotConversion = num(shots.total) > 0 ? num(goals.total) / num(shots.total) : 0;
          const interceptionsPerGame = appearances > 0 ? interceptions / appearances : 0;

          all.push({
            id: String(player.id),
            name: player.name,
            team: stat.team?.name || "Unknown",
            leagueId,
            leagueName,
            position: positionGroup,
            detailedPosition,
            rawPosition: games.position || "",
            age: player.age || null,
            nationality: player.nationality || "",
            heightCm,
            photo: player.photo || "",
            appearances,
            shots: num(shots.total),
            goals: num(goals.total),
            passesCompleted,
            passesAttempted,
            aerialDuelsWon,
            aerialDuelsTotal,
            interceptions,
            passAccuracy,
            aerialRate,
            shotConversion,
            interceptionsPerGame,
            headerWinRate: aerialRate,
            teamLogo: stat.team?.logo || "",
            teamStanding: null
          });
        }

        const totalPages = res.data.paging?.total || page;
        if (page >= totalPages) break;
        page += 1;
      } catch (err) {
        console.error(`Error calling API-Football for ${leagueName}:`, err.message);
        if (err.response?.data) {
          console.error("API-Football error body:", JSON.stringify(err.response.data, null, 2));
        }
        break;
      }
    }
  }

  console.log(`Fetched ${all.length} players from API-Football in total.`);
  return all;
}

let cachedPlayers = [];
let standingsByLeague = {};
let scoutSuggestions = [];
let weeklySuggestion = null;

function chooseWeeklySuggestion(list) {
  if (!list.length) return null;
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now - start) / 86400000);
  const week = Math.floor((days + start.getDay() + 1) / 7);
  return list[week % list.length];
}

app.get("/api/session", (req, res) => {
  res.json({ ok: true, user: req.session.user || null });
});

app.post("/api/register", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();

  if (!username || !password) {
    return res.status(400).json({ ok: false, message: "Username and password required" });
  }

  const users = getUsers();
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ ok: false, message: "Username already exists" });
  }

  const salt = crypto.randomBytes(16).toString("hex");
  users.push({
    username,
    role: "user",
    salt,
    passwordHash: hashPassword(password, salt)
  });
  saveJson(usersPath, users);

  const allData = loadUserData();
  if (!allData[username]) {
    allData[username] = { favourites: [], notes: {} };
    saveUserData(allData);
  }

  res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const username = String(req.body?.id || req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();
  const ip = req.ip || "unknown";

  if (!canAttemptLogin(ip)) {
    return res.status(429).json({ ok: false, message: "Too many login attempts" });
  }

  const users = getUsers();
  const user = users.find((u) => u.username === username);
  if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
    recordLoginAttempt(ip, false);
    return res.json({ ok: false, message: "Invalid credentials" });
  }

  req.session.user = { username: user.username, role: user.role };
  recordLoginAttempt(ip, true);
  res.json({ ok: true, role: user.role, username: user.username });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/user/:id", requireAuth, (req, res) => {
  const id = req.params.id;
  if (req.session.user.role !== "admin" && req.session.user.username !== id) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }
  const all = loadUserData();
  const user = all[id] || { favourites: [], notes: {} };
  res.json(user);
});

app.put("/api/user/:id", requireAuth, (req, res) => {
  const id = req.params.id;
  if (req.session.user.role !== "admin" && req.session.user.username !== id) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }
  const all = loadUserData();
  const body = req.body || {};
  all[id] = {
    favourites: Array.isArray(body.favourites) ? body.favourites.map(String) : [],
    notes: typeof body.notes === "object" && body.notes ? body.notes : {}
  };
  saveUserData(all);
  res.json({ ok: true });
});

app.get("/api/admin/summary", requireAdmin, (req, res) => {
  const users = getUsers().map((u) => ({ username: u.username, role: u.role }));
  const userData = loadUserData();
  res.json({
    users,
    playerCount: cachedPlayers.length,
    leagues: Object.values(standingsByLeague).map((l) => ({ code: l.code, name: l.name, teams: l.table.length })),
    storedProfiles: Object.keys(userData).length
  });
});

app.post("/api/admin/refresh", requireAdmin, async (req, res) => {
  await startup();
  res.json({ ok: true, playerCount: cachedPlayers.length });
});

app.get("/api/players", (req, res) => {
  const league = String(req.query.league || "").trim();
  const players = league
    ? cachedPlayers.filter((p) => p.leagueName === league || String(p.leagueId) === league)
    : cachedPlayers;
  res.json(players);
});

app.get("/api/player/:id", (req, res) => {
  const player = cachedPlayers.find((p) => p.id === String(req.params.id));
  if (!player) return res.status(404).json({ ok: false, message: "Player not found" });
  res.json(player);
});

app.get("/api/standings", (req, res) => {
  const league = String(req.query.league || "").trim();
  if (league) {
    return res.json(standingsByLeague[league] || { code: league, name: league, table: [] });
  }
  res.json(standingsByLeague);
});

app.get("/api/leagues", (req, res) => {
  res.json({
    standings: Object.values(standingsByLeague).map((l) => ({ code: l.code, name: l.name })),
    players: [...new Map(cachedPlayers.map((p) => [p.leagueName, { id: p.leagueId, name: p.leagueName }])).values()]
  });
});

app.get("/api/scout-suggestions", (req, res) => {
  res.json({ weeklySuggestion, suggestions: scoutSuggestions.slice(0, 20) });
});

app.get("/api/player-image/:id", (req, res) => {
  const player = cachedPlayers.find((p) => p.id === String(req.params.id));
  if (!player) return res.redirect("/images/placeholder-player.svg");

  const localPath = path.join(__dirname, "public", "images", "players", `${slugify(player.name)}.png`);
  if (fs.existsSync(localPath)) {
    return res.sendFile(localPath);
  }

  if (player.photo) {
    return res.json({ url: player.photo, local: false });
  }

  res.json({ url: "/images/placeholder-player.svg", local: true });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function startup() {
  const players = await fetchPlayers();
  standingsByLeague = await fetchStandingsByLeague();

  const teamStandingMap = {};
  for (const league of Object.values(standingsByLeague)) {
    for (const row of league.table) {
      teamStandingMap[`${league.name}__${row.team}`] = row.position;
    }
  }

  cachedPlayers = players.map((player) => ({
    ...player,
    teamStanding: teamStandingMap[`${player.leagueName}__${player.team}`] ?? null,
    safeName: escapeHtml(player.name),
    localImageSlug: slugify(player.name)
  }));

  scoutSuggestions = cachedPlayers
    .map(buildScoutSuggestion)
    .filter((x) => x.suggestedRole !== x.currentRole)
    .sort((a, b) => a.name.localeCompare(b.name));

  weeklySuggestion = chooseWeeklySuggestion(scoutSuggestions);
  console.log("Players loaded:", cachedPlayers.length);
}

app.listen(PORT, async () => {
  ensureUsersFile();
  await startup();
  console.log(`AI Football Scout running at http://localhost:${PORT}`);
});